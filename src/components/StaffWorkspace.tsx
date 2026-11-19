import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Lock,
  Pencil,
  Plus,
  Search,
  Sliders,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { StaffEventDetail } from './StaffEventDetail';
import {
  AppleModal,
  AppleSwitch,
  MancantiBadge,
  NumericCellInput,
  SegmentedControl,
} from './ui/AppleControls';
import {
  DEFAULT_PRESALE_TIERS,
  DEFAULT_TABLE_TIERS,
  resolveMemberRules,
} from '../lib/staffCalculations';
import {
  formatDateDayMonth,
  formatEur,
  formatInt,
  formatMonthYear,
  formatPercent,
} from '../lib/format';
import type { useStaffData } from '../hooks/useStaffData';
import type { EventSummary, FullEvent, Venue } from '../types';
import type {
  StaffCommissionPlan,
  StaffMember,
  StaffMemberEventRollup,
  StaffTier,
} from '../types/staff';

type WorkspaceSection = 'events' | 'ledger' | 'team';
type EventListFilter = 'ALL' | 'WITH_DATA' | 'OPEN_MANCANTI' | 'UNPAID_BUSTA';
type LedgerMode = 'by_pr' | 'by_event';
type LedgerFilter = 'OPEN' | 'MANCANTI' | 'BUSTE' | 'ALL';

function formatPresaleTierChip(t: StaffTier): string {
  const op = t.inclusive ? '≥' : '>';
  return `${op} ${formatInt(t.min)} → ${formatEur(t.rate, true)}/preve`;
}

function formatTableTierChip(t: StaffTier): string {
  const op = t.inclusive ? '≥' : '>';
  return `${op} ${formatEur(t.min)} → ${formatPercent(t.rate)}`;
}

