-- 1. Link staff_event_tables <-> event_tables bidirectionally + propagate scarico_status
-- 2. Add staff_cash_transactions for live cash collection ("Raccolta Soldi") & full history

ALTER TABLE public.staff_event_tables
  ADD COLUMN IF NOT EXISTS event_table_id uuid REFERENCES public.event_tables(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS extra_no_scarico numeric(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS scarico_status text NOT NULL DEFAULT 'DA SCARICARE'
    CHECK (scarico_status IN ('DA SCARICARE', 'DA NON SCARICARE', '-'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tables_owner_event_table_uniq
  ON public.staff_event_tables (owner_promoter_id, event_table_id)
  WHERE event_table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_tables_event_table_id
  ON public.staff_event_tables (event_table_id)
  WHERE event_table_id IS NOT NULL;

-- Backfill existing staff_event_tables links to matching event_tables (Pass 1: exact normalized name)
WITH st_ranked AS (
  SELECT
    id,
    owner_promoter_id,
    event_id,
    lower(trim(table_name)) AS norm_name,
    row_number() OVER (PARTITION BY owner_promoter_id, event_id, lower(trim(table_name)) ORDER BY sort_order, id) AS rn
  FROM public.staff_event_tables
  WHERE event_table_id IS NULL
),
et_ranked AS (
  SELECT
    id,
    promoter_id,
    event_id,
    lower(trim(table_name)) AS norm_name,
    scarico_status,
    extra_si_scarico,
    extra_no_scarico,
    row_number() OVER (PARTITION BY promoter_id, event_id, lower(trim(table_name)) ORDER BY sort_order, id) AS rn
  FROM public.event_tables
),
matched AS (
  SELECT
    s.id AS staff_table_id,
    e.id AS event_table_id,
    e.scarico_status,
    e.extra_si_scarico,
    e.extra_no_scarico
  FROM st_ranked s
  JOIN et_ranked e
    ON e.event_id = s.event_id
   AND e.promoter_id = s.owner_promoter_id
   AND e.norm_name = s.norm_name
   AND e.rn = s.rn
)
UPDATE public.staff_event_tables st
SET
  event_table_id = m.event_table_id,
  scarico_status = m.scarico_status,
  extra = m.extra_si_scarico,
  extra_no_scarico = m.extra_no_scarico
FROM matched m
WHERE st.id = m.staff_table_id;

-- Pass 2: match remaining unlinked staff tables by same event + payers_count + price
WITH st_rem AS (
  SELECT
    id,
    owner_promoter_id,
    event_id,
    payers_count,
    price,
    row_number() OVER (PARTITION BY owner_promoter_id, event_id, payers_count, price ORDER BY sort_order, id) AS rn
  FROM public.staff_event_tables
  WHERE event_table_id IS NULL
),
et_rem AS (
  SELECT
    e.id,
    e.promoter_id,
    e.event_id,
    e.payers_count,
    e.price,
    e.scarico_status,
    e.extra_si_scarico,
    e.extra_no_scarico,
    row_number() OVER (PARTITION BY e.promoter_id, e.event_id, e.payers_count, e.price ORDER BY e.sort_order, e.id) AS rn
  FROM public.event_tables e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.staff_event_tables st WHERE st.event_table_id = e.id
  )
),
matched2 AS (
  SELECT
    s.id AS staff_table_id,
    e.id AS event_table_id,
    e.scarico_status,
    e.extra_si_scarico,
    e.extra_no_scarico
  FROM st_rem s
  JOIN et_rem e
    ON e.event_id = s.event_id
   AND e.promoter_id = s.owner_promoter_id
   AND e.payers_count = s.payers_count
   AND e.price = s.price
   AND e.rn = s.rn
)
UPDATE public.staff_event_tables st
SET
  event_table_id = m.event_table_id,
  scarico_status = m.scarico_status,
  extra = m.extra_si_scarico,
  extra_no_scarico = m.extra_no_scarico
FROM matched2 m
WHERE st.id = m.staff_table_id;

-- Bidirectional Sync Trigger 1: staff_event_tables BEFORE INSERT -> auto-create linked event_table
CREATE OR REPLACE FUNCTION public.trg_staff_table_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_et_id uuid;
  v_next_sort integer;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.event_table_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) + 1
  INTO v_next_sort
  FROM public.event_tables
  WHERE event_id = NEW.event_id;

  INSERT INTO public.event_tables (
    event_id,
    promoter_id,
    table_name,
    payers_count,
    price,
    surcharge_payers_count,
    surcharge_price,
    extra_no_scarico,
    extra_si_scarico,
    scarico_status,
    sort_order
  ) VALUES (
    NEW.event_id,
    NEW.owner_promoter_id,
    NEW.table_name,
    NEW.payers_count,
    NEW.price,
    NEW.surcharge_payers_count,
    NEW.surcharge_price,
    NEW.extra_no_scarico,
    NEW.extra,
    NEW.scarico_status,
    v_next_sort
  )
  RETURNING id INTO v_et_id;

  NEW.event_table_id := v_et_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_table_before_insert_sync ON public.staff_event_tables;
CREATE TRIGGER staff_table_before_insert_sync
  BEFORE INSERT ON public.staff_event_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_staff_table_before_insert();

-- Bidirectional Sync Trigger 2: staff_event_tables AFTER UPDATE -> mirror to linked event_table
CREATE OR REPLACE FUNCTION public.trg_staff_table_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.event_table_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.table_name IS DISTINCT FROM OLD.table_name
     OR NEW.payers_count IS DISTINCT FROM OLD.payers_count
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.surcharge_payers_count IS DISTINCT FROM OLD.surcharge_payers_count
     OR NEW.surcharge_price IS DISTINCT FROM OLD.surcharge_price
     OR NEW.extra IS DISTINCT FROM OLD.extra
     OR NEW.extra_no_scarico IS DISTINCT FROM OLD.extra_no_scarico
     OR NEW.scarico_status IS DISTINCT FROM OLD.scarico_status THEN
    UPDATE public.event_tables
    SET
      table_name = NEW.table_name,
      payers_count = NEW.payers_count,
      price = NEW.price,
      surcharge_payers_count = NEW.surcharge_payers_count,
      surcharge_price = NEW.surcharge_price,
      extra_si_scarico = NEW.extra,
      extra_no_scarico = NEW.extra_no_scarico,
      scarico_status = NEW.scarico_status
    WHERE id = NEW.event_table_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_table_after_update_sync ON public.staff_event_tables;
CREATE TRIGGER staff_table_after_update_sync
  AFTER UPDATE ON public.staff_event_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_staff_table_after_update();

-- Bidirectional Sync Trigger 3: staff_event_tables AFTER DELETE -> delete linked event_table
CREATE OR REPLACE FUNCTION public.trg_staff_table_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR OLD.event_table_id IS NULL THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.event_tables WHERE id = OLD.event_table_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS staff_table_after_delete_sync ON public.staff_event_tables;
CREATE TRIGGER staff_table_after_delete_sync
  AFTER DELETE ON public.staff_event_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_staff_table_after_delete();

-- Bidirectional Sync Trigger 4: event_tables AFTER INSERT -> auto-create linked staff_event_table
CREATE OR REPLACE FUNCTION public.trg_event_table_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self_id uuid;
  v_self_name text;
  v_next_sort integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.promoter_id NOT IN ('lollo', 'ciccio') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.staff_groups WHERE owner_promoter_id = NEW.promoter_id) THEN
    RETURN NEW;
  END IF;

  SELECT id, COALESCE(NULLIF(nickname, ''), full_name)
  INTO v_self_id, v_self_name
  FROM public.staff_members
  WHERE owner_promoter_id = NEW.promoter_id AND is_self = true
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT COALESCE(MAX(sort_order), -1) + 1
  INTO v_next_sort
  FROM public.staff_event_tables
  WHERE owner_promoter_id = NEW.promoter_id AND event_id = NEW.event_id;

  INSERT INTO public.staff_event_tables (
    owner_promoter_id,
    event_id,
    event_table_id,
    staff_member_id,
    promoter_name,
    table_name,
    payers_count,
    price,
    surcharge_payers_count,
    surcharge_price,
    extra,
    extra_no_scarico,
    scarico_status,
    sort_order
  ) VALUES (
    NEW.promoter_id,
    NEW.event_id,
    NEW.id,
    v_self_id,
    COALESCE(v_self_name, 'Io'),
    NEW.table_name,
    NEW.payers_count,
    NEW.price,
    NEW.surcharge_payers_count,
    NEW.surcharge_price,
    NEW.extra_si_scarico,
    NEW.extra_no_scarico,
    NEW.scarico_status,
    v_next_sort
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_table_after_insert_sync ON public.event_tables;
CREATE TRIGGER event_table_after_insert_sync
  AFTER INSERT ON public.event_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_event_table_after_insert();

-- Bidirectional Sync Trigger 5: event_tables AFTER UPDATE -> mirror to linked staff_event_table
CREATE OR REPLACE FUNCTION public.trg_event_table_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self_id uuid;
  v_self_name text;
  v_next_sort integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- If promoter changed between lollo <-> ciccio (or filo), move linked staff table cleanly
  IF NEW.promoter_id IS DISTINCT FROM OLD.promoter_id THEN
    DELETE FROM public.staff_event_tables WHERE event_table_id = NEW.id;
    IF NEW.promoter_id IN ('lollo', 'ciccio')
       AND EXISTS (SELECT 1 FROM public.staff_groups WHERE owner_promoter_id = NEW.promoter_id) THEN
      SELECT id, COALESCE(NULLIF(nickname, ''), full_name)
      INTO v_self_id, v_self_name
      FROM public.staff_members
      WHERE owner_promoter_id = NEW.promoter_id AND is_self = true
      ORDER BY created_at ASC
      LIMIT 1;

      SELECT COALESCE(MAX(sort_order), -1) + 1
      INTO v_next_sort
      FROM public.staff_event_tables
      WHERE owner_promoter_id = NEW.promoter_id AND event_id = NEW.event_id;

      INSERT INTO public.staff_event_tables (
        owner_promoter_id,
        event_id,
        event_table_id,
        staff_member_id,
        promoter_name,
        table_name,
        payers_count,
        price,
        surcharge_payers_count,
        surcharge_price,
        extra,
        extra_no_scarico,
        scarico_status,
        sort_order
      ) VALUES (
        NEW.promoter_id,
        NEW.event_id,
        NEW.id,
        v_self_id,
        COALESCE(v_self_name, 'Io'),
        NEW.table_name,
        NEW.payers_count,
        NEW.price,
        NEW.surcharge_payers_count,
        NEW.surcharge_price,
        NEW.extra_si_scarico,
        NEW.extra_no_scarico,
        NEW.scarico_status,
        v_next_sort
      )
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.table_name IS DISTINCT FROM OLD.table_name
     OR NEW.payers_count IS DISTINCT FROM OLD.payers_count
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.surcharge_payers_count IS DISTINCT FROM OLD.surcharge_payers_count
     OR NEW.surcharge_price IS DISTINCT FROM OLD.surcharge_price
     OR NEW.extra_si_scarico IS DISTINCT FROM OLD.extra_si_scarico
     OR NEW.extra_no_scarico IS DISTINCT FROM OLD.extra_no_scarico
     OR NEW.scarico_status IS DISTINCT FROM OLD.scarico_status THEN
    UPDATE public.staff_event_tables
    SET
      table_name = NEW.table_name,
      payers_count = NEW.payers_count,
      price = NEW.price,
      surcharge_payers_count = NEW.surcharge_payers_count,
      surcharge_price = NEW.surcharge_price,
      extra = NEW.extra_si_scarico,
      extra_no_scarico = NEW.extra_no_scarico,
      scarico_status = NEW.scarico_status
    WHERE event_table_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_table_after_update_sync ON public.event_tables;
CREATE TRIGGER event_table_after_update_sync
  AFTER UPDATE ON public.event_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_event_table_after_update();

-- 3. Staff Cash Transactions ("Raccolta Soldi" + Cronologia completa)
CREATE TABLE IF NOT EXISTS public.staff_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_promoter_id text NOT NULL REFERENCES public.staff_groups(owner_promoter_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  promoter_name text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'card', 'transfer', 'other')),
  note text NOT NULL DEFAULT '',
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_cash_tx_owner_event_time
  ON public.staff_cash_transactions (owner_promoter_id, event_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_cash_tx_member
  ON public.staff_cash_transactions (staff_member_id)
  WHERE staff_member_id IS NOT NULL;

ALTER TABLE public.staff_cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_only_staff_cash_transactions" ON public.staff_cash_transactions;
CREATE POLICY "owner_only_staff_cash_transactions" ON public.staff_cash_transactions
  FOR ALL TO authenticated
  USING (owner_promoter_id = (SELECT public.current_promoter_id()))
  WITH CHECK (owner_promoter_id = (SELECT public.current_promoter_id()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'staff_cash_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_cash_transactions;
  END IF;
END;
$$;
