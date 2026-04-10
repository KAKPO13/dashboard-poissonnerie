import { jsonResp, corsResp, readBody, parseBody, verifyToken } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    var URL = process.env.SUPABASE_URL;
    var SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!URL) return jsonResp(500,{error:"Configuration manquante"});

    var user;
    try { user = await verifyToken(event,["gerant","admin","super_admin"]); } catch(e) { return jsonResp(e.code||403,{error:e.message}); }
    var h = { apikey:SVC, Authorization:"Bearer "+SVC, "Content-Type":"application/json" };
    var tenantId=user.tenantId, userId=user.userId;

    try {
        if (event.httpMethod==="GET") {
            var params=event.queryStringParameters||{};
            var q=URL+"/rest/v1/v_mouvements_detail?tenant_id=eq."+tenantId+"&order=created_at.desc";
            if (params.limit) q+="&limit="+parseInt(params.limit);
            if (params.type)  q+="&type=eq."+params.type;
            var r = await fetch(q,{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
            return jsonResp(r.ok?200:500, await readBody(r)||[]);
        }

        if (event.httpMethod==="POST") {
            var body; try { body=parseBody(event); } catch(e) { return jsonResp(400,{error:e.message}); }
            var produit_id=body.produit_id,type=body.type,quantite=body.quantite,prix_achat_kg=body.prix_achat_kg,employe_id=body.employe_id,employe_nom=body.employe_nom,note=body.note;

            if (!produit_id) return jsonResp(400,{error:"produit_id requis"});
            if (["entree","sortie","ajustement"].indexOf(type)===-1) return jsonResp(400,{error:"type invalide"});
            if (!quantite||Number(quantite)<=0) return jsonResp(400,{error:"quantite > 0 requis"});
            if (type==="sortie"&&!employe_id) return jsonResp(400,{error:"employe_id requis pour une sortie"});
            var qty=Number(quantite);

            var cfR = await fetch(URL+"/rest/v1/produits_cf?id=eq."+produit_id+"&tenant_id=eq."+tenantId+"&select=id,nom,reference,quantite,prix_vente_kg&limit=1",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
            var cfRows = await readBody(cfR);
            if (!Array.isArray(cfRows)||!cfRows[0]) return jsonResp(404,{error:"Produit chambre froide introuvable"});
            var prod=cfRows[0], stockCF=Number(prod.quantite||0);
            if (type==="sortie"&&stockCF<qty) return jsonResp(400,{error:"Stock insuffisant. Disponible : "+stockCF+" kg, demande : "+qty+" kg"});

            var mvtData={tenant_id:tenantId,produit_id:Number(produit_id),type:type,quantite:qty,note:note||null,created_by:userId};
            if (type==="entree"&&prix_achat_kg) mvtData.prix_achat_kg=Number(prix_achat_kg);
            if (type==="sortie") { mvtData.employe_id=employe_id; mvtData.employe_nom=employe_nom||null; }

            var mR = await fetch(URL+"/rest/v1/mouvements_stock",{method:"POST",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify(mvtData)});
            if (!mR.ok) { var me=await readBody(mR); return jsonResp(mR.status,{error:(me&&me.message)||"Erreur mouvement"}); }

            var delta=type==="entree"?qty:-qty;
            var newQtyCF=Math.max(0,stockCF+delta);
            var patchCF={quantite:newQtyCF,updated_at:new Date().toISOString()};
            if (type==="entree"&&prix_achat_kg) patchCF.prix_achat_kg=Number(prix_achat_kg);
            await fetch(URL+"/rest/v1/produits_cf?id=eq."+produit_id+"&tenant_id=eq."+tenantId,{method:"PATCH",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify(patchCF)});

            if (type==="sortie") {
                var peR = await fetch(URL+"/rest/v1/produits_employe?employe_id=eq."+employe_id+"&produit_cf_id=eq."+produit_id+"&select=id,quantite&limit=1",{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});
                var peRows=await readBody(peR);
                if (Array.isArray(peRows)&&peRows.length>0) {
                    await fetch(URL+"/rest/v1/produits_employe?employe_id=eq."+employe_id+"&produit_cf_id=eq."+produit_id,{method:"PATCH",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify({quantite:Number(peRows[0].quantite||0)+qty,updated_at:new Date().toISOString()})});
                } else {
                    await fetch(URL+"/rest/v1/produits_employe",{method:"POST",headers:Object.assign({Prefer:"return=minimal"},h),body:JSON.stringify({tenant_id:tenantId,employe_id:employe_id,produit_cf_id:Number(produit_id),nom:prod.nom,reference:prod.reference||null,quantite:qty,prix_vente_kg:prod.prix_vente_kg||null,updated_at:new Date().toISOString()})});
                }
            }
            return jsonResp(201,{success:true,stock_cf_restant:newQtyCF});
        }
        return jsonResp(405,{error:"Methode non autorisee"});
    } catch(err) { console.error("[mouvements]",err.message); return jsonResp(500,{error:err.message}); }
}

