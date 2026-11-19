-- Lollo & Ciccio PR Management — Initial Schema
-- Follows Supabase Postgres Best Practices: proper numeric money types, FK indexes, strict RLS, Realtime.

-- 1. Helper trigger function for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. App Settings (singleton row id = 1)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  team_name text NOT NULL DEFAULT 'Lollo & Ciccio',
  presale_commission numeric(10, 2) NOT NULL DEFAULT 1.00,
  table_rate_no_guest numeric(6, 4) NOT NULL DEFAULT 0.1000,
  table_rate_guest numeric(6, 4) NOT NULL DEFAULT 0.0800,
  default_lista_cost numeric(10, 2) NOT NULL DEFAULT 0.00,
  bonus_tiers jsonb NOT NULL DEFAULT '[
    {"threshold": 10000, "bonus": 400},
    {"threshold": 6000, "bonus": 300},
    {"threshold": 4000, "bonus": 200},
    {"threshold": 2000, "bonus": 100}
  ]'::jsonb,
  bonus_split_mode text NOT NULL DEFAULT 'revenue_proportional'
    CHECK (bonus_split_mode IN ('revenue_proportional', 'equal', 'px_proportional')),
  default_presale_input_mode text NOT NULL DEFAULT 'per_pr'
    CHECK (default_presale_input_mode IN ('per_pr', 'total_minus_primary')),
  default_table_scarico text NOT NULL DEFAULT 'DA SCARICARE'
    CHECK (default_table_scarico IN ('DA SCARICARE', 'DA NON SCARICARE', '-')),
  quick_table_prices jsonb NOT NULL DEFAULT '[25, 30, 35, 50]'::jsonb,
  show_surcharge_columns boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Promoters
CREATE TABLE IF NOT EXISTS public.promoters (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  full_name text NOT NULL,
  color text NOT NULL DEFAULT '#0071E3',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.promoters (id, display_name, full_name, color, is_active, sort_order) VALUES
  ('lollo', 'Lollo', 'Lorenzo Biondi', '#0071E3', true, 1),
  ('ciccio', 'Ciccio', 'Francesco Troiano', '#5856D6', true, 2),
  ('filo', 'Filo', 'Filippo Giulianini', '#8E8E93', false, 3)
ON CONFLICT (id) DO NOTHING;

-- 4. Venues (Locali / Club)
CREATE TABLE IF NOT EXISTS public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#0071E3',
  default_mode text NOT NULL DEFAULT 'NO OSPITE'
    CHECK (default_mode IN ('OSPITE', 'NO OSPITE', '-')),
  default_table_price numeric(10, 2) NOT NULL DEFAULT 30.00,
  default_lista_cost numeric(10, 2) NOT NULL DEFAULT 0.00,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Events (Serate)
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  sheet_name text,
  venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  venue_name text NOT NULL,
  event_date date NOT NULL,
  mode text NOT NULL DEFAULT 'NO OSPITE'
    CHECK (mode IN ('OSPITE', 'NO OSPITE', '-')),
  era text NOT NULL DEFAULT '2PX'
    CHECK (era IN ('2PX', '3PX')),
  is_busta_paid boolean NOT NULL DEFAULT false,
  lista_cost numeric(10, 2) NOT NULL DEFAULT 0.00,
  general_note_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  general_note_text text NOT NULL DEFAULT '',
  presale_input_mode text NOT NULL DEFAULT 'per_pr'
    CHECK (presale_input_mode IN ('per_pr', 'total_minus_primary')),
  busta_override numeric(12, 2),
  commission_config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_date_desc ON public.events (event_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_venue_id ON public.events (venue_id);

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. Event Presales (Prevendite per PR)
CREATE TABLE IF NOT EXISTS public.event_presales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  promoter_id text NOT NULL REFERENCES public.promoters(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 0,
  revenue numeric(12, 2) NOT NULL DEFAULT 0.00,
  one_to_one numeric(12, 2) NOT NULL DEFAULT 0.00,
  UNIQUE (event_id, promoter_id)
);

CREATE INDEX IF NOT EXISTS idx_event_presales_event_id ON public.event_presales (event_id);
CREATE INDEX IF NOT EXISTS idx_event_presales_promoter_id ON public.event_presales (promoter_id);

-- 7. Event Tables (Tavoli)
CREATE TABLE IF NOT EXISTS public.event_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  promoter_id text NOT NULL REFERENCES public.promoters(id) ON DELETE RESTRICT,
  table_name text NOT NULL DEFAULT '',
  payers_count integer NOT NULL DEFAULT 0,
  price numeric(10, 2) NOT NULL DEFAULT 0.00,
  surcharge_payers_count integer NOT NULL DEFAULT 0,
  surcharge_price numeric(10, 2) NOT NULL DEFAULT 0.00,
  extra_no_scarico numeric(12, 2) NOT NULL DEFAULT 0.00,
  extra_si_scarico numeric(12, 2) NOT NULL DEFAULT 0.00,
  scarico_status text NOT NULL DEFAULT 'DA SCARICARE'
    CHECK (scarico_status IN ('DA SCARICARE', 'DA NON SCARICARE', '-')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_tables_event_id ON public.event_tables (event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_tables_promoter_id ON public.event_tables (promoter_id);

-- 8. Event PR Reconciliations (Lista PR, Note €, Scaricato €)
CREATE TABLE IF NOT EXISTS public.event_pr_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  promoter_id text NOT NULL REFERENCES public.promoters(id) ON DELETE RESTRICT,
  lista_pr_count integer NOT NULL DEFAULT 0,
  note_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  note_text text NOT NULL DEFAULT '',
  scaricato_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  UNIQUE (event_id, promoter_id)
);

CREATE INDEX IF NOT EXISTS idx_event_recons_event_id ON public.event_pr_reconciliations (event_id);
CREATE INDEX IF NOT EXISTS idx_event_recons_promoter_id ON public.event_pr_reconciliations (promoter_id);

-- 9. Row Level Security (strict: authenticated team members only, ZERO anon data access)
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_presales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_pr_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_app_settings" ON public.app_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_promoters" ON public.promoters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_venues" ON public.venues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_events" ON public.events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_event_presales" ON public.event_presales
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_event_tables" ON public.event_tables
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_event_pr_reconciliations" ON public.event_pr_reconciliations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 10. Harmless keep-alive RPC for free-tier uptime cron (exposes zero data)
CREATE OR REPLACE FUNCTION public.keepalive_ping()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('status', 'ok', 'ts', now());
$$;

REVOKE ALL ON FUNCTION public.keepalive_ping() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keepalive_ping() TO anon, authenticated;

-- 11. Enable Supabase Realtime for instant sync between Lollo & Ciccio
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.promoters;
ALTER PUBLICATION supabase_realtime ADD TABLE public.venues;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_presales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_pr_reconciliations;
