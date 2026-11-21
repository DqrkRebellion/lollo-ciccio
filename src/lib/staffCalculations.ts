import { round2 } from './calculations';
import type {
  ComputedStaffPresale,
  ComputedStaffTable,
  StaffCommissionPlan,
  StaffEventPresale,
  StaffEventSummary,
  StaffEventTable,
  StaffGroup,
  StaffMember,
  StaffMemberEventRollup,
  StaffTier,
} from '../types/staff';

export const DEFAULT_PRESALE_TIERS: StaffTier[] = [
  { min: 40, inclusive: false, rate: 1.0 },
  { min: 20, inclusive: false, rate: 0.5 },
];

export const DEFAULT_TABLE_TIERS: StaffTier[] = [
  { min: 1000, inclusive: true, rate: 0.07 },
  { min: 400, inclusive: true, rate: 0.04 },
];

export function evaluateTierRate(
  value: number,
  tiers: StaffTier[]
): { rate: number; matched: StaffTier | null; nextTier: StaffTier | null } {
  const sortedDesc = [...tiers]
    .map((t) => ({
      min: Number(t.min) || 0,
      inclusive: Boolean(t.inclusive),
      rate: Number(t.rate) || 0,
    }))
    .sort((a, b) => b.min - a.min);

  let matched: StaffTier | null = null;
  for (const tier of sortedDesc) {
    const hit = tier.inclusive ? value >= tier.min : value > tier.min;
    if (hit) {
      matched = tier;
      break;
    }
  }

  const sortedAsc = [...sortedDesc].reverse();
  let nextTier: StaffTier | null = null;
  for (const tier of sortedAsc) {
    const hit = tier.inclusive ? value >= tier.min : value > tier.min;
    if (!hit) {
      nextTier = tier;
      break;
    }
  }

  return {
    rate: matched ? matched.rate : 0,
    matched,
    nextTier,
  };
}

export function resolveMemberRules(
  member: StaffMember | null,
  plansById: Map<string, StaffCommissionPlan>,
  group: StaffGroup | null
): { presaleTiers: StaffTier[]; tableTiers: StaffTier[]; planName: string; isSelf: boolean } {
  if (member?.is_self) {
    return { presaleTiers: [], tableTiers: [], planName: 'Capo / Io', isSelf: true };
  }

  const defaultPresale = group?.default_presale_tiers ?? DEFAULT_PRESALE_TIERS;
  const defaultTable = group?.default_table_tiers ?? DEFAULT_TABLE_TIERS;
  const plan = member?.plan_id ? plansById.get(member.plan_id) : undefined;

  const hasCustomPresale = Array.isArray(member?.custom_presale_tiers);
  const hasCustomTable = Array.isArray(member?.custom_table_tiers);

  return {
    presaleTiers: hasCustomPresale
      ? (member!.custom_presale_tiers as StaffTier[])
      : plan
        ? plan.presale_tiers
        : defaultPresale,
    tableTiers: hasCustomTable
      ? (member!.custom_table_tiers as StaffTier[])
      : plan
        ? plan.table_tiers
        : defaultTable,
    planName:
      hasCustomPresale || hasCustomTable
        ? 'Personalizzato'
        : plan?.name || 'Standard',
    isSelf: false,
  };
}

export function matchStaffMemberByName(
  rawName: string,
  members: StaffMember[]
): StaffMember | null {
  const clean = rawName.trim().toLowerCase();
  if (!clean) return null;

  for (const m of members) {
    if (m.full_name.toLowerCase() === clean) return m;
    if (m.nickname && m.nickname.toLowerCase() === clean) return m;
    if (Array.isArray(m.aliases) && m.aliases.some((a) => a.toLowerCase() === clean)) {
      return m;
    }
  }

  // Soft check for "io (...)"
  if (clean === 'io' || clean.startsWith('io (')) {
    const selfMember = members.find((m) => m.is_self);
    if (selfMember) return selfMember;
  }

  return null;
}

