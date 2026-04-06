/**
 * auth.js – Module d'authentification partagé
 * Utilise localStorage (persiste entre les pages et onglets)
 * Gère : session, droits, déconnexion, refresh token
 */

"use strict";

const SESSION_KEY = "aqua_session";

// ── Permissions par rôle ──────────────────────────────
const PERMISSIONS = {
    voir_produits:  ["employe", "gerant", "admin"],
    voir_alertes:   ["employe", "gerant", "admin"],
    voir_ventes:    ["gerant", "admin"],
    voir_graphique: ["gerant", "admin"],
    voir_kpi:       ["gerant", "admin"],
    gerer_users:    ["admin"],
    creer_comptes:  ["admin"],
    modifier_roles: ["admin"],
};

// ── Lecture session ───────────────────────────────────
function getSession() {
    try {
        // Chercher dans localStorage D'ABORD, puis sessionStorage (compat)
        const raw = localStorage.getItem(SESSION_KEY)
                 || sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        // Migrer sessionStorage → localStorage si besoin
        if (!localStorage.getItem(SESSION_KEY) && sessionStorage.getItem(SESSION_KEY)) {
            localStorage.setItem(SESSION_KEY, raw);
        }
        return s;
    } catch {
        return null;
    }
}

// ── Sauvegarde session ────────────────────────────────
function setSession(data) {
    const payload = JSON.stringify(data);
    localStorage.setItem(SESSION_KEY, payload);
    sessionStorage.setItem(SESSION_KEY, payload); // double stockage par sécurité
}

// ── Déconnexion ───────────────────────────────────────
function logout() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "login.html";
}

// ── Vérification session ──────────────────────────────
/**
 * Retourne la session si valide, sinon redirige vers login.
 * Ne vérifie PAS l'expiration côté client (le serveur le fera).
 * Le token Supabase dure 1h mais peut être rafraîchi.
 */
function requireAuth() {
    const session = getSession();

    if (!session || !session.token || !session.role) {
        window.location.href = "login.html";
        return null;
    }

    // Expiration : on laisse une marge de 5 minutes
    // Si expiré depuis plus de 5 min → déconnexion
    if (session.expires && Date.now() > (session.expires + 5 * 60 * 1000)) {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        window.location.href = "login.html";
        return null;
    }

    return session;
}

// ── Vérification rôle minimum ─────────────────────────
function requireRole(role) {
    const session = requireAuth();
    if (!session) return null;
    const hierarchy = ["employe", "gerant", "admin"];
    if (hierarchy.indexOf(session.role) < hierarchy.indexOf(role)) {
        window.location.href = "index.html";
        return null;
    }
    return session;
}

// ── Permission ────────────────────────────────────────
function peutFaire(permission) {
    const session = getSession();
    if (!session) return false;
    return (PERMISSIONS[permission] || []).includes(session.role);
}

// ── Header Authorization ──────────────────────────────
function getAuthHeader() {
    const s = getSession();
    return s ? { Authorization: "Bearer " + s.token } : {};
}

// ── Export global ─────────────────────────────────────
window.Auth = {
    getSession,
    setSession,
    requireAuth,
    requireRole,
    peutFaire,
    getAuthHeader,
    logout,
    SESSION_KEY
};