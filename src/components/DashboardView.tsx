import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Check,
  Crown,
  Flame,
  RotateCcw,
  SlidersHorizontal,
  TrendingUp,
  X,
} from 'lucide-react';
import { AppleModal, SegmentedControl } from './ui/AppleControls';
import { computeTable } from '../lib/calculations';
import {
  formatDateDayMonth,
  formatDateShort,
  formatEur,
  formatInt,
  formatMonthKey,
  formatMonthShortLabel,
  formatPercent,
  parseIsoDate,
} from '../lib/format';
import type { EventMode, EventSummary, FullEvent, Promoter, Venue } from '../types';

type PeriodPreset = 'ALL' | '2026' | '2025' | '90D' | '30D' | 'CUSTOM';
type EraFilter = 'ALL' | '2PX' | '3PX';
type PromoterScope = 'TEAM' | 'lollo' | 'ciccio';
type BustaFilter = 'ALL' | 'PAID' | 'UNPAID';
type CashFilter = 'ALL' | 'OPEN' | 'SETTLED';
type BonusFilter = 'ALL' | 'WITH_BONUS' | 'NO_BONUS';
type DayBucket = 'FRI' | 'SAT' | 'SUN' | 'WEEKDAY';
type ChartMetric = 'revenue' | 'px' | 'busta';
type ChartGranularity = 'month' | 'event';

const DAY_LABELS: Record<DayBucket, string> = {
  FRI: 'Venerdì',
  SAT: 'Sabato',
  SUN: 'Domenica',
  WEEKDAY: 'Lun–Gio',
};

