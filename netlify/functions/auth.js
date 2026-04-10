"use strict";
var SESSION_KEY = "aqua_session";
var PERMISSIONS = {
    voir_stock_perso:    ["employe","gerant","admin","super_admin"],
    voir_alertes:        ["employe","gerant","admin","super_admin"],
    voir_chambre_froide: ["gerant","admin","super_admin"],
    gerer_mouvements:    ["gerant","admin","super_admin"],
    voir_stock_employes: ["gerant","admin","super_admin"],
    voir_ventes:         ["admin","super_admin"],
    voir_graphique:      ["admin","super_admin"],
    gerer_users:         ["admin","super_admin"],
    gerer_tenants:       ["super_admin"]
};
function getSession() {
    try {
        var raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch(e) { return null; }
}
function setSession(data) {
    var s = JSON.stringify(data);
    localStorage.setItem(SESSION_KEY, s);
    sessionStorage.setItem(SESSION_KEY, s);
}
function logout() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "login.html";
}
function requireAuth() {
    var s = getSession();
    if (!s || !s.token || !s.role) { window.location.href = "login.html"; return null; }
    if (s.expires && Date.now() > s.expires + 300000) {
        localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY);
        window.location.href = "login.html"; return null;
    }
    return s;
}
function peutFaire(permission) {
    var s = getSession();
    if (!s) return false;
    return (PERMISSIONS[permission] || []).indexOf(s.role) !== -1;
}
function getHomeByRole(role) {
    var map = { super_admin:"superadmin.html", admin:"admin.html", gerant:"gerant.html", employe:"index.html" };
    return map[role] || "login.html";
}
function getAuthHeader() {
    var s = getSession();
    return s ? { "Authorization": "Bearer " + s.token } : {};
}
function fillHeader(session) {
    var initiales = (session.nom || session.email || "U").split(" ").map(function(w){ return w[0]; }).join("").toUpperCase().slice(0,2);
    var av = document.getElementById("user-avatar");
    var nm = document.getElementById("user-name");
    var rb = document.getElementById("user-role-badge");
    var tn = document.getElementById("tenant-name");
    if (av) av.textContent = initiales;
    if (nm) nm.textContent = session.nom || session.email;
    if (rb) {
        var labels = { super_admin:"Super Admin", admin:"Admin", gerant:"Gerant", employe:"Employe" };
        rb.textContent = labels[session.role] || session.role;
        rb.className = "role-pill " + session.role;
    }
    if (tn && session.tenant_nom) tn.textContent = session.tenant_nom;
}
window.Auth = { getSession:getSession, setSession:setSession, requireAuth:requireAuth, peutFaire:peutFaire, getHomeByRole:getHomeByRole, getAuthHeader:getAuthHeader, fillHeader:fillHeader, logout:logout };
