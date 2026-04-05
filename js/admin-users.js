/**
 * Netlify Function : admin-users
 * Réservé aux administrateurs uniquement (vérifié côté serveur)
 *
 * GET   → liste tous les utilisateurs
 * POST  → crée un nouvel utilisateur  { nom, email, password, role }
 * PATCH → modifie rôle ou statut      { userId, role? } ou { userId, actif? }
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ── Vérifie que l'appelant est un admin authentifié ──
async function verifierAdmin(event) {

    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) throw new Error("Token manquant");

    // Récupérer l'utilisateur Supabase Auth depuis le token JWT
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }
    });

    if (!userRes.ok) throw new Error("Token invalide ou expiré");

    const user = await userRes.json();

    // Vérifier son rôle dans la table utilisateurs
    const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/utilisateurs?id=eq.${user.id}&select=role,actif`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } }
    );

    const profiles = await profileRes.json();
    if (!profiles || !profiles[0]) throw new Error("Profil introuvable");
    if (profiles[0].role !== "admin") throw new Error("Accès réservé aux administrateurs");
    if (!profiles[0].actif) throw new Error("Compte désactivé");

    return { token, userId: user.id };
}

// ── Requête vers Supabase avec le service role key ──
async function supabaseFetch(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            // Utiliser la service key pour les opérations admin
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY || SUPABASE_KEY}`,
            Prefer: options.prefer || "",
            ...options.headers
        }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "Erreur Supabase");
    return data;
}

export async function handler(event) {

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Configuration manquante" }) };
    }

    // ── Vérification admin ──
    try {
        await verifierAdmin(event);
    } catch (err) {
        return { statusCode: 403, body: JSON.stringify({ error: err.message }) };
    }

    const method = event.httpMethod;

    try {

        // ════ GET : liste utilisateurs ════
        if (method === "GET") {
            const users = await supabaseFetch(
                "utilisateurs?select=id,nom,email,role,actif,created_at&order=created_at.desc"
            );
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(users)
            };
        }

        // ════ POST : créer un utilisateur ════
        if (method === "POST") {
            const { nom, email, password, role } = JSON.parse(event.body);

            if (!nom || !email || !password || !role) {
                return { statusCode: 400, body: JSON.stringify({ error: "Champs manquants" }) };
            }

            const rolesValides = ["employe", "gerant", "admin"];
            if (!rolesValides.includes(role)) {
                return { statusCode: 400, body: JSON.stringify({ error: "Rôle invalide" }) };
            }

            // 1. Créer le compte Supabase Auth (via API admin)
            const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY || SUPABASE_KEY}`
                },
                body: JSON.stringify({
                    email,
                    password,
                    email_confirm: true  // Confirmer directement sans email
                })
            });

            const authData = await authRes.json();
            if (!authRes.ok) throw new Error(authData.msg || authData.message || "Erreur création Auth");

            const newUserId = authData.id;

            // 2. Insérer le profil dans la table utilisateurs
            await supabaseFetch("utilisateurs", {
                method: "POST",
                prefer: "return=minimal",
                body: JSON.stringify({
                    id:    newUserId,
                    nom,
                    email,
                    role,
                    actif: true
                })
            });

            return {
                statusCode: 201,
                body: JSON.stringify({ success: true, userId: newUserId })
            };
        }

        // ════ PATCH : modifier rôle ou statut ════
        if (method === "PATCH") {
            const body = JSON.parse(event.body);
            const { userId, role, actif } = body;

            if (!userId) {
                return { statusCode: 400, body: JSON.stringify({ error: "userId requis" }) };
            }

            const updates = {};
            if (role !== undefined) {
                const rolesValides = ["employe", "gerant", "admin"];
                if (!rolesValides.includes(role)) {
                    return { statusCode: 400, body: JSON.stringify({ error: "Rôle invalide" }) };
                }
                updates.role = role;
            }
            if (actif !== undefined) {
                updates.actif = Boolean(actif);
            }

            if (Object.keys(updates).length === 0) {
                return { statusCode: 400, body: JSON.stringify({ error: "Aucune modification spécifiée" }) };
            }

            await supabaseFetch(`utilisateurs?id=eq.${userId}`, {
                method: "PATCH",
                prefer: "return=minimal",
                body: JSON.stringify(updates)
            });

            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }

        return { statusCode: 405, body: JSON.stringify({ error: "Méthode non autorisée" }) };

    } catch (err) {
        console.error("[admin-users]", err.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
}
