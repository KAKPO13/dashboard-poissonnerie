/**
 * Netlify Function : mouvements
 * Gère les entrées et sorties de stock de la chambre froide
 * GET    → liste des mouvements (avec filtres)
 * POST   → enregistre un mouvement + met à jour le stock produit
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

// Vérifie token et retourne { userId, role }
async function verifierToken(event, URL, KEY) {
    const auth = (event.headers.authorization || event.headers.Authorization || "").replace("Bearer ", "").trim();
    if (!auth) throw new Error("Token manquant");

    const r = await fetch(`${URL}/auth/v1/user`, {
        headers: { apikey: KEY, Authorization: `Bearer ${auth}` }
    });
    const u = await sbRead(r);
    if (!r.ok || !u?.id) throw new Error("Token invalide");

    const pr = await fetch(`${URL}/rest/v1/utilisateurs?id=eq.${u.id}&select=role,nom,actif&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${auth}` }
    });
    const p = await sbRead(pr);
    if (!Array.isArray(p) || !p[0]) throw new Error("Profil introuvable");
    if (!p[0].actif) throw new Error("Compte désactivé");

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

    // Seuls gérant et admin peuvent gérer les mouvements
    if (!["gerant", "admin"].includes(user.role)) {
        return json(403, { error: "Accès réservé aux gérants et administrateurs" });
    }

    try {

        // ════ GET : liste des mouvements ════
        if (event.httpMethod === "GET") {
            const params = event.queryStringParameters || {};
            let query = `${URL}/rest/v1/v_mouvements_detail?order=created_at.desc`;
            if (params.limit) query += `&limit=${parseInt(params.limit)}`;
            if (params.type)  query += `&type=eq.${params.type}`;

            const r = await fetch(query, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
            const data = await sbRead(r);
            if (!r.ok) return json(r.status, { error: data?.message || "Erreur lecture mouvements" });
            return json(200, data || []);
        }

        // ════ POST : enregistrer un mouvement ════
        if (event.httpMethod === "POST") {
            let body;
            try { body = JSON.parse(event.body || "{}"); }
            catch { return json(400, { error: "Corps de requête invalide" }); }

            const { produit_id, type, quantite, prix_achat_kg, employe_id, employe_nom, note } = body;

            // Validations
            if (!produit_id) return json(400, { error: "produit_id requis" });
            if (!type || !["entree", "sortie", "ajustement"].includes(type)) {
                return json(400, { error: "type requis : entree, sortie ou ajustement" });
            }
            if (!quantite || Number(quantite) <= 0) {
                return json(400, { error: "quantite doit être > 0" });
            }
            if (type === "sortie" && !employe_id) {
                return json(400, { error: "employe_id requis pour une sortie" });
            }

            // 1. Vérifier le stock actuel si c'est une sortie
            if (type === "sortie") {
                const stockRes = await fetch(
                    `${URL}/rest/v1/produits?id=eq.${produit_id}&select=quantite,nom&limit=1`,
                    { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
                );
                const stocks = await sbRead(stockRes);
                if (!Array.isArray(stocks) || !stocks[0]) {
                    return json(404, { error: "Produit introuvable" });
                }
                if (Number(stocks[0].quantite) < Number(quantite)) {
                    return json(400, {
                        error: `Stock insuffisant. Disponible : ${stocks[0].quantite} kg, demandé : ${quantite} kg`
                    });
                }
            }

            // 2. Insérer le mouvement
            const mvtData = {
                produit_id:    Number(produit_id),
                type,
                quantite:      Number(quantite),
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
                headers: {
                    "Content-Type": "application/json",
                    apikey: SVC, Authorization: `Bearer ${SVC}`,
                    Prefer: "return=representation"
                },
                body: JSON.stringify(mvtData)
            });
            const mvt = await sbRead(mvtRes);
            if (!mvtRes.ok) return json(mvtRes.status, { error: mvt?.message || "Erreur insertion mouvement" });

            // 3. Mettre à jour la quantité dans la table produits
            const delta = type === "entree" ? Number(quantite) : -Number(quantite);
            const updateRes = await fetch(
                `${URL}/rest/v1/produits?id=eq.${produit_id}`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        apikey: SVC, Authorization: `Bearer ${SVC}`,
                        Prefer: "return=minimal"
                    },
                    // Incrémenter / décrémenter via RPC n'est pas dispo en REST simple :
                    // On récupère d'abord la valeur actuelle puis on patch
                    body: JSON.stringify({ quantite: delta }) // sera remplacé ci-dessous
                }
            );

            // Patch correct : lire quantite actuelle puis écrire nouvelle valeur
            const curRes = await fetch(
                `${URL}/rest/v1/produits?id=eq.${produit_id}&select=quantite&limit=1`,
                { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
            );
            const cur = await sbRead(curRes);
            const newQty = Math.max(0, Number(cur?.[0]?.quantite || 0) + delta);

            const patchBody = { quantite: newQty };
            // Si entrée avec prix achat, mettre à jour aussi prix_achat_kg
            if (type === "entree" && prix_achat_kg) patchBody.prix_achat_kg = Number(prix_achat_kg);

            await fetch(`${URL}/rest/v1/produits?id=eq.${produit_id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    apikey: SVC, Authorization: `Bearer ${SVC}`,
                    Prefer: "return=minimal"
                },
                body: JSON.stringify(patchBody)
            });

            return json(201, { success: true, mouvement: Array.isArray(mvt) ? mvt[0] : mvt, new_quantite: newQty });
        }

        return json(405, { error: "Méthode non autorisée" });

    } catch (err) {
        console.error("[mouvements]", err.message);
        return json(500, { error: err.message });
    }
}