function getDayBucket(iso: string): DayBucket {
  const dow = parseIsoDate(iso).getDay();
  if (dow === 5) return 'FRI';
  if (dow === 6) return 'SAT';
  if (dow === 0) return 'SUN';
  return 'WEEKDAY';
}

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
  // Multi-filter state
  const [period, setPeriod] = useState<PeriodPreset>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
  const [promoterScope, setPromoterScope] = useState<PromoterScope>('TEAM');
  const [modeFilter, setModeFilter] = useState<'ALL' | EventMode>('ALL');
  const [eraFilter, setEraFilter] = useState<EraFilter>('ALL');
  const [bustaFilter, setBustaFilter] = useState<BustaFilter>('ALL');
  const [cashFilter, setCashFilter] = useState<CashFilter>('ALL');
  const [bonusFilter, setBonusFilter] = useState<BonusFilter>('ALL');
  const [selectedDays, setSelectedDays] = useState<DayBucket[]>([]);
  const [minRevenue, setMinRevenue] = useState<number>(0);

  // Chart view controls
  const [chartMetric, setChartMetric] = useState<ChartMetric>('revenue');
  const [chartGranularity, setChartGranularity] = useState<ChartGranularity>('month');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

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

  const toggleVenue = (name: string) => {
    setSelectedVenues((prev) =>
      prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]
    );
  };

  const toggleDay = (bucket: DayBucket) => {
    setSelectedDays((prev) =>
      prev.includes(bucket) ? prev.filter((d) => d !== bucket) : [...prev, bucket]
    );
  };

  const applySeasonPreset = (from: string, to: string) => {
    setPeriod('CUSTOM');
    setDateFrom(from);
    setDateTo(to);
  };

  const resetAllFilters = () => {
    setPeriod('ALL');
    setDateFrom('');
    setDateTo('');
    setSelectedVenues([]);
    setPromoterScope('TEAM');
    setModeFilter('ALL');
    setEraFilter('ALL');
    setBustaFilter('ALL');
    setCashFilter('ALL');
    setBonusFilter('ALL');
    setSelectedDays([]);
    setMinRevenue(0);
  };

  const activeAdvancedCount = useMemo(() => {
    let n = 0;
    if (selectedVenues.length > 0) n += 1;
    if (period === 'CUSTOM' && (dateFrom || dateTo)) n += 1;
    if (modeFilter !== 'ALL') n += 1;
    if (eraFilter !== 'ALL') n += 1;
    if (bustaFilter !== 'ALL') n += 1;
    if (cashFilter !== 'ALL') n += 1;
    if (bonusFilter !== 'ALL') n += 1;
    if (selectedDays.length > 0) n += 1;
    if (minRevenue > 0) n += 1;
    return n;
  }, [
    selectedVenues.length,
    period,
    dateFrom,
    dateTo,
    modeFilter,
    eraFilter,
    bustaFilter,
    cashFilter,
    bonusFilter,
    selectedDays.length,
    minRevenue,
  ]);

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    return events.filter((ev) => {
      const s = summaries.get(ev.id);
      if (!s) return false;

      if (period === '2026' && !ev.event_date.startsWith('2026')) return false;
      if (period === '2025' && !ev.event_date.startsWith('2025')) return false;
      if (period === '90D' && ev.event_date < cutoff90) return false;
      if (period === '30D' && ev.event_date < cutoff30) return false;
      if (period === 'CUSTOM') {
        if (dateFrom && ev.event_date < dateFrom) return false;
        if (dateTo && ev.event_date > dateTo) return false;
      }

      if (selectedVenues.length > 0 && !selectedVenues.includes(ev.venue_name)) return false;
      if (modeFilter !== 'ALL' && ev.mode !== modeFilter) return false;
      if (eraFilter !== 'ALL' && ev.era !== eraFilter) return false;

      if (bustaFilter === 'PAID' && !ev.is_busta_paid) return false;
      if (bustaFilter === 'UNPAID' && (ev.is_busta_paid || s.bustaTotal <= 0)) return false;

      if (cashFilter === 'OPEN' && s.mancantiTotal <= 0.01) return false;
      if (cashFilter === 'SETTLED' && s.mancantiTotal > 0.01) return false;

      if (bonusFilter === 'WITH_BONUS' && s.bonusAmount <= 0) return false;
      if (bonusFilter === 'NO_BONUS' && s.bonusAmount > 0) return false;

      if (selectedDays.length > 0 && !selectedDays.includes(getDayBucket(ev.event_date))) {
        return false;
      }

      const scopedRev =
        promoterScope === 'TEAM'
          ? s.revenueTotal
          : s.byPromoter[promoterScope]?.revenueTotal ?? 0;
      if (minRevenue > 0 && scopedRev < minRevenue) return false;

      if (promoterScope !== 'TEAM') {
        const pr = s.byPromoter[promoterScope];
        if (!pr || (pr.pxTotal === 0 && pr.revenueTotal === 0 && pr.bustaTotal === 0)) {
          return false;
        }
      }

      return true;
    });
  }, [
    events,
    summaries,
    period,
    dateFrom,
    dateTo,
    selectedVenues,
    modeFilter,
    eraFilter,
    bustaFilter,
    cashFilter,
    bonusFilter,
    selectedDays,
    minRevenue,
    promoterScope,
  ]);

  // Helper to read metrics according to active PromoterScope (Team vs Lollo vs Ciccio)
  const getScopedMetrics = (ev: FullEvent, s: EventSummary) => {
    if (promoterScope === 'TEAM') {
      return {
        pxTotal: s.pxTotal,
        pxPresales: s.pxPresales,
        pxTables: s.pxTables,
        revTotal: s.revenueTotal,
        revPresales: s.revenuePresales,
        revTables: s.revenueTables,
        bustaTotal: s.bustaTotal,
        bonusAmount: s.bonusAmount,
        mancanti: s.mancantiTotal,
        tablesCount: ev.tables.length,
      };
    }
    const pr = s.byPromoter[promoterScope];
    return {
      pxTotal: pr?.pxTotal ?? 0,
      pxPresales: pr?.pxPresales ?? 0,
      pxTables: pr?.pxTables ?? 0,
      revTotal: pr?.revenueTotal ?? 0,
      revPresales: pr?.revenuePresales ?? 0,
      revTables: pr?.revenueTables ?? 0,
      bustaTotal: pr?.bustaTotal ?? 0,
      bonusAmount: pr?.bustaBonusShare ?? 0,
      mancanti: pr?.mancanti ?? 0,
      tablesCount: pr?.tablesCount ?? 0,
    };
  };

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
      {
        key: string;
        label: string;
        revenue: number;
        px: number;
        busta: number;
        presalesRev: number;
        tablesRev: number;
        events: number;
      }
    >();

    const eventSeries: {
      key: string;
      label: string;
      fullLabel: string;
      revenue: number;
      px: number;
      busta: number;
      presalesRev: number;
      tablesRev: number;
      events: number;
    }[] = [];

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
      const m = getScopedMetrics(ev, s);

      pxTotal += m.pxTotal;
      pxPresales += m.pxPresales;
      pxTables += m.pxTables;
      revTotal += m.revTotal;
      revPresales += m.revPresales;
      revTables += m.revTables;
      bustaTotal += m.bustaTotal;
      if (ev.is_busta_paid) bustaPaid += m.bustaTotal;
      bonusTotal += m.bonusAmount;
      if (m.bonusAmount > 0) bonusHits += 1;
      tablesCount += m.tablesCount;

      if (ev.mode === 'OSPITE') {
        guestEvents += 1;
        guestRev += m.revTotal;
      } else if (ev.mode === 'NO OSPITE') {
        noGuestEvents += 1;
        noGuestRev += m.revTotal;
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
        presalesRev: 0,
        tablesRev: 0,
        events: 0,
      };
      mBucket.revenue = Math.round((mBucket.revenue + m.revTotal) * 100) / 100;
      mBucket.px += m.pxTotal;
      mBucket.busta = Math.round((mBucket.busta + m.bustaTotal) * 100) / 100;
      mBucket.presalesRev = Math.round((mBucket.presalesRev + m.revPresales) * 100) / 100;
      mBucket.tablesRev = Math.round((mBucket.tablesRev + m.revTables) * 100) / 100;
      mBucket.events += 1;
      byMonth.set(mk, mBucket);

      eventSeries.push({
        key: ev.event_date + ev.id,
        label: formatDateDayMonth(ev.event_date),
        fullLabel: `${ev.title} (${ev.venue_name})`,
        revenue: Math.round(m.revTotal * 100) / 100,
        px: m.pxTotal,
        busta: Math.round(m.bustaTotal * 100) / 100,
        presalesRev: Math.round(m.revPresales * 100) / 100,
        tablesRev: Math.round(m.revTables * 100) / 100,
        events: 1,
      });

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
      vBucket.px += m.pxTotal;
      vBucket.revenue = Math.round((vBucket.revenue + m.revTotal) * 100) / 100;
      vBucket.busta = Math.round((vBucket.busta + m.bustaTotal) * 100) / 100;
      vBucket.tables += m.tablesCount;
      byVenue.set(ev.venue_name, vBucket);

      for (const t of ev.tables) {
        if (promoterScope !== 'TEAM' && t.promoter_id !== promoterScope) continue;
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
    eventSeries.sort((a, b) => a.key.localeCompare(b.key));
    const venueLeaderboard = Array.from(byVenue.values()).sort((a, b) => b.revenue - a.revenue);
    const topEvents = [...filtered]
      .sort((a, b) => {
        const sa = summaries.get(a.id);
        const sb = summaries.get(b.id);
        const ra = sa ? getScopedMetrics(a, sa).revTotal : 0;
        const rb = sb ? getScopedMetrics(b, sb).revTotal : 0;
        return rb - ra;
      })
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
      avgBusta: bustaTotal / n,
      bonusTotal,
      bonusHits,
      tablesCount,
      avgTableValue: tablesCount > 0 ? revTables / tablesCount : 0,
      guestEvents,
      guestAvgRev: guestEvents > 0 ? guestRev / guestEvents : 0,
      noGuestEvents,
      noGuestAvgRev: noGuestEvents > 0 ? noGuestRev / noGuestEvents : 0,
      lollo: prAcc.lollo,
      ciccio: prAcc.ciccio,
      monthlySeries,
      eventSeries: eventSeries.slice(-24),
      venueLeaderboard,
      topEvents,
      topTables: topTables.slice(0, 6),
    };
  }, [filtered, summaries, venueColorMap, promoterScope]);

  const duoRevTotal = stats.lollo.rev + stats.ciccio.rev;
  const duoPxTotal = stats.lollo.px + stats.ciccio.px;
  const duoBustaTotal = stats.lollo.busta + stats.ciccio.busta;
  const lolloRevPct = duoRevTotal > 0 ? stats.lollo.rev / duoRevTotal : 0.5;
  const lolloPxPct = duoPxTotal > 0 ? stats.lollo.px / duoPxTotal : 0.5;
  const lolloBustaPct = duoBustaTotal > 0 ? stats.lollo.busta / duoBustaTotal : 0.5;

  const activeSeries =
    chartGranularity === 'month' ? stats.monthlySeries : stats.eventSeries;

  const chartColor =
    chartMetric === 'busta' ? '#34C759' : '#0071E3';

  const metricLabelMap: Record<ChartMetric, string> = {
    revenue: 'Fatturato (€)',
    px: 'Ingressi (PX)',
    busta: 'Buste (€)',
  };

  // Active filter chips for 1-tap inspection & removal
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (promoterScope !== 'TEAM') {
    activeChips.push({
      key: 'pr',
      label: `PR: ${promoterScope === 'lollo' ? 'Solo Lollo' : 'Solo Ciccio'}`,
      onRemove: () => setPromoterScope('TEAM'),
    });
  }
  if (period === 'CUSTOM' && (dateFrom || dateTo)) {
    activeChips.push({
      key: 'dates',
      label: `Date: ${dateFrom || '…'} → ${dateTo || '…'}`,
      onRemove: () => {
        setPeriod('ALL');
        setDateFrom('');
        setDateTo('');
      },
    });
  }
  for (const v of selectedVenues) {
    activeChips.push({
      key: `v-${v}`,
      label: v,
      onRemove: () => toggleVenue(v),
    });
  }
  if (modeFilter !== 'ALL') {
    activeChips.push({
      key: 'mode',
      label: `Modalità: ${modeFilter}`,
      onRemove: () => setModeFilter('ALL'),
    });
  }
  if (bustaFilter !== 'ALL') {
    activeChips.push({
      key: 'busta',
      label: bustaFilter === 'PAID' ? 'Buste saldate' : 'Buste da incassare',
      onRemove: () => setBustaFilter('ALL'),
    });
  }
  if (cashFilter !== 'ALL') {
    activeChips.push({
      key: 'cash',
      label: cashFilter === 'OPEN' ? 'Con mancanti' : 'Cassa in pari',
      onRemove: () => setCashFilter('ALL'),
    });
  }
  if (bonusFilter !== 'ALL') {
    activeChips.push({
      key: 'bonus',
      label: bonusFilter === 'WITH_BONUS' ? 'Solo con bonus' : 'Senza bonus',
      onRemove: () => setBonusFilter('ALL'),
    });
  }
  for (const d of selectedDays) {
    activeChips.push({
      key: `d-${d}`,
      label: DAY_LABELS[d],
      onRemove: () => toggleDay(d),
    });
  }
  if (minRevenue > 0) {
    activeChips.push({
      key: 'minRev',
      label: `Fatturato ≥ ${formatEur(minRevenue)}`,
      onRemove: () => setMinRevenue(0),
    });
  }
  if (eraFilter !== 'ALL') {
    activeChips.push({
      key: 'era',
      label: eraFilter === '2PX' ? 'Solo Lollo & Ciccio (2 PR)' : 'Archivio 3 PR',
      onRemove: () => setEraFilter('ALL'),
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12 space-y-5">
      {/* Header + Quick Filter Bar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Dashboard</h1>
            <p className="mt-0.5 text-[13px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {stats.eventsCount} serate · {formatInt(stats.tablesCount)} tavoli
            </p>
          </div>

          <div className="flex items-center gap-2">
            <SegmentedControl<PromoterScope>
              ariaLabel="Filtra per promoter"
              size="sm"
              value={promoterScope}
              onChange={setPromoterScope}
              options={[
                { value: 'TEAM', label: 'Team' },
                { value: 'lollo', label: 'Lollo' },
                { value: 'ciccio', label: 'Ciccio' },
              ]}
            />

            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[13px] font-semibold apple-surface apple-press cursor-pointer"
              style={{
                color: activeAdvancedCount > 0 ? 'var(--accent)' : 'var(--ink-primary)',
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Filtri
              {activeAdvancedCount > 0 && (
                <span
                  className="ml-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white tabular-nums"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  {activeAdvancedCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Period selector */}
        <SegmentedControl<PeriodPreset>
          ariaLabel="Periodo"
          size="sm"
          className="w-full sm:w-auto self-start"
          value={period === 'CUSTOM' ? 'CUSTOM' : period}
          onChange={(p) => {
            if (p === 'CUSTOM') {
              setFilterSheetOpen(true);
            } else {
              setPeriod(p);
              setDateFrom('');
              setDateTo('');
            }
          }}
          options={[
            { value: 'ALL', label: 'Tutto' },
            { value: '2026', label: '2026' },
            { value: '2025', label: '2025' },
            { value: '90D', label: '90 gg' },
            { value: '30D', label: '30 gg' },
          ]}
        />

        {/* Removable Active Filter Chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium apple-press cursor-pointer"
                style={{
                  backgroundColor: 'var(--accent-subtle)',
                  color: 'var(--accent)',
                }}
              >
                {chip.label}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              onClick={resetAllFilters}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium cursor-pointer"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Resetta
            </button>
          </div>
        )}
      </div>

      {/* Unified Overview Strip */}
      <section className="apple-surface rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-[var(--separator)]">
          <div className="p-3.5 sm:p-5 min-w-0">
            <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Fatturato
            </span>
            <div className="mt-1 text-[20px] sm:text-[28px] font-bold tracking-tight tabular-nums leading-none truncate">
              {formatEur(stats.revTotal)}
            </div>
            <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Media {formatEur(stats.avgRev)}
            </div>
          </div>

          <div className="p-3.5 sm:p-5 min-w-0">
            <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Ingressi
            </span>
            <div className="mt-1 text-[20px] sm:text-[28px] font-bold tracking-tight tabular-nums leading-none">
              {formatInt(stats.pxTotal)}
              <span className="ml-1 text-[13px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                px
              </span>
            </div>
            <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Media {formatInt(stats.avgPx)} px
            </div>
          </div>

          <div className="p-3.5 sm:p-5 min-w-0">
            <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Buste maturate
            </span>
            <div
              className="mt-1 text-[20px] sm:text-[28px] font-bold tracking-tight tabular-nums leading-none truncate"
              style={{ color: 'var(--status-green)' }}
            >
              {formatEur(stats.bustaTotal)}
            </div>
            <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {stats.bonusTotal > 0
                ? `Inclusi ${formatEur(stats.bonusTotal)} bonus`
                : `Media ${formatEur(stats.avgBusta)}`}
            </div>
          </div>

          <div className="p-3.5 sm:p-5 min-w-0">
            <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Quota tavoli
            </span>
            <div className="mt-1 text-[20px] sm:text-[28px] font-bold tracking-tight tabular-nums leading-none">
              {formatPercent(stats.revTotal > 0 ? stats.revTables / stats.revTotal : 0)}
            </div>
            <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Tavolo medio {formatEur(stats.avgTableValue)}
            </div>
          </div>
        </div>
      </section>

      {/* Trend Chart */}
      <section className="apple-surface rounded-[18px] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3.5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" style={{ color: chartColor }} aria-hidden="true" />
            <h2 className="text-[16px] font-semibold">
              {metricLabelMap[chartMetric]}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<ChartMetric>
              ariaLabel="Metrica grafico"
              size="sm"
              value={chartMetric}
              onChange={setChartMetric}
              options={[
                { value: 'revenue', label: 'Fatturato' },
                { value: 'px', label: 'PX' },
                { value: 'busta', label: 'Buste' },
              ]}
            />
            <SegmentedControl<ChartGranularity>
              ariaLabel="Granularità grafico"
              size="sm"
              value={chartGranularity}
              onChange={setChartGranularity}
              options={[
                { value: 'month', label: 'Mese' },
                { value: 'event', label: 'Serata' },
              ]}
            />
          </div>
        </div>

        <div className="h-[240px] w-full">
          {activeSeries.length === 0 ? (
            <div
              className="h-full flex flex-col items-center justify-center gap-2 text-[14px]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span>Nessuna serata corrisponde ai filtri attivi</span>
              <button
                type="button"
                onClick={resetAllFilters}
                className="text-[13px] font-semibold cursor-pointer"
                style={{ color: 'var(--accent)' }}
              >
                Resetta filtri
              </button>
            </div>
          ) : chartGranularity === 'month' ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activeSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="appleMetricFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.26} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--separator)" />
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
                  width={54}
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
                        <div>Preve {formatEur(row.presalesRev)} · Tavoli {formatEur(row.tablesRev)}</div>
                        <div>Ingressi: <strong>{formatInt(row.px)} px</strong></div>
                        <div>Buste: <strong>{formatEur(row.busta, true)}</strong></div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={chartMetric}
                  stroke={chartColor}
                  strokeWidth={2.5}
                  fill="url(#appleMetricFill)"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-surface)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--separator)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--ink-secondary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--ink-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tickFormatter={(v) =>
                    chartMetric === 'px'
                      ? `${v}`
                      : v >= 1000
                        ? `€${(v / 1000).toFixed(0)}k`
                        : `€${v}`
                  }
                />
                <Tooltip
                  cursor={{ fill: 'var(--bg-hover)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as (typeof stats.eventSeries)[number];
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
                          {row.label} · {row.fullLabel}
                        </div>
                        <div>Fatturato: <strong>{formatEur(row.revenue)}</strong></div>
                        <div>Ingressi: <strong>{formatInt(row.px)} px</strong></div>
                        <div>Busta: <strong>{formatEur(row.busta, true)}</strong></div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey={chartMetric} fill={chartColor} radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Head-to-Head (only in Team scope) */}
      {promoterScope === 'TEAM' && (
        <section className="apple-surface rounded-[18px] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">Lollo vs Ciccio</h2>
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

          <div className="space-y-3.5">
            {[
              {
                label: 'Fatturato',
                lVal: formatEur(stats.lollo.rev),
                cVal: formatEur(stats.ciccio.rev),
                pct: lolloRevPct,
              },
              {
                label: 'Ingressi',
                lVal: `${formatInt(stats.lollo.px)} px`,
                cVal: `${formatInt(stats.ciccio.px)} px`,
                pct: lolloPxPct,
              },
              {
                label: 'Buste',
                lVal: formatEur(stats.lollo.busta, true),
                cVal: formatEur(stats.ciccio.busta, true),
                pct: lolloBustaPct,
              },
            ].map((row) => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[12px] sm:text-[13px] tabular-nums">
                  <span className="font-semibold text-[#0071E3] dark:text-[#409CFF]">
                    {row.lVal}{' '}
                    <span className="font-normal opacity-75">({formatPercent(row.pct)})</span>
                  </span>
                  <span
                    className="hidden sm:inline text-[12px] font-medium"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {row.label}
                  </span>
                  <span className="font-semibold text-[#5856D6] dark:text-[#8E8CFF]">
                    <span className="font-normal opacity-75">({formatPercent(1 - row.pct)})</span>{' '}
                    {row.cVal}
                  </span>
                </div>
                <div
                  className="flex h-2 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                >
                  <div
                    className="h-full transition-[width] duration-300"
                    style={{ width: `${row.pct * 100}%`, backgroundColor: '#0071E3' }}
                  />
                  <div
                    className="h-full transition-[width] duration-300"
                    style={{ width: `${(1 - row.pct) * 100}%`, backgroundColor: '#5856D6' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Unified Locali Leaderboard (clickable to filter) */}
      {stats.venueLeaderboard.length > 0 && (
        <section className="apple-surface rounded-[18px] overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-3.5"
            style={{ borderBottom: '0.5px solid var(--separator)' }}
          >
            <h2 className="text-[16px] font-semibold">Locali</h2>
            <span className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
              Tocca un locale per filtrare
            </span>
          </div>
          <div className="apple-list">
            {(() => {
              const maxVenueRev = stats.venueLeaderboard[0]?.revenue || 1;
              return stats.venueLeaderboard.map((v) => {
                const isSelected = selectedVenues.includes(v.name);
                const barPct = Math.max(4, Math.round((v.revenue / maxVenueRev) * 100));
                return (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => toggleVenue(v.name)}
                    className="w-full px-5 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer space-y-1.5"
                    style={{
                      backgroundColor: isSelected ? 'var(--bg-active)' : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3 tabular-nums">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: v.color }}
                        />
                        <span className="text-[14px] font-semibold truncate">{v.name}</span>
                        <span className="text-[12px] shrink-0" style={{ color: 'var(--ink-tertiary)' }}>
                          {v.events} ser. · {formatInt(v.px)} px
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[14px] font-semibold">{formatEur(v.revenue)}</span>
                        <span
                          className="text-[13px] font-semibold min-w-[68px] text-right"
                          style={{ color: 'var(--status-green)' }}
                        >
                          {formatEur(v.busta, true)}
                        </span>
                      </div>
                    </div>
                    <div
                      className="h-1.5 w-full rounded-full overflow-hidden"
                      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${barPct}%`, backgroundColor: v.color }}
                      />
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </section>
      )}

      {/* Top Serate & Tavoli Record */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="apple-surface rounded-[18px] overflow-hidden">
          <div
            className="flex items-center gap-2 px-5 py-3.5"
            style={{ borderBottom: '0.5px solid var(--separator)' }}
          >
            <Crown className="h-4 w-4 text-[#FF9500]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold">Migliori serate</h2>
          </div>
          <div className="apple-list">
            {stats.topEvents.slice(0, 5).map((ev) => {
              const s = summaries.get(ev.id)!;
              const m = getScopedMetrics(ev, s);
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
                      {ev.venue_name} · {formatDateShort(ev.event_date)} · {formatInt(m.pxTotal)} px
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="text-[14px] font-bold">{formatEur(m.revTotal)}</div>
                    <div className="text-[11px] font-medium" style={{ color: 'var(--status-green)' }}>
                      {formatEur(m.bustaTotal)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="apple-surface rounded-[18px] overflow-hidden">
          <div
            className="flex items-center gap-2 px-5 py-3.5"
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
              stats.topTables.slice(0, 5).map((t, i) => {
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
                        {t.venueName} · {formatDateShort(t.eventDate)}
                      </div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="text-[14px] font-bold">{formatEur(t.credito)}</div>
                      <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                        {t.px > 0 ? `${t.px} px` : 'Extra'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Multi-Filter Apple Sheet / Modal */}
      <AppleModal
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filtri statistiche"
        subtitle="Combina più filtri liberamente: ogni grafico e tabella si aggiorna in tempo reale."
        maxWidth="max-w-[560px]"
      >
        <div className="space-y-5">
          {/* 1. Multi-select Locali */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-semibold">Locali (selezione multipla)</span>
              {selectedVenues.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedVenues([])}
                  className="text-[12px] font-medium cursor-pointer"
                  style={{ color: 'var(--accent)' }}
                >
                  Tutti i locali
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {uniqueVenues.map((v) => {
                const active = selectedVenues.includes(v);
                const color = venueColorMap.get(v) || '#0071E3';
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleVenue(v)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium apple-press cursor-pointer"
                    style={{
                      backgroundColor: active ? color : 'var(--bg-surface-secondary)',
                      color: active ? '#FFFFFF' : 'var(--ink-primary)',
                    }}
                  >
                    {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Date Range & Seasons */}
          <div className="space-y-2.5">
            <span className="block text-[13px] font-semibold">Intervallo date personalizzato</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="dash-from"
                  className="block text-[11px] mb-1"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  Dal
                </label>
                <input
                  id="dash-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPeriod('CUSTOM');
                    setDateFrom(e.target.value);
                  }}
                  className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px] tabular-nums"
                />
              </div>
              <div>
                <label
                  htmlFor="dash-to"
                  className="block text-[11px] mb-1"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  Al
                </label>
                <input
                  id="dash-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPeriod('CUSTOM');
                    setDateTo(e.target.value);
                  }}
                  className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px] tabular-nums"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => applySeasonPreset('2026-06-01', '2026-09-15')}
                className="rounded-full px-3 py-1 text-[12px] font-medium apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                Estate 2026
              </button>
              <button
                type="button"
                onClick={() => applySeasonPreset('2025-06-01', '2025-09-15')}
                className="rounded-full px-3 py-1 text-[12px] font-medium apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                Estate 2025
              </button>
              <button
                type="button"
                onClick={() => applySeasonPreset('2025-10-01', '2026-04-30')}
                className="rounded-full px-3 py-1 text-[12px] font-medium apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                Inverno 25/26
              </button>
            </div>
          </div>

          {/* 3. Giorno settimana (multi-select) */}
          <div>
            <span className="block text-[13px] font-semibold mb-2">Giorno della settimana</span>
            <div className="flex flex-wrap gap-1.5">
              {(['FRI', 'SAT', 'SUN', 'WEEKDAY'] as DayBucket[]).map((d) => {
                const active = selectedDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className="rounded-full px-3 py-1.5 text-[13px] font-medium apple-press cursor-pointer"
                    style={{
                      backgroundColor: active ? 'var(--accent)' : 'var(--bg-surface-secondary)',
                      color: active ? '#FFFFFF' : 'var(--ink-primary)',
                    }}
                  >
                    {DAY_LABELS[d]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Modalità & Bonus */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className="block text-[13px] font-semibold mb-1.5">Modalità serata</span>
              <SegmentedControl<'ALL' | EventMode>
                ariaLabel="Modalità serata"
                size="sm"
                value={modeFilter}
                onChange={setModeFilter}
                className="w-full"
                options={[
                  { value: 'ALL', label: 'Tutte' },
                  { value: 'NO OSPITE', label: 'No osp.' },
                  { value: 'OSPITE', label: 'Ospite' },
                ]}
              />
            </div>

            <div>
              <span className="block text-[13px] font-semibold mb-1.5">Bonus raggiunto</span>
              <SegmentedControl<BonusFilter>
                ariaLabel="Filtro bonus"
                size="sm"
                value={bonusFilter}
                onChange={setBonusFilter}
                className="w-full"
                options={[
                  { value: 'ALL', label: 'Tutte' },
                  { value: 'WITH_BONUS', label: 'Con bonus' },
                  { value: 'NO_BONUS', label: 'Senza' },
                ]}
              />
            </div>
          </div>

          {/* 5. Stato Busta & Cassa */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className="block text-[13px] font-semibold mb-1.5">Stato busta</span>
              <SegmentedControl<BustaFilter>
                ariaLabel="Stato busta"
                size="sm"
                value={bustaFilter}
                onChange={setBustaFilter}
                className="w-full"
                options={[
                  { value: 'ALL', label: 'Tutte' },
                  { value: 'PAID', label: 'Saldate' },
                  { value: 'UNPAID', label: 'Aperte' },
                ]}
              />
            </div>

            <div>
              <span className="block text-[13px] font-semibold mb-1.5">Stato cassa</span>
              <SegmentedControl<CashFilter>
                ariaLabel="Stato cassa"
                size="sm"
                value={cashFilter}
                onChange={setCashFilter}
                className="w-full"
                options={[
                  { value: 'ALL', label: 'Tutti' },
                  { value: 'OPEN', label: 'Mancanti' },
                  { value: 'SETTLED', label: 'In pari' },
                ]}
              />
            </div>
          </div>

          {/* 6. Soglia Fatturato minimo & Storico Era */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="dash-min-rev"
                className="block text-[13px] font-semibold mb-1.5"
              >
                Fatturato minimo serata
              </label>
              <select
                id="dash-min-rev"
                value={minRevenue}
                onChange={(e) => setMinRevenue(Number(e.target.value))}
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
              >
                <option value={0}>Qualsiasi importo</option>
                <option value={1000}>Almeno 1.000 €</option>
                <option value={2000}>Almeno 2.000 €</option>
                <option value={4000}>Almeno 4.000 €</option>
                <option value={6000}>Almeno 6.000 €</option>
              </select>
            </div>

            <div>
              <span className="block text-[13px] font-semibold mb-1.5">Periodo squadra</span>
              <SegmentedControl<EraFilter>
                ariaLabel="Storico squadra"
                size="sm"
                value={eraFilter}
                onChange={setEraFilter}
                className="w-full"
                options={[
                  { value: 'ALL', label: 'Tutto' },
                  { value: '2PX', label: '2 PR' },
                  { value: '3PX', label: '3 PR' },
                ]}
              />
            </div>
          </div>

          {/* Footer CTA */}
          <div
            className="flex items-center justify-between gap-2 pt-3"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <button
              type="button"
              onClick={resetAllFilters}
              className="rounded-[10px] px-4 py-2 text-[14px] font-medium apple-press cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-primary)',
              }}
            >
              Resetta tutto
            </button>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(false)}
              className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer tabular-nums"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Mostra {stats.eventsCount} serate
            </button>
          </div>
        </div>
      </AppleModal>
    </div>
  );
}
