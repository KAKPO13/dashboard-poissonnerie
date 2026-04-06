/**
 * AquaDash – app.js
 *
 * STOCKS SÉPARÉS :
 *   produits          → chambre froide du gérant
 *   produits_employe  → congélateur de chaque employé
 *
 * ACCÈS :
 *   employe → voit son stock congélateur (produits_employe)
 *   gerant  → voit stock chambre froide + peut consulter n'importe quel employé
 *   admin   → identique gérant
 */

"use strict";

let chartInstance = null;
const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
(function init() {
    const session = Auth.getSession();
    if (!session) return;

    appliquerRestrictions(session.role);

    // Lire le paramètre ?vue_employe=UUID dans l'URL
    // Permet au gérant de consulter le dashboard d'un employé
    const params      = new URLSearchParams(window.location.search);
    const vueEmployeId = params.get("vue_employe");

    if (vueEmployeId && ["gerant","admin"].includes(session.role)) {
        // Gérant consulte le dashboard d'un employé précis
        afficherBanniereVueEmploye(vueEmployeId);
        chargerStockEmploye(vueEmployeId);
    } else if (session.role === "employe") {
        // Employé voit son propre congélateur
        chargerStockEmploye(null);
    } else {
        // Gérant/admin voit la chambre froide + ventes
        chargerDonneesGerant(session);
    }
})();

// ══════════════════════════════════════
// RESTRICTIONS VISUELLES
// ══════════════════════════════════════
function appliquerRestrictions(role) {
    if (!Auth.peutFaire("voir_ventes")) {
        document.getElementById("kpi-card-jour")?.classList.add("locked");
        document.getElementById("kpi-card-total")?.classList.add("locked");
    }
    if (!Auth.peutFaire("voir_graphique")) {
        lockCard("card-chart", "Réservé aux gérants et administrateurs");
    }
    if (!Auth.peutFaire("voir_ventes")) {
        lockCard("card-ventes", "Réservé aux gérants et administrateurs");
    }
}

function lockCard(id, msg) {
    const card = document.getElementById(id);
    if (!card) return;
    card.classList.add("locked");
    card.innerHTML += `<div class="lock-overlay">🔒 Accès restreint<br><span style="font-size:.75rem">${msg}</span></div>`;
}

// ══════════════════════════════════════
// BANNIÈRE : gérant consulte un employé
// ══════════════════════════════════════
function afficherBanniereVueEmploye(employeId) {
    // Remplacer la bannière access-banner par une bannière de contexte
    const banner = document.getElementById("access-banner");
    if (!banner) return;
    banner.innerHTML = `
        👁️ Vous consultez le stock d'un employé.
        <a href="index.html" style="margin-left:12px;color:inherit;font-weight:600;text-decoration:underline;">
            ← Retour chambre froide
        </a>`;
    banner.classList.add("visible");
    banner.style.background = "#E1F5EE";
    banner.style.color      = "#0F6E56";
    banner.style.borderColor= "rgba(15,110,86,0.25)";
}

