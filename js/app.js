let chartInstance = null;

// 🐟 PRODUITS
async function loadProduits() {

    const el = document.getElementById("produits");
    el.innerHTML = "<li>Chargement...</li>";

    try {

        const res = await fetch("/.netlify/functions/produits");

        if (!res.ok) {
            throw new Error("Erreur serveur : " + res.status);
        }

        const data = await res.json();

        console.log("Produits:", data);

        if (!data || data.length === 0) {
            el.innerHTML = "<li>Aucun produit disponible</li>";
            return;
        }

        let html = "";

        data.forEach(p => {

            const nom = p.nom || "Sans nom";
            const quantite = p.quantite ?? 0;

            html += `
                <li>
                    🐟 <strong>${nom}</strong><br>
                    Stock : ${quantite} kg
                </li>
            `;
        });

        el.innerHTML = html;

    } catch (err) {

        console.error(err);
        el.innerHTML = "<li>Erreur de chargement ❌</li>";
    }
}

// 📊 GRAPH VENTES
async function loadChart() {

    try {

        const res = await fetch("/.netlify/functions/factures");

        if (!res.ok) {
            throw new Error("Erreur API factures");
        }

        const data = await res.json();

        console.log("Factures:", data);

        if (!data || data.length === 0) return;

        // 🔥 Regrouper ventes par date
        const ventesParJour = {};

        data.forEach(f => {

            const date = f.date_facture;

            if (!ventesParJour[date]) {
                ventesParJour[date] = 0;
            }

            ventesParJour[date] += Number(f.total_ttc || 0);
        });

        // 🔥 Trier les dates
        const labels = Object.keys(ventesParJour).sort();
        const valeurs = labels.map(d => ventesParJour[d]);

        const ctx = document.getElementById("chartVentes");

        // 🔥 éviter doublon graphique
        if (chartInstance) {
            chartInstance.destroy();
        }

        chartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Ventes (FCFA)",
                    data: valeurs
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true
                    }
                }
            }
        });

    } catch (err) {
        console.error("Erreur graphique:", err);
    }
}

async function loadVentes() {

    const el = document.getElementById("ventes");
    el.innerHTML = "<li>Chargement...</li>";

    try {

        const res = await fetch("/.netlify/functions/factures");

        if (!res.ok) {
            throw new Error("Erreur API");
        }

        const data = await res.json();

        console.log("Ventes:", data);

        if (!data || data.length === 0) {
            el.innerHTML = "<li>Aucune vente</li>";
            return;
        }

        let html = "";

        data.forEach(f => {

            const date = f.date_facture || "Date inconnue";
            const montant = Number(f.total_ttc || 0).toLocaleString();

            html += `
                <li>
                    📅 ${date}<br>
                    💰 <strong>${montant} FCFA</strong>
                </li>
            `;
        });

        el.innerHTML = html;

    } catch (err) {

        console.error(err);
        el.innerHTML = "<li>Erreur de chargement ❌</li>";
    }
}

// 🚀 LANCEMENT
loadProduits();
loadChart();