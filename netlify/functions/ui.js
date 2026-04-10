"use strict";
var UI = {
    fmt:  function(n) { return Number(n||0).toLocaleString("fr-FR"); },
    fmtF: function(n) { return UI.fmt(n) + " FCFA"; },
    fmtD: function(iso) { return iso ? new Date(iso).toLocaleDateString("fr-FR") : "-"; },
    fmtDT: function(iso) { return iso ? new Date(iso).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "-"; },
    esc: function(s) { return String(s||"").replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); },
    todayISO: function() { return new Date().toISOString().split("T")[0]; },
    diffDays: function(iso) { var d=new Date(iso); d.setHours(0,0,0,0); var t=new Date(); t.setHours(0,0,0,0); return (d-t)/86400000; },
    spinner: function() { return '<span class="spinner"></span>'; },
    loading: function(el, text) { if (el) el.innerHTML = '<div class="empty">' + UI.spinner() + (text||"Chargement...") + '</div>'; },
    showMsg: function(id, type, text) { var el=document.getElementById(id); if(!el) return; el.className="msg "+type; el.textContent=text; },
    clearMsg: function(id) { var el=document.getElementById(id); if(el) el.className="msg"; },
    btnLoad: function(id) { var b=document.getElementById(id); if(b){ b.disabled=true; b.innerHTML=UI.spinner()+" Traitement..."; } },
    btnReset: function(id, label) { var b=document.getElementById(id); if(b){ b.disabled=false; b.textContent=label; } }
};
window.UI = UI;
