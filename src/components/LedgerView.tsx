import { useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronRight, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { MancantiBadge, SegmentedControl } from './ui/AppleControls';
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
  const [tab, setTab] = useState<'MANCANTI' | 'BUSTE_APERTE' | 'BUSTE_SALDATE'>('MANCANTI');
  const [eraOnly2Px, setEraOnly2Px] = useState(true);

  const scopedEvents = useMemo(
    () => (eraOnly2Px ? events.filter((e) => e.era === '2PX') : events),
    [events, eraOnly2Px]
  );

  const ledgerStats = useMemo(() => {
    let mancantiTot = 0;
    let mancantiLollo = 0;
    let mancantiCiccio = 0;
    let busteUnpaidTot = 0;
    let busteUnpaidLollo = 0;
    let busteUnpaidCiccio = 0;
    let bustePaidTot = 0;

    const withMancanti: FullEvent[] = [];
    const unpaidBuste: FullEvent[] = [];
    const paidBuste: FullEvent[] = [];

    for (const ev of scopedEvents) {
      const s = summaries.get(ev.id);
      if (!s) continue;

      if (Math.abs(s.mancantiTotal) > 0.01) {
        withMancanti.push(ev);
        mancantiTot += s.mancantiTotal;
        mancantiLollo += s.byPromoter['lollo']?.mancanti ?? 0;
        mancantiCiccio += s.byPromoter['ciccio']?.mancanti ?? 0;
      }

      if (s.bustaTotal > 0.01) {
        if (ev.is_busta_paid) {
          paidBuste.push(ev);
          bustePaidTot += s.bustaTotal;
        } else {
          unpaidBuste.push(ev);
          busteUnpaidTot += s.bustaTotal;
          busteUnpaidLollo += s.byPromoter['lollo']?.bustaTotal ?? 0;
          busteUnpaidCiccio += s.byPromoter['ciccio']?.bustaTotal ?? 0;
        }
      }
    }

    return {
      mancantiTot,
      mancantiLollo,
      mancantiCiccio,
      busteUnpaidTot,
      busteUnpaidLollo,
      busteUnpaidCiccio,
      bustePaidTot,
      withMancanti,
      unpaidBuste,
      paidBuste,
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

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Saldi &amp; Buste</h1>
          <p className="mt-0.5 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            Controllo immediato di cassa da scaricare e buste da incassare
          </p>
        </div>

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

      {/* Overview Strip */}
      <section className="apple-surface rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--separator)]">
          <div className="p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Cassa mancante totale
            </span>
            <div className="mt-1.5">
              <MancantiBadge value={ledgerStats.mancantiTot} />
            </div>
            <div className="mt-2.5 flex items-center gap-3 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span>Lollo {formatEur(ledgerStats.mancantiLollo)}</span>
              <span>·</span>
              <span>Ciccio {formatEur(ledgerStats.mancantiCiccio)}</span>
            </div>
          </div>

          <div className="p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Buste da incassare ({ledgerStats.unpaidBuste.length})
            </span>
            <div className="mt-1 text-[26px] font-bold tabular-nums leading-none">
              {formatEur(ledgerStats.busteUnpaidTot, true)}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span>Lollo {formatEur(ledgerStats.busteUnpaidLollo, true)}</span>
              <span>·</span>
              <span>Ciccio {formatEur(ledgerStats.busteUnpaidCiccio, true)}</span>
            </div>
          </div>

          <div className="p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Buste già saldate ({ledgerStats.paidBuste.length})
            </span>
            <div
              className="mt-1 text-[26px] font-bold tabular-nums leading-none"
              style={{ color: 'var(--status-green)' }}
            >
              {formatEur(ledgerStats.bustePaidTot, true)}
            </div>
            <div className="mt-2 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
              Segnate come incassate
            </div>
          </div>
        </div>
      </section>

      {/* Section Switcher */}
      <SegmentedControl<'MANCANTI' | 'BUSTE_APERTE' | 'BUSTE_SALDATE'>
        ariaLabel="Vista saldi"
        value={tab}
        onChange={setTab}
        className="w-full sm:w-auto"
        options={[
          { value: 'MANCANTI', label: `Mancanti (${ledgerStats.withMancanti.length})` },
          { value: 'BUSTE_APERTE', label: `Buste aperte (${ledgerStats.unpaidBuste.length})` },
          { value: 'BUSTE_SALDATE', label: `Buste saldate (${ledgerStats.paidBuste.length})` },
        ]}
      />

      {/* Active List */}
      <section className="apple-surface rounded-[18px] overflow-hidden">
        {tab === 'MANCANTI' && (
          <div className="apple-list">
            {ledgerStats.withMancanti.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <CheckCircle2
                  className="h-9 w-9 mx-auto mb-2"
                  style={{ color: 'var(--status-green)' }}
                  aria-hidden="true"
                />
                <p className="text-[15px] font-semibold">Tutti gli scarichi sono in pari</p>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                  Nessun saldo cassa aperto nelle serate selezionate.
                </p>
              </div>
            ) : (
              ledgerStats.withMancanti.map((ev) => {
                const s = summaries.get(ev.id)!;
                return (
                  <div
                    key={ev.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenEvent(ev.id)}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="text-[15px] font-semibold truncate">{ev.title}</div>
                      <div className="mt-0.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                        {ev.venue_name} · {formatDateShort(ev.event_date)}
                        {s.promoterOrder
                          .filter((pid) => Math.abs(s.byPromoter[pid]?.mancanti ?? 0) > 0.01)
                          .map(
                            (pid) =>
                              ` · ${nameOf(pid)}: ${formatEur(s.byPromoter[pid].mancanti)}`
                          )
                          .join('')}
                      </div>
                    </button>

                    <div className="flex items-center gap-2.5 shrink-0">
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
              })
            )}
          </div>
        )}

        {(tab === 'BUSTE_APERTE' || tab === 'BUSTE_SALDATE') && (
          <div className="apple-list">
            {(tab === 'BUSTE_APERTE' ? ledgerStats.unpaidBuste : ledgerStats.paidBuste).length ===
            0 ? (
              <div className="py-12 px-6 text-center">
                <Wallet
                  className="h-9 w-9 mx-auto mb-2"
                  style={{ color: 'var(--ink-tertiary)' }}
                  aria-hidden="true"
                />
                <p className="text-[15px] font-semibold">
                  {tab === 'BUSTE_APERTE'
                    ? 'Nessuna busta in sospeso'
                    : 'Nessuna busta segnata come saldata'}
                </p>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                  Puoi segnare le buste come incassate direttamente da qui o dal dettaglio serata.
                </p>
              </div>
            ) : (
              (tab === 'BUSTE_APERTE' ? ledgerStats.unpaidBuste : ledgerStats.paidBuste).map(
                (ev) => {
                  const s = summaries.get(ev.id)!;
                  return (
                    <div
                      key={ev.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenEvent(ev.id)}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="text-[15px] font-semibold truncate">{ev.title}</div>
                        <div
                          className="mt-0.5 text-[12px] tabular-nums"
                          style={{ color: 'var(--ink-secondary)' }}
                        >
                          {ev.venue_name} · {formatDateShort(ev.event_date)} · Lollo{' '}
                          {formatEur(s.byPromoter['lollo']?.bustaTotal ?? 0, true)} · Ciccio{' '}
                          {formatEur(s.byPromoter['ciccio']?.bustaTotal ?? 0, true)}
                        </div>
                      </button>

                      <div className="flex items-center gap-3 shrink-0 tabular-nums">
                        <span className="text-[15px] font-bold">{formatEur(s.bustaTotal, true)}</span>
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
                            backgroundColor: ev.is_busta_paid
                              ? 'var(--bg-surface-secondary)'
                              : 'var(--accent-subtle)',
                            color: ev.is_busta_paid ? 'var(--ink-secondary)' : 'var(--accent)',
                          }}
                        >
                          {ev.is_busta_paid ? 'Riapri' : 'Segna pagata'}
                        </button>
                      </div>
                    </div>
                  );
                }
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}
