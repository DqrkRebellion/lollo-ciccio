-- Personal Staff Workspaces (Reverse for Lollo, Ice for Ciccio)
-- Shares public.events as base events, with strict per-owner RLS privacy.

CREATE OR REPLACE FUNCTION public.current_promoter_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'promoter_id', ''),
    CASE
      WHEN lower(COALESCE(auth.jwt() ->> 'email', '')) LIKE 'ciccio%' THEN 'ciccio'
      ELSE 'lollo'
    END
  );
$$;

-- 1. Staff Groups (Reverse = lollo, Ice = ciccio)
CREATE TABLE IF NOT EXISTS public.staff_groups (
  owner_promoter_id text PRIMARY KEY CHECK (owner_promoter_id IN ('lollo', 'ciccio')),
  name text NOT NULL,
  default_presale_tiers jsonb NOT NULL DEFAULT '[
    {"min": 40, "inclusive": false, "rate": 1.0},
    {"min": 20, "inclusive": false, "rate": 0.5}
  ]'::jsonb,
  default_table_tiers jsonb NOT NULL DEFAULT '[
    {"min": 1000, "inclusive": true, "rate": 0.07},
    {"min": 400, "inclusive": true, "rate": 0.04}
  ]'::jsonb,
  sum_tables_per_pr boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.staff_groups (owner_promoter_id, name) VALUES
  ('lollo', 'Reverse'),
  ('ciccio', 'Ice')
ON CONFLICT (owner_promoter_id) DO NOTHING;

CREATE TRIGGER trg_staff_groups_updated_at
  BEFORE UPDATE ON public.staff_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Reusable Commission Plans ("Piani Busta") per Staff Group
CREATE TABLE IF NOT EXISTS public.staff_commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_promoter_id text NOT NULL REFERENCES public.staff_groups(owner_promoter_id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  presale_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  table_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_promoter_id, name)
);

CREATE INDEX IF NOT EXISTS idx_staff_plans_owner ON public.staff_commission_plans (owner_promoter_id);

-- Seed starter commission plans for both Reverse (lollo) and Ice (ciccio)
INSERT INTO public.staff_commission_plans (owner_promoter_id, name, description, presale_tiers, table_tiers, is_default) VALUES
  (
    'lollo',
    'Standard',
    'Preve: >20 → 0,50 € · >40 → 1,00 € | Tavoli: ≥400 € → 4% · ≥1.000 € → 7%',
    '[{"min": 40, "inclusive": false, "rate": 1.0}, {"min": 20, "inclusive": false, "rate": 0.5}]'::jsonb,
    '[{"min": 1000, "inclusive": true, "rate": 0.07}, {"min": 400, "inclusive": true, "rate": 0.04}]'::jsonb,
    true
  ),
  (
    'lollo',
    'Senior / Top PR',
    'Preve: ≥15 → 0,50 € · ≥30 → 1,00 € | Tavoli: ≥300 € → 5% · ≥800 € → 8%',
    '[{"min": 30, "inclusive": true, "rate": 1.0}, {"min": 15, "inclusive": true, "rate": 0.5}]'::jsonb,
    '[{"min": 800, "inclusive": true, "rate": 0.08}, {"min": 300, "inclusive": true, "rate": 0.05}]'::jsonb,
    false
  ),
  (
    'lollo',
    'Fisso 1 € / Preve',
    'Sempre 1,00 € a prevendita da 1 in su | Tavoli: ≥400 € → 5% · ≥1.000 € → 8%',
    '[{"min": 1, "inclusive": true, "rate": 1.0}]'::jsonb,
    '[{"min": 1000, "inclusive": true, "rate": 0.08}, {"min": 400, "inclusive": true, "rate": 0.05}]'::jsonb,
    false
  ),
  (
    'lollo',
    'Nessuna busta (Capo / Io)',
    'Nessuna provvigione sub-PR (usato per vendite dirette)',
    '[]'::jsonb,
    '[]'::jsonb,
    false
  ),
  (
    'ciccio',
    'Standard',
    'Preve: >20 → 0,50 € · >40 → 1,00 € | Tavoli: ≥400 € → 4% · ≥1.000 € → 7%',
    '[{"min": 40, "inclusive": false, "rate": 1.0}, {"min": 20, "inclusive": false, "rate": 0.5}]'::jsonb,
    '[{"min": 1000, "inclusive": true, "rate": 0.07}, {"min": 400, "inclusive": true, "rate": 0.04}]'::jsonb,
    true
  ),
  (
    'ciccio',
    'Senior / Top PR',
    'Preve: ≥15 → 0,50 € · ≥30 → 1,00 € | Tavoli: ≥300 € → 5% · ≥800 € → 8%',
    '[{"min": 30, "inclusive": true, "rate": 1.0}, {"min": 15, "inclusive": true, "rate": 0.5}]'::jsonb,
    '[{"min": 800, "inclusive": true, "rate": 0.08}, {"min": 300, "inclusive": true, "rate": 0.05}]'::jsonb,
    false
  ),
  (
    'ciccio',
    'Nessuna busta (Capo / Io)',
    'Nessuna provvigione sub-PR (usato per vendite dirette)',
    '[]'::jsonb,
    '[]'::jsonb,
    false
  )
