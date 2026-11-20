import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CalendarDays,
  ChevronLeft,
  Clock,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
  ShoppingBag,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { SegmentedControl } from './ui/AppleControls';
import { formatDateFull, formatDateShort, formatEur, formatInt } from '../lib/format';
import type { useTicketSmsData } from '../hooks/useTicketSmsData';
import type { TicketSmsEvent } from '../types/ticketsms';

type ScopeTab = 'active' | 'past';

function formatItalianSyncTime(iso: string | null | undefined): string {
  if (!iso) return 'Mai sincronizzato';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Mai sincronizzato';

  const now = new Date();
  const fmtDay = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const fmtTime = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (fmtDay.format(d) === fmtDay.format(now)) {
    return `Oggi alle ${fmtTime.format(d)}`;
  }

  const fmtDate = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${fmtDate.format(d)}, ${fmtTime.format(d)}`;
}

function formatEventDateLabel(ev: TicketSmsEvent): string {
  if (ev.event_date) {
    return formatDateFull(ev.event_date);
  }
  const parts = [ev.weekday, ev.month, ev.year].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Data da definire';
}

function EventCover({
  url,
  alt,
  compact = false,
}: {
  url: string | null;
  alt: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div
        className={`flex items-center justify-center shrink-0 ${
          compact ? 'h-full w-full' : 'h-[140px] w-full'
        }`}
        style={{
          background: 'linear-gradient(135deg, rgba(0,113,227,0.16) 0%, rgba(88,86,214,0.22) 100%)',
        }}
      >
        <Ticket className="h-8 w-8 opacity-45" style={{ color: 'var(--accent)' }} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${compact ? 'h-full w-full' : 'h-[140px] w-full'}`}
    />
  );
}