// ══════════════════════════════════════
// CHARGEMENT STOCK EMPLOYÉ (congélateur)
// Utilisé par : l'employé lui-même + gérant en vue déléguée
// ══════════════════════════════════════
async function chargerStockEmploye(employeId) {
    // Adapter les titres des cards
    const titreCard = document.querySelector(".area-produits .card-title");
    if (titreCard) titreCard.innerHTML = `<div class="icon">🧊</div>Stock congélateur`;

    // Masquer les sections financières non pertinentes
    document.getElementById("card-chart")  ?.style.setProperty("display","none");
    document.getElementById("card-ventes") ?.style.setProperty("display","none");
    document.getElementById("kpi-card-jour")  ?.style.setProperty("display","none");
    document.getElementById("kpi-card-total") ?.style.setProperty("display","none");

    const el = document.getElementById("produits");
    el.innerHTML = `<li class="empty-state"><span class="spinner"></span>Chargement…</li>`;

    try {
        const endpoint = employeId
            ? `produits-employe?employe_id=${employeId}`
            : "produits-employe";

        const data = await apiFetch(endpoint);
        const produits = data.produits || [];

        // Afficher le nom de l'employé consulté si vue gérant
        if (employeId && data.employe_nom) {
            const titreEl = document.querySelector(".area-produits .card-title");
            if (titreEl) titreEl.innerHTML = `<div class="icon">🧊</div>Congélateur — ${esc(data.employe_nom)}`;
        }

        document.getElementById("kpi-produits").textContent   = produits.length;
        document.getElementById("badge-produits").textContent = produits.length + " produit(s)";

        if (!produits.length) {
            el.innerHTML = `<li class="empty-state">
                Congélateur vide.<br>
                ${!employeId ? "Contactez votre gérant pour un réapprovisionnement." : "Aucun stock transféré à cet employé."}
            </li>`;
            document.getElementById("kpi-alertes").textContent   = "0";
            document.getElementById("badge-alertes").textContent = "0 alerte(s)";
            document.getElementById("alertes").innerHTML = `<div class="empty-state" style="color:#2E7D32">✅ Aucune alerte</div>`;
            return;
        }

        const sorted = [...produits].sort((a,b)=>(a.nom||"").localeCompare(b.nom||"","fr"));

        el.innerHTML = sorted.map((p, i) => {
            const qty = Number(p.quantite || 0);
            const stockBas = qty < 3
                ? `<span style="color:#BA7517;font-size:.7rem;"> ⚠ bas</span>` : "";
            return `
                <li class="data-item" style="animation-delay:${i*40}ms">
                    <div class="item-left">
                        <span class="item-name">${esc(p.nom)}${stockBas}</span>
                        <span class="item-sub">Réf. ${esc(p.reference||"–")}</span>
                    </div>
                    <span class="item-right">${qty.toLocaleString("fr-FR")} kg</span>
                </li>`;
        }).join("");

        // Alertes expiration
        loadAlertesEmploye(produits);

    } catch(err) {
        console.error("[StockEmploye]", err);
        el.innerHTML = `<li class="empty-state" style="color:#A32D2D;">❌ ${err.message}</li>`;
    }
}

function loadAlertesEmploye(produits) {
    const el = document.getElementById("alertes");
    const alertes = [];

    produits.forEach(p => {
        if (!p.date_expiration) return;
        const diff = diffDays(p.date_expiration);
        if      (diff < 0) alertes.push({ ...p, diff, type:"red",    label:"Expiré" });
        else if (diff < 1) alertes.push({ ...p, diff, type:"orange", label:"Aujourd'hui" });
        else if (diff < 2) alertes.push({ ...p, diff, type:"yellow", label:"Demain" });
    });

    document.getElementById("kpi-alertes").textContent   = alertes.length;
    document.getElementById("badge-alertes").textContent = alertes.length + " alerte(s)";

    if (!alertes.length) {
        el.innerHTML = `<div class="empty-state" style="color:#2E7D32">✅ Aucune alerte d'expiration</div>`;
        return;
    }

    const ordre = { red:0, orange:1, yellow:2 };
    alertes.sort((a,b) => ordre[a.type] - ordre[b.type]);

    el.innerHTML = alertes.map((p,i) => `
        <div class="alert-item" style="animation-delay:${i*50}ms">
            <div class="alert-dot ${p.type}"></div>
            <div>
                <div class="alert-name">${esc(p.nom)}</div>
                <div class="alert-date">Expiration : ${formatDate(p.date_expiration)}</div>
            </div>
            <span class="alert-badge ${p.type}">${p.label}</span>
        </div>`
    ).join("");
}

// ══════════════════════════════════════
// CHARGEMENT DONNÉES GÉRANT/ADMIN
// ══════════════════════════════════════
async function chargerDonneesGerant(session) {
    const tasks = [loadProduitsCF(), loadAlertesCF()];
    if (Auth.peutFaire("voir_ventes"))    tasks.push(loadVentes());
    if (Auth.peutFaire("voir_graphique")) tasks.push(loadChart());
    await Promise.allSettled(tasks);
}

// ── Stock chambre froide ──
async function loadProduitsCF() {
    const el = document.getElementById("produits");
    const titreCard = document.querySelector(".area-produits .card-title");
    if (titreCard) titreCard.innerHTML = `<div class="icon">🧊</div>Chambre froide`;

    el.innerHTML = `<li class="empty-state"><span class="spinner"></span>Chargement…</li>`;

    try {
        const data = await apiFetch("produits");
        document.getElementById("kpi-produits").textContent   = data.length;
        document.getElementById("badge-produits").textContent = data.length + " produit(s)";

        if (!data.length) {
            el.innerHTML = `<li class="empty-state">Aucun produit en chambre froide</li>`;
            return;
        }

        const sorted = [...data].sort((a,b)=>(a.nom||"").localeCompare(b.nom||"","fr"));
        el.innerHTML = sorted.map((p,i) => {
            const qty = Number(p.quantite ?? 0);
            const stockBas = qty < 5 ? `<span style="color:#BA7517;font-size:.7rem;"> ⚠ bas</span>` : "";
            return `
                <li class="data-item" style="animation-delay:${i*40}ms">
                    <div class="item-left">
                        <span class="item-name">${esc(p.nom||"?")}${stockBas}</span>
                        <span class="item-sub">Chambre froide</span>
                    </div>
                    <span class="item-right">${qty.toLocaleString("fr-FR")} kg</span>
                </li>`;
        }).join("");
    } catch(err) {
        el.innerHTML = `<li class="empty-state" style="color:#A32D2D;">❌ ${err.message}</li>`;
    }
}

// ── Alertes chambre froide ──
async function loadAlertesCF() {
    const el = document.getElementById("alertes");
    el.innerHTML = `<div class="empty-state"><span class="spinner"></span>Chargement…</div>`;

    try {
        const data = await apiFetch("produits-cf");
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
            el.innerHTML = `<div class="empty-state" style="color:#2E7D32">✅ Aucune alerte</div>`;
            return;
        }

        const ordre = { red:0, orange:1, yellow:2 };
        alertes.sort((a,b) => ordre[a.type] - ordre[b.type]);

        el.innerHTML = alertes.map((p,i) => `
            <div class="alert-item" style="animation-delay:${i*50}ms">
                <div class="alert-dot ${p.type}"></div>
                <div>
                    <div class="alert-name">${esc(p.nom)}</div>
                    <div class="alert-date">Expiration : ${formatDate(p.date_expiration)}</div>
                </div>
                <span class="alert-badge ${p.type}">${p.label}</span>
            </div>`
        ).join("");
    } catch(err) {
        el.innerHTML = `<div class="empty-state" style="color:#A32D2D;">❌ ${err.message}</div>`;
    }
}

// ── Ventes ──
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
        el.innerHTML = sorted.map((f,i) => `
            <li class="data-item" style="animation-delay:${i*40}ms">
                <div class="item-left">
                    <span class="item-name">${esc(f.client_nom||f.nom_client||"Client")}</span>
                    <span class="item-sub">📅 ${formatDate(f.date_facture)}</span>
                </div>
                <span class="item-right">${Number(f.total_ttc||0).toLocaleString("fr-FR")} FCFA</span>
            </li>`).join("");
    } catch(err) {
        el.innerHTML = `<li class="empty-state" style="color:#A32D2D;">❌ ${err.message}</li>`;
    }
}

// ── Graphique ──
async function loadChart() {
    try {
        const data = await apiFetch("factures");
        if (!data.length) return;

        const par = {};
        data.forEach(f => {
            const d = f.date_facture; if (!d) return;
            par[d] = (par[d]||0) + Number(f.total_ttc||0);
        });

        const labels  = Object.keys(par).sort();
        const valeurs = labels.map(d => par[d]);

        const canvas = document.getElementById("chartVentes");
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

        chartInstance = new Chart(canvas, {
            type: "bar",
            data: {
                labels: labels.map(formatDate),
                datasets: [{
                    label: "Ventes (FCFA)", data: valeurs,
                    backgroundColor: valeurs.map((_,i) =>
                        i === valeurs.length-1 ? "rgba(255,107,26,1)" : "rgba(255,107,26,0.25)"),
                    borderColor: "rgba(255,107,26,0.8)",
                    borderWidth: 1.5, borderRadius: 6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend:{display:false} },
                scales: {
                    x: { ticks:{color:"#888880",font:{size:11}}, grid:{color:"rgba(232,224,216,0.5)"} },
                    y: { ticks:{color:"#888880",font:{size:11},callback:v=>(v/1000).toFixed(0)+"k"}, grid:{color:"rgba(232,224,216,0.5)"} }
                }
            }
        });
    } catch(err) { console.error("[Chart]", err); }
}

// ══════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════
function formatDate(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleDateString("fr-FR");
}
function getTodayISO() { return TODAY.toISOString().split("T")[0]; }
function diffDays(iso) {
    const d = new Date(iso); d.setHours(0,0,0,0);
    return (d - TODAY) / 86400000;
}
function esc(s) {
    return String(s||"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function apiFetch(endpoint, opts={}) {
    const res = await fetch(`/.netlify/functions/${endpoint}`, {
        ...opts,
        headers:{"Content-Type":"application/json",...Auth.getAuthHeader(),...(opts.headers||{})}
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("Réponse invalide"); }
    if (!res.ok) throw new Error(data.error || "Erreur "+res.status);
    return data;
}