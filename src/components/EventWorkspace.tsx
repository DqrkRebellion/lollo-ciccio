import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Plus, Search, X } from 'lucide-react';
import { EventDetail } from './EventDetail';
import { formatDateDayMonth, formatEur, formatInt, formatMonthYear } from '../lib/format';
import type {
  AppSettings,
  EventPresale,
  EventPrReconciliation,
  EventRecord,
  EventSummary,
  EventTable,
  FullEvent,
  Promoter,
  Venue,
} from '../types';

export function EventWorkspace({
  events,
  summaries,
  selectedEventId,
  onSelectEvent,
  settings,
  promoters,
  venues,
  canUndo,
  canRedo,
  lastUndoLabel,
  lastRedoLabel,
  onUndo,
  onRedo,
  onOpenNewEvent,
  onUpdateEvent,
  onDuplicateEvent,
  onDeleteEvent,
  onUpsertPresale,
  onUpsertPresalesBatch,
  onUpsertReconciliation,
  onUpsertReconciliationsBatch,
  onAddTable,
  onUpdateTable,
  onDeleteTable,
}: {
  events: FullEvent[];
  summaries: Map<string, EventSummary>;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  settings: AppSettings;
  promoters: Promoter[];
  venues: Venue[];
  canUndo: boolean;
  canRedo: boolean;
  lastUndoLabel: string | null;
  lastRedoLabel: string | null;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onOpenNewEvent: () => void;
  onUpdateEvent: (id: string, patch: Partial<EventRecord>) => Promise<void>;
  onDuplicateEvent: (ev: FullEvent) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onUpsertPresale: (
    eventId: string,
    promoterId: string,
    patch: Partial<Pick<EventPresale, 'quantity' | 'revenue' | 'one_to_one'>>
  ) => Promise<void>;
  onUpsertPresalesBatch: (
    eventId: string,
    patches: {
      promoterId: string;
      patch: Partial<Pick<EventPresale, 'quantity' | 'revenue' | 'one_to_one'>>;
    }[],
    label?: string
  ) => Promise<void>;
  onUpsertReconciliation: (
    eventId: string,
    promoterId: string,
    patch: Partial<
      Pick<EventPrReconciliation, 'lista_pr_count' | 'note_amount' | 'note_text' | 'scaricato_amount'>
    >
  ) => Promise<void>;
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
  onAddTable: (
    eventId: string,
    table: Omit<EventTable, 'id' | 'event_id' | 'sort_order'>
  ) => Promise<EventTable | null>;
  onUpdateTable: (eventId: string, tableId: string, patch: Partial<EventTable>) => Promise<void>;
  onDeleteTable: (eventId: string, tableId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN_MANCANTI' | 'UNPAID_BUSTA'>('ALL');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const venueColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of venues) m.set(v.name, v.color);
    return m;
  }, [venues]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      if (venueFilter !== 'ALL' && ev.venue_name !== venueFilter) return false;
      const s = summaries.get(ev.id);
      if (statusFilter === 'OPEN_MANCANTI' && (s?.mancantiTotal ?? 0) <= 0.01) return false;
      if (statusFilter === 'UNPAID_BUSTA' && (ev.is_busta_paid || (s?.bustaTotal ?? 0) <= 0))
        return false;
      if (q) {
        const hit =
          ev.title.toLowerCase().includes(q) ||
          ev.venue_name.toLowerCase().includes(q) ||
          ev.tables.some((t) => t.table_name.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [events, summaries, search, venueFilter, statusFilter]);

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

  const activeEvent =
    events.find((e) => e.id === selectedEventId) || filteredEvents[0] || events[0] || null;
  const activeSummary = activeEvent ? summaries.get(activeEvent.id) : undefined;

  const uniqueVenueNames = useMemo(
    () => Array.from(new Set(events.map((e) => e.venue_name))).sort(),
    [events]
  );

  const handleSelect = (id: string) => {
    onSelectEvent(id);
    setMobileDetailOpen(true);
  };

  return (
    <div className="flex h-full min-h-[calc(100dvh-56px)] lg:min-h-dvh">
      {/* Master Event List (Always visible on lg+, toggled on mobile) */}
      <aside
        className={`${
          mobileDetailOpen ? 'hidden lg:flex' : 'flex'
        } w-full lg:w-[328px] xl:w-[350px] shrink-0 flex-col lg:h-dvh lg:sticky lg:top-0`}
        style={{
          borderRight: '0.5px solid var(--separator)',
          backgroundColor: 'var(--bg-canvas)',
        }}
      >
        <div className="px-4 pt-4 pb-3 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">Serate</h1>
              <p className="text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                {filteredEvents.length} di {events.length} serate
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenNewEvent}
              className="inline-flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuova
            </button>
          </div>

          {/* Search input */}
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
              placeholder="Cerca serata, locale o tavolo…"
              aria-label="Filtra serate"
              className="apple-input w-full rounded-[10px] pl-9 pr-8 py-2 text-[16px] md:text-[14px]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Svuota filtro"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 cursor-pointer"
                style={{ color: 'var(--ink-tertiary)' }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <select
              aria-label="Filtra per locale"
              value={venueFilter}
              onChange={(e) => setVenueFilter(e.target.value)}
              className="apple-input rounded-[8px] px-2.5 py-1 text-[12px] font-medium shrink-0 cursor-pointer"
            >
              <option value="ALL">Tutti i locali</option>
              {uniqueVenueNames.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                setStatusFilter((s) => (s === 'OPEN_MANCANTI' ? 'ALL' : 'OPEN_MANCANTI'))
              }
              className="rounded-[8px] px-2.5 py-1 text-[12px] font-medium shrink-0 apple-press cursor-pointer transition-colors"
              style={{
                backgroundColor:
                  statusFilter === 'OPEN_MANCANTI'
                    ? 'var(--status-red-bg)'
                    : 'var(--bg-surface-secondary)',
                color:
                  statusFilter === 'OPEN_MANCANTI' ? 'var(--status-red)' : 'var(--ink-secondary)',
              }}
            >
              Mancanti
            </button>

            <button
              type="button"
              onClick={() =>
                setStatusFilter((s) => (s === 'UNPAID_BUSTA' ? 'ALL' : 'UNPAID_BUSTA'))
              }
              className="rounded-[8px] px-2.5 py-1 text-[12px] font-medium shrink-0 apple-press cursor-pointer transition-colors"
              style={{
                backgroundColor:
                  statusFilter === 'UNPAID_BUSTA'
                    ? 'var(--accent-subtle)'
                    : 'var(--bg-surface-secondary)',
                color:
                  statusFilter === 'UNPAID_BUSTA' ? 'var(--accent)' : 'var(--ink-secondary)',
              }}
            >
              Buste aperte
            </button>
          </div>
        </div>

        {/* Scrollable List */}
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
                Modifica i filtri o crea una nuova serata.
              </p>
            </div>
          ) : (
            groupedByMonth.map((group) => (
              <div key={group.monthLabel}>
                <div
                  className="px-2 pb-1.5 text-[12px] font-semibold sticky top-0 z-10 backdrop-blur-md"
                  style={{
                    color: 'var(--ink-secondary)',
                    backgroundColor: 'color-mix(in srgb, var(--bg-canvas) 86%, transparent)',
                  }}
                >
                  {group.monthLabel}
                </div>
                <div className="space-y-1">
                  {group.items.map((ev) => {
                    const s = summaries.get(ev.id);
                    const isSelected = activeEvent?.id === ev.id;
                    const hasMancanti = (s?.mancantiTotal ?? 0) > 0.01;
                    const venueColor = venueColorMap.get(ev.venue_name) || '#0071E3';
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => handleSelect(ev.id)}
                        className="w-full rounded-[12px] px-3 py-2.5 text-left transition-colors apple-press cursor-pointer"
                        style={{
                          backgroundColor: isSelected ? 'var(--bg-surface)' : 'transparent',
                          boxShadow: isSelected ? 'var(--shadow-card)' : 'none',
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
                              <span className="tabular-nums">{formatDateDayMonth(ev.event_date)}</span>
                              <span>·</span>
                              <span className="truncate">{ev.venue_name}</span>
                            </div>
                          </div>

                          <div className="text-right shrink-0 tabular-nums">
                            <div className="text-[13px] font-semibold">
                              {formatEur(s?.bustaTotal ?? 0)}
                            </div>
                            <div
                              className="text-[11px]"
                              style={{ color: 'var(--ink-secondary)' }}
                            >
                              {formatInt(s?.pxTotal ?? 0)} px
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums">
                          <span style={{ color: 'var(--ink-tertiary)' }}>
                            Fatt. {formatEur(s?.revenueTotal ?? 0)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {ev.is_busta_paid && (
                              <span
                                className="inline-flex items-center gap-0.5 font-medium"
                                style={{ color: 'var(--status-green)' }}
                              >
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                Pagata
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
                                -{formatEur(s?.mancantiTotal ?? 0)}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Right Detail Pane */}
      <div
        className={`${
          mobileDetailOpen ? 'block' : 'hidden lg:block'
        } flex-1 min-w-0 overflow-y-auto`}
      >
        {activeEvent && activeSummary ? (
          <EventDetail
            key={activeEvent.id}
            event={activeEvent}
            summary={activeSummary}
            settings={settings}
            promoters={promoters}
            venues={venues}
            canUndo={canUndo}
            canRedo={canRedo}
            lastUndoLabel={lastUndoLabel}
            lastRedoLabel={lastRedoLabel}
            onUndo={onUndo}
            onRedo={onRedo}
            onBackMobile={() => setMobileDetailOpen(false)}
            onUpdateEvent={onUpdateEvent}
            onDuplicateEvent={onDuplicateEvent}
            onDeleteEvent={onDeleteEvent}
            onUpsertPresale={onUpsertPresale}
            onUpsertPresalesBatch={onUpsertPresalesBatch}
            onUpsertReconciliation={onUpsertReconciliation}
            onUpsertReconciliationsBatch={onUpsertReconciliationsBatch}
            onAddTable={onAddTable}
            onUpdateTable={onUpdateTable}
            onDeleteTable={onDeleteTable}
          />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
            <CalendarDays
              className="h-10 w-10 mb-3"
              style={{ color: 'var(--ink-tertiary)' }}
              aria-hidden="true"
            />
            <h2 className="text-[20px] font-semibold">Nessuna serata selezionata</h2>
            <p className="mt-1 text-[14px] max-w-sm" style={{ color: 'var(--ink-secondary)' }}>
              Crea la prima serata per registrare prevendite, tavoli, scarichi e calcolare la busta.
            </p>
            <button
              type="button"
              onClick={onOpenNewEvent}
              className="mt-4 inline-flex items-center gap-1.5 rounded-[12px] px-5 py-2.5 text-[14px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuova serata
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