ON CONFLICT (owner_promoter_id, name) DO NOTHING;

-- 3. Staff Members (Sub-PR Roster per Staff Group)
CREATE TABLE IF NOT EXISTS public.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_promoter_id text NOT NULL REFERENCES public.staff_groups(owner_promoter_id) ON DELETE CASCADE,
  full_name text NOT NULL,
  nickname text NOT NULL DEFAULT '',
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  plan_id uuid REFERENCES public.staff_commission_plans(id) ON DELETE SET NULL,
  custom_presale_tiers jsonb,
  custom_table_tiers jsonb,
  is_self boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_promoter_id, full_name)
);

CREATE INDEX IF NOT EXISTS idx_staff_members_owner ON public.staff_members (owner_promoter_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_plan ON public.staff_members (plan_id);

-- 4. Staff Event Presales (sub-PR presales attached to shared events)
CREATE TABLE IF NOT EXISTS public.staff_event_presales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_promoter_id text NOT NULL REFERENCES public.staff_groups(owner_promoter_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  promoter_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  revenue numeric(12, 2) NOT NULL DEFAULT 0.00,
  scarico numeric(12, 2) NOT NULL DEFAULT 0.00,
  note_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  note_text text NOT NULL DEFAULT '',
  paid_cash numeric(12, 2) NOT NULL DEFAULT 0.00,
  busta_override numeric(12, 2),
  is_busta_paid boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_presales_owner_event ON public.staff_event_presales (owner_promoter_id, event_id);
CREATE INDEX IF NOT EXISTS idx_staff_presales_member ON public.staff_event_presales (staff_member_id);

-- 5. Staff Event Tables (sub-PR tables attached to shared events)
CREATE TABLE IF NOT EXISTS public.staff_event_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_promoter_id text NOT NULL REFERENCES public.staff_groups(owner_promoter_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  promoter_name text NOT NULL,
  table_name text NOT NULL DEFAULT '',
  payers_count integer NOT NULL DEFAULT 0,
  price numeric(10, 2) NOT NULL DEFAULT 0.00,
  surcharge_payers_count integer NOT NULL DEFAULT 0,
  surcharge_price numeric(10, 2) NOT NULL DEFAULT 0.00,
  extra numeric(12, 2) NOT NULL DEFAULT 0.00,
  paid_cash numeric(12, 2) NOT NULL DEFAULT 0.00,
  busta_override numeric(12, 2),
  is_busta_paid boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_tables_owner_event ON public.staff_event_tables (owner_promoter_id, event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_staff_tables_member ON public.staff_event_tables (staff_member_id);

-- 6. Strict Per-Owner RLS Policies (Lollo sees Reverse ONLY; Ciccio sees Ice ONLY!)
ALTER TABLE public.staff_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_event_presales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_event_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_only_staff_groups" ON public.staff_groups
  FOR ALL TO authenticated
  USING (owner_promoter_id = public.current_promoter_id())
  WITH CHECK (owner_promoter_id = public.current_promoter_id());

CREATE POLICY "owner_only_staff_plans" ON public.staff_commission_plans
  FOR ALL TO authenticated
  USING (owner_promoter_id = public.current_promoter_id())
  WITH CHECK (owner_promoter_id = public.current_promoter_id());

CREATE POLICY "owner_only_staff_members" ON public.staff_members
  FOR ALL TO authenticated
  USING (owner_promoter_id = public.current_promoter_id())
  WITH CHECK (owner_promoter_id = public.current_promoter_id());

CREATE POLICY "owner_only_staff_presales" ON public.staff_event_presales
  FOR ALL TO authenticated
  USING (owner_promoter_id = public.current_promoter_id())
  WITH CHECK (owner_promoter_id = public.current_promoter_id());

CREATE POLICY "owner_only_staff_tables" ON public.staff_event_tables
  FOR ALL TO authenticated
  USING (owner_promoter_id = public.current_promoter_id())
  WITH CHECK (owner_promoter_id = public.current_promoter_id());

-- 7. Enable Realtime sync on all personal staff tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_commission_plans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_event_presales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_event_tables;
