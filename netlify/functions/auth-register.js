import { jsonResp, corsResp, readBody, parseBody } from './_helpers.js';

function slugify(str) {
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
        .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);
}

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    if (event.httpMethod !== "POST") return jsonResp(405,{error:"Methode non autorisee"});

    var URL = process.env.SUPABASE_URL;
    var KEY = process.env.SUPABASE_KEY;
    var SVC = process.env.SUPABASE_SERVICE_KEY || KEY;
    if (!URL||!KEY) return jsonResp(500,{error:"Configuration serveur manquante"});

    var body;
    try { body = parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
    var nom_societe=body.nom_societe, email=body.email, password=body.password, nom_admin=body.nom_admin, telephone=body.telephone||null, plan=body.plan||"free";

    if (!nom_societe||!email||!password||!nom_admin) return jsonResp(400,{error:"Champs requis : nom_societe, email, password, nom_admin"});
    if (password.length<8) return jsonResp(400,{error:"Mot de passe trop court (min 8 caracteres)"});
    if (["free","pro","enterprise"].indexOf(plan)===-1) return jsonResp(400,{error:"Plan invalide"});

    var h = { "Content-Type":"application/json", apikey:SVC, Authorization:"Bearer "+SVC };

    try {
        var slug = slugify(nom_societe);
        var chk = await fetch(URL+"/rest/v1/tenants?slug=eq."+slug+"&select=id",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
        var ex = await readBody(chk);
        if (Array.isArray(ex)&&ex.length>0) slug = slug+"-"+Date.now().toString(36);

        var tRes = await fetch(URL+"/rest/v1/tenants",{method:"POST",headers:Object.assign({Prefer:"return=representation"},h),body:JSON.stringify({nom:nom_societe,slug:slug,email_contact:email,telephone:telephone,plan:plan,statut:"actif"})});
        var tData = await readBody(tRes);
        if (!tRes.ok) return jsonResp(tRes.status,{error:(tData&&tData.message)||"Erreur creation societe"});
        var tenant = Array.isArray(tData)?tData[0]:tData;
        var tenantId = tenant.id;

        var aRes = await fetch(URL+"/auth/v1/admin/users",{method:"POST",headers:h,body:JSON.stringify({email:email,password:password,email_confirm:true})});
        var aData = await readBody(aRes);
        if (!aRes.ok) {
            await fetch(URL+"/rest/v1/tenants?id=eq."+tenantId,{method:"DELETE",headers:h});
            var msg = (aData&&(aData.msg||aData.message))||"Erreur creation compte";
            if (msg.toLowerCase().indexOf("already")!==-1) return jsonResp(409,{error:"Un compte existe deja avec cet email"});
            return jsonResp(aRes.status,{error:msg});
        }
        var userId = aData.id;

        var pRes = await fetch(URL+"/rest/v1/utilisateurs",{method:"POST",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify({id:userId,tenant_id:tenantId,nom:nom_admin,email:email,role:"admin",actif:true})});
        if (!pRes.ok) return jsonResp(500,{error:"Compte cree mais profil non enregistre"});

        await fetch(URL+"/rest/v1/abonnements",{method:"POST",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify({tenant_id:tenantId,plan:plan,montant_fcfa:plan==="free"?0:plan==="pro"?25000:75000,statut:"actif"})});

        return jsonResp(201,{success:true,tenant_id:tenantId,slug:slug,plan:plan,message:'Societe "'+nom_societe+'" creee avec succes. Connectez-vous avec vos identifiants.'});

    } catch(err) {
        console.error("[auth-register]",err);
        return jsonResp(500,{error:err.message||"Erreur serveur"});
    }
}
