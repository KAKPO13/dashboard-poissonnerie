import { jsonResp, corsResp, readBody, verifyToken } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    var URL = process.env.SUPABASE_URL;
    var SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!URL) return jsonResp(500,{error:"Configuration manquante"});

    var user;
    try { user = await verifyToken(event,["admin","super_admin"]); } catch(e) { return jsonResp(e.code||403,{error:e.message}); }
    var tenantId=user.tenantId;
    var h={apikey:SVC,Authorization:"Bearer "+SVC};

    try {
        var r = await fetch(URL+"/rest/v1/factures?tenant_id=eq."+tenantId+"&select=*&order=date_facture.desc",{headers:h});
        return jsonResp(r.ok?200:500, await readBody(r)||[]);
    } catch(err) { return jsonResp(500,{error:err.message}); }
}
