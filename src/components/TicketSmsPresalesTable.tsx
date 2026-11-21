import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  Ticket,
  X,
} from 'lucide-react';
import { SegmentedControl } from './ui/AppleControls';
import { formatEur, formatInt } from '../lib/format';
import type {
  TicketSmsEvent,
  TicketSmsReportRow,
  TicketSmsSyncStatus,
  TicketSmsTicketType,
} from '../types/ticketsms';

type ReportViewMode = 'full' | 'by_pr' | 'by_type';

function formatSyncTimestamp(iso: string | null | undefined): string {
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
    return `Oggi ${fmtTime.format(d)}`;
  }

  const fmtDate = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
  });
  return `${fmtDate.format(d)}, ${fmtTime.format(d)}`;
}

function formatCsvItNum(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

function escapeCsvCell(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function isSelfPromoter(name: string): boolean {
  const low = name.trim().toLowerCase();
  return low === 'io' || low === 'me';
}

export function TicketSmsPresalesTable({
  eventTitle,
  tsEvent,
  reportRows,
  ticketTypes,
  syncStatus,
  syncing,
  syncElapsedSec,
  onTriggerSync,
}: {
  eventTitle: string;
  tsEvent: TicketSmsEvent;
  reportRows: TicketSmsReportRow[];
  ticketTypes: TicketSmsTicketType[];
  syncStatus: TicketSmsSyncStatus | null;
  syncing: boolean;
  syncElapsedSec: number;
  onTriggerSync: () => Promise<void>;
}) {
  const [viewMode, setViewMode] = useState<ReportViewMode>('full');
  const [showZeroRows, setShowZeroRows] = useState(false);
  const [search, setSearch] = useState('');

  // Overall totals computed straight from the downloaded CSV/XLS rows (with event dashboard fallback)
  const totals = useMemo(() => {
    if (reportRows.length === 0) {
      return {
        onlineQty: ticketTypes.reduce((a, t) => a + t.online_sold, 0),
        onlineRev: ticketTypes.reduce((a, t) => a + t.online_total, 0),
        otoQty: ticketTypes.reduce((a, t) => a + t.one_to_one_sold, 0),
        otoRev: ticketTypes.reduce((a, t) => a + t.one_to_one_total, 0),
        boxQty: ticketTypes.reduce((a, t) => a + t.box_office_sold, 0),
        boxRev: ticketTypes.reduce((a, t) => a + t.box_office_total, 0),
        totalQty: tsEvent.tickets_sent,
        totalRev: tsEvent.total_profit,
      };
    }

    return reportRows.reduce(
      (acc, r) => ({
        onlineQty: acc.onlineQty + r.online_qty,
        onlineRev: Math.round((acc.onlineRev + r.online_revenue) * 100) / 100,
        otoQty: acc.otoQty + r.one_to_one_qty,
        otoRev: Math.round((acc.otoRev + r.one_to_one_revenue) * 100) / 100,
        boxQty: acc.boxQty + r.box_office_qty,
        boxRev: Math.round((acc.boxRev + r.box_office_revenue) * 100) / 100,
        totalQty: acc.totalQty + r.total_qty,
        totalRev: Math.round((acc.totalRev + r.total_revenue) * 100) / 100,
      }),
      {
        onlineQty: 0,
        onlineRev: 0,
        otoQty: 0,
        otoRev: 0,
        boxQty: 0,
        boxRev: 0,
        totalQty: 0,
        totalRev: 0,
      }
    );
  }, [reportRows, ticketTypes, tsEvent]);

  const nonZeroCount = useMemo(
    () =>
      reportRows.filter(
        (r) =>
          r.total_qty > 0 ||
          r.total_revenue > 0 ||
          r.online_qty > 0 ||
          r.one_to_one_qty > 0 ||
          r.box_office_qty > 0
      ).length,
    [reportRows]
  );

  const zeroRowsCount = reportRows.length - nonZeroCount;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reportRows.filter((r) => {
      const hasNumbers =
        r.total_qty > 0 ||
        r.total_revenue > 0 ||
        r.online_qty > 0 ||
        r.one_to_one_qty > 0 ||
        r.box_office_qty > 0;
      if (!showZeroRows && nonZeroCount > 0 && !hasNumbers) return false;
      if (q) {
        return (
          r.promoter_name.toLowerCase().includes(q) ||
          r.ticket_type.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [reportRows, showZeroRows, nonZeroCount, search]);

  // Aggregated by Promoter (Per PR)
  const promoterSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        promoterName: string;
        onlineQty: number;
        onlineRev: number;
        otoQty: number;
        otoRev: number;
        boxQty: number;
        boxRev: number;
        totalQty: number;
        totalRev: number;
        rows: TicketSmsReportRow[];
      }
    >();

    for (const r of reportRows) {
      const key = r.promoter_name.toLowerCase();
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          promoterName: r.promoter_name,
          onlineQty: 0,
          onlineRev: 0,
          otoQty: 0,
          otoRev: 0,
          boxQty: 0,
          boxRev: 0,
          totalQty: 0,
          totalRev: 0,
          rows: [],
        };
        map.set(key, bucket);
      }
      bucket.onlineQty += r.online_qty;
      bucket.onlineRev = Math.round((bucket.onlineRev + r.online_revenue) * 100) / 100;
      bucket.otoQty += r.one_to_one_qty;
      bucket.otoRev = Math.round((bucket.otoRev + r.one_to_one_revenue) * 100) / 100;
      bucket.boxQty += r.box_office_qty;
      bucket.boxRev = Math.round((bucket.boxRev + r.box_office_revenue) * 100) / 100;
      bucket.totalQty += r.total_qty;
      bucket.totalRev = Math.round((bucket.totalRev + r.total_revenue) * 100) / 100;
      bucket.rows.push(r);
    }

    const q = search.trim().toLowerCase();
    return Array.from(map.values())
      .filter((p) => {
        if (!showZeroRows && nonZeroCount > 0 && p.totalQty === 0 && p.totalRev === 0) {
          return false;
        }
        if (q) return p.promoterName.toLowerCase().includes(q);
        return true;
      })
      .sort((a, b) => b.totalQty - a.totalQty || b.totalRev - a.totalRev);
  }, [reportRows, showZeroRows, nonZeroCount, search]);

  // Grouped filtered rows for mobile Dettaglio XLS view
  const mobileGroupedByPr = useMemo(() => {
    const groups: {
      promoterName: string;
      totalQty: number;
      totalRev: number;
      otoRev: number;
      rows: TicketSmsReportRow[];
    }[] = [];
    const byName = new Map<string, (typeof groups)[number]>();

    for (const r of filteredRows) {
      const key = r.promoter_name.toLowerCase();
      let g = byName.get(key);
      if (!g) {
        g = {
          promoterName: r.promoter_name,
          totalQty: 0,
          totalRev: 0,
          otoRev: 0,
          rows: [],
        };
        byName.set(key, g);
        groups.push(g);
      }
      g.totalQty += r.total_qty;
      g.totalRev = Math.round((g.totalRev + r.total_revenue) * 100) / 100;
      g.otoRev = Math.round((g.otoRev + r.one_to_one_revenue) * 100) / 100;
      g.rows.push(r);
    }

    return groups;
  }, [filteredRows]);

  // Aggregated by Ticket Type (enriched with entered count from ticketTypes if available)
  const typeSummary = useMemo(() => {
    const enteredByName = new Map<string, number>();
    for (const tt of ticketTypes) {
      enteredByName.set(tt.name.trim().toLowerCase(), tt.entered);
    }

    if (reportRows.length === 0) {
      return ticketTypes.map((tt) => ({
        key: tt.id,
        name: tt.name,
        price: tt.price,
        onlineQty: tt.online_sold,
        onlineRev: tt.online_total,
        otoQty: tt.one_to_one_sold,
        otoRev: tt.one_to_one_total,
        boxQty: tt.box_office_sold,
        boxRev: tt.box_office_total,
        totalQty: tt.sold,
        totalRev: tt.total,
        entered: tt.entered,
      }));
    }

    const map = new Map<
      string,
      {
        key: string;
        name: string;
        price: number;
        onlineQty: number;
        onlineRev: number;
        otoQty: number;
        otoRev: number;
        boxQty: number;
        boxRev: number;
        totalQty: number;
        totalRev: number;
        entered: number | null;
      }
    >();

    for (const r of reportRows) {
      const key = `${r.ticket_type.toLowerCase()}__${r.price.toFixed(2)}`;
      let bucket = map.get(key);
      if (!bucket) {
        const ent = enteredByName.get(r.ticket_type.trim().toLowerCase());
        bucket = {
          key,
          name: r.ticket_type,
          price: r.price,
          onlineQty: 0,
          onlineRev: 0,
          otoQty: 0,
          otoRev: 0,
          boxQty: 0,
          boxRev: 0,
          totalQty: 0,
          totalRev: 0,
          entered: ent !== undefined ? ent : null,
        };
        map.set(key, bucket);
      }
      bucket.onlineQty += r.online_qty;
      bucket.onlineRev = Math.round((bucket.onlineRev + r.online_revenue) * 100) / 100;
      bucket.otoQty += r.one_to_one_qty;
      bucket.otoRev = Math.round((bucket.otoRev + r.one_to_one_revenue) * 100) / 100;
      bucket.boxQty += r.box_office_qty;
      bucket.boxRev = Math.round((bucket.boxRev + r.box_office_revenue) * 100) / 100;
      bucket.totalQty += r.total_qty;
      bucket.totalRev = Math.round((bucket.totalRev + r.total_revenue) * 100) / 100;
    }

    return Array.from(map.values()).filter((t) => {
      if (!showZeroRows && nonZeroCount > 0 && t.totalQty === 0 && t.totalRev === 0) {
        return false;
      }
      return true;
    });
  }, [reportRows, ticketTypes, showZeroRows, nonZeroCount]);

  const handleDownloadCsv = () => {
    if (reportRows.length === 0) return;
    const header = [
      'Promoter',
      'Tipologia',
      'Prezzo',
      'Online',
      'Incasso Online',
      'One to One',
      'Incasso One To One',
      'Cassa',
      'Incasso Cassa',
      'Totale',
      'Incasso',
    ];
    const lines = [
      header.map(escapeCsvCell).join(';'),
      ...reportRows.map((r) =>
        [
          r.promoter_name,
          r.ticket_type,
          formatCsvItNum(r.price),
          String(r.online_qty),
          formatCsvItNum(r.online_revenue),
          String(r.one_to_one_qty),
          formatCsvItNum(r.one_to_one_revenue),
          String(r.box_office_qty),
          formatCsvItNum(r.box_office_revenue),
          String(r.total_qty),
          formatCsvItNum(r.total_revenue),
        ]
          .map(escapeCsvCell)
          .join(';')
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (tsEvent.name || eventTitle).replace(/[\\/:*?"<>|]+/g, '-');
    a.download = `${safeName} - TicketSMS.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasCassa = totals.boxQty > 0 || totals.boxRev > 0;
  const isSessionExpired = syncStatus?.status === 'session_expired';
  const isSyncError = syncStatus?.status === 'error';

  return (
    <div className="mt-4 apple-surface rounded-[16px] overflow-hidden">
      {/* Top Bar: Title + Sync Timestamp + Actions */}
      <div
        className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-2.5"
        style={{ borderBottom: '0.5px solid var(--separator)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Ticket className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <h3 className="text-[15px] font-semibold tracking-tight">
              Report TicketSMS
            </h3>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: tsEvent.is_active
                  ? 'var(--status-green-bg)'
                  : 'var(--bg-surface-secondary)',
                color: tsEvent.is_active ? 'var(--status-green)' : 'var(--ink-secondary)',
              }}
            >
              {tsEvent.is_active ? 'Attiva' : 'Chiusa'}
            </span>
            <span
              className="inline-flex items-center gap-1 text-[11px]"
              style={{ color: 'var(--ink-tertiary)' }}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              {formatSyncTimestamp(tsEvent.synced_at ?? syncStatus?.synced_at)}
            </span>
          </div>
          {tsEvent.name && tsEvent.name.toLowerCase() !== eventTitle.toLowerCase() && (
            <p className="mt-0.5 text-[12px] truncate" style={{ color: 'var(--ink-secondary)' }}>
              {tsEvent.name}
              {tsEvent.location_name ? ` · ${tsEvent.location_name}` : ''}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {tsEvent.dash_url && (
            <a
              href={tsEvent.dash_url}
              target="_blank"
              rel="noopener noreferrer"
              title="Apri su my.ticketsms.it"
              className="inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-medium apple-press cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-primary)',
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">TicketSMS</span>
            </a>
          )}

          {reportRows.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadCsv}
              title="Scarica file Excel / CSV"
              className="inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-medium apple-press cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-primary)',
              }}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>CSV</span>
            </button>
          )}

          <button
            type="button"
            disabled={syncing}
            onClick={() => onTriggerSync()}
            className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer disabled:opacity-70"
            style={{
              backgroundColor: 'var(--accent-subtle)',
              color: 'var(--accent)',
            }}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>
              {syncing
                ? syncElapsedSec > 0
                  ? `Aggiorno… ${syncElapsedSec}s`
                  : 'Aggiorno…'
                : 'Aggiorna'}
            </span>
          </button>
        </div>
      </div>

      {/* Sync Warning / Error Banner (only when needed) */}
      {(isSessionExpired || isSyncError) && (
        <div
          role="alert"
          className="px-4 py-2.5 flex items-start gap-2.5 text-[12px]"
          style={{
            backgroundColor: isSessionExpired ? 'var(--status-orange-bg)' : 'var(--status-red-bg)',
            borderBottom: '0.5px solid var(--separator)',
          }}
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0 mt-0.5"
            style={{ color: isSessionExpired ? 'var(--status-orange)' : 'var(--status-red)' }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <span
              className="font-semibold"
              style={{ color: isSessionExpired ? 'var(--status-orange)' : 'var(--status-red)' }}
            >
              {isSessionExpired
                ? 'Sessione TicketSMS scaduta.'
                : 'Ultimo aggiornamento automatico non riuscito.'}
            </span>{' '}
            <span style={{ color: 'var(--ink-secondary)' }}>
              {syncStatus?.message || 'Aggiorna da PC con aggiorna_ticketsms.bat.'}
            </span>
          </div>
        </div>
      )}

      {/* Compact Channel Summary Strip */}
      <div
        className={`grid grid-cols-2 ${hasCassa ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} divide-y sm:divide-y-0 divide-x divide-[var(--separator)] tabular-nums`}
        style={{
          backgroundColor: 'var(--bg-surface-secondary)',
          borderBottom: '0.5px solid var(--separator)',
        }}
      >
        <div className="px-3.5 py-2.5 min-w-0">
          <div className="text-[11px] truncate" style={{ color: 'var(--ink-secondary)' }}>
            Venduti
          </div>
          <div className="text-[16px] font-bold leading-snug truncate">
            {formatInt(totals.totalQty)}
            {tsEvent.entered > 0 && (
              <span
                className="ml-1.5 text-[11px] font-medium"
                style={{ color: 'var(--status-green)' }}
              >
                · {formatInt(tsEvent.entered)} entrati
              </span>
            )}
          </div>
        </div>

        <div className="px-3.5 py-2.5 min-w-0">
          <div className="text-[11px] truncate" style={{ color: 'var(--ink-secondary)' }}>
            Incasso
          </div>
          <div className="text-[16px] font-bold leading-snug truncate" style={{ color: 'var(--accent)' }}>
            {formatEur(totals.totalRev, true)}
          </div>
        </div>

        <div className="px-3.5 py-2.5 min-w-0">
          <div className="text-[11px] truncate" style={{ color: 'var(--ink-secondary)' }}>
            One to One (Scarico)
          </div>
          <div className="text-[15px] font-bold leading-snug truncate">
            {formatEur(totals.otoRev, true)}
            <span className="ml-1 text-[11px] font-normal" style={{ color: 'var(--ink-tertiary)' }}>
              ({formatInt(totals.otoQty)})
            </span>
          </div>
        </div>

        <div className="px-3.5 py-2.5 min-w-0">
          <div className="text-[11px] truncate" style={{ color: 'var(--ink-secondary)' }}>
            Online
          </div>
          <div className="text-[15px] font-bold leading-snug truncate">
            {formatEur(totals.onlineRev, true)}
            <span className="ml-1 text-[11px] font-normal" style={{ color: 'var(--ink-tertiary)' }}>
              ({formatInt(totals.onlineQty)})
            </span>
          </div>
        </div>

        {hasCassa && (
          <div className="px-3.5 py-2.5 min-w-0">
            <div className="text-[11px] truncate" style={{ color: 'var(--ink-secondary)' }}>
              Cassa
            </div>
            <div className="text-[15px] font-bold leading-snug truncate">
              {formatEur(totals.boxRev, true)}
              <span className="ml-1 text-[11px] font-normal" style={{ color: 'var(--ink-tertiary)' }}>
                ({formatInt(totals.boxQty)})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* View Switcher + Filter Controls */}
      <div
        className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        style={{ borderBottom: '0.5px solid var(--separator)' }}
      >
        <SegmentedControl<ReportViewMode>
          ariaLabel="Vista report TicketSMS"
          size="sm"
          value={viewMode}
          onChange={setViewMode}
          className="w-full sm:w-auto"
          options={[
            { value: 'full', label: 'Tabella XLS' },
            { value: 'by_pr', label: `Per PR (${promoterSummary.length})` },
            { value: 'by_type', label: 'Tipologie' },
          ]}
        />

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {viewMode !== 'by_type' && reportRows.length > 6 && (
            <div className="relative flex-1 sm:w-[190px]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
                style={{ color: 'var(--ink-tertiary)' }}
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtra PR o tipologia…"
                aria-label="Filtra righe TicketSMS"
                className="apple-input w-full rounded-[9px] pl-8 pr-7 py-1 text-[16px] md:text-[12px]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Pulisci filtro"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 cursor-pointer"
                  style={{ color: 'var(--ink-tertiary)' }}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {zeroRowsCount > 0 && nonZeroCount > 0 && (
            <button
              type="button"
              onClick={() => setShowZeroRows((v) => !v)}
              className="inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1 text-[12px] font-medium apple-press cursor-pointer whitespace-nowrap"
              style={{
                backgroundColor: showZeroRows
                  ? 'var(--accent-subtle)'
                  : 'var(--bg-surface-secondary)',
                color: showZeroRows ? 'var(--accent)' : 'var(--ink-secondary)',
              }}
            >
              {showZeroRows ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {showZeroRows ? 'Nascondi righe a 0' : `Mostra righe a 0 (${zeroRowsCount})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Empty Report State */}
      {reportRows.length === 0 && ticketTypes.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          Nessuna riga nel file TicketSMS per questa serata. Premi <strong>Aggiorna</strong> dopo il
          primo biglietto venduto.
        </div>
      ) : (
        <>
          {/* ============ VIEW 1: FULL XLS/CSV TABLE ============ */}
          {viewMode === 'full' && (
            <>
              {/* Mobile Grouped Cards (ZERO horizontal overflow!) */}
              <div className="md:hidden divide-y divide-[var(--separator)]">
                {mobileGroupedByPr.length === 0 ? (
                  <div className="p-6 text-center text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    Nessuna riga corrisponde al filtro.
                  </div>
                ) : (
                  mobileGroupedByPr.map((group) => {
                    const isSelf = isSelfPromoter(group.promoterName);
                    return (
                      <div key={group.promoterName} className="p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[14px] font-semibold truncate">
                              {group.promoterName}
                            </span>
                            {isSelf && (
                              <span
                                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shrink-0"
                                style={{ backgroundColor: 'var(--accent)' }}
                              >
                                Tu
                              </span>
                            )}
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <span className="text-[14px] font-bold">
                              {formatInt(group.totalQty)} px
                            </span>
                            <span
                              className="ml-1.5 text-[13px] font-semibold"
                              style={{ color: 'var(--accent)' }}
                            >
                              {formatEur(group.totalRev, true)}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          {group.rows.map((r) => {
                            const isZero = r.total_qty === 0 && r.total_revenue === 0;
                            return (
                              <div
                                key={r.id}
                                className="rounded-[10px] px-3 py-2 flex items-center justify-between gap-2 tabular-nums"
                                style={{
                                  backgroundColor: 'var(--bg-surface-secondary)',
                                  opacity: isZero ? 0.55 : 1,
                                }}
                              >
                                <div className="min-w-0">
                                  <div className="text-[13px] font-medium truncate">
                                    {r.ticket_type}
                                  </div>
                                  <div
                                    className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]"
                                    style={{ color: 'var(--ink-secondary)' }}
                                  >
                                    <span>{formatEur(r.price, true)}</span>
                                    {r.one_to_one_qty > 0 && (
                                      <span>
                                        1to1: {formatInt(r.one_to_one_qty)} (
                                        {formatEur(r.one_to_one_revenue)})
                                      </span>
                                    )}
                                    {r.online_qty > 0 && (
                                      <span>
                                        Online: {formatInt(r.online_qty)} (
                                        {formatEur(r.online_revenue, true)})
                                      </span>
                                    )}
                                    {r.box_office_qty > 0 && (
                                      <span>
                                        Cassa: {formatInt(r.box_office_qty)} (
                                        {formatEur(r.box_office_revenue)})
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <div className="text-[13px] font-bold">
                                    {formatInt(r.total_qty)}
                                  </div>
                                  <div
                                    className="text-[11px]"
                                    style={{ color: 'var(--ink-secondary)' }}
                                  >
                                    {formatEur(r.total_revenue, true)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop Full 11-Column TicketSMS XLS Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[880px]">
                  <thead>
                    <tr
                      className="text-[11px] font-medium whitespace-nowrap"
                      style={{
                        color: 'var(--ink-secondary)',
                        borderBottom: '0.5px solid var(--separator)',
                      }}
                    >
                      <th className="py-2.5 pl-4 pr-2 font-medium">Promoter</th>
                      <th className="py-2.5 px-2 font-medium">Tipologia</th>
                      <th className="py-2.5 px-2 text-right font-medium">Prezzo</th>
                      <th className="py-2.5 px-2 text-right font-medium">Online</th>
                      <th className="py-2.5 px-2 text-right font-medium">Inc. Online</th>
                      <th className="py-2.5 px-2 text-right font-medium">1-to-1</th>
                      <th className="py-2.5 px-2 text-right font-medium">Inc. 1-to-1</th>
                      <th className="py-2.5 px-2 text-right font-medium">Cassa</th>
                      <th className="py-2.5 px-2 text-right font-medium">Inc. Cassa</th>
                      <th className="py-2.5 px-2 text-right font-medium">Totale</th>
                      <th className="py-2.5 pl-2 pr-4 text-right font-medium">Incasso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--separator)] text-[13px] tabular-nums">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={11}
                          className="py-8 text-center text-[13px]"
                          style={{ color: 'var(--ink-secondary)' }}
                        >
                          Nessuna riga corrisponde al filtro.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r) => {
                        const isSelf = isSelfPromoter(r.promoter_name);
                        const isZero = r.total_qty === 0 && r.total_revenue === 0;
                        return (
                          <tr
                            key={r.id}
                            className="hover:bg-[var(--bg-hover)] transition-colors"
                            style={{ opacity: isZero ? 0.48 : 1 }}
                          >
                            <td className="py-2 pl-4 pr-2 font-medium whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <span>{r.promoter_name}</span>
                                {isSelf && (
                                  <span
                                    className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white leading-none"
                                    style={{ backgroundColor: 'var(--accent)' }}
                                  >
                                    Tu
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="py-2 px-2" style={{ color: 'var(--ink-secondary)' }}>
                              {r.ticket_type}
                            </td>
                            <td className="py-2 px-2 text-right whitespace-nowrap">
                              {formatEur(r.price, true)}
                            </td>
                            <td
                              className="py-2 px-2 text-right whitespace-nowrap"
                              style={{ opacity: r.online_qty === 0 ? 0.35 : 1 }}
                            >
                              {formatInt(r.online_qty)}
                            </td>
                            <td
                              className="py-2 px-2 text-right whitespace-nowrap"
                              style={{ opacity: r.online_revenue === 0 ? 0.35 : 1 }}
                            >
                              {formatEur(r.online_revenue, true)}
                            </td>
                            <td
                              className="py-2 px-2 text-right whitespace-nowrap font-medium"
                              style={{ opacity: r.one_to_one_qty === 0 ? 0.35 : 1 }}
                            >
                              {formatInt(r.one_to_one_qty)}
                            </td>
                            <td
                              className="py-2 px-2 text-right whitespace-nowrap font-medium"
                              style={{ opacity: r.one_to_one_revenue === 0 ? 0.35 : 1 }}
                            >
                              {formatEur(r.one_to_one_revenue, true)}
                            </td>
                            <td
                              className="py-2 px-2 text-right whitespace-nowrap"
                              style={{ opacity: r.box_office_qty === 0 ? 0.35 : 1 }}
                            >
                              {formatInt(r.box_office_qty)}
                            </td>
                            <td
                              className="py-2 px-2 text-right whitespace-nowrap"
                              style={{ opacity: r.box_office_revenue === 0 ? 0.35 : 1 }}
                            >
                              {formatEur(r.box_office_revenue, true)}
                            </td>
                            <td className="py-2 px-2 text-right font-bold whitespace-nowrap">
                              {formatInt(r.total_qty)}
                            </td>
                            <td
                              className="py-2 pl-2 pr-4 text-right font-bold whitespace-nowrap"
                              style={{ color: r.total_revenue > 0 ? 'var(--ink-primary)' : undefined }}
                            >
                              {formatEur(r.total_revenue, true)}
                            </td>
                          </tr>
                        );
                      })
                    )}

                    {/* Totals Footer Row */}
                    <tr
                      className="font-bold"
                      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                    >
                      <td className="py-2.5 pl-4 pr-2" colSpan={3}>
                        Totale TicketSMS
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.onlineQty)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatEur(totals.onlineRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.otoQty)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatEur(totals.otoRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.boxQty)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatEur(totals.boxRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.totalQty)}
                      </td>
                      <td
                        className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap"
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatEur(totals.totalRev, true)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ============ VIEW 2: AGGREGATED BY PROMOTER ============ */}
          {viewMode === 'by_pr' && (
            <>
              {/* Mobile PR Cards */}
              <div className="md:hidden divide-y divide-[var(--separator)] tabular-nums">
                {promoterSummary.map((p) => {
                  const isSelf = isSelfPromoter(p.promoterName);
                  return (
                    <div key={p.promoterName} className="p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[14px] font-semibold truncate">
                            {p.promoterName}
                          </span>
                          {isSelf && (
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
                              style={{ backgroundColor: 'var(--accent)' }}
                            >
                              Tu
                            </span>
                          )}
                        </div>
                        <span className="text-[15px] font-bold shrink-0">
                          {formatInt(p.totalQty)} preve
                        </span>
                      </div>
                      <div
                        className="grid grid-cols-3 gap-2 rounded-[10px] p-2 text-center"
                        style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                      >
                        <div>
                          <div className="text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                            Incasso
                          </div>
                          <div className="text-[13px] font-bold">
                            {formatEur(p.totalRev, true)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                            Scarico 1to1
                          </div>
                          <div
                            className="text-[13px] font-bold"
                            style={{ color: 'var(--accent)' }}
                          >
                            {formatEur(p.otoRev, true)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                            Online
                          </div>
                          <div className="text-[13px] font-semibold">
                            {formatInt(p.onlineQty)} ({formatEur(p.onlineRev)})
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop PR Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr
                      className="text-[11px] font-medium whitespace-nowrap"
                      style={{
                        color: 'var(--ink-secondary)',
                        borderBottom: '0.5px solid var(--separator)',
                      }}
                    >
                      <th className="py-2.5 pl-4 pr-2 font-medium">Promoter</th>
                      <th className="py-2.5 px-2 text-right font-medium">Online</th>
                      <th className="py-2.5 px-2 text-right font-medium">One to One</th>
                      <th className="py-2.5 px-2 text-right font-medium">Cassa</th>
                      <th className="py-2.5 px-2 text-right font-medium">N° Preve</th>
                      <th className="py-2.5 px-2 text-right font-medium">Scarico 1-to-1</th>
                      <th className="py-2.5 pl-2 pr-4 text-right font-medium">Incasso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--separator)] text-[13px] tabular-nums">
                    {promoterSummary.map((p) => {
                      const isSelf = isSelfPromoter(p.promoterName);
                      return (
                        <tr key={p.promoterName} className="hover:bg-[var(--bg-hover)]">
                          <td className="py-2.5 pl-4 pr-2 font-semibold whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span>{p.promoterName}</span>
                              {isSelf && (
                                <span
                                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white leading-none"
                                  style={{ backgroundColor: 'var(--accent)' }}
                                >
                                  Tu
                                </span>
                              )}
                            </span>
                          </td>
                          <td
                            className="py-2.5 px-2 text-right whitespace-nowrap"
                            style={{ opacity: p.onlineQty === 0 ? 0.35 : 1 }}
                          >
                            {formatInt(p.onlineQty)} · {formatEur(p.onlineRev, true)}
                          </td>
                          <td
                            className="py-2.5 px-2 text-right whitespace-nowrap"
                            style={{ opacity: p.otoQty === 0 ? 0.35 : 1 }}
                          >
                            {formatInt(p.otoQty)} · {formatEur(p.otoRev, true)}
                          </td>
                          <td
                            className="py-2.5 px-2 text-right whitespace-nowrap"
                            style={{ opacity: p.boxQty === 0 ? 0.35 : 1 }}
                          >
                            {formatInt(p.boxQty)} · {formatEur(p.boxRev, true)}
                          </td>
                          <td className="py-2.5 px-2 text-right font-bold whitespace-nowrap">
                            {formatInt(p.totalQty)}
                          </td>
                          <td className="py-2.5 px-2 text-right font-semibold whitespace-nowrap">
                            {formatEur(p.otoRev, true)}
                          </td>
                          <td
                            className="py-2.5 pl-2 pr-4 text-right font-bold whitespace-nowrap"
                            style={{ color: 'var(--accent)' }}
                          >
                            {formatEur(p.totalRev, true)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr
                      className="font-bold"
                      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                    >
                      <td className="py-2.5 pl-4 pr-2">Totale ({promoterSummary.length} PR)</td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.onlineQty)} · {formatEur(totals.onlineRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.otoQty)} · {formatEur(totals.otoRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.boxQty)} · {formatEur(totals.boxRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.totalQty)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatEur(totals.otoRev, true)}
                      </td>
                      <td
                        className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap"
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatEur(totals.totalRev, true)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ============ VIEW 3: AGGREGATED BY TICKET TYPE ============ */}
          {viewMode === 'by_type' && (
            <>
              {/* Mobile Type Cards */}
              <div className="md:hidden divide-y divide-[var(--separator)] tabular-nums">
                {typeSummary.map((t) => (
                  <div key={t.key} className="p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold">{t.name}</div>
                        <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                          {formatEur(t.price, true)}
                          {t.entered !== null ? ` · Entrati ${formatInt(t.entered)}/${formatInt(t.totalQty)}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[14px] font-bold">{formatEur(t.totalRev, true)}</div>
                        <div className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                          {formatInt(t.totalQty)} venduti
                        </div>
                      </div>
                    </div>
                    <div
                      className="grid grid-cols-3 gap-2 rounded-[10px] p-2 text-center text-[12px]"
                      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                    >
                      <div>
                        <div className="text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                          Online
                        </div>
                        <div className="font-bold">{formatInt(t.onlineQty)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {formatEur(t.onlineRev)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                          One to One
                        </div>
                        <div className="font-bold">{formatInt(t.otoQty)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {formatEur(t.otoRev)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                          Cassa
                        </div>
                        <div className="font-bold">{formatInt(t.boxQty)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {formatEur(t.boxRev)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Type Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr
                      className="text-[11px] font-medium whitespace-nowrap"
                      style={{
                        color: 'var(--ink-secondary)',
                        borderBottom: '0.5px solid var(--separator)',
                      }}
                    >
                      <th className="py-2.5 pl-4 pr-2 font-medium">Tipologia</th>
                      <th className="py-2.5 px-2 text-right font-medium">Prezzo</th>
                      <th className="py-2.5 px-2 text-right font-medium">Online</th>
                      <th className="py-2.5 px-2 text-right font-medium">One to One</th>
                      <th className="py-2.5 px-2 text-right font-medium">Cassa</th>
                      <th className="py-2.5 px-2 text-right font-medium">Venduti</th>
                      <th className="py-2.5 pl-2 pr-4 text-right font-medium">Incasso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--separator)] text-[13px] tabular-nums">
                    {typeSummary.map((t) => (
                      <tr key={t.key} className="hover:bg-[var(--bg-hover)]">
                        <td className="py-2.5 pl-4 pr-2 font-semibold">{t.name}</td>
                        <td className="py-2.5 px-2 text-right whitespace-nowrap">
                          {formatEur(t.price, true)}
                        </td>
                        <td
                          className="py-2.5 px-2 text-right whitespace-nowrap"
                          style={{ opacity: t.onlineQty === 0 ? 0.35 : 1 }}
                        >
                          {formatInt(t.onlineQty)} · {formatEur(t.onlineRev, true)}
                        </td>
                        <td
                          className="py-2.5 px-2 text-right whitespace-nowrap"
                          style={{ opacity: t.otoQty === 0 ? 0.35 : 1 }}
                        >
                          {formatInt(t.otoQty)} · {formatEur(t.otoRev, true)}
                        </td>
                        <td
                          className="py-2.5 px-2 text-right whitespace-nowrap"
                          style={{ opacity: t.boxQty === 0 ? 0.35 : 1 }}
                        >
                          {formatInt(t.boxQty)} · {formatEur(t.boxRev, true)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold whitespace-nowrap">
                          {formatInt(t.totalQty)}
                          {t.entered !== null && t.entered > 0 && (
                            <span
                              className="ml-1 font-normal text-[11px]"
                              style={{ color: 'var(--ink-secondary)' }}
                            >
                              / {formatInt(t.entered)}
                            </span>
                          )}
                        </td>
                        <td
                          className="py-2.5 pl-2 pr-4 text-right font-bold whitespace-nowrap"
                          style={{ color: 'var(--accent)' }}
                        >
                          {formatEur(t.totalRev, true)}
                        </td>
                      </tr>
                    ))}
                    <tr
                      className="font-bold"
                      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                    >
                      <td className="py-2.5 pl-4 pr-2" colSpan={2}>
                        Totale
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.onlineQty)} · {formatEur(totals.onlineRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.otoQty)} · {formatEur(totals.otoRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.boxQty)} · {formatEur(totals.boxRev, true)}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatInt(totals.totalQty)}
                      </td>
                      <td
                        className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap"
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatEur(totals.totalRev, true)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
