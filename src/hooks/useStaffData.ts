import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { round2 } from '../lib/calculations';
import {
  computeStaffEventSummary,
  DEFAULT_PRESALE_TIERS,
  DEFAULT_TABLE_TIERS,
  matchStaffMemberByName,
} from '../lib/staffCalculations';
import type { ScaricoStatus, UndoAction } from '../types';
import type {
  StaffCashAllocation,
  StaffCashPaymentMethod,
  StaffCashTransaction,
  StaffCommissionPlan,
  StaffEventPresale,
  StaffEventSummary,
  StaffEventTable,
  StaffGroup,
  StaffMember,
  StaffMemberEventRollup,
  StaffTier,
} from '../types/staff';

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTiers(raw: unknown, fallback: StaffTier[]): StaffTier[] {
  if (!Array.isArray(raw)) return fallback;
  return raw.map((t: Record<string, unknown>) => ({
    min: toNum(t.min, 0),
    inclusive: Boolean(t.inclusive),
    rate: toNum(t.rate, 0),
  }));
}

function normalizeScarico(v: unknown): ScaricoStatus {
  if (v === 'DA NON SCARICARE' || v === '-') return v;
  return 'DA SCARICARE';
}

function normalizeMethod(v: unknown): StaffCashPaymentMethod {
  if (v === 'card' || v === 'transfer' || v === 'other') return v;
  return 'cash';
}

function normalizeAllocations(raw: unknown): StaffCashAllocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
    .map(
      (x): StaffCashAllocation => ({
        type: x.type === 'table' ? 'table' : 'presale',
        id: String(x.id ?? ''),
        delta: toNum(x.delta, 0),
      })
    )
    .filter((x) => x.id && Math.abs(x.delta) > 0.001);
}