export function TicketSmsView({
  ticketSmsData,
}: {
  ticketSmsData: ReturnType<typeof useTicketSmsData>;
}) {
  const [scope, setScope] = useState<ScopeTab>('active');
  const [search, setSearch] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const {
    loading,
    events,
    activeEvents,
    pastEvents,
    ticketTypesByEvent,
    teamSalesByEvent,
    syncStatus,
    syncing,
    syncElapsedSec,
    triggerManualSync,
  } = ticketSmsData;

  const selectedEvent = useMemo(
    () => (selectedEventId !== null ? events.find((e) => e.event_id === selectedEventId) || null : null),
    [selectedEventId, events]
  );

  const visibleEvents = useMemo(() => {
    const list = scope === 'active' ? activeEvents : pastEvents;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (ev) =>
        ev.name.toLowerCase().includes(q) ||
        (ev.location_name && ev.location_name.toLowerCase().includes(q)) ||
        (ev.location_full && ev.location_full.toLowerCase().includes(q))
    );
  }, [scope, activeEvents, pastEvents, search]);

  const isSessionExpired = syncStatus?.status === 'session_expired';
  const isSyncError = syncStatus?.status === 'error';

  // Reusable Header & Status Banner
  const renderStatusBanners = () => (
    <>
      {isSessionExpired && (
        <div
          role="alert"
          className="rounded-[14px] p-4 flex items-start gap-3"
          style={{
            backgroundColor: 'var(--status-orange-bg)',
            border: '1px solid color-mix(in srgb, var(--status-orange) 35%, transparent)',
          }}
        >
          <AlertTriangle
            className="h-5 w-5 shrink-0 mt-0.5"
            style={{ color: 'var(--status-orange)' }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-[14px] font-bold" style={{ color: 'var(--status-orange)' }}>
              Sessione TicketSMS scaduta: aggiorna il secret TICKETSMS_COOKIE su GitHub
            </div>
            {syncStatus?.message && (
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                {syncStatus.message}
              </p>
            )}
          </div>
        </div>
      )}

      {isSyncError && (
        <div
          role="alert"
          className="rounded-[14px] p-4 flex items-start gap-3"
          style={{
            backgroundColor: 'var(--status-red-bg)',
            border: '1px solid color-mix(in srgb, var(--status-red) 35%, transparent)',
          }}
        >
          <AlertTriangle
            className="h-5 w-5 shrink-0 mt-0.5"
            style={{ color: 'var(--status-red)' }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-[14px] font-bold" style={{ color: 'var(--status-red)' }}>
              Errore durante l&apos;ultima sincronizzazione TicketSMS
            </div>
            {syncStatus?.message && (
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                {syncStatus.message}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );

  const renderRefreshButton = () => (
    <button
      type="button"
      disabled={syncing}
      onClick={() => triggerManualSync()}
      className="inline-flex items-center justify-center gap-2 rounded-[11px] px-4 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer disabled:opacity-70 shrink-0"
      style={{ backgroundColor: 'var(--accent)' }}
    >
      <RefreshCw
        className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <span>
        {syncing
          ? syncElapsedSec > 0
            ? `Aggiornamento in corso… (${syncElapsedSec}s)`
            : 'Aggiornamento in corso…'
          : 'Aggiorna ora'}
      </span>
    </button>
  );

  // ============ FOCUSED EVENT DETAIL VIEW ============
  if (selectedEvent) {
    const types = ticketTypesByEvent.get(selectedEvent.event_id) || [];
    const team = teamSalesByEvent.get(selectedEvent.event_id) || [];

    const typesTotals = types.reduce(
      (acc, t) => ({
        sold: acc.sold + t.sold,
        entered: acc.entered + t.entered,
        total: acc.total + t.total,
        onlineSold: acc.onlineSold + t.online_sold,
        onlineTotal: acc.onlineTotal + t.online_total,
        otoSold: acc.otoSold + t.one_to_one_sold,
        otoTotal: acc.otoTotal + t.one_to_one_total,
        boxSold: acc.boxSold + t.box_office_sold,
        boxTotal: acc.boxTotal + t.box_office_total,
      }),
      {
        sold: 0,
        entered: 0,
        total: 0,
        onlineSold: 0,
        onlineTotal: 0,
        otoSold: 0,
        otoTotal: 0,
        boxSold: 0,
        boxTotal: 0,
      }
    );

    const maxPrSold = team.length > 0 ? Math.max(1, team[0].sold) : 1;
    const enteredPct =
      selectedEvent.tickets_sent > 0
        ? Math.min(100, Math.round((selectedEvent.entered / selectedEvent.tickets_sent) * 100))
        : 0;

    return (
      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 lg:px-8 pt-4 pb-28 lg:pb-12 space-y-5">
        {/* Top Navigation + Sync Action */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSelectedEventId(null)}
              className="-ml-1.5 inline-flex items-center gap-0.5 rounded-[10px] px-2.5 py-1.5 text-[14px] font-semibold apple-press cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--accent)' }}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Serate TicketSMS
            </button>
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[12px]"
              style={{ color: 'var(--ink-tertiary)' }}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatItalianSyncTime(syncStatus?.synced_at ?? selectedEvent.synced_at)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedEvent.dash_url && (
              <a
                href={selectedEvent.dash_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-semibold apple-surface apple-press"
                style={{ color: 'var(--ink-primary)' }}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Dashboard
              </a>
            )}
            {selectedEvent.shop_url && (
              <a
                href={selectedEvent.shop_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-semibold apple-surface apple-press"
                style={{ color: 'var(--ink-primary)' }}
              >
                <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                Shop
              </a>
            )}
            {renderRefreshButton()}
          </div>
        </div>

        {renderStatusBanners()}

        {/* Hero Event Banner */}
        <section className="apple-card overflow-hidden">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-[280px] h-[165px] md:h-auto shrink-0 overflow-hidden">
              <EventCover url={selectedEvent.cover_image_url} alt={selectedEvent.name} compact />
            </div>

            <div className="flex-1 min-w-0 p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      backgroundColor: selectedEvent.is_canceled
                        ? 'var(--status-red-bg)'
                        : selectedEvent.is_active
                          ? 'var(--status-green-bg)'
                          : 'var(--bg-surface-secondary)',
                      color: selectedEvent.is_canceled
                        ? 'var(--status-red)'
                        : selectedEvent.is_active
                          ? 'var(--status-green)'
                          : 'var(--ink-secondary)',
                    }}
                  >
                    {selectedEvent.is_canceled
                      ? 'Annullata'
                      : selectedEvent.is_active
                        ? 'Attiva'
                        : 'Passata'}
                  </span>
                  {selectedEvent.time_to_end && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: 'var(--accent-subtle)',
                        color: 'var(--accent)',
                      }}
                    >
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {selectedEvent.time_to_end}
                    </span>
                  )}
                </div>

                <h1 className="text-[22px] sm:text-[28px] font-bold tracking-tight">
                  {selectedEvent.name}
                </h1>
                <div
                  className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatEventDateLabel(selectedEvent)}
                  </span>
                  {(selectedEvent.location_full || selectedEvent.location_name) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {selectedEvent.location_full || selectedEvent.location_name}
                    </span>
                  )}
                </div>
              </div>

              {/* 4 Event KPIs */}
              <div
                className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3"
                style={{ borderTop: '0.5px solid var(--separator)' }}
              >
                <div className="tabular-nums">
                  <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                    Venduti
                  </div>
                  <div className="mt-0.5 text-[22px] font-bold leading-tight">
                    {formatInt(selectedEvent.tickets_sent)}
                  </div>
                </div>
                <div className="tabular-nums">
                  <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                    Incasso totale
                  </div>
                  <div
                    className="mt-0.5 text-[22px] font-bold leading-tight whitespace-nowrap"
                    style={{ color: 'var(--accent)' }}
                  >
                    {formatEur(selectedEvent.total_profit, true)}
                  </div>
                </div>
                <div className="tabular-nums">
                  <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                    Entrati
                  </div>
                  <div className="mt-0.5 text-[22px] font-bold leading-tight">
                    {formatInt(selectedEvent.entered)}
                    {selectedEvent.tickets_sent > 0 && (
                      <span
                        className="ml-1.5 text-[12px] font-semibold"
                        style={{ color: 'var(--status-green)' }}
                      >
                        {enteredPct}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="tabular-nums">
                  <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                    Tipologie / PR
                  </div>
                  <div className="mt-0.5 text-[16px] font-bold leading-snug">
                    {types.length} tip. · {team.length} PR
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION A: PREVENDITE PER TIPOLOGIA */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[18px] font-semibold tracking-tight">
              Prevendite per tipologia ({types.length})
            </h2>
          </div>

          {types.length === 0 ? (
            <div className="apple-card p-8 text-center text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              Nessuna tipologia di biglietto sincronizzata per questa serata.
            </div>
          ) : (
            <>
              {/* Mobile Stacked Cards (Zero horizontal overflow) */}
              <div className="md:hidden space-y-2.5">
                {types.map((t) => (
                  <div key={t.id} className="apple-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold">{t.name}</div>
                        {t.description && (
                          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                            {t.description}
                          </div>
                        )}
                        <div className="mt-1 text-[12px] tabular-nums" style={{ color: 'var(--ink-tertiary)' }}>
                          Prezzo {formatEur(t.price, true)} · Entrati {formatInt(t.entered)}/{formatInt(t.sold)}
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-[16px] font-bold">{formatEur(t.total, true)}</div>
                        <div className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                          {formatInt(t.sold)} venduti
                        </div>
                      </div>
                    </div>

                    <div
                      className="grid grid-cols-3 gap-2 pt-2.5 text-center tabular-nums"
                      style={{ borderTop: '0.5px solid var(--separator)' }}
                    >
                      <div
                        className="rounded-[10px] py-2 px-1.5"
                        style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                      >
                        <div className="text-[10px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                          Online
                        </div>
                        <div className="text-[14px] font-bold">{formatInt(t.online_sold)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {formatEur(t.online_total)}
                        </div>
                      </div>
                      <div
                        className="rounded-[10px] py-2 px-1.5"
                        style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                      >
                        <div className="text-[10px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                          One to One
                        </div>
                        <div className="text-[14px] font-bold">{formatInt(t.one_to_one_sold)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {formatEur(t.one_to_one_total)}
                        </div>
                      </div>
                      <div
                        className="rounded-[10px] py-2 px-1.5"
                        style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                      >
                        <div className="text-[10px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                          Cassa
                        </div>
                        <div className="text-[14px] font-bold">{formatInt(t.box_office_sold)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {formatEur(t.box_office_total)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block apple-card overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[780px]">
                  <thead>
                    <tr
                      className="text-[12px] font-medium"
                      style={{
                        color: 'var(--ink-secondary)',
                        borderBottom: '0.5px solid var(--separator)',
                      }}
                    >
                      <th className="py-3 pl-4 pr-3 font-medium">Tipologia</th>
                      <th className="py-3 px-2.5 text-right font-medium">Prezzo</th>
                      <th className="py-3 px-2.5 text-right font-medium">Venduti / Entrati</th>
                      <th className="py-3 px-2.5 text-right font-medium">Online</th>
                      <th className="py-3 px-2.5 text-right font-medium">One to One</th>
                      <th className="py-3 px-2.5 text-right font-medium">Cassa</th>
                      <th className="py-3 pl-2.5 pr-4 text-right font-medium">Totale €</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--separator)] text-[14px] tabular-nums">
                    {types.map((t) => (
                      <tr key={t.id} className="hover:bg-[var(--bg-hover)]">
                        <td className="py-3 pl-4 pr-3">
                          <div className="font-semibold">{t.name}</div>
                          {t.description && (
                            <div className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                              {t.description}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-2.5 text-right whitespace-nowrap">
                          {formatEur(t.price, true)}
                        </td>
                        <td className="py-3 px-2.5 text-right whitespace-nowrap">
                          <span className="font-bold">{formatInt(t.sold)}</span>
                          <span className="mx-1 opacity-40">/</span>
                          <span style={{ color: 'var(--ink-secondary)' }}>
                            {formatInt(t.entered)}
                          </span>
                        </td>
                        <td className="py-3 px-2.5 text-right whitespace-nowrap">
                          <div className="font-medium">{formatInt(t.online_sold)}</div>
                          <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                            {formatEur(t.online_total)}
                          </div>
                        </td>
                        <td className="py-3 px-2.5 text-right whitespace-nowrap">
                          <div className="font-medium">{formatInt(t.one_to_one_sold)}</div>
                          <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                            {formatEur(t.one_to_one_total)}
                          </div>
                        </td>
                        <td className="py-3 px-2.5 text-right whitespace-nowrap">
                          <div className="font-medium">{formatInt(t.box_office_sold)}</div>
                          <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                            {formatEur(t.box_office_total)}
                          </div>
                        </td>
                        <td className="py-3 pl-2.5 pr-4 text-right font-bold whitespace-nowrap">
                          {formatEur(t.total, true)}
                        </td>
                      </tr>
                    ))}
                    <tr
                      className="font-bold"
                      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                    >
                      <td className="py-3 pl-4 pr-3">Totale</td>
                      <td className="py-3 px-2.5 text-right">—</td>
                      <td className="py-3 px-2.5 text-right whitespace-nowrap">
                        {formatInt(typesTotals.sold)} / {formatInt(typesTotals.entered)}
                      </td>
                      <td className="py-3 px-2.5 text-right whitespace-nowrap">
                        <div>{formatInt(typesTotals.onlineSold)}</div>
                        <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                          {formatEur(typesTotals.onlineTotal)}
                        </div>
                      </td>
                      <td className="py-3 px-2.5 text-right whitespace-nowrap">
                        <div>{formatInt(typesTotals.otoSold)}</div>
                        <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                          {formatEur(typesTotals.otoTotal)}
                        </div>
                      </td>
                      <td className="py-3 px-2.5 text-right whitespace-nowrap">
                        <div>{formatInt(typesTotals.boxSold)}</div>
                        <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                          {formatEur(typesTotals.boxTotal)}
                        </div>
                      </td>
                      <td
                        className="py-3 pl-2.5 pr-4 text-right whitespace-nowrap"
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatEur(typesTotals.total, true)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* SECTION B: CLASSIFICA TEAM / PR */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2 px-1">
            <Award className="h-4 w-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <h2 className="text-[18px] font-semibold tracking-tight">
              Classifica Team / PR ({team.length})
            </h2>
          </div>

          {team.length === 0 ? (
            <div className="apple-card p-8 text-center text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              Nessuna vendita team/PR sincronizzata per questa serata.
            </div>
          ) : (
            <div className="apple-card overflow-hidden divide-y divide-[var(--separator)]">
              {team.map((row, idx) => {
                const barPct = Math.max(4, Math.round((row.sold / maxPrSold) * 100));
                return (
                  <div
                    key={row.id}
                    className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    style={
                      row.is_self
                        ? {
                            backgroundColor: 'var(--accent-subtle)',
                            boxShadow: 'inset 3px 0 0 var(--accent)',
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className="w-7 text-center text-[13px] font-bold tabular-nums shrink-0"
                        style={{
                          color: idx < 3 || row.is_self ? 'var(--accent)' : 'var(--ink-tertiary)',
                        }}
                      >
                        #{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[15px] font-semibold truncate">{row.pr_name}</span>
                          {row.is_self && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                              style={{ backgroundColor: 'var(--accent)' }}
                            >
                              Tu
                            </span>
                          )}
                          {row.sub_pr_count > 0 && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--ink-secondary)',
                              }}
                            >
                              <Users className="h-3 w-3" aria-hidden="true" />
                              {row.sub_pr_count} sotto-PR
                            </span>
                          )}
                        </div>
                        {/* Subtle visual sales proportion bar */}
                        <div
                          className="mt-1.5 h-1.5 w-full max-w-[260px] rounded-full overflow-hidden"
                          style={{
                            backgroundColor: row.is_self
                              ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                              : 'var(--bg-surface-secondary)',
                          }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${barPct}%`,
                              backgroundColor: row.is_self ? 'var(--accent)' : 'var(--ink-tertiary)',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-5 pl-10 sm:pl-0 tabular-nums shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                          Venduti
                        </div>
                        <div className="text-[16px] font-bold">{formatInt(row.sold)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                          Entrati
                        </div>
                        <div className="text-[15px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                          {formatInt(row.entered)}
                        </div>
                      </div>
                      <div className="text-right min-w-[82px]">
                        <div className="text-[10px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                          Incasso
                        </div>
                        <div
                          className="text-[16px] font-bold whitespace-nowrap"
                          style={{ color: row.is_self ? 'var(--accent)' : 'var(--ink-primary)' }}
                        >
                          {formatEur(row.total, true)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  // ============ TICKETSMS EVENTS DIRECTORY ============
  return (
    <div className="mx-auto w-full max-w-[1060px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-5">
      {/* Header + Last Sync Timestamp + Manual Sync Button */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">TicketSMS</h1>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{
                backgroundColor: isSessionExpired
                  ? 'var(--status-orange-bg)'
                  : isSyncError
                    ? 'var(--status-red-bg)'
                    : 'var(--bg-surface-secondary)',
                color: isSessionExpired
                  ? 'var(--status-orange)'
                  : isSyncError
                    ? 'var(--status-red)'
                    : 'var(--ink-secondary)',
              }}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              Ultimo sync: {formatItalianSyncTime(syncStatus?.synced_at)}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] sm:text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            Dati prevendite, tipologie e classifica PR sincronizzati automaticamente da TicketSMS.
          </p>
        </div>

        {renderRefreshButton()}
      </div>

      {renderStatusBanners()}

      {/* Active / Past Toggle + Live Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl<ScopeTab>
          ariaLabel="Stato serate TicketSMS"
          value={scope}
          onChange={setScope}
          className="w-full sm:w-auto"
          options={[
            { value: 'active', label: `Serate attive (${activeEvents.length})` },
            { value: 'past', label: `Serate passate (${pastEvents.length})` },
          ]}
        />

        <div className="relative flex-1 sm:max-w-[300px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
            style={{ color: 'var(--ink-tertiary)' }}
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca evento o locale…"
            aria-label="Filtra eventi TicketSMS"
            className="apple-input w-full rounded-[11px] pl-9 pr-8 py-2 text-[16px] md:text-[14px]"
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
      </div>

      {/* Loading / Empty / Cards Grid */}
      {loading && events.length === 0 ? (
        <div className="apple-card p-12 flex flex-col items-center justify-center gap-3">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
          <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            Caricamento dati TicketSMS…
          </span>
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="apple-card p-10 text-center space-y-3">
          <Ticket
            className="h-10 w-10 mx-auto"
            style={{ color: 'var(--ink-tertiary)' }}
            aria-hidden="true"
          />
          <div>
            <h2 className="text-[17px] font-semibold">
              {events.length === 0
                ? 'Nessuna serata TicketSMS ancora sincronizzata'
                : scope === 'active'
                  ? 'Nessuna serata attiva trovata'
                  : 'Nessuna serata passata trovata'}
            </h2>
            <p className="mt-1 text-[13px] max-w-md mx-auto" style={{ color: 'var(--ink-secondary)' }}>
              {events.length === 0
                ? 'Premi “Aggiorna ora” per avviare il primo sync da GitHub Actions oppure attendi la prossima sincronizzazione automatica.'
                : scope === 'active' && pastEvents.length > 0
                  ? `Ci sono ${pastEvents.length} serate nello storico delle serate passate.`
                  : 'Prova a cambiare la ricerca o il filtro.'}
            </p>
          </div>
          {scope === 'active' && pastEvents.length > 0 && !search && (
            <button
              type="button"
              onClick={() => setScope('past')}
              className="inline-flex items-center gap-1 rounded-[10px] px-4 py-2 text-[13px] font-semibold apple-press cursor-pointer"
              style={{
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent)',
              }}
            >
              Vedi serate passate ({pastEvents.length})
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleEvents.map((ev) => {
            const typesCount = (ticketTypesByEvent.get(ev.event_id) || []).length;
            const teamCount = (teamSalesByEvent.get(ev.event_id) || []).length;
            const enteredPct =
              ev.tickets_sent > 0
                ? Math.min(100, Math.round((ev.entered / ev.tickets_sent) * 100))
                : 0;

            return (
              <button
                key={ev.event_id}
                type="button"
                onClick={() => setSelectedEventId(ev.event_id)}
                className="apple-card overflow-hidden text-left apple-press cursor-pointer hover:ring-1 hover:ring-[var(--accent)] transition-[box-shadow,transform] flex flex-col"
              >
                {/* Cover Image with floating status chips */}
                <div className="relative w-full h-[140px] overflow-hidden">
                  <EventCover url={ev.cover_image_url} alt={ev.name} />
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    {ev.is_canceled && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
                        style={{ backgroundColor: '#FF3B30' }}
                      >
                        Annullata
                      </span>
                    )}
                    {ev.time_to_end && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur-md"
                        style={{
                          backgroundColor: 'rgba(0, 0, 0, 0.58)',
                          color: '#FFFFFF',
                        }}
                      >
                        {ev.time_to_end}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <h2 className="text-[17px] font-bold tracking-tight line-clamp-1">
                      {ev.name}
                    </h2>
                    <div
                      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      <span className="tabular-nums">
                        {ev.event_date ? formatDateShort(ev.event_date) : formatEventDateLabel(ev)}
                      </span>
                      {ev.location_name && (
                        <>
                          <span>·</span>
                          <span className="truncate">{ev.location_name}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* KPI Row */}
                  <div
                    className="grid grid-cols-3 gap-2 pt-3 tabular-nums"
                    style={{ borderTop: '0.5px solid var(--separator)' }}
                  >
                    <div>
                      <div className="text-[10px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                        Venduti
                      </div>
                      <div className="text-[16px] font-bold">{formatInt(ev.tickets_sent)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                        Incasso
                      </div>
                      <div
                        className="text-[16px] font-bold whitespace-nowrap"
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatEur(ev.total_profit)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                        Entrati
                      </div>
                      <div className="text-[16px] font-bold">
                        {formatInt(ev.entered)}
                        {ev.tickets_sent > 0 && (
                          <span
                            className="ml-1 text-[11px] font-semibold"
                            style={{ color: 'var(--status-green)' }}
                          >
                            {enteredPct}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center justify-between text-[11px]"
                    style={{ color: 'var(--ink-tertiary)' }}
                  >
                    <span>
                      {typesCount} tipologie · {teamCount} PR in classifica
                    </span>
                    <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                      Dettagli →
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
