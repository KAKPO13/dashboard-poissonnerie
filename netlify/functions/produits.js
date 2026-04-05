export async function handler() {
    try {

        const url = process.env.SUPABASE_URL + "/rest/v1/produits";
        const key = process.env.SUPABASE_KEY;

        const res = await fetch(url, {
            headers: {
                apikey: key,
                Authorization: "Bearer " + key
            }
        });

        const data = await res.json();

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
}