/**
 * Netlify Function : produits
 * Récupère tous les produits depuis Supabase
 * Les clés API restent côté serveur (jamais exposées au frontend)
 */

export async function handler(event) {

    // Vérification des variables d'environnement
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Configuration Supabase manquante" })
        };
    }

    try {
        const res = await fetch(url + "/rest/v1/produits?select=*", {
            headers: {
                apikey: key,
                Authorization: "Bearer " + key,
                "Content-Type": "application/json"
            }
        });

        if (!res.ok) {
            throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
        }

        const data = await res.json();

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache"
            },
            body: JSON.stringify(data)
        };

    } catch (err) {
        console.error("[produits]", err.message);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: err.message })
        };
    }
}
