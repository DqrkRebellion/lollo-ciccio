-- Allow both Lollo and Ciccio to read TicketSMS sync status & receive live refresh notifications
-- when the combined Lollo + Ciccio TicketSMS sync completes.
-- Raw TicketSMS mirror tables remain strictly restricted to Lollo; Ciccio's synced data
-- populates shared `events`/`event_presales` and his RLS-isolated `staff_*` tables (`owner_promoter_id = 'ciccio'`).

DROP POLICY IF EXISTS "authenticated_read_ticketsms_sync_status" ON public.ticketsms_sync_status;
DROP POLICY IF EXISTS "Authenticated read ticketsms_sync_status" ON public.ticketsms_sync_status;
DROP POLICY IF EXISTS "lollo_only_read_ticketsms_sync_status" ON public.ticketsms_sync_status;
DROP POLICY IF EXISTS "team_read_ticketsms_sync_status" ON public.ticketsms_sync_status;

CREATE POLICY "team_read_ticketsms_sync_status" ON public.ticketsms_sync_status
  FOR SELECT TO authenticated
  USING ((SELECT public.current_promoter_id()) IN ('lollo', 'ciccio'));
