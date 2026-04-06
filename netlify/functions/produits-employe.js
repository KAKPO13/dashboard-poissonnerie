/**
 * Netlify Function : produits-employe
 * Stock congélateur employé
 *
 * Employé connecté → voit son propre stock
 * Gérant / Admin   → peut voir le stock de n'importe quel employé
 *                    (GET ?employe_id=xxx  ou tous si pas de param)
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

async function getProfile(URL, KEY, SVC, auth) {
    const r = await fetch(`${URL}/auth/v1/user`,
        { headers: { apikey: KEY, Authorization: `Bearer ${auth}` } });
    const u = await sbRead(r);
    if (!r.ok || !u?.id) throw new Error("Token invalide");
    const pr = await fetch(
        `${URL}/rest/v1/utilisateurs?id=eq.${u.id}&select=id,nom,role,actif&limit=1`,
        { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
    const p = await sbRead(pr);
    if (!Array.isArray(p) || !p[0] || !p[0].actif) throw new Error("Profil invalide");
    return p[0];
}

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type,Authorization" }, body: "" };
    }

    const URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_KEY;
    const SVC = process.env.SUPABASE_SERVICE_KEY || KEY;
    if (!URL || !KEY) return json(500, { error: "Configuration manquante" });

    const auth = (event.headers.authorization || event.headers.Authorization || "")
        .replace("Bearer ", "").trim();
    if (!auth) return json(401, { error: "Non authentifié" });

    let profile;
    try { profile = await getProfile(URL, KEY, SVC, auth); }
    catch (e) { return json(403, { error: e.message }); }

    const h = { apikey: SVC, Authorization: `Bearer ${SVC}` };
    const params = event.queryStringParameters || {};

    try {
        if (event.httpMethod === "GET") {

            if (profile.role === "employe") {
                // L'employé voit uniquement son propre stock
                const r = await fetch(
                    `${URL}/rest/v1/v_produits_employe?employe_id=eq.${profile.id}&order=produit_nom.asc`,
                    { headers: h });
                const data = await sbRead(r) || [];
                return json(200, { employe_id: profile.id, employe_nom: profile.nom, stock: data });
            }

            if (["gerant", "admin"].includes(profile.role)) {
                if (params.employe_id) {
                    // Stock d'un employé spécifique
                    const r = await fetch(
                        `${URL}/rest/v1/v_produits_employe?employe_id=eq.${params.employe_id}&order=produit_nom.asc`,
                        { headers: h });
                    const data = await sbRead(r) || [];
                    return json(200, { employe_id: params.employe_id, stock: data });
                } else {
                    // Tous les stocks de tous les employés
                    const r = await fetch(
                        `${URL}/rest/v1/v_produits_employe?order=employe_nom.asc,produit_nom.asc`,
                        { headers: h });
                    const data = await sbRead(r) || [];
                    return json(200, { tous: true, stock: data });
                }
            }

            return json(403, { error: "Accès non autorisé" });
        }

        return json(405, { error: "Méthode non autorisée" });

    } catch (err) {
        console.error("[produits-employe]", err.message);
        return json(500, { error: err.message });
    }
}
