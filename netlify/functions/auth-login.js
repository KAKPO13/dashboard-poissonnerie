/**
 * Netlify Function : auth-login
 * Corrigé : gestion d'erreur robuste, jamais de HTML en réponse
 */

// Helper : toujours répondre en JSON propre
function jsonResponse(statusCode, data) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(data)
    };
}

export async function handler(event) {

    // Preflight CORS
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
    }

    if (event.httpMethod !== "POST") {
        return jsonResponse(405, { error: "Méthode non autorisée" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error("[auth-login] Variables d'environnement manquantes");
        return jsonResponse(500, { error: "Configuration serveur manquante. Vérifiez SUPABASE_URL et SUPABASE_KEY dans Netlify." });
    }

    // Parser le body en sécurité
    let email, password;
    try {
        const parsed = JSON.parse(event.body || "{}");
        email    = parsed.email;
        password = parsed.password;
    } catch {
        return jsonResponse(400, { error: "Corps de requête invalide (JSON attendu)" });
    }

    if (!email || !password) {
        return jsonResponse(400, { error: "Email et mot de passe requis" });
    }

    try {
        // ── Étape 1 : Authentification Supabase Auth ──
        const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_KEY
            },
            body: JSON.stringify({ email, password })
        });

        // Lire la réponse en texte d'abord, puis parser
        const authText = await authRes.text();
        let authData;
        try {
            authData = JSON.parse(authText);
        } catch {
            console.error("[auth-login] Réponse Supabase Auth non-JSON :", authText.slice(0, 200));
            return jsonResponse(502, { error: "Réponse inattendue de Supabase Auth" });
        }

        if (!authRes.ok || !authData.access_token) {
            const msg = authData.error_description
                     || authData.msg
                     || authData.error
                     || "Identifiants incorrects";
            return jsonResponse(401, { error: msg });
        }

        const token  = authData.access_token;
        const userId = authData.user?.id;

        if (!userId) {
            return jsonResponse(500, { error: "Impossible de récupérer l'identifiant utilisateur" });
        }

        // ── Étape 2 : Récupérer le profil depuis la table utilisateurs ──
        const profileUrl = `${SUPABASE_URL}/rest/v1/utilisateurs?id=eq.${userId}&select=id,nom,email,role,actif&limit=1`;
        const profileRes = await fetch(profileUrl, {
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${token}`
            }
        });

        const profileText = await profileRes.text();
        let profiles;
        try {
            profiles = JSON.parse(profileText);
        } catch {
            console.error("[auth-login] Réponse profil non-JSON :", profileText.slice(0, 200));
            return jsonResponse(502, { error: "Impossible de lire le profil utilisateur" });
        }

        if (!profileRes.ok) {
            console.error("[auth-login] Erreur lecture profil :", profiles);
            return jsonResponse(500, { error: "Erreur lors de la lecture du profil" });
        }

        if (!Array.isArray(profiles) || profiles.length === 0) {
            return jsonResponse(403, {
                error: "Profil introuvable. Contactez votre administrateur pour activer votre compte."
            });
        }

        const profile = profiles[0];

        if (!profile.actif) {
            return jsonResponse(403, {
                error: "Votre compte est désactivé. Contactez votre administrateur."
            });
        }

        // ── Succès ──
        return jsonResponse(200, {
            token,
            userId:  profile.id,
            email:   profile.email,
            nom:     profile.nom,
            role:    profile.role,
            expires: Date.now() + ((authData.expires_in || 3600) * 1000)
        });

    } catch (err) {
        console.error("[auth-login] Erreur inattendue :", err.message);
        return jsonResponse(500, { error: "Erreur serveur : " + err.message });
    }
}
