/**
 * Netlify Function : gerant-stats
 * Retourne les statistiques du gérant :
 * - Stock chambre froide
 * - Marges achat vs ventes par produit
 * - Résumé des mouvements
 * - Employés avec leur stock reçu
 */

function json(code, data) {
    return {
        statusCode: code,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(data)
    };
}

async function sbRead(res) {
    const t = await res.text();
    if (!t || !t.trim()) return null;
    try { return JSON.parse(t); } catch { return null; }
}

async function verifierToken(event, URL, KEY) {
    const auth = (event.headers.authorization || event.headers.Authorization || "").replace("Bearer ", "").trim();
    if (!auth) throw new Error("Token manquant");
    const r = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${auth}` } });
    const u = await sbRead(r);
    if (!r.ok || !u?.id) throw new Error("Token invalide");
    const pr = await fetch(`${URL}/rest/v1/utilisateurs?id=eq.${u.id}&select=role,actif&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${auth}` }
    });
    const p = await sbRead(pr);
    if (!Array.isArray(p) || !p[0] || !p[0].actif) throw new Error("Profil invalide");
    if (!["gerant", "admin"].includes(p[0].role)) throw new Error("Accès refusé");
    return { userId: u.id, role: p[0].role };
}

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type,Authorization" }, body: "" };
    }

    const URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_KEY;
    const SVC = process.env.SUPABASE_SERVICE_KEY || KEY;

    if (!URL || !KEY) return json(500, { error: "Configuration manquante" });

    try { await verifierToken(event, URL, KEY); }
    catch (e) { return json(403, { error: e.message }); }

    try {
        const headers = { apikey: SVC, Authorization: `Bearer ${SVC}` };

        // Lancer toutes les requêtes en parallèle
        const [
            stockRes,
            margeRes,
            mvtRecentRes,
            employesRes,
            facturesRes
        ] = await Promise.all([
            // Stock actuel chambre froide
            fetch(`${URL}/rest/v1/produits?select=id,nom,reference,quantite,prix_kg,prix_achat_kg,date_expiration&order=nom.asc`, { headers }),
            // Mouvements agrégés par produit
            fetch(`${URL}/rest/v1/mouvements_stock?select=produit_id,type,quantite,prix_achat_kg`, { headers }),
            // 20 derniers mouvements
            fetch(`${URL}/rest/v1/v_mouvements_detail?limit=20&order=created_at.desc`, { headers }),
            // Employés actifs
            fetch(`${URL}/rest/v1/utilisateurs?role=eq.employe&actif=eq.true&select=id,nom,email`, { headers }),
            // Factures pour calcul revenus
            fetch(`${URL}/rest/v1/factures?select=total_ttc,date_facture`, { headers })
        ]);

        const [stock, mouvements, mvtRecents, employes, factures] = await Promise.all([
            sbRead(stockRes), sbRead(margeRes), sbRead(mvtRecentRes),
            sbRead(employesRes), sbRead(facturesRes)
        ]);

        // ── Calculer les marges par produit ──
        const mvtMap = {};
        if (Array.isArray(mouvements)) {
            mouvements.forEach(m => {
                if (!mvtMap[m.produit_id]) {
                    mvtMap[m.produit_id] = { entrees: 0, sorties: 0, cout_achat: 0, prix_achat_moy: [] };
                }
                const qty = Number(m.quantite || 0);
                if (m.type === "entree") {
                    mvtMap[m.produit_id].entrees += qty;
                    if (m.prix_achat_kg) {
                        mvtMap[m.produit_id].cout_achat += qty * Number(m.prix_achat_kg);
                        mvtMap[m.produit_id].prix_achat_moy.push(Number(m.prix_achat_kg));
                    }
                }
                if (m.type === "sortie") {
                    mvtMap[m.produit_id].sorties += qty;
                }
            });
        }

        // ── Enrichir le stock avec les marges ──
        const stockAvecMarge = (Array.isArray(stock) ? stock : []).map(p => {
            const m      = mvtMap[p.id] || { entrees: 0, sorties: 0, cout_achat: 0, prix_achat_moy: [] };
            const prixAchat = p.prix_achat_kg
                || (m.prix_achat_moy.length ? m.prix_achat_moy.reduce((a,b)=>a+b,0) / m.prix_achat_moy.length : 0);
            const revenuSorties = m.sorties * Number(p.prix_kg || 0);
            const coutSorties   = m.sorties * prixAchat;
            const marge         = revenuSorties - coutSorties;
            const tauxMarge     = coutSorties > 0 ? ((marge / coutSorties) * 100).toFixed(1) : null;

            return {
                ...p,
                prix_achat_kg: prixAchat,
                total_entrees: m.entrees,
                total_sorties: m.sorties,
                cout_achat:    m.cout_achat || (m.entrees * prixAchat),
                revenu_sorties: revenuSorties,
                marge_brute:   marge,
                taux_marge:    tauxMarge ? Number(tauxMarge) : null,
            };
        });

        // ── Totaux globaux ──
        const totalAchats    = stockAvecMarge.reduce((s, p) => s + (p.cout_achat || 0), 0);
        const totalRevSortie = stockAvecMarge.reduce((s, p) => s + (p.revenu_sorties || 0), 0);
        const totalMarge     = totalRevSortie - totalAchats;
        const totalVentes    = Array.isArray(factures)
            ? factures.reduce((s, f) => s + Number(f.total_ttc || 0), 0) : 0;

        // ── Alertes expiration ──
        const today = new Date(); today.setHours(0,0,0,0);
        const alertes = stockAvecMarge.filter(p => {
            if (!p.date_expiration) return false;
            const d = new Date(p.date_expiration); d.setHours(0,0,0,0);
            return (d - today) / 86400000 <= 2;
        });

        // ── Stock par employé (qui a reçu quoi) ──
        const stockParEmploye = {};
        if (Array.isArray(mouvements)) {
            const sorties = mouvements.filter(m => m.type === "sortie");
            // On récupère les détails des sorties
        }
        const sortiesDetailRes = await fetch(
            `${URL}/rest/v1/mouvements_stock?type=eq.sortie&select=employe_id,employe_nom,produit_id,quantite`,
            { headers }
        );
        const sortiesDetail = await sbRead(sortiesDetailRes) || [];
        sortiesDetail.forEach(s => {
            const key = s.employe_id || "inconnu";
            if (!stockParEmploye[key]) stockParEmploye[key] = { nom: s.employe_nom || "Inconnu", total_kg: 0, produits: {} };
            stockParEmploye[key].total_kg += Number(s.quantite || 0);
            const pid = s.produit_id;
            stockParEmploye[key].produits[pid] = (stockParEmploye[key].produits[pid] || 0) + Number(s.quantite || 0);
        });

        return json(200, {
            stock:          stockAvecMarge,
            mouvements:     Array.isArray(mvtRecents) ? mvtRecents : [],
            employes:       Array.isArray(employes) ? employes : [],
            stock_employes: Object.values(stockParEmploye),
            totaux: {
                total_achats:      Math.round(totalAchats),
                total_rev_sorties: Math.round(totalRevSortie),
                total_marge:       Math.round(totalMarge),
                total_ventes_fact: Math.round(totalVentes),
                nb_alertes:        alertes.length,
                nb_produits:       stockAvecMarge.length,
            }
        });

    } catch (err) {
        console.error("[gerant-stats]", err.message);
        return json(500, { error: err.message });
    }
}
