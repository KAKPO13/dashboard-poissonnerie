import { jsonResp, corsResp, readBody, verifyToken } from './_helpers.js';

export async function handler(event) {
    if (event.httpMethod === "OPTIONS") return corsResp();
    if (event.httpMethod !== "GET") return jsonResp(405,{error:"Methode non autorisee"});
    var URL = process.env.SUPABASE_URL;
    var SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!URL) return jsonResp(500,{error:"Configuration manquante"});

    var user;
    try { user = await verifyToken(event); } catch(e) { return jsonResp(e.code||403,{error:e.message}); }
    var tenantId=user.tenantId, role=user.role;
    var vue=(event.queryStringParameters||{}).vue||"gerant";
    var h={apikey:SVC,Authorization:"Bearer "+SVC};

    try {
        if (vue==="gerant") {
            if (["gerant","admin","super_admin"].indexOf(role)===-1) return jsonResp(403,{error:"Acces reserve aux gerants"});
            var results = await Promise.all([
                fetch(URL+"/rest/v1/produits_cf?tenant_id=eq."+tenantId+"&select=*&order=nom.asc",{headers:h}),
                fetch(URL+"/rest/v1/mouvements_stock?tenant_id=eq."+tenantId+"&select=produit_id,type,quantite,prix_achat_kg",{headers:h}),
                fetch(URL+"/rest/v1/v_mouvements_detail?tenant_id=eq."+tenantId+"&limit=30&order=created_at.desc",{headers:h}),
                fetch(URL+"/rest/v1/utilisateurs?tenant_id=eq."+tenantId+"&role=in.(gerant,employe)&actif=eq.true&select=id,nom,email,role",{headers:h}),
                fetch(URL+"/rest/v1/v_produits_employe?tenant_id=eq."+tenantId+"&order=employe_nom.asc,produit_nom.asc",{headers:h})
            ]);
            var [stockCF,mouvements,mvtRecents,employes,stockEmp] = await Promise.all(results.map(function(r){return readBody(r);}));
            var mvtMap={};
            if (Array.isArray(mouvements)) mouvements.forEach(function(m){
                if (!mvtMap[m.produit_id]) mvtMap[m.produit_id]={e:0,s:0,c:0};
                var qty=Number(m.quantite||0);
                if (m.type==="entree"){mvtMap[m.produit_id].e+=qty;mvtMap[m.produit_id].c+=qty*Number(m.prix_achat_kg||0);}
                if (m.type==="sortie") mvtMap[m.produit_id].s+=qty;
            });
            var stock=(Array.isArray(stockCF)?stockCF:[]).map(function(p){
                var m=mvtMap[p.id]||{e:0,s:0,c:0};
                var rev=m.s*Number(p.prix_vente_kg||0), marge=rev-m.c;
                return Object.assign({},p,{total_entrees:m.e,total_sorties:m.s,cout_achat:m.c,revenu_sorties:rev,marge_brute:marge,taux_marge:m.c>0?Number(((marge/m.c)*100).toFixed(1)):null});
            });
            var today=new Date(); today.setHours(0,0,0,0);
            var nbAl=stock.filter(function(p){if(!p.date_expiration)return false;var d=new Date(p.date_expiration);d.setHours(0,0,0,0);return (d-today)/86400000<=2;}).length;
            var parEmp={};
            if (Array.isArray(stockEmp)) stockEmp.forEach(function(row){
                if(!parEmp[row.employe_id])parEmp[row.employe_id]={employe_id:row.employe_id,employe_nom:row.employe_nom,total_kg:0,produits:[]};
                parEmp[row.employe_id].total_kg+=Number(row.quantite||0);
                parEmp[row.employe_id].produits.push(row);
            });
            var tkgCF=stock.reduce(function(s,p){return s+Number(p.quantite||0);},0);
            return jsonResp(200,{stock:stock,mouvements:Array.isArray(mvtRecents)?mvtRecents:[],employes:Array.isArray(employes)?employes:[],stock_employes:Object.values(parEmp),stock_emp_detail:Array.isArray(stockEmp)?stockEmp:[],totaux:{total_kg_cf:Math.round(tkgCF*100)/100,total_achats:Math.round(stock.reduce(function(s,p){return s+(p.cout_achat||0);},0)),total_rev_sorties:Math.round(stock.reduce(function(s,p){return s+(p.revenu_sorties||0);},0)),total_marge:Math.round(stock.reduce(function(s,p){return s+(p.marge_brute||0);},0)),nb_alertes:nbAl,nb_produits:stock.length}});
        }

        if (vue==="admin") {
            if (["admin","super_admin"].indexOf(role)===-1) return jsonResp(403,{error:"Acces reserve aux administrateurs"});
            var todayISO=new Date().toISOString().split("T")[0];
            var res2 = await Promise.all([
                fetch(URL+"/rest/v1/factures?tenant_id=eq."+tenantId+"&select=total_ttc,date_facture,client_nom&order=date_facture.desc",{headers:h}),
                fetch(URL+"/rest/v1/utilisateurs?tenant_id=eq."+tenantId+"&select=id,role&actif=eq.true",{headers:h}),
                fetch(URL+"/rest/v1/produits_cf?tenant_id=eq."+tenantId+"&select=id,date_expiration",{headers:h})
            ]);
            var [factures,users,stockCF2] = await Promise.all(res2.map(function(r){return readBody(r);}));
            var facts=Array.isArray(factures)?factures:[];
            var totalAll=facts.reduce(function(s,f){return s+Number(f.total_ttc||0);},0);
            var totalJour=facts.filter(function(f){return f.date_facture===todayISO;}).reduce(function(s,f){return s+Number(f.total_ttc||0);},0);
            var usrs=Array.isArray(users)?users:[];
            var today2=new Date(); today2.setHours(0,0,0,0);
            var nbAl2=(Array.isArray(stockCF2)?stockCF2:[]).filter(function(p){if(!p.date_expiration)return false;var d=new Date(p.date_expiration);d.setHours(0,0,0,0);return (d-today2)/86400000<=2;}).length;
            return jsonResp(200,{factures:facts,totaux:{total_ventes:Math.round(totalAll),ventes_jour:Math.round(totalJour),nb_employes:usrs.filter(function(u){return u.role==="employe";}).length,nb_gerants:usrs.filter(function(u){return u.role==="gerant";}).length,nb_alertes:nbAl2}});
        }

        return jsonResp(400,{error:"vue invalide : gerant ou admin"});
    } catch(err) { console.error("[stats]",err.message); return jsonResp(500,{error:err.message}); }
}
