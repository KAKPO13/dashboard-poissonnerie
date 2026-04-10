import { jsonResp, corsResp, readBody, parseBody, verifyToken } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    var URL = process.env.SUPABASE_URL;
    var SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!URL) return jsonResp(500,{error:"Configuration manquante"});

    var user;
    try { user = await verifyToken(event,["super_admin"]); } catch(e) { return jsonResp(e.code||403,{error:e.message}); }
    var h={apikey:SVC,Authorization:"Bearer "+SVC,"Content-Type":"application/json"};

    try {
        if (event.httpMethod==="GET") {
            var r = await fetch(URL+"/rest/v1/v_tenants_stats?order=created_at.desc",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
            return jsonResp(r.ok?200:500, await readBody(r)||[]);
        }
        if (event.httpMethod==="PATCH") {
            var body; try { body=parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
            var tenantId=body.tenantId,plan=body.plan,statut=body.statut;
            if (!tenantId) return jsonResp(400,{error:"tenantId requis"});
            var updates={updated_at:new Date().toISOString()};
            if (plan) { if(["free","pro","enterprise"].indexOf(plan)===-1) return jsonResp(400,{error:"Plan invalide"}); updates.plan=plan; }
            if (statut) { if(["actif","suspendu","expire"].indexOf(statut)===-1) return jsonResp(400,{error:"Statut invalide"}); updates.statut=statut; }
            var r2 = await fetch(URL+"/rest/v1/tenants?id=eq."+tenantId,{method:"PATCH",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify(updates)});
            return jsonResp(r2.ok?200:r2.status, r2.ok?{success:true}:{error:"Erreur modification"});
        }
        return jsonResp(405,{error:"Methode non autorisee"});
    } catch(err) { console.error("[tenants]",err.message); return jsonResp(500,{error:err.message}); }
}
