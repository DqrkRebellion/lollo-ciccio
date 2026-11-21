import { useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronRight, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { MancantiBadge, SegmentedControl } from './ui/AppleControls';
import { getActiveEventCutoffIso, isEventActive } from '../lib/events';
import { formatDateShort, formatEur } from '../lib/format';
import type { EventPrReconciliation, EventRecord, EventSummary, FullEvent, Promoter } from '../types';

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
  const [tab, setTab] = useState<'MANCANTI' | 'BUSTE_APERTE' | 'BUSTE_SALDATE'>('BUSTE_APERTE');
  const [eraOnly2Px, setEraOnly2Px] = useState(true);

  const scopedEvents = useMemo(
    () => (eraOnly2Px ? events.filter((e) => e.era === '2PX') : events),
    [events, eraOnly2Px]
  );

  const ledgerStats = useMemo(() => {
    const cutoffIso = getActiveEventCutoffIso();

    let mancantiTot = 0;
    let mancantiLollo = 0;
    let mancantiCiccio = 0;

    let bustePastTot = 0;
    let bustePastLollo = 0;
    let bustePastCiccio = 0;

    let busteActiveTot = 0;
    let busteActiveLollo = 0;
    let busteActiveCiccio = 0;

    let bustePaidTot = 0;

    const mancantiActive: FullEvent[] = [];
    const mancantiPast: FullEvent[] = [];
    const unpaidBusteActive: FullEvent[] = [];
    const unpaidBustePast: FullEvent[] = [];
    const paidBuste: FullEvent[] = [];

    for (const ev of scopedEvents) {
      const s = summaries.get(ev.id);
      if (!s) continue;
      const active = isEventActive(ev, cutoffIso);

      if (Math.abs(s.mancantiTotal) > 0.01) {
        if (active) mancantiActive.push(ev);
        else mancantiPast.push(ev);
        mancantiTot += s.mancantiTotal;
        mancantiLollo += s.byPromoter['lollo']?.mancanti ?? 0;
        mancantiCiccio += s.byPromoter['ciccio']?.mancanti ?? 0;
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
        } else {
          unpaidBustePast.push(ev);
          bustePastTot += s.bustaTotal;
          bustePastLollo += s.byPromoter['lollo']?.bustaTotal ?? 0;
          bustePastCiccio += s.byPromoter['ciccio']?.bustaTotal ?? 0;
        }
      }
    }

    mancantiActive.sort((a, b) => a.event_date.localeCompare(b.event_date));
    unpaidBusteActive.sort((a, b) => a.event_date.localeCompare(b.event_date));

    return {
      mancantiTot,
      mancantiLollo,
      mancantiCiccio,
      bustePastTot,
      bustePastLollo,
      bustePastCiccio,
      busteActiveTot,
      busteActiveLollo,
      busteActiveCiccio,
      bustePaidTot,
      mancantiActive,
      mancantiPast,
      unpaidBusteActive,
      unpaidBustePast,
      paidBuste,
      totalMancantiCount: mancantiActive.length + mancantiPast.length,
      totalUnpaidBusteCount: unpaidBusteActive.length + unpaidBustePast.length,
    };
  }, [scopedEvents, summaries]);

  const handleSettleEventCash = async (ev: FullEvent) => {
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
    await onUpsertReconciliationsBatch(ev.id, patches, `Salda “${ev.title}”`);
    toast.success(`Scarico “${ev.title}” saldato`);
  };

  const nameOf = (id: string) =>
    promoters.find((p) => p.id === id)?.display_name || id.toUpperCase();

  const renderMancantiRow = (ev: FullEvent, active: boolean) => {
    const s = summaries.get(ev.id)!;
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
            onClick={() => handleSettleEventCash(ev)}
            className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer"
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
            {ev.venue_name} · {formatDateShort(ev.event_date)} · Lollo{' '}
            {formatEur(s.byPromoter['lollo']?.bustaTotal ?? 0, true)} · Ciccio{' '}
            {formatEur(s.byPromoter['ciccio']?.bustaTotal ?? 0, true)}
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
            onClick={() => {
              onUpdateEvent(ev.id, { is_busta_paid: !ev.is_busta_paid });
              toast.success(
                !ev.is_busta_paid
                  ? `Busta “${ev.title}” segnata saldata`
                  : `Busta “${ev.title}” riaperta`
              );
            }}
            className="rounded-[9px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer"
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

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Saldi &amp; Buste</h1>

        <SegmentedControl<'2PX' | 'ALL'>
          ariaLabel="Periodo saldi"
          size="sm"
          value={eraOnly2Px ? '2PX' : 'ALL'}
          onChange={(v) => setEraOnly2Px(v === '2PX')}
          options={[
            { value: '2PX', label: 'Lollo & Ciccio' },
            { value: 'ALL', label: 'Tutto lo storico' },
          ]}
        />
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
            <div className="mt-2 flex items-center gap-2.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span>Lollo {formatEur(ledgerStats.mancantiLollo)}</span>
              <span>·</span>
              <span>Ciccio {formatEur(ledgerStats.mancantiCiccio)}</span>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Buste definitive ({ledgerStats.unpaidBustePast.length} passate)
            </span>
            <div className="mt-1 text-[24px] sm:text-[26px] font-bold tabular-nums leading-none">
              {formatEur(ledgerStats.bustePastTot, true)}
            </div>
            <div className="mt-2 flex items-center gap-2.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span>Lollo {formatEur(ledgerStats.bustePastLollo, true)}</span>
              <span>·</span>
              <span>Ciccio {formatEur(ledgerStats.bustePastCiccio, true)}</span>
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
            <div className="mt-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {ledgerStats.unpaidBusteActive.length > 0 ? (
                <>
                  Lollo {formatEur(ledgerStats.busteActiveLollo, true)} · Ciccio{' '}
                  {formatEur(ledgerStats.busteActiveCiccio, true)}
                </>
              ) : (
                'Nessuna serata attiva'
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section Switcher */}
      <SegmentedControl<'BUSTE_APERTE' | 'MANCANTI' | 'BUSTE_SALDATE'>
        ariaLabel="Vista saldi"
        size="sm"
        value={tab}
        onChange={setTab}
        className="w-full sm:w-auto"
        options={[
          { value: 'BUSTE_APERTE', label: `Buste aperte (${ledgerStats.totalUnpaidBusteCount})` },
          { value: 'MANCANTI', label: `Mancanti (${ledgerStats.totalMancantiCount})` },
          { value: 'BUSTE_SALDATE', label: `Saldate (${ledgerStats.paidBuste.length})` },
        ]}
      />

      {/* TAB 1: BUSTE APERTE — Split strictly into Active (Provisional) & Past (Final) */}
      {tab === 'BUSTE_APERTE' && (
        <div className="space-y-5">
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

      {/* TAB 2: MANCANTI — Split into Active & Past */}
      {tab === 'MANCANTI' && (
        <div className="space-y-5">
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

      {/* TAB 3: BUSTE SALDATE */}
      {tab === 'BUSTE_SALDATE' && (
        <section className="space-y-2">
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
