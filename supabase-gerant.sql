-- ═══════════════════════════════════════════════════════════
-- AquaDash – Système de gestion chambre froide / gérant
-- Exécuter dans Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ── 1. Table des mouvements de stock ──
-- Enregistre chaque entrée (achat), sortie (transfert vers employé),
-- et ajustement (inventaire) de la chambre froide.
CREATE TABLE IF NOT EXISTS public.mouvements_stock (
    id            BIGSERIAL PRIMARY KEY,
    produit_id    BIGINT NOT NULL REFERENCES public.produits(id) ON DELETE CASCADE,
    type          TEXT NOT NULL CHECK (type IN ('entree', 'sortie', 'ajustement')),
    quantite      NUMERIC(10,2) NOT NULL CHECK (quantite > 0),
    -- Pour les entrées : prix d'achat unitaire (kg)
    prix_achat_kg NUMERIC(10,2) DEFAULT NULL,
    -- Pour les sorties : employé destinataire
    employe_id    UUID DEFAULT NULL REFERENCES public.utilisateurs(id) ON DELETE SET NULL,
    employe_nom   TEXT DEFAULT NULL,   -- snapshot du nom au moment du transfert
    -- Informations complémentaires
    note          TEXT DEFAULT NULL,
    created_by    UUID DEFAULT NULL REFERENCES public.utilisateurs(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Ajouter prix_achat_kg à la table produits (si absent) ──
ALTER TABLE public.produits
    ADD COLUMN IF NOT EXISTS prix_achat_kg NUMERIC(10,2) DEFAULT NULL;

-- ── 3. Index pour performances ──
CREATE INDEX IF NOT EXISTS idx_mouvements_produit    ON public.mouvements_stock(produit_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_type       ON public.mouvements_stock(type);
CREATE INDEX IF NOT EXISTS idx_mouvements_employe    ON public.mouvements_stock(employe_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_created_at ON public.mouvements_stock(created_at DESC);

-- ── 4. Désactiver RLS pour simplicité ──
ALTER TABLE public.mouvements_stock DISABLE ROW LEVEL SECURITY;

-- ── 5. Vue : stock actuel par produit (entrées - sorties) ──
CREATE OR REPLACE VIEW public.v_stock_actuel AS
SELECT
    p.id,
    p.nom,
    p.reference,
    p.quantite                                    AS stock_windev,
    p.prix_kg                                     AS prix_vente_kg,
    p.prix_achat_kg,
    p.date_expiration,
    COALESCE(SUM(CASE WHEN m.type = 'entree'      THEN m.quantite ELSE 0 END), 0) AS total_entrees,
    COALESCE(SUM(CASE WHEN m.type = 'sortie'      THEN m.quantite ELSE 0 END), 0) AS total_sorties,
    COALESCE(SUM(CASE WHEN m.type = 'entree'      THEN m.quantite ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN m.type = 'sortie'      THEN m.quantite ELSE 0 END), 0) AS stock_calcule
FROM public.produits p
LEFT JOIN public.mouvements_stock m ON m.produit_id = p.id
GROUP BY p.id, p.nom, p.reference, p.quantite, p.prix_kg, p.prix_achat_kg, p.date_expiration;

-- ── 6. Vue : marge bénéficiaire par produit ──
-- Achat = total kg achetés × prix_achat_kg moyen
-- Vente = total des factures (depuis table factures si disponible)
CREATE OR REPLACE VIEW public.v_marge_produits AS
SELECT
    p.id,
    p.nom,
    p.prix_kg                                          AS prix_vente_kg,
    COALESCE(AVG(CASE WHEN m.type = 'entree' AND m.prix_achat_kg IS NOT NULL
                      THEN m.prix_achat_kg END), p.prix_achat_kg, 0) AS prix_achat_moy,
    COALESCE(SUM(CASE WHEN m.type = 'entree' THEN m.quantite ELSE 0 END), 0) AS kg_achetes,
    COALESCE(SUM(CASE WHEN m.type = 'sortie' THEN m.quantite ELSE 0 END), 0) AS kg_vendus,
    -- Coût total des achats
    COALESCE(SUM(CASE WHEN m.type = 'entree'
                      THEN m.quantite * COALESCE(m.prix_achat_kg, p.prix_achat_kg, 0)
                      ELSE 0 END), 0)                   AS cout_total_achat,
    -- Revenu potentiel si tout vendu au prix de vente
    COALESCE(SUM(CASE WHEN m.type = 'sortie'
                      THEN m.quantite * COALESCE(p.prix_kg, 0)
                      ELSE 0 END), 0)                   AS revenu_sorties
FROM public.produits p
LEFT JOIN public.mouvements_stock m ON m.produit_id = p.id
GROUP BY p.id, p.nom, p.prix_kg, p.prix_achat_kg;

-- ── 7. Vue : derniers mouvements avec détails ──
CREATE OR REPLACE VIEW public.v_mouvements_detail AS
SELECT
    m.id,
    m.type,
    m.quantite,
    m.prix_achat_kg,
    m.employe_nom,
    m.note,
    m.created_at,
    p.nom        AS produit_nom,
    p.reference  AS produit_ref,
    u.nom        AS createur_nom
FROM public.mouvements_stock m
LEFT JOIN public.produits     p ON p.id = m.produit_id
LEFT JOIN public.utilisateurs u ON u.id = m.created_by
ORDER BY m.created_at DESC;

-- ── VÉRIFICATION ──
-- SELECT * FROM public.v_stock_actuel;
-- SELECT * FROM public.v_marge_produits;
-- SELECT * FROM public.v_mouvements_detail LIMIT 20;
