// Netlify Function : profil
// GET  -> infos du compte connecte + limites plan
// PATCH -> modifier son nom ou mot de passe

import { jsonResp, corsResp, readBody, parseBody, verifyToken } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    var URL = process.env.SUPABASE_URL;
    var KEY = process.env.SUPABASE_KEY;
    var SVC = process.env.SUPABASE_SERVICE_KEY || KEY;
    if (!URL) return jsonResp(500, { error:"Configuration manquante" });


    var user;
    try { user = await verifyToken(event); }
    catch(e) { return jsonResp(e.code||403, { error:e.message }); }

    var h = { apikey:SVC, Authorization:"Bearer "+SVC, "Content-Type":"application/json" };

    try {
        if (event.httpMethod === "GET") {
            var pRes = await fetch(URL+"/rest/v1/utilisateurs?id=eq."+user.userId+"&select=id,nom,email,role,created_at&limit=1", { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
            var profile = await readBody(pRes);
            var p = Array.isArray(profile)?profile[0]:profile;

            var limites = null;
            if (user.tenantId) {
                var tRes = await fetch(URL+"/rest/v1/tenants?id=eq."+user.tenantId+"&select=nom,slug,plan,statut&limit=1", { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
                var tenants = await readBody(tRes);
                var tenant = Array.isArray(tenants)?tenants[0]:tenants;
                if (tenant) {
                    var plRes = await fetch(URL+"/rest/v1/plans?plan=eq."+tenant.plan+"&limit=1", { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
                    var plans = await readBody(plRes);
                    limites = Array.isArray(plans)?plans[0]:plans;

                    var gerantCount = await fetch(URL+"/rest/v1/utilisateurs?tenant_id=eq."+user.tenantId+"&role=eq.gerant&select=id", { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
                    var gc = await readBody(gerantCount);
                    var empCount = await fetch(URL+"/rest/v1/utilisateurs?tenant_id=eq."+user.tenantId+"&role=eq.employe&select=id", { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
                    var ec = await readBody(empCount);
                    var prodCount = await fetch(URL+"/rest/v1/produits_cf?tenant_id=eq."+user.tenantId+"&select=id", { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
                    var pc = await readBody(prodCount);

                    return jsonResp(200, {
                        profil:     p,
                        tenant:     tenant,
                        limites:    limites,
                        utilisation: {
                            gerants:  (Array.isArray(gc)?gc:[]).length,
                            employes: (Array.isArray(ec)?ec:[]).length,
                            produits: (Array.isArray(pc)?pc:[]).length
                        }
                    });
                }
            }
            return jsonResp(200, { profil:p });
        }

        if (event.httpMethod === "PATCH") {
            var body; try { body=parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
            if (body.nom) {
                await fetch(URL+"/rest/v1/utilisateurs?id=eq."+user.userId, { method:"PATCH", headers: Object.assign({ Prefer:"return=minimal" }, h), body: JSON.stringify({ nom:body.nom }) });
            }
            if (body.password && body.password.length >= 8) {
                await fetch(URL+"/auth/v1/admin/users/"+user.userId, { method:"PUT", headers:h, body: JSON.stringify({ password:body.password }) });
            }
            return jsonResp(200, { success:true });
        }

        return jsonResp(405, { error:"Methode non autorisee" });
    } catch(err) {
        console.error("[profil]", err.message);
        return jsonResp(500, { error:err.message });
    }
}
