/**
 * auth.js – Module d'authentification partagé
 * À inclure dans toutes les pages après login
 * Gère : vérification session, contrôle des droits, déconnexion
 */

"use strict";

const SESSION_KEY = "aqua_session";

// ═══════════════════════════════════════
// RÔLES & PERMISSIONS
// ═══════════════════════════════════════

/**
 * Matrice des permissions par rôle
 * Clé : fonctionnalité  |  Valeur : rôles autorisés
 */
const PERMISSIONS = {
    voir_produits:    ["employe", "gerant", "admin"],
    voir_alertes:     ["employe", "gerant", "admin"],
    voir_ventes:      ["gerant", "admin"],
    voir_graphique:   ["gerant", "admin"],
    voir_kpi:         ["gerant", "admin"],
    gerer_users:      ["admin"],
    creer_comptes:    ["admin"],
    modifier_roles:   ["admin"],
};

// ═══════════════════════════════════════
// SESSION
// ═══════════════════════════════════════

/** Récupère la session stockée */
function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
    catch { return null; }
}

/** Déconnexion et redirection */
function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "login.html";
}

/**
 * Vérifie si l'utilisateur est connecté.
 * Si non → redirige vers login.html
 * Retourne la session si valide.
 */
function requireAuth() {
    const session = getSession();
    if (!session || !session.token) {
        window.location.href = "login.html";
        return null;
    }
    // Vérifier expiration token
    if (session.expires && Date.now() > session.expires) {
        sessionStorage.removeItem(SESSION_KEY);
        window.location.href = "login.html";
        return null;
    }
    return session;
}

/**
 * Vérifie qu'un utilisateur a le rôle requis
 * @param {string} role - rôle minimum requis
 */
function requireRole(role) {
    const session = requireAuth();
    if (!session) return null;
    const hierarchy = ["employe", "gerant", "admin"];
    const userLevel = hierarchy.indexOf(session.role);
    const reqLevel  = hierarchy.indexOf(role);
    if (userLevel < reqLevel) {
        window.location.href = "index.html";
        return null;
    }
    return session;
}

/**
 * Vérifie si l'utilisateur courant a une permission donnée
 * @param {string} permission - clé dans PERMISSIONS
 */
function peutFaire(permission) {
    const session = getSession();
    if (!session) return false;
    const roles = PERMISSIONS[permission] || [];
    return roles.includes(session.role);
}

/**
 * Masque les éléments DOM selon les droits
 * Usage: <div data-require="voir_ventes">…</div>
 */
function appliquerDroitsDOM() {
    document.querySelectorAll("[data-require]").forEach(el => {
        const perm = el.getAttribute("data-require");
        if (!peutFaire(perm)) {
            el.style.display = "none";
        }
    });
}

/**
 * Retourne le token d'auth pour les appels API
 */
function getAuthHeader() {
    const s = getSession();
    return s ? { Authorization: "Bearer " + s.token } : {};
}

// ═══════════════════════════════════════
// EXPORT (compatibilité navigateur)
// ═══════════════════════════════════════

window.Auth = {
    getSession,
    requireAuth,
    requireRole,
    peutFaire,
    appliquerDroitsDOM,
    getAuthHeader,
    logout,
    SESSION_KEY
};
