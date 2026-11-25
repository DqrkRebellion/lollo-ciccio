import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Plus, RefreshCw, Search, X } from 'lucide-react';
import { EventDetail } from './EventDetail';
import { splitActiveAndPastEvents } from '../lib/events';
import { formatDateDayMonth, formatEur, formatInt } from '../lib/format';
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
import type { StaffEventSummary, StaffEventTable, StaffMember } from '../types/staff';

export function EventWorkspace({
  events,
  summaries,
  selectedEventId,
  onSelectEvent,
  settings,
  promoters,
  venues,
  ownerPromoterId,
  staffGroupName,
  staffSummariesByEvent,
  staffMembers,
  staffMemberUsageScore,
  staffTableByEventTableId,
  canUndo,
  canRedo,
  lastUndoLabel,
  lastRedoLabel,
  onUndo,
  onRedo,
  onOpenNewEvent,
  ticketSmsSyncing = false,
  onTriggerTicketSmsSync,
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
  onAssignSubPrToTable,
  onQuickCreateStaffMember,
}: {
  events: FullEvent[];
  summaries: Map<string, EventSummary>;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  settings: AppSettings;
  promoters: Promoter[];
  venues: Venue[];
  ownerPromoterId: 'lollo' | 'ciccio';
  staffGroupName: string;
  staffSummariesByEvent: Map<string, StaffEventSummary>;
  staffMembers: StaffMember[];
  staffMemberUsageScore: Map<string, number>;
  staffTableByEventTableId: Map<string, StaffEventTable>;
  canUndo: boolean;
  canRedo: boolean;
  lastUndoLabel: string | null;
  lastRedoLabel: string | null;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onOpenNewEvent: () => void;
  ticketSmsSyncing?: boolean;
  onTriggerTicketSmsSync?: () => Promise<void>;
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
  onAssignSubPrToTable: (
    eventTableId: string,
    staffMemberId: string | null,
    promoterName: string
  ) => Promise<void>;
  onQuickCreateStaffMember: (fullName: string) => Promise<StaffMember | null>;
}) {
  const [search, setSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN_MANCANTI' | 'UNPAID_BUSTA'>('ALL');

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

  const { active: activeEvents, past: pastEvents } = useMemo(
    () => splitActiveAndPastEvents(filteredEvents),
    [filteredEvents]
  );

  const uniqueVenueNames = useMemo(
    () => Array.from(new Set(events.map((e) => e.venue_name))).sort(),
    [events]
  );

  const activeEvent = selectedEventId ? events.find((e) => e.id === selectedEventId) || null : null;
  const activeSummary = activeEvent ? summaries.get(activeEvent.id) : undefined;

  if (activeEvent && activeSummary) {
    return (
      <EventDetail
        key={activeEvent.id}
        event={activeEvent}
        summary={activeSummary}
        settings={settings}
        promoters={promoters}
        venues={venues}
        ownerPromoterId={ownerPromoterId}
        staffGroupName={staffGroupName}
        staffSummary={staffSummariesByEvent.get(activeEvent.id)}
        staffMembers={staffMembers}
        staffMemberUsageScore={staffMemberUsageScore}
        staffTableByEventTableId={staffTableByEventTableId}
        canUndo={canUndo}
        canRedo={canRedo}
        lastUndoLabel={lastUndoLabel}
        lastRedoLabel={lastRedoLabel}
        onUndo={onUndo}
        onRedo={onRedo}
        onBack={() => onSelectEvent(null)}
        ticketSmsSyncing={ticketSmsSyncing}
        onTriggerTicketSmsSync={onTriggerTicketSmsSync}
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
        onAssignSubPrToTable={onAssignSubPrToTable}
        onQuickCreateStaffMember={onQuickCreateStaffMember}
      />
    );
  }

  const renderEventCard = (ev: FullEvent, isActive: boolean) => {
    const s = summaries.get(ev.id);
    const hasMancanti = (s?.mancantiTotal ?? 0) > 0.01;
    const venueColor = venueColorMap.get(ev.venue_name) || '#0071E3';
    const ownBusta = s?.byPromoter[ownerPromoterId]?.bustaTotal ?? 0;

    return (
      <button
        key={ev.id}
        type="button"
        onClick={() => onSelectEvent(ev.id)}
        className="apple-card w-full min-w-0 overflow-hidden px-4 py-3.5 text-left apple-press cursor-pointer hover:ring-1 hover:ring-[var(--accent)] transition-[box-shadow,transform]"
        style={
          isActive
            ? {
                boxShadow: 'var(--shadow-card), inset 3px 0 0 var(--accent)',
              }
            : undefined
        }
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: venueColor }}
            />
            <span className="text-[15px] sm:text-[16px] font-semibold truncate">{ev.title}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
            {ev.is_busta_paid && (
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: 'var(--status-green)' }}
                aria-label="Busta saldata"
              />
            )}
            <span
              className="text-[15px] sm:text-[16px] font-bold"
              style={{
                color: ev.is_busta_paid ? 'var(--status-green)' : 'var(--ink-primary)',
              }}
            >
              {formatEur(s?.bustaTotal ?? 0)}
            </span>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px] tabular-nums">
          <div
            className="min-w-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <span className="shrink-0">{formatDateDayMonth(ev.event_date)}</span>
            <span className="shrink-0">·</span>
            <span className="truncate">{ev.venue_name}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">{formatInt(s?.pxTotal ?? 0)} px</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasMancanti ? (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  backgroundColor: 'var(--status-red-bg)',
                  color: 'var(--status-red)',
                }}
              >
                -{formatEur(s?.mancantiTotal ?? 0)}
              </span>
            ) : ownBusta > 0.01 ? (
              <span className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                Tua {formatEur(ownBusta, true)}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Serate</h1>

        <div className="flex items-center gap-2">
          {onTriggerTicketSmsSync && (
            <button
              type="button"
              disabled={ticketSmsSyncing}
              onClick={() => onTriggerTicketSmsSync()}
              title="Aggiorna manualmente i dati da TicketSMS"
              className="inline-flex items-center gap-1.5 rounded-[11px] px-3 sm:px-3.5 py-2 text-[13px] sm:text-[14px] font-semibold apple-surface apple-press cursor-pointer disabled:opacity-60"
              style={{ color: 'var(--accent)' }}
            >
              <RefreshCw
                className={`h-4 w-4 ${ticketSmsSyncing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">
                {ticketSmsSyncing ? 'Aggiornamento…' : 'Aggiorna TicketSMS'}
              </span>
              <span className="sm:hidden">{ticketSmsSyncing ? 'Sync…' : 'TicketSMS'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenNewEvent}
            className="inline-flex items-center gap-1.5 rounded-[11px] px-3.5 sm:px-4 py-2 text-[13px] sm:text-[14px] font-semibold text-white apple-press cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuova serata
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 sm:max-w-[340px]">
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
            className="apple-input w-full rounded-[11px] pl-9 pr-8 py-2 text-[16px] md:text-[14px]"
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

        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Filtra per locale"
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
            className="apple-input apple-select rounded-[9px] pl-3 pr-8 py-1.5 min-h-[36px] md:min-h-[34px] text-[16px] md:text-[13px] font-medium cursor-pointer"
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
            aria-pressed={statusFilter === 'OPEN_MANCANTI'}
            onClick={() =>
              setStatusFilter((s) => (s === 'OPEN_MANCANTI' ? 'ALL' : 'OPEN_MANCANTI'))
            }
            className="inline-flex items-center rounded-[9px] px-3 py-1.5 min-h-[36px] md:min-h-[34px] text-[13px] font-medium whitespace-nowrap apple-press cursor-pointer transition-colors"
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
            aria-pressed={statusFilter === 'UNPAID_BUSTA'}
            onClick={() =>
              setStatusFilter((s) => (s === 'UNPAID_BUSTA' ? 'ALL' : 'UNPAID_BUSTA'))
            }
            className="inline-flex items-center rounded-[9px] px-3 py-1.5 min-h-[36px] md:min-h-[34px] text-[13px] font-medium whitespace-nowrap apple-press cursor-pointer transition-colors"
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

      {/* Exclusively Active vs Past Events */}
      {activeEvents.length === 0 && pastEvents.length === 0 ? (
        <div className="apple-card p-12 text-center">
          <CalendarDays
            className="h-9 w-9 mx-auto mb-2.5"
            style={{ color: 'var(--ink-tertiary)' }}
            aria-hidden="true"
          />
          <p className="text-[16px] font-semibold">Nessuna serata trovata</p>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            Modifica i filtri o crea una nuova serata.
          </p>
          {(search.trim() !== '' || venueFilter !== 'ALL' || statusFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setVenueFilter('ALL');
                setStatusFilter('ALL');
              }}
              className="mt-3 inline-flex items-center rounded-[10px] px-3.5 py-2 text-[13px] font-semibold apple-press cursor-pointer"
              style={{
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent)',
              }}
            >
              Resetta filtri
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {activeEvents.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 px-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: 'var(--status-green)' }}
                  aria-hidden="true"
                />
                <h2 className="text-[14px] font-semibold">
                  Serate attive ({activeEvents.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {activeEvents.map((ev) => renderEventCard(ev, true))}
              </div>
            </section>
          )}

          {pastEvents.length > 0 && (
            <section className="space-y-2.5">
              <h2
                className="px-1 text-[14px] font-semibold"
                style={{ color: 'var(--ink-secondary)' }}
              >
                Serate passate ({pastEvents.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {pastEvents.map((ev) => renderEventCard(ev, false))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
