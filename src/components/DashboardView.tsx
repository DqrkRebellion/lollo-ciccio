import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Award, Crown, Flame, TrendingUp } from 'lucide-react';
import { SegmentedControl } from './ui/AppleControls';
import { computeTable } from '../lib/calculations';
import {
  formatDateShort,
  formatEur,
  formatInt,
  formatMonthKey,
  formatMonthShortLabel,
  formatPercent,
} from '../lib/format';
import type { EventMode, EventSummary, FullEvent, Promoter, Venue } from '../types';

type PeriodFilter = 'ALL' | '2026' | '2025' | '90D';
type EraFilter = 'ALL' | '2PX' | '3PX';
type ChartMetric = 'revenue' | 'px' | 'busta';

export function DashboardView({
  events,
  summaries,
  promoters,
  venues,
  onOpenEvent,
}: {
  events: FullEvent[];
  summaries: Map<string, EventSummary>;
  promoters: Promoter[];
  venues: Venue[];
  onOpenEvent: (eventId: string) => void;
}) {
  const [period, setPeriod] = useState<PeriodFilter>('ALL');
  const [venueFilter, setVenueFilter] = useState<string>('ALL');
  const [modeFilter, setModeFilter] = useState<'ALL' | EventMode>('ALL');
  const [eraFilter, setEraFilter] = useState<EraFilter>('ALL');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('revenue');

  const venueColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of venues) m.set(v.name, v.color);
    return m;
  }, [venues]);

  const promoterMap = useMemo(() => {
    const m = new Map<string, Promoter>();
    for (const p of promoters) m.set(p.id, p);
    return m;
  }, [promoters]);

  const uniqueVenues = useMemo(
    () => Array.from(new Set(events.map((e) => e.venue_name))).sort(),
    [events]
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    return events.filter((ev) => {
      if (period === '2026' && !ev.event_date.startsWith('2026')) return false;
      if (period === '2025' && !ev.event_date.startsWith('2025')) return false;
      if (period === '90D' && ev.event_date < cutoff90) return false;
      if (venueFilter !== 'ALL' && ev.venue_name !== venueFilter) return false;
      if (modeFilter !== 'ALL' && ev.mode !== modeFilter) return false;
      if (eraFilter !== 'ALL' && ev.era !== eraFilter) return false;
      return true;
    });
  }, [events, period, venueFilter, modeFilter, eraFilter]);

  const stats = useMemo(() => {
    let pxTotal = 0;
    let pxPresales = 0;
    let pxTables = 0;
    let revTotal = 0;
    let revPresales = 0;
    let revTables = 0;
    let bustaTotal = 0;
    let bustaPaid = 0;
    let bonusTotal = 0;
    let bonusHits = 0;
    let mancantiTotal = 0;
    let tablesCount = 0;

    let guestEvents = 0;
    let guestRev = 0;
    let noGuestEvents = 0;
    let noGuestRev = 0;

    const prAcc: Record<
      string,
      {
        px: number;
        pxPreve: number;
        pxTav: number;
        rev: number;
        revPreve: number;
        revTav: number;
        busta: number;
        tables: number;
        events: number;
      }
    > = {
      lollo: { px: 0, pxPreve: 0, pxTav: 0, rev: 0, revPreve: 0, revTav: 0, busta: 0, tables: 0, events: 0 },
      ciccio: { px: 0, pxPreve: 0, pxTav: 0, rev: 0, revPreve: 0, revTav: 0, busta: 0, tables: 0, events: 0 },
    };

    const byMonth = new Map<
      string,
      { key: string; label: string; revenue: number; px: number; busta: number; events: number }
    >();

    const byVenue = new Map<
      string,
      { name: string; color: string; events: number; px: number; revenue: number; busta: number; tables: number }
    >();

    const topTables: {
      tableName: string;
      promoterId: string;
      eventId: string;
      eventTitle: string;
      venueName: string;
      eventDate: string;
      px: number;
      credito: number;
    }[] = [];

    for (const ev of filtered) {
      const s = summaries.get(ev.id);
      if (!s) continue;

      pxTotal += s.pxTotal;
      pxPresales += s.pxPresales;
      pxTables += s.pxTables;
      revTotal += s.revenueTotal;
      revPresales += s.revenuePresales;
      revTables += s.revenueTables;
      bustaTotal += s.bustaTotal;
      if (ev.is_busta_paid) bustaPaid += s.bustaTotal;
      bonusTotal += s.bonusAmount;
      if (s.bonusAmount > 0) bonusHits += 1;
      mancantiTotal += Math.max(0, s.mancantiTotal);
      tablesCount += ev.tables.length;

      if (ev.mode === 'OSPITE') {
        guestEvents += 1;
        guestRev += s.revenueTotal;
      } else if (ev.mode === 'NO OSPITE') {
        noGuestEvents += 1;
        noGuestRev += s.revenueTotal;
      }

      for (const pid of ['lollo', 'ciccio']) {
        const p = s.byPromoter[pid];
        if (!p) continue;
        prAcc[pid].px += p.pxTotal;
        prAcc[pid].pxPreve += p.pxPresales;
        prAcc[pid].pxTav += p.pxTables;
        prAcc[pid].rev += p.revenueTotal;
        prAcc[pid].revPreve += p.revenuePresales;
        prAcc[pid].revTav += p.revenueTables;
        prAcc[pid].busta += p.bustaTotal;
        prAcc[pid].tables += p.tablesCount;
        if (p.pxTotal > 0 || p.revenueTotal > 0) prAcc[pid].events += 1;
      }

      const mk = formatMonthKey(ev.event_date);
      const mBucket = byMonth.get(mk) || {
        key: mk,
        label: formatMonthShortLabel(mk),
        revenue: 0,
        px: 0,
        busta: 0,
        events: 0,
      };
      mBucket.revenue = Math.round((mBucket.revenue + s.revenueTotal) * 100) / 100;
      mBucket.px += s.pxTotal;
      mBucket.busta = Math.round((mBucket.busta + s.bustaTotal) * 100) / 100;
      mBucket.events += 1;
      byMonth.set(mk, mBucket);

      const vBucket = byVenue.get(ev.venue_name) || {
        name: ev.venue_name,
        color: venueColorMap.get(ev.venue_name) || '#0071E3',
        events: 0,
        px: 0,
        revenue: 0,
        busta: 0,
        tables: 0,
      };
      vBucket.events += 1;
      vBucket.px += s.pxTotal;
      vBucket.revenue = Math.round((vBucket.revenue + s.revenueTotal) * 100) / 100;
      vBucket.busta = Math.round((vBucket.busta + s.bustaTotal) * 100) / 100;
      vBucket.tables += ev.tables.length;
      byVenue.set(ev.venue_name, vBucket);

      for (const t of ev.tables) {
        const tc = computeTable(t);
        if (tc.credito > 0) {
          topTables.push({
            tableName: t.table_name,
            promoterId: t.promoter_id,
            eventId: ev.id,
            eventTitle: ev.title,
            venueName: ev.venue_name,
            eventDate: ev.event_date,
            px: tc.px,
            credito: tc.credito,
          });
        }
      }
    }

    const monthlySeries = Array.from(byMonth.values()).sort((a, b) => a.key.localeCompare(b.key));
    const venueLeaderboard = Array.from(byVenue.values()).sort((a, b) => b.revenue - a.revenue);
    const topEvents = [...filtered]
      .sort((a, b) => (summaries.get(b.id)?.revenueTotal ?? 0) - (summaries.get(a.id)?.revenueTotal ?? 0))
      .slice(0, 6);
    topTables.sort((a, b) => b.credito - a.credito);

    const n = filtered.length || 1;
    return {
      eventsCount: filtered.length,
      pxTotal,
      pxPresales,
      pxTables,
      avgPx: Math.round(pxTotal / n),
      revTotal,
      revPresales,
      revTables,
      avgRev: revTotal / n,
      bustaTotal,
      bustaPaid,
      bustaUnpaid: Math.max(0, bustaTotal - bustaPaid),
      avgBusta: bustaTotal / n,
      bonusTotal,
      bonusHits,
      mancantiTotal,
      tablesCount,
      avgTableValue: tablesCount > 0 ? revTables / tablesCount : 0,
      guestEvents,
      guestAvgRev: guestEvents > 0 ? guestRev / guestEvents : 0,
      noGuestEvents,
      noGuestAvgRev: noGuestEvents > 0 ? noGuestRev / noGuestEvents : 0,
      lollo: prAcc.lollo,
      ciccio: prAcc.ciccio,
      monthlySeries,
      venueLeaderboard,
      topEvents,
      topTables: topTables.slice(0, 6),
    };
  }, [filtered, summaries, venueColorMap]);

  const duoRevTotal = stats.lollo.rev + stats.ciccio.rev;
  const duoPxTotal = stats.lollo.px + stats.ciccio.px;
  const duoBustaTotal = stats.lollo.busta + stats.ciccio.busta;
  const lolloRevPct = duoRevTotal > 0 ? stats.lollo.rev / duoRevTotal : 0.5;
  const lolloPxPct = duoPxTotal > 0 ? stats.lollo.px / duoPxTotal : 0.5;
  const lolloBustaPct = duoBustaTotal > 0 ? stats.lollo.busta / duoBustaTotal : 0.5;

  const metricLabel =
    chartMetric === 'revenue'
      ? 'Fatturato (€)'
      : chartMetric === 'px'
        ? 'Ingressi (PX)'
        : 'Buste (€)';

  return (
    <div className="mx-auto w-full max-w-[1160px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-6">
      {/* Header + Filters */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            Statistiche generali su {stats.eventsCount} serate · {formatInt(stats.tablesCount)} tavoli registrati
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<PeriodFilter>
            ariaLabel="Periodo"
            size="sm"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'ALL', label: 'Tutto' },
              { value: '2026', label: '2026' },
              { value: '2025', label: '2025' },
              { value: '90D', label: '90 gg' },
            ]}
          />

          <select
            aria-label="Filtra locale"
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
            className="apple-input rounded-[10px] px-3 py-1.5 text-[13px] font-medium cursor-pointer"
          >
            <option value="ALL">Tutti i locali</option>
            {uniqueVenues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtra modalità"
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as 'ALL' | EventMode)}
            className="apple-input rounded-[10px] px-3 py-1.5 text-[13px] font-medium cursor-pointer"
          >
            <option value="ALL">Tutte le modalità</option>
            <option value="NO OSPITE">Solo No ospite</option>
            <option value="OSPITE">Solo Ospite</option>
          </select>

          <select
            aria-label="Filtra storico team"
            value={eraFilter}
            onChange={(e) => setEraFilter(e.target.value as EraFilter)}
            className="apple-input rounded-[10px] px-3 py-1.5 text-[13px] font-medium cursor-pointer"
          >
            <option value="ALL">Tutto lo storico</option>
            <option value="2PX">Solo Lollo &amp; Ciccio (2 PR)</option>
            <option value="3PX">Archivio 3 PR</option>
          </select>
        </div>
      </div>

      {/* Unified Overview Strip */}
      <section className="apple-surface rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-[var(--separator)]">
          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Fatturato generato
            </span>
            <div className="mt-1 text-[26px] sm:text-[30px] font-bold tracking-tight tabular-nums leading-none">
              {formatEur(stats.revTotal)}
            </div>
            <div className="mt-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Media {formatEur(stats.avgRev)} / serata
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Ingressi totali
            </span>
            <div className="mt-1 text-[26px] sm:text-[30px] font-bold tracking-tight tabular-nums leading-none">
              {formatInt(stats.pxTotal)}
              <span className="ml-1 text-[14px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                px
              </span>
            </div>
            <div className="mt-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Media {formatInt(stats.avgPx)} px / serata
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Buste maturate
            </span>
            <div
              className="mt-1 text-[26px] sm:text-[30px] font-bold tracking-tight tabular-nums leading-none"
              style={{ color: 'var(--status-green)' }}
            >
              {formatEur(stats.bustaTotal)}
            </div>
            <div className="mt-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Media {formatEur(stats.avgBusta)} · Bonus {formatEur(stats.bonusTotal)} ({stats.bonusHits}×)
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Mix Prevendite / Tavoli
            </span>
            <div className="mt-1 text-[26px] sm:text-[30px] font-bold tracking-tight tabular-nums leading-none">
              {formatPercent(stats.revTotal > 0 ? stats.revTables / stats.revTotal : 0)}
              <span className="ml-1.5 text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                da tavoli
              </span>
            </div>
            <div className="mt-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Tavolo medio {formatEur(stats.avgTableValue)}
            </div>
          </div>
        </div>
      </section>

      {/* Trend Chart (Apple Stocks / Health clean canvas) */}
      <section className="apple-surface rounded-[18px] p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <TrendingUp className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <div>
              <h2 className="text-[18px] font-semibold">Andamento mensile</h2>
              <p className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                {metricLabel} aggregati per mese
              </p>
            </div>
          </div>
          <SegmentedControl<ChartMetric>
            ariaLabel="Metrica grafico"
            size="sm"
            value={chartMetric}
            onChange={setChartMetric}
            options={[
              { value: 'revenue', label: 'Fatturato' },
              { value: 'px', label: 'Ingressi PX' },
              { value: 'busta', label: 'Buste' },
            ]}
          />
        </div>

        <div className="h-[270px] w-full">
          {stats.monthlySeries.length === 0 ? (
            <div
              className="h-full flex items-center justify-center text-[14px]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nessun dato nel periodo selezionato
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={stats.monthlySeries}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="appleBlueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={chartMetric === 'busta' ? '#34C759' : '#0071E3'}
                      stopOpacity={0.26}
                    />
                    <stop
                      offset="100%"
                      stopColor={chartMetric === 'busta' ? '#34C759' : '#0071E3'}
                      stopOpacity={0.01}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--separator)"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--ink-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--ink-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v) =>
                    chartMetric === 'px'
                      ? `${v}`
                      : v >= 1000
                        ? `€${(v / 1000).toFixed(0)}k`
                        : `€${v}`
                  }
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as (typeof stats.monthlySeries)[number];
                    return (
                      <div
                        className="rounded-[12px] px-3.5 py-2.5 text-[12px] tabular-nums"
                        style={{
                          backgroundColor: 'var(--bg-chrome-elevated)',
                          backdropFilter: 'blur(16px)',
                          boxShadow: 'var(--shadow-popover)',
                        }}
                      >
                        <div className="font-semibold text-[13px] mb-1">
                          {row.label} ({row.events} serate)
                        </div>
                        <div>Fatturato: <strong>{formatEur(row.revenue)}</strong></div>
                        <div>Ingressi: <strong>{formatInt(row.px)} px</strong></div>
                        <div>Buste: <strong>{formatEur(row.busta, true)}</strong></div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={chartMetric}
                  stroke={chartMetric === 'busta' ? '#34C759' : '#0071E3'}
                  strokeWidth={2.5}
                  fill="url(#appleBlueFill)"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-surface)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Head-to-Head: Lollo vs Ciccio + Ospite vs No Ospite */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 apple-surface rounded-[18px] p-5 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[18px] font-semibold">Confronto Lollo vs Ciccio</h2>
              <p className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                Ripartizione diretta su fatturato, ingressi e buste
              </p>
            </div>
            <div className="flex items-center gap-3 text-[12px] font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#0071E3]" />
                Lollo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#5856D6]" />
                Ciccio
              </span>
            </div>
          </div>

          {/* Split Bars */}
          <div className="space-y-4">
            {[
              {
                label: 'Fatturato generato',
                lVal: formatEur(stats.lollo.rev),
                cVal: formatEur(stats.ciccio.rev),
                pct: lolloRevPct,
              },
              {
                label: 'Ingressi totali (PX)',
                lVal: `${formatInt(stats.lollo.px)} px`,
                cVal: `${formatInt(stats.ciccio.px)} px`,
                pct: lolloPxPct,
              },
              {
                label: 'Buste maturate',
                lVal: formatEur(stats.lollo.busta, true),
                cVal: formatEur(stats.ciccio.busta, true),
                pct: lolloBustaPct,
              },
            ].map((row) => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-[13px] tabular-nums">
                  <span className="font-semibold text-[#0071E3] dark:text-[#409CFF]">
                    {row.lVal}{' '}
                    <span className="font-normal opacity-75">({formatPercent(row.pct)})</span>
                  </span>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                    {row.label}
                  </span>
                  <span className="font-semibold text-[#5856D6] dark:text-[#8E8CFF]">
                    <span className="font-normal opacity-75">({formatPercent(1 - row.pct)})</span>{' '}
                    {row.cVal}
                  </span>
                </div>
                <div
                  className="flex h-2.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${row.pct * 100}%`, backgroundColor: '#0071E3' }}
                  />
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${(1 - row.pct) * 100}%`, backgroundColor: '#5856D6' }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Mini breakdown grid */}
          <div
            className="grid grid-cols-2 gap-3 pt-4"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            {[
              { id: 'lollo', name: 'Lollo', color: '#0071E3', data: stats.lollo },
              { id: 'ciccio', name: 'Ciccio', color: '#5856D6', data: stats.ciccio },
            ].map((item) => (
              <div
                key={item.id}
                className="rounded-[12px] p-3.5 space-y-1.5 tabular-nums"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-[14px] font-semibold">{item.name}</span>
                  <span className="ml-auto text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                    {item.data.events} serate
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: 'var(--ink-secondary)' }}>Prevendite</span>
                  <span className="font-medium">
                    {formatInt(item.data.pxPreve)} px · {formatEur(item.data.revPreve)}
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: 'var(--ink-secondary)' }}>Tavoli ({item.data.tables})</span>
                  <span className="font-medium">
                    {formatInt(item.data.pxTav)} px · {formatEur(item.data.revTav)}
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: 'var(--ink-secondary)' }}>Media tavolo</span>
                  <span className="font-semibold">
                    {formatEur(item.data.tables > 0 ? item.data.revTav / item.data.tables : 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Club Revenue Bar Chart + Ospite vs No Ospite */}
        <section className="lg:col-span-5 apple-surface rounded-[18px] p-5 flex flex-col justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold">Fatturato per locale</h2>
            <p className="text-[12px] mb-3" style={{ color: 'var(--ink-secondary)' }}>
              Top locali per volume generato
            </p>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.venueLeaderboard.slice(0, 6)}
                  layout="vertical"
                  margin={{ top: 0, right: 14, left: 6, bottom: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={86}
                    tick={{ fill: 'var(--ink-primary)', fontSize: 12, fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--bg-hover)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const v = payload[0].payload as (typeof stats.venueLeaderboard)[number];
                      return (
                        <div
                          className="rounded-[10px] px-3 py-2 text-[12px] tabular-nums"
                          style={{
                            backgroundColor: 'var(--bg-chrome-elevated)',
                            boxShadow: 'var(--shadow-popover)',
                          }}
                        >
                          <div className="font-semibold">{v.name}</div>
                          <div>{formatEur(v.revenue)} · {formatInt(v.px)} px · {v.events} serate</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="revenue" radius={[0, 6, 6, 0]} barSize={18}>
                    {stats.venueLeaderboard.slice(0, 6).map((v) => (
                      <Cell key={v.name} fill={v.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div
            className="grid grid-cols-2 gap-2.5 pt-3 tabular-nums"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <div className="rounded-[12px] p-3" style={{ backgroundColor: 'var(--bg-surface-secondary)' }}>
              <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Serate No ospite ({stats.noGuestEvents})
              </div>
              <div className="mt-0.5 text-[16px] font-bold">{formatEur(stats.noGuestAvgRev)}</div>
              <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                fatturato medio
              </div>
            </div>
            <div className="rounded-[12px] p-3" style={{ backgroundColor: 'var(--bg-surface-secondary)' }}>
              <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Serate con Ospite ({stats.guestEvents})
              </div>
              <div className="mt-0.5 text-[16px] font-bold">{formatEur(stats.guestAvgRev)}</div>
              <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                fatturato medio
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Venue Full Leaderboard Table */}
      <section>
        <h2 className="text-[18px] font-semibold mb-2.5 px-1">Rendimento per locale</h2>
        <div className="apple-surface rounded-[16px] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[560px]">
            <thead>
              <tr
                className="text-[12px] font-medium"
                style={{
                  color: 'var(--ink-secondary)',
                  borderBottom: '0.5px solid var(--separator)',
                }}
              >
                <th className="py-3 pl-4 pr-2 font-medium">Locale</th>
                <th className="py-3 px-2 text-right font-medium">Serate</th>
                <th className="py-3 px-2 text-right font-medium">Ingressi PX</th>
                <th className="py-3 px-2 text-right font-medium">Tavoli</th>
                <th className="py-3 px-2 text-right font-medium">Fatturato</th>
                <th className="py-3 px-2 text-right font-medium">Media / serata</th>
                <th className="py-3 pl-2 pr-4 text-right font-medium">Buste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)] text-[14px] tabular-nums">
              {stats.venueLeaderboard.map((v) => (
                <tr
                  key={v.name}
                  onClick={() => setVenueFilter((cur) => (cur === v.name ? 'ALL' : v.name))}
                  className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  <td className="py-3 pl-4 pr-2 font-semibold">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: v.color }}
                      />
                      {v.name}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-right">{v.events}</td>
                  <td className="py-3 px-2 text-right font-medium">{formatInt(v.px)}</td>
                  <td className="py-3 px-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                    {v.tables}
                  </td>
                  <td className="py-3 px-2 text-right font-semibold">{formatEur(v.revenue)}</td>
                  <td className="py-3 px-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                    {formatEur(v.revenue / (v.events || 1))}
                  </td>
                  <td
                    className="py-3 pl-2 pr-4 text-right font-semibold"
                    style={{ color: 'var(--status-green)' }}
                  >
                    {formatEur(v.busta, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hall of Fame: Top Serate & Top Tavoli */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="apple-surface rounded-[18px] overflow-hidden">
          <div
            className="flex items-center gap-2 px-5 py-4"
            style={{ borderBottom: '0.5px solid var(--separator)' }}
          >
            <Crown className="h-4 w-4 text-[#FF9500]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold">Migliori serate per fatturato</h2>
          </div>
          <div className="apple-list">
            {stats.topEvents.map((ev) => {
              const s = summaries.get(ev.id);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onOpenEvent(ev.id)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold truncate">{ev.title}</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      {ev.venue_name} · {formatDateShort(ev.event_date)} · {formatInt(s?.pxTotal ?? 0)} px
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="text-[14px] font-bold">{formatEur(s?.revenueTotal ?? 0)}</div>
                    <div className="text-[11px] font-medium" style={{ color: 'var(--status-green)' }}>
                      Busta {formatEur(s?.bustaTotal ?? 0)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="apple-surface rounded-[18px] overflow-hidden">
          <div
            className="flex items-center gap-2 px-5 py-4"
            style={{ borderBottom: '0.5px solid var(--separator)' }}
          >
            <Flame className="h-4 w-4 text-[#FF3B30]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold">Tavoli record</h2>
          </div>
          <div className="apple-list">
            {stats.topTables.length === 0 ? (
              <div className="p-6 text-center text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                Nessun tavolo nel filtro attuale
              </div>
            ) : (
              stats.topTables.map((t, i) => {
                const pr = promoterMap.get(t.promoterId);
                return (
                  <button
                    key={`${t.eventId}-${t.tableName}-${i}`}
                    type="button"
                    onClick={() => onOpenEvent(t.eventId)}
                    className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold truncate">{t.tableName}</span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0"
                          style={{
                            backgroundColor: `${pr?.color || '#0071E3'}1A`,
                            color: pr?.color || '#0071E3',
                          }}
                        >
                          {pr?.display_name || t.promoterId}
                        </span>
                      </div>
                      <div className="text-[12px] truncate" style={{ color: 'var(--ink-secondary)' }}>
                        {t.venueName} · {t.eventTitle} ({formatDateShort(t.eventDate)})
                      </div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="text-[14px] font-bold">{formatEur(t.credito)}</div>
                      <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                        {t.px > 0 ? `${t.px} paganti` : 'Extra'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Footer insight note */}
      {stats.bonusHits > 0 && (
        <div
          className="flex items-center gap-2.5 rounded-[14px] px-4 py-3 text-[13px]"
          style={{
            backgroundColor: 'var(--status-green-bg)',
            color: 'var(--status-green)',
          }}
        >
          <Award className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Soglia bonus raggiunta in <strong>{stats.bonusHits} serate</strong> su{' '}
            {stats.eventsCount}, generando <strong>{formatEur(stats.bonusTotal)}</strong> di bonus
            extra nelle buste.
          </span>
        </div>
      )}
    </div>
  );
}
