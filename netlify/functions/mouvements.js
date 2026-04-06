/**
 * Netlify Function : mouvements
 * Gère les mouvements de stock
 *
 * ENTRÉE  → ajoute à produits_cf (chambre froide)
 * SORTIE  → retire de produits_cf ET ajoute à produits_employe
 *
 * GET  → liste des mouvements
 * POST → enregistre un mouvement
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
    try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; }
}

async function verifierToken(event, URL, KEY) {
    const auth = (event.headers.authorization || event.headers.Authorization || "")
        .replace("Bearer ", "").trim();
    if (!auth) throw new Error("Token manquant");
    const r  = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${auth}` } });
    const u  = await sbRead(r);
    if (!r.ok || !u?.id) throw new Error("Token invalide");
    const pr = await fetch(`${URL}/rest/v1/utilisateurs?id=eq.${u.id}&select=role,nom,actif&limit=1`,
        { headers: { apikey: KEY, Authorization: `Bearer ${auth}` } });
    const p  = await sbRead(pr);
    if (!Array.isArray(p) || !p[0]) throw new Error("Profil introuvable");
    if (!p[0].actif) throw new Error("Compte désactivé");
    if (!["gerant", "admin"].includes(p[0].role)) throw new Error("Accès réservé aux gérants");
    return { userId: u.id, role: p[0].role, nom: p[0].nom };
}

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type,Authorization" }, body: "" };
    }

    const URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_KEY;
    const SVC = process.env.SUPABASE_SERVICE_KEY || KEY;
    if (!URL || !KEY) return json(500, { error: "Configuration manquante" });

    let user;
    try { user = await verifierToken(event, URL, KEY); }
    catch (e) { return json(403, { error: e.message }); }

    const h = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };

    try {

        // ════ GET : liste des mouvements ════
        if (event.httpMethod === "GET") {
            const params = event.queryStringParameters || {};
            let query = `${URL}/rest/v1/v_mouvements_detail?order=created_at.desc`;
            if (params.limit) query += `&limit=${parseInt(params.limit)}`;
            if (params.type)  query += `&type=eq.${params.type}`;
            const r = await fetch(query, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
            const data = await sbRead(r);
            return json(r.ok ? 200 : 500, r.ok ? (data || []) : { error: "Erreur" });
        }

        // ════ POST : enregistrer un mouvement ════
        if (event.httpMethod === "POST") {
            let body;
            try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Corps invalide" }); }

            const { produit_id, type, quantite, prix_achat_kg, employe_id, employe_nom, note } = body;

            if (!produit_id) return json(400, { error: "produit_id requis" });
            if (!["entree", "sortie", "ajustement"].includes(type))
                return json(400, { error: "type requis : entree, sortie ou ajustement" });
            if (!quantite || Number(quantite) <= 0)
                return json(400, { error: "quantite > 0 requis" });
            if (type === "sortie" && !employe_id)
                return json(400, { error: "employe_id requis pour une sortie" });

            const qty = Number(quantite);

            // ── Lire le produit dans produits_cf ──
            const cfRes = await fetch(
                `${URL}/rest/v1/produits_cf?id=eq.${produit_id}&select=id,nom,reference,quantite,prix_vente_kg&limit=1`,
                { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
            );
            const cfRows = await sbRead(cfRes);
            if (!Array.isArray(cfRows) || !cfRows[0])
                return json(404, { error: "Produit chambre froide introuvable" });

            const produitCF = cfRows[0];
            const stockCF   = Number(produitCF.quantite || 0);

            // ── Vérifier stock suffisant pour sortie ──
            if (type === "sortie" && stockCF < qty) {
                return json(400, {
                    error: `Stock chambre froide insuffisant. Disponible : ${stockCF} kg, demandé : ${qty} kg`
                });
            }

            // ── 1. Insérer le mouvement ──
            const mvtData = {
                produit_id:  Number(produit_id),
                type, quantite: qty,
                note: note || null,
                created_by: user.userId,
            };
            if (type === "entree" && prix_achat_kg) mvtData.prix_achat_kg = Number(prix_achat_kg);
            if (type === "sortie") { mvtData.employe_id = employe_id; mvtData.employe_nom = employe_nom || null; }

            const mvtRes = await fetch(`${URL}/rest/v1/mouvements_stock`, {
                method: "POST",
                headers: { ...h, Prefer: "return=minimal" },
                body: JSON.stringify(mvtData)
            });
            if (!mvtRes.ok) {
                const err = await sbRead(mvtRes);
                return json(mvtRes.status, { error: err?.message || "Erreur insertion mouvement" });
            }

            // ── 2. Mettre à jour produits_cf (chambre froide) ──
            const delta     = type === "entree" ? qty : -qty;
            const newQtyCF  = Math.max(0, stockCF + delta);
            const patchCF   = { quantite: newQtyCF, updated_at: new Date().toISOString() };
            if (type === "entree" && prix_achat_kg) patchCF.prix_achat_kg = Number(prix_achat_kg);

            await fetch(`${URL}/rest/v1/produits_cf?id=eq.${produit_id}`, {
                method: "PATCH",
                headers: { ...h, Prefer: "return=minimal" },
                body: JSON.stringify(patchCF)
            });

            // ── 3. Si SORTIE → mettre à jour produits_employe ──
            if (type === "sortie") {
                // Chercher si une ligne existe déjà pour (employe, produit)
                const peRes = await fetch(
                    `${URL}/rest/v1/produits_employe?employe_id=eq.${employe_id}&produit_cf_id=eq.${produit_id}&select=id,quantite&limit=1`,
                    { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
                );
                const peRows = await sbRead(peRes);

                if (Array.isArray(peRows) && peRows.length > 0) {
                    // Incrémenter le stock existant
                    const newQtyEmp = Number(peRows[0].quantite || 0) + qty;
                    await fetch(
                        `${URL}/rest/v1/produits_employe?employe_id=eq.${employe_id}&produit_cf_id=eq.${produit_id}`,
                        {
                            method: "PATCH",
                            headers: { ...h, Prefer: "return=minimal" },
                            body: JSON.stringify({ quantite: newQtyEmp, updated_at: new Date().toISOString() })
                        }
                    );
                } else {
                    // Créer une nouvelle ligne dans produits_employe
                    await fetch(`${URL}/rest/v1/produits_employe`, {
                        method: "POST",
                        headers: { ...h, Prefer: "return=minimal" },
                        body: JSON.stringify({
                            employe_id,
                            produit_cf_id: Number(produit_id),
                            nom:           produitCF.nom,
                            reference:     produitCF.reference || null,
                            quantite:      qty,
                            prix_vente_kg: produitCF.prix_vente_kg || null,
                            updated_at:    new Date().toISOString()
                        })
                    });
                }
            }

            return json(201, {
                success:          true,
                stock_cf_restant: newQtyCF,
                type,
                quantite:         qty
            });
        }

        return json(405, { error: "Méthode non autorisée" });

    } catch (err) {
        console.error("[mouvements]", err.message);
        return json(500, { error: err.message });
    }
}


