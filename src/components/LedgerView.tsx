import { useId, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Banknote, Check, CheckCircle2, ChevronRight, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { APPLE_SPRING_SNAPPY, MancantiBadge } from './ui/AppleControls';
import { getActiveEventCutoffIso, isEventActive } from '../lib/events';
import { formatDateShort, formatEur } from '../lib/format';
import type { EventPrReconciliation, EventRecord, EventSummary, FullEvent, Promoter } from '../types';

type LedgerSection = 'BUSTE_APERTE' | 'MANCANTI' | 'BUSTE_SALDATE';

const SECTION_ORDER: LedgerSection[] = ['BUSTE_APERTE', 'MANCANTI', 'BUSTE_SALDATE'];

export function LedgerView({
  events,
  summaries,
  promoters,
  onOpenEvent,
  onUpdateEvent,
  onUpsertReconciliationsBatch,
}: {
  events: FullEvent[];
  summaries: Map<string, EventSummary>;
  promoters: Promoter[];
  onOpenEvent: (eventId: string) => void;
  onUpdateEvent: (id: string, patch: Partial<EventRecord>) => Promise<void>;
  onUpsertReconciliationsBatch: (
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
    label?: string
  ) => Promise<void>;
}) {
  const [tab, setTab] = useState<LedgerSection>('BUSTE_APERTE');
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const tabGroupId = useId();

  const ledgerStats = useMemo(() => {
    const cutoffIso = getActiveEventCutoffIso();

    let mancantiTot = 0;
    let mancantiLollo = 0;
    let mancantiCiccio = 0;
    let mancantiFilo = 0;

    let bustePastTot = 0;
    let bustePastLollo = 0;
    let bustePastCiccio = 0;
    let bustePastFilo = 0;

    let busteActiveTot = 0;
    let busteActiveLollo = 0;
    let busteActiveCiccio = 0;
    let busteActiveFilo = 0;

    let bustePaidTot = 0;

    const mancantiActive: FullEvent[] = [];
    const mancantiPast: FullEvent[] = [];
    const unpaidBusteActive: FullEvent[] = [];
    const unpaidBustePast: FullEvent[] = [];
    const paidBuste: FullEvent[] = [];

    for (const ev of events) {
      const s = summaries.get(ev.id);
      if (!s) continue;
      const active = isEventActive(ev, cutoffIso);

      if (Math.abs(s.mancantiTotal) > 0.01) {
        if (active) mancantiActive.push(ev);
        else mancantiPast.push(ev);
        mancantiTot += s.mancantiTotal;
        mancantiLollo += s.byPromoter['lollo']?.mancanti ?? 0;
        mancantiCiccio += s.byPromoter['ciccio']?.mancanti ?? 0;
        mancantiFilo += s.byPromoter['filo']?.mancanti ?? 0;
      }

      if (s.bustaTotal > 0.01) {
        if (ev.is_busta_paid) {
          paidBuste.push(ev);
          bustePaidTot += s.bustaTotal;
        } else if (active) {
          unpaidBusteActive.push(ev);
          busteActiveTot += s.bustaTotal;
          busteActiveLollo += s.byPromoter['lollo']?.bustaTotal ?? 0;
          busteActiveCiccio += s.byPromoter['ciccio']?.bustaTotal ?? 0;
          busteActiveFilo += s.byPromoter['filo']?.bustaTotal ?? 0;
        } else {
          unpaidBustePast.push(ev);
          bustePastTot += s.bustaTotal;
          bustePastLollo += s.byPromoter['lollo']?.bustaTotal ?? 0;
          bustePastCiccio += s.byPromoter['ciccio']?.bustaTotal ?? 0;
          bustePastFilo += s.byPromoter['filo']?.bustaTotal ?? 0;
        }
      }
    }

    mancantiActive.sort((a, b) => a.event_date.localeCompare(b.event_date));
    unpaidBusteActive.sort((a, b) => a.event_date.localeCompare(b.event_date));

    return {
      mancantiTot,
      mancantiLollo,
      mancantiCiccio,
      mancantiFilo,
      bustePastTot,
      bustePastLollo,
      bustePastCiccio,
      bustePastFilo,
      busteActiveTot,
      busteActiveLollo,
      busteActiveCiccio,
      busteActiveFilo,
      bustePaidTot,
      mancantiActive,
      mancantiPast,
      unpaidBusteActive,
      unpaidBustePast,
      paidBuste,
      totalMancantiCount: mancantiActive.length + mancantiPast.length,
      totalUnpaidBusteCount: unpaidBusteActive.length + unpaidBustePast.length,
    };
  }, [events, summaries]);

  const markPending = (eventId: string, active: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
  };

  const handleToggleBustaPaid = async (ev: FullEvent) => {
    if (pendingIds.has(ev.id)) return;
    const nextPaid = !ev.is_busta_paid;
    markPending(ev.id, true);
    try {
      await onUpdateEvent(ev.id, { is_busta_paid: nextPaid });
      toast.success(
        nextPaid
          ? `Busta “${ev.title}” segnata saldata`
          : `Busta “${ev.title}” riaperta`
      );
    } catch {
      // Error toast & state rollback handled in useAppData
    } finally {
      markPending(ev.id, false);
    }
  };

  const handleSettleEventCash = async (ev: FullEvent) => {
    if (pendingIds.has(ev.id)) return;
    const s = summaries.get(ev.id);
    if (!s) return;
    const patches = s.promoterOrder
      .filter((pid) => Math.abs(s.byPromoter[pid]?.mancanti ?? 0) >= 0.01)
      .map((pid) => {
        const pr = s.byPromoter[pid];
        return {
          promoterId: pid,
          patch: {
            scaricato_amount: Math.max(
              0,
              Math.round((pr.scaricoTotal + pr.noteAmount) * 100) / 100
            ),
          },
        };
      });
    if (patches.length === 0) return;
    markPending(ev.id, true);
    try {
      await onUpsertReconciliationsBatch(ev.id, patches, `Salda “${ev.title}”`);
      toast.success(`Scarico “${ev.title}” saldato`);
    } catch {
      // Error toast handled in useAppData
    } finally {
      markPending(ev.id, false);
    }
  };

  const promoterMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of promoters) map.set(p.id, p.display_name);
    return map;
  }, [promoters]);

  const nameOf = (id: string) => promoterMap.get(id) || id.toUpperCase();

  const renderMancantiRow = (ev: FullEvent, active: boolean) => {
    const s = summaries.get(ev.id)!;
    const busy = pendingIds.has(ev.id);
    return (
      <div
        key={ev.id}
        className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors"
      >
        <button
          type="button"
          onClick={() => onOpenEvent(ev.id)}
          className="min-w-0 flex-1 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold truncate">{ev.title}</span>
            {active && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0"
                style={{
                  backgroundColor: 'var(--status-orange-bg)',
                  color: 'var(--status-orange)',
                }}
              >
                Attiva
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
            {ev.venue_name} · {formatDateShort(ev.event_date)}
            {s.promoterOrder
              .filter((pid) => Math.abs(s.byPromoter[pid]?.mancanti ?? 0) > 0.01)
              .map((pid) => ` · ${nameOf(pid)} ${formatEur(s.byPromoter[pid].mancanti)}`)
              .join('')}
          </div>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <MancantiBadge value={s.mancantiTotal} compact />
          <button
            type="button"
            disabled={busy}
            onClick={() => handleSettleEventCash(ev)}
            className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: 'var(--status-green-bg)',
              color: 'var(--status-green)',
            }}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Salda
          </button>
          <button
            type="button"
            onClick={() => onOpenEvent(ev.id)}
            aria-label={`Apri ${ev.title}`}
            className="p-1 cursor-pointer"
            style={{ color: 'var(--ink-tertiary)' }}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  const renderBustaRow = (ev: FullEvent, active: boolean) => {
    const s = summaries.get(ev.id)!;
    const busy = pendingIds.has(ev.id);
    const prBreakdown = s.promoterOrder.filter((pid) => {
      if (pid === 'lollo' || pid === 'ciccio') return true;
      return Math.abs(s.byPromoter[pid]?.bustaTotal ?? 0) > 0.01;
    });

    return (
      <div
        key={ev.id}
        className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors"
      >
        <button
          type="button"
          onClick={() => onOpenEvent(ev.id)}
          className="min-w-0 flex-1 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold truncate">{ev.title}</span>
            {active && !ev.is_busta_paid && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0"
                style={{
                  backgroundColor: 'var(--status-orange-bg)',
                  color: 'var(--status-orange)',
                }}
              >
                Provvisoria
              </span>
            )}
          </div>
          <div
            className="mt-0.5 text-[12px] tabular-nums"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {ev.venue_name} · {formatDateShort(ev.event_date)}
            {prBreakdown
              .map((pid) => ` · ${nameOf(pid)} ${formatEur(s.byPromoter[pid]?.bustaTotal ?? 0, true)}`)
              .join('')}
          </div>
        </button>

        <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
          <span
            className="text-[15px] font-bold"
            style={{
              color: active && !ev.is_busta_paid ? 'var(--status-orange)' : 'var(--ink-primary)',
            }}
          >
            {formatEur(s.bustaTotal, true)}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleToggleBustaPaid(ev)}
            className="rounded-[9px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor:
                ev.is_busta_paid || active
                  ? 'var(--bg-surface-secondary)'
                  : 'var(--accent-subtle)',
              color:
                ev.is_busta_paid || active ? 'var(--ink-secondary)' : 'var(--accent)',
            }}
          >
            {ev.is_busta_paid ? 'Riapri' : 'Segna pagata'}
          </button>
        </div>
      </div>
    );
  };

  const sectionTabs: {
    id: LedgerSection;
    label: string;
    count: number;
    icon: typeof Wallet;
    activeBadgeBg: string;
    activeBadgeColor: string;
  }[] = [
    {
      id: 'BUSTE_APERTE',
      label: 'Buste aperte',
      count: ledgerStats.totalUnpaidBusteCount,
      icon: Wallet,
      activeBadgeBg:
        ledgerStats.totalUnpaidBusteCount > 0 ? 'var(--accent-subtle)' : 'var(--bg-surface-secondary)',
      activeBadgeColor:
        ledgerStats.totalUnpaidBusteCount > 0 ? 'var(--accent)' : 'var(--ink-secondary)',
    },
    {
      id: 'MANCANTI',
      label: 'Mancanti',
      count: ledgerStats.totalMancantiCount,
      icon: Banknote,
      activeBadgeBg:
        ledgerStats.totalMancantiCount > 0 ? 'var(--status-red-bg)' : 'var(--status-green-bg)',
      activeBadgeColor:
        ledgerStats.totalMancantiCount > 0 ? 'var(--status-red)' : 'var(--status-green)',
    },
    {
      id: 'BUSTE_SALDATE',
      label: 'Saldate',
      count: ledgerStats.paidBuste.length,
      icon: CheckCircle2,
      activeBadgeBg:
        ledgerStats.paidBuste.length > 0 ? 'var(--status-green-bg)' : 'var(--bg-surface-secondary)',
      activeBadgeColor:
        ledgerStats.paidBuste.length > 0 ? 'var(--status-green)' : 'var(--ink-secondary)',
    },
  ];

  const handleSelectorKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let nextTab: LedgerSection | null = null;
    if (e.key === 'ArrowRight') {
      nextTab = SECTION_ORDER[(idx + 1) % SECTION_ORDER.length];
    } else if (e.key === 'ArrowLeft') {
      nextTab = SECTION_ORDER[(idx - 1 + SECTION_ORDER.length) % SECTION_ORDER.length];
    } else if (e.key === 'Home') {
      nextTab = SECTION_ORDER[0];
    } else if (e.key === 'End') {
      nextTab = SECTION_ORDER[SECTION_ORDER.length - 1];
    }
    if (!nextTab) return;
    e.preventDefault();
    setTab(nextTab);
    document.getElementById(`${tabGroupId}-tab-${nextTab}`)?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-5">
      <div>
        <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Saldi &amp; Buste</h1>
        <p className="mt-0.5 text-[13px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
          Tutto lo storico · {events.length} serate
        </p>
      </div>

      {/* Overview Strip: Cash | Finalized Past Buste | Active Provisional Buste */}
      <section className="apple-surface rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--separator)]">
          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Cassa mancante
            </span>
            <div className="mt-1.5">
              <MancantiBadge value={ledgerStats.mancantiTot} />
            </div>
            <div
              className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span>Lollo {formatEur(ledgerStats.mancantiLollo)}</span>
              <span>·</span>
              <span>Ciccio {formatEur(ledgerStats.mancantiCiccio)}</span>
              {Math.abs(ledgerStats.mancantiFilo) > 0.01 && (
                <>
                  <span>·</span>
                  <span>Filo {formatEur(ledgerStats.mancantiFilo)}</span>
                </>
              )}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Buste definitive ({ledgerStats.unpaidBustePast.length} passate)
            </span>
            <div className="mt-1 text-[24px] sm:text-[26px] font-bold tabular-nums leading-none">
              {formatEur(ledgerStats.bustePastTot, true)}
            </div>
            <div
              className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span>Lollo {formatEur(ledgerStats.bustePastLollo, true)}</span>
              <span>·</span>
              <span>Ciccio {formatEur(ledgerStats.bustePastCiccio, true)}</span>
              {ledgerStats.bustePastFilo > 0.01 && (
                <>
                  <span>·</span>
                  <span>Filo {formatEur(ledgerStats.bustePastFilo, true)}</span>
                </>
              )}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-1.5">
              {ledgerStats.unpaidBusteActive.length > 0 && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: 'var(--status-orange)' }}
                  aria-hidden="true"
                />
              )}
              <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Buste in corso ({ledgerStats.unpaidBusteActive.length} attive)
              </span>
            </div>
            <div
              className="mt-1 text-[24px] sm:text-[26px] font-bold tabular-nums leading-none"
              style={{
                color:
                  ledgerStats.busteActiveTot > 0.01
                    ? 'var(--status-orange)'
                    : 'var(--ink-tertiary)',
              }}
            >
              {formatEur(ledgerStats.busteActiveTot, true)}
            </div>
            <div
              className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {ledgerStats.unpaidBusteActive.length > 0 ? (
                <>
                  <span>Lollo {formatEur(ledgerStats.busteActiveLollo, true)}</span>
                  <span>·</span>
                  <span>Ciccio {formatEur(ledgerStats.busteActiveCiccio, true)}</span>
                  {ledgerStats.busteActiveFilo > 0.01 && (
                    <>
                      <span>·</span>
                      <span>Filo {formatEur(ledgerStats.busteActiveFilo, true)}</span>
                    </>
                  )}
                </>
              ) : (
                'Nessuna serata attiva'
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Primary Section Selector (full-width 3-column Apple tab selector, NOT a small filter pill) */}
      <div
        role="tablist"
        aria-label="Sezioni Saldi e Buste"
        className="grid grid-cols-3 gap-1 w-full rounded-[14px] p-1 select-none"
        style={{
          backgroundColor: 'var(--bg-surface-secondary)',
          boxShadow: 'inset 0 0 0 0.5px var(--separator)',
        }}
      >
        {sectionTabs.map((item, idx) => {
          const active = tab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              id={`${tabGroupId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${tabGroupId}-panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={(e) => handleSelectorKeyDown(e, idx)}
              className="relative min-w-0 min-h-[48px] rounded-[10px] px-2 sm:px-4 py-2 apple-press cursor-pointer transition-colors"
              style={{
                color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
              }}
            >
              {active && (
                <motion.span
                  layoutId={`ledger-selector-${tabGroupId}`}
                  transition={APPLE_SPRING_SNAPPY}
                  className="absolute inset-0 rounded-[10px]"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08), 0 0 0 0.5px var(--separator)',
                  }}
                />
              )}
              <span className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                <Icon
                  className="hidden sm:block h-4 w-4 shrink-0"
                  style={{ color: active ? item.activeBadgeColor : 'var(--ink-tertiary)' }}
                  aria-hidden="true"
                />
                <span className="text-[12.5px] sm:text-[14px] font-semibold leading-tight tracking-[-0.01em] truncate max-w-full">
                  {item.label}
                </span>
                <span
                  className="inline-flex items-center justify-center min-w-[22px] rounded-full px-2 py-0.5 text-[11px] sm:text-[12px] font-bold tabular-nums leading-none"
                  style={{
                    backgroundColor: active ? item.activeBadgeBg : 'var(--bg-surface-tertiary)',
                    color: active ? item.activeBadgeColor : 'var(--ink-secondary)',
                  }}
                >
                  {item.count}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* PANEL 1: BUSTE APERTE — Split strictly into Active (Provisional) & Past (Final) */}
      {tab === 'BUSTE_APERTE' && (
        <div
          id={`${tabGroupId}-panel-BUSTE_APERTE`}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-tab-BUSTE_APERTE`}
          className="space-y-5"
        >
          {ledgerStats.totalUnpaidBusteCount === 0 ? (
            <section className="apple-surface rounded-[18px] py-12 px-6 text-center">
              <Wallet
                className="h-9 w-9 mx-auto mb-2"
                style={{ color: 'var(--ink-tertiary)' }}
                aria-hidden="true"
              />
              <p className="text-[15px] font-semibold">Nessuna busta in sospeso</p>
            </section>
          ) : (
            <>
              {ledgerStats.unpaidBusteActive.length > 0 && (
                <section className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: 'var(--status-orange)' }}
                        aria-hidden="true"
                      />
                      <h2 className="text-[14px] font-semibold">
                        Serate attive · provvisorie ({ledgerStats.unpaidBusteActive.length})
                      </h2>
                    </div>
                    <span className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      Possono cambiare con nuovi ingressi
                    </span>
                  </div>
                  <div className="apple-surface rounded-[18px] overflow-hidden apple-list">
                    {ledgerStats.unpaidBusteActive.map((ev) => renderBustaRow(ev, true))}
                  </div>
                </section>
              )}

              {ledgerStats.unpaidBustePast.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <h2
                      className="text-[14px] font-semibold"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      Serate passate · definitive ({ledgerStats.unpaidBustePast.length})
                    </h2>
                    <span
                      className="text-[13px] font-semibold tabular-nums"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      {formatEur(ledgerStats.bustePastTot, true)}
                    </span>
                  </div>
                  <div className="apple-surface rounded-[18px] overflow-hidden apple-list">
                    {ledgerStats.unpaidBustePast.map((ev) => renderBustaRow(ev, false))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* PANEL 2: MANCANTI — Split into Active & Past */}
      {tab === 'MANCANTI' && (
        <div
          id={`${tabGroupId}-panel-MANCANTI`}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-tab-MANCANTI`}
          className="space-y-5"
        >
          {ledgerStats.totalMancantiCount === 0 ? (
            <section className="apple-surface rounded-[18px] py-12 px-6 text-center">
              <CheckCircle2
                className="h-9 w-9 mx-auto mb-2"
                style={{ color: 'var(--status-green)' }}
                aria-hidden="true"
              />
              <p className="text-[15px] font-semibold">Tutti gli scarichi sono in pari</p>
            </section>
          ) : (
            <>
              {ledgerStats.mancantiActive.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: 'var(--status-orange)' }}
                      aria-hidden="true"
                    />
                    <h2 className="text-[14px] font-semibold">
                      Serate attive ({ledgerStats.mancantiActive.length})
                    </h2>
                  </div>
                  <div className="apple-surface rounded-[18px] overflow-hidden apple-list">
                    {ledgerStats.mancantiActive.map((ev) => renderMancantiRow(ev, true))}
                  </div>
                </section>
              )}

              {ledgerStats.mancantiPast.length > 0 && (
                <section className="space-y-2">
                  <h2
                    className="px-1 text-[14px] font-semibold"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    Serate passate ({ledgerStats.mancantiPast.length})
                  </h2>
                  <div className="apple-surface rounded-[18px] overflow-hidden apple-list">
                    {ledgerStats.mancantiPast.map((ev) => renderMancantiRow(ev, false))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* PANEL 3: BUSTE SALDATE */}
      {tab === 'BUSTE_SALDATE' && (
        <section
          id={`${tabGroupId}-panel-BUSTE_SALDATE`}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-tab-BUSTE_SALDATE`}
          className="space-y-2"
        >
          {ledgerStats.paidBuste.length > 0 && (
            <div className="flex items-baseline justify-between gap-2 px-1">
              <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Totale incassato
              </span>
              <span
                className="text-[15px] font-bold tabular-nums"
                style={{ color: 'var(--status-green)' }}
              >
                {formatEur(ledgerStats.bustePaidTot, true)}
              </span>
            </div>
          )}
          <div className="apple-surface rounded-[18px] overflow-hidden apple-list">
            {ledgerStats.paidBuste.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <Wallet
                  className="h-9 w-9 mx-auto mb-2"
                  style={{ color: 'var(--ink-tertiary)' }}
                  aria-hidden="true"
                />
                <p className="text-[15px] font-semibold">Nessuna busta segnata come saldata</p>
              </div>
            ) : (
              ledgerStats.paidBuste.map((ev) => renderBustaRow(ev, false))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
