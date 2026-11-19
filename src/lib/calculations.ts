import type {
  AppSettings,
  BonusTier,
  CommissionRules,
  EventMode,
  EventSummary,
  EventTable,
  FullEvent,
  PrSummary,
  TableComputed,
} from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  team_name: 'Lollo & Ciccio',
  presale_commission: 1,
  table_rate_no_guest: 0.1,
  table_rate_guest: 0.08,
  default_lista_cost: 0,
  bonus_tiers: [
    { threshold: 10000, bonus: 400 },
    { threshold: 6000, bonus: 300 },
    { threshold: 4000, bonus: 200 },
    { threshold: 2000, bonus: 100 },
  ],
  bonus_split_mode: 'revenue_proportional',
  default_presale_input_mode: 'per_pr',
  default_table_scarico: 'DA SCARICARE',
  quick_table_prices: [25, 30, 35, 50],
  show_surcharge_columns: false,
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeTable(
  table: Pick<
    EventTable,
    | 'payers_count'
    | 'price'
    | 'surcharge_payers_count'
    | 'surcharge_price'
    | 'extra_no_scarico'
    | 'extra_si_scarico'
    | 'scarico_status'
  >
): TableComputed {
  const p1 = Number(table.payers_count) || 0;
  const pr1 = Number(table.price) || 0;
  const p2 = Number(table.surcharge_payers_count) || 0;
  const pr2 = Number(table.surcharge_price) || 0;
  const exNo = Number(table.extra_no_scarico) || 0;
  const exSi = Number(table.extra_si_scarico) || 0;

  const px = p1 + p2;
  const scaricoBase = round2(p1 * pr1 + p2 * pr2 + exSi);
  const credito = round2(scaricoBase + exNo);
  const scaricoApplied = table.scarico_status === 'DA SCARICARE' ? scaricoBase : 0;

  return { px, credito, scaricoBase, scaricoApplied };
}

export function getTableRate(mode: EventMode, rules: CommissionRules): number {
  if (mode === 'OSPITE') return Number(rules.table_rate_guest) || 0;
  if (mode === 'NO OSPITE') return Number(rules.table_rate_no_guest) || 0;
  return 0;
}

export function evaluateBonusTiers(
  revenueTotal: number,
  mode: EventMode,
  tiers: BonusTier[]
): { bonusAmount: number; nextTier: BonusTier | null; amountToNext: number } {
  const sortedAsc = [...tiers]
    .map((t) => ({ threshold: Number(t.threshold) || 0, bonus: Number(t.bonus) || 0 }))
    .filter((t) => t.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);

  if (mode === '-' || sortedAsc.length === 0) {
    return { bonusAmount: 0, nextTier: sortedAsc[0] ?? null, amountToNext: 0 };
  }

  let matchedBonus = 0;
  let nextTier: BonusTier | null = null;
  for (const tier of sortedAsc) {
    if (revenueTotal > tier.threshold) {
      matchedBonus = tier.bonus;
    } else if (!nextTier) {
      nextTier = tier;
    }
  }

  const amountToNext = nextTier ? round2(Math.max(0, nextTier.threshold - revenueTotal)) : 0;
  return { bonusAmount: matchedBonus, nextTier, amountToNext };
}

export function resolveRules(event: FullEvent, settings: AppSettings): CommissionRules {
  const ov = event.commission_config;
  return {
    presale_commission: ov?.presale_commission ?? Number(settings.presale_commission ?? 1),
    table_rate_no_guest: ov?.table_rate_no_guest ?? Number(settings.table_rate_no_guest ?? 0.1),
    table_rate_guest: ov?.table_rate_guest ?? Number(settings.table_rate_guest ?? 0.08),
    bonus_tiers: ov?.bonus_tiers ?? settings.bonus_tiers ?? DEFAULT_SETTINGS.bonus_tiers,
    bonus_split_mode: ov?.bonus_split_mode ?? settings.bonus_split_mode ?? 'revenue_proportional',
  };
}