export function computeStaffEventSummary(
  eventId: string,
  rawPresales: StaffEventPresale[],
  rawTables: StaffEventTable[],
  members: StaffMember[],
  plans: StaffCommissionPlan[],
  group: StaffGroup | null
): StaffEventSummary {
  const membersById = new Map<string, StaffMember>();
  for (const m of members) membersById.set(m.id, m);

  const plansById = new Map<string, StaffCommissionPlan>();
  for (const p of plans) plansById.set(p.id, p);

  const sumTablesPerPr = group ? group.sum_tables_per_pr : true;

  const resolveMemberAndKey = (
    memberId: string | null,
    promoterName: string
  ): { key: string; member: StaffMember | null } => {
    if (memberId && membersById.has(memberId)) {
      const m = membersById.get(memberId)!;
      return { key: `m:${m.id}`, member: m };
    }
    const matched = matchStaffMemberByName(promoterName, members);
    if (matched) {
      return { key: `m:${matched.id}`, member: matched };
    }
    return { key: `n:${promoterName.trim().toLowerCase() || 'altro'}`, member: null };
  };

  // 1. Pre-aggregate table credits per sub-PR so multiple tables sum together for tiers!
  const tableCreditByMember = new Map<string, { totalCredit: number; count: number }>();
  const rawTableInfo = rawTables.map((row) => {
    const { key, member } = resolveMemberAndKey(row.staff_member_id, row.promoter_name);
    const p1 = Number(row.payers_count) || 0;
    const pr1 = Number(row.price) || 0;
    const p2 = Number(row.surcharge_payers_count) || 0;
    const pr2 = Number(row.surcharge_price) || 0;
    const exSi = Number(row.extra) || 0;
    const exNo = Number(row.extra_no_scarico) || 0;
    const px = p1 + p2;
    const scaricoBase = round2(p1 * pr1 + p2 * pr2 + exSi);
    const credito = round2(scaricoBase + exNo);
    const scaricoApplied = (row.scarico_status || 'DA SCARICARE') === 'DA SCARICARE' ? scaricoBase : 0;
    const paidCash = Number(row.paid_cash) || 0;
    const mancanti = round2(scaricoApplied - paidCash);

    const prev = tableCreditByMember.get(key) || { totalCredit: 0, count: 0 };
    prev.totalCredit = round2(prev.totalCredit + credito);
    prev.count += 1;
    tableCreditByMember.set(key, prev);

    return { row, key, member, px, credito, scaricoBase, scaricoApplied, mancanti };
  });

  // 2. Compute Tables with combined-credit tier lookup
  const computedTables: ComputedStaffTable[] = rawTableInfo.map((info) => {
    const rules = resolveMemberRules(info.member, plansById, group);
    const agg = tableCreditByMember.get(info.key) || {
      totalCredit: info.credito,
      count: 1,
    };
    const tierBase = sumTablesPerPr ? agg.totalCredit : info.credito;
    const { rate } = evaluateTierRate(tierBase, rules.tableTiers);
    const bustaAuto = round2(info.credito * rate);
    const isOverridden =
      info.row.busta_override !== null && info.row.busta_override !== undefined;
    const bustaFinal = isOverridden ? round2(Number(info.row.busta_override)) : bustaAuto;

    return {
      row: info.row,
      memberKey: info.key,
      member: info.member,
      planName: rules.planName,
      px: info.px,
      credito: info.credito,
      scaricoBase: info.scaricoBase,
      scaricoApplied: info.scaricoApplied,
      mancanti: info.mancanti,
      combinedMemberCredit: agg.totalCredit,
      combinedMemberTablesCount: agg.count,
      rateApplied: rate,
      bustaAuto,
      bustaFinal,
      isOverridden,
    };
  });

  // 3. Compute Presales (also aggregate quantities if same sub-PR appears twice)
  const presaleQtyByMember = new Map<string, number>();
  const rawPresaleInfo = rawPresales.map((row) => {
    const { key, member } = resolveMemberAndKey(row.staff_member_id, row.promoter_name);
    const qty = Number(row.quantity) || 0;
    presaleQtyByMember.set(key, (presaleQtyByMember.get(key) || 0) + qty);
    return { row, key, member, qty };
  });

  const computedPresales: ComputedStaffPresale[] = rawPresaleInfo.map((info) => {
    const rules = resolveMemberRules(info.member, plansById, group);
    const totalQtyForMember = presaleQtyByMember.get(info.key) || info.qty;
    const { rate } = evaluateTierRate(totalQtyForMember, rules.presaleTiers);
    const bustaAuto = round2(info.qty * rate);
    const isOverridden =
      info.row.busta_override !== null && info.row.busta_override !== undefined;
    const bustaFinal = isOverridden ? round2(Number(info.row.busta_override)) : bustaAuto;
    const mancanti = round2(
      (Number(info.row.scarico) || 0) +
        (Number(info.row.note_amount) || 0) -
        (Number(info.row.paid_cash) || 0)
    );

    return {
      row: info.row,
      memberKey: info.key,
      member: info.member,
      planName: rules.planName,
      mancanti,
      rateApplied: rate,
      bustaAuto,
      bustaFinal,
      isOverridden,
    };
  });

  // 4. Unified Rollup per Sub-PR (combines their Prevendite + Tavoli in ONE card!)
  const rollupMap = new Map<string, StaffMemberEventRollup>();
  const ensureRollup = (
    key: string,
    member: StaffMember | null,
    fallbackName: string,
    planName: string
  ): StaffMemberEventRollup => {
    let r = rollupMap.get(key);
    if (!r) {
      r = {
        memberKey: key,
        member,
        displayName: member?.nickname || member?.full_name || fallbackName,
        fullName: member?.full_name || fallbackName,
        planName,
        isSelf: Boolean(member?.is_self),
        pxPresales: 0,
        pxTables: 0,
        pxTotal: 0,
        presalesRevenue: 0,
        presalesScarico: 0,
        presalesNote: 0,
        presalesPaidCash: 0,
        presalesMancanti: 0,
        presalesBusta: 0,
        presalesRateApplied: 0,
        tablesCount: 0,
        tablesCredito: 0,
        tablesScarico: 0,
        tablesPaidCash: 0,
        tablesMancanti: 0,
        tablesBusta: 0,
        tablesRateApplied: 0,
        scaricoTotal: 0,
        paidCashTotal: 0,
        mancantiTotal: 0,
        bustaTotal: 0,
        bustaPaidAmount: 0,
        bustaUnpaidAmount: 0,
        allBustaPaid: true,
        presaleRows: [],
        tableRows: [],
      };
      rollupMap.set(key, r);
    }
    return r;
  };

  for (const cp of computedPresales) {
    const r = ensureRollup(cp.memberKey, cp.member, cp.row.promoter_name, cp.planName);
    r.pxPresales += Number(cp.row.quantity) || 0;
    r.presalesRevenue = round2(r.presalesRevenue + (Number(cp.row.revenue) || 0));
    r.presalesScarico = round2(r.presalesScarico + (Number(cp.row.scarico) || 0));
    r.presalesNote = round2(r.presalesNote + (Number(cp.row.note_amount) || 0));
    r.presalesPaidCash = round2(r.presalesPaidCash + (Number(cp.row.paid_cash) || 0));
    r.presalesMancanti = round2(r.presalesMancanti + cp.mancanti);
    r.presalesBusta = round2(r.presalesBusta + cp.bustaFinal);
    r.presalesRateApplied = Math.max(r.presalesRateApplied, cp.rateApplied);
    if (cp.row.is_busta_paid) {
      r.bustaPaidAmount = round2(r.bustaPaidAmount + cp.bustaFinal);
    } else if (cp.bustaFinal > 0) {
      r.bustaUnpaidAmount = round2(r.bustaUnpaidAmount + cp.bustaFinal);
      r.allBustaPaid = false;
    }
    r.presaleRows.push(cp);
  }

  for (const ct of computedTables) {
    const r = ensureRollup(ct.memberKey, ct.member, ct.row.promoter_name, ct.planName);
    r.tablesCount += 1;
    r.pxTables += ct.px;
    r.tablesCredito = round2(r.tablesCredito + ct.credito);
    r.tablesScarico = round2(r.tablesScarico + ct.scaricoApplied);
    r.tablesPaidCash = round2(r.tablesPaidCash + (Number(ct.row.paid_cash) || 0));
    r.tablesMancanti = round2(r.tablesMancanti + ct.mancanti);
    r.tablesBusta = round2(r.tablesBusta + ct.bustaFinal);
    r.tablesRateApplied = Math.max(r.tablesRateApplied, ct.rateApplied);
    if (ct.row.is_busta_paid) {
      r.bustaPaidAmount = round2(r.bustaPaidAmount + ct.bustaFinal);
    } else if (ct.bustaFinal > 0) {
      r.bustaUnpaidAmount = round2(r.bustaUnpaidAmount + ct.bustaFinal);
      r.allBustaPaid = false;
    }
    r.tableRows.push(ct);
  }

  const membersRollup = Array.from(rollupMap.values())
    .map((r) => {
      r.pxTotal = r.pxPresales + r.pxTables;
      r.scaricoTotal = round2(r.presalesScarico + r.presalesNote + r.tablesScarico);
      r.paidCashTotal = round2(r.presalesPaidCash + r.tablesPaidCash);
      r.mancantiTotal = round2(r.scaricoTotal - r.paidCashTotal);
      r.bustaTotal = round2(r.presalesBusta + r.tablesBusta);
      if (r.bustaTotal <= 0) r.allBustaPaid = true;
      return r;
    })
    .sort((a, b) => b.bustaTotal - a.bustaTotal || b.pxTotal - a.pxTotal);

  // 5. Event Staff Totals
  const pxPresales = computedPresales.reduce((acc, p) => acc + (Number(p.row.quantity) || 0), 0);
  const pxTables = computedTables.reduce((acc, t) => acc + t.px, 0);
  const presalesRevenue = round2(
    computedPresales.reduce((acc, p) => acc + (Number(p.row.revenue) || 0), 0)
  );
  const tablesCredito = round2(computedTables.reduce((acc, t) => acc + t.credito, 0));
  const tablesScarico = round2(computedTables.reduce((acc, t) => acc + t.scaricoApplied, 0));
  const totalScarico = round2(
    computedPresales.reduce(
      (acc, p) => acc + (Number(p.row.scarico) || 0) + (Number(p.row.note_amount) || 0),
      0
    ) + tablesScarico
  );
  const totalPaidCash = round2(
    computedPresales.reduce((acc, p) => acc + (Number(p.row.paid_cash) || 0), 0) +
      computedTables.reduce((acc, t) => acc + (Number(t.row.paid_cash) || 0), 0)
  );
  const totalMancanti = round2(totalScarico - totalPaidCash);
  const totalBustaPresales = round2(
    computedPresales.reduce((acc, p) => acc + p.bustaFinal, 0)
  );
  const totalBustaTables = round2(computedTables.reduce((acc, t) => acc + t.bustaFinal, 0));
  const totalBusta = round2(totalBustaPresales + totalBustaTables);
  const totalBustaPaid = round2(
    computedPresales.reduce((acc, p) => acc + (p.row.is_busta_paid ? p.bustaFinal : 0), 0) +
      computedTables.reduce((acc, t) => acc + (t.row.is_busta_paid ? t.bustaFinal : 0), 0)
  );
  const totalBustaUnpaid = round2(Math.max(0, totalBusta - totalBustaPaid));

  return {
    eventId,
    pxPresales,
    pxTables,
    pxTotal: pxPresales + pxTables,
    presalesRevenue,
    tablesCredito,
    tablesScarico,
    totalScarico,
    totalPaidCash,
    totalMancanti,
    totalBustaPresales,
    totalBustaTables,
    totalBusta,
    totalBustaPaid,
    totalBustaUnpaid,
    presales: computedPresales,
    tables: computedTables,
    membersRollup,
  };
}

