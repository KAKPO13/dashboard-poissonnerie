import { jsonResp, corsResp, readBody, parseBody } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    if (event.httpMethod !== "POST") return jsonResp(405,{error:"Methode non autorisee"});

    var URL = process.env.SUPABASE_URL;
    var KEY = process.env.SUPABASE_KEY;
    var SVC = process.env.SUPABASE_SERVICE_KEY || KEY;
    if (!URL||!KEY) return jsonResp(500,{error:"Configuration serveur manquante"});

    var body;
    try { body = parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
    var email=body.email, password=body.password;
    if (!email||!password) return jsonResp(400,{error:"Email et mot de passe requis"});

    try {
        var aRes = await fetch(URL+"/auth/v1/token?grant_type=password",{method:"POST",headers:{"Content-Type":"application/json",apikey:KEY},body:JSON.stringify({email:email,password:password})});
        var aData = await readBody(aRes);
        if (!aRes.ok||!aData||!aData.access_token) return jsonResp(401,{error:(aData&&(aData.error_description||aData.msg))||"Identifiants incorrects"});

        var token = aData.access_token;
        var userId = aData.user&&aData.user.id;
        if (!userId) return jsonResp(500,{error:"ID utilisateur introuvable"});

        var pRes = await fetch(URL+"/rest/v1/utilisateurs?id=eq."+userId+"&select=id,tenant_id,nom,email,role,actif&limit=1",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
        var profiles = await readBody(pRes);
        if (!Array.isArray(profiles)||!profiles[0]) return jsonResp(403,{error:"Profil introuvable. Contactez votre administrateur."});
        var p = profiles[0];
        if (!p.actif) return jsonResp(403,{error:"Votre compte est desactive."});

        var tenantNom=null, tenantPlan=null, tenantSlug=null;
        if (p.role!=="super_admin"&&p.tenant_id) {
            var tRes = await fetch(URL+"/rest/v1/tenants?id=eq."+p.tenant_id+"&select=nom,plan,slug,statut&limit=1",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
            var tenants = await readBody(tRes);
            if (Array.isArray(tenants)&&tenants[0]) {
                if (tenants[0].statut!=="actif") return jsonResp(403,{error:"Votre societe est suspendue. Contactez le support."});
                tenantNom=tenants[0].nom; tenantPlan=tenants[0].plan; tenantSlug=tenants[0].slug;
            }
        }

        return jsonResp(200,{token:token,userId:p.id,email:p.email,nom:p.nom,role:p.role,tenant_id:p.tenant_id,tenant_nom:tenantNom,tenant_plan:tenantPlan,tenant_slug:tenantSlug,expires:Date.now()+((aData.expires_in||3600)*1000)});

    } catch(err) {
        console.error("[auth-login]",err.message);
        return jsonResp(500,{error:"Erreur serveur : "+err.message});
    }
}
