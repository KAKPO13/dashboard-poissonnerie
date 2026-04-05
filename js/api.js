import { CONFIG } from "./config.js";

export async function getProduits() {
    const res = await fetch(CONFIG.URL + "produits", {
        headers: {
            apikey: CONFIG.APIKEY,
            Authorization: "Bearer " + CONFIG.APIKEY
        }
    });
    return res.json();
}