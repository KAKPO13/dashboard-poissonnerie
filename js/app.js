/**
 * AquaDash – Dashboard Poissonnerie
 * Gestion : produits, ventes, graphique, alertes expiration
 * Appels API via Netlify Functions (aucune clé Supabase en frontend)
 */

"use strict";

// ═══════════════════════════════════════
// ÉTAT GLOBAL
// ═══════════════════════════════════════

let chartInstance = null; // Instance Chart.js (singleton)

const TODAY = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
})();

// ═══════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════

/**
 * Formate un nombre en monnaie FCFA lisible
 * Ex : 11800 → "11 800 FCFA"
 */
function formatFCFA(amount) {
    return Number(amount).toLocaleString("fr-FR") + " FCFA";
}

/**
 * Formate une date ISO en date locale FR
 * Ex : "2025-07-10" → "10/07/2025"
 */
function formatDate(isoString) {
    if (!isoString) return "Date inconnue";
    const d = new Date(isoString);
    return d.toLocaleDateString("fr-FR");
}

/**
 * Retourne la date du jour en format ISO "YYYY-MM-DD"
 */
function getTodayISO() {
    return TODAY.toISOString().split("T")[0];
}

/**
 * Calcule la différence en jours entre une date et aujourd'hui
 * (comparaison date uniquement, sans heure)
 */
function diffDays(isoDate) {
    const d = new Date(isoDate);
    d.setHours(0, 0, 0, 0);
    return (d - TODAY) / (1000 * 60 * 60 * 24);
}

/**
 * Met à jour le timestamp "Dernière mise à jour" dans le header
 */
function updateTimestamp() {
    const el = document.getElementById("last-update");
    if (el) {
        el.textContent = "Mis à jour à " + new Date().toLocaleTimeString("fr-FR", {
            hour: "2-digit", minute: "2-digit"
        });
    }
}

/**
 * Affiche un état chargement dans un élément
 */
function setLoading(el) {
    el.innerHTML = `<li class="empty-state"><span class="spinner"></span>Chargement…</li>`;
}

/**
 * Affiche un message d'erreur dans une liste
 */
function setError(el, msg = "Erreur de chargement") {
    el.innerHTML = `<li class="empty-state" style="color:#ff4d4d;">❌ ${msg}</li>`;
}

// ═══════════════════════════════════════
// API CALLS
// ═══════════════════════════════════════

/**
 * Appelle une Netlify Function et retourne le JSON
 * Lance une erreur si la réponse HTTP n'est pas ok
 */
async function apiFetch(endpoint) {
    const res = await fetch(`/.netlify/functions/${endpoint}`);
    if (!res.ok) throw new Error(`Erreur ${res.status} sur /${endpoint}`);
    return res.json();
}

// ═══════════════════════════════════════
// 🐟 PRODUITS
// ═══════════════════════════════════════

async function loadProduits() {
    const el = document.getElementById("produits");
    setLoading(el);

    try {
        const data = await apiFetch("produits");

        // Mise à jour KPI
        document.getElementById("kpi-produits").textContent = data.length;
        document.getElementById("badge-produits").textContent = data.length + " article(s)";

        if (!data.length) {
            el.innerHTML = `<li class="empty-state">Aucun produit disponible</li>`;
            return;
        }

        // Trier par nom alphabétique
        const sorted = [...data].sort((a, b) =>
            (a.nom || "").localeCompare(b.nom || "", "fr")
        );

        el.innerHTML = sorted.map((p, i) => {
            const nom      = p.nom || "Sans nom";
            const quantite = p.quantite ?? 0;
            const exp      = p.date_expiration ? diffDays(p.date_expiration) : null;

            // Indicateur visuel stock bas (< 5 kg)
            const stockBas = quantite < 5
                ? `<span style="color:#f5a623;font-size:0.7rem;"> ⚠ stock bas</span>`
                : "";

            return `
                <li class="data-item" style="animation-delay:${i * 40}ms">
                    <div class="item-left">
                        <span class="item-name">${nom}${stockBas}</span>
                        <span class="item-sub">Stock disponible</span>
                    </div>
                    <span class="item-right">${quantite} kg</span>
                </li>`;
        }).join("");

    } catch (err) {
        console.error("[Produits]", err);
        setError(el);
        document.getElementById("kpi-produits").textContent = "–";
    }
}

// ═══════════════════════════════════════
// 💰 VENTES (historique)
// ═══════════════════════════════════════

async function loadVentes() {
    const el = document.getElementById("ventes");
    setLoading(el);

    try {
        const data = await apiFetch("factures");

        // Calculs KPI
        const totalAll = data.reduce((s, f) => s + Number(f.total_ttc || 0), 0);
        const todayISO = getTodayISO();
        const totalJour = data
            .filter(f => f.date_facture === todayISO)
            .reduce((s, f) => s + Number(f.total_ttc || 0), 0);

        document.getElementById("kpi-total").textContent = totalAll.toLocaleString("fr-FR");
        document.getElementById("kpi-jour").textContent  = totalJour.toLocaleString("fr-FR");
        document.getElementById("badge-ventes").textContent = data.length + " facture(s)";

        if (!data.length) {
            el.innerHTML = `<li class="empty-state">Aucune vente enregistrée</li>`;
            return;
        }

        // Trier par date décroissante
        const sorted = [...data].sort((a, b) => {
            const da = new Date(a.date_facture || 0);
            const db = new Date(b.date_facture || 0);
            return db - da;
        });

        el.innerHTML = sorted.map((f, i) => {
            const date   = formatDate(f.date_facture);
            const client = f.client_nom || f.nom_client || "Client inconnu";
            const montant = formatFCFA(f.total_ttc || 0);

            return `
                <li class="data-item" style="animation-delay:${i * 40}ms">
                    <div class="item-left">
                        <span class="item-name">${client}</span>
                        <span class="item-sub">📅 ${date}</span>
                    </div>
                    <span class="item-right">${montant}</span>
                </li>`;
        }).join("");

    } catch (err) {
        console.error("[Ventes]", err);
        setError(el);
    }
}

// ═══════════════════════════════════════
// 📊 GRAPHIQUE VENTES
// ═══════════════════════════════════════

async function loadChart() {
    try {
        const data = await apiFetch("factures");
        if (!data.length) return;

        // Regrouper ventes par jour
        const ventesParJour = {};
        data.forEach(f => {
            const date = f.date_facture;
            if (!date) return;
            ventesParJour[date] = (ventesParJour[date] || 0) + Number(f.total_ttc || 0);
        });

        // Trier les dates croissant
        const labels  = Object.keys(ventesParJour).sort();
        const valeurs = labels.map(d => ventesParJour[d]);

        // Labels affichés en format FR
        const labelsAffich = labels.map(d => formatDate(d));

        const ctx = document.getElementById("chartVentes");

        // Détruire l'instance précédente si elle existe
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        // Couleurs dégradées pour les barres
        const gradient = ctx.getContext("2d").createLinearGradient(0, 0, 0, 220);
        gradient.addColorStop(0, "rgba(0, 201, 167, 0.85)");
        gradient.addColorStop(1, "rgba(0, 112, 243, 0.4)");

        chartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labelsAffich,
                datasets: [{
                    label: "Ventes (FCFA)",
                    data: valeurs,
                    backgroundColor: gradient,
                    borderColor: "rgba(0, 201, 167, 0.9)",
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 600, easing: "easeOutQuart" },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#1e2530",
                        titleColor: "#8b949e",
                        bodyColor: "#e6edf3",
                        borderColor: "rgba(255,255,255,0.07)",
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: ctx => " " + formatFCFA(ctx.parsed.y)
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: "#8b949e", font: { size: 11 } },
                        grid: { color: "rgba(255,255,255,0.04)" }
                    },
                    y: {
                        ticks: {
                            color: "#8b949e",
                            font: { size: 11 },
                            callback: v => (v / 1000).toFixed(0) + "k"
                        },
                        grid: { color: "rgba(255,255,255,0.06)" }
                    }
                }
            }
        });

    } catch (err) {
        console.error("[Graphique]", err);
    }
}

// ═══════════════════════════════════════
// ⚠️ ALERTES EXPIRATION
// ═══════════════════════════════════════

async function loadAlertes() {
    const el = document.getElementById("alertes");
    el.innerHTML = `<div class="empty-state"><span class="spinner"></span>Chargement…</div>`;

    try {
        const data = await apiFetch("produits");

        // Classifier les produits selon leur expiration
        const alertes = [];

        data.forEach(p => {
            if (!p.date_expiration) return;
            const diff = diffDays(p.date_expiration);

            if (diff < 0) {
                // Déjà expiré
                alertes.push({ ...p, diff, type: "red", label: "Expiré" });
            } else if (diff < 1) {
                // Expire aujourd'hui
                alertes.push({ ...p, diff, type: "orange", label: "Aujourd'hui" });
            } else if (diff < 2) {
                // Expire demain
                alertes.push({ ...p, diff, type: "yellow", label: "Demain" });
            }
        });

        // Mise à jour KPI alertes
        document.getElementById("kpi-alertes").textContent = alertes.length;
        document.getElementById("badge-alertes").textContent = alertes.length + " alerte(s)";

        if (!alertes.length) {
            el.innerHTML = `
                <div class="empty-state" style="color:#00c9a7;">
                    ✅ Aucune alerte d'expiration
                </div>`;
            return;
        }

        // Trier : expirés d'abord, puis aujourd'hui, demain
        const ordre = { red: 0, orange: 1, yellow: 2 };
        alertes.sort((a, b) => ordre[a.type] - ordre[b.type]);

        el.innerHTML = alertes.map((p, i) => `
            <div class="alert-item" style="animation-delay:${i * 50}ms">
                <div class="alert-dot ${p.type}"></div>
                <div>
                    <div class="alert-name">${p.nom || "Produit inconnu"}</div>
                    <div class="alert-date">Expiration : ${formatDate(p.date_expiration)}</div>
                </div>
                <span class="alert-badge ${p.type}">${p.label}</span>
            </div>`
        ).join("");

    } catch (err) {
        console.error("[Alertes]", err);
        el.innerHTML = `<div class="empty-state" style="color:#ff4d4d;">❌ Erreur de chargement</div>`;
        document.getElementById("kpi-alertes").textContent = "–";
    }
}

// ═══════════════════════════════════════
// 🚀 INITIALISATION
// ═══════════════════════════════════════

async function init() {
    updateTimestamp();

    // Lancer toutes les sections en parallèle
    await Promise.allSettled([
        loadProduits(),
        loadVentes(),
        loadChart(),
        loadAlertes(),
    ]);

    updateTimestamp();
}

// Démarrage au chargement de la page
document.addEventListener("DOMContentLoaded", init);
