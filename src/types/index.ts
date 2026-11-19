export type EventMode = 'NO OSPITE' | 'OSPITE' | '-';
export type ScaricoStatus = 'DA SCARICARE' | 'DA NON SCARICARE' | '-';
export type BonusSplitMode = 'revenue_proportional' | 'equal' | 'px_proportional';
export type PresaleInputMode = 'per_pr' | 'total_minus_primary';
export type EventEra = '2PX' | '3PX';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface BonusTier {
  threshold: number;
  bonus: number;
}

export interface AppSettings {
  id: number;
  team_name: string;
  presale_commission: number;
  table_rate_no_guest: number;
  table_rate_guest: number;
  default_lista_cost: number;
  bonus_tiers: BonusTier[];
  bonus_split_mode: BonusSplitMode;
  default_presale_input_mode: PresaleInputMode;
  default_table_scarico: ScaricoStatus;
  quick_table_prices: number[];
  show_surcharge_columns: boolean;
  updated_at?: string;
}

export interface Promoter {
  id: string;
  display_name: string;
  full_name: string;
  color: string;
  is_active: boolean;
  sort_order: number;
}

export interface Venue {
  id: string;
  name: string;
  color: string;
  default_mode: EventMode;
  default_table_price: number;
  default_lista_cost: number;
  is_archived: boolean;
}

export interface EventRecord {
  id: string;
  title: string;
  sheet_name: string | null;
  venue_id: string | null;
  venue_name: string;
  event_date: string; // YYYY-MM-DD
  mode: EventMode;
  era: EventEra;
  is_busta_paid: boolean;
  lista_cost: number;
  general_note_amount: number;
  general_note_text: string;
  presale_input_mode: PresaleInputMode;
  busta_override: number | null;
  commission_config: Partial<CommissionRules> | null;
  created_at?: string;
  updated_at?: string;
}

export interface EventPresale {
  id: string;
  event_id: string;
  promoter_id: string;
  quantity: number;
  revenue: number;
  one_to_one: number;
}

export interface EventTable {
  id: string;
  event_id: string;
  promoter_id: string;
  table_name: string;
  payers_count: number;
  price: number;
  surcharge_payers_count: number;
  surcharge_price: number;
  extra_no_scarico: number;
  extra_si_scarico: number;
  scarico_status: ScaricoStatus;
  sort_order: number;
}

export interface EventPrReconciliation {
  id: string;
  event_id: string;
  promoter_id: string;
  lista_pr_count: number;
  note_amount: number;
  note_text: string;
  scaricato_amount: number;
}

export interface FullEvent extends EventRecord {
  presales: EventPresale[];
  tables: EventTable[];
  reconciliations: EventPrReconciliation[];
}

export interface CommissionRules {
  presale_commission: number;
  table_rate_no_guest: number;
  table_rate_guest: number;
  bonus_tiers: BonusTier[];
  bonus_split_mode: BonusSplitMode;
}

export interface TableComputed {
  px: number;
  credito: number;
  scaricoBase: number;
  scaricoApplied: number;
}

export interface PrSummary {
  promoterId: string;
  pxPresales: number;
  pxTables: number;
  pxTotal: number;
  revenuePresales: number;
  oneToOnePresales: number;
  revenueTables: number;
  revenueTotal: number;
  tablesCount: number;
  listaPrCount: number;
  listaPrCost: number;
  scaricoTables: number;
  scaricoTotal: number;
  noteAmount: number;
  noteText: string;
  scaricatoAmount: number;
  mancanti: number;
  bustaPresales: number;
  bustaTables: number;
  bustaBonusShare: number;
  bustaTotal: number;
}

export interface EventSummary {
  pxPresales: number;
  pxTables: number;
  pxTotal: number;
  revenuePresales: number;
  oneToOnePresales: number;
  revenueTables: number;
  revenueTotal: number;
  tableRate: number;
  bonusAmount: number;
  nextBonusTier: BonusTier | null;
  amountToNextBonus: number;
  bustaPresales: number;
  bustaTables: number;
  bustaTotal: number;
  isBustaOverridden: boolean;
  listaPrTotalCount: number;
  listaPrTotalCost: number;
  scaricoTables: number;
  scaricoTotal: number;
  generalNoteAmount: number;
  scaricatoTotal: number;
  mancantiTotal: number;
  byPromoter: Record<string, PrSummary>;
  promoterOrder: string[];
}