export function computeEventSummary(
  event: FullEvent,
  settings: AppSettings,
  activePromoterIds: string[] = ['lollo', 'ciccio']
): EventSummary {
  const rules = resolveRules(event, settings);
  const listaCost = Number(event.lista_cost) || 0;

  const promoterSet = new Set<string>(activePromoterIds);
  for (const p of event.presales) promoterSet.add(p.promoter_id);
  for (const t of event.tables) promoterSet.add(t.promoter_id);
  for (const r of event.reconciliations) promoterSet.add(r.promoter_id);

  if (event.era === '2PX' && !activePromoterIds.includes('filo')) {
    const filoHasData =
      event.presales.some((p) => p.promoter_id === 'filo' && (p.quantity > 0 || p.revenue > 0)) ||
      event.tables.some((t) => t.promoter_id === 'filo') ||
      event.reconciliations.some(
        (r) => r.promoter_id === 'filo' && (r.scaricato_amount !== 0 || r.note_amount !== 0)
      );
    if (!filoHasData) promoterSet.delete('filo');
  }
  const promoterOrder = Array.from(promoterSet);

  const byPromoter: Record<string, PrSummary> = {};
  for (const pid of promoterOrder) {
    byPromoter[pid] = {
      promoterId: pid,
      pxPresales: 0,
      pxTables: 0,
      pxTotal: 0,
      revenuePresales: 0,
      oneToOnePresales: 0,
      revenueTables: 0,
      revenueTotal: 0,
      tablesCount: 0,
      listaPrCount: 0,
      listaPrCost: 0,
      scaricoTables: 0,
      scaricoTotal: 0,
      noteAmount: 0,
      noteText: '',
      scaricatoAmount: 0,
      mancanti: 0,
      bustaPresales: 0,
      bustaTables: 0,
      bustaBonusShare: 0,
      bustaTotal: 0,
    };
  }

  for (const p of event.presales) {
    const bucket = byPromoter[p.promoter_id];
    if (!bucket) continue;
    bucket.pxPresales += Number(p.quantity) || 0;
    bucket.revenuePresales = round2(bucket.revenuePresales + (Number(p.revenue) || 0));
    bucket.oneToOnePresales = round2(bucket.oneToOnePresales + (Number(p.one_to_one) || 0));
  }

  for (const t of event.tables) {
    const bucket = byPromoter[t.promoter_id];
    if (!bucket) continue;
    const tc = computeTable(t);
    bucket.tablesCount += 1;
    bucket.pxTables += tc.px;
    bucket.revenueTables = round2(bucket.revenueTables + tc.credito);
    bucket.scaricoTables = round2(bucket.scaricoTables + tc.scaricoApplied);
  }

  for (const r of event.reconciliations) {
    const bucket = byPromoter[r.promoter_id];
    if (!bucket) continue;
    bucket.listaPrCount = Number(r.lista_pr_count) || 0;
    bucket.listaPrCost = round2(bucket.listaPrCount * listaCost);
    bucket.noteAmount = Number(r.note_amount) || 0;
    bucket.noteText = r.note_text || '';
    bucket.scaricatoAmount = Number(r.scaricato_amount) || 0;
  }

  let pxPresales = 0;
  let pxTables = 0;
  let revenuePresales = 0;
  let oneToOnePresales = 0;
  let revenueTables = 0;
  let listaPrTotalCount = 0;
  let listaPrTotalCost = 0;
  let scaricoTables = 0;
  let scaricatoTotal = 0;

  for (const pid of promoterOrder) {
    const b = byPromoter[pid];
    b.pxTotal = b.pxPresales + b.pxTables;
    b.revenueTotal = round2(b.revenuePresales + b.revenueTables);
    b.scaricoTotal = round2(b.oneToOnePresales + b.scaricoTables + b.listaPrCost);
    b.mancanti = round2(b.scaricoTotal + b.noteAmount - b.scaricatoAmount);

    pxPresales += b.pxPresales;
    pxTables += b.pxTables;
    revenuePresales = round2(revenuePresales + b.revenuePresales);
    oneToOnePresales = round2(oneToOnePresales + b.oneToOnePresales);
    revenueTables = round2(revenueTables + b.revenueTables);
    listaPrTotalCount += b.listaPrCount;
    listaPrTotalCost = round2(listaPrTotalCost + b.listaPrCost);
    scaricoTables = round2(scaricoTables + b.scaricoTables);
    scaricatoTotal = round2(scaricatoTotal + b.scaricatoAmount);
  }

  const pxTotal = pxPresales + pxTables;
  const revenueTotal = round2(revenuePresales + revenueTables);
  const scaricoTotal = round2(oneToOnePresales + scaricoTables + listaPrTotalCost);
  const generalNoteAmount = Number(event.general_note_amount) || 0;
  const totalPrNotes = round2(promoterOrder.reduce((acc, pid) => acc + byPromoter[pid].noteAmount, 0));
  const mancantiTotal = round2(scaricoTotal + generalNoteAmount + totalPrNotes - scaricatoTotal);

  const tableRate = getTableRate(event.mode, rules);
  const { bonusAmount, nextTier, amountToNext } = evaluateBonusTiers(
    revenueTotal,
    event.mode,
    rules.bonus_tiers
  );

  const isModeDisabled = event.mode === '-';
  const bustaPresales = isModeDisabled ? 0 : round2(pxPresales * rules.presale_commission);
  const bustaTables = isModeDisabled ? 0 : round2(revenueTables * tableRate);
  const formulaBustaTotal = isModeDisabled ? 0 : round2(bustaPresales + bustaTables + bonusAmount);
  const isBustaOverridden = event.busta_override !== null && event.busta_override !== undefined;
  const bustaTotal = isBustaOverridden ? round2(Number(event.busta_override)) : formulaBustaTotal;

  const activeContributors = promoterOrder.filter(
    (pid) => byPromoter[pid].revenueTotal > 0 || byPromoter[pid].pxTotal > 0
  );

  for (const pid of promoterOrder) {
    const b = byPromoter[pid];
    if (isModeDisabled) {
      b.bustaPresales = 0;
      b.bustaTables = 0;
      b.bustaBonusShare = 0;
      b.bustaTotal = 0;
      continue;
    }
    b.bustaPresales = round2(b.pxPresales * rules.presale_commission);
    b.bustaTables = round2(b.revenueTables * tableRate);

    let bonusShareRatio = 0;
    if (rules.bonus_split_mode === 'equal') {
      bonusShareRatio =
        activeContributors.length > 0 && activeContributors.includes(pid)
          ? 1 / activeContributors.length
          : 0;
    } else if (rules.bonus_split_mode === 'px_proportional') {
      bonusShareRatio = pxTotal > 0 ? b.pxTotal / pxTotal : 0;
    } else {
      bonusShareRatio = revenueTotal > 0 ? b.revenueTotal / revenueTotal : 0;
    }

    b.bustaBonusShare = round2(bonusAmount * bonusShareRatio);
    const prFormulaTotal = round2(b.bustaPresales + b.bustaTables + b.bustaBonusShare);
    if (isBustaOverridden && formulaBustaTotal > 0) {
      b.bustaTotal = round2(bustaTotal * (prFormulaTotal / formulaBustaTotal));
    } else if (isBustaOverridden && revenueTotal > 0) {
      b.bustaTotal = round2(bustaTotal * (b.revenueTotal / revenueTotal));
    } else {
      b.bustaTotal = prFormulaTotal;
    }
  }

  return {
    pxPresales,
    pxTables,
    pxTotal,
    revenuePresales,
    oneToOnePresales,
    revenueTables,
    revenueTotal,
    tableRate,
    bonusAmount,
    nextBonusTier: nextTier,
    amountToNextBonus: amountToNext,
    bustaPresales,
    bustaTables,
    bustaTotal,
    isBustaOverridden,
    listaPrTotalCount,
    listaPrTotalCost,
    scaricoTables,
    scaricoTotal,
    generalNoteAmount,
    scaricatoTotal,
    mancantiTotal,
    byPromoter,
    promoterOrder,
  };
}
