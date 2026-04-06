/**
 * AquaDash – app.js
 * Dashboard employé/admin avec stocks séparés :
 * - Gérant/Admin → stock chambre froide (produits.quantite)
 * - Employé      → stock congélateur personnel (stock_employe)
 */

"use strict";

let chartInstance = null;
const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
(function init() {
    const session = Auth.getSession();
    if (!session) return;

    appliquerRestrictions(session.role);
    chargerDonnees(session);
})();

// ═══════════════════════════════════════
// RESTRICTIONS VISUELLES
// ═══════════════════════════════════════
function appliquerRestrictions(role) {
    const peutVoirFinances = Auth.peutFaire("voir_ventes");

    if (!peutVoirFinances) {
        document.getElementById("kpi-card-jour")?.classList.add("locked");
        document.getElementById("kpi-card-total")?.classList.add("locked");
    }

    if (!Auth.peutFaire("voir_graphique")) {
        const card = document.getElementById("card-chart");
        if (card) {
            card.classList.add("locked");
            card.innerHTML += `<div class="lock-overlay">🔒 Accès restreint<br><span style="font-size:.75rem">Réservé aux gérants et administrateurs</span></div>`;
        }
    }

    if (!Auth.peutFaire("voir_ventes")) {
        const card = document.getElementById("card-ventes");
        if (card) {
            card.classList.add("locked");
            card.innerHTML += `<div class="lock-overlay">🔒 Accès restreint<br><span style="font-size:.75rem">Réservé aux gérants et administrateurs</span></div>`;
        }
    }
}

// ═══════════════════════════════════════
// CHARGEMENT SELON RÔLE
// ═══════════════════════════════════════
async function chargerDonnees(session) {
    const tasks = [];

    if (session.role === "employe") {
        // L'employé voit son propre stock congélateur
        tasks.push(loadStockEmploye());
        tasks.push(loadAlertes());      // alertes basées sur son stock
    } else {
        // Gérant / Admin voit le stock chambre froide
        tasks.push(loadProduits());
        tasks.push(loadAlertes());
        if (Auth.peutFaire("voir_ventes"))    tasks.push(loadVentes());
        if (Auth.peutFaire("voir_graphique")) tasks.push(loadChart());
    }

    await Promise.allSettled(tasks);
}

// ═══════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════
function formatFCFA(n) { return Number(n||0).toLocaleString("fr-FR") + " FCFA"; }
function formatDate(iso) {
    if (!iso) return "Date inconnue";
    return new Date(iso).toLocaleDateString("fr-FR");
}
function getTodayISO() { return TODAY.toISOString().split("T")[0]; }
function diffDays(isoDate) {
    const d = new Date(isoDate); d.setHours(0,0,0,0);
    return (d - TODAY) / 86400000;
}
function esc(s) {
    return String(s||"").replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
}

async function apiFetch(endpoint, opts = {}) {
    const res = await fetch(`/.netlify/functions/${endpoint}`, {
        ...opts,
        headers: { "Content-Type":"application/json", ...Auth.getAuthHeader(), ...(opts.headers||{}) }
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("Réponse invalide du serveur"); }
    if (!res.ok) throw new Error(data.error || "Erreur " + res.status);
    return data;
}

// ═══════════════════════════════════════
// 🔵 STOCK EMPLOYÉ (congélateur personnel)
// ═══════════════════════════════════════
async function loadStockEmploye() {
    const el = document.getElementById("produits");
    const cardTitle = document.querySelector(".area-produits .card-title");
    if (cardTitle) cardTitle.innerHTML = `<div class="icon">🧊</div>Mon congélateur`;

    el.innerHTML = `<li class="empty-state"><span class="spinner"></span>Chargement…</li>`;

    try {
        const data = await apiFetch("stock-employe");
        const stock = data.stock || [];

        document.getElementById("kpi-produits").textContent   = stock.length;
        document.getElementById("badge-produits").textContent = stock.length + " produit(s)";

        if (!stock.length) {
            el.innerHTML = `<li class="empty-state">Aucun stock dans votre congélateur.<br>Contactez votre gérant pour un réapprovisionnement.</li>`;
            document.getElementById("kpi-alertes").textContent = "0";
            return;
        }

        el.innerHTML = stock.map((p, i) => {
            const stockBas = Number(p.quantite) < 3
                ? `<span style="color:#BA7517;font-size:.7rem;"> ⚠ stock bas</span>` : "";
            return `
                <li class="data-item" style="animation-delay:${i*40}ms">
                    <div class="item-left">
                        <span class="item-name">${esc(p.produit_nom)}${stockBas}</span>
                        <span class="item-sub">Réf. ${esc(p.produit_ref||"–")}</span>
                    </div>
                    <span class="item-right">${Number(p.quantite).toLocaleString("fr-FR")} kg</span>
                </li>`;
        }).join("");

        // Alertes expiration basées sur le stock de l'employé
        renderAlertesEmploye(stock);

    } catch (err) {
        console.error("[StockEmploye]", err);
        el.innerHTML = `<li class="empty-state" style="color:#A32D2D;">❌ Erreur de chargement</li>`;
    }
}

function renderAlertesEmploye(stock) {
    const el = document.getElementById("alertes");
    const alertes = stock.filter(p => {
        // Pas de date d'expiration dans stock_employe → utiliser celle du produit
        // (transmise via la vue v_stock_employe si on l'ajoute)
        return false; // placeholder — étendre si date_expiration dans v_stock_employe
    });
    document.getElementById("kpi-alertes").textContent   = alertes.length;
    document.getElementById("badge-alertes").textContent = alertes.length + " alerte(s)";
    if (!alertes.length) {
        el.innerHTML = `<div class="empty-state" style="color:#2E7D32;">✅ Aucune alerte</div>`;
    }
}

// ═══════════════════════════════════════
// 🐟 PRODUITS (stock chambre froide — gérant/admin)
// ═══════════════════════════════════════
async function loadProduits() {
    const el = document.getElementById("produits");
    el.innerHTML = `<li class="empty-state"><span class="spinner"></span>Chargement…</li>`;

    try {
        const data = await apiFetch("produits");

        document.getElementById("kpi-produits").textContent   = data.length;
        document.getElementById("badge-produits").textContent = data.length + " article(s)";

        if (!data.length) {
            el.innerHTML = `<li class="empty-state">Aucun produit disponible</li>`;
            return;
        }

        const sorted = [...data].sort((a,b) => (a.nom||"").localeCompare(b.nom||"","fr"));

        el.innerHTML = sorted.map((p, i) => {
            const stockBas = (p.quantite ?? 0) < 5
                ? `<span style="color:#BA7517;font-size:.7rem;"> ⚠ stock bas</span>` : "";
            return `
                <li class="data-item" style="animation-delay:${i*40}ms">
                    <div class="item-left">
                        <span class="item-name">${esc(p.nom||"Sans nom")}${stockBas}</span>
                        <span class="item-sub">Chambre froide</span>
                    </div>
                    <span class="item-right">${(p.quantite??0).toLocaleString("fr-FR")} kg</span>
                </li>`;
        }).join("");

    } catch (err) {
        console.error("[Produits]", err);
        el.innerHTML = `<li class="empty-state" style="color:#A32D2D;">❌ Erreur de chargement</li>`;
    }
}

// ═══════════════════════════════════════
// 💰 VENTES
// ═══════════════════════════════════════
async function loadVentes() {
    const el = document.getElementById("ventes");
    el.innerHTML = `<li class="empty-state"><span class="spinner"></span>Chargement…</li>`;

    try {
        const data = await apiFetch("factures");

        const totalAll  = data.reduce((s,f) => s + Number(f.total_ttc||0), 0);
        const totalJour = data.filter(f => f.date_facture === getTodayISO())
                              .reduce((s,f) => s + Number(f.total_ttc||0), 0);

        document.getElementById("kpi-total").textContent    = totalAll.toLocaleString("fr-FR");
        document.getElementById("kpi-jour").textContent     = totalJour.toLocaleString("fr-FR");
        document.getElementById("badge-ventes").textContent = data.length + " facture(s)";

        if (!data.length) {
            el.innerHTML = `<li class="empty-state">Aucune vente enregistrée</li>`;
            return;
        }

        const sorted = [...data].sort((a,b) =>
            new Date(b.date_facture||0) - new Date(a.date_facture||0)
        );

        el.innerHTML = sorted.map((f, i) => `
            <li class="data-item" style="animation-delay:${i*40}ms">
                <div class="item-left">
                    <span class="item-name">${esc(f.client_nom||f.nom_client||"Client inconnu")}</span>
                    <span class="item-sub">📅 ${formatDate(f.date_facture)}</span>
                </div>
                <span class="item-right">${formatFCFA(f.total_ttc||0)}</span>
            </li>`
        ).join("");

    } catch (err) {
        console.error("[Ventes]", err);
        el.innerHTML = `<li class="empty-state" style="color:#A32D2D;">❌ Erreur de chargement</li>`;
    }
}

// ═══════════════════════════════════════
// 📊 GRAPHIQUE
// ═══════════════════════════════════════
async function loadChart() {
    try {
        const data = await apiFetch("factures");
        if (!data.length) return;

        const ventesParJour = {};
        data.forEach(f => {
            const d = f.date_facture; if (!d) return;
            ventesParJour[d] = (ventesParJour[d]||0) + Number(f.total_ttc||0);
        });

        const labels        = Object.keys(ventesParJour).sort();
        const valeurs       = labels.map(d => ventesParJour[d]);
        const labelsAffich  = labels.map(formatDate);

        const canvas = document.getElementById("chartVentes");
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

        chartInstance = new Chart(canvas, {
            type: "bar",
            data: {
                labels: labelsAffich,
                datasets: [{
                    label: "Ventes (FCFA)",
                    data: valeurs,
                    backgroundColor: valeurs.map((_, i) =>
                        i === valeurs.length - 1 ? "rgba(255,107,26,1)" : "rgba(255,107,26,0.25)"),
                    borderColor: "rgba(255,107,26,0.8)",
                    borderWidth: 1.5, borderRadius: 6, borderSkipped: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 500 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: c => " " + formatFCFA(c.parsed.y) }
                    }
                },
                scales: {
                    x: { ticks: { color:"#888880", font:{size:11} }, grid: { color:"rgba(232,224,216,0.5)" } },
                    y: {
                        ticks: { color:"#888880", font:{size:11}, callback: v => (v/1000).toFixed(0)+"k" },
                        grid: { color:"rgba(232,224,216,0.5)" }
                    }
                }
            }
        });
    } catch (err) { console.error("[Graphique]", err); }
}