function TierListEditor({
  mode,
  tiers,
  onChange,
}: {
  mode: 'presale' | 'table';
  tiers: StaffTier[];
  onChange: (next: StaffTier[]) => void;
}) {
  const addRow = () => {
    const next: StaffTier =
      mode === 'presale'
        ? { min: 20, inclusive: false, rate: 0.5 }
        : { min: 400, inclusive: true, rate: 0.04 };
    onChange([...tiers, next]);
  };

  const updateRow = (idx: number, patch: Partial<StaffTier>) => {
    onChange(tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const removeRow = (idx: number) => {
    onChange(tiers.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {tiers.length === 0 ? (
        <div
          className="rounded-[10px] px-3 py-2.5 text-[12px]"
          style={{
            backgroundColor: 'var(--bg-surface-secondary)',
            color: 'var(--ink-secondary)',
          }}
        >
          Nessuno scaglione (busta 0 € per questa voce).
        </div>
      ) : (
        <div className="space-y-2">
          {tiers.map((tier, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[64px_1fr_1fr_34px] items-center gap-2 rounded-[10px] p-2"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              <select
                aria-label="Operatore soglia"
                value={tier.inclusive ? 'gte' : 'gt'}
                onChange={(e) => updateRow(idx, { inclusive: e.target.value === 'gte' })}
                className="apple-input rounded-[8px] px-2 py-1.5 text-[14px] font-semibold cursor-pointer"
              >
                <option value="gt">&gt;</option>
                <option value="gte">≥</option>
              </select>

              <div>
                <div className="text-[10px] mb-0.5" style={{ color: 'var(--ink-tertiary)' }}>
                  {mode === 'presale' ? 'N. preve' : 'Credito €'}
                </div>
                <NumericCellInput
                  value={tier.min}
                  integer={mode === 'presale'}
                  prefix={mode === 'table' ? '€' : undefined}
                  ariaLabel={mode === 'presale' ? 'Soglia prevendite' : 'Soglia credito tavoli'}
                  onCommit={(v) => updateRow(idx, { min: v })}
                />
              </div>

              <div>
                <div className="text-[10px] mb-0.5" style={{ color: 'var(--ink-tertiary)' }}>
                  {mode === 'presale' ? '€ / preve' : 'Percentuale %'}
                </div>
                {mode === 'presale' ? (
                  <NumericCellInput
                    value={tier.rate}
                    prefix="€"
                    ariaLabel="Euro per prevendita"
                    onCommit={(v) => updateRow(idx, { rate: v })}
                  />
                ) : (
                  <NumericCellInput
                    value={Math.round(tier.rate * 10000) / 100}
                    prefix="%"
                    ariaLabel="Percentuale busta tavoli"
                    onCommit={(v) => updateRow(idx, { rate: Math.round(v * 100) / 10000 })}
                  />
                )}
              </div>

              <button
                type="button"
                onClick={() => removeRow(idx)}
                aria-label="Rimuovi scaglione"
                className="flex h-8 w-8 items-center justify-center rounded-[8px] apple-press cursor-pointer self-end"
                style={{ color: 'var(--status-red)' }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold apple-press cursor-pointer"
        style={{
          backgroundColor: 'var(--accent-subtle)',
          color: 'var(--accent)',
        }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Aggiungi scaglione
      </button>
    </div>
  );
}

export function StaffWorkspace({
  events,
  mainSummaries,
  ownerPromoterId,
  staffData,
  venues,
  quickTablePrices,
  selectedEventId,
  onSelectEvent,
  canUndo,
  canRedo,
  lastUndoLabel,
  lastRedoLabel,
  onUndo,
  onRedo,
  onOpenNewEvent,
  onSyncPresalesToMain,
}: {
  events: FullEvent[];
  mainSummaries: Map<string, EventSummary>;
  ownerPromoterId: 'lollo' | 'ciccio';
  staffData: ReturnType<typeof useStaffData>;
  venues: Venue[];
  quickTablePrices: number[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  lastUndoLabel: string | null;
  lastRedoLabel: string | null;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onOpenNewEvent: () => void;
  onSyncPresalesToMain: (
    eventId: string,
    quantity: number,
    revenue: number,
    oneToOne: number
  ) => Promise<void>;
}) {
  const [section, setSection] = useState<WorkspaceSection>('events');
  const [search, setSearch] = useState('');
  const [listFilter, setListFilter] = useState<EventListFilter>('ALL');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Ledger state
  const [ledgerMode, setLedgerMode] = useState<LedgerMode>('by_pr');
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('OPEN');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [expandedPrKeys, setExpandedPrKeys] = useState<Record<string, boolean>>({});

  // Team & Plans state
  const [groupNameDraft, setGroupNameDraft] = useState(staffData.group.name);
  useEffect(() => {
    setGroupNameDraft(staffData.group.name);
  }, [staffData.group.name]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState<'ALL' | 'ACTIVE' | 'CUSTOM'>('ACTIVE');

  // Plan editor modal state
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [planIsDefault, setPlanIsDefault] = useState(false);
  const [planPresaleTiers, setPlanPresaleTiers] = useState<StaffTier[]>(DEFAULT_PRESALE_TIERS);
  const [planTableTiers, setPlanTableTiers] = useState<StaffTier[]>(DEFAULT_TABLE_TIERS);

  // Member editor modal state
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memFullName, setMemFullName] = useState('');
  const [memNickname, setMemNickname] = useState('');
  const [memAliases, setMemAliases] = useState('');
  const [memPlanId, setMemPlanId] = useState<string>('');
  const [memIsSelf, setMemIsSelf] = useState(false);
  const [memIsActive, setMemIsActive] = useState(true);
  const [memUseCustomTiers, setMemUseCustomTiers] = useState(false);
  const [memCustomPresaleTiers, setMemCustomPresaleTiers] =
    useState<StaffTier[]>(DEFAULT_PRESALE_TIERS);
  const [memCustomTableTiers, setMemCustomTableTiers] =
    useState<StaffTier[]>(DEFAULT_TABLE_TIERS);
  const [memNotes, setMemNotes] = useState('');

  const venueColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of venues) m.set(v.name, v.color);
    return m;
  }, [venues]);

  const plansById = useMemo(() => {
    const m = new Map<string, StaffCommissionPlan>();
    for (const p of staffData.plans) m.set(p.id, p);
    return m;
  }, [staffData.plans]);

  // Filtered events list for Master pane
  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      const ss = staffData.summariesByEvent.get(ev.id);
      const hasData = Boolean(ss && (ss.presales.length > 0 || ss.tables.length > 0));
      if (listFilter === 'WITH_DATA' && !hasData) return false;
      if (listFilter === 'OPEN_MANCANTI' && (ss?.totalMancanti ?? 0) <= 0.01) return false;
      if (listFilter === 'UNPAID_BUSTA' && (ss?.totalBustaUnpaid ?? 0) <= 0.01) return false;

      if (q) {
        const hitEvent =
          ev.title.toLowerCase().includes(q) || ev.venue_name.toLowerCase().includes(q);
        const hitStaff = Boolean(
          ss &&
            (ss.membersRollup.some(
              (r) =>
                r.displayName.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)
            ) ||
              ss.tables.some((t) => t.row.table_name.toLowerCase().includes(q)))
        );
        if (!hitEvent && !hitStaff) return false;
      }
      return true;
    });
  }, [events, staffData.summariesByEvent, search, listFilter]);

  const groupedByMonth = useMemo(() => {
    const groups: { monthLabel: string; items: FullEvent[] }[] = [];
    let currentLabel = '';
    for (const ev of filteredEvents) {
      const lbl = formatMonthYear(ev.event_date);
      if (lbl !== currentLabel) {
        currentLabel = lbl;
        groups.push({ monthLabel: lbl, items: [ev] });
      } else {
        groups[groups.length - 1].items.push(ev);
      }
    }
    return groups;
  }, [filteredEvents]);

  // Default to selectedEventId or first event that has staff data or first event overall
  const activeEvent = useMemo(() => {
    if (selectedEventId) {
      const found = events.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    const firstWithStaff = events.find((e) => {
      const ss = staffData.summariesByEvent.get(e.id);
      return ss && (ss.presales.length > 0 || ss.tables.length > 0);
    });
    return firstWithStaff || filteredEvents[0] || events[0] || null;
  }, [selectedEventId, events, filteredEvents, staffData.summariesByEvent]);

  const activeStaffSummary = activeEvent ? staffData.getEventSummary(activeEvent.id) : null;
  const activeMainSummary = activeEvent ? mainSummaries.get(activeEvent.id) : undefined;

  // Cross-event Ledger & All-Time Sub-PR Stats
  const crossEventAnalytics = useMemo(() => {
    let totalMancanti = 0;
    let totalBustaUnpaid = 0;
    let totalBustaPaid = 0;
    let totalPx = 0;
    let totalFatturato = 0;
    let openMancantiEventsCount = 0;
    let openBusteEventsCount = 0;

    interface PrAggregate {
      key: string;
      member: StaffMember | null;
      displayName: string;
      fullName: string;
      planName: string;
      isSelf: boolean;
      eventsCount: number;
      pxPresales: number;
      pxTables: number;
      pxTotal: number;
      tablesCount: number;
      fatturato: number;
      mancantiTotal: number;
      bustaTotal: number;
      bustaUnpaid: number;
      bustaPaid: number;
      eventEntries: { event: FullEvent; rollup: StaffMemberEventRollup }[];
    }

    const byPr = new Map<string, PrAggregate>();
    const eventLedgerRows: {
      event: FullEvent;
      summary: NonNullable<ReturnType<typeof staffData.summariesByEvent.get>>;
    }[] = [];

    for (const ev of events) {
      const ss = staffData.summariesByEvent.get(ev.id);
      if (!ss || (ss.presales.length === 0 && ss.tables.length === 0)) continue;

      eventLedgerRows.push({ event: ev, summary: ss });
      totalMancanti += ss.totalMancanti;
      totalBustaUnpaid += ss.totalBustaUnpaid;
      totalBustaPaid += ss.totalBustaPaid;
      totalPx += ss.pxTotal;
      totalFatturato += ss.presalesRevenue + ss.tablesCredito;
      if (ss.totalMancanti > 0.01) openMancantiEventsCount += 1;
      if (ss.totalBustaUnpaid > 0.01) openBusteEventsCount += 1;

      for (const r of ss.membersRollup) {
        let agg = byPr.get(r.memberKey);
        if (!agg) {
          agg = {
            key: r.memberKey,
            member: r.member,
            displayName: r.displayName,
            fullName: r.fullName,
            planName: r.planName,
            isSelf: r.isSelf,
            eventsCount: 0,
            pxPresales: 0,
            pxTables: 0,
            pxTotal: 0,
            tablesCount: 0,
            fatturato: 0,
            mancantiTotal: 0,
            bustaTotal: 0,
            bustaUnpaid: 0,
            bustaPaid: 0,
            eventEntries: [],
          };
          byPr.set(r.memberKey, agg);
        }
        agg.eventsCount += 1;
        agg.pxPresales += r.pxPresales;
        agg.pxTables += r.pxTables;
        agg.pxTotal += r.pxTotal;
        agg.tablesCount += r.tablesCount;
        agg.fatturato += r.presalesRevenue + r.tablesCredito;
        agg.mancantiTotal = Math.round((agg.mancantiTotal + r.mancantiTotal) * 100) / 100;
        agg.bustaTotal = Math.round((agg.bustaTotal + r.bustaTotal) * 100) / 100;
        agg.bustaUnpaid = Math.round((agg.bustaUnpaid + r.bustaUnpaidAmount) * 100) / 100;
        agg.bustaPaid = Math.round((agg.bustaPaid + r.bustaPaidAmount) * 100) / 100;
        agg.eventEntries.push({ event: ev, rollup: r });
      }
    }

    const prList = Array.from(byPr.values()).sort(
      (a, b) =>
        b.mancantiTotal - a.mancantiTotal ||
        b.bustaUnpaid - a.bustaUnpaid ||
        b.pxTotal - a.pxTotal
    );

    const statsByMemberId = new Map<string, PrAggregate>();
    for (const item of prList) {
      if (item.member) statsByMemberId.set(item.member.id, item);
    }

    return {
      totalMancanti: Math.round(totalMancanti * 100) / 100,
      totalBustaUnpaid: Math.round(totalBustaUnpaid * 100) / 100,
      totalBustaPaid: Math.round(totalBustaPaid * 100) / 100,
      totalPx,
      totalFatturato: Math.round(totalFatturato * 100) / 100,
      openMancantiEventsCount,
      openBusteEventsCount,
      prList,
      eventLedgerRows,
      statsByMemberId,
    };
  }, [events, staffData.summariesByEvent]);

  const filteredLedgerPrs = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return crossEventAnalytics.prList.filter((pr) => {
      if (ledgerFilter === 'OPEN' && pr.mancantiTotal <= 0.01 && pr.bustaUnpaid <= 0.01) {
        return false;
      }
      if (ledgerFilter === 'MANCANTI' && pr.mancantiTotal <= 0.01) return false;
      if (ledgerFilter === 'BUSTE' && pr.bustaUnpaid <= 0.01) return false;
      if (q) {
        const hit =
          pr.displayName.toLowerCase().includes(q) || pr.fullName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [crossEventAnalytics.prList, ledgerFilter, ledgerSearch]);

  const filteredLedgerEvents = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return crossEventAnalytics.eventLedgerRows.filter(({ event, summary }) => {
      if (
        ledgerFilter === 'OPEN' &&
        summary.totalMancanti <= 0.01 &&
        summary.totalBustaUnpaid <= 0.01
      ) {
        return false;
      }
      if (ledgerFilter === 'MANCANTI' && summary.totalMancanti <= 0.01) return false;
      if (ledgerFilter === 'BUSTE' && summary.totalBustaUnpaid <= 0.01) return false;
      if (q) {
        const hit =
          event.title.toLowerCase().includes(q) || event.venue_name.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [crossEventAnalytics.eventLedgerRows, ledgerFilter, ledgerSearch]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return staffData.members
      .filter((m) => {
        if (memberFilter === 'ACTIVE' && !m.is_active) return false;
        if (
          memberFilter === 'CUSTOM' &&
          !Array.isArray(m.custom_presale_tiers) &&
          !Array.isArray(m.custom_table_tiers)
        ) {
          return false;
        }
        if (q) {
          const hit =
            m.full_name.toLowerCase().includes(q) ||
            m.nickname.toLowerCase().includes(q) ||
            m.aliases.some((a) => a.toLowerCase().includes(q));
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const sa = crossEventAnalytics.statsByMemberId.get(a.id);
        const sb = crossEventAnalytics.statsByMemberId.get(b.id);
        return (sb?.pxTotal ?? 0) - (sa?.pxTotal ?? 0) || a.full_name.localeCompare(b.full_name);
      });
  }, [staffData.members, memberSearch, memberFilter, crossEventAnalytics.statsByMemberId]);

  const handleOpenPlanModal = (plan?: StaffCommissionPlan) => {
    if (plan) {
      setEditingPlanId(plan.id);
      setPlanName(plan.name);
      setPlanDesc(plan.description);
      setPlanIsDefault(plan.is_default);
      setPlanPresaleTiers(plan.presale_tiers.map((t) => ({ ...t })));
      setPlanTableTiers(plan.table_tiers.map((t) => ({ ...t })));
    } else {
      setEditingPlanId(null);
      setPlanName('');
      setPlanDesc('');
      setPlanIsDefault(false);
      setPlanPresaleTiers(DEFAULT_PRESALE_TIERS.map((t) => ({ ...t })));
      setPlanTableTiers(DEFAULT_TABLE_TIERS.map((t) => ({ ...t })));
    }
    setPlanModalOpen(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planName.trim()) return;
    await staffData.upsertPlan({
      id: editingPlanId || undefined,
      name: planName.trim(),
      description: planDesc.trim(),
      is_default: planIsDefault,
      presale_tiers: planPresaleTiers,
      table_tiers: planTableTiers,
    });
    setPlanModalOpen(false);
  };

  const handleOpenMemberModal = (member?: StaffMember) => {
    const defaultPlan = staffData.plans.find((p) => p.is_default) || staffData.plans[0];
    if (member) {
      setEditingMemberId(member.id);
      setMemFullName(member.full_name);
      setMemNickname(member.nickname);
      setMemAliases(member.aliases.join(', '));
      setMemPlanId(member.plan_id || '');
      setMemIsSelf(member.is_self);
      setMemIsActive(member.is_active);
      const hasCustom =
        Array.isArray(member.custom_presale_tiers) || Array.isArray(member.custom_table_tiers);
      setMemUseCustomTiers(hasCustom);
      const rules = resolveMemberRules(member, plansById, staffData.group);
      setMemCustomPresaleTiers(rules.presaleTiers.map((t) => ({ ...t })));
      setMemCustomTableTiers(rules.tableTiers.map((t) => ({ ...t })));
      setMemNotes(member.notes);
    } else {
      setEditingMemberId(null);
      setMemFullName('');
      setMemNickname('');
      setMemAliases('');
      setMemPlanId(defaultPlan?.id || '');
      setMemIsSelf(false);
      setMemIsActive(true);
      setMemUseCustomTiers(false);
      setMemCustomPresaleTiers(DEFAULT_PRESALE_TIERS.map((t) => ({ ...t })));
      setMemCustomTableTiers(DEFAULT_TABLE_TIERS.map((t) => ({ ...t })));
      setMemNotes('');
    }
    setMemberModalOpen(true);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memFullName.trim()) return;
    const aliases = memAliases
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const nickLower = memNickname.trim().toLowerCase();
    if (nickLower && !aliases.includes(nickLower)) aliases.push(nickLower);
    const fullLower = memFullName.trim().toLowerCase();
    if (!aliases.includes(fullLower)) aliases.push(fullLower);

    await staffData.upsertMember({
      id: editingMemberId || undefined,
      full_name: memFullName.trim(),
      nickname: memNickname.trim() || memFullName.trim().split(' ')[0],
      aliases,
      plan_id: memPlanId || null,
      is_self: memIsSelf,
      is_active: memIsActive,
      custom_presale_tiers: memUseCustomTiers ? memCustomPresaleTiers : null,
      custom_table_tiers: memUseCustomTiers ? memCustomTableTiers : null,
      notes: memNotes.trim(),
    });
    setMemberModalOpen(false);
  };

  const jumpToEvent = (eventId: string) => {
    onSelectEvent(eventId);
    setSection('events');
    setMobileDetailOpen(true);
  };

  const handleSelectEvent = (id: string) => {
    onSelectEvent(id);
    setMobileDetailOpen(true);
  };

  const openPendingCount =
    crossEventAnalytics.openMancantiEventsCount + crossEventAnalytics.openBusteEventsCount;

  return (
    <div className="min-h-[calc(100dvh-56px)] lg:min-h-dvh flex flex-col">
      {/* Top Personal Staff Sub-Navigation Bar */}
      <div
        className="sticky top-[52px] lg:top-0 z-20 apple-chrome px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
        style={{ borderBottom: '0.5px solid var(--separator)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-white"
            style={{
              background:
                ownerPromoterId === 'ciccio'
                  ? 'linear-gradient(135deg, #32ADE6 0%, #0071E3 100%)'
                  : 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)',
            }}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-bold tracking-tight truncate">
                Staff {staffData.group.name}
              </h1>
              <span
                className="hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface-secondary)',
                  color: 'var(--ink-secondary)',
                }}
              >
                <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                Privato
              </span>
            </div>
            <p className="text-[11px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {staffData.members.filter((m) => m.is_active && !m.is_self).length} sotto-PR ·{' '}
              {staffData.group.sum_tables_per_pr
                ? 'Somma tavoli per PR attiva'
                : 'Scaglioni per singolo tavolo'}
            </p>
          </div>
        </div>

        <SegmentedControl
          ariaLabel="Sezioni staff"
          size="sm"
          value={section}
          onChange={(v) => {
            setSection(v);
            if (v !== 'events') setMobileDetailOpen(false);
          }}
          options={[
            { value: 'events', label: 'Serate' },
            {
              value: 'ledger',
              label: openPendingCount > 0 ? `Saldi & Buste (${openPendingCount})` : 'Saldi & Buste',
            },
            { value: 'team', label: 'Staff & Piani' },
          ]}
        />
      </div>

      {/* SECTION 1: SERATE (Shared Events Master-Detail + Staff Event Detail) */}
      {section === 'events' && (
        <div className="flex flex-1 min-h-0">
          {/* Master Event List */}
          <aside
            className={`${
              mobileDetailOpen ? 'hidden lg:flex' : 'flex'
            } w-full lg:w-[328px] xl:w-[350px] shrink-0 flex-col lg:h-[calc(100dvh-57px)] lg:sticky lg:top-[57px]`}
            style={{
              borderRight: '0.5px solid var(--separator)',
              backgroundColor: 'var(--bg-canvas)',
            }}
          >
            <div className="px-4 pt-3.5 pb-3 space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                  Stesse serate del team · {filteredEvents.length} visibili
                </p>
                <button
                  type="button"
                  onClick={onOpenNewEvent}
                  className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold apple-press cursor-pointer"
                  style={{
                    backgroundColor: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                  }}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Nuova serata
                </button>
              </div>

              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: 'var(--ink-tertiary)' }}
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca serata, locale o sotto-PR…"
                  aria-label="Filtra serate staff"
                  className="apple-input w-full rounded-[10px] pl-9 pr-8 py-2 text-[16px] md:text-[14px]"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Svuota ricerca"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 cursor-pointer"
                    style={{ color: 'var(--ink-tertiary)' }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'ALL', label: 'Tutte' },
                    { id: 'WITH_DATA', label: 'Con dati' },
                    { id: 'OPEN_MANCANTI', label: 'Mancanti' },
                    { id: 'UNPAID_BUSTA', label: 'Buste' },
                  ] as const
                ).map((f) => {
                  const active = listFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setListFilter(f.id)}
                      className="rounded-[8px] px-2.5 py-1 text-[12px] font-medium shrink-0 apple-press cursor-pointer transition-colors"
                      style={{
                        backgroundColor: active
                          ? f.id === 'OPEN_MANCANTI'
                            ? 'var(--status-red-bg)'
                            : 'var(--accent-subtle)'
                          : 'var(--bg-surface-secondary)',
                        color: active
                          ? f.id === 'OPEN_MANCANTI'
                            ? 'var(--status-red)'
                            : 'var(--accent)'
                          : 'var(--ink-secondary)',
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Event List */}
            <div className="flex-1 overflow-y-auto px-3 pb-24 lg:pb-6 space-y-4">
              {groupedByMonth.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <CalendarDays
                    className="h-8 w-8 mx-auto mb-2"
                    style={{ color: 'var(--ink-tertiary)' }}
                    aria-hidden="true"
                  />
                  <p className="text-[14px] font-medium">Nessuna serata trovata</p>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                    Cambia filtro o seleziona “Tutte” per iniziare una serata staff.
                  </p>
                </div>
              ) : (
                groupedByMonth.map((grp) => (
                  <div key={grp.monthLabel}>
                    <div
                      className="px-2 pb-1.5 text-[12px] font-semibold sticky top-0 z-10 backdrop-blur-md"
                      style={{
                        color: 'var(--ink-secondary)',
                        backgroundColor: 'color-mix(in srgb, var(--bg-canvas) 86%, transparent)',
                      }}
                    >
                      {grp.monthLabel}
                    </div>
                    <div className="space-y-1">
                      {grp.items.map((ev) => {
                        const ss = staffData.summariesByEvent.get(ev.id);
                        const hasData = Boolean(
                          ss && (ss.presales.length > 0 || ss.tables.length > 0)
                        );
                        const isSelected = activeEvent?.id === ev.id;
                        const venueColor = venueColorMap.get(ev.venue_name) || '#0071E3';
                        const hasMancanti = (ss?.totalMancanti ?? 0) > 0.01;
                        const hasUnpaidBusta = (ss?.totalBustaUnpaid ?? 0) > 0.01;

                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => handleSelectEvent(ev.id)}
                            className="w-full rounded-[12px] px-3 py-2.5 text-left transition-colors apple-press cursor-pointer"
                            style={{
                              backgroundColor: isSelected ? 'var(--bg-surface)' : 'transparent',
                              boxShadow: isSelected ? 'var(--shadow-card)' : 'none',
                              opacity: hasData || isSelected ? 1 : 0.72,
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: venueColor }}
                                  />
                                  <span className="text-[14px] font-semibold truncate">
                                    {ev.title}
                                  </span>
                                </div>
                                <div
                                  className="mt-0.5 flex items-center gap-1.5 text-[12px] truncate"
                                  style={{ color: 'var(--ink-secondary)' }}
                                >
                                  <span className="tabular-nums">
                                    {formatDateDayMonth(ev.event_date)}
                                  </span>
                                  <span>·</span>
                                  <span className="truncate">{ev.venue_name}</span>
                                </div>
                              </div>

                              <div className="text-right shrink-0 tabular-nums">
                                {hasData && ss ? (
                                  <>
                                    <div className="text-[13px] font-semibold">
                                      {formatInt(ss.pxTotal)} px
                                    </div>
                                    <div
                                      className="text-[11px]"
                                      style={{ color: 'var(--ink-secondary)' }}
                                    >
                                      Buste {formatEur(ss.totalBusta)}
                                    </div>
                                  </>
                                ) : (
                                  <span
                                    className="text-[11px]"
                                    style={{ color: 'var(--ink-tertiary)' }}
                                  >
                                    Vuota
                                  </span>
                                )}
                              </div>
                            </div>

                            {hasData && ss && (
                              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums">
                                <span style={{ color: 'var(--ink-tertiary)' }}>
                                  {ss.membersRollup.length} PR · {ss.tables.length} tav.
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {!hasMancanti && !hasUnpaidBusta && (
                                    <span
                                      className="inline-flex items-center gap-0.5 font-medium"
                                      style={{ color: 'var(--status-green)' }}
                                    >
                                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                      Chiusa
                                    </span>
                                  )}
                                  {hasUnpaidBusta && (
                                    <span
                                      className="rounded-full px-1.5 py-0.5 font-semibold"
                                      style={{
                                        backgroundColor: 'var(--accent-subtle)',
                                        color: 'var(--accent)',
                                      }}
                                    >
                                      Buste {formatEur(ss.totalBustaUnpaid)}
                                    </span>
                                  )}
                                  {hasMancanti && (
                                    <span
                                      className="rounded-full px-1.5 py-0.5 font-semibold"
                                      style={{
                                        backgroundColor: 'var(--status-red-bg)',
                                        color: 'var(--status-red)',
                                      }}
                                    >
                                      -{formatEur(ss.totalMancanti)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Right Staff Event Detail Pane */}
          <div
            className={`${
              mobileDetailOpen ? 'block' : 'hidden lg:block'
            } flex-1 min-w-0 overflow-y-auto`}
          >
            {activeEvent && activeStaffSummary ? (
              <StaffEventDetail
                key={activeEvent.id}
                event={activeEvent}
                mainSummary={activeMainSummary}
                ownerPromoterId={ownerPromoterId}
                staffGroup={staffData.group}
                staffSummary={activeStaffSummary}
                members={staffData.members}
                plans={staffData.plans}
                quickTablePrices={quickTablePrices}
                canUndo={canUndo}
                canRedo={canRedo}
                lastUndoLabel={lastUndoLabel}
                lastRedoLabel={lastRedoLabel}
                onUndo={onUndo}
                onRedo={onRedo}
                onBackMobile={() => setMobileDetailOpen(false)}
                onSyncPresalesToMain={(qty, rev, oto) =>
                  onSyncPresalesToMain(activeEvent.id, qty, rev, oto)
                }
                onAddPresale={staffData.addStaffPresale}
                onUpdatePresale={staffData.updateStaffPresale}
                onDeletePresale={staffData.deleteStaffPresale}
                onAddTable={staffData.addStaffTable}
                onUpdateTable={staffData.updateStaffTable}
                onDeleteTable={staffData.deleteStaffTable}
                onSettleMemberCash={staffData.settleMemberCash}
                onToggleMemberBustaPaid={staffData.toggleMemberBustaPaid}
                onImportTicketSms={staffData.importTicketSmsPresales}
                onAssignMemberPlan={async (member, planId) => {
                  await staffData.upsertMember({
                    ...member,
                    plan_id: planId,
                    custom_presale_tiers: null,
                    custom_table_tiers: null,
                  });
                }}
                onQuickCreateMember={(fullName) => staffData.upsertMember({ full_name: fullName })}
              />
            ) : (
              <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
                <Users
                  className="h-10 w-10 mb-3"
                  style={{ color: 'var(--ink-tertiary)' }}
                  aria-hidden="true"
                />
                <h2 className="text-[20px] font-semibold">Nessuna serata disponibile</h2>
                <p
                  className="mt-1 text-[14px] max-w-sm"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  Crea prima una serata nel calendario condiviso per iniziare a gestire il tuo
                  staff {staffData.group.name}.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 2: SALDI & BUSTE STAFF (Cross-Event Ledger) */}
      {section === 'ledger' && (
        <div className="max-w-[1060px] w-full mx-auto px-4 sm:px-6 pt-5 pb-28 lg:pb-12 space-y-5">
          {/* Hero KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="apple-card p-4">
              <div className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Mancanti Staff
              </div>
              <div
                className="mt-1 text-[24px] sm:text-[26px] font-bold tracking-tight tabular-nums"
                style={{
                  color:
                    crossEventAnalytics.totalMancanti > 0.01
                      ? 'var(--status-red)'
                      : 'var(--status-green)',
                }}
              >
                {formatEur(crossEventAnalytics.totalMancanti)}
              </div>
              <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                {crossEventAnalytics.openMancantiEventsCount === 0
                  ? 'Tutti i contanti consegnati'
                  : `${crossEventAnalytics.openMancantiEventsCount} serate aperte`}
              </div>
            </div>

            <div className="apple-card p-4">
              <div className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Buste da pagare
              </div>
              <div
                className="mt-1 text-[24px] sm:text-[26px] font-bold tracking-tight tabular-nums"
                style={{
                  color:
                    crossEventAnalytics.totalBustaUnpaid > 0.01
                      ? 'var(--accent)'
                      : 'var(--status-green)',
                }}
              >
                {formatEur(crossEventAnalytics.totalBustaUnpaid, true)}
              </div>
              <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                {crossEventAnalytics.openBusteEventsCount === 0
                  ? 'Tutte le buste saldate'
                  : `${crossEventAnalytics.openBusteEventsCount} serate da pagare`}
              </div>
            </div>

            <div className="apple-card p-4">
              <div className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Buste già pagate
              </div>
              <div
                className="mt-1 text-[24px] sm:text-[26px] font-bold tracking-tight tabular-nums"
                style={{ color: 'var(--status-green)' }}
              >
                {formatEur(crossEventAnalytics.totalBustaPaid, true)}
              </div>
              <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                Storico {staffData.group.name}
              </div>
            </div>

            <div className="apple-card p-4">
              <div className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Volume Staff totale
              </div>
              <div className="mt-1 text-[24px] sm:text-[26px] font-bold tracking-tight tabular-nums">
                {formatInt(crossEventAnalytics.totalPx)}{' '}
                <span className="text-[14px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  px
                </span>
              </div>
              <div
                className="mt-1 text-[12px] tabular-nums"
                style={{ color: 'var(--ink-tertiary)' }}
              >
                Fatt. {formatEur(crossEventAnalytics.totalFatturato)}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                ariaLabel="Raggruppamento saldi"
                size="sm"
                value={ledgerMode}
                onChange={setLedgerMode}
                options={[
                  { value: 'by_pr', label: 'Per Sotto-PR' },
                  { value: 'by_event', label: 'Per Serata' },
                ]}
              />

              <div className="flex items-center gap-1.5 overflow-x-auto">
                {(
                  [
                    { id: 'OPEN', label: 'Con pendenze' },
                    { id: 'MANCANTI', label: 'Solo Mancanti' },
                    { id: 'BUSTE', label: 'Solo Buste' },
                    { id: 'ALL', label: 'Tutti' },
                  ] as const
                ).map((f) => {
                  const active = ledgerFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setLedgerFilter(f.id)}
                      className="rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium shrink-0 apple-press cursor-pointer transition-colors"
                      style={{
                        backgroundColor: active
                          ? 'var(--accent-subtle)'
                          : 'var(--bg-surface-secondary)',
                        color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="relative w-full sm:w-[240px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: 'var(--ink-tertiary)' }}
                aria-hidden="true"
              />
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder={ledgerMode === 'by_pr' ? 'Cerca sotto-PR…' : 'Cerca serata…'}
                className="apple-input w-full rounded-[10px] pl-9 pr-3 py-1.5 text-[16px] md:text-[13px]"
              />
            </div>
          </div>

          {/* LEDGER VIEW A: BY SUB-PR */}
          {ledgerMode === 'by_pr' && (
            <div className="space-y-3">
              {filteredLedgerPrs.length === 0 ? (
                <div className="apple-card p-10 text-center">
                  <Wallet
                    className="h-9 w-9 mx-auto mb-2.5"
                    style={{ color: 'var(--status-green)' }}
                    aria-hidden="true"
                  />
                  <h3 className="text-[16px] font-semibold">Nessuna pendenza aperta</h3>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    Tutti i sotto-PR sono in pari secondo il filtro selezionato.
                  </p>
                </div>
              ) : (
                filteredLedgerPrs.map((pr) => {
                  const isExpanded = Boolean(expandedPrKeys[pr.key]);
                  const openEntries = pr.eventEntries.filter(
                    (e) =>
                      e.rollup.mancantiTotal > 0.01 ||
                      e.rollup.bustaUnpaidAmount > 0.01 ||
                      ledgerFilter === 'ALL'
                  );

                  return (
                    <div key={pr.key} className="apple-card overflow-hidden">
                      <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
                            style={{
                              backgroundColor: pr.isSelf
                                ? 'var(--accent-subtle)'
                                : 'var(--bg-surface-secondary)',
                              color: pr.isSelf ? 'var(--accent)' : 'var(--ink-primary)',
                            }}
                          >
                            {pr.displayName.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[15px] font-semibold truncate">
                                {pr.displayName}
                              </span>
                              {pr.fullName !== pr.displayName && (
                                <span
                                  className="text-[12px] truncate"
                                  style={{ color: 'var(--ink-tertiary)' }}
                                >
                                  {pr.fullName}
                                </span>
                              )}
                              <span
                                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                                style={{
                                  backgroundColor: 'var(--bg-surface-secondary)',
                                  color: 'var(--ink-secondary)',
                                }}
                              >
                                {pr.planName}
                              </span>
                            </div>
                            <div
                              className="mt-0.5 text-[12px] tabular-nums"
                              style={{ color: 'var(--ink-secondary)' }}
                            >
                              {pr.eventsCount} serate · {formatInt(pr.pxTotal)} px (
                              {formatInt(pr.pxPresales)} preve + {formatInt(pr.pxTables)} tav.)
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <div className="flex items-center gap-2 tabular-nums">
                            <div className="text-right">
                              <div
                                className="text-[10px] font-medium"
                                style={{ color: 'var(--ink-tertiary)' }}
                              >
                                Mancanti
                              </div>
                              <MancantiBadge value={pr.mancantiTotal} compact />
                            </div>
                            <div className="text-right min-w-[74px]">
                              <div
                                className="text-[10px] font-medium"
                                style={{ color: 'var(--ink-tertiary)' }}
                              >
                                Buste dovute
                              </div>
                              <div
                                className="text-[14px] font-bold"
                                style={{
                                  color:
                                    pr.bustaUnpaid > 0.01
                                      ? 'var(--accent)'
                                      : 'var(--ink-secondary)',
                                }}
                              >
                                {formatEur(pr.bustaUnpaid, true)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {pr.mancantiTotal > 0.01 && (
                              <button
                                type="button"
                                onClick={async () => {
                                  for (const entry of pr.eventEntries) {
                                    if (entry.rollup.mancantiTotal > 0.01) {
                                      await staffData.settleMemberCash(entry.rollup);
                                    }
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-semibold apple-press cursor-pointer"
                                style={{
                                  backgroundColor: 'var(--status-green-bg)',
                                  color: 'var(--status-green)',
                                }}
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                Salda cassa
                              </button>
                            )}
                            {pr.bustaUnpaid > 0.01 && (
                              <button
                                type="button"
                                onClick={async () => {
                                  for (const entry of pr.eventEntries) {
                                    if (entry.rollup.bustaUnpaidAmount > 0.01) {
                                      await staffData.toggleMemberBustaPaid(entry.rollup, true);
                                    }
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-semibold text-white apple-press cursor-pointer"
                                style={{ backgroundColor: 'var(--accent)' }}
                              >
                                Paga buste
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedPrKeys((prev) => ({
                                  ...prev,
                                  [pr.key]: !prev[pr.key],
                                }))
                              }
                              aria-label={isExpanded ? 'Comprimi dettaglio serate' : 'Espandi serate'}
                              className="flex h-8 w-8 items-center justify-center rounded-[9px] apple-press cursor-pointer"
                              style={{
                                backgroundColor: 'var(--bg-surface-secondary)',
                                color: 'var(--ink-secondary)',
                              }}
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div
                          className="px-4 py-3 space-y-2"
                          style={{
                            borderTop: '0.5px solid var(--separator)',
                            backgroundColor: 'var(--bg-surface-secondary)',
                          }}
                        >
                          {openEntries.map(({ event, rollup }) => (
                            <div
                              key={event.id}
                              className="rounded-[11px] px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              style={{ backgroundColor: 'var(--bg-surface)' }}
                            >
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => jumpToEvent(event.id)}
                                  className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline cursor-pointer text-left"
                                >
                                  <span>{event.title}</span>
                                  <ArrowRight
                                    className="h-3 w-3 shrink-0"
                                    style={{ color: 'var(--ink-tertiary)' }}
                                    aria-hidden="true"
                                  />
                                </button>
                                <div
                                  className="text-[11px] tabular-nums"
                                  style={{ color: 'var(--ink-secondary)' }}
                                >
                                  {formatDateDayMonth(event.event_date)} · {event.venue_name} ·{' '}
                                  {formatInt(rollup.pxTotal)} px
                                  {rollup.tablesCount > 1 && (
                                    <span
                                      className="ml-1.5 font-medium"
                                      style={{ color: 'var(--accent)' }}
                                    >
                                      ({rollup.tablesCount} tavoli sommati)
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 tabular-nums">
                                <MancantiBadge value={rollup.mancantiTotal} compact />
                                {rollup.mancantiTotal > 0.01 && (
                                  <button
                                    type="button"
                                    onClick={() => staffData.settleMemberCash(rollup)}
                                    className="rounded-[7px] px-2 py-1 text-[11px] font-semibold apple-press cursor-pointer"
                                    style={{
                                      backgroundColor: 'var(--status-green-bg)',
                                      color: 'var(--status-green)',
                                    }}
                                  >
                                    Salda
                                  </button>
                                )}

                                {rollup.bustaTotal > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      staffData.toggleMemberBustaPaid(
                                        rollup,
                                        !rollup.allBustaPaid
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-semibold apple-press cursor-pointer"
                                    style={{
                                      backgroundColor: rollup.allBustaPaid
                                        ? 'var(--status-green-bg)'
                                        : 'var(--accent-subtle)',
                                      color: rollup.allBustaPaid
                                        ? 'var(--status-green)'
                                        : 'var(--accent)',
                                    }}
                                  >
                                    {rollup.allBustaPaid ? 'Pagata' : 'Paga'}{' '}
                                    {formatEur(rollup.bustaTotal, true)}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* LEDGER VIEW B: BY EVENT */}
          {ledgerMode === 'by_event' && (
            <div className="space-y-2.5">
              {filteredLedgerEvents.length === 0 ? (
                <div className="apple-card p-10 text-center">
                  <CheckCircle2
                    className="h-9 w-9 mx-auto mb-2.5"
                    style={{ color: 'var(--status-green)' }}
                    aria-hidden="true"
                  />
                  <h3 className="text-[16px] font-semibold">Nessuna serata aperta</h3>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    Tutte le serate staff risultano saldate.
                  </p>
                </div>
              ) : (
                filteredLedgerEvents.map(({ event, summary }) => (
                  <div
                    key={event.id}
                    className="apple-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: venueColorMap.get(event.venue_name) || '#0071E3',
                          }}
                        />
                        <span className="text-[15px] font-semibold truncate">{event.title}</span>
                      </div>
                      <div
                        className="mt-0.5 text-[12px] tabular-nums"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        {formatDateDayMonth(event.event_date)} · {event.venue_name} ·{' '}
                        {summary.membersRollup.length} PR · {formatInt(summary.pxTotal)} px
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 tabular-nums">
                      <div className="text-right">
                        <div
                          className="text-[10px] font-medium"
                          style={{ color: 'var(--ink-tertiary)' }}
                        >
                          Mancanti Staff
                        </div>
                        <MancantiBadge value={summary.totalMancanti} compact />
                      </div>
                      <div className="text-right min-w-[78px]">
                        <div
                          className="text-[10px] font-medium"
                          style={{ color: 'var(--ink-tertiary)' }}
                        >
                          Buste da pagare
                        </div>
                        <div
                          className="text-[14px] font-bold"
                          style={{
                            color:
                              summary.totalBustaUnpaid > 0.01
                                ? 'var(--accent)'
                                : 'var(--status-green)',
                          }}
                        >
                          {summary.totalBustaUnpaid > 0.01
                            ? formatEur(summary.totalBustaUnpaid, true)
                            : 'Pagate'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => jumpToEvent(event.id)}
                        className="inline-flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer"
                        style={{
                          backgroundColor: 'var(--bg-surface-secondary)',
                          color: 'var(--ink-primary)',
                        }}
                      >
                        Apri
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: STAFF & PIANI BUSTA */}
      {section === 'team' && (
        <div className="max-w-[1060px] w-full mx-auto px-4 sm:px-6 pt-5 pb-28 lg:pb-12 space-y-6">
          {/* Card 1: Staff Group Rules */}
          <section className="apple-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <h2 className="text-[17px] font-semibold tracking-tight">
                Regole Staff {staffData.group.name}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                className="rounded-[12px] p-3.5 space-y-2"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                <label
                  htmlFor="staff-group-name"
                  className="block text-[12px] font-medium"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  Nome del tuo staff (es. Reverse, Ice)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="staff-group-name"
                    type="text"
                    value={groupNameDraft}
                    onChange={(e) => setGroupNameDraft(e.target.value)}
                    className="apple-input flex-1 rounded-[9px] px-3 py-2 text-[16px] md:text-[14px] font-medium"
                  />
                  <button
                    type="button"
                    disabled={
                      !groupNameDraft.trim() || groupNameDraft.trim() === staffData.group.name
                    }
                    onClick={() => staffData.updateGroup({ name: groupNameDraft.trim() })}
                    className="rounded-[9px] px-3.5 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer disabled:opacity-40"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    Salva
                  </button>
                </div>
              </div>

              <div
                className="rounded-[12px] p-3.5 flex items-start justify-between gap-3"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                    <Layers
                      className="h-4 w-4 shrink-0"
                      style={{ color: 'var(--accent)' }}
                      aria-hidden="true"
                    />
                    Somma più tavoli dello stesso PR
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                    Se un sotto-PR porta 2+ tavoli nella stessa serata, i crediti si sommano prima
                    di controllare gli scaglioni (es. 250 € + 480 € = 730 € → 4% su entrambi; ≥
                    1.000 € → 7% su tutti).
                  </p>
                </div>
                <AppleSwitch
                  checked={staffData.group.sum_tables_per_pr}
                  label="Somma tavoli dello stesso PR per gli scaglioni"
                  onChange={(checked) => staffData.updateGroup({ sum_tables_per_pr: checked })}
                />
              </div>
            </div>
          </section>

          {/* Card 2: Commission Plans */}
          <section className="apple-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight">Piani Busta Sotto-PR</h2>
                <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                  Crea piani diversi (es. Standard, Senior, Fisso 1 €) e assegnali ai singoli
                  sotto-PR.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleOpenPlanModal()}
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nuovo piano
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {staffData.plans.map((plan) => {
                const assignedCount = staffData.members.filter((m) => m.plan_id === plan.id).length;
                return (
                  <div
                    key={plan.id}
                    className="rounded-[14px] p-4 flex flex-col justify-between gap-3"
                    style={{
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: plan.is_default ? '1px solid var(--accent)' : '0.5px solid var(--separator)',
                    }}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[15px] font-semibold">{plan.name}</span>
                            {plan.is_default && (
                              <span
                                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                style={{
                                  backgroundColor: 'var(--accent-subtle)',
                                  color: 'var(--accent)',
                                }}
                              >
                                Predefinito
                              </span>
                            )}
                          </div>
                          {plan.description && (
                            <p
                              className="mt-0.5 text-[12px]"
                              style={{ color: 'var(--ink-secondary)' }}
                            >
                              {plan.description}
                            </p>
                          )}
                        </div>
                        <span
                          className="text-[11px] font-medium tabular-nums shrink-0"
                          style={{ color: 'var(--ink-tertiary)' }}
                        >
                          {assignedCount} PR
                        </span>
                      </div>

                      <div className="space-y-1.5 text-[12px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="font-medium min-w-[74px]"
                            style={{ color: 'var(--ink-secondary)' }}
                          >
                            Prevendite:
                          </span>
                          {plan.presale_tiers.length === 0 ? (
                            <span style={{ color: 'var(--ink-tertiary)' }}>0 €</span>
                          ) : (
                            [...plan.presale_tiers]
                              .sort((a, b) => a.min - b.min)
                              .map((t, i) => (
                                <span
                                  key={i}
                                  className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium tabular-nums"
                                  style={{ backgroundColor: 'var(--bg-surface)' }}
                                >
                                  {formatPresaleTierChip(t)}
                                </span>
                              ))
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="font-medium min-w-[74px]"
                            style={{ color: 'var(--ink-secondary)' }}
                          >
                            Tavoli:
                          </span>
                          {plan.table_tiers.length === 0 ? (
                            <span style={{ color: 'var(--ink-tertiary)' }}>0%</span>
                          ) : (
                            [...plan.table_tiers]
                              .sort((a, b) => a.min - b.min)
                              .map((t, i) => (
                                <span
                                  key={i}
                                  className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium tabular-nums"
                                  style={{ backgroundColor: 'var(--bg-surface)' }}
                                >
                                  {formatTableTierChip(t)}
                                </span>
                              ))
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="pt-2.5 flex items-center justify-end gap-2"
                      style={{ borderTop: '0.5px solid var(--separator)' }}
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenPlanModal(plan)}
                        className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-[12px] font-medium apple-press cursor-pointer"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--ink-primary)',
                        }}
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        Modifica
                      </button>
                      {!plan.is_default && (
                        <button
                          type="button"
                          onClick={() => staffData.deletePlan(plan.id)}
                          aria-label={`Elimina piano ${plan.name}`}
                          className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-[12px] font-medium apple-press cursor-pointer"
                          style={{
                            backgroundColor: 'var(--status-red-bg)',
                            color: 'var(--status-red)',
                          }}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          Elimina
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Card 3: Sub-PR Roster & Leaderboard */}
          <section className="apple-card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Award
                    className="h-4 w-4"
                    style={{ color: 'var(--accent)' }}
                    aria-hidden="true"
                  />
                  <h2 className="text-[17px] font-semibold tracking-tight">
                    Sotto-PR & Classifica ({staffData.members.length})
                  </h2>
                </div>
                <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                  Cambia il piano busta con un tap o imposta scaglioni personalizzati per singolo
                  PR.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleOpenMemberModal()}
                className="inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Nuovo sotto-PR
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'ACTIVE', label: 'Attivi' },
                    { id: 'CUSTOM', label: 'Busta personalizzata' },
                    { id: 'ALL', label: 'Tutti' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMemberFilter(f.id)}
                    className="rounded-[8px] px-2.5 py-1 text-[12px] font-medium apple-press cursor-pointer transition-colors"
                    style={{
                      backgroundColor:
                        memberFilter === f.id
                          ? 'var(--accent-subtle)'
                          : 'var(--bg-surface-secondary)',
                      color: memberFilter === f.id ? 'var(--accent)' : 'var(--ink-secondary)',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-[250px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: 'var(--ink-tertiary)' }}
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Cerca nome o soprannome…"
                  className="apple-input w-full rounded-[10px] pl-9 pr-3 py-1.5 text-[16px] md:text-[13px]"
                />
              </div>
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--separator)' }}>
              {filteredMembers.map((member, index) => {
                const stats = crossEventAnalytics.statsByMemberId.get(member.id);
                const hasCustomTiers =
                  Array.isArray(member.custom_presale_tiers) ||
                  Array.isArray(member.custom_table_tiers);
                const rules = resolveMemberRules(member, plansById, staffData.group);

                return (
                  <div
                    key={member.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-6 text-center text-[12px] font-semibold tabular-nums shrink-0"
                        style={{ color: 'var(--ink-tertiary)' }}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[14px] font-semibold truncate">
                            {member.full_name}
                          </span>
                          {member.nickname &&
                            member.nickname.toLowerCase() !== member.full_name.toLowerCase() && (
                              <span
                                className="text-[12px]"
                                style={{ color: 'var(--ink-secondary)' }}
                              >
                                ({member.nickname})
                              </span>
                            )}
                          {member.is_self && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: 'var(--accent-subtle)',
                                color: 'var(--accent)',
                              }}
                            >
                              Capo / Io
                            </span>
                          )}
                          {hasCustomTiers && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: 'var(--status-orange-bg)',
                                color: 'var(--status-orange)',
                              }}
                            >
                              Scaglioni custom
                            </span>
                          )}
                          {!member.is_active && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: 'var(--bg-surface-secondary)',
                                color: 'var(--ink-tertiary)',
                              }}
                            >
                              Archiviato
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-0.5 text-[12px] tabular-nums"
                          style={{ color: 'var(--ink-secondary)' }}
                        >
                          {stats ? (
                            <>
                              {stats.eventsCount} serate ·{' '}
                              <strong style={{ color: 'var(--ink-primary)' }}>
                                {formatInt(stats.pxTotal)} px
                              </strong>{' '}
                              ({formatInt(stats.pxPresales)} preve + {formatInt(stats.pxTables)}{' '}
                              tav.) · Buste {formatEur(stats.bustaTotal, true)}
                            </>
                          ) : (
                            <span>Nessuna serata registrata</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pl-9 sm:pl-0 shrink-0">
                      {!member.is_self && (
                        <select
                          aria-label={`Piano busta per ${member.full_name}`}
                          value={hasCustomTiers ? '__CUSTOM__' : member.plan_id || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__CUSTOM__') {
                              handleOpenMemberModal(member);
                              return;
                            }
                            staffData.upsertMember({
                              ...member,
                              plan_id: val || null,
                              custom_presale_tiers: null,
                              custom_table_tiers: null,
                            });
                          }}
                          className="apple-input rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium cursor-pointer max-w-[165px]"
                        >
                          {hasCustomTiers && <option value="__CUSTOM__">Personalizzato</option>}
                          {staffData.plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                          {!member.plan_id && !hasCustomTiers && (
                            <option value="">{rules.planName}</option>
                          )}
                        </select>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenMemberModal(member)}
                        aria-label={`Modifica ${member.full_name}`}
                        className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium apple-press cursor-pointer"
                        style={{
                          backgroundColor: 'var(--bg-surface-secondary)',
                          color: 'var(--ink-primary)',
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Modifica
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* MODAL: CREATE / EDIT COMMISSION PLAN */}
      <AppleModal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        title={editingPlanId ? 'Modifica piano busta' : 'Nuovo piano busta'}
        subtitle="Definisci scaglioni di compenso per prevendite e tavoli."
        maxWidth="max-w-[540px]"
      >
        <form onSubmit={handleSavePlan} className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Nome piano
              </label>
              <input
                type="text"
                required
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="Es. Senior / Top PR"
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Descrizione (opzionale)
              </label>
              <input
                type="text"
                value={planDesc}
                onChange={(e) => setPlanDesc(e.target.value)}
                placeholder="Es. 1 €/preve da 10 in su + 5%/8% tavoli"
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-[13px] font-medium">Piano predefinito</div>
                <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                  Assegnato automaticamente ai nuovi sotto-PR importati.
                </div>
              </div>
              <AppleSwitch
                checked={planIsDefault}
                onChange={setPlanIsDefault}
                label="Imposta come piano predefinito"
              />
            </div>
          </div>

          <div
            className="pt-3 space-y-2"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <div className="text-[13px] font-semibold">Scaglioni Prevendite (€ per prevendita)</div>
            <TierListEditor
              mode="presale"
              tiers={planPresaleTiers}
              onChange={setPlanPresaleTiers}
            />
          </div>

          <div
            className="pt-3 space-y-2"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <div className="text-[13px] font-semibold">Scaglioni Tavoli (% sul credito)</div>
            <TierListEditor
              mode="table"
              tiers={planTableTiers}
              onChange={setPlanTableTiers}
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPlanModalOpen(false)}
              className="rounded-[10px] px-4 py-2 text-[13px] font-semibold apple-press cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-primary)',
              }}
            >
              Annulla
            </button>
            <button
              type="submit"
              className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Salva piano
            </button>
          </div>
        </form>
      </AppleModal>

      {/* MODAL: CREATE / EDIT SUB-PR MEMBER */}
      <AppleModal
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
        title={editingMemberId ? 'Modifica sotto-PR' : 'Nuovo sotto-PR'}
        subtitle="Configura nome, soprannome, alias per TicketSMS e busta personale."
        maxWidth="max-w-[540px]"
      >
        <form onSubmit={handleSaveMember} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Nome completo (come su TicketSMS)
              </label>
              <input
                type="text"
                required
                value={memFullName}
                onChange={(e) => setMemFullName(e.target.value)}
                placeholder="Es. Mattia Fucito"
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Soprannome rapido (es. Fuci)
              </label>
              <input
                type="text"
                value={memNickname}
                onChange={(e) => setMemNickname(e.target.value)}
                placeholder="Es. Fuci"
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
              Alias separati da virgola (per collegare automaticamente tavoli e TicketSMS)
            </label>
            <input
              type="text"
              value={memAliases}
              onChange={(e) => setMemAliases(e.target.value)}
              placeholder="Es. fuci, mattia fucito, fucito"
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
            />
          </div>

          <div
            className="pt-3 space-y-3"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium">Capo / Io (nessuna busta sub-PR)</div>
                <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                  Attiva solo per le tue vendite dirette (“Io”).
                </div>
              </div>
              <AppleSwitch checked={memIsSelf} onChange={setMemIsSelf} label="Capo / Io" />
            </div>

            {!memIsSelf && (
              <>
                <div>
                  <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Piano busta assegnato
                  </label>
                  <select
                    value={memPlanId}
                    onChange={(e) => setMemPlanId(e.target.value)}
                    disabled={memUseCustomTiers}
                    className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px] cursor-pointer disabled:opacity-50"
                  >
                    {staffData.plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium">
                      Scaglioni personalizzati solo per questo PR
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                      Sovrascrive il piano con tariffe su misura per {memNickname || 'questo PR'}.
                    </div>
                  </div>
                  <AppleSwitch
                    checked={memUseCustomTiers}
                    onChange={setMemUseCustomTiers}
                    label="Usa scaglioni personalizzati"
                  />
                </div>

                {memUseCustomTiers && (
                  <div
                    className="rounded-[12px] p-3.5 space-y-3"
                    style={{
                      backgroundColor: 'var(--bg-canvas)',
                      border: '0.5px solid var(--separator)',
                    }}
                  >
                    <div className="space-y-1.5">
                      <div className="text-[12px] font-semibold">Prevendite (€ / preve)</div>
                      <TierListEditor
                        mode="presale"
                        tiers={memCustomPresaleTiers}
                        onChange={setMemCustomPresaleTiers}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[12px] font-semibold">Tavoli (% credito)</div>
                      <TierListEditor
                        mode="table"
                        tiers={memCustomTableTiers}
                        onChange={setMemCustomTableTiers}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium">Sotto-PR attivo</div>
                <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                  I PR archiviati restano nello storico ma non compaiono nei selettori rapidi.
                </div>
              </div>
              <AppleSwitch checked={memIsActive} onChange={setMemIsActive} label="Attivo" />
            </div>

            <div>
              <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Note (opzionale)
              </label>
              <input
                type="text"
                value={memNotes}
                onChange={(e) => setMemNotes(e.target.value)}
                placeholder="Es. Accordo speciale tavoli privè"
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMemberModalOpen(false)}
              className="rounded-[10px] px-4 py-2 text-[13px] font-semibold apple-press cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-primary)',
              }}
            >
              Annulla
            </button>
            <button
              type="submit"
              className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Salva sotto-PR
            </button>
          </div>
        </form>
      </AppleModal>
    </div>
  );
}