function normalizePromoterKey(name: string): string {
  return name
    .replace(/\s*\(\s*\+\s*\d+\s*pr\s*\)\s*$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isExcludedPromoterName(rawName: string, excludedNormalized: string[]): boolean {
  if (excludedNormalized.length === 0) return false;
  const cleaned = normalizePromoterKey(rawName);
  if (!cleaned) return false;
  const tokens = cleaned.split(' ');
  const tokenSet = new Set(tokens);
  for (const ex of excludedNormalized) {
    if (cleaned === ex) return true;
    const exTokens = ex.split(' ');
    if (tokens.length >= 2 && exTokens.length === tokens.length) {
      if (exTokens.every((t) => tokenSet.has(t))) return true;
    }
  }
  return false;
}

/**
 * Parses pasted TicketSMS / Excel table directly for Staff sub-PRs (A1:L format from FOGLIO REVERSE).
 * Aggregates Online + One-to-One + Cassa quantities, Incasso (€), and One-to-One Scarico (€) per promoter!
 */
export function parseStaffTicketSmsReport(
  rawText: string,
  options?: { excludePromoters?: string[] }
): { promoterName: string; quantity: number; revenue: number; scarico: number }[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const excludedNormalized = (options?.excludePromoters || [])
    .map(normalizePromoterKey)
    .filter(Boolean);

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const rows = lines.map((l) => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, '')));

  const parseNum = (v: string | undefined) => {
    if (!v) return 0;
    const cleaned = v
      .replace(/[€\s]/g, '')
      .replace(/\.(?=\d{3}(?:[,.]|$))/g, '')
      .replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  const firstLower = rows[0].map((c) => c.toLowerCase());
  const hasHeader = firstLower.some(
    (c) => c.includes('promoter') || c.includes('tipologia') || c.includes('incasso') || c.includes('preve')
  );
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const grouped = new Map<
    string,
    { promoterName: string; quantity: number; revenue: number; scarico: number }
  >();

  for (const row of dataRows) {
    const name = (row[0] || '').trim();
    if (!name || name.toLowerCase() === 'totale' || name.toLowerCase() === 'promoter') continue;
    if (isExcludedPromoterName(name, excludedNormalized)) continue;
    const key = name.toLowerCase();
    const acc = grouped.get(key) || { promoterName: name, quantity: 0, revenue: 0, scarico: 0 };

    if (row.length >= 10) {
      // Exact FOGLIO REVERSE A1:L TicketSMS format:
      // 0:Promoter 1:Tipologia 2:Prezzo 3:Online 4:IncOnline 5:OneToOne 6:IncOneToOne 7:Cassa 8:IncCassa 9:Totale 10:Incasso 11:NPreve
      const online = parseNum(row[3]);
      const oto = parseNum(row[5]);
      const incOto = parseNum(row[6]);
      const cassa = parseNum(row[7]);
      const incTot = parseNum(row[10]);
      const qty = row[11] ? parseNum(row[11]) : online + oto + cassa;
      acc.quantity += Math.round(qty);
      acc.revenue = round2(acc.revenue + incTot);
      acc.scarico = round2(acc.scarico + incOto);
    } else if (row.length >= 4) {
      // Summary 4-col format: Promoter | N. preve | € preve | Scarico
      acc.quantity += Math.round(parseNum(row[1]));
      acc.revenue = round2(acc.revenue + parseNum(row[2]));
      acc.scarico = round2(acc.scarico + parseNum(row[3]));
    } else if (row.length >= 2) {
      acc.quantity += Math.round(parseNum(row[1]));
      acc.revenue = round2(acc.revenue + parseNum(row[2]));
      acc.scarico = round2(acc.scarico + parseNum(row[2]));
    }
    grouped.set(key, acc);
  }

  return Array.from(grouped.values()).filter(
    (r) => r.quantity > 0 || r.revenue > 0 || r.scarico > 0
  );
}
