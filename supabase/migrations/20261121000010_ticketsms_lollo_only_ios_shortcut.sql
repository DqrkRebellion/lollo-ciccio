-- Restore Lollo-only RLS on ticketsms_sync_status (Lollo syncs via iOS Shortcut; Ciccio enters totals manually)

DROP POLICY IF EXISTS "team_read_ticketsms_sync_status" ON public.ticketsms_sync_status;
DROP POLICY IF EXISTS "lollo_only_read_ticketsms_sync_status" ON public.ticketsms_sync_status;

CREATE POLICY "lollo_only_read_ticketsms_sync_status" ON public.ticketsms_sync_status
  FOR SELECT TO authenticated
  USING ((SELECT public.current_promoter_id()) = 'lollo');
