import { jsonResp, corsResp, readBody, parseBody, verifyToken, checkPlanLimit } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    var URL = process.env.SUPABASE_URL;
    var SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!URL) return jsonResp(500,{error:"Configuration manquante"});

    var user;
    try { user = await verifyToken(event); } catch(e) { return jsonResp(e.code||403,{error:e.message}); }
    var h = { apikey:SVC, Authorization:"Bearer "+SVC, "Content-Type":"application/json" };
    var tenantId=user.tenantId, userId=user.userId, role=user.role;
    var params = event.queryStringParameters || {};

    try {
        if (event.httpMethod==="GET") {
            var type = params.type||"cf";
            var gerantRoles = ["gerant","admin","super_admin"];

            if (type==="cf") {
                if (gerantRoles.indexOf(role)===-1) return jsonResp(403,{error:"Acces reserve aux gerants"});
                var r = await fetch(URL+"/rest/v1/produits_cf?tenant_id=eq."+tenantId+"&order=nom.asc",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
                return jsonResp(r.ok?200:500, await readBody(r)||[]);
            }
            if (type==="employe") {
                var empId = (params.id && gerantRoles.indexOf(role)!==-1) ? params.id : userId;
                var r2 = await fetch(URL+"/rest/v1/v_produits_employe?employe_id=eq."+empId+"&tenant_id=eq."+tenantId+"&order=produit_nom.asc",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
                return jsonResp(r2.ok?200:500, await readBody(r2)||[]);
            }
            if (type==="tous_employes") {
                if (gerantRoles.indexOf(role)===-1) return jsonResp(403,{error:"Acces reserve aux gerants"});
                var r3 = await fetch(URL+"/rest/v1/v_produits_employe?tenant_id=eq."+tenantId+"&order=employe_nom.asc,produit_nom.asc",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
                return jsonResp(r3.ok?200:500, await readBody(r3)||[]);
            }
            return jsonResp(400,{error:"type invalide : cf, employe, tous_employes"});
        }

        if (event.httpMethod==="POST") {
            if (["gerant","admin","super_admin"].indexOf(role)===-1) return jsonResp(403,{error:"Acces reserve aux gerants"});
            var body; try { body=parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
            if (!body.nom) return jsonResp(400,{error:"nom requis"});
            var lim = await checkPlanLimit(tenantId,"produit");
            if (!lim.ok) return jsonResp(403,{error:lim.message});
            var pr = await fetch(URL+"/rest/v1/produits_cf",{method:"POST",headers:Object.assign({Prefer:"return=representation"},h),body:JSON.stringify({tenant_id:tenantId,nom:body.nom,reference:body.reference||null,quantite:Number(body.quantite||0),prix_achat_kg:body.prix_achat_kg||null,prix_vente_kg:body.prix_vente_kg||null,date_expiration:body.date_expiration||null})});
            var pd = await readBody(pr);
            return jsonResp(pr.ok?201:pr.status, pr.ok?(Array.isArray(pd)?pd[0]:pd):{error:(pd&&pd.message)||"Erreur"});
        }

        if (event.httpMethod==="PATCH") {
            if (["gerant","admin","super_admin"].indexOf(role)===-1) return jsonResp(403,{error:"Acces reserve aux gerants"});
            var body2; try { body2=parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
            var id=body2.id; delete body2.id;
            if (!id) return jsonResp(400,{error:"id requis"});
            body2.updated_at=new Date().toISOString();
            var mr = await fetch(URL+"/rest/v1/produits_cf?id=eq."+id+"&tenant_id=eq."+tenantId,{method:"PATCH",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify(body2)});
            return jsonResp(mr.ok?200:mr.status, mr.ok?{success:true}:{error:"Erreur modification"});
        }

        return jsonResp(405,{error:"Methode non autorisee"});
    } catch(err) { console.error("[stock]",err.message); return jsonResp(500,{error:err.message}); }
}