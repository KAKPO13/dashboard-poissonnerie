import { jsonResp, corsResp, readBody, parseBody, verifyToken, checkPlanLimit } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    var URL = process.env.SUPABASE_URL;
    var SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!URL) return jsonResp(500,{error:"Configuration manquante"});

    var user;
    try { user = await verifyToken(event,["admin","super_admin"]); } catch(e) { return jsonResp(e.code||403,{error:e.message}); }
    var tenantId = user.tenantId;
    var h = { apikey:SVC, Authorization:"Bearer "+SVC, "Content-Type":"application/json" };

    try {
        if (event.httpMethod==="GET") {
            var r = await fetch(URL+"/rest/v1/utilisateurs?tenant_id=eq."+tenantId+"&select=id,nom,email,role,actif,created_at&order=created_at.desc",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
            return jsonResp(r.ok?200:500, await readBody(r)||[]);
        }

        if (event.httpMethod==="POST") {
            var body; try { body=parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
            var nom=body.nom,email=body.email,password=body.password,role=body.role;
            if (!nom||!email||!password||!role) return jsonResp(400,{error:"Champs requis : nom, email, password, role"});
            if (["gerant","employe","admin"].indexOf(role)===-1) return jsonResp(400,{error:"Role invalide"});
            if (password.length<8) return jsonResp(400,{error:"Mot de passe trop court (min 8 caracteres)"});
            if (role==="gerant"||role==="employe") { var lim=await checkPlanLimit(tenantId,role); if(!lim.ok) return jsonResp(403,{error:lim.message}); }

            var aRes = await fetch(URL+"/auth/v1/admin/users",{method:"POST",headers:h,body:JSON.stringify({email:email,password:password,email_confirm:true})});
            var aData = await readBody(aRes);
            if (!aRes.ok) {
                var msg=(aData&&(aData.msg||aData.message))||"Erreur creation compte";
                if (msg.toLowerCase().indexOf("already")!==-1) return jsonResp(409,{error:"Un compte existe deja avec cet email"});
                return jsonResp(aRes.status,{error:msg});
            }
            var newId = aData.id;
            var pRes = await fetch(URL+"/rest/v1/utilisateurs",{method:"POST",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify({id:newId,tenant_id:tenantId,nom:nom,email:email,role:role,actif:true})});
            if (!pRes.ok) return jsonResp(500,{error:"Compte cree mais profil non enregistre"});
            return jsonResp(201,{success:true,userId:newId});
        }

        if (event.httpMethod==="PATCH") {
            var body2; try { body2=parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
            var userId=body2.userId,role2=body2.role,actif=body2.actif;
            if (!userId) return jsonResp(400,{error:"userId requis"});
            var updates={};
            if (role2!==undefined) { if(["gerant","employe","admin"].indexOf(role2)===-1) return jsonResp(400,{error:"Role invalide"}); updates.role=role2; }
            if (actif!==undefined) updates.actif=Boolean(actif);
            if (!Object.keys(updates).length) return jsonResp(400,{error:"Aucune modification"});
            var r2 = await fetch(URL+"/rest/v1/utilisateurs?id=eq."+userId+"&tenant_id=eq."+tenantId,{method:"PATCH",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify(updates)});
            return jsonResp(r2.ok?200:r2.status, r2.ok?{success:true}:{error:"Erreur modification"});
        }

        return jsonResp(405,{error:"Methode non autorisee"});
    } catch(err) { console.error("[users]",err.message); return jsonResp(500,{error:err.message}); }
}
