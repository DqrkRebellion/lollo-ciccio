import { useCallback, useEffect, useRef, useState } from 'react';
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
 * Lightweight listener for the daily 15:00 TicketSMS sync status (Lollo & Ciccio).
 * Keeps sync status visible in Settings and refreshes app & staff data automatically
 * whenever a scheduled or local TicketSMS sync completes while the app is open.
 */
export function useTicketSmsData(
  enabled: boolean,
  onSyncCompleted?: () => void
) {
  const [syncStatus, setSyncStatus] = useState<TicketSmsSyncStatus | null>(null);
  const lastSyncedAtRef = useRef<string | null>(null);
  const onSyncCompletedRef = useRef(onSyncCompleted);

  useEffect(() => {
    onSyncCompletedRef.current = onSyncCompleted;
  }, [onSyncCompleted]);

  const fetchStatus = useCallback(async (notifyIfUpdated = false) => {
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

        setSyncStatus({
          id: toNum(data.id, 1),
          status: normalizeStatus(data.status),
          events_synced: toNum(data.events_synced, 0),
          message: String(data.message ?? ''),
          synced_at: nextSyncedAt,
        });

        if (notifyIfUpdated && nextSyncedAt && prevSyncedAt && nextSyncedAt !== prevSyncedAt) {
          onSyncCompletedRef.current?.();
        }
      } else {
        setSyncStatus(null);
      }
    } catch (err) {
      console.error('TicketSMS status fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      lastSyncedAtRef.current = null;
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
      supabase.removeChannel(ch);
    };
  }, [enabled, fetchStatus]);

  return {
    syncStatus: enabled ? syncStatus : null,
  };
}
