// Helpers partages pour toutes les Netlify Functions

export function jsonResp(code, data) {
    return {
        statusCode: code,
        headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type,Authorization" },
        body: JSON.stringify(data)
    };
}

export function corsResp() {
    return { statusCode:200, headers:{ "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Methods":"GET,POST,PATCH,DELETE,OPTIONS" }, body:"" };
}

export async function readBody(res) {
    var t = await res.text();
    if (!t || !t.trim()) return null;
    try { return JSON.parse(t); } catch(e) { return { _raw: t.slice(0,200) }; }
}

export function parseBody(event) {
    try { return JSON.parse(event.body || "{}"); }
    catch(e) { throw { code:400, message:"Corps de requete invalide" }; }
}

export async function verifyToken(event, allowedRoles) {
    allowedRoles = allowedRoles || [];
    var URL = process.env.SUPABASE_URL;
    var KEY = process.env.SUPABASE_KEY;
    var SVC = process.env.SUPABASE_SERVICE_KEY || KEY;
    var auth = ((event.headers.authorization || event.headers.Authorization || "")).replace("Bearer ","").trim();
    if (!auth) throw { code:401, message:"Token manquant" };

    var r = await fetch(URL + "/auth/v1/user", { headers:{ apikey:KEY, Authorization:"Bearer "+auth } });
    var u = await readBody(r);
    if (!r.ok || !u || !u.id) throw { code:401, message:"Token invalide ou expire" };

    var pr = await fetch(URL + "/rest/v1/utilisateurs?id=eq."+u.id+"&select=id,tenant_id,nom,email,role,actif&limit=1",
        { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
    var profiles = await readBody(pr);
    if (!Array.isArray(profiles) || !profiles[0]) throw { code:403, message:"Profil introuvable" };
    var p = profiles[0];
    if (!p.actif) throw { code:403, message:"Compte desactive" };
    if (allowedRoles.length && allowedRoles.indexOf(p.role) === -1)
        throw { code:403, message:"Acces reserve aux roles : " + allowedRoles.join(", ") };

    if (p.role !== "super_admin" && p.tenant_id) {
        var tr = await fetch(URL + "/rest/v1/tenants?id=eq."+p.tenant_id+"&select=statut,plan&limit=1",
            { headers:{ apikey:SVC, Authorization:"Bearer "+SVC } });
        var tenants = await readBody(tr);
        if (!Array.isArray(tenants) || !tenants[0] || tenants[0].statut !== "actif")
            throw { code:403, message:"Compte societe suspendu. Contactez le support." };
        p.plan = tenants[0].plan;
    }
    return { userId:p.id, tenantId:p.tenant_id, role:p.role, nom:p.nom, email:p.email, plan:p.plan||null };
}

export async function checkPlanLimit(tenantId, resource) {
    var URL = process.env.SUPABASE_URL;
    var SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    var h = { apikey:SVC, Authorization:"Bearer "+SVC };
    var tr = await fetch(URL+"/rest/v1/tenants?id=eq."+tenantId+"&select=plan&limit=1",{headers:h});
    var tenants = await readBody(tr);
    if (!Array.isArray(tenants)||!tenants[0]) return { ok:true };
    var plan = tenants[0].plan;
    var pr = await fetch(URL+"/rest/v1/plans?plan=eq."+plan+"&limit=1",{headers:h});
    var plans = await readBody(pr);
    if (!Array.isArray(plans)||!plans[0]) return { ok:true };
    var limits = plans[0];
    var endpoints = { gerant:"utilisateurs?tenant_id=eq."+tenantId+"&role=eq.gerant", employe:"utilisateurs?tenant_id=eq."+tenantId+"&role=eq.employe", produit:"produits_cf?tenant_id=eq."+tenantId };
    var limitKeys  = { gerant:"max_gerants", employe:"max_employes", produit:"max_produits" };
    var labels     = { gerant:"gerants", employe:"employes", produit:"produits" };
    if (!endpoints[resource]) return { ok:true };
    var max = limits[limitKeys[resource]];
    if (max === -1) return { ok:true };
    var cr = await fetch(URL+"/rest/v1/"+endpoints[resource]+"&select=id",{headers:Object.assign({Prefer:"count=exact"},h)});
    var range = cr.headers.get("content-range");
    var count = parseInt((range||"").split("/")[1]||"0");
    if (count >= max) return { ok:false, message:"Limite atteinte : plan "+plan+" autorise "+max+" "+labels[resource]+". Passez au plan superieur." };
    return { ok:true };
}
