import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { computeEventSummary, DEFAULT_SETTINGS } from '../lib/calculations';
import type {
  AppSettings,
  EventMode,
  EventPresale,
  EventPrReconciliation,
  EventRecord,
  EventSummary,
  EventTable,
  FullEvent,
  Promoter,
  ScaricoStatus,
  UndoAction,
  Venue,
} from '../types';

export type SyncState = 'connecting' | 'live' | 'saving' | 'error';

const MAX_UNDO_STACK = 35;

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSettings(row: Record<string, unknown> | null): AppSettings {
  if (!row) return DEFAULT_SETTINGS;
  return {
    id: 1,
    team_name: String(row.team_name ?? DEFAULT_SETTINGS.team_name),
    presale_commission: toNumber(row.presale_commission, 1),
    table_rate_no_guest: toNumber(row.table_rate_no_guest, 0.1),
    table_rate_guest: toNumber(row.table_rate_guest, 0.08),
    default_lista_cost: toNumber(row.default_lista_cost, 0),
    bonus_tiers: Array.isArray(row.bonus_tiers)
      ? (row.bonus_tiers as AppSettings['bonus_tiers'])
      : DEFAULT_SETTINGS.bonus_tiers,
    bonus_split_mode:
      (row.bonus_split_mode as AppSettings['bonus_split_mode']) || 'revenue_proportional',
    default_presale_input_mode:
      (row.default_presale_input_mode as AppSettings['default_presale_input_mode']) ||
      'total_minus_primary',
    default_table_scarico:
      (row.default_table_scarico as AppSettings['default_table_scarico']) || 'DA SCARICARE',
    quick_table_prices: Array.isArray(row.quick_table_prices)
      ? (row.quick_table_prices as number[]).map((x) => toNumber(x, 30))
      : DEFAULT_SETTINGS.quick_table_prices,
    show_surcharge_columns: Boolean(row.show_surcharge_columns),
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function normalizeEvent(
  ev: Record<string, unknown>,
  presales: EventPresale[],
  tables: EventTable[],
  recons: EventPrReconciliation[]
): FullEvent {
  return {
    id: String(ev.id),
    title: String(ev.title ?? ''),
    sheet_name: ev.sheet_name ? String(ev.sheet_name) : null,
    venue_id: ev.venue_id ? String(ev.venue_id) : null,
    venue_name: String(ev.venue_name ?? ''),
    event_date: String(ev.event_date ?? new Date().toISOString().slice(0, 10)),
    mode: (ev.mode as EventMode) || 'NO OSPITE',
    era: (ev.era as '2PX' | '3PX') || '2PX',
    is_busta_paid: Boolean(ev.is_busta_paid),
    lista_cost: toNumber(ev.lista_cost, 0),
    general_note_amount: toNumber(ev.general_note_amount, 0),
    general_note_text: String(ev.general_note_text ?? ''),
    presale_input_mode:
      (ev.presale_input_mode as FullEvent['presale_input_mode']) || 'total_minus_primary',
    busta_override:
      ev.busta_override !== null && ev.busta_override !== undefined
        ? toNumber(ev.busta_override)
        : null,
    commission_config: (ev.commission_config as FullEvent['commission_config']) ?? null,
    ticketsms_event_id:
      ev.ticketsms_event_id !== null && ev.ticketsms_event_id !== undefined
        ? toNumber(ev.ticketsms_event_id)
        : null,
    created_at: ev.created_at ? String(ev.created_at) : undefined,
    updated_at: ev.updated_at ? String(ev.updated_at) : undefined,
    presales,
    tables,
    reconciliations: recons,
  };
}

export function useAppData(isAuthenticated: boolean) {
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>('connecting');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [events, setEvents] = useState<FullEvent[]>([]);

  // Global Undo / Redo Command Stack
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const [undoBusy, setUndoBusy] = useState(false);

  const eventsRef = useRef<FullEvent[]>([]);
  eventsRef.current = events;

  const pushUndo = useCallback((action: Omit<UndoAction, 'id'>) => {
    const entry: UndoAction = {
      ...action,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    setUndoStack((prev) => [...prev.slice(-(MAX_UNDO_STACK - 1)), entry]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(async () => {
    if (undoBusy) return;
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoBusy(true);
    setUndoStack((prev) => prev.slice(0, -1));
    try {
      await last.undo();
      setRedoStack((prev) => [...prev.slice(-(MAX_UNDO_STACK - 1)), last]);
      toast.success(`Annullato: ${last.label}`);
    } catch (err) {
      console.error('Undo failed:', err);
      toast.error('Impossibile annullare l’operazione');
    } finally {
      setUndoBusy(false);
    }
  }, [undoStack, undoBusy]);

  const redo = useCallback(async () => {
    if (undoBusy) return;
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setUndoBusy(true);
    setRedoStack((prev) => prev.slice(0, -1));
    try {
      await last.redo();
      setUndoStack((prev) => [...prev.slice(-(MAX_UNDO_STACK - 1)), last]);
      toast.success(`Ripristinato: ${last.label}`);
    } catch (err) {
      console.error('Redo failed:', err);
      toast.error('Impossibile ripristinare l’operazione');
    } finally {
      setUndoBusy(false);
    }
  }, [redoStack, undoBusy]);

  const activePromoters = useMemo(
    () => promoters.filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [promoters]
  );

  const activePromoterIds = useMemo(
    () => (activePromoters.length > 0 ? activePromoters.map((p) => p.id) : ['lollo', 'ciccio']),
    [activePromoters]
  );

  const summaries = useMemo(() => {
    const map = new Map<string, EventSummary>();
    for (const ev of events) {
      map.set(ev.id, computeEventSummary(ev, settings, activePromoterIds));
    }
    return map;
  }, [events, settings, activePromoterIds]);

  const reloadTimerRef = useRef<number | null>(null);
  const savingCounterRef = useRef(0);
  const mutationEpochRef = useRef(0);
  const lastLocalSaveEndAtRef = useRef(0);
  const pendingRemoteReloadRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const eventQueueRef = useRef(new Map<string, Promise<void>>());
  const scheduleReloadRef = useRef<() => void>(() => {});

  const startSaving = useCallback(() => {
    savingCounterRef.current += 1;
    mutationEpochRef.current += 1;
    // Cancel any queued Realtime reload immediately so it cannot race with this mutation
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    setSyncState('saving');
  }, []);

  const endSaving = useCallback((failed = false) => {
    savingCounterRef.current = Math.max(0, savingCounterRef.current - 1);
    mutationEpochRef.current += 1;
    lastLocalSaveEndAtRef.current = Date.now();
    if (failed) {
      setSyncState('error');
    } else if (savingCounterRef.current === 0) {
      setSyncState('live');
      if (pendingRemoteReloadRef.current) {
        pendingRemoteReloadRef.current = false;
        scheduleReloadRef.current();
      }
    }
  }, []);

  const enqueueEventOp = useCallback(
    (eventId: string, op: () => Promise<void>): Promise<void> => {
      const prev = eventQueueRef.current.get(eventId) ?? Promise.resolve();
      const next = prev.catch(() => undefined).then(op);
      eventQueueRef.current.set(eventId, next);
      next.finally(() => {
        if (eventQueueRef.current.get(eventId) === next) {
          eventQueueRef.current.delete(eventId);
        }
      });
      return next;
    },
    []
  );

  const fetchAll = useCallback(async (silent = false, force = false) => {
    if (silent && !force && savingCounterRef.current > 0) return;

    const mySeq = ++fetchSeqRef.current;
    const startEpoch = mutationEpochRef.current;
    if (!silent) setLoading(true);
    try {
      const [settingsRes, promotersRes, venuesRes, eventsRes, presalesRes, tablesRes, reconsRes] =
        await Promise.all([
          supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
          supabase.from('promoters').select('*').order('sort_order', { ascending: true }),
          supabase.from('venues').select('*').order('name', { ascending: true }),
          supabase
            .from('events')
            .select('*')
            .order('event_date', { ascending: false })
            .order('created_at', { ascending: false }),
          supabase.from('event_presales').select('*'),
          supabase.from('event_tables').select('*').order('sort_order', { ascending: true }),
          supabase.from('event_pr_reconciliations').select('*'),
        ]);

      const firstErr =
        settingsRes.error ||
        promotersRes.error ||
        venuesRes.error ||
        eventsRes.error ||
        presalesRes.error ||
        tablesRes.error ||
        reconsRes.error;
      if (firstErr) throw firstErr;

      // Discard stale fetch responses so optimistic local edits (e.g. rapid Busta Paid clicks)
      // can NEVER be overwritten and reverted by an earlier in-flight reload.
      if (mySeq !== fetchSeqRef.current) return;
      if (
        silent &&
        !force &&
        (savingCounterRef.current > 0 || mutationEpochRef.current !== startEpoch)
      ) {
        return;
      }

      setSettings(normalizeSettings(settingsRes.data as Record<string, unknown> | null));
      setPromoters((promotersRes.data || []) as Promoter[]);
      setVenues(
        (venuesRes.data || []).map((v) => ({
          id: String(v.id),
          name: String(v.name),
          color: String(v.color || '#0071E3'),
          default_mode: (v.default_mode as EventMode) || 'NO OSPITE',
          default_table_price: toNumber(v.default_table_price, 30),
          default_lista_cost: toNumber(v.default_lista_cost, 0),
          is_archived: Boolean(v.is_archived),
        }))
      );

      const presalesByEv = new Map<string, EventPresale[]>();
      for (const p of presalesRes.data || []) {
        const item: EventPresale = {
          id: String(p.id),
          event_id: String(p.event_id),
          promoter_id: String(p.promoter_id),
          quantity: toNumber(p.quantity, 0),
          revenue: toNumber(p.revenue, 0),
          one_to_one: toNumber(p.one_to_one, 0),
        };
        const arr = presalesByEv.get(item.event_id) || [];
        arr.push(item);
        presalesByEv.set(item.event_id, arr);
      }

      const tablesByEv = new Map<string, EventTable[]>();
      for (const t of tablesRes.data || []) {
        const item: EventTable = {
          id: String(t.id),
          event_id: String(t.event_id),
          promoter_id: String(t.promoter_id),
          table_name: String(t.table_name ?? ''),
          payers_count: toNumber(t.payers_count, 0),
          price: toNumber(t.price, 0),
          surcharge_payers_count: toNumber(t.surcharge_payers_count, 0),
          surcharge_price: toNumber(t.surcharge_price, 0),
          extra_no_scarico: toNumber(t.extra_no_scarico, 0),
          extra_si_scarico: toNumber(t.extra_si_scarico, 0),
          scarico_status: (t.scarico_status as ScaricoStatus) || 'DA SCARICARE',
          sort_order: toNumber(t.sort_order, 0),
        };
        const arr = tablesByEv.get(item.event_id) || [];
        arr.push(item);
        tablesByEv.set(item.event_id, arr);
      }

      const reconsByEv = new Map<string, EventPrReconciliation[]>();
      for (const r of reconsRes.data || []) {
        const item: EventPrReconciliation = {
          id: String(r.id),
          event_id: String(r.event_id),
          promoter_id: String(r.promoter_id),
          lista_pr_count: toNumber(r.lista_pr_count, 0),
          note_amount: toNumber(r.note_amount, 0),
          note_text: String(r.note_text ?? ''),
          scaricato_amount: toNumber(r.scaricato_amount, 0),
        };
        const arr = reconsByEv.get(item.event_id) || [];
        arr.push(item);
        reconsByEv.set(item.event_id, arr);
      }

      const hydrated = (eventsRes.data || []).map((ev) =>
        normalizeEvent(
          ev as Record<string, unknown>,
          presalesByEv.get(String(ev.id)) || [],
          tablesByEv.get(String(ev.id)) || [],
          reconsByEv.get(String(ev.id)) || []
        )
      );
      setEvents(hydrated);
      setSyncState('live');
    } catch (err) {
      console.error('Fetch failed:', err);
      setSyncState('error');
      toast.error('Impossibile sincronizzare i dati dal cloud');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    fetchAll(false);

    const scheduleReload = () => {
      if (savingCounterRef.current > 0) {
        pendingRemoteReloadRef.current = true;
        return;
      }
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
      }
      const msSinceLocalWrite = Date.now() - lastLocalSaveEndAtRef.current;
      const delay = msSinceLocalWrite < 1600 ? 1400 : 350;
      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null;
        if (savingCounterRef.current > 0) {
          pendingRemoteReloadRef.current = true;
          return;
        }
        fetchAll(true);
      }, delay);
    };
    scheduleReloadRef.current = scheduleReload;

    const channel = supabase
      .channel('lc-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_presales' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_tables' }, scheduleReload)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_pr_reconciliations' },
        scheduleReload
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'venues' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoters' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, scheduleReload)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setSyncState('live');
      });

    return () => {
      scheduleReloadRef.current = () => {};
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, fetchAll]);

  // --- Low-level DB helpers (reused by mutations + Undo/Redo) ---

  const applyEventPatchRaw = useCallback(
    async (eventId: string, patch: Partial<EventRecord>) => {
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, ...patch } : ev)));
      startSaving();
      try {
        await enqueueEventOp(eventId, async () => {
          const { error } = await supabase.from('events').update(patch).eq('id', eventId);
          if (error) throw error;
        });
        endSaving(false);
      } catch (error) {
        console.error(error);
        endSaving(true);
        toast.error('Errore nel salvataggio serata');
        fetchAll(true, true);
        throw error;
      }
    },
    [startSaving, endSaving, enqueueEventOp, fetchAll]
  );

  const restoreDeletedEventRaw = useCallback(
    async (snapshot: FullEvent) => {
      startSaving();
      try {
        const { data: restored, error: rErr } = await supabase
          .from('events')
          .insert({
            id: snapshot.id,
            title: snapshot.title,
            sheet_name: snapshot.sheet_name,
            venue_id: snapshot.venue_id,
            venue_name: snapshot.venue_name,
            event_date: snapshot.event_date,
            mode: snapshot.mode,
            era: snapshot.era,
            is_busta_paid: snapshot.is_busta_paid,
            lista_cost: snapshot.lista_cost,
            general_note_amount: snapshot.general_note_amount,
            general_note_text: snapshot.general_note_text,
            presale_input_mode: snapshot.presale_input_mode,
            busta_override: snapshot.busta_override,
            commission_config: snapshot.commission_config,
            ticketsms_event_id: snapshot.ticketsms_event_id,
          })
          .select()
          .single();
        if (rErr) throw rErr;
        if (snapshot.presales.length) {
          await supabase.from('event_presales').insert(
            snapshot.presales.map((p) => ({
              event_id: restored.id,
              promoter_id: p.promoter_id,
              quantity: p.quantity,
              revenue: p.revenue,
              one_to_one: p.one_to_one,
            }))
          );
        }
        if (snapshot.tables.length) {
          await supabase.from('event_tables').insert(
            snapshot.tables.map((t) => ({
              id: t.id.startsWith('temp-') ? undefined : t.id,
              event_id: restored.id,
              promoter_id: t.promoter_id,
              table_name: t.table_name,
              payers_count: t.payers_count,
              price: t.price,
              surcharge_payers_count: t.surcharge_payers_count,
              surcharge_price: t.surcharge_price,
              extra_no_scarico: t.extra_no_scarico,
              extra_si_scarico: t.extra_si_scarico,
              scarico_status: t.scarico_status,
              sort_order: t.sort_order,
            }))
          );
        }
        if (snapshot.reconciliations.length) {
          await supabase.from('event_pr_reconciliations').insert(
            snapshot.reconciliations.map((r) => ({
              event_id: restored.id,
              promoter_id: r.promoter_id,
              lista_pr_count: r.lista_pr_count,
              note_amount: r.note_amount,
              note_text: r.note_text,
              scaricato_amount: r.scaricato_amount,
            }))
          );
        }
        await fetchAll(true, true);
      } finally {
        endSaving(false);
      }
    },
    [startSaving, endSaving, fetchAll]
  );

  const deleteEventRaw = useCallback(
    async (eventId: string) => {
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      startSaving();
      const { error } = await supabase.from('events').delete().eq('id', eventId);
      if (error) {
        endSaving(true);
        await fetchAll(true, true);
        throw error;
      }
      endSaving(false);
    },
    [startSaving, endSaving, fetchAll]
  );

  const applyPresalesRaw = useCallback(
    async (
      eventId: string,
      rows: { promoter_id: string; quantity: number; revenue: number; one_to_one: number }[]
    ) => {
      setEvents((prev) =>
        prev.map((ev) => {
          if (ev.id !== eventId) return ev;
          const nextList = [...ev.presales];
          for (const row of rows) {
            const idx = nextList.findIndex((p) => p.promoter_id === row.promoter_id);
            if (idx >= 0) {
              nextList[idx] = { ...nextList[idx], ...row };
            } else {
              nextList.push({
                id: `temp-${row.promoter_id}`,
                event_id: eventId,
                ...row,
              });
            }
          }
          return { ...ev, presales: nextList };
        })
      );
      startSaving();
      const { error } = await supabase.from('event_presales').upsert(
        rows.map((r) => ({ event_id: eventId, ...r })),
        { onConflict: 'event_id,promoter_id' }
      );
      if (error) {
        console.error(error);
        endSaving(true);
        toast.error('Errore salvataggio prevendite');
        throw error;
      }
      endSaving(false);
    },
    [startSaving, endSaving]
  );

  const applyReconsRaw = useCallback(
    async (
      eventId: string,
      rows: {
        promoter_id: string;
        lista_pr_count: number;
        note_amount: number;
        note_text: string;
        scaricato_amount: number;
      }[]
    ) => {
      setEvents((prev) =>
        prev.map((ev) => {
          if (ev.id !== eventId) return ev;
          const nextList = [...ev.reconciliations];
          for (const row of rows) {
            const idx = nextList.findIndex((r) => r.promoter_id === row.promoter_id);
            if (idx >= 0) {
              nextList[idx] = { ...nextList[idx], ...row };
            } else {
              nextList.push({
                id: `temp-${row.promoter_id}`,
                event_id: eventId,
                ...row,
              });
            }
          }
          return { ...ev, reconciliations: nextList };
        })
      );
      startSaving();
      const { error } = await supabase.from('event_pr_reconciliations').upsert(
        rows.map((r) => ({ event_id: eventId, ...r })),
        { onConflict: 'event_id,promoter_id' }
      );
      if (error) {
        console.error(error);
        endSaving(true);
        toast.error('Errore salvataggio scarico PR');
        throw error;
      }
      endSaving(false);
    },
    [startSaving, endSaving]
  );

  const insertTableRaw = useCallback(
    async (
      eventId: string,
      table: Omit<EventTable, 'id' | 'event_id'> & { id?: string }
    ): Promise<EventTable> => {
      const tempId = table.id || `temp-table-${Date.now()}`;
      const optimistic: EventTable = {
        ...table,
        id: tempId,
        event_id: eventId,
      };
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === eventId
            ? {
                ...ev,
                tables: [...ev.tables, optimistic].sort((a, b) => a.sort_order - b.sort_order),
              }
            : ev
        )
      );
      startSaving();
      const payload: Record<string, unknown> = {
        event_id: eventId,
        promoter_id: table.promoter_id,
        table_name: table.table_name,
        payers_count: table.payers_count,
        price: table.price,
        surcharge_payers_count: table.surcharge_payers_count,
        surcharge_price: table.surcharge_price,
        extra_no_scarico: table.extra_no_scarico,
        extra_si_scarico: table.extra_si_scarico,
        scarico_status: table.scarico_status,
        sort_order: table.sort_order,
      };
      if (table.id && !table.id.startsWith('temp-')) payload.id = table.id;
      const { data, error } = await supabase
        .from('event_tables')
        .insert(payload)
        .select()
        .single();
      if (error) {
        endSaving(true);
        setEvents((prev) =>
          prev.map((ev) =>
            ev.id === eventId ? { ...ev, tables: ev.tables.filter((t) => t.id !== tempId) } : ev
          )
        );
        throw error;
      }
      const saved: EventTable = {
        id: String(data.id),
        event_id: String(data.event_id),
        promoter_id: String(data.promoter_id),
        table_name: String(data.table_name ?? ''),
        payers_count: toNumber(data.payers_count, 0),
        price: toNumber(data.price, 0),
        surcharge_payers_count: toNumber(data.surcharge_payers_count, 0),
        surcharge_price: toNumber(data.surcharge_price, 0),
        extra_no_scarico: toNumber(data.extra_no_scarico, 0),
        extra_si_scarico: toNumber(data.extra_si_scarico, 0),
        scarico_status: (data.scarico_status as ScaricoStatus) || 'DA SCARICARE',
        sort_order: toNumber(data.sort_order, table.sort_order),
      };
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === eventId
            ? { ...ev, tables: ev.tables.map((t) => (t.id === tempId ? saved : t)) }
            : ev
        )
      );
      endSaving(false);
      return saved;
    },
    [startSaving, endSaving]
  );

  const updateTableRaw = useCallback(
    async (eventId: string, tableId: string, patch: Partial<EventTable>) => {
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === eventId
            ? {
                ...ev,
                tables: ev.tables.map((t) => (t.id === tableId ? { ...t, ...patch } : t)),
              }
            : ev
        )
      );
      if (tableId.startsWith('temp-')) return;
      startSaving();
      const { error } = await supabase.from('event_tables').update(patch).eq('id', tableId);
      if (error) {
        endSaving(true);
        toast.error('Errore aggiornamento tavolo');
        throw error;
      }
      endSaving(false);
    },
    [startSaving, endSaving]
  );

  const deleteTableRaw = useCallback(
    async (eventId: string, tableId: string) => {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId ? { ...e, tables: e.tables.filter((t) => t.id !== tableId) } : e
        )
      );
      if (tableId.startsWith('temp-')) return;
      startSaving();
      const { error } = await supabase.from('event_tables').delete().eq('id', tableId);
      if (error) {
        endSaving(true);
        await fetchAll(true, true);
        throw error;
      }
      endSaving(false);
    },
    [startSaving, endSaving, fetchAll]
  );

  // --- Public Undo-Tracked Mutations ---

  const createEvent = useCallback(
    async (input: {
      title: string;
      venue_id: string | null;
      venue_name: string;
      event_date: string;
      mode: EventMode;
      lista_cost: number;
    }): Promise<FullEvent | null> => {
      startSaving();
      try {
        const { data: ev, error } = await supabase
          .from('events')
          .insert({
            title: input.title.trim(),
            venue_id: input.venue_id,
            venue_name: input.venue_name,
            event_date: input.event_date,
            mode: input.mode,
            era: '2PX',
            lista_cost: input.lista_cost,
            presale_input_mode: settings.default_presale_input_mode,
          })
          .select()
          .single();
        if (error) throw error;

        const prIds = activePromoterIds;
        const [pRes, rRes] = await Promise.all([
          supabase
            .from('event_presales')
            .insert(prIds.map((pid) => ({ event_id: ev.id, promoter_id: pid })))
            .select(),
          supabase
            .from('event_pr_reconciliations')
            .insert(prIds.map((pid) => ({ event_id: ev.id, promoter_id: pid })))
            .select(),
        ]);
        if (pRes.error) throw pRes.error;
        if (rRes.error) throw rRes.error;

        const created = normalizeEvent(
          ev as Record<string, unknown>,
          (pRes.data || []) as EventPresale[],
          [],
          (rRes.data || []) as EventPrReconciliation[]
        );
        setEvents((prev) =>
          [created, ...prev].sort((a, b) => b.event_date.localeCompare(a.event_date))
        );
        endSaving(false);
        pushUndo({
          label: `Creazione serata “${created.title}”`,
          undo: () => deleteEventRaw(created.id),
          redo: () => restoreDeletedEventRaw(created),
        });
        toast.success(`Serata “${created.title}” creata`);
        return created;
      } catch (err) {
        console.error(err);
        endSaving(true);
        toast.error('Errore nella creazione della serata');
        return null;
      }
    },
    [
      activePromoterIds,
      settings.default_presale_input_mode,
      startSaving,
      endSaving,
      pushUndo,
      deleteEventRaw,
      restoreDeletedEventRaw,
    ]
  );

  const duplicateEvent = useCallback(
    async (source: FullEvent): Promise<FullEvent | null> => {
      const today = new Date().toISOString().slice(0, 10);
      return createEvent({
        title: `${source.title} (copia)`,
        venue_id: source.venue_id,
        venue_name: source.venue_name,
        event_date: today,
        mode: source.mode,
        lista_cost: source.lista_cost,
      });
    },
    [createEvent]
  );

  const updateEvent = useCallback(
    async (eventId: string, patch: Partial<EventRecord>) => {
      const current = eventsRef.current.find((e) => e.id === eventId);
      if (!current) return;
      const prevPatch: Partial<EventRecord> = {};
      for (const k of Object.keys(patch) as (keyof EventRecord)[]) {
        (prevPatch as Record<string, unknown>)[k] = current[k];
      }
      await applyEventPatchRaw(eventId, patch);

      const label =
        'is_busta_paid' in patch
          ? patch.is_busta_paid
            ? 'Busta segnata saldata'
            : 'Busta riaperta'
          : 'mode' in patch
            ? `Modalità ${patch.mode}`
            : 'Modifica serata';

      pushUndo({
        label,
        undo: () => applyEventPatchRaw(eventId, prevPatch),
        redo: () => applyEventPatchRaw(eventId, patch),
      });
    },
    [applyEventPatchRaw, pushUndo]
  );

  const deleteEvent = useCallback(
    async (eventId: string) => {
      const snapshot = eventsRef.current.find((e) => e.id === eventId);
      if (!snapshot) return;
      await deleteEventRaw(eventId);
      pushUndo({
        label: `Eliminazione “${snapshot.title}”`,
        undo: () => restoreDeletedEventRaw(snapshot),
        redo: () => deleteEventRaw(snapshot.id),
      });
      toast(`Serata “${snapshot.title}” eliminata`, {
        action: {
          label: 'Annulla',
          onClick: () => undo(),
        },
      });
    },
    [deleteEventRaw, restoreDeletedEventRaw, pushUndo, undo]
  );

  const upsertPresalesBatch = useCallback(
    async (
      eventId: string,
      patches: {
        promoterId: string;
        patch: Partial<Pick<EventPresale, 'quantity' | 'revenue' | 'one_to_one'>>;
      }[],
      label = 'Modifica prevendite'
    ) => {
      const ev = eventsRef.current.find((e) => e.id === eventId);
      if (!ev || patches.length === 0) return;

      const prevRows: { promoter_id: string; quantity: number; revenue: number; one_to_one: number }[] =
        [];
      const nextRows: { promoter_id: string; quantity: number; revenue: number; one_to_one: number }[] =
        [];

      for (const { promoterId, patch } of patches) {
        const existing = ev.presales.find((p) => p.promoter_id === promoterId);
        const prevRow = {
          promoter_id: promoterId,
          quantity: existing?.quantity ?? 0,
          revenue: existing?.revenue ?? 0,
          one_to_one: existing?.one_to_one ?? 0,
        };
        const nextRow = {
          promoter_id: promoterId,
          quantity: patch.quantity ?? prevRow.quantity,
          revenue: patch.revenue ?? prevRow.revenue,
          one_to_one: patch.one_to_one ?? prevRow.one_to_one,
        };
        prevRows.push(prevRow);
        nextRows.push(nextRow);
      }

      await applyPresalesRaw(eventId, nextRows);
      pushUndo({
        label,
        undo: () => applyPresalesRaw(eventId, prevRows),
        redo: () => applyPresalesRaw(eventId, nextRows),
      });
    },
    [applyPresalesRaw, pushUndo]
  );

  const upsertPresale = useCallback(
    async (
      eventId: string,
      promoterId: string,
      patch: Partial<Pick<EventPresale, 'quantity' | 'revenue' | 'one_to_one'>>
    ) => {
      await upsertPresalesBatch(eventId, [{ promoterId, patch }], 'Modifica prevendite');
    },
    [upsertPresalesBatch]
  );

  const upsertReconciliationsBatch = useCallback(
    async (
      eventId: string,
      patches: {
        promoterId: string;
        patch: Partial<
          Pick<
            EventPrReconciliation,
            'lista_pr_count' | 'note_amount' | 'note_text' | 'scaricato_amount'
          >
        >;
      }[],
      label = 'Modifica scarico'
    ) => {
      const ev = eventsRef.current.find((e) => e.id === eventId);
      if (!ev || patches.length === 0) return;

      type ReconPayload = {
        promoter_id: string;
        lista_pr_count: number;
        note_amount: number;
        note_text: string;
        scaricato_amount: number;
      };
      const prevRows: ReconPayload[] = [];
      const nextRows: ReconPayload[] = [];
      for (const { promoterId, patch } of patches) {
        const existing = ev.reconciliations.find((r) => r.promoter_id === promoterId);
        const prevRow = {
          promoter_id: promoterId,
          lista_pr_count: existing?.lista_pr_count ?? 0,
          note_amount: existing?.note_amount ?? 0,
          note_text: existing?.note_text ?? '',
          scaricato_amount: existing?.scaricato_amount ?? 0,
        };
        const nextRow = {
          promoter_id: promoterId,
          lista_pr_count: patch.lista_pr_count ?? prevRow.lista_pr_count,
          note_amount: patch.note_amount ?? prevRow.note_amount,
          note_text: patch.note_text ?? prevRow.note_text,
          scaricato_amount: patch.scaricato_amount ?? prevRow.scaricato_amount,
        };
        prevRows.push(prevRow);
        nextRows.push(nextRow);
      }

      await applyReconsRaw(eventId, nextRows);
      pushUndo({
        label,
        undo: () => applyReconsRaw(eventId, prevRows),
        redo: () => applyReconsRaw(eventId, nextRows),
      });
    },
    [applyReconsRaw, pushUndo]
  );

  const upsertReconciliation = useCallback(
    async (
      eventId: string,
      promoterId: string,
      patch: Partial<
        Pick<
          EventPrReconciliation,
          'lista_pr_count' | 'note_amount' | 'note_text' | 'scaricato_amount'
        >
      >
    ) => {
      await upsertReconciliationsBatch(eventId, [{ promoterId, patch }], 'Modifica cassa PR');
    },
    [upsertReconciliationsBatch]
  );

  const addTable = useCallback(
    async (
      eventId: string,
      table: Omit<EventTable, 'id' | 'event_id' | 'sort_order'>
    ): Promise<EventTable | null> => {
      const targetEv = eventsRef.current.find((e) => e.id === eventId);
      const nextOrder = targetEv
        ? Math.max(-1, ...targetEv.tables.map((t) => t.sort_order)) + 1
        : 0;
      try {
        const saved = await insertTableRaw(eventId, { ...table, sort_order: nextOrder });
        pushUndo({
          label: `Nuovo tavolo “${saved.table_name}”`,
          undo: () => deleteTableRaw(eventId, saved.id),
          redo: async () => {
            await insertTableRaw(eventId, saved);
          },
        });
        return saved;
      } catch (err) {
        console.error(err);
        toast.error('Errore aggiunta tavolo');
        return null;
      }
    },
    [insertTableRaw, deleteTableRaw, pushUndo]
  );

  const updateTable = useCallback(
    async (eventId: string, tableId: string, patch: Partial<EventTable>) => {
      const ev = eventsRef.current.find((e) => e.id === eventId);
      const current = ev?.tables.find((t) => t.id === tableId);
      if (!current) return;
      const prevPatch: Partial<EventTable> = {};
      for (const k of Object.keys(patch) as (keyof EventTable)[]) {
        (prevPatch as Record<string, unknown>)[k] = current[k];
      }
      await updateTableRaw(eventId, tableId, patch);
      pushUndo({
        label: `Tavolo “${current.table_name || 'senza nome'}”`,
        undo: () => updateTableRaw(eventId, tableId, prevPatch),
        redo: () => updateTableRaw(eventId, tableId, patch),
      });
    },
    [updateTableRaw, pushUndo]
  );

  const deleteTable = useCallback(
    async (eventId: string, tableId: string) => {
      const ev = eventsRef.current.find((e) => e.id === eventId);
      const snapshot = ev?.tables.find((t) => t.id === tableId);
      if (!snapshot) return;
      await deleteTableRaw(eventId, tableId);
      pushUndo({
        label: `Rimozione tavolo “${snapshot.table_name}”`,
        undo: async () => {
          await insertTableRaw(eventId, snapshot);
        },
        redo: () => deleteTableRaw(eventId, snapshot.id),
      });
      toast(`Tavolo “${snapshot.table_name || 'senza nome'}” rimosso`, {
        action: {
          label: 'Annulla',
          onClick: () => undo(),
        },
      });
    },
    [deleteTableRaw, insertTableRaw, pushUndo, undo]
  );

  // --- Settings, Venues, Promoters CRUD ---

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      startSaving();
      const { error } = await supabase
        .from('app_settings')
        .upsert({ ...next, id: 1 }, { onConflict: 'id' });
      if (error) {
        console.error(error);
        endSaving(true);
        toast.error('Errore salvataggio impostazioni');
      } else {
        endSaving(false);
      }
    },
    [settings, startSaving, endSaving]
  );

  const upsertVenue = useCallback(
    async (venue: Partial<Venue> & { name: string }) => {
      startSaving();
      try {
        if (venue.id) {
          const { data, error } = await supabase
            .from('venues')
            .update({
              name: venue.name.trim(),
              color: venue.color,
              default_mode: venue.default_mode,
              default_table_price: venue.default_table_price,
              default_lista_cost: venue.default_lista_cost,
              is_archived: venue.is_archived,
            })
            .eq('id', venue.id)
            .select()
            .single();
          if (error) throw error;
          setVenues((prev) =>
            prev
              .map((v) => (v.id === venue.id ? (data as Venue) : v))
              .sort((a, b) => a.name.localeCompare(b.name))
          );
          toast.success(`Locale “${data.name}” aggiornato`);
        } else {
          const { data, error } = await supabase
            .from('venues')
            .insert({
              name: venue.name.trim(),
              color: venue.color || '#0071E3',
              default_mode: venue.default_mode || 'NO OSPITE',
              default_table_price: venue.default_table_price ?? 30,
              default_lista_cost: venue.default_lista_cost ?? 0,
              is_archived: false,
            })
            .select()
            .single();
          if (error) throw error;
          setVenues((prev) =>
            [...prev, data as Venue].sort((a, b) => a.name.localeCompare(b.name))
          );
          toast.success(`Locale “${data.name}” aggiunto`);
        }
        endSaving(false);
      } catch (err) {
        console.error(err);
        endSaving(true);
        toast.error('Errore salvataggio locale');
      }
    },
    [startSaving, endSaving]
  );

  const upsertPromoter = useCallback(
    async (promoter: Promoter) => {
      startSaving();
      const { error } = await supabase
        .from('promoters')
        .upsert(promoter, { onConflict: 'id' });
      if (error) {
        console.error(error);
        endSaving(true);
        toast.error('Errore salvataggio PR');
      } else {
        setPromoters((prev) => {
          const exists = prev.some((p) => p.id === promoter.id);
          const next = exists
            ? prev.map((p) => (p.id === promoter.id ? promoter : p))
            : [...prev, promoter];
          return next.sort((a, b) => a.sort_order - b.sort_order);
        });
        endSaving(false);
        toast.success(`Profilo PR “${promoter.display_name}” salvato`);
      }
    },
    [startSaving, endSaving]
  );

  return {
    loading,
    syncState,
    settings,
    promoters,
    activePromoters,
    activePromoterIds,
    venues,
    events,
    summaries,
    // Undo / Redo API
    canUndo: undoStack.length > 0 && !undoBusy,
    canRedo: redoStack.length > 0 && !undoBusy,
    undoCount: undoStack.length,
    lastUndoLabel: undoStack[undoStack.length - 1]?.label ?? null,
    lastRedoLabel: redoStack[redoStack.length - 1]?.label ?? null,
    pushUndo,
    undo,
    redo,
    // CRUD
    fetchAll,
    createEvent,
    duplicateEvent,
    updateEvent,
    deleteEvent,
    upsertPresale,
    upsertPresalesBatch,
    upsertReconciliation,
    upsertReconciliationsBatch,
    addTable,
    updateTable,
    deleteTable,
    updateSettings,
    upsertVenue,
    upsertPromoter,
  };
}
