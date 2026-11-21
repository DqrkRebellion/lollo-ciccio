import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import type {
  TicketSmsEvent,
  TicketSmsReportRow,
  TicketSmsSyncState,
  TicketSmsSyncStatus,
  TicketSmsTeamSale,
  TicketSmsTicketType,
} from '../types/ticketsms';

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(v: unknown): TicketSmsSyncState {
  if (v === 'session_expired' || v === 'error') return v;
  return 'ok';
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_DURATION_MS = 45000;

export function useTicketSmsData(
  isAuthenticated: boolean,
  onSyncCompleted?: () => void
) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<TicketSmsEvent[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketSmsTicketType[]>([]);
  const [teamSales, setTeamSales] = useState<TicketSmsTeamSale[]>([]);
  const [reportRows, setReportRows] = useState<TicketSmsReportRow[]>([]);
  const [syncStatus, setSyncStatus] = useState<TicketSmsSyncStatus | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncElapsedSec, setSyncElapsedSec] = useState(0);

  const pollTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const reloadTimerRef = useRef<number | null>(null);
  const syncStatusRef = useRef<TicketSmsSyncStatus | null>(null);
  syncStatusRef.current = syncStatus;
  const onSyncCompletedRef = useRef(onSyncCompleted);
  onSyncCompletedRef.current = onSyncCompleted;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    setSyncing(false);
    setSyncElapsedSec(0);
  }, []);

  const fetchTicketSms = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [evRes, typesRes, teamRes, reportRes, statusRes] = await Promise.all([
        supabase
          .from('ticketsms_events')
          .select('*')
          .order('event_date', { ascending: false }),
        supabase
          .from('ticketsms_ticket_types')
          .select('*')
          .order('price', { ascending: true })
          .order('name', { ascending: true }),
        supabase
          .from('ticketsms_team_sales')
          .select('*')
          .order('sold', { ascending: false })
          .order('total', { ascending: false }),
        supabase
          .from('ticketsms_event_report_rows')
          .select('*')
          .order('row_order', { ascending: true }),
        supabase
          .from('ticketsms_sync_status')
          .select('*')
          .eq('id', 1)
          .maybeSingle(),
      ]);

      const firstErr =
        evRes.error || typesRes.error || teamRes.error || reportRes.error || statusRes.error;
      if (firstErr) throw firstErr;

      setEvents(
        (evRes.data || []).map((e) => ({
          event_id: toNum(e.event_id),
          name: String(e.name ?? ''),
          event_date: e.event_date ? String(e.event_date) : null,
          weekday: e.weekday ? String(e.weekday) : null,
          month: e.month ? String(e.month) : null,
          year: e.year !== null && e.year !== undefined ? toNum(e.year) : null,
          location_name: e.location_name ? String(e.location_name) : null,
          location_full: e.location_full ? String(e.location_full) : null,
          cover_image_url: e.cover_image_url ? String(e.cover_image_url) : null,
          dash_url: e.dash_url ? String(e.dash_url) : null,
          shop_url: e.shop_url ? String(e.shop_url) : null,
          is_active: Boolean(e.is_active),
          is_canceled: Boolean(e.is_canceled),
          tickets_sent: toNum(e.tickets_sent, 0),
          total_profit: toNum(e.total_profit, 0),
          entered: toNum(e.entered, 0),
          time_to_end: e.time_to_end ? String(e.time_to_end) : null,
          synced_at: e.synced_at ? String(e.synced_at) : null,
        }))
      );

      setTicketTypes(
        (typesRes.data || []).map((t) => ({
          id: String(t.id),
          event_id: toNum(t.event_id),
          ticket_type_id: String(t.ticket_type_id ?? t.id),
          name: String(t.name ?? ''),
          description: t.description ? String(t.description) : null,
          price: toNum(t.price, 0),
          sold: toNum(t.sold, 0),
          entered: toNum(t.entered, 0),
          total: toNum(t.total, 0),
          online_sold: toNum(t.online_sold, 0),
          online_total: toNum(t.online_total, 0),
          one_to_one_sold: toNum(t.one_to_one_sold, 0),
          one_to_one_total: toNum(t.one_to_one_total, 0),
          box_office_sold: toNum(t.box_office_sold, 0),
          box_office_total: toNum(t.box_office_total, 0),
          synced_at: t.synced_at ? String(t.synced_at) : null,
        }))
      );

      setTeamSales(
        (teamRes.data || []).map((r) => ({
          id: String(r.id),
          event_id: toNum(r.event_id),
          pr_id: String(r.pr_id ?? r.id),
          pr_name: String(r.pr_name ?? ''),
          sub_pr_count: toNum(r.sub_pr_count, 0),
          is_self: Boolean(r.is_self),
          sold: toNum(r.sold, 0),
          entered: toNum(r.entered, 0),
          total: toNum(r.total, 0),
          synced_at: r.synced_at ? String(r.synced_at) : null,
        }))
      );

      setReportRows(
        (reportRes.data || []).map((r) => ({
          id: String(r.id),
          event_id: toNum(r.event_id),
          promoter_name: String(r.promoter_name ?? ''),
          ticket_type: String(r.ticket_type ?? ''),
          price: toNum(r.price, 0),
          online_qty: toNum(r.online_qty, 0),
          online_revenue: toNum(r.online_revenue, 0),
          one_to_one_qty: toNum(r.one_to_one_qty, 0),
          one_to_one_revenue: toNum(r.one_to_one_revenue, 0),
          box_office_qty: toNum(r.box_office_qty, 0),
          box_office_revenue: toNum(r.box_office_revenue, 0),
          total_qty: toNum(r.total_qty, 0),
          total_revenue: toNum(r.total_revenue, 0),
          row_order: toNum(r.row_order, 0),
          synced_at: r.synced_at ? String(r.synced_at) : null,
        }))
      );

      if (statusRes.data) {
        setSyncStatus({
          id: toNum(statusRes.data.id, 1),
          status: normalizeStatus(statusRes.data.status),
          events_synced: toNum(statusRes.data.events_synced, 0),
          message: String(statusRes.data.message ?? ''),
          synced_at: statusRes.data.synced_at ? String(statusRes.data.synced_at) : null,
        });
      } else {
        setSyncStatus(null);
      }
    } catch (err) {
      console.error('TicketSMS fetch failed:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchTicketSms(false);

    const scheduleReload = () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = window.setTimeout(() => fetchTicketSms(true), 450);
    };

    const ch = supabase
      .channel('lc-ticketsms-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ticketsms_sync_status' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ticketsms_events' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ticketsms_event_report_rows' },
        scheduleReload
      )
      .subscribe();

    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      stopPolling();
      supabase.removeChannel(ch);
    };
  }, [isAuthenticated, fetchTicketSms, stopPolling]);

  // Pre-indexed maps per event_id for O(1) lookups
  const eventsById = useMemo(() => {
    const map = new Map<number, TicketSmsEvent>();
    for (const ev of events) {
      map.set(ev.event_id, ev);
    }
    return map;
  }, [events]);

  const ticketTypesByEvent = useMemo(() => {
    const map = new Map<number, TicketSmsTicketType[]>();
    for (const t of ticketTypes) {
      const list = map.get(t.event_id) || [];
      list.push(t);
      map.set(t.event_id, list);
    }
    return map;
  }, [ticketTypes]);

  const teamSalesByEvent = useMemo(() => {
    const map = new Map<number, TicketSmsTeamSale[]>();
    for (const s of teamSales) {
      const list = map.get(s.event_id) || [];
      list.push(s);
      map.set(s.event_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.sold - a.sold || b.total - a.total);
    }
    return map;
  }, [teamSales]);

  const reportRowsByEvent = useMemo(() => {
    const map = new Map<number, TicketSmsReportRow[]>();
    for (const r of reportRows) {
      const list = map.get(r.event_id) || [];
      list.push(r);
      map.set(r.event_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.row_order - b.row_order);
    }
    return map;
  }, [reportRows]);

  const triggerManualSync = useCallback(async () => {
    if (syncing) return;

    const previousSyncedAt = syncStatusRef.current?.synced_at ?? null;
    const prevMs = previousSyncedAt ? new Date(previousSyncedAt).getTime() : 0;

    setSyncing(true);
    setSyncElapsedSec(0);

    try {
      const { data, error } = await supabase.functions.invoke('trigger-ticketsms-sync', {
        body: { include_terminated: true },
      });

      if (error) {
        let msg = error.message || 'Impossibile avviare la sincronizzazione';
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const parsed = await ctx.json();
            if (parsed?.error) msg = String(parsed.error);
          } catch {
            // fallback to error.message
          }
        }
        toast.error(msg);
        stopPolling();
        return;
      }

      if (data && data.error) {
        toast.error(String(data.error));
        stopPolling();
        return;
      }

      toast.info('Sincronizzazione TicketSMS avviata…');
      const startedAt = Date.now();

      tickTimerRef.current = window.setInterval(() => {
        setSyncElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      const pollOnce = async () => {
        const elapsed = Date.now() - startedAt;
        const { data: latest } = await supabase
          .from('ticketsms_sync_status')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        const latestSyncedAt = latest?.synced_at ? String(latest.synced_at) : null;
        const latestMs = latestSyncedAt ? new Date(latestSyncedAt).getTime() : 0;

        if (latestSyncedAt && latestMs > prevMs) {
          stopPolling();
          await fetchTicketSms(true);
          onSyncCompletedRef.current?.();
          const status = normalizeStatus(latest?.status);
          if (status === 'session_expired') {
            toast.warning(
              'Sessione TicketSMS scaduta: aggiorna il cookie o lancia aggiorna_ticketsms.bat'
            );
          } else if (status === 'error') {
            toast.error(latest?.message || 'Sincronizzazione completata con errore');
          } else {
            toast.success(latest?.message || 'Serate e prevendite TicketSMS aggiornate');
          }
          return;
        }

        if (elapsed >= POLL_MAX_DURATION_MS) {
          stopPolling();
          await fetchTicketSms(true);
          onSyncCompletedRef.current?.();
          toast.info(
            'Il workflow GitHub è ancora in esecuzione: i dati si aggiorneranno automaticamente appena pronto.'
          );
        }
      };

      pollTimerRef.current = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    } catch (err) {
      console.error('triggerManualSync error:', err);
      toast.error('Errore di rete durante la sincronizzazione');
      stopPolling();
    }
  }, [syncing, fetchTicketSms, stopPolling]);

  return {
    loading,
    events,
    eventsById,
    ticketTypesByEvent,
    teamSalesByEvent,
    reportRowsByEvent,
    syncStatus,
    syncing,
    syncElapsedSec,
    fetchTicketSms,
    triggerManualSync,
  };
}
