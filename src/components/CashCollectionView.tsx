import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  Landmark,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppleModal, MancantiBadge, SegmentedControl } from './ui/AppleControls';
import { StaffMemberPicker } from './ui/StaffMemberPicker';
import { round2 } from '../lib/calculations';
import { formatDateDayMonth, formatDateShort, formatEur, formatInt } from '../lib/format';
import type { useStaffData } from '../hooks/useStaffData';
import type { FullEvent, Venue } from '../types';
import type {
  StaffCashPaymentMethod,
  StaffCashTransaction,
  StaffMember,
  StaffMemberEventRollup,
} from '../types/staff';

type CashTab = 'collect' | 'history';
type PrListFilter = 'OWING' | 'SETTLED' | 'ALL';
type HistoryScope = 'EVENT' | 'ALL';

const QUICK_ADD_AMOUNTS = [10, 20, 50, 100, 200];

const METHOD_META: Record<
  StaffCashPaymentMethod,
  { label: string; icon: typeof Banknote }
> = {
  cash: { label: 'Contanti', icon: Banknote },
  transfer: { label: 'Bonifico', icon: Landmark },
  card: { label: 'Carta / POS', icon: CreditCard },
  other: { label: 'Altro', icon: Banknote },
};

function formatTimeHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDateHeading(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Movimenti';
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (isToday) return 'Oggi';
  return d.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface SelectedPrTarget {
  member: StaffMember | null;
  staffMemberId: string | null;
  displayName: string;
  fullName: string;
  rollup: StaffMemberEventRollup | null;
}

export function CashCollectionView({
  events,
  selectedEventId,
  onSelectEvent,
  staffData,
  venues,
  canUndo,
  lastUndoLabel,
  onUndo,
  onOpenEventInStaff,
}: {
  events: FullEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  staffData: ReturnType<typeof useStaffData>;
  venues: Venue[];
  canUndo: boolean;
  lastUndoLabel: string | null;
  onUndo: () => Promise<void>;
  onOpenEventInStaff: (eventId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<CashTab>('collect');
  const [prFilter, setPrFilter] = useState<PrListFilter>('OWING');
  const [search, setSearch] = useState('');
  const [historyScope, setHistoryScope] = useState<HistoryScope>('EVENT');
  const [historyMethod, setHistoryMethod] = useState<'ALL' | StaffCashPaymentMethod>('ALL');
  const [historySearch, setHistorySearch] = useState('');

  // Quick-add PR outside current event list
  const [pickOtherPrOpen, setPickOtherPrOpen] = useState(false);

  // Payment Sheet state
  const [targetPrKey, setTargetPrKey] = useState<{
    staffMemberId: string | null;
    displayName: string;
    fullName: string;
  } | null>(null);
  const [amountDraft, setAmountDraft] = useState<string>('');
  const [method, setMethod] = useState<StaffCashPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [isCorrection, setIsCorrection] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const eventsById = useMemo(() => {
    const m = new Map<string, FullEvent>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const venueColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of venues) m.set(v.name, v.color);
    return m;
  }, [venues]);

  // Pick smart default event (selected -> latest with open staff cash -> latest with staff data -> latest overall)
  const activeEvent = useMemo(() => {
    if (selectedEventId && eventsById.has(selectedEventId)) {
      return eventsById.get(selectedEventId)!;
    }
    const latestWithMancanti = events.find((e) => {
      const ss = staffData.summariesByEvent.get(e.id);
      return ss && ss.totalMancanti > 0.01;
    });
    if (latestWithMancanti) return latestWithMancanti;

    const latestWithStaff = events.find((e) => {
      const ss = staffData.summariesByEvent.get(e.id);
      return ss && (ss.presales.length > 0 || ss.tables.length > 0);
    });
    return latestWithStaff || events[0] || null;
  }, [selectedEventId, eventsById, events, staffData.summariesByEvent]);

  const activeSummary = useMemo(
    () => (activeEvent ? staffData.getEventSummary(activeEvent.id) : null),
    [activeEvent, staffData]
  );

  // Reset sheet if active event changes
  useEffect(() => {
    setTargetPrKey(null);
  }, [activeEvent?.id]);

  // Transactions for the selected event
  const eventTransactions = useMemo(() => {
    if (!activeEvent) return [];
    return staffData.cashTransactions.filter((tx) => tx.event_id === activeEvent.id);
  }, [staffData.cashTransactions, activeEvent]);

  const txCountByMemberKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of eventTransactions) {
      const k = tx.staff_member_id
        ? `m:${tx.staff_member_id}`
        : `n:${tx.promoter_name.trim().toLowerCase()}`;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }, [eventTransactions]);

  // Categorized PRs for live collection (sorted by highest owed first!)
  const prCards = useMemo(() => {
    if (!activeSummary) return { owing: [], settled: [], all: [] };
    const all = [...activeSummary.membersRollup].sort((a, b) => {
      if (b.mancantiTotal > 0.01 && a.mancantiTotal <= 0.01) return 1;
      if (a.mancantiTotal > 0.01 && b.mancantiTotal <= 0.01) return -1;
      return b.mancantiTotal - a.mancantiTotal || b.scaricoTotal - a.scaricoTotal;
    });
    const q = search.trim().toLowerCase();
    const matches = (r: StaffMemberEventRollup) =>
      !q ||
      r.displayName.toLowerCase().includes(q) ||
      r.fullName.toLowerCase().includes(q);

    const filteredAll = all.filter(matches);
    const owing = filteredAll.filter((r) => r.mancantiTotal > 0.01);
    const settled = filteredAll.filter((r) => r.mancantiTotal <= 0.01);
    return { owing, settled, all: filteredAll };
  }, [activeSummary, search]);

  const visibleCards =
    prFilter === 'OWING'
      ? prCards.owing
      : prFilter === 'SETTLED'
        ? prCards.settled
        : prCards.all;

  // Resolve live target PR data for the open Payment Sheet
  const activeTarget: SelectedPrTarget | null = useMemo(() => {
    if (!targetPrKey || !activeSummary) return null;
    const rollup =
      activeSummary.membersRollup.find(
        (r) =>
          (targetPrKey.staffMemberId && r.member?.id === targetPrKey.staffMemberId) ||
          r.displayName.toLowerCase() === targetPrKey.displayName.toLowerCase()
      ) || null;
    const member = targetPrKey.staffMemberId
      ? staffData.members.find((m) => m.id === targetPrKey.staffMemberId) || rollup?.member || null
      : rollup?.member || null;
    return {
      member,
      staffMemberId: member?.id ?? targetPrKey.staffMemberId,
      displayName: rollup?.displayName || member?.nickname || targetPrKey.displayName,
      fullName: rollup?.fullName || member?.full_name || targetPrKey.fullName,
      rollup,
    };
  }, [targetPrKey, activeSummary, staffData.members]);

  const targetTransactions = useMemo(() => {
    if (!activeTarget) return [];
    return eventTransactions.filter(
      (tx) =>
        (activeTarget.staffMemberId && tx.staff_member_id === activeTarget.staffMemberId) ||
        tx.promoter_name.toLowerCase() === activeTarget.displayName.toLowerCase()
    );
  }, [activeTarget, eventTransactions]);

  const openPaymentSheet = (target: {
    staffMemberId: string | null;
    displayName: string;
    fullName: string;
  }) => {
    setTargetPrKey(target);
    setAmountDraft('');
    setMethod('cash');
    setNote('');
    setIsCorrection(false);
  };

  const parsedDraftAmount = useMemo(() => {
    const cleaned = amountDraft.trim().replace(',', '.');
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? round2(Math.abs(n)) : 0;
  }, [amountDraft]);

  const signedAmount = isCorrection ? -parsedDraftAmount : parsedDraftAmount;

  const handleQuickAddChip = (delta: number) => {
    const next = round2(parsedDraftAmount + delta);
    setAmountDraft(String(next).replace('.', ','));
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        // ignore unsupported vibration
      }
    }
  };

  const handleCommitPayment = async (overrideAmount?: number, overrideNote?: string) => {
    if (!activeEvent || !activeTarget || submitting) return;
    const finalAmt = overrideAmount !== undefined ? round2(overrideAmount) : signedAmount;
    if (Math.abs(finalAmt) < 0.01) {
      toast.error('Inserisci un importo valido');
      return;
    }

    // Dismiss mobile keyboard before state/toast updates so iOS Safari never shifts the viewport horizontally
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const currentOwed = activeTarget.rollup?.mancantiTotal ?? 0;
    const settlesBalance = currentOwed > 0.01 && Math.abs(currentOwed - finalAmt) <= 0.01;

    setSubmitting(true);
    try {
      const saved = await staffData.recordCashPayment({
        eventId: activeEvent.id,
        staffMemberId: activeTarget.staffMemberId,
        promoterName: activeTarget.displayName,
        amount: finalAmt,
        paymentMethod: method,
        note: overrideNote ?? note,
      });
      if (saved) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate([12, 30, 12]);
          } catch {
            // ignore
          }
        }
        toast.success(
          finalAmt >= 0
            ? `Registrati +${formatEur(finalAmt)} da ${activeTarget.displayName}`
            : `Rettifica ${formatEur(finalAmt)} per ${activeTarget.displayName}`
        );
        setAmountDraft('');
        setNote('');
        setIsCorrection(false);
        if (settlesBalance) {
          setTargetPrKey(null);
        }
        if (typeof window !== 'undefined' && window.scrollX !== 0) {
          window.scrollTo({ left: 0, top: window.scrollY });
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered History list
  const filteredHistory = useMemo(() => {
    const base =
      historyScope === 'EVENT' && activeEvent
        ? eventTransactions
        : staffData.cashTransactions;
    const q = historySearch.trim().toLowerCase();
    return base.filter((tx) => {
      if (historyMethod !== 'ALL' && tx.payment_method !== historyMethod) return false;
      if (q) {
        const ev = eventsById.get(tx.event_id);
        const hit =
          tx.promoter_name.toLowerCase().includes(q) ||
          tx.note.toLowerCase().includes(q) ||
          (ev && ev.title.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [
    historyScope,
    activeEvent,
    eventTransactions,
    staffData.cashTransactions,
    historyMethod,
    historySearch,
    eventsById,
  ]);

  const groupedHistory = useMemo(() => {
    const groups: { label: string; items: StaffCashTransaction[] }[] = [];
    for (const tx of filteredHistory) {
      const lbl = formatDateHeading(tx.recorded_at);
      const last = groups[groups.length - 1];
      if (last && last.label === lbl) last.items.push(tx);
      else groups.push({ label: lbl, items: [tx] });
    }
    return groups;
  }, [filteredHistory]);

  const historyTotalSum = useMemo(
    () => round2(filteredHistory.reduce((acc, tx) => acc + tx.amount, 0)),
    [filteredHistory]
  );

  const progressPct = useMemo(() => {
    if (!activeSummary) return 0;
    if (activeSummary.totalScarico <= 0.01) return 100;
    return Math.max(
      0,
      Math.min(100, Math.round((activeSummary.totalPaidCash / activeSummary.totalScarico) * 100))
    );
  }, [activeSummary]);

  const remainingPreview = useMemo(() => {
    if (!activeTarget) return 0;
    const currentOwed = activeTarget.rollup?.mancantiTotal ?? 0;
    return round2(currentOwed - signedAmount);
  }, [activeTarget, signedAmount]);

  if (!activeEvent || !activeSummary) {
    return (
      <div className="mx-auto max-w-[680px] px-4 py-16 text-center">
        <Banknote className="h-10 w-10 mx-auto mb-3" style={{ color: 'var(--ink-tertiary)' }} />
        <h1 className="text-[22px] font-bold">Raccolta soldi</h1>
        <p className="mt-1.5 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
          Crea prima una serata per iniziare a raccogliere i contanti dal tuo staff{' '}
          {staffData.group.name}.
        </p>
      </div>
    );
  }

  const venueColor = venueColorMap.get(activeEvent.venue_name) || '#0071E3';

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 sm:px-6 lg:px-8 pt-4 pb-28 lg:pb-12 space-y-5">
      {/* Header + Event Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] sm:text-[32px] font-bold tracking-tight">Raccolta soldi</h1>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent)',
              }}
            >
              {staffData.group.name}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] sm:text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            Tocca un PR per registrare al volo i contanti consegnati durante la serata.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canUndo && (
            <button
              type="button"
              onClick={() => onUndo()}
              title={lastUndoLabel ? `Annulla: ${lastUndoLabel}` : 'Annulla'}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-semibold apple-surface apple-press cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Annulla
            </button>
          )}

          <SegmentedControl<CashTab>
            ariaLabel="Modalità raccolta soldi"
            size="sm"
            className="w-full sm:w-auto"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: 'collect', label: 'Raccolta live' },
              {
                value: 'history',
                label: `Cronologia (${
                  historyScope === 'EVENT'
                    ? eventTransactions.length
                    : staffData.cashTransactions.length
                })`,
              },
            ]}
          />
        </div>
      </div>

      {/* Active Event Switcher Bar */}
      <div className="apple-card p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 overflow-hidden">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 w-full">
          <span
            className="h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: venueColor }}
          />
          <select
            aria-label="Seleziona serata per la raccolta soldi"
            value={activeEvent.id}
            onChange={(e) => onSelectEvent(e.target.value)}
            className="apple-input flex-1 w-full max-w-full min-w-0 overflow-hidden text-ellipsis rounded-[10px] px-3 py-2 text-[16px] md:text-[14px] font-semibold cursor-pointer"
          >
            {events.map((ev) => {
              const ss = staffData.summariesByEvent.get(ev.id);
              const manc = ss?.totalMancanti ?? 0;
              const tag =
                manc > 0.01
                  ? ` · Mancano ${formatEur(manc)}`
                  : ss && ss.pxTotal > 0
                    ? ' · In pari'
                    : '';
              return (
                <option key={ev.id} value={ev.id}>
                  {formatDateDayMonth(ev.event_date)} — {ev.title} ({ev.venue_name}){tag}
                </option>
              );
            })}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onOpenEventInStaff(activeEvent.id)}
          className="inline-flex items-center justify-center gap-1 rounded-[10px] px-3 py-2 text-[12px] font-semibold apple-press cursor-pointer shrink-0"
          style={{
            backgroundColor: 'var(--bg-surface-secondary)',
            color: 'var(--ink-primary)',
          }}
        >
          Dettaglio serata
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Live Cash Progress Hero */}
      <section className="apple-card overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-[var(--separator)]">
          <div className="p-2.5 sm:p-5 min-w-0">
            <span className="block truncate text-[11px] sm:text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Incassato
            </span>
            <div
              className="mt-1 text-[15px] min-[390px]:text-[17px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-none truncate"
              style={{ color: 'var(--status-green)' }}
            >
              {formatEur(activeSummary.totalPaidCash)}
            </div>
            <div className="mt-1 text-[10px] sm:text-[11px] tabular-nums truncate" style={{ color: 'var(--ink-tertiary)' }}>
              {eventTransactions.length} mov.
            </div>
          </div>

          <div className="p-2.5 sm:p-5 min-w-0">
            <span className="block truncate text-[11px] sm:text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Da raccogliere
            </span>
            <div
              className="mt-1 text-[15px] min-[390px]:text-[17px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-none truncate"
              style={{
                color:
                  activeSummary.totalMancanti > 0.01
                    ? 'var(--status-red)'
                    : 'var(--status-green)',
              }}
            >
              {formatEur(activeSummary.totalMancanti)}
            </div>
            <div className="mt-1 text-[10px] sm:text-[11px] tabular-nums truncate" style={{ color: 'var(--ink-tertiary)' }}>
              {prCards.owing.length === 0
                ? 'Tutti in pari'
                : `${prCards.owing.length} PR aperti`}
            </div>
          </div>

          <div className="p-2.5 sm:p-5 min-w-0">
            <span className="block truncate text-[11px] sm:text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Scarico serata
            </span>
            <div className="mt-1 text-[15px] min-[390px]:text-[17px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-none truncate">
              {formatEur(activeSummary.totalScarico)}
            </div>
            <div className="mt-1 text-[10px] sm:text-[11px] tabular-nums truncate" style={{ color: 'var(--ink-tertiary)' }}>
              Esclusi no-scarico
            </div>
          </div>
        </div>

        {/* Smooth Progress Bar */}
        <div
          className="px-4 sm:px-5 py-3 flex items-center gap-3"
          style={{ borderTop: '0.5px solid var(--separator)' }}
        >
          <div
            className="flex-1 h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{
                width: `${progressPct}%`,
                backgroundColor: progressPct >= 100 ? '#34C759' : 'var(--accent)',
              }}
            />
          </div>
          <span
            className="text-[12px] font-semibold tabular-nums shrink-0"
            style={{
              color: progressPct >= 100 ? 'var(--status-green)' : 'var(--ink-secondary)',
            }}
          >
            {progressPct}% raccolto
          </span>
        </div>
      </section>

      {/* ============ TAB 1: LIVE CASH COLLECTION ============ */}
      {activeTab === 'collect' && (
        <div className="space-y-4">
          {/* Controls: Filter pills + Search + Add extra PR */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'OWING', label: `Da incassare (${prCards.owing.length})` },
                  { id: 'SETTLED', label: `In pari (${prCards.settled.length})` },
                  { id: 'ALL', label: `Tutti (${prCards.all.length})` },
                ] as const
              ).map((f) => {
                const active = prFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setPrFilter(f.id)}
                    className="rounded-[9px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer transition-colors"
                    style={{
                      backgroundColor: active
                        ? f.id === 'OWING' && prCards.owing.length > 0
                          ? 'var(--status-red-bg)'
                          : 'var(--accent-subtle)'
                        : 'var(--bg-surface-secondary)',
                      color: active
                        ? f.id === 'OWING' && prCards.owing.length > 0
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

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-[210px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: 'var(--ink-tertiary)' }}
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca PR…"
                  aria-label="Filtra PR nella raccolta soldi"
                  className="apple-input w-full rounded-[10px] pl-9 pr-8 py-2 text-[16px] md:text-[13px]"
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

              <button
                type="button"
                onClick={() => setPickOtherPrOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Altro PR</span>
              </button>
            </div>
          </div>

          {/* Interactive PR Cards Grid */}
          {visibleCards.length === 0 ? (
            <div className="apple-card p-10 text-center space-y-2.5">
              <CheckCircle2
                className="h-10 w-10 mx-auto"
                style={{ color: 'var(--status-green)' }}
                aria-hidden="true"
              />
              <h2 className="text-[18px] font-semibold">
                {prFilter === 'OWING'
                  ? 'Tutti i PR di questa serata sono in pari!'
                  : 'Nessun PR trovato'}
              </h2>
              <p className="text-[13px] max-w-sm mx-auto" style={{ color: 'var(--ink-secondary)' }}>
                {prFilter === 'OWING'
                  ? 'Puoi passare a “Tutti” o toccare “Altro PR” per registrare un versamento anticipato.'
                  : 'Modifica la ricerca o aggiungi un PR dalla serata.'}
              </p>
              {prFilter === 'OWING' && prCards.all.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPrFilter('ALL')}
                  className="mt-1 inline-flex items-center gap-1 rounded-[10px] px-4 py-2 text-[13px] font-semibold apple-press cursor-pointer"
                  style={{
                    backgroundColor: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                  }}
                >
                  Mostra tutti i {prCards.all.length} PR
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleCards.map((r) => {
                const owing = r.mancantiTotal > 0.01;
                const overpaid = r.mancantiTotal < -0.01;
                const txCount = txCountByMemberKey.get(r.memberKey) || 0;
                const noScaricoTablesCount = r.tableRows.filter(
                  (ct) => ct.row.scarico_status !== 'DA SCARICARE'
                ).length;

                return (
                  <button
                    key={r.memberKey}
                    type="button"
                    onClick={() =>
                      openPaymentSheet({
                        staffMemberId: r.member?.id ?? null,
                        displayName: r.displayName,
                        fullName: r.fullName,
                      })
                    }
                    className="apple-card w-full min-w-0 overflow-hidden p-3.5 sm:p-4 text-left flex items-center justify-between gap-2.5 sm:gap-3 apple-press cursor-pointer hover:ring-1 hover:ring-[var(--accent)] transition-[box-shadow,transform]"
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-bold"
                        style={{
                          backgroundColor: owing
                            ? 'var(--status-red-bg)'
                            : 'var(--status-green-bg)',
                          color: owing ? 'var(--status-red)' : 'var(--status-green)',
                        }}
                      >
                        {r.displayName.slice(0, 2).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[16px] font-bold truncate">{r.displayName}</span>
                          {txCount > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                              style={{
                                backgroundColor: 'var(--bg-surface-secondary)',
                                color: 'var(--ink-secondary)',
                              }}
                            >
                              <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                              {txCount}
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-0.5 text-[12px] tabular-nums truncate"
                          style={{ color: 'var(--ink-secondary)' }}
                        >
                          {r.presalesScarico + r.presalesNote > 0 && (
                            <span>Preve {formatEur(r.presalesScarico + r.presalesNote)}</span>
                          )}
                          {r.presalesScarico + r.presalesNote > 0 && r.tablesScarico > 0 && (
                            <span> · </span>
                          )}
                          {r.tablesScarico > 0 && <span>Tavoli {formatEur(r.tablesScarico)}</span>}
                          {r.scaricoTotal <= 0.01 && noScaricoTablesCount > 0 && (
                            <span>{noScaricoTablesCount} tav. no scarico</span>
                          )}
                          {r.scaricoTotal <= 0.01 && noScaricoTablesCount === 0 && (
                            <span>{formatInt(r.pxTotal)} px</span>
                          )}
                        </div>
                        <div
                          className="mt-0.5 text-[11px] tabular-nums"
                          style={{ color: 'var(--ink-tertiary)' }}
                        >
                          Già dati {formatEur(r.paidCashTotal)} su {formatEur(r.scaricoTotal)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 tabular-nums">
                      {owing ? (
                        <>
                          <div
                            className="text-[10px] font-semibold"
                            style={{ color: 'var(--ink-tertiary)' }}
                          >
                            Ti deve
                          </div>
                          <div
                            className="text-[20px] font-bold leading-tight"
                            style={{ color: 'var(--status-red)' }}
                          >
                            {formatEur(r.mancantiTotal)}
                          </div>
                          <span
                            className="mt-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{
                              backgroundColor: 'var(--accent-subtle)',
                              color: 'var(--accent)',
                            }}
                          >
                            <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                            Incassa
                          </span>
                        </>
                      ) : overpaid ? (
                        <>
                          <div
                            className="text-[10px] font-semibold"
                            style={{ color: 'var(--status-orange)' }}
                          >
                            Resto
                          </div>
                          <div
                            className="text-[18px] font-bold leading-tight"
                            style={{ color: 'var(--status-orange)' }}
                          >
                            +{formatEur(Math.abs(r.mancantiTotal))}
                          </div>
                        </>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                          style={{
                            backgroundColor: 'var(--status-green-bg)',
                            color: 'var(--status-green)',
                          }}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          In pari
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============ TAB 2: CRONOLOGIA MOVIMENTI ============ */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl<HistoryScope>
                ariaLabel="Ambito cronologia"
                size="sm"
                value={historyScope}
                onChange={setHistoryScope}
                options={[
                  { value: 'EVENT', label: 'Questa serata' },
                  { value: 'ALL', label: 'Tutte le serate' },
                ]}
              />

              <div className="flex flex-wrap items-center gap-1">
                {(['ALL', 'cash', 'transfer', 'card'] as const).map((m) => {
                  const active = historyMethod === m;
                  const lbl =
                    m === 'ALL'
                      ? 'Tutti'
                      : m === 'cash'
                        ? 'Contanti'
                        : m === 'transfer'
                          ? 'Bonifico'
                          : 'Carta';
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setHistoryMethod(m)}
                      className="rounded-[8px] px-2.5 py-1 text-[12px] font-medium apple-press cursor-pointer transition-colors"
                      style={{
                        backgroundColor: active
                          ? 'var(--accent-subtle)'
                          : 'var(--bg-surface-secondary)',
                        color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                      }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="relative w-full sm:w-[220px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: 'var(--ink-tertiary)' }}
                aria-hidden="true"
              />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Cerca PR o nota…"
                aria-label="Filtra cronologia incassi"
                className="apple-input w-full rounded-[10px] pl-9 pr-3 py-1.5 text-[16px] md:text-[13px]"
              />
            </div>
          </div>

          {/* Running Total Banner */}
          <div className="apple-card px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              <History className="h-4 w-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <span>
                <strong style={{ color: 'var(--ink-primary)' }}>{filteredHistory.length}</strong>{' '}
                movimenti registrati
              </span>
            </div>
            <div className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--status-green)' }}>
              {historyTotalSum >= 0 ? '+' : ''}
              {formatEur(historyTotalSum)}
            </div>
          </div>

          {groupedHistory.length === 0 ? (
            <div className="apple-card p-10 text-center space-y-2">
              <Clock
                className="h-9 w-9 mx-auto"
                style={{ color: 'var(--ink-tertiary)' }}
                aria-hidden="true"
              />
              <h3 className="text-[16px] font-semibold">Nessun movimento registrato</h3>
              <p className="text-[13px] max-w-sm mx-auto" style={{ color: 'var(--ink-secondary)' }}>
                Ogni volta che registri soldi in “Raccolta live” o saldi un PR, comparirà qui con
                orario esatto e metodo.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedHistory.map((grp) => (
                <div key={grp.label} className="space-y-2">
                  <div
                    className="px-1 text-[12px] font-semibold"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {grp.label}
                  </div>
                  <div className="apple-card overflow-hidden divide-y divide-[var(--separator)]">
                    {grp.items.map((tx) => {
                      const ev = eventsById.get(tx.event_id);
                      const mMeta = METHOD_META[tx.payment_method] || METHOD_META.cash;
                      const MethodIcon = mMeta.icon;
                      const isPositive = tx.amount >= 0;

                      return (
                        <div
                          key={tx.id}
                          className="px-3.5 sm:px-4 py-3 flex items-center justify-between gap-2.5 sm:gap-3"
                        >
                          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                            <span
                              className="text-[12px] font-semibold tabular-nums px-2 py-1 rounded-[8px] shrink-0"
                              style={{
                                backgroundColor: 'var(--bg-surface-secondary)',
                                color: 'var(--ink-secondary)',
                              }}
                            >
                              {formatTimeHHMM(tx.recorded_at)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[14px] font-semibold truncate">
                                  {tx.promoter_name}
                                </span>
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                                  style={{
                                    backgroundColor: 'var(--bg-surface-secondary)',
                                    color: 'var(--ink-secondary)',
                                  }}
                                >
                                  <MethodIcon className="h-2.5 w-2.5" aria-hidden="true" />
                                  {mMeta.label}
                                </span>
                              </div>
                              <div
                                className="mt-0.5 text-[12px] truncate"
                                style={{ color: 'var(--ink-secondary)' }}
                              >
                                {historyScope === 'ALL' && ev ? (
                                  <span>
                                    {formatDateShort(ev.event_date)} · {ev.title}
                                    {tx.note ? ` · ${tx.note}` : ''}
                                  </span>
                                ) : (
                                  tx.note || 'Versamento serata'
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
                            <span
                              className="text-[16px] font-bold whitespace-nowrap"
                              style={{
                                color: isPositive ? 'var(--status-green)' : 'var(--status-orange)',
                              }}
                            >
                              {isPositive ? '+' : ''}
                              {formatEur(tx.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => staffData.deleteCashTransaction(tx.id)}
                              title="Annulla e rimuovi questo movimento"
                              aria-label={`Annulla movimento di ${tx.promoter_name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-[8px] apple-press cursor-pointer hover:bg-[var(--status-red-bg)]"
                              style={{ color: 'var(--status-red)' }}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ MODAL: APPLE CASH PAYMENT SHEET FOR SELECTED PR ============ */}
      <AppleModal
        open={Boolean(activeTarget)}
        onClose={() => setTargetPrKey(null)}
        title={activeTarget?.displayName || 'Incasso PR'}
        subtitle={
          activeTarget && activeTarget.fullName !== activeTarget.displayName
            ? `${activeTarget.fullName} · ${activeEvent.title}`
            : activeEvent.title
        }
        maxWidth="max-w-[480px]"
      >
        {activeTarget && (
          <div className="space-y-4">
            {/* Balance Banner */}
            <div
              className="rounded-[14px] p-4 flex items-center justify-between gap-3"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              <div>
                <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  Ti deve ancora
                </div>
                <div className="mt-1">
                  <MancantiBadge value={activeTarget.rollup?.mancantiTotal ?? 0} />
                </div>
              </div>

              <div className="text-right tabular-nums">
                <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                  Già versati
                </div>
                <div className="text-[16px] font-bold">
                  {formatEur(activeTarget.rollup?.paidCashTotal ?? 0)}
                  <span
                    className="text-[12px] font-normal ml-1"
                    style={{ color: 'var(--ink-tertiary)' }}
                  >
                    / {formatEur(activeTarget.rollup?.scaricoTotal ?? 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Big Numeric Input + Clear + Correction toggle */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <label
                  htmlFor="cash-collect-amount"
                  className="text-[12px] font-medium"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {isCorrection ? 'Importo da stornare / resto dato (€)' : 'Soldi consegnati ora (€)'}
                </label>
                <div className="flex items-center gap-2 shrink-0">
                  {parsedDraftAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmountDraft('')}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      Azzera
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsCorrection((v) => !v)}
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold cursor-pointer"
                    style={{
                      backgroundColor: isCorrection
                        ? 'var(--status-orange-bg)'
                        : 'var(--bg-surface-secondary)',
                      color: isCorrection ? 'var(--status-orange)' : 'var(--ink-secondary)',
                    }}
                  >
                    {isCorrection ? 'Modalità storno (−)' : 'Storno / Resto (−)'}
                  </button>
                </div>
              </div>

              <div className="relative">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[22px] font-bold"
                  style={{
                    color: isCorrection ? 'var(--status-orange)' : 'var(--ink-tertiary)',
                  }}
                >
                  {isCorrection ? '−€' : '+€'}
                </span>
                <input
                  id="cash-collect-amount"
                  type="text"
                  inputMode="decimal"
                  value={amountDraft}
                  onChange={(e) => {
                    if (/^\d*[.,]?\d*$/.test(e.target.value)) {
                      setAmountDraft(e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && parsedDraftAmount > 0) {
                      e.preventDefault();
                      handleCommitPayment();
                    }
                  }}
                  placeholder="0"
                  className="apple-input w-full rounded-[14px] pl-14 pr-4 py-3 text-right text-[28px] font-bold tabular-nums"
                />
              </div>

              {/* Live After-Payment Preview */}
              {parsedDraftAmount > 0 && (
                <div
                  className="text-right text-[12px] font-semibold tabular-nums"
                  style={{
                    color:
                      Math.abs(remainingPreview) <= 0.01
                        ? 'var(--status-green)'
                        : remainingPreview > 0
                          ? 'var(--ink-secondary)'
                          : 'var(--status-orange)',
                  }}
                >
                  {Math.abs(remainingPreview) <= 0.01
                    ? '✓ Con questo versamento è perfettamente in pari!'
                    : remainingPreview > 0
                      ? `Dopo questo versamento restano ${formatEur(remainingPreview)}`
                      : `Supera lo scarico di ${formatEur(Math.abs(remainingPreview))} (resto da dare)`}
                </div>
              )}
            </div>

            {/* 1-Tap Quick-Add Money Chips */}
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-1.5">
                {QUICK_ADD_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => handleQuickAddChip(amt)}
                    className="rounded-[10px] px-1 py-2.5 min-h-[42px] text-[12px] sm:text-[13px] font-bold tabular-nums apple-press cursor-pointer transition-colors"
                    style={{
                      backgroundColor: 'var(--bg-surface-secondary)',
                      color: 'var(--ink-primary)',
                    }}
                  >
                    +{amt}€
                  </button>
                ))}
              </div>

              {(activeTarget.rollup?.mancantiTotal ?? 0) > 0.01 && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    handleCommitPayment(
                      activeTarget.rollup!.mancantiTotal,
                      note.trim() || 'Saldo completo'
                    )
                  }
                  className="w-full flex items-center justify-center gap-1.5 rounded-[12px] py-2.5 text-[14px] font-semibold apple-press cursor-pointer disabled:opacity-45"
                  style={{
                    backgroundColor: 'var(--status-green-bg)',
                    color: 'var(--status-green)',
                  }}
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Salda esatto ({formatEur(activeTarget.rollup!.mancantiTotal)})
                </button>
              )}
            </div>

            {/* Method + Optional Note */}
            <div className="space-y-2.5">
              <SegmentedControl<StaffCashPaymentMethod>
                ariaLabel="Metodo pagamento"
                size="sm"
                className="w-full"
                value={method}
                onChange={setMethod}
                options={[
                  { value: 'cash', label: 'Contanti' },
                  { value: 'transfer', label: 'Bonifico' },
                  { value: 'card', label: 'Carta' },
                  { value: 'other', label: 'Altro' },
                ]}
              />

              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Nota opzionale (es. acconto al tavolo, resto…)"
                aria-label="Nota movimento"
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[13px]"
              />
            </div>

            {/* Primary Commit CTA */}
            <button
              type="button"
              disabled={submitting || parsedDraftAmount < 0.01}
              onClick={() => handleCommitPayment()}
              className="w-full rounded-[13px] py-3 text-[15px] font-bold text-white apple-press cursor-pointer disabled:opacity-35"
              style={{
                backgroundColor: isCorrection ? 'var(--status-orange)' : 'var(--accent)',
              }}
            >
              {submitting
                ? 'Salvataggio…'
                : parsedDraftAmount > 0
                  ? isCorrection
                    ? `Registra storno −${formatEur(parsedDraftAmount)}`
                    : `Registra +${formatEur(parsedDraftAmount)}`
                  : 'Inserisci importo o tocca un taglio'}
            </button>

            {/* Per-PR Mini-History for THIS Event */}
            {targetTransactions.length > 0 && (
              <div
                className="pt-3 space-y-2"
                style={{ borderTop: '0.5px solid var(--separator)' }}
              >
                <div
                  className="text-[12px] font-semibold"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  Cronologia di {activeTarget.displayName} in questa serata ({targetTransactions.length})
                </div>
                <div
                  className="rounded-[12px] max-h-[160px] overflow-y-auto divide-y divide-[var(--separator)]"
                  style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                >
                  {targetTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-[13px] tabular-nums"
                    >
                      <div className="min-w-0 flex-1 break-words">
                        <span className="font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                          {formatTimeHHMM(tx.recorded_at)}
                        </span>
                        <span className="mx-1.5 opacity-40">·</span>
                        <span>{METHOD_META[tx.payment_method]?.label || 'Contanti'}</span>
                        {tx.note && (
                          <span
                            className="ml-1.5 text-[12px]"
                            style={{ color: 'var(--ink-tertiary)' }}
                          >
                            ({tx.note})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className="font-bold"
                          style={{
                            color:
                              tx.amount >= 0 ? 'var(--status-green)' : 'var(--status-orange)',
                          }}
                        >
                          {tx.amount >= 0 ? '+' : ''}
                          {formatEur(tx.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => staffData.deleteCashTransaction(tx.id)}
                          aria-label="Rimuovi movimento"
                          className="p-1 rounded-[6px] cursor-pointer"
                          style={{ color: 'var(--status-red)' }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </AppleModal>

      {/* MODAL: PICK ANY SUB-PR OUTSIDE THIS EVENT'S CURRENT LIST */}
      <AppleModal
        open={pickOtherPrOpen}
        onClose={() => setPickOtherPrOpen(false)}
        title="Scegli un altro sotto-PR"
        subtitle="Registra un versamento anche se il PR non ha ancora righe in questa serata."
        maxWidth="max-w-[460px]"
      >
        <StaffMemberPicker
          members={staffData.members}
          selectedMemberId={null}
          usageScores={staffData.memberUsageScore}
          onQuickCreate={(name) => staffData.upsertMember({ full_name: name })}
          onSelect={(m) => {
            setPickOtherPrOpen(false);
            openPaymentSheet({
              staffMemberId: m.id,
              displayName: m.nickname || m.full_name,
              fullName: m.full_name,
            });
          }}
        />
      </AppleModal>
    </div>
  );
}
