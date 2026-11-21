-- Restrict all TicketSMS read policies strictly to Lollo's profile (`public.current_promoter_id() = 'lollo'`).
-- Service role writes (sync_to_supabase.py) bypass RLS as before.
-- Shared public.events & public.event_presales remain visible to both Lollo & Ciccio.

DROP POLICY IF EXISTS "authenticated_read_ticketsms_events" ON public.ticketsms_events;
DROP POLICY IF EXISTS "Authenticated read ticketsms_events" ON public.ticketsms_events;
CREATE POLICY "lollo_only_read_ticketsms_events" ON public.ticketsms_events
  FOR SELECT TO authenticated
  USING (public.current_promoter_id() = 'lollo');

DROP POLICY IF EXISTS "authenticated_read_ticketsms_ticket_types" ON public.ticketsms_ticket_types;
DROP POLICY IF EXISTS "Authenticated read ticketsms_ticket_types" ON public.ticketsms_ticket_types;
CREATE POLICY "lollo_only_read_ticketsms_ticket_types" ON public.ticketsms_ticket_types
  FOR SELECT TO authenticated
  USING (public.current_promoter_id() = 'lollo');

DROP POLICY IF EXISTS "authenticated_read_ticketsms_team_sales" ON public.ticketsms_team_sales;
DROP POLICY IF EXISTS "Authenticated read ticketsms_team_sales" ON public.ticketsms_team_sales;
CREATE POLICY "lollo_only_read_ticketsms_team_sales" ON public.ticketsms_team_sales
  FOR SELECT TO authenticated
  USING (public.current_promoter_id() = 'lollo');

DROP POLICY IF EXISTS "authenticated_read_ticketsms_report_rows" ON public.ticketsms_event_report_rows;
DROP POLICY IF EXISTS "Authenticated read ticketsms_event_report_rows" ON public.ticketsms_event_report_rows;
CREATE POLICY "lollo_only_read_ticketsms_report_rows" ON public.ticketsms_event_report_rows
  FOR SELECT TO authenticated
  USING (public.current_promoter_id() = 'lollo');

DROP POLICY IF EXISTS "authenticated_read_ticketsms_sync_status" ON public.ticketsms_sync_status;
DROP POLICY IF EXISTS "Authenticated read ticketsms_sync_status" ON public.ticketsms_sync_status;
CREATE POLICY "lollo_only_read_ticketsms_sync_status" ON public.ticketsms_sync_status
  FOR SELECT TO authenticated
  USING (public.current_promoter_id() = 'lollo');
