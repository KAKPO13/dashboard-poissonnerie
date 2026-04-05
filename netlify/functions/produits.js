/**
 * Netlify Function : produits
 * Corrigé : toujours JSON en retour, jamais de HTML
 */

function jsonResponse(statusCode, data) {
    return {
        statusCode,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(data)
    };
}

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return jsonResponse(500, { error: "Configuration manquante : SUPABASE_URL ou SUPABASE_KEY absent" });
    }

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/produits?select=*`, {
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`
            }
        });

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.error("[produits] Réponse non-JSON :", text.slice(0, 300));
            return jsonResponse(502, { error: "Réponse inattendue de Supabase" });
        }

        if (!res.ok) {
            console.error("[produits] Erreur Supabase :", data);
            return jsonResponse(res.status, { error: data.message || "Erreur Supabase" });
        }

        return jsonResponse(200, data);

    } catch (err) {
        console.error("[produits] Erreur :", err.message);
        return jsonResponse(500, { error: err.message });
    }
}
