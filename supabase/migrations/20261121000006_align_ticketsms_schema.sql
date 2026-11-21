-- Align ticketsms_* schema 100% with ticketsms-api/supabase_schema.sql & sync_to_supabase.py

ALTER TABLE public.ticketsms_events
  ALTER COLUMN year TYPE text USING year::text,
  ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.ticketsms_ticket_types
  ALTER COLUMN ticket_type_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticketsms_ticket_types_event_id_name_key'
  ) THEN
    ALTER TABLE public.ticketsms_ticket_types
      ADD CONSTRAINT ticketsms_ticket_types_event_id_name_key UNIQUE (event_id, name);
  END IF;
END;
$$;

ALTER TABLE public.ticketsms_team_sales
  ALTER COLUMN pr_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticketsms_team_sales_event_id_pr_name_key'
  ) THEN
    ALTER TABLE public.ticketsms_team_sales
      ADD CONSTRAINT ticketsms_team_sales_event_id_pr_name_key UNIQUE (event_id, pr_name);
  END IF;
END;
$$;
