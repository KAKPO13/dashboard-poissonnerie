/**
 * Netlify Function : stock-employe
 * Retourne le stock du congélateur de l'employé connecté
 * Chaque employé ne voit QUE son propre stock
 *
 * GET → stock de l'employé connecté
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

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type,Authorization" }, body: "" };
    }

    const URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_KEY;
    const SVC = process.env.SUPABASE_SERVICE_KEY || KEY;

    if (!URL || !KEY) return json(500, { error: "Configuration manquante" });

    // ── Identifier l'utilisateur connecté ──
    const auth = (event.headers.authorization || event.headers.Authorization || "")
        .replace("Bearer ", "").trim();
    if (!auth) return json(401, { error: "Non authentifié" });

    const userRes = await fetch(`${URL}/auth/v1/user`, {
        headers: { apikey: KEY, Authorization: `Bearer ${auth}` }
    });
    const user = await sbRead(userRes);
    if (!userRes.ok || !user?.id) return json(401, { error: "Token invalide" });

    // ── Récupérer son profil ──
    const profileRes = await fetch(
        `${URL}/rest/v1/utilisateurs?id=eq.${user.id}&select=id,nom,role,actif&limit=1`,
        { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
    );
    const profiles = await sbRead(profileRes);
    if (!Array.isArray(profiles) || !profiles[0]) return json(403, { error: "Profil introuvable" });
    if (!profiles[0].actif) return json(403, { error: "Compte désactivé" });

    const profile = profiles[0];

    // ── Selon le rôle, retourner le bon stock ──
    try {

        if (profile.role === "employe") {
            // L'employé voit uniquement son stock congélateur
            const stockRes = await fetch(
                `${URL}/rest/v1/v_stock_employe?employe_id=eq.${profile.id}&order=produit_nom.asc`,
                { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
            );
            const stock = await sbRead(stockRes) || [];
            return json(200, { role: "employe", employe_nom: profile.nom, stock });
        }

        if (profile.role === "gerant" || profile.role === "admin") {
            // Le gérant/admin voit tous les stocks employés
            const stockRes = await fetch(
                `${URL}/rest/v1/v_stock_employe?order=employe_nom.asc,produit_nom.asc`,
                { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }
            );
            const stock = await sbRead(stockRes) || [];
            return json(200, { role: profile.role, stock });
        }

        return json(403, { error: "Rôle non reconnu" });

    } catch (err) {
        console.error("[stock-employe]", err.message);
        return json(500, { error: err.message });
    }
}