/**
 * AquaDash – app.js
 * Dashboard avec contrôle d'accès par rôle
 * Dépendance : js/auth.js (doit être chargé avant)
 */

"use strict";

let chartInstance = null;

const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

// ═══════════════════════════════════════
// INIT & CONTRÔLE D'ACCÈS
// ═══════════════════════════════════════

(function init() {
    // Session déjà vérifiée par index.html — on charge juste les données
    const session = Auth.getSession();
    if (!session) return;

    // Appliquer les restrictions visuelles selon le rôle
    appliquerRestrictions(session.role);

    // Charger les données autorisées
    chargerDonnees(session);
})();

/**
 * Applique les restrictions d'affichage selon le rôle
 */
function appliquerRestrictions(role) {
    const peutVoirFinances = Auth.peutFaire("voir_ventes");

    // Bannière info si rôle restreint
    if (role === "employe") {
        document.getElementById("access-banner").classList.add("visible");
    }

    // Verrouiller KPIs financiers pour les employés
    if (!peutVoirFinances) {
        document.getElementById("kpi-card-jour").classList.add("locked");
        document.getElementById("kpi-card-total").classList.add("locked");
    }

    // Verrouiller graphique ventes
    if (!Auth.peutFaire("voir_graphique")) {
        const card = document.getElementById("card-chart");
        card.classList.add("locked");
        card.innerHTML += `<div class="lock-overlay">🔒 Accès restreint<br><span style="font-size:0.75rem">Réservé aux gérants et administrateurs</span></div>`;
    }

    // Verrouiller historique ventes
    if (!Auth.peutFaire("voir_ventes")) {
        const card = document.getElementById("card-ventes");
        card.classList.add("locked");
        card.innerHTML += `<div class="lock-overlay">🔒 Accès restreint<br><span style="font-size:0.75rem">Réservé aux gérants et administrateurs</span></div>`;
    }
}

/**
 * Lance les chargements autorisés selon le rôle
 */
async function chargerDonnees(session) {
    const tasks = [loadProduits(), loadAlertes()];

    if (Auth.peutFaire("voir_ventes"))   tasks.push(loadVentes());
    if (Auth.peutFaire("voir_graphique")) tasks.push(loadChart());

    await Promise.allSettled(tasks);
}

// ═══════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════

function formatFCFA(amount) {
    return Number(amount).toLocaleString("fr-FR") + " FCFA";
}

function formatDate(isoString) {
    if (!isoString) return "Date inconnue";
    return new Date(isoString).toLocaleDateString("fr-FR");
}

function getTodayISO() {
    return TODAY.toISOString().split("T")[0];
}

function diffDays(isoDate) {
    const d = new Date(isoDate); d.setHours(0,0,0,0);
    return (d - TODAY) / (1000 * 60 * 60 * 24);
}

async function apiFetch(endpoint) {
    const headers = Auth.getAuthHeader(); // token JWT dans Authorization
    const res = await fetch(`/.netlify/functions/${endpoint}`, { headers });
    if (!res.ok) throw new Error(`Erreur ${res.status} sur /${endpoint}`);
    return res.json();
}

// ═══════════════════════════════════════
// 🐟 PRODUITS
// ═══════════════════════════════════════

async function loadProduits() {
    const el = document.getElementById("produits");
    el.innerHTML = `<li class="empty-state"><span class="spinner"></span>Chargement…</li>`;

    try {
        const data = await apiFetch("produits");

        document.getElementById("kpi-produits").textContent  = data.length;
        document.getElementById("badge-produits").textContent = data.length + " article(s)";

        if (!data.length) {
            el.innerHTML = `<li class="empty-state">Aucun produit disponible</li>`;
            return;
        }

        const sorted = [...data].sort((a,b) => (a.nom||"").localeCompare(b.nom||"", "fr"));

        el.innerHTML = sorted.map((p, i) => {
            const stockBas = (p.quantite ?? 0) < 5
                ? `<span style="color:var(--warn);font-size:0.7rem;"> ⚠ stock bas</span>` : "";
            return `
                <li class="data-item" style="animation-delay:${i*40}ms">
                    <div class="item-left">
                        <span class="item-name">${esc(p.nom || "Sans nom")}${stockBas}</span>
                        <span class="item-sub">Stock disponible</span>
                    </div>
                    <span class="item-right">${p.quantite ?? 0} kg</span>
                </li>`;
        }).join("");

    } catch (err) {
        console.error("[Produits]", err);
        el.innerHTML = `<li class="empty-state" style="color:var(--danger);">❌ Erreur de chargement</li>`;
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
                    <span class="item-name">${esc(f.client_nom || f.nom_client || "Client inconnu")}</span>
                    <span class="item-sub">📅 ${formatDate(f.date_facture)}</span>
                </div>
                <span class="item-right">${formatFCFA(f.total_ttc||0)}</span>
            </li>`
        ).join("");

    } catch (err) {
        console.error("[Ventes]", err);
        el.innerHTML = `<li class="empty-state" style="color:var(--danger);">❌ Erreur de chargement</li>`;
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

        const labels  = Object.keys(ventesParJour).sort();
        const valeurs = labels.map(d => ventesParJour[d]);
        const labelsAffich = labels.map(formatDate);

        const canvas = document.getElementById("chartVentes");
        const ctx    = canvas.getContext("2d");

        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

        const gradient = ctx.createLinearGradient(0, 0, 0, 220);
        gradient.addColorStop(0, "rgba(0,201,167,0.85)");
        gradient.addColorStop(1, "rgba(0,112,243,0.4)");

        chartInstance = new Chart(canvas, {
            type: "bar",
            data: {
                labels: labelsAffich,
                datasets: [{
                    label: "Ventes (FCFA)",
                    data: valeurs,
                    backgroundColor: gradient,
                    borderColor: "rgba(0,201,167,0.9)",
                    borderWidth: 1, borderRadius: 6, borderSkipped: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 600, easing: "easeOutQuart" },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#1e2530", titleColor: "#8b949e", bodyColor: "#e6edf3",
                        borderColor: "rgba(255,255,255,0.07)", borderWidth: 1, padding: 10,
                        callbacks: { label: c => " " + formatFCFA(c.parsed.y) }
                    }
                },
                scales: {
                    x: { ticks: { color: "#8b949e", font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.04)" } },
                    y: {
                        ticks: { color: "#8b949e", font: { size: 11 }, callback: v => (v/1000).toFixed(0)+"k" },
                        grid: { color: "rgba(255,255,255,0.06)" }
                    }
                }
            }
        });

    } catch (err) { console.error("[Graphique]", err); }
}

// ═══════════════════════════════════════
// ⚠️ ALERTES EXPIRATION
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
            if      (diff < 0) alertes.push({ ...p, diff, type: "red",    label: "Expiré" });
            else if (diff < 1) alertes.push({ ...p, diff, type: "orange", label: "Aujourd'hui" });
            else if (diff < 2) alertes.push({ ...p, diff, type: "yellow", label: "Demain" });
        });

        document.getElementById("kpi-alertes").textContent   = alertes.length;
        document.getElementById("badge-alertes").textContent  = alertes.length + " alerte(s)";

        if (!alertes.length) {
            el.innerHTML = `<div class="empty-state" style="color:var(--accent);">✅ Aucune alerte d'expiration</div>`;
            return;
        }

        const ordre = { red:0, orange:1, yellow:2 };
        alertes.sort((a,b) => ordre[a.type] - ordre[b.type]);

        el.innerHTML = alertes.map((p, i) => `
            <div class="alert-item" style="animation-delay:${i*50}ms">
                <div class="alert-dot ${p.type}"></div>
                <div>
                    <div class="alert-name">${esc(p.nom || "Produit inconnu")}</div>
                    <div class="alert-date">Expiration : ${formatDate(p.date_expiration)}</div>
                </div>
                <span class="alert-badge ${p.type}">${p.label}</span>
            </div>`
        ).join("");

    } catch (err) {
        console.error("[Alertes]", err);
        el.innerHTML = `<div class="empty-state" style="color:var(--danger);">❌ Erreur de chargement</div>`;
    }
}

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
function esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
}
