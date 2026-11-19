import type { EventSummary, FullEvent, Promoter } from '../types';

const eurFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const eurExactFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intFormatter = new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 0,
});

export function formatEur(value: number, exact = false): string {
  const v = Number(value) || 0;
  if (Object.is(v, -0) || Math.abs(v) < 0.005) return exact ? '€\u00A00,00' : '€\u00A00';
  return (exact ? eurExactFormatter : eurFormatter).format(v);
}

export function formatInt(value: number): string {
  return intFormatter.format(Math.round(Number(value) || 0));
}

export function formatPercent(ratio: number): string {
  return `${Math.round((Number(ratio) || 0) * 100)}%`;
}

const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_LONG = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

export function formatDateShort(iso: string): string {
  const d = parseIsoDate(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateDayMonth(iso: string): string {
  const d = parseIsoDate(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function formatDateFull(iso: string): string {
  const d = parseIsoDate(iso);
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatMonthYear(iso: string): string {
  const d = parseIsoDate(iso);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatMonthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function formatMonthShortLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_SHORT[(m || 1) - 1]} ${String(y).slice(2)}`;
}

/**
 * Generates a crisp WhatsApp-ready summary for an evening event.
 */
export function buildWhatsAppSummary(
  event: FullEvent,
  summary: EventSummary,
  promoters: Promoter[]
): string {
  const nameOf = (id: string) =>
    promoters.find((p) => p.id === id)?.display_name || id.toUpperCase();

  const lines: string[] = [
    `*${event.venue_name} — ${event.title}*`,
    `Data: ${formatDateFull(event.event_date)} (${event.mode})`,
    ``,
    `*Totali serata*`,
    `• PX totali: ${summary.pxTotal} (${summary.pxPresales} preve + ${summary.pxTables} tavoli)`,
    `• Fatturato: ${formatEur(summary.revenueTotal)} (Preve ${formatEur(summary.revenuePresales)} + Tavoli ${formatEur(summary.revenueTables)})`,
    `• Busta totale: ${formatEur(summary.bustaTotal, true)}${summary.bonusAmount > 0 ? ` (incl. bonus ${formatEur(summary.bonusAmount)})` : ''}`,
    `• Scarico: ${formatEur(summary.scaricoTotal)} | Scaricato: ${formatEur(summary.scaricatoTotal)} | Mancanti: ${formatEur(summary.mancantiTotal)}`,
    ``,
    `*Dettaglio PR*`,
  ];

  for (const pid of summary.promoterOrder) {
    const pr = summary.byPromoter[pid];
    if (!pr) continue;
    lines.push(
      `• *${nameOf(pid)}*: ${pr.pxTotal} px | Scarico ${formatEur(pr.scaricoTotal)} | Mancanti ${formatEur(pr.mancanti)} | Busta ${formatEur(pr.bustaTotal, true)}`
    );
  }

  if (event.tables.length > 0) {
    lines.push('', `*Tavoli (${event.tables.length})*`);
    for (const t of event.tables) {
      const px = (Number(t.payers_count) || 0) + (Number(t.surcharge_payers_count) || 0);
      const cred =
        (Number(t.payers_count) || 0) * (Number(t.price) || 0) +
        (Number(t.surcharge_payers_count) || 0) * (Number(t.surcharge_price) || 0) +
        (Number(t.extra_no_scarico) || 0) +
        (Number(t.extra_si_scarico) || 0);
      lines.push(`• ${t.table_name} (${nameOf(t.promoter_id)}): ${px} px — ${formatEur(cred)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parses pasted TicketSMS / Excel / CSV promoter presales report.
 * Supports Italian decimals (comma) and flexible column headers.
 */
export function parsePresaleReport(
  rawText: string,
  promoters: Promoter[]
): { promoterId: string; quantity: number; revenue: number; one_to_one: number }[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const rows = lines.map((l) => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, '')));

  const parseItNum = (v: string | undefined) => {
    if (!v) return 0;
    const cleaned = v.replace(/[€\s]/g, '').replace(/\.(?=\d{3}(?:[,.]|$))/g, '').replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  const matchPromoter = (label: string): string | null => {
    const low = label.toLowerCase().trim();
    if (!low || low === 'promoter' || low === 'totale') return null;
    if (low === 'io') return 'lollo';
    for (const p of promoters) {
      if (
        low.includes(p.id.toLowerCase()) ||
        low.includes(p.display_name.toLowerCase()) ||
        low.includes(p.full_name.toLowerCase())
      ) {
        return p.id;
      }
      const parts = p.full_name.toLowerCase().split(/\s+/);
      if (parts.some((part) => part.length > 3 && low.includes(part))) {
        return p.id;
      }
    }
    return null;
  };

  const header = rows[0].map((h) => h.toLowerCase());
  const hasHeader = header.some(
    (h) => h.includes('promoter') || h.includes('incasso') || h.includes('prevend') || h.includes('online')
  );

  // Detect format: 4-col summary (Promoter | Totale Prevendite | Incasso | One to One)
  // OR 10-12 col TicketSMS detail (Promoter | Tipologia | Prezzo | Online | Incasso Online | One to One | Incasso One To One | Cassa | Incasso Cassa | Totale | Incasso | N preve)
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const totals = new Map<string, { quantity: number; revenue: number; one_to_one: number }>();

  for (const row of dataRows) {
    const pid = matchPromoter(row[0] || '');
    if (!pid) continue;
    const acc = totals.get(pid) || { quantity: 0, revenue: 0, one_to_one: 0 };

    if (row.length >= 10) {
      // TicketSMS style
      const onlineQty = parseItNum(row[3]);
      const otoQty = parseItNum(row[5]);
      const otoRev = parseItNum(row[6]);
      const cassaQty = parseItNum(row[7]);
      const totRev = parseItNum(row[10]);
      const nPreve = row[11] ? parseItNum(row[11]) : onlineQty + otoQty + cassaQty;
      acc.quantity += Math.round(nPreve);
      acc.revenue += totRev;
      acc.one_to_one += otoRev;
    } else if (row.length >= 4) {
      acc.quantity += Math.round(parseItNum(row[1]));
      acc.revenue += parseItNum(row[2]);
      acc.one_to_one += parseItNum(row[3]);
    } else if (row.length >= 2) {
      acc.quantity += Math.round(parseItNum(row[1]));
      acc.revenue += parseItNum(row[2]);
    }
    totals.set(pid, acc);
  }

  return Array.from(totals.entries()).map(([promoterId, v]) => ({
    promoterId,
    quantity: v.quantity,
    revenue: Math.round(v.revenue * 100) / 100,
    one_to_one: Math.round(v.one_to_one * 100) / 100,
  }));
}

export function exportEventsToCsv(
  events: FullEvent[],
  summaries: Map<string, EventSummary>
): string {
  const headers = [
    'Data',
    'Locale',
    'Serata',
    'Modalita',
    'PX Preve',
    'PX Tavoli',
    'PX Totali',
    'Eur Preve',
    'Eur Tavoli',
    'Fatturato Totale',
    'Bonus',
    'Busta Totale',
    'Busta Lollo',
    'Busta Ciccio',
    'Busta Saldata',
    'Scarico',
    'Scaricato',
    'Mancanti',
  ];

  const escape = (v: string | number | boolean) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const rows = events.map((ev) => {
    const s = summaries.get(ev.id);
    return [
      ev.event_date,
      ev.venue_name,
      ev.title,
      ev.mode,
      s?.pxPresales ?? 0,
      s?.pxTables ?? 0,
      s?.pxTotal ?? 0,
      s?.revenuePresales ?? 0,
      s?.revenueTables ?? 0,
      s?.revenueTotal ?? 0,
      s?.bonusAmount ?? 0,
      s?.bustaTotal ?? 0,
      s?.byPromoter['lollo']?.bustaTotal ?? 0,
      s?.byPromoter['ciccio']?.bustaTotal ?? 0,
      ev.is_busta_paid ? 'SI' : 'NO',
      s?.scaricoTotal ?? 0,
      s?.scaricatoTotal ?? 0,
      s?.mancantiTotal ?? 0,
    ]
      .map(escape)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