// ═══════════════════════════════════════
// ⚠️ ALERTES EXPIRATION (chambre froide)
// ═══════════════════════════════════════
async function loadAlertes() {
    const el = document.getElementById("alertes");
    el.innerHTML = `<div class="empty-state"><span class="spinner"></span>Chargement…</div>`;

    try {
        const data = await apiFetch("produits");
        const alertes = [];

        data.forEach(p => {
            if (!p.date_expiration) return;
            const diff = diffDays(p.date_expiration);
            if      (diff < 0) alertes.push({ ...p, diff, type:"red",    label:"Expiré" });
            else if (diff < 1) alertes.push({ ...p, diff, type:"orange", label:"Aujourd'hui" });
            else if (diff < 2) alertes.push({ ...p, diff, type:"yellow", label:"Demain" });
        });

        document.getElementById("kpi-alertes").textContent   = alertes.length;
        document.getElementById("badge-alertes").textContent = alertes.length + " alerte(s)";

        if (!alertes.length) {
            el.innerHTML = `<div class="empty-state" style="color:#2E7D32;">✅ Aucune alerte d'expiration</div>`;
            return;
        }

        const ordre = { red:0, orange:1, yellow:2 };
        alertes.sort((a,b) => ordre[a.type] - ordre[b.type]);

        el.innerHTML = alertes.map((p, i) => `
            <div class="alert-item" style="animation-delay:${i*50}ms">
                <div class="alert-dot ${p.type}"></div>
                <div>
                    <div class="alert-name">${esc(p.nom||"Produit inconnu")}</div>
                    <div class="alert-date">Expiration : ${formatDate(p.date_expiration)}</div>
                </div>
                <span class="alert-badge ${p.type}">${p.label}</span>
            </div>`
        ).join("");

    } catch (err) {
        console.error("[Alertes]", err);
        el.innerHTML = `<div class="empty-state" style="color:#A32D2D;">❌ Erreur de chargement</div>`;
    }
}
