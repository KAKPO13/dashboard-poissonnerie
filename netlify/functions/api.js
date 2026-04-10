"use strict";
var API = {
    call: function(endpoint, opts) {
        opts = opts || {};
        return fetch("/.netlify/functions/" + endpoint, {
            method: opts.method || "GET",
            headers: Object.assign({ "Content-Type": "application/json" }, Auth.getAuthHeader(), opts.headers || {}),
            body: opts.body ? JSON.stringify(opts.body) : undefined
        }).then(function(res) {
            return res.text().then(function(text) {
                var data;
                try { data = JSON.parse(text); } catch(e) { throw new Error("Reponse invalide du serveur"); }
                if (!res.ok) throw new Error(data.error || ("Erreur " + res.status));
                return data;
            });
        });
    },
    get: function(endpoint, params) {
        var qs = "";
        if (params) {
            var parts = [];
            Object.keys(params).forEach(function(k) { if (params[k] !== undefined && params[k] !== "") parts.push(k + "=" + encodeURIComponent(params[k])); });
            if (parts.length) qs = "?" + parts.join("&");
        }
        return this.call(endpoint + qs);
    },
    post:  function(endpoint, body) { return this.call(endpoint, { method:"POST",  body:body }); },
    patch: function(endpoint, body) { return this.call(endpoint, { method:"PATCH", body:body }); }
};
window.API = API;