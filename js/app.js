async function loadProduits() {

    const res = await fetch("/.netlify/functions/produits");
    const data = await res.json();

    console.log(data); // 🔥 IMPORTANT

    let html = "";

    data.forEach(p => {
        html += `<li>${p.nom} - ${p.quantite} kg</li>`;
    });

    document.getElementById("produits").innerHTML = html;
}

loadProduits();