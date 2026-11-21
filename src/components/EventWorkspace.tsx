import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Plus,
  RefreshCw,
  Search,
  Ticket,
  X,
} from 'lucide-react';
import { EventDetail } from './EventDetail';
import { formatDateDayMonth, formatEur, formatInt, formatMonthYear } from '../lib/format';
import type { useTicketSmsData } from '../hooks/useTicketSmsData';
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
  ticketSmsData,
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
  ticketSmsData: ReturnType<typeof useTicketSmsData>;
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

  const uniqueVenueNames = useMemo(
    () => Array.from(new Set(events.map((e) => e.venue_name))).sort(),
    [events]
  );

  const activeEvent = selectedEventId ? events.find((e) => e.id === selectedEventId) || null : null;
  const activeSummary = activeEvent ? summaries.get(activeEvent.id) : undefined;

  // Focused Full-Screen Event Detail (zero distracting sidebar of other events!)
  if (activeEvent && activeSummary) {
    const linkedTsEvent =
      activeEvent.ticketsms_event_id !== null
        ? ticketSmsData.eventsById.get(activeEvent.ticketsms_event_id) ?? null
        : null;
    const linkedReportRows =
      activeEvent.ticketsms_event_id !== null
        ? ticketSmsData.reportRowsByEvent.get(activeEvent.ticketsms_event_id) ?? []
        : [];
    const linkedTicketTypes =
      activeEvent.ticketsms_event_id !== null
        ? ticketSmsData.ticketTypesByEvent.get(activeEvent.ticketsms_event_id) ?? []
        : [];

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
        ticketSmsEvent={linkedTsEvent}
        ticketSmsReportRows={linkedReportRows}
        ticketSmsTicketTypes={linkedTicketTypes}
        ticketSmsSyncStatus={ticketSmsData.syncStatus}
        ticketSmsSyncing={ticketSmsData.syncing}
        ticketSmsSyncElapsedSec={ticketSmsData.syncElapsedSec}
        onTriggerTicketSmsSync={ticketSmsData.triggerManualSync}
        canUndo={canUndo}
        canRedo={canRedo}
        lastUndoLabel={lastUndoLabel}
        lastRedoLabel={lastRedoLabel}
        onUndo={onUndo}
        onRedo={onRedo}
        onBack={() => onSelectEvent(null)}
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

  const tsStatus = ticketSmsData.syncStatus;
  const showTsAlert = tsStatus?.status === 'session_expired' || tsStatus?.status === 'error';

  // Clean Full-Width Events Directory
  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Serate</h1>
          <p className="mt-0.5 text-[13px] sm:text-[14px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
            {filteredEvents.length} di {events.length} serate · tocca una serata per aprirla a schermo intero
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={ticketSmsData.syncing}
            onClick={() => ticketSmsData.triggerManualSync()}
            title="Sincronizza serate e prevendite da TicketSMS"
            className="inline-flex items-center gap-1.5 rounded-[11px] px-3.5 py-2.5 text-[13px] font-semibold apple-surface apple-press cursor-pointer disabled:opacity-70"
            style={{ color: 'var(--ink-primary)' }}
          >
            <RefreshCw
              className={`h-4 w-4 ${ticketSmsData.syncing ? 'animate-spin' : ''}`}
              style={{ color: 'var(--accent)' }}
              aria-hidden="true"
            />
            <span>
              {ticketSmsData.syncing
                ? ticketSmsData.syncElapsedSec > 0
                  ? `TicketSMS… ${ticketSmsData.syncElapsedSec}s`
                  : 'TicketSMS…'
                : 'Aggiorna TicketSMS'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenNewEvent}
            className="inline-flex items-center gap-1.5 rounded-[11px] px-4 py-2.5 text-[14px] font-semibold text-white apple-press cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuova serata
          </button>
        </div>
      </div>

      {showTsAlert && (
        <div
          role="alert"
          className="rounded-[14px] px-4 py-3 flex items-start gap-2.5 text-[13px]"
          style={{
            backgroundColor:
              tsStatus?.status === 'session_expired'
                ? 'var(--status-orange-bg)'
                : 'var(--status-red-bg)',
          }}
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0 mt-0.5"
            style={{
              color:
                tsStatus?.status === 'session_expired'
                  ? 'var(--status-orange)'
                  : 'var(--status-red)',
            }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <span
              className="font-semibold"
              style={{
                color:
                  tsStatus?.status === 'session_expired'
                    ? 'var(--status-orange)'
                    : 'var(--status-red)',
              }}
            >
              {tsStatus?.status === 'session_expired'
                ? 'Sessione TicketSMS scaduta.'
                : 'Errore ultimo aggiornamento TicketSMS.'}
            </span>{' '}
            <span style={{ color: 'var(--ink-secondary)' }}>
              {tsStatus?.message || 'Esegui aggiorna_ticketsms.bat dal PC per sincronizzare.'}
            </span>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 sm:max-w-[360px]">
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
            className="apple-input rounded-[9px] px-3 py-1.5 text-[16px] md:text-[13px] font-medium cursor-pointer"
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
            className="rounded-[9px] px-3 py-1.5 text-[13px] font-medium apple-press cursor-pointer transition-colors"
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
            className="rounded-[9px] px-3 py-1.5 text-[13px] font-medium apple-press cursor-pointer transition-colors"
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

      {/* Grouped Event Grid */}
      {groupedByMonth.length === 0 ? (
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
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByMonth.map((group) => (
            <section key={group.monthLabel} className="space-y-2.5">
              <h2
                className="px-1 text-[13px] font-semibold"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {group.monthLabel}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {group.items.map((ev) => {
                  const s = summaries.get(ev.id);
                  const ss = staffSummariesByEvent.get(ev.id);
                  const hasMancanti = (s?.mancantiTotal ?? 0) > 0.01;
                  const venueColor = venueColorMap.get(ev.venue_name) || '#0071E3';
                  const ownBusta = s?.byPromoter[ownerPromoterId]?.bustaTotal ?? 0;
                  const staffBusta = ss?.totalBusta ?? 0;
                  const ownNet = Math.round((ownBusta - staffBusta) * 100) / 100;
                  const linkedTs =
                    ev.ticketsms_event_id !== null
                      ? ticketSmsData.eventsById.get(ev.ticketsms_event_id)
                      : undefined;

                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onSelectEvent(ev.id)}
                      className="apple-card p-4 text-left apple-press cursor-pointer hover:ring-1 hover:ring-[var(--accent)] transition-[box-shadow,transform]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: venueColor }}
                            />
                            <span className="text-[16px] font-semibold truncate">{ev.title}</span>
                            {linkedTs && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0"
                                style={{
                                  backgroundColor: linkedTs.is_active
                                    ? 'var(--accent-subtle)'
                                    : 'var(--bg-surface-secondary)',
                                  color: linkedTs.is_active
                                    ? 'var(--accent)'
                                    : 'var(--ink-secondary)',
                                }}
                                title="Collegata automaticamente a TicketSMS"
                              >
                                <Ticket className="h-2.5 w-2.5" aria-hidden="true" />
                                TicketSMS
                              </span>
                            )}
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
                            <span>·</span>
                            <span className="tabular-nums">{formatInt(s?.pxTotal ?? 0)} px</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 tabular-nums">
                          <div className="text-[16px] font-bold">
                            {formatEur(s?.bustaTotal ?? 0)}
                          </div>
                          <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                            Fatt. {formatEur(s?.revenueTotal ?? 0)}
                          </div>
                        </div>
                      </div>

                      <div
                        className="mt-3 pt-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px] tabular-nums"
                        style={{ borderTop: '0.5px solid var(--separator)' }}
                      >
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                          <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                            Tua busta {formatEur(ownBusta, true)}
                          </span>
                          {staffBusta > 0.01 && (
                            <span
                              className="font-semibold"
                              style={{ color: 'var(--status-green)' }}
                            >
                              Netto {formatEur(ownNet, true)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {ev.is_busta_paid && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[11px] font-semibold"
                              style={{ color: 'var(--status-green)' }}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Pagata
                            </span>
                          )}
                          {hasMancanti && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