export function useStaffData(
  isAuthenticated: boolean,
  ownerPromoterId: 'lollo' | 'ciccio',
  pushUndo: (action: Omit<UndoAction, 'id'>) => void,
  onLinkedTablesChanged?: () => void
) {
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<StaffGroup>({
    owner_promoter_id: ownerPromoterId,
    name: ownerPromoterId === 'ciccio' ? 'Ice' : 'Reverse',
    default_presale_tiers: DEFAULT_PRESALE_TIERS,
    default_table_tiers: DEFAULT_TABLE_TIERS,
    sum_tables_per_pr: true,
  });
  const [plans, setPlans] = useState<StaffCommissionPlan[]>([]);
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [presales, setPresales] = useState<StaffEventPresale[]>([]);
  const [tables, setTables] = useState<StaffEventTable[]>([]);
  const [cashTransactions, setCashTransactions] = useState<StaffCashTransaction[]>([]);

  const presalesRef = useRef<StaffEventPresale[]>([]);
  presalesRef.current = presales;
  const tablesRef = useRef<StaffEventTable[]>([]);
  tablesRef.current = tables;
  const membersRef = useRef<StaffMember[]>([]);
  membersRef.current = members;
  const cashTxRef = useRef<StaffCashTransaction[]>([]);
  cashTxRef.current = cashTransactions;
  const reloadTimerRef = useRef<number | null>(null);
  const savingCounterRef = useRef(0);
  const mutationEpochRef = useRef(0);
  const lastLocalSaveEndAtRef = useRef(0);
  const pendingRemoteReloadRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const rowQueueRef = useRef(new Map<string, Promise<void>>());
  const scheduleReloadRef = useRef<() => void>(() => {});
  const onLinkedTablesChangedRef = useRef(onLinkedTablesChanged);
  onLinkedTablesChangedRef.current = onLinkedTablesChanged;

  const notifyLinked = useCallback(() => {
    onLinkedTablesChangedRef.current?.();
  }, []);

  const startSaving = useCallback(() => {
    savingCounterRef.current += 1;
    mutationEpochRef.current += 1;
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
  }, []);

  const endSaving = useCallback(() => {
    savingCounterRef.current = Math.max(0, savingCounterRef.current - 1);
    mutationEpochRef.current += 1;
    lastLocalSaveEndAtRef.current = Date.now();
    if (savingCounterRef.current === 0 && pendingRemoteReloadRef.current) {
      pendingRemoteReloadRef.current = false;
      scheduleReloadRef.current();
    }
  }, []);

  const enqueueRowOp = useCallback((rowId: string, op: () => Promise<void>): Promise<void> => {
    const prev = rowQueueRef.current.get(rowId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(op);
    rowQueueRef.current.set(rowId, next);
    next.finally(() => {
      if (rowQueueRef.current.get(rowId) === next) {
        rowQueueRef.current.delete(rowId);
      }
    });
    return next;
  }, []);

  const fetchStaff = useCallback(
    async (silent = false, force = false) => {
      if (silent && !force && savingCounterRef.current > 0) return;

      const mySeq = ++fetchSeqRef.current;
      const startEpoch = mutationEpochRef.current;
      if (!silent) setLoading(true);
      try {
        const [groupRes, plansRes, membersRes, preveRes, tavRes, cashRes] = await Promise.all([
          supabase
            .from('staff_groups')
            .select('*')
            .eq('owner_promoter_id', ownerPromoterId)
            .maybeSingle(),
          supabase
            .from('staff_commission_plans')
            .select('*')
            .eq('owner_promoter_id', ownerPromoterId)
            .order('is_default', { ascending: false })
            .order('name', { ascending: true }),
          supabase
            .from('staff_members')
            .select('*')
            .eq('owner_promoter_id', ownerPromoterId)
            .order('full_name', { ascending: true }),
          supabase
            .from('staff_event_presales')
            .select('*')
            .eq('owner_promoter_id', ownerPromoterId)
            .order('sort_order', { ascending: true }),
          supabase
            .from('staff_event_tables')
            .select('*')
            .eq('owner_promoter_id', ownerPromoterId)
            .order('sort_order', { ascending: true }),
          supabase
            .from('staff_cash_transactions')
            .select('*')
            .eq('owner_promoter_id', ownerPromoterId)
            .order('recorded_at', { ascending: false })
            .limit(500),
        ]);

        const firstErr =
          groupRes.error ||
          plansRes.error ||
          membersRes.error ||
          preveRes.error ||
          tavRes.error ||
          cashRes.error;
        if (firstErr) throw firstErr;

        if (mySeq !== fetchSeqRef.current) return;
        if (
          silent &&
          !force &&
          (savingCounterRef.current > 0 || mutationEpochRef.current !== startEpoch)
        ) {
          return;
        }

        if (groupRes.data) {
          setGroup({
            owner_promoter_id: ownerPromoterId,
            name: String(groupRes.data.name || (ownerPromoterId === 'ciccio' ? 'Ice' : 'Reverse')),
            default_presale_tiers: normalizeTiers(
              groupRes.data.default_presale_tiers,
              DEFAULT_PRESALE_TIERS
            ),
            default_table_tiers: normalizeTiers(
              groupRes.data.default_table_tiers,
              DEFAULT_TABLE_TIERS
            ),
            sum_tables_per_pr: groupRes.data.sum_tables_per_pr !== false,
            updated_at: groupRes.data.updated_at ? String(groupRes.data.updated_at) : undefined,
          });
        }

        setPlans(
          (plansRes.data || []).map((p) => ({
            id: String(p.id),
            owner_promoter_id: ownerPromoterId,
            name: String(p.name),
            description: String(p.description ?? ''),
            presale_tiers: normalizeTiers(p.presale_tiers, []),
            table_tiers: normalizeTiers(p.table_tiers, []),
            is_default: Boolean(p.is_default),
          }))
        );

        setMembers(
          (membersRes.data || []).map((m) => ({
            id: String(m.id),
            owner_promoter_id: ownerPromoterId,
            full_name: String(m.full_name),
            nickname: String(m.nickname ?? ''),
            aliases: Array.isArray(m.aliases) ? m.aliases.map(String) : [],
            plan_id: m.plan_id ? String(m.plan_id) : null,
            custom_presale_tiers: Array.isArray(m.custom_presale_tiers)
              ? normalizeTiers(m.custom_presale_tiers, [])
              : null,
            custom_table_tiers: Array.isArray(m.custom_table_tiers)
              ? normalizeTiers(m.custom_table_tiers, [])
              : null,
            is_self: Boolean(m.is_self),
            is_active: m.is_active !== false,
            notes: String(m.notes ?? ''),
          }))
        );

        setPresales(
          (preveRes.data || []).map((p) => ({
            id: String(p.id),
            owner_promoter_id: ownerPromoterId,
            event_id: String(p.event_id),
            staff_member_id: p.staff_member_id ? String(p.staff_member_id) : null,
            promoter_name: String(p.promoter_name ?? ''),
            quantity: toNum(p.quantity, 0),
            revenue: toNum(p.revenue, 0),
            scarico: toNum(p.scarico, 0),
            note_amount: toNum(p.note_amount, 0),
            note_text: String(p.note_text ?? ''),
            paid_cash: toNum(p.paid_cash, 0),
            busta_override:
              p.busta_override !== null && p.busta_override !== undefined
                ? toNum(p.busta_override)
                : null,
            is_busta_paid: Boolean(p.is_busta_paid),
            sort_order: toNum(p.sort_order, 0),
          }))
        );

        setTables(
          (tavRes.data || []).map((t) => ({
            id: String(t.id),
            owner_promoter_id: ownerPromoterId,
            event_id: String(t.event_id),
            event_table_id: t.event_table_id ? String(t.event_table_id) : null,
            staff_member_id: t.staff_member_id ? String(t.staff_member_id) : null,
            promoter_name: String(t.promoter_name ?? ''),
            table_name: String(t.table_name ?? ''),
            payers_count: toNum(t.payers_count, 0),
            price: toNum(t.price, 0),
            surcharge_payers_count: toNum(t.surcharge_payers_count, 0),
            surcharge_price: toNum(t.surcharge_price, 0),
            extra: toNum(t.extra, 0),
            extra_no_scarico: toNum(t.extra_no_scarico, 0),
            scarico_status: normalizeScarico(t.scarico_status),
            paid_cash: toNum(t.paid_cash, 0),
            busta_override:
              t.busta_override !== null && t.busta_override !== undefined
                ? toNum(t.busta_override)
                : null,
            is_busta_paid: Boolean(t.is_busta_paid),
            sort_order: toNum(t.sort_order, 0),
          }))
        );

        setCashTransactions(
          (cashRes.data || []).map((tx) => ({
            id: String(tx.id),
            owner_promoter_id: ownerPromoterId,
            event_id: String(tx.event_id),
            staff_member_id: tx.staff_member_id ? String(tx.staff_member_id) : null,
            promoter_name: String(tx.promoter_name ?? ''),
            amount: toNum(tx.amount, 0),
            payment_method: normalizeMethod(tx.payment_method),
            note: String(tx.note ?? ''),
            allocations: normalizeAllocations(tx.allocations),
            recorded_at: String(tx.recorded_at ?? tx.created_at ?? new Date().toISOString()),
          }))
        );
      } catch (err) {
        console.error('Staff fetch failed:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [ownerPromoterId]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchStaff(false);

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
        fetchStaff(true);
      }, delay);
    };
    scheduleReloadRef.current = scheduleReload;

    const ch = supabase
      .channel(`lc-staff-${ownerPromoterId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_groups' }, scheduleReload)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_commission_plans' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_members' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_event_presales' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_event_tables' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_cash_transactions' },
        scheduleReload
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_tables' }, scheduleReload)
      .subscribe();

    return () => {
      scheduleReloadRef.current = () => {};
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      supabase.removeChannel(ch);
    };
  }, [isAuthenticated, ownerPromoterId, fetchStaff]);

  // Pre-compute summaries keyed by event_id
  const summariesByEvent = useMemo(() => {
    const preveMap = new Map<string, StaffEventPresale[]>();
    for (const p of presales) {
      const arr = preveMap.get(p.event_id) || [];
      arr.push(p);
      preveMap.set(p.event_id, arr);
    }
    const tavMap = new Map<string, StaffEventTable[]>();
    for (const t of tables) {
      const arr = tavMap.get(t.event_id) || [];
      arr.push(t);
      tavMap.set(t.event_id, arr);
    }

    const eventIds = new Set<string>([...preveMap.keys(), ...tavMap.keys()]);
    const result = new Map<string, StaffEventSummary>();
    for (const evId of eventIds) {
      result.set(
        evId,
        computeStaffEventSummary(
          evId,
          preveMap.get(evId) || [],
          tavMap.get(evId) || [],
          members,
          plans,
          group
        )
      );
    }
    return result;
  }, [presales, tables, members, plans, group]);

  const getEventSummary = useCallback(
    (eventId: string): StaffEventSummary =>
      summariesByEvent.get(eventId) ||
      computeStaffEventSummary(eventId, [], [], members, plans, group),
    [summariesByEvent, members, plans, group]
  );

  // Quick lookup: event_table_id -> StaffEventTable (for EventDetail sub-PR picker!)
  const staffTableByEventTableId = useMemo(() => {
    const m = new Map<string, StaffEventTable>();
    for (const t of tables) {
      if (t.event_table_id) m.set(t.event_table_id, t);
    }
    return m;
  }, [tables]);

  // Sub-PR frequency map for smart top-chips ordering in StaffMemberPicker
  const memberUsageScore = useMemo(() => {
    const scores = new Map<string, number>();
    for (const t of tables) {
      if (t.staff_member_id) {
        scores.set(t.staff_member_id, (scores.get(t.staff_member_id) || 0) + 3);
      }
    }
    for (const p of presales) {
      if (p.staff_member_id) {
        scores.set(p.staff_member_id, (scores.get(p.staff_member_id) || 0) + 1);
      }
    }
    return scores;
  }, [tables, presales]);

  // --- Staff Group & Plans & Members CRUD ---

  const updateGroup = useCallback(
    async (patch: Partial<StaffGroup>) => {
      const next = { ...group, ...patch };
      setGroup(next);
      const { error } = await supabase
        .from('staff_groups')
        .upsert(
          {
            owner_promoter_id: ownerPromoterId,
            name: next.name,
            default_presale_tiers: next.default_presale_tiers,
            default_table_tiers: next.default_table_tiers,
            sum_tables_per_pr: next.sum_tables_per_pr,
          },
          { onConflict: 'owner_promoter_id' }
        );
      if (error) {
        toast.error('Errore salvataggio impostazioni staff');
        fetchStaff(true, true);
      } else {
        toast.success('Impostazioni staff aggiornate');
      }
    },
    [group, ownerPromoterId, fetchStaff]
  );

  const upsertPlan = useCallback(
    async (plan: Partial<StaffCommissionPlan> & { name: string }) => {
      try {
        if (plan.is_default) {
          await supabase
            .from('staff_commission_plans')
            .update({ is_default: false })
            .eq('owner_promoter_id', ownerPromoterId);
        }
        if (plan.id) {
          const { error } = await supabase
            .from('staff_commission_plans')
            .update({
              name: plan.name.trim(),
              description: plan.description ?? '',
              presale_tiers: plan.presale_tiers ?? [],
              table_tiers: plan.table_tiers ?? [],
              is_default: Boolean(plan.is_default),
            })
            .eq('id', plan.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('staff_commission_plans').insert({
            owner_promoter_id: ownerPromoterId,
            name: plan.name.trim(),
            description: plan.description ?? '',
            presale_tiers: plan.presale_tiers ?? [],
            table_tiers: plan.table_tiers ?? [],
            is_default: Boolean(plan.is_default),
          });
          if (error) throw error;
        }
        await fetchStaff(true, true);
        toast.success(`Piano “${plan.name}” salvato`);
      } catch (err) {
        console.error(err);
        toast.error('Errore salvataggio piano busta');
      }
    },
    [ownerPromoterId, fetchStaff]
  );

  const deletePlan = useCallback(async (planId: string) => {
    const { error } = await supabase.from('staff_commission_plans').delete().eq('id', planId);
    if (error) {
      toast.error('Impossibile eliminare il piano');
    } else {
      setPlans((prev) => prev.filter((p) => p.id !== planId));
      toast.success('Piano eliminato');
    }
  }, []);

  const upsertMember = useCallback(
    async (member: Partial<StaffMember> & { full_name: string }): Promise<StaffMember | null> => {
      try {
        const defaultPlan = plans.find((p) => p.is_default) || plans[0] || null;
        if (member.id) {
          const { data, error } = await supabase
            .from('staff_members')
            .update({
              full_name: member.full_name.trim(),
              nickname: (member.nickname ?? '').trim(),
              aliases: member.aliases ?? [],
              plan_id: member.plan_id ?? null,
              custom_presale_tiers: member.custom_presale_tiers ?? null,
              custom_table_tiers: member.custom_table_tiers ?? null,
              is_self: Boolean(member.is_self),
              is_active: member.is_active !== false,
              notes: member.notes ?? '',
            })
            .eq('id', member.id)
            .select()
            .single();
          if (error) throw error;
          await fetchStaff(true, true);
          toast.success(`Sotto-PR “${data.full_name}” aggiornato`);
          return data as StaffMember;
        } else {
          const { data, error } = await supabase
            .from('staff_members')
            .insert({
              owner_promoter_id: ownerPromoterId,
              full_name: member.full_name.trim(),
              nickname: (member.nickname ?? member.full_name.trim().split(' ')[0]).trim(),
              aliases: member.aliases ?? [member.full_name.trim().toLowerCase()],
              plan_id: member.plan_id !== undefined ? member.plan_id : defaultPlan?.id || null,
              custom_presale_tiers: member.custom_presale_tiers ?? null,
              custom_table_tiers: member.custom_table_tiers ?? null,
              is_self: Boolean(member.is_self),
              is_active: member.is_active !== false,
              notes: member.notes ?? '',
            })
            .select()
            .single();
          if (error) throw error;
          await fetchStaff(true, true);
          return data as StaffMember;
        }
      } catch (err) {
        console.error(err);
        toast.error('Errore salvataggio sotto-PR');
        return null;
      }
    },
    [ownerPromoterId, plans, fetchStaff]
  );

  // --- Raw Presale / Table / Cash Tx DB helpers (for Undo/Redo) ---

  const insertPresaleRaw = useCallback(
    async (row: Omit<StaffEventPresale, 'id'> & { id?: string }): Promise<StaffEventPresale> => {
      const tempId = row.id || `temp-sp-${Date.now()}`;
      setPresales((prev) => [...prev, { ...row, id: tempId }]);
      const payload: Record<string, unknown> = { ...row };
      if (tempId.startsWith('temp-')) delete payload.id;
      startSaving();
      try {
        const { data, error } = await supabase
          .from('staff_event_presales')
          .insert(payload)
          .select()
          .single();
        if (error) {
          setPresales((prev) => prev.filter((p) => p.id !== tempId));
          throw error;
        }
        const saved: StaffEventPresale = {
          id: String(data.id),
          owner_promoter_id: ownerPromoterId,
          event_id: String(data.event_id),
          staff_member_id: data.staff_member_id ? String(data.staff_member_id) : null,
          promoter_name: String(data.promoter_name ?? ''),
          quantity: toNum(data.quantity, 0),
          revenue: toNum(data.revenue, 0),
          scarico: toNum(data.scarico, 0),
          note_amount: toNum(data.note_amount, 0),
          note_text: String(data.note_text ?? ''),
          paid_cash: toNum(data.paid_cash, 0),
          busta_override:
            data.busta_override !== null && data.busta_override !== undefined
              ? toNum(data.busta_override)
              : null,
          is_busta_paid: Boolean(data.is_busta_paid),
          sort_order: toNum(data.sort_order, 0),
        };
        setPresales((prev) => prev.map((p) => (p.id === tempId ? saved : p)));
        return saved;
      } finally {
        endSaving();
      }
    },
    [ownerPromoterId, startSaving, endSaving]
  );

  const updatePresaleRaw = useCallback(
    async (id: string, patch: Partial<StaffEventPresale>) => {
      setPresales((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      if (id.startsWith('temp-')) return;
      startSaving();
      try {
        await enqueueRowOp(`sp:${id}`, async () => {
          const { error } = await supabase.from('staff_event_presales').update(patch).eq('id', id);
          if (error) throw error;
        });
      } finally {
        endSaving();
      }
    },
    [startSaving, endSaving, enqueueRowOp]
  );

  const deletePresaleRaw = useCallback(
    async (id: string) => {
      setPresales((prev) => prev.filter((p) => p.id !== id));
      if (id.startsWith('temp-')) return;
      startSaving();
      try {
        const { error } = await supabase.from('staff_event_presales').delete().eq('id', id);
        if (error) throw error;
      } finally {
        endSaving();
      }
    },
    [startSaving, endSaving]
  );

  const insertTableRaw = useCallback(
    async (
      row: Omit<StaffEventTable, 'id'> & { id?: string }
    ): Promise<StaffEventTable> => {
      const tempId = row.id || `temp-st-${Date.now()}`;
      setTables((prev) => [...prev, { ...row, id: tempId }]);
      const payload: Record<string, unknown> = { ...row };
      if (tempId.startsWith('temp-')) delete payload.id;
      // When recreating via Undo, let DB BEFORE INSERT trigger recreate linked event_table cleanly
      if (!payload.event_table_id) delete payload.event_table_id;

      startSaving();
      try {
        const { data, error } = await supabase
          .from('staff_event_tables')
          .insert(payload)
          .select()
          .single();
        if (error) {
          setTables((prev) => prev.filter((t) => t.id !== tempId));
          throw error;
        }
        const saved: StaffEventTable = {
          id: String(data.id),
          owner_promoter_id: ownerPromoterId,
          event_id: String(data.event_id),
          event_table_id: data.event_table_id ? String(data.event_table_id) : null,
          staff_member_id: data.staff_member_id ? String(data.staff_member_id) : null,
          promoter_name: String(data.promoter_name ?? ''),
          table_name: String(data.table_name ?? ''),
          payers_count: toNum(data.payers_count, 0),
          price: toNum(data.price, 0),
          surcharge_payers_count: toNum(data.surcharge_payers_count, 0),
          surcharge_price: toNum(data.surcharge_price, 0),
          extra: toNum(data.extra, 0),
          extra_no_scarico: toNum(data.extra_no_scarico, 0),
          scarico_status: normalizeScarico(data.scarico_status),
          paid_cash: toNum(data.paid_cash, 0),
          busta_override:
            data.busta_override !== null && data.busta_override !== undefined
              ? toNum(data.busta_override)
              : null,
          is_busta_paid: Boolean(data.is_busta_paid),
          sort_order: toNum(data.sort_order, 0),
        };
        setTables((prev) => prev.map((t) => (t.id === tempId ? saved : t)));
        notifyLinked();
        return saved;
      } finally {
        endSaving();
      }
    },
    [ownerPromoterId, notifyLinked, startSaving, endSaving]
  );

  const updateTableRaw = useCallback(
    async (id: string, patch: Partial<StaffEventTable>) => {
      setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (id.startsWith('temp-')) return;
      startSaving();
      try {
        await enqueueRowOp(`st:${id}`, async () => {
          const { error } = await supabase.from('staff_event_tables').update(patch).eq('id', id);
          if (error) throw error;
        });
        const touchesSyncedField =
          patch.table_name !== undefined ||
          patch.payers_count !== undefined ||
          patch.price !== undefined ||
          patch.surcharge_payers_count !== undefined ||
          patch.surcharge_price !== undefined ||
          patch.extra !== undefined ||
          patch.extra_no_scarico !== undefined ||
          patch.scarico_status !== undefined;
        if (touchesSyncedField) notifyLinked();
      } finally {
        endSaving();
      }
    },
    [notifyLinked, startSaving, endSaving, enqueueRowOp]
  );

  const deleteTableRaw = useCallback(
    async (id: string) => {
      setTables((prev) => prev.filter((t) => t.id !== id));
      if (id.startsWith('temp-')) return;
      startSaving();
      try {
        const { error } = await supabase.from('staff_event_tables').delete().eq('id', id);
        if (error) throw error;
        notifyLinked();
      } finally {
        endSaving();
      }
    },
    [notifyLinked, startSaving, endSaving]
  );

  const insertCashTxRaw = useCallback(
    async (
      tx: Omit<StaffCashTransaction, 'id' | 'recorded_at'> & {
        id?: string;
        recorded_at?: string;
      }
    ): Promise<StaffCashTransaction> => {
      const recordedAt = tx.recorded_at || new Date().toISOString();
      const tempId = tx.id || `temp-tx-${Date.now()}`;
      const optimistic: StaffCashTransaction = {
        ...tx,
        id: tempId,
        recorded_at: recordedAt,
      };
      setCashTransactions((prev) => [optimistic, ...prev]);

      const payload: Record<string, unknown> = {
        owner_promoter_id: tx.owner_promoter_id,
        event_id: tx.event_id,
        staff_member_id: tx.staff_member_id,
        promoter_name: tx.promoter_name,
        amount: tx.amount,
        payment_method: tx.payment_method,
        note: tx.note,
        allocations: tx.allocations,
        recorded_at: recordedAt,
      };
      if (tx.id && !tx.id.startsWith('temp-')) payload.id = tx.id;

      startSaving();
      try {
        const { data, error } = await supabase
          .from('staff_cash_transactions')
          .insert(payload)
          .select()
          .single();
        if (error) {
          setCashTransactions((prev) => prev.filter((x) => x.id !== tempId));
          throw error;
        }
        const saved: StaffCashTransaction = {
          id: String(data.id),
          owner_promoter_id: ownerPromoterId,
          event_id: String(data.event_id),
          staff_member_id: data.staff_member_id ? String(data.staff_member_id) : null,
          promoter_name: String(data.promoter_name ?? ''),
          amount: toNum(data.amount, 0),
          payment_method: normalizeMethod(data.payment_method),
          note: String(data.note ?? ''),
          allocations: normalizeAllocations(data.allocations),
          recorded_at: String(data.recorded_at ?? recordedAt),
        };
        setCashTransactions((prev) => prev.map((x) => (x.id === tempId ? saved : x)));
        return saved;
      } finally {
        endSaving();
      }
    },
    [ownerPromoterId, startSaving, endSaving]
  );

  const deleteCashTxRaw = useCallback(
    async (id: string) => {
      setCashTransactions((prev) => prev.filter((x) => x.id !== id));
      if (id.startsWith('temp-')) return;
      startSaving();
      try {
        const { error } = await supabase.from('staff_cash_transactions').delete().eq('id', id);
        if (error) throw error;
      } finally {
        endSaving();
      }
    },
    [startSaving, endSaving]
  );

  const applyAllocationsDelta = useCallback(
    async (allocations: StaffCashAllocation[], sign: 1 | -1) => {
      for (const a of allocations) {
        if (a.type === 'presale') {
          const cur = presalesRef.current.find((p) => p.id === a.id);
          if (!cur) continue;
          const nextPaid = round2(Math.max(0, cur.paid_cash + sign * a.delta));
          await updatePresaleRaw(a.id, { paid_cash: nextPaid });
        } else {
          const cur = tablesRef.current.find((t) => t.id === a.id);
          if (!cur) continue;
          const nextPaid = round2(Math.max(0, cur.paid_cash + sign * a.delta));
          await updateTableRaw(a.id, { paid_cash: nextPaid });
        }
      }
    },
    [updatePresaleRaw, updateTableRaw]
  );

  // Assign a sub-PR to a linked table created/edited from shared Serate tab
  const assignSubPrToEventTable = useCallback(
    async (eventTableId: string, staffMemberId: string | null, promoterName: string) => {
      // Find locally or query DB (in case Realtime hasn't arrived yet after insert)
      const local = tablesRef.current.find((t) => t.event_table_id === eventTableId);
      if (local) {
        await updateTableRaw(local.id, {
          staff_member_id: staffMemberId,
          promoter_name: promoterName,
        });
        return;
      }
      const { error } = await supabase
        .from('staff_event_tables')
        .update({
          staff_member_id: staffMemberId,
          promoter_name: promoterName,
        })
        .eq('owner_promoter_id', ownerPromoterId)
        .eq('event_table_id', eventTableId);
      if (error) {
        console.error('assignSubPrToEventTable failed:', error);
      } else {
        await fetchStaff(true, true);
      }
    },
    [ownerPromoterId, updateTableRaw, fetchStaff]
  );

  // --- Undo-Tracked Staff Event Mutations ---

  const addStaffPresale = useCallback(
    async (
      eventId: string,
      input: {
        staff_member_id: string | null;
        promoter_name: string;
        quantity: number;
        revenue: number;
        scarico: number;
        note_amount?: number;
        paid_cash?: number;
      }
    ) => {
      const existingForEv = presalesRef.current.filter((p) => p.event_id === eventId);
      const nextOrder = Math.max(-1, ...existingForEv.map((p) => p.sort_order)) + 1;
      try {
        const saved = await insertPresaleRaw({
          owner_promoter_id: ownerPromoterId,
          event_id: eventId,
          staff_member_id: input.staff_member_id,
          promoter_name: input.promoter_name,
          quantity: input.quantity,
          revenue: input.revenue,
          scarico: input.scarico,
          note_amount: input.note_amount ?? 0,
          note_text: '',
          paid_cash: input.paid_cash ?? 0,
          busta_override: null,
          is_busta_paid: false,
          sort_order: nextOrder,
        });
        pushUndo({
          label: `Prevendite ${saved.promoter_name}`,
          undo: () => deletePresaleRaw(saved.id),
          redo: async () => {
            await insertPresaleRaw(saved);
          },
        });
        return saved;
      } catch {
        toast.error('Errore aggiunta prevendite sotto-PR');
        return null;
      }
    },
    [ownerPromoterId, insertPresaleRaw, deletePresaleRaw, pushUndo]
  );

  const updateStaffPresale = useCallback(
    async (id: string, patch: Partial<StaffEventPresale>) => {
      const cur = presalesRef.current.find((p) => p.id === id);
      if (!cur) return;
      const prevPatch: Partial<StaffEventPresale> = {};
      for (const k of Object.keys(patch) as (keyof StaffEventPresale)[]) {
        (prevPatch as Record<string, unknown>)[k] = cur[k];
      }
      try {
        await updatePresaleRaw(id, patch);
        pushUndo({
          label: `Prevendite ${cur.promoter_name}`,
          undo: () => updatePresaleRaw(id, prevPatch),
          redo: () => updatePresaleRaw(id, patch),
        });
      } catch {
        toast.error('Errore salvataggio prevendite staff');
        fetchStaff(true, true);
      }
    },
    [updatePresaleRaw, pushUndo, fetchStaff]
  );

  const deleteStaffPresale = useCallback(
    async (id: string) => {
      const snap = presalesRef.current.find((p) => p.id === id);
      if (!snap) return;
      try {
        await deletePresaleRaw(id);
        pushUndo({
          label: `Rimozione preve ${snap.promoter_name}`,
          undo: async () => {
            await insertPresaleRaw(snap);
          },
          redo: () => deletePresaleRaw(snap.id),
        });
      } catch {
        toast.error('Errore eliminazione riga');
        fetchStaff(true, true);
      }
    },
    [deletePresaleRaw, insertPresaleRaw, pushUndo, fetchStaff]
  );

  const addStaffTable = useCallback(
    async (
      eventId: string,
      input: {
        staff_member_id: string | null;
        promoter_name: string;
        table_name: string;
        payers_count: number;
        price: number;
        surcharge_payers_count?: number;
        surcharge_price?: number;
        extra?: number;
        extra_no_scarico?: number;
        scarico_status?: ScaricoStatus;
        paid_cash?: number;
      }
    ) => {
      const existingForEv = tablesRef.current.filter((t) => t.event_id === eventId);
      const nextOrder = Math.max(-1, ...existingForEv.map((t) => t.sort_order)) + 1;
      try {
        const saved = await insertTableRaw({
          owner_promoter_id: ownerPromoterId,
          event_id: eventId,
          event_table_id: null,
          staff_member_id: input.staff_member_id,
          promoter_name: input.promoter_name,
          table_name: input.table_name,
          payers_count: input.payers_count,
          price: input.price,
          surcharge_payers_count: input.surcharge_payers_count ?? 0,
          surcharge_price: input.surcharge_price ?? 0,
          extra: input.extra ?? 0,
          extra_no_scarico: input.extra_no_scarico ?? 0,
          scarico_status: input.scarico_status ?? 'DA SCARICARE',
          paid_cash: input.paid_cash ?? 0,
          busta_override: null,
          is_busta_paid: false,
          sort_order: nextOrder,
        });
        let currentId = saved.id;
        pushUndo({
          label: `Tavolo “${saved.table_name}”`,
          undo: () => deleteTableRaw(currentId),
          redo: async () => {
            const recreated = await insertTableRaw({ ...saved, id: undefined, event_table_id: null });
            currentId = recreated.id;
          },
        });
        return saved;
      } catch {
        toast.error('Errore aggiunta tavolo staff');
        return null;
      }
    },
    [ownerPromoterId, insertTableRaw, deleteTableRaw, pushUndo]
  );

  const updateStaffTable = useCallback(
    async (id: string, patch: Partial<StaffEventTable>) => {
      const cur = tablesRef.current.find((t) => t.id === id);
      if (!cur) return;
      const prevPatch: Partial<StaffEventTable> = {};
      for (const k of Object.keys(patch) as (keyof StaffEventTable)[]) {
        (prevPatch as Record<string, unknown>)[k] = cur[k];
      }
      try {
        await updateTableRaw(id, patch);
        pushUndo({
          label: `Tavolo “${cur.table_name}”`,
          undo: () => updateTableRaw(id, prevPatch),
          redo: () => updateTableRaw(id, patch),
        });
      } catch {
        toast.error('Errore salvataggio tavolo staff');
        fetchStaff(true, true);
      }
    },
    [updateTableRaw, pushUndo, fetchStaff]
  );

  const deleteStaffTable = useCallback(
    async (id: string) => {
      const snap = tablesRef.current.find((t) => t.id === id);
      if (!snap) return;
      try {
        await deleteTableRaw(id);
        let restoredId = snap.id;
        pushUndo({
          label: `Rimozione tavolo “${snap.table_name}”`,
          undo: async () => {
            const recreated = await insertTableRaw({
              ...snap,
              id: undefined,
              event_table_id: null,
            });
            restoredId = recreated.id;
          },
          redo: () => deleteTableRaw(restoredId),
        });
      } catch {
        toast.error('Errore eliminazione tavolo staff');
        fetchStaff(true, true);
      }
    },
    [deleteTableRaw, insertTableRaw, pushUndo, fetchStaff]
  );

  // --- Live Cash Collection ("Raccolta Soldi") + History ---

  const recordCashPayment = useCallback(
    async (input: {
      eventId: string;
      staffMemberId: string | null;
      promoterName: string;
      amount: number;
      paymentMethod?: StaffCashPaymentMethod;
      note?: string;
    }): Promise<StaffCashTransaction | null> => {
      const amt = round2(input.amount);
      if (!Number.isFinite(amt) || Math.abs(amt) < 0.01) return null;

      const summary = getEventSummary(input.eventId);
      const rollup = summary.membersRollup.find(
        (r) =>
          (input.staffMemberId && r.member?.id === input.staffMemberId) ||
          r.displayName.toLowerCase() === input.promoterName.trim().toLowerCase() ||
          r.fullName.toLowerCase() === input.promoterName.trim().toLowerCase()
      );

      const allocations: StaffCashAllocation[] = [];
      let remaining = amt;
      let createdPlaceholderPresaleId: string | null = null;

      if (rollup) {
        if (remaining > 0) {
          // 1. Allocate to open presales first
          for (const cp of rollup.presaleRows) {
            if (remaining <= 0.005) break;
            if (cp.mancanti > 0.005) {
              const take = round2(Math.min(remaining, cp.mancanti));
              allocations.push({ type: 'presale', id: cp.row.id, delta: take });
              remaining = round2(remaining - take);
            }
          }
          // 2. Allocate to open DA SCARICARE tables
          for (const ct of rollup.tableRows) {
            if (remaining <= 0.005) break;
            if (ct.mancanti > 0.005) {
              const take = round2(Math.min(remaining, ct.mancanti));
              allocations.push({ type: 'table', id: ct.row.id, delta: take });
              remaining = round2(remaining - take);
            }
          }
          // 3. Any overpayment / advance goes onto first presale or first DA SCARICARE table
          if (remaining > 0.005) {
            if (rollup.presaleRows.length > 0) {
              const id = rollup.presaleRows[0].row.id;
              const existing = allocations.find((a) => a.type === 'presale' && a.id === id);
              if (existing) existing.delta = round2(existing.delta + remaining);
              else allocations.push({ type: 'presale', id, delta: remaining });
            } else if (rollup.tableRows.length > 0) {
              const id = rollup.tableRows[0].row.id;
              const existing = allocations.find((a) => a.type === 'table' && a.id === id);
              if (existing) existing.delta = round2(existing.delta + remaining);
              else allocations.push({ type: 'table', id, delta: remaining });
            }
          }
        } else {
          // Negative correction / refund: deduct from rows with paid_cash > 0
          let toDeduct = Math.abs(remaining);
          for (const ct of [...rollup.tableRows].reverse()) {
            if (toDeduct <= 0.005) break;
            if (ct.row.paid_cash > 0.005) {
              const take = round2(Math.min(toDeduct, ct.row.paid_cash));
              allocations.push({ type: 'table', id: ct.row.id, delta: -take });
              toDeduct = round2(toDeduct - take);
            }
          }
          for (const cp of [...rollup.presaleRows].reverse()) {
            if (toDeduct <= 0.005) break;
            if (cp.row.paid_cash > 0.005) {
              const take = round2(Math.min(toDeduct, cp.row.paid_cash));
              allocations.push({ type: 'presale', id: cp.row.id, delta: -take });
              toDeduct = round2(toDeduct - take);
            }
          }
        }
      } else {
        // Sub-PR wasn't in this event yet — create a 0-qty presale row to hold the collected cash
        const existingForEv = presalesRef.current.filter((p) => p.event_id === input.eventId);
        const nextOrder = Math.max(-1, ...existingForEv.map((p) => p.sort_order)) + 1;
        const created = await insertPresaleRaw({
          owner_promoter_id: ownerPromoterId,
          event_id: input.eventId,
          staff_member_id: input.staffMemberId,
          promoter_name: input.promoterName,
          quantity: 0,
          revenue: 0,
          scarico: 0,
          note_amount: 0,
          note_text: '',
          paid_cash: 0,
          busta_override: null,
          is_busta_paid: false,
          sort_order: nextOrder,
        });
        createdPlaceholderPresaleId = created.id;
        allocations.push({ type: 'presale', id: created.id, delta: amt });
      }

      try {
        await applyAllocationsDelta(allocations, 1);
        const savedTx = await insertCashTxRaw({
          owner_promoter_id: ownerPromoterId,
          event_id: input.eventId,
          staff_member_id: rollup?.member?.id ?? input.staffMemberId,
          promoter_name: rollup?.displayName || input.promoterName,
          amount: amt,
          payment_method: input.paymentMethod ?? 'cash',
          note: (input.note ?? '').trim(),
          allocations,
        });

        pushUndo({
          label: `${amt >= 0 ? '+' : ''}${amt} € da ${savedTx.promoter_name}`,
          undo: async () => {
            await applyAllocationsDelta(allocations, -1);
            await deleteCashTxRaw(savedTx.id);
            if (createdPlaceholderPresaleId) {
              await deletePresaleRaw(createdPlaceholderPresaleId);
            }
          },
          redo: async () => {
            await applyAllocationsDelta(allocations, 1);
            await insertCashTxRaw(savedTx);
          },
        });

        return savedTx;
      } catch (err) {
        console.error(err);
        toast.error('Errore registrazione incasso');
        fetchStaff(true, true);
        return null;
      }
    },
    [
      ownerPromoterId,
      getEventSummary,
      insertPresaleRaw,
      deletePresaleRaw,
      applyAllocationsDelta,
      insertCashTxRaw,
      deleteCashTxRaw,
      pushUndo,
      fetchStaff,
    ]
  );

  const deleteCashTransaction = useCallback(
    async (txId: string) => {
      const snap = cashTxRef.current.find((x) => x.id === txId);
      if (!snap) return;
      try {
        await applyAllocationsDelta(snap.allocations, -1);
        await deleteCashTxRaw(snap.id);
        pushUndo({
          label: `Annulla incasso ${snap.promoter_name}`,
          undo: async () => {
            await applyAllocationsDelta(snap.allocations, 1);
            await insertCashTxRaw(snap);
          },
          redo: async () => {
            await applyAllocationsDelta(snap.allocations, -1);
            await deleteCashTxRaw(snap.id);
          },
        });
        toast.success(`Movimento di ${snap.promoter_name} rimosso`);
      } catch (err) {
        console.error(err);
        toast.error('Errore rimozione movimento');
        fetchStaff(true, true);
      }
    },
    [applyAllocationsDelta, deleteCashTxRaw, insertCashTxRaw, pushUndo, fetchStaff]
  );

  // 1-tap atomic cash settlement for a sub-PR across both presales + DA SCARICARE tables (logs to history!)
  const settleMemberCash = useCallback(
    async (rollup: StaffMemberEventRollup, note = 'Saldo rapido') => {
      const allocations: StaffCashAllocation[] = [];
      let totalDelta = 0;

      for (const cp of rollup.presaleRows) {
        const target = Math.max(0, round2(cp.row.scarico + cp.row.note_amount));
        const delta = round2(target - cp.row.paid_cash);
        if (Math.abs(delta) >= 0.01) {
          allocations.push({ type: 'presale', id: cp.row.id, delta });
          totalDelta = round2(totalDelta + delta);
        }
      }
      for (const ct of rollup.tableRows) {
        const target = Math.max(0, ct.scaricoApplied);
        const delta = round2(target - ct.row.paid_cash);
        if (Math.abs(delta) >= 0.01) {
          allocations.push({ type: 'table', id: ct.row.id, delta });
          totalDelta = round2(totalDelta + delta);
        }
      }
      if (allocations.length === 0) return;

      const eventId = rollup.presaleRows[0]?.row.event_id || rollup.tableRows[0]?.row.event_id;

      await applyAllocationsDelta(allocations, 1);
      let savedTx: StaffCashTransaction | null = null;
      if (eventId && Math.abs(totalDelta) >= 0.01) {
        savedTx = await insertCashTxRaw({
          owner_promoter_id: ownerPromoterId,
          event_id: eventId,
          staff_member_id: rollup.member?.id ?? null,
          promoter_name: rollup.displayName,
          amount: totalDelta,
          payment_method: 'cash',
          note,
          allocations,
        });
      }

      pushUndo({
        label: `Salda cassa ${rollup.displayName}`,
        undo: async () => {
          await applyAllocationsDelta(allocations, -1);
          if (savedTx) await deleteCashTxRaw(savedTx.id);
        },
        redo: async () => {
          await applyAllocationsDelta(allocations, 1);
          if (savedTx) await insertCashTxRaw(savedTx);
        },
      });
      toast.success(`Cassa di ${rollup.displayName} saldata`);
    },
    [ownerPromoterId, applyAllocationsDelta, insertCashTxRaw, deleteCashTxRaw, pushUndo]
  );

  // 1-tap atomic Busta Paid toggle for a sub-PR across both presales + tables
  const toggleMemberBustaPaid = useCallback(
    async (rollup: StaffMemberEventRollup, paid: boolean) => {
      const pReverts = rollup.presaleRows.map((cp) => ({
        id: cp.row.id,
        prev: cp.row.is_busta_paid,
      }));
      const tReverts = rollup.tableRows.map((ct) => ({
        id: ct.row.id,
        prev: ct.row.is_busta_paid,
      }));
      if (pReverts.length === 0 && tReverts.length === 0) return;

      const applyForward = async () => {
        await Promise.all([
          ...pReverts.map((x) => updatePresaleRaw(x.id, { is_busta_paid: paid })),
          ...tReverts.map((x) => updateTableRaw(x.id, { is_busta_paid: paid })),
        ]);
      };
      const applyBackward = async () => {
        await Promise.all([
          ...pReverts.map((x) => updatePresaleRaw(x.id, { is_busta_paid: x.prev })),
          ...tReverts.map((x) => updateTableRaw(x.id, { is_busta_paid: x.prev })),
        ]);
      };

      try {
        await applyForward();
        pushUndo({
          label: paid ? `Busta pagata ${rollup.displayName}` : `Busta riaperta ${rollup.displayName}`,
          undo: applyBackward,
          redo: applyForward,
        });
        toast.success(
          paid
            ? `Busta di ${rollup.displayName} segnata come pagata`
            : `Busta di ${rollup.displayName} segnata da pagare`
        );
      } catch (err) {
        console.error(err);
        toast.error('Errore aggiornamento stato busta');
        fetchStaff(true, true);
      }
    },
    [updatePresaleRaw, updateTableRaw, pushUndo, fetchStaff]
  );

  // Bulk import pasted TicketSMS report (matches existing sub-PRs or creates new ones cleanly!)
  const importTicketSmsPresales = useCallback(
    async (
      eventId: string,
      rows: { promoterName: string; quantity: number; revenue: number; scarico: number }[]
    ) => {
      if (rows.length === 0) return;
      const defaultPlan = plans.find((p) => p.is_default) || plans[0] || null;
      const currentMembers = [...membersRef.current];
      const existingEventRows = presalesRef.current.filter((p) => p.event_id === eventId);

      for (const r of rows) {
        let member = matchStaffMemberByName(r.promoterName, currentMembers);
        if (!member) {
          const isSelf = r.promoterName.trim().toLowerCase() === 'io';
          const { data: createdMember } = await supabase
            .from('staff_members')
            .insert({
              owner_promoter_id: ownerPromoterId,
              full_name: isSelf
                ? `Io (${ownerPromoterId === 'ciccio' ? 'Ciccio' : 'Lollo'})`
                : r.promoterName.trim(),
              nickname: r.promoterName.trim().split(' ')[0],
              aliases: [r.promoterName.trim().toLowerCase()],
              plan_id: isSelf ? null : defaultPlan?.id || null,
              is_self: isSelf,
              is_active: true,
            })
            .select()
            .single();
          if (createdMember) {
            member = {
              id: String(createdMember.id),
              owner_promoter_id: ownerPromoterId,
              full_name: String(createdMember.full_name),
              nickname: String(createdMember.nickname ?? ''),
              aliases: Array.isArray(createdMember.aliases) ? createdMember.aliases.map(String) : [],
              plan_id: createdMember.plan_id ? String(createdMember.plan_id) : null,
              custom_presale_tiers: null,
              custom_table_tiers: null,
              is_self: Boolean(createdMember.is_self),
              is_active: true,
              notes: '',
            };
            currentMembers.push(member);
          }
        }

        const existing = existingEventRows.find(
          (p) =>
            (member && p.staff_member_id === member.id) ||
            p.promoter_name.toLowerCase() === r.promoterName.trim().toLowerCase()
        );

        if (existing) {
          await supabase
            .from('staff_event_presales')
            .update({
              staff_member_id: member?.id || existing.staff_member_id,
              quantity: r.quantity,
              revenue: r.revenue,
              scarico: r.scarico,
            })
            .eq('id', existing.id);
        } else {
          await supabase.from('staff_event_presales').insert({
            owner_promoter_id: ownerPromoterId,
            event_id: eventId,
            staff_member_id: member?.id || null,
            promoter_name: member?.full_name || r.promoterName.trim(),
            quantity: r.quantity,
            revenue: r.revenue,
            scarico: r.scarico,
            sort_order: existingEventRows.length + 1,
          });
        }
      }

      await fetchStaff(true, true);
      toast.success(`Importati ${rows.length} promoter dal report TicketSMS`);
    },
    [ownerPromoterId, plans, fetchStaff]
  );

  return {
    loading,
    group,
    plans,
    members,
    presales,
    tables,
    cashTransactions,
    summariesByEvent,
    staffTableByEventTableId,
    memberUsageScore,
    getEventSummary,
    fetchStaff,
    updateGroup,
    upsertPlan,
    deletePlan,
    upsertMember,
    addStaffPresale,
    updateStaffPresale,
    deleteStaffPresale,
    addStaffTable,
    updateStaffTable,
    deleteStaffTable,
    assignSubPrToEventTable,
    settleMemberCash,
    toggleMemberBustaPaid,
    recordCashPayment,
    deleteCashTransaction,
    importTicketSmsPresales,
  };
}
