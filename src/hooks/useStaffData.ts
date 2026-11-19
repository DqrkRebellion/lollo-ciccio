import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import {
  computeStaffEventSummary,
  DEFAULT_PRESALE_TIERS,
  DEFAULT_TABLE_TIERS,
  matchStaffMemberByName,
} from '../lib/staffCalculations';
import type { UndoAction } from '../types';
import type {
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

export function useStaffData(
  isAuthenticated: boolean,
  ownerPromoterId: 'lollo' | 'ciccio',
  pushUndo: (action: Omit<UndoAction, 'id'>) => void
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

  const presalesRef = useRef<StaffEventPresale[]>([]);
  presalesRef.current = presales;
  const tablesRef = useRef<StaffEventTable[]>([]);
  tablesRef.current = tables;
  const membersRef = useRef<StaffMember[]>([]);
  membersRef.current = members;
  const reloadTimerRef = useRef<number | null>(null);

  const fetchStaff = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [groupRes, plansRes, membersRes, preveRes, tavRes] = await Promise.all([
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
        ]);

        const firstErr =
          groupRes.error || plansRes.error || membersRes.error || preveRes.error || tavRes.error;
        if (firstErr) throw firstErr;

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
            staff_member_id: t.staff_member_id ? String(t.staff_member_id) : null,
            promoter_name: String(t.promoter_name ?? ''),
            table_name: String(t.table_name ?? ''),
            payers_count: toNum(t.payers_count, 0),
            price: toNum(t.price, 0),
            surcharge_payers_count: toNum(t.surcharge_payers_count, 0),
            surcharge_price: toNum(t.surcharge_price, 0),
            extra: toNum(t.extra, 0),
            paid_cash: toNum(t.paid_cash, 0),
            busta_override:
              t.busta_override !== null && t.busta_override !== undefined
                ? toNum(t.busta_override)
                : null,
            is_busta_paid: Boolean(t.is_busta_paid),
            sort_order: toNum(t.sort_order, 0),
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
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = window.setTimeout(() => fetchStaff(true), 400);
    };

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
      .subscribe();

    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
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
        fetchStaff(true);
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
        await fetchStaff(true);
        toast.success(`Piano “${plan.name}” salvato`);
      } catch (err) {
        console.error(err);
        toast.error('Errore salvataggio piano busta');
      }
    },
    [ownerPromoterId, fetchStaff]
  );

  const deletePlan = useCallback(
    async (planId: string) => {
      const { error } = await supabase.from('staff_commission_plans').delete().eq('id', planId);
      if (error) {
        toast.error('Impossibile eliminare il piano');
      } else {
        setPlans((prev) => prev.filter((p) => p.id !== planId));
        toast.success('Piano eliminato');
      }
    },
    []
  );

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
          await fetchStaff(true);
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
          await fetchStaff(true);
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

  // --- Raw Presale / Table DB helpers (for Undo/Redo) ---

  const insertPresaleRaw = useCallback(
    async (row: Omit<StaffEventPresale, 'id'> & { id?: string }): Promise<StaffEventPresale> => {
      const tempId = row.id || `temp-sp-${Date.now()}`;
      setPresales((prev) => [...prev, { ...row, id: tempId }]);
      const payload: Record<string, unknown> = { ...row };
      if (tempId.startsWith('temp-')) delete payload.id;
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
    },
    [ownerPromoterId]
  );

  const updatePresaleRaw = useCallback(async (id: string, patch: Partial<StaffEventPresale>) => {
    setPresales((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if (id.startsWith('temp-')) return;
    const { error } = await supabase.from('staff_event_presales').update(patch).eq('id', id);
    if (error) throw error;
  }, []);

  const deletePresaleRaw = useCallback(async (id: string) => {
    setPresales((prev) => prev.filter((p) => p.id !== id));
    if (id.startsWith('temp-')) return;
    const { error } = await supabase.from('staff_event_presales').delete().eq('id', id);
    if (error) throw error;
  }, []);

  const insertTableRaw = useCallback(
    async (row: Omit<StaffEventTable, 'id'> & { id?: string }): Promise<StaffEventTable> => {
      const tempId = row.id || `temp-st-${Date.now()}`;
      setTables((prev) => [...prev, { ...row, id: tempId }]);
      const payload: Record<string, unknown> = { ...row };
      if (tempId.startsWith('temp-')) delete payload.id;
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
        staff_member_id: data.staff_member_id ? String(data.staff_member_id) : null,
        promoter_name: String(data.promoter_name ?? ''),
        table_name: String(data.table_name ?? ''),
        payers_count: toNum(data.payers_count, 0),
        price: toNum(data.price, 0),
        surcharge_payers_count: toNum(data.surcharge_payers_count, 0),
        surcharge_price: toNum(data.surcharge_price, 0),
        extra: toNum(data.extra, 0),
        paid_cash: toNum(data.paid_cash, 0),
        busta_override:
          data.busta_override !== null && data.busta_override !== undefined
            ? toNum(data.busta_override)
            : null,
        is_busta_paid: Boolean(data.is_busta_paid),
        sort_order: toNum(data.sort_order, 0),
      };
      setTables((prev) => prev.map((t) => (t.id === tempId ? saved : t)));
      return saved;
    },
    [ownerPromoterId]
  );

  const updateTableRaw = useCallback(async (id: string, patch: Partial<StaffEventTable>) => {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (id.startsWith('temp-')) return;
    const { error } = await supabase.from('staff_event_tables').update(patch).eq('id', id);
    if (error) throw error;
  }, []);

  const deleteTableRaw = useCallback(async (id: string) => {
    setTables((prev) => prev.filter((t) => t.id !== id));
    if (id.startsWith('temp-')) return;
    const { error } = await supabase.from('staff_event_tables').delete().eq('id', id);
    if (error) throw error;
  }, []);

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
        fetchStaff(true);
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
        fetchStaff(true);
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
        paid_cash?: number;
      }
    ) => {
      const existingForEv = tablesRef.current.filter((t) => t.event_id === eventId);
      const nextOrder = Math.max(-1, ...existingForEv.map((t) => t.sort_order)) + 1;
      try {
        const saved = await insertTableRaw({
          owner_promoter_id: ownerPromoterId,
          event_id: eventId,
          staff_member_id: input.staff_member_id,
          promoter_name: input.promoter_name,
          table_name: input.table_name,
          payers_count: input.payers_count,
          price: input.price,
          surcharge_payers_count: input.surcharge_payers_count ?? 0,
          surcharge_price: input.surcharge_price ?? 0,
          extra: input.extra ?? 0,
          paid_cash: input.paid_cash ?? 0,
          busta_override: null,
          is_busta_paid: false,
          sort_order: nextOrder,
        });
        pushUndo({
          label: `Tavolo staff “${saved.table_name}”`,
          undo: () => deleteTableRaw(saved.id),
          redo: async () => {
            await insertTableRaw(saved);
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
        fetchStaff(true);
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
        pushUndo({
          label: `Rimozione tavolo “${snap.table_name}”`,
          undo: async () => {
            await insertTableRaw(snap);
          },
          redo: () => deleteTableRaw(snap.id),
        });
      } catch {
        toast.error('Errore eliminazione tavolo staff');
        fetchStaff(true);
      }
    },
    [deleteTableRaw, insertTableRaw, pushUndo, fetchStaff]
  );

  // 1-tap atomic cash settlement for a sub-PR across both presales + tables
  const settleMemberCash = useCallback(
    async (rollup: StaffMemberEventRollup) => {
      const pReverts: { id: string; prev: number; next: number }[] = [];
      const tReverts: { id: string; prev: number; next: number }[] = [];

      for (const cp of rollup.presaleRows) {
        const target = Math.max(
          0,
          Math.round((cp.row.scarico + cp.row.note_amount) * 100) / 100
        );
        if (Math.abs(cp.row.paid_cash - target) >= 0.01) {
          pReverts.push({ id: cp.row.id, prev: cp.row.paid_cash, next: target });
        }
      }
      for (const ct of rollup.tableRows) {
        const target = Math.max(0, ct.credito);
        if (Math.abs(ct.row.paid_cash - target) >= 0.01) {
          tReverts.push({ id: ct.row.id, prev: ct.row.paid_cash, next: target });
        }
      }
      if (pReverts.length === 0 && tReverts.length === 0) return;

      const applyForward = async () => {
        await Promise.all([
          ...pReverts.map((x) => updatePresaleRaw(x.id, { paid_cash: x.next })),
          ...tReverts.map((x) => updateTableRaw(x.id, { paid_cash: x.next })),
        ]);
      };
      const applyBackward = async () => {
        await Promise.all([
          ...pReverts.map((x) => updatePresaleRaw(x.id, { paid_cash: x.prev })),
          ...tReverts.map((x) => updateTableRaw(x.id, { paid_cash: x.prev })),
        ]);
      };

      await applyForward();
      pushUndo({
        label: `Salda cassa ${rollup.displayName}`,
        undo: applyBackward,
        redo: applyForward,
      });
      toast.success(`Cassa di ${rollup.displayName} saldata`);
    },
    [updatePresaleRaw, updateTableRaw, pushUndo]
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
    },
    [updatePresaleRaw, updateTableRaw, pushUndo]
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
              full_name: isSelf ? `Io (${ownerPromoterId === 'ciccio' ? 'Ciccio' : 'Lollo'})` : r.promoterName.trim(),
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

      await fetchStaff(true);
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
    summariesByEvent,
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
    settleMemberCash,
    toggleMemberBustaPaid,
    importTicketSmsPresales,
  };
}
