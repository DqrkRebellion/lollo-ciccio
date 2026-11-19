export interface StaffTier {
  min: number;
  inclusive: boolean; // true: >= min (tavoli), false: > min (prevendite)
  rate: number; // € per prevendita OR decimal ratio (0.04 = 4%) for tavoli
}

export interface StaffGroup {
  owner_promoter_id: 'lollo' | 'ciccio';
  name: string; // 'Reverse' | 'Ice'
  default_presale_tiers: StaffTier[];
  default_table_tiers: StaffTier[];
  sum_tables_per_pr: boolean;
  updated_at?: string;
}

export interface StaffCommissionPlan {
  id: string;
  owner_promoter_id: 'lollo' | 'ciccio';
  name: string;
  description: string;
  presale_tiers: StaffTier[];
  table_tiers: StaffTier[];
  is_default: boolean;
}

export interface StaffMember {
  id: string;
  owner_promoter_id: 'lollo' | 'ciccio';
  full_name: string;
  nickname: string;
  aliases: string[];
  plan_id: string | null;
  custom_presale_tiers: StaffTier[] | null;
  custom_table_tiers: StaffTier[] | null;
  is_self: boolean;
  is_active: boolean;
  notes: string;
}

export interface StaffEventPresale {
  id: string;
  owner_promoter_id: 'lollo' | 'ciccio';
  event_id: string;
  staff_member_id: string | null;
  promoter_name: string;
  quantity: number;
  revenue: number;
  scarico: number;
  note_amount: number;
  note_text: string;
  paid_cash: number;
  busta_override: number | null;
  is_busta_paid: boolean;
  sort_order: number;
}

export interface StaffEventTable {
  id: string;
  owner_promoter_id: 'lollo' | 'ciccio';
  event_id: string;
  staff_member_id: string | null;
  promoter_name: string;
  table_name: string;
  payers_count: number;
  price: number;
  surcharge_payers_count: number;
  surcharge_price: number;
  extra: number;
  paid_cash: number;
  busta_override: number | null;
  is_busta_paid: boolean;
  sort_order: number;
}

export interface ComputedStaffPresale {
  row: StaffEventPresale;
  memberKey: string;
  member: StaffMember | null;
  planName: string;
  mancanti: number;
  rateApplied: number;
  bustaAuto: number;
  bustaFinal: number;
  isOverridden: boolean;
}

export interface ComputedStaffTable {
  row: StaffEventTable;
  memberKey: string;
  member: StaffMember | null;
  planName: string;
  px: number;
  credito: number;
  mancanti: number;
  combinedMemberCredit: number;
  combinedMemberTablesCount: number;
  rateApplied: number;
  bustaAuto: number;
  bustaFinal: number;
  isOverridden: boolean;
}

export interface StaffMemberEventRollup {
  memberKey: string;
  member: StaffMember | null;
  displayName: string;
  fullName: string;
  planName: string;
  isSelf: boolean;
  pxPresales: number;
  pxTables: number;
  pxTotal: number;
  presalesRevenue: number;
  presalesScarico: number;
  presalesNote: number;
  presalesPaidCash: number;
  presalesMancanti: number;
  presalesBusta: number;
  presalesRateApplied: number;
  tablesCount: number;
  tablesCredito: number;
  tablesPaidCash: number;
  tablesMancanti: number;
  tablesBusta: number;
  tablesRateApplied: number;
  scaricoTotal: number;
  paidCashTotal: number;
  mancantiTotal: number;
  bustaTotal: number;
  bustaPaidAmount: number;
  bustaUnpaidAmount: number;
  allBustaPaid: boolean;
  presaleRows: ComputedStaffPresale[];
  tableRows: ComputedStaffTable[];
}

export interface StaffEventSummary {
  eventId: string;
  pxPresales: number;
  pxTables: number;
  pxTotal: number;
  presalesRevenue: number;
  tablesCredito: number;
  totalScarico: number;
  totalPaidCash: number;
  totalMancanti: number;
  totalBustaPresales: number;
  totalBustaTables: number;
  totalBusta: number;
  totalBustaPaid: number;
  totalBustaUnpaid: number;
  presales: ComputedStaffPresale[];
  tables: ComputedStaffTable[];
  membersRollup: StaffMemberEventRollup[];
}
