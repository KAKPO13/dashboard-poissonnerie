/**
 * Netlify Function : mouvements
 * Gère les entrées et sorties de stock
 *
 * ENTRÉE  → ajoute au stock chambre froide (produits.quantite)
 * SORTIE  → retire du stock chambre froide ET ajoute au stock_employe
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

    const r = await fetch(`${URL}/auth/v1/user`, {
        headers: { apikey: KEY, Authorization: `Bearer ${auth}` }
    });
    const u = await sbRead(r);
    if (!r.ok || !u?.id) throw new Error("Token invalide");

    const pr = await fetch(
        `${URL}/rest/v1/utilisateurs?id=eq.${u.id}&select=role,nom,actif&limit=1`,
        { headers: { apikey: KEY, Authorization: `Bearer ${auth}` } }
    );
    const p = await sbRead(pr);
    if (!Array.isArray(p) || !p[0]) throw new Error("Profil introuvable");
    if (!p[0].actif) throw new Error("Compte désactivé");
    if (!["gerant", "admin"].includes(p[0].role)) throw new Error("Accès réservé aux gérants");

    return { userId: u.id, role: p[0].role, nom: p[0].nom, token: auth };
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
            return json(r.ok ? 200 : r.status, r.ok ? (data || []) : { error: data?.message || "Erreur" });
        }

        // ════ POST : enregistrer un mouvement ════
        if (event.httpMethod === "POST") {
            let body;
            try { body = JSON.parse(event.body || "{}"); }
            catch { return json(400, { error: "Corps de requête invalide" }); }

            const { produit_id, type, quantite, prix_achat_kg, employe_id, employe_nom, note } = body;

            if (!produit_id) return json(400, { error: "produit_id requis" });
            if (!type || !["entree", "sortie", "ajustement"].includes(type))
                return json(400, { error: "type requis : entree, sortie ou ajustement" });
            if (!quantite || Number(quantite) <= 0)
                return json(400, { error: "quantite doit être > 0" });
            if (type === "sortie" && !employe_id)
                return json(400, { error: "employe_id requis pour une sortie" });

            const qty = Number(quantite);

            // ── Lire le stock actuel chambre froide ──
            const stockRes = await fetch(
                `${URL}/rest/v1/produits?id=eq.${produit_id}&select=id,nom,quantite&limit=1`,
                { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
            );
            const stocks = await sbRead(stockRes);
            if (!Array.isArray(stocks) || !stocks[0])
                return json(404, { error: "Produit introuvable" });

            const stockActuel = Number(stocks[0].quantite || 0);

            // ── Vérifier stock suffisant pour une sortie ──
            if (type === "sortie" && stockActuel < qty) {
                return json(400, {
                    error: `Stock chambre froide insuffisant. Disponible : ${stockActuel} kg, demandé : ${qty} kg`
                });
            }

            // ── 1. Insérer le mouvement ──
            const mvtData = {
                produit_id:    Number(produit_id),
                type,
                quantite:      qty,
                note:          note || null,
                created_by:    user.userId,
            };
            if (type === "entree" && prix_achat_kg) mvtData.prix_achat_kg = Number(prix_achat_kg);
            if (type === "sortie") {
                mvtData.employe_id  = employe_id;
                mvtData.employe_nom = employe_nom || null;
            }

            const mvtRes = await fetch(`${URL}/rest/v1/mouvements_stock`, {
                method: "POST",
                headers: { ...h, Prefer: "return=representation" },
                body: JSON.stringify(mvtData)
            });
            const mvt = await sbRead(mvtRes);
            if (!mvtRes.ok) return json(mvtRes.status, { error: mvt?.message || "Erreur insertion mouvement" });

            // ── 2. Mettre à jour stock chambre froide (produits.quantite) ──
            const delta = type === "entree" ? qty : -qty;
            const newQtyCF = Math.max(0, stockActuel + delta);
            const patchBody = { quantite: newQtyCF };
            if (type === "entree" && prix_achat_kg) patchBody.prix_achat_kg = Number(prix_achat_kg);

            await fetch(`${URL}/rest/v1/produits?id=eq.${produit_id}`, {
                method: "PATCH",
                headers: { ...h, Prefer: "return=minimal" },
                body: JSON.stringify(patchBody)
            });

            // ── 3. Si SORTIE → mettre à jour stock_employe ──
            if (type === "sortie") {

                // Vérifier si une ligne existe déjà pour ce couple (employé, produit)
                const seRes = await fetch(
                    `${URL}/rest/v1/stock_employe?employe_id=eq.${employe_id}&produit_id=eq.${produit_id}&select=id,quantite&limit=1`,
                    { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
                );
                const seRows = await sbRead(seRes);

                if (Array.isArray(seRows) && seRows.length > 0) {
                    // Ligne existante → incrémenter
                    const newQtyEmp = Number(seRows[0].quantite || 0) + qty;
                    await fetch(
                        `${URL}/rest/v1/stock_employe?employe_id=eq.${employe_id}&produit_id=eq.${produit_id}`,
                        {
                            method: "PATCH",
                            headers: { ...h, Prefer: "return=minimal" },
                            body: JSON.stringify({ quantite: newQtyEmp, updated_at: new Date().toISOString() })
                        }
                    );
                } else {
                    // Nouvelle ligne → insérer
                    await fetch(`${URL}/rest/v1/stock_employe`, {
                        method: "POST",
                        headers: { ...h, Prefer: "return=minimal" },
                        body: JSON.stringify({
                            employe_id,
                            produit_id: Number(produit_id),
                            quantite:   qty,
                            updated_at: new Date().toISOString()
                        })
                    });
                }
            }

            return json(201, {
                success:         true,
                mouvement:       Array.isArray(mvt) ? mvt[0] : mvt,
                stock_cf_restant: newQtyCF
            });
        }

        return json(405, { error: "Méthode non autorisée" });

    } catch (err) {
        console.error("[mouvements]", err.message);
        return json(500, { error: err.message });
    }
}

