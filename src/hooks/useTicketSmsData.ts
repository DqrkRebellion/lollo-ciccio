import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import type { TicketSmsSyncState, TicketSmsSyncStatus } from '../types/ticketsms';

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(v: unknown): TicketSmsSyncState {
  if (v === 'session_expired' || v === 'error') return v;
  return 'ok';
}

/**
 * Listener & manual trigger for TicketSMS sync (Lollo & Ciccio).
 * Keeps sync status visible in Settings, lets users trigger a manual sync from
 * Serate (Lollo & Ciccio, Reverse, Ice), and refreshes app & staff data automatically
 * whenever a sync completes while the app is open.
 */
export function useTicketSmsData(
  enabled: boolean,
  onSyncCompleted?: () => void
) {
  const [syncStatus, setSyncStatus] = useState<TicketSmsSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const lastSyncedAtRef = useRef<string | null>(null);
  const manualPendingRef = useRef(false);
  const syncTimeoutRef = useRef<number | null>(null);
  const onSyncCompletedRef = useRef(onSyncCompleted);

  useEffect(() => {
    onSyncCompletedRef.current = onSyncCompleted;
  }, [onSyncCompleted]);

  const clearSyncPending = useCallback(() => {
    manualPendingRef.current = false;
    setSyncing(false);
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(
    async (notifyIfUpdated = false) => {
      try {
        const { data, error } = await supabase
          .from('ticketsms_sync_status')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          const nextSyncedAt = data.synced_at ? String(data.synced_at) : null;
          const prevSyncedAt = lastSyncedAtRef.current;
          lastSyncedAtRef.current = nextSyncedAt;

          const nextState: TicketSmsSyncStatus = {
            id: toNum(data.id, 1),
            status: normalizeStatus(data.status),
            events_synced: toNum(data.events_synced, 0),
            message: String(data.message ?? ''),
            synced_at: nextSyncedAt,
          };
          setSyncStatus(nextState);

          const hasChanged = Boolean(nextSyncedAt && prevSyncedAt && nextSyncedAt !== prevSyncedAt);
          if (notifyIfUpdated && (hasChanged || manualPendingRef.current)) {
            onSyncCompletedRef.current?.();
            if (manualPendingRef.current) {
              clearSyncPending();
              if (nextState.status === 'ok') {
                toast.success('Dati TicketSMS aggiornati');
              } else {
                toast.error(nextState.message || 'Errore aggiornamento TicketSMS');
              }
            }
          }
        } else {
          setSyncStatus(null);
        }
      } catch (err) {
        console.error('TicketSMS status fetch failed:', err);
      }
    },
    [clearSyncPending]
  );

  const triggerSync = useCallback(async () => {
    if (!enabled || syncing) return;
    setSyncing(true);
    manualPendingRef.current = true;
    try {
      const { data, error } = await supabase.functions.invoke('trigger-ticketsms-sync', {
        body: { include_terminated: true },
      });

      if (error) {
        let detail = error.message || 'Errore avvio aggiornamento TicketSMS';
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const payload = await ctx.json();
            if (payload?.error) detail = String(payload.error);
          } catch {
            // keep default error message
          }
        }
        throw new Error(detail);
      }

      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }

      toast.success('Aggiornamento TicketSMS avviato…');
      // Refresh local state immediately too in case DB already has newer data
      onSyncCompletedRef.current?.();

      // Safety timeout: stop spinner after 60s if GitHub Actions takes longer
      if (syncTimeoutRef.current !== null) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = window.setTimeout(() => {
        if (manualPendingRef.current) {
          clearSyncPending();
          fetchStatus(false);
          onSyncCompletedRef.current?.();
        }
      }, 60_000);
    } catch (err) {
      clearSyncPending();
      const msg = err instanceof Error ? err.message : 'Impossibile avviare il sync TicketSMS';
      toast.error(msg);
    }
  }, [enabled, syncing, clearSyncPending, fetchStatus]);

  useEffect(() => {
    if (!enabled) {
      lastSyncedAtRef.current = null;
      clearSyncPending();
      return;
    }

    const initTimer = window.setTimeout(() => {
      fetchStatus(false);
    }, 0);

    const ch = supabase
      .channel('lc-ticketsms-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ticketsms_sync_status' },
        () => {
          fetchStatus(true);
        }
      )
      .subscribe();

    return () => {
      window.clearTimeout(initTimer);
      clearSyncPending();
      supabase.removeChannel(ch);
    };
  }, [enabled, fetchStatus, clearSyncPending]);

  return {
    syncStatus: enabled ? syncStatus : null,
    syncing: enabled ? syncing : false,
    triggerSync,
  };
}
