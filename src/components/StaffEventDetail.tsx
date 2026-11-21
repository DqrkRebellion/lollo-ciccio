import { useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  FileSpreadsheet,
  Layers,
  Plus,
  Redo2,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AppleModal,
  AppleStepper,
  AppleSwitch,
  MancantiBadge,
  NumericCellInput,
  SegmentedControl,
} from './ui/AppleControls';
import { StaffMemberPicker, StaffMemberPickerButton } from './ui/StaffMemberPicker';
import { parseStaffTicketSmsReport } from '../lib/staffCalculations';
import { isEventActive } from '../lib/events';
import { formatDateFull, formatEur, formatInt, formatPercent } from '../lib/format';
import type { EventSummary, FullEvent, ScaricoStatus } from '../types';
import type {
  StaffCommissionPlan,
  StaffEventPresale,
  StaffEventSummary,
  StaffEventTable,
  StaffGroup,
  StaffMember,
  StaffMemberEventRollup,
} from '../types/staff';

type StaffSubView = 'rollup' | 'presales' | 'tables';
const QUICK_PAYERS = [5, 8, 10, 12, 15, 20];
const SCARICO_CYCLE: ScaricoStatus[] = ['DA SCARICARE', 'DA NON SCARICARE'];

function nextStaffScarico(cur: ScaricoStatus): ScaricoStatus {
  return cur === 'DA SCARICARE' ? 'DA NON SCARICARE' : SCARICO_CYCLE[0];
}

function StaffScaricoPill({
  status,
  onClick,
}: {
  status: ScaricoStatus;
  onClick: () => void;
}) {
  const isScarico = status === 'DA SCARICARE';
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        isScarico
          ? 'Da scaricare: il PR deve consegnarti i soldi (clicca per passare a No scarico)'
          : 'No scarico: il PR non deve scaricarti nulla (sincronizzato con Lollo & Ciccio)'
      }
      className="rounded-full px-2.5 py-1 text-[11px] font-semibold apple-press cursor-pointer whitespace-nowrap transition-colors"
      style={{
        backgroundColor: isScarico ? 'var(--accent-subtle)' : 'var(--bg-surface-secondary)',
        color: isScarico ? 'var(--accent)' : 'var(--ink-secondary)',
      }}
    >
      {isScarico ? 'Da scaricare' : 'No scarico'}
    </button>
  );
}

export function StaffEventDetail({
  event,
  mainSummary,
  ownerPromoterId,
  staffGroup,
  staffSummary,
  members,
  plans,
  memberUsageScore,
  quickTablePrices,
  canUndo,
  canRedo,
  lastUndoLabel,
  lastRedoLabel,
  onUndo,
  onRedo,
  onBack,
  onOpenCashCollection,
  onSyncPresalesToMain,
  onAddPresale,
  onUpdatePresale,
  onDeletePresale,
  onAddTable,
  onUpdateTable,
  onDeleteTable,
  onSettleMemberCash,
  onToggleMemberBustaPaid,
  onImportTicketSms,
  onAssignMemberPlan,
  onQuickCreateMember,
}: {
  event: FullEvent;
  mainSummary: EventSummary | undefined;
  ownerPromoterId: 'lollo' | 'ciccio';
  staffGroup: StaffGroup;
  staffSummary: StaffEventSummary;
  members: StaffMember[];
  plans: StaffCommissionPlan[];
  memberUsageScore: Map<string, number>;
  quickTablePrices: number[];
  canUndo: boolean;
  canRedo: boolean;
  lastUndoLabel: string | null;
  lastRedoLabel: string | null;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onBack?: () => void;
  onOpenCashCollection?: () => void;
  onSyncPresalesToMain: (quantity: number, revenue: number, oneToOne: number) => Promise<void>;
  onAddPresale: (
    eventId: string,
    input: {
      staff_member_id: string | null;
      promoter_name: string;
      quantity: number;
      revenue: number;
      scarico: number;
      note_amount?: number;
      paid_cash?: number;
    }
  ) => Promise<StaffEventPresale | null>;
  onUpdatePresale: (id: string, patch: Partial<StaffEventPresale>) => Promise<void>;
  onDeletePresale: (id: string) => Promise<void>;
  onAddTable: (
    eventId: string,
    input: {
      staff_member_id: string | null;
      promoter_name: string;
      table_name: string;
      payers_count: number;
      price: number;
      surcharge_payers_count?: number;
      surcharge_price?: number;
      extra?: number;
      extra_no_scarico?: number;
      scarico_status?: ScaricoStatus;
      paid_cash?: number;
    }
  ) => Promise<StaffEventTable | null>;
  onUpdateTable: (id: string, patch: Partial<StaffEventTable>) => Promise<void>;
  onDeleteTable: (id: string) => Promise<void>;
  onSettleMemberCash: (rollup: StaffMemberEventRollup) => Promise<void>;
  onToggleMemberBustaPaid: (rollup: StaffMemberEventRollup, paid: boolean) => Promise<void>;
  onImportTicketSms: (
    eventId: string,
    rows: { promoterName: string; quantity: number; revenue: number; scarico: number }[]
  ) => Promise<void>;
  onAssignMemberPlan: (member: StaffMember, planId: string | null) => Promise<void>;
  onQuickCreateMember: (fullName: string) => Promise<StaffMember | null>;
}) {
  const [subView, setSubView] = useState<StaffSubView>('rollup');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  // Add Presale modal
  const [showAddPresaleModal, setShowAddPresaleModal] = useState(false);
  const [newPreveMemberId, setNewPreveMemberId] = useState<string>('');
  const [newPreveQty, setNewPreveQty] = useState(0);
  const [newPreveRev, setNewPreveRev] = useState(0);
  const [newPreveScarico, setNewPreveScarico] = useState(0);

  // Add Table modal
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [newTblMemberId, setNewTblMemberId] = useState<string>('');
  const [newTblName, setNewTblName] = useState('');
  const [newTblPayers, setNewTblPayers] = useState(0);
  const [newTblPrice, setNewTblPrice] = useState(quickTablePrices[1] || 30);
  const [newTblScarico, setNewTblScarico] = useState<ScaricoStatus>('DA SCARICARE');
  const [newTblExtra, setNewTblExtra] = useState(0);
  const [newTblExtraNo, setNewTblExtraNo] = useState(0);
  const [newTblSovPayers, setNewTblSovPayers] = useState(0);
  const [newTblSovPrice, setNewTblSovPrice] = useState(0);
  const [showModalSov, setShowModalSov] = useState(false);
  const [showDesktopSov, setShowDesktopSov] = useState(() =>
    staffSummary.tables.some(
      (t) => t.row.surcharge_payers_count > 0 || t.row.surcharge_price > 0
    )
  );
  const [expandedTableCards, setExpandedTableCards] = useState<Record<string, boolean>>({});
  const modalTblNameRef = useRef<HTMLInputElement>(null);

  const prioritizedMemberIds = useMemo(
    () =>
      staffSummary.membersRollup
        .map((r) => r.member?.id)
        .filter((id): id is string => Boolean(id)),
    [staffSummary.membersRollup]
  );

  const defaultMemberId = useMemo(
    () =>
      prioritizedMemberIds[0] ||
      members.find((m) => m.is_active && !m.is_self)?.id ||
      members.find((m) => m.is_active)?.id ||
      '',
    [prioritizedMemberIds, members]
  );

  const ownerPrSummary = mainSummary?.byPromoter[ownerPromoterId];
  const ownerMainBusta = ownerPrSummary?.bustaTotal ?? 0;
  const ownerNetMargin = Math.round((ownerMainBusta - staffSummary.totalBusta) * 100) / 100;
  const eventIsActive = isEventActive(event);
  const presalesOutOfSync =
    staffSummary.pxPresales > 0 &&
    (staffSummary.pxPresales !== (ownerPrSummary?.pxPresales ?? 0) ||
      Math.abs(staffSummary.presalesRevenue - (ownerPrSummary?.revenuePresales ?? 0)) > 0.01);

  const importPreview = useMemo(() => parseStaffTicketSmsReport(importText), [importText]);

  const handleApplyImport = async () => {
    if (importPreview.length === 0) return;
    setImporting(true);
    try {
      await onImportTicketSms(event.id, importPreview);
      setImportText('');
      setShowImportModal(false);
    } finally {
      setImporting(false);
    }
  };

  const handleAddPresaleSubmit = async (keepOpen = false) => {
    const m = members.find((x) => x.id === newPreveMemberId);
    if (!m) {
      toast.error('Seleziona un sotto-PR');
      return;
    }

    await onAddPresale(event.id, {
      staff_member_id: m.id,
      promoter_name: m.full_name,
      quantity: newPreveQty,
      revenue: newPreveRev,
      scarico: newPreveScarico,
    });
    setNewPreveQty(0);
    setNewPreveRev(0);
    setNewPreveScarico(0);
    if (!keepOpen) setShowAddPresaleModal(false);
    toast.success(`Prevendite di ${m.nickname || m.full_name} aggiunte`);
  };

  const handleAddTableSubmit = async (keepOpen = false) => {
    const m = members.find((x) => x.id === newTblMemberId);
    if (!m) {
      toast.error('Seleziona il sotto-PR del tavolo');
      return;
    }

    const created = await onAddTable(event.id, {
      staff_member_id: m.id,
      promoter_name: m.nickname || m.full_name,
      table_name: newTblName.trim() || 'Tavolo',
      payers_count: newTblPayers,
      price: newTblPrice,
      surcharge_payers_count: newTblSovPayers,
      surcharge_price: newTblSovPrice,
      extra: newTblExtra,
      extra_no_scarico: newTblExtraNo,
      scarico_status: newTblScarico,
    });
    if (!created) return;

    setNewTblName('');
    setNewTblPayers(0);
    setNewTblExtra(0);
    setNewTblExtraNo(0);
    setNewTblSovPayers(0);
    setNewTblSovPrice(0);
    if (keepOpen) {
      toast.success(`Tavolo “${created.table_name}” aggiunto (sincronizzato su Serata)`);
      window.setTimeout(() => modalTblNameRef.current?.focus(), 60);
    } else {
      setShowAddTableModal(false);
      toast.success(`Tavolo “${created.table_name}” aggiunto (sincronizzato su Serata)`);
    }
  };

  const handleCopySubPrWhatsApp = async (r: StaffMemberEventRollup) => {
    const lines = [
      `*${staffGroup.name} — ${event.venue_name} (${event.title})*`,
      `PR: *${r.displayName}*`,
      ``,
    ];
    if (r.pxPresales > 0 || r.presalesScarico > 0) {
      lines.push(
        `• Prevendite: ${r.pxPresales} px · Incasso ${formatEur(r.presalesRevenue)} · Scarico ${formatEur(r.presalesScarico)}${
          r.presalesBusta > 0 ? ` → Busta ${formatEur(r.presalesBusta, true)}` : ''
        }`
      );
    }
    if (r.tablesCount > 0) {
      lines.push(
        `• Tavoli (${r.tablesCount}): ${r.pxTables} px · Credito ${formatEur(r.tablesCredito)}${
          r.tablesBusta > 0
            ? ` (${formatPercent(r.tablesRateApplied)}) → Busta ${formatEur(r.tablesBusta, true)}`
            : ''
        }`
      );
    }
    lines.push(
      ``,
      `• Cassa mancante: ${formatEur(r.mancantiTotal)}`,
      `• *Busta totale: ${formatEur(r.bustaTotal, true)}*${r.allBustaPaid && r.bustaTotal > 0 ? ' (Pagata)' : ''}`
    );
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success(`Riepilogo per ${r.displayName} copiato`);
    } catch {
      toast.error('Impossibile copiare negli appunti');
    }
  };

  const handleSettleAllStaff = async () => {
    const open = staffSummary.membersRollup.filter((r) => r.mancantiTotal > 0.01);
    for (const r of open) {
      await onSettleMemberCash(r);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 lg:px-8 pt-3 sm:pt-5 pb-36 lg:pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="-ml-1.5 inline-flex items-center gap-0.5 rounded-[10px] px-2.5 py-1.5 text-[14px] font-semibold apple-press cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--accent)' }}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Serate {staffGroup.name}
            </button>
          )}
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{
              backgroundColor: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            {event.venue_name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Undo / Redo */}
          <div
            className="inline-flex items-center rounded-[10px] p-0.5 apple-surface"
            role="group"
            aria-label="Cronologia modifiche"
          >
            <button
              type="button"
              disabled={!canUndo}
              onClick={() => onUndo()}
              title={lastUndoLabel ? `Annulla: ${lastUndoLabel}` : 'Niente da annullare'}
              className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold apple-press cursor-pointer disabled:opacity-30"
              style={{ color: canUndo ? 'var(--accent)' : 'var(--ink-secondary)' }}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Annulla</span>
            </button>
            <span className="h-4 w-[0.5px]" style={{ backgroundColor: 'var(--separator)' }} />
            <button
              type="button"
              disabled={!canRedo}
              onClick={() => onRedo()}
              title={lastRedoLabel ? `Ripristina: ${lastRedoLabel}` : 'Niente da ripristinare'}
              aria-label="Ripristina"
              className="inline-flex items-center justify-center rounded-[8px] px-2 py-1 apple-press cursor-pointer disabled:opacity-30"
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {onOpenCashCollection && (
            <button
              type="button"
              onClick={onOpenCashCollection}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 sm:px-3 py-1.5 text-[12px] sm:text-[13px] font-semibold apple-press cursor-pointer"
              style={{
                backgroundColor:
                  staffSummary.totalMancanti > 0.01
                    ? 'var(--status-green-bg)'
                    : 'var(--bg-surface)',
                color:
                  staffSummary.totalMancanti > 0.01
                    ? 'var(--status-green)'
                    : 'var(--ink-primary)',
                boxShadow: staffSummary.totalMancanti > 0.01 ? 'none' : 'var(--shadow-card)',
              }}
            >
              <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Raccolta</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 sm:px-3 py-1.5 text-[12px] sm:text-[13px] font-semibold apple-surface apple-press cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">
              {ownerPromoterId === 'lollo' ? 'Importa TicketSMS' : 'Importa CSV'}
            </span>
            <span className="sm:hidden">Importa</span>
          </button>

          {presalesOutOfSync && (
            <button
              type="button"
              onClick={() => {
                const oto = staffSummary.presales.reduce(
                  (acc, p) => acc + (Number(p.row.scarico) || 0),
                  0
                );
                onSyncPresalesToMain(
                  staffSummary.pxPresales,
                  staffSummary.presalesRevenue,
                  Math.round(oto * 100) / 100
                );
              }}
              title="Copia i totali prevendite del tuo staff nella serata principale Lollo & Ciccio"
              className="hidden md:inline-flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-[12px] font-medium apple-surface apple-press cursor-pointer"
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              Sincronizza preve su Serata
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="mb-5">
        <h1 className="text-[24px] sm:text-[32px] font-bold tracking-tight truncate">
          {event.title}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] sm:text-[14px]">
          <span style={{ color: 'var(--ink-secondary)' }}>
            {formatDateFull(event.event_date)} · {staffSummary.membersRollup.length} PR
          </span>
          {eventIsActive && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: 'var(--status-green-bg)',
                color: 'var(--status-green)',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'var(--status-green)' }}
              />
              Attiva · provvisoria
            </span>
          )}
        </div>
      </div>

      {/* Hero Staff Financial Strip (4 clean KPIs) */}
      <section className="apple-surface rounded-[18px] overflow-hidden mb-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-[var(--separator)]">
          <div className="p-3.5 sm:p-4 min-w-0">
            <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Ingressi {staffGroup.name}
            </span>
            <div className="mt-1 text-[20px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-none">
              {formatInt(staffSummary.pxTotal)}
              <span className="ml-1 text-[13px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                px
              </span>
            </div>
            <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {formatInt(staffSummary.pxPresales)} preve · {formatInt(staffSummary.pxTables)} tavoli
            </div>
          </div>

          <div className="p-3.5 sm:p-4 min-w-0">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[12px] font-medium truncate" style={{ color: 'var(--ink-secondary)' }}>
                Mancanti
              </span>
              {staffSummary.totalMancanti > 0.01 && (
                <button
                  type="button"
                  onClick={handleSettleAllStaff}
                  className="text-[11px] font-semibold cursor-pointer apple-press shrink-0"
                  style={{ color: 'var(--accent)' }}
                >
                  Salda tutto
                </button>
              )}
            </div>
            <div className="mt-1.5">
              <MancantiBadge value={staffSummary.totalMancanti} />
            </div>
            {staffSummary.totalScarico > 0.01 && (
              <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                {formatEur(staffSummary.totalPaidCash)} / {formatEur(staffSummary.totalScarico)}
              </div>
            )}
          </div>

          <div className="p-3.5 sm:p-4 min-w-0">
            <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              {eventIsActive ? 'Buste staff (provv.)' : 'Buste staff'}
            </span>
            <div className="mt-1 text-[20px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-none truncate">
              {formatEur(staffSummary.totalBusta, true)}
            </div>
            <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {staffSummary.totalBustaUnpaid > 0.01 ? (
                <>
                  Da pagare{' '}
                  <strong style={{ color: eventIsActive ? 'var(--status-orange)' : 'var(--accent)' }}>
                    {formatEur(staffSummary.totalBustaUnpaid, true)}
                  </strong>
                </>
              ) : (
                <span style={{ color: 'var(--status-green)' }}>Saldate</span>
              )}
            </div>
          </div>

          <div className="p-3.5 sm:p-4 min-w-0">
            <span className="block truncate text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Tuo margine netto
            </span>
            <div
              className="mt-1 text-[20px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-none truncate"
              style={{
                color: ownerNetMargin >= 0 ? 'var(--status-green)' : 'var(--status-red)',
              }}
            >
              {formatEur(ownerNetMargin, true)}
            </div>
            <div className="mt-1.5 text-[12px] tabular-nums truncate" style={{ color: 'var(--ink-secondary)' }}>
              Tua busta{' '}
              <strong style={{ color: 'var(--accent)' }}>{formatEur(ownerMainBusta, true)}</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Sub-View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4">
        <SegmentedControl<StaffSubView>
          ariaLabel="Vista dettaglio staff"
          size="sm"
          value={subView}
          onChange={setSubView}
          className="w-full sm:w-auto"
          options={[
            { value: 'rollup', label: `Riepilogo (${staffSummary.membersRollup.length})` },
            { value: 'presales', label: `Preve (${staffSummary.presales.length})` },
            { value: 'tables', label: `Tavoli (${staffSummary.tables.length})` },
          ]}
        />

        <div className="flex items-center gap-2">
          {subView === 'presales' && (
            <button
              type="button"
              onClick={() => {
                setNewPreveMemberId(defaultMemberId);
                setShowAddPresaleModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[13px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Aggiungi PR
            </button>
          )}
          {subView === 'tables' && (
            <>
              <button
                type="button"
                onClick={() => setShowDesktopSov((s) => !s)}
                className="hidden md:inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-medium apple-surface apple-press cursor-pointer"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {showDesktopSov ? 'Nascondi sovrapr.' : 'Sovraprezzo'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewTblMemberId(defaultMemberId);
                  setNewTblScarico('DA SCARICARE');
                  setShowModalSov(false);
                  setShowAddTableModal(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[13px] font-semibold text-white apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nuovo tavolo
              </button>
            </>
          )}
        </div>
      </div>

      {/* ============ SUB-VIEW 1: RIEPILOGO UNIFICATO SOTTO-PR ============ */}
      {subView === 'rollup' && (
        <div className="space-y-3">
          {staffSummary.membersRollup.length === 0 ? (
            <div className="apple-surface rounded-[18px] p-8 text-center space-y-3">
              <p className="text-[15px] font-semibold">
                Nessun dato {staffGroup.name} registrato in questa serata
              </p>
              <p className="text-[13px] max-w-md mx-auto" style={{ color: 'var(--ink-secondary)' }}>
                {ownerPromoterId === 'lollo'
                  ? 'Incolla il report TicketSMS oppure aggiungi manualmente i tavoli e le prevendite dei tuoi sotto-PR.'
                  : 'Incolla un report CSV/Excel oppure aggiungi manualmente i tavoli e le prevendite dei tuoi sotto-PR.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  {ownerPromoterId === 'lollo' ? 'Importa TicketSMS' : 'Importa CSV'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewTblMemberId(defaultMemberId);
                    setNewTblScarico('DA SCARICARE');
                    setShowAddTableModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-semibold apple-surface apple-press cursor-pointer"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Aggiungi tavolo
                </button>
              </div>
            </div>
          ) : (
            staffSummary.membersRollup.map((r) => (
              <div
                key={r.memberKey}
                className="apple-surface rounded-[16px] p-4 space-y-3"
              >
                {/* Header: Name + Plan Switcher + Multi-table badge + WhatsApp */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[16px] font-bold">{r.displayName}</span>
                      {r.fullName !== r.displayName && (
                        <span className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {r.fullName}
                        </span>
                      )}
                      {r.member && !r.isSelf && plans.length > 0 ? (
                        <select
                          aria-label={`Piano busta ${r.displayName}`}
                          value={r.member.plan_id || ''}
                          onChange={(e) => onAssignMemberPlan(r.member!, e.target.value || null)}
                          className="rounded-full px-2.5 py-0.5 text-[16px] md:text-[11px] font-semibold cursor-pointer max-w-full"
                          style={{
                            backgroundColor: 'var(--bg-surface-secondary)',
                            color: 'var(--ink-secondary)',
                          }}
                        >
                          {plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              Piano: {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: 'var(--bg-surface-secondary)',
                            color: 'var(--ink-secondary)',
                          }}
                        >
                          {r.planName}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                      <span>
                        <strong>{formatInt(r.pxTotal)} px</strong> ({r.pxPresales} preve ·{' '}
                        {r.pxTables} tavoli)
                      </span>
                      {r.tablesCount >= 2 && staffGroup.sum_tables_per_pr && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: 'rgba(88, 86, 214, 0.14)',
                            color: '#5856D6',
                          }}
                        >
                          <Layers className="h-3 w-3" aria-hidden="true" />
                          {r.tablesCount} tavoli sommati · {formatEur(r.tablesCredito)} →{' '}
                          {formatPercent(r.tablesRateApplied)}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopySubPrWhatsApp(r)}
                    title={`Copia riepilogo WhatsApp per ${r.displayName}`}
                    className="inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-medium apple-press cursor-pointer"
                    style={{
                      backgroundColor: 'var(--bg-surface-secondary)',
                      color: 'var(--ink-secondary)',
                    }}
                  >
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">WhatsApp</span>
                  </button>
                </div>

                {/* Cash Control + Busta Payout Split */}
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3"
                  style={{ borderTop: '0.5px solid var(--separator)' }}
                >
                  {/* Left: Cash (Scarico -> Dati -> Mancanti) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] px-3.5 py-2.5 min-w-0" style={{ backgroundColor: 'var(--bg-surface-secondary)' }}>
                    <div className="tabular-nums min-w-0">
                      <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        Cassa · Scarico {formatEur(r.scaricoTotal)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <MancantiBadge value={r.mancantiTotal} compact />
                        <span className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          Dati {formatEur(r.paidCashTotal)}
                        </span>
                      </div>
                    </div>
                    {r.mancantiTotal > 0.01 && (
                      <button
                        type="button"
                        onClick={() => onSettleMemberCash(r)}
                        className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[12px] font-semibold apple-press cursor-pointer shrink-0"
                        style={{
                          backgroundColor: 'var(--status-green-bg)',
                          color: 'var(--status-green)',
                        }}
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Salda
                      </button>
                    )}
                  </div>

                  {/* Right: Busta (Preve + Tavoli + Pagata switch) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] px-3.5 py-2.5 min-w-0" style={{ backgroundColor: 'var(--bg-surface-secondary)' }}>
                    <div className="tabular-nums min-w-0">
                      <div className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        Busta · Preve {formatEur(r.presalesBusta, true)} + Tavoli{' '}
                        {formatEur(r.tablesBusta, true)}
                      </div>
                      <div
                        className="mt-0.5 text-[17px] font-bold"
                        style={{
                          color:
                            r.bustaTotal > 0 && r.allBustaPaid
                              ? 'var(--status-green)'
                              : 'var(--ink-primary)',
                        }}
                      >
                        {formatEur(r.bustaTotal, true)}
                      </div>
                    </div>
                    {r.bustaTotal > 0 && (
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none shrink-0">
                        <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                          {r.allBustaPaid ? 'Pagata' : 'Da pagare'}
                        </span>
                        <AppleSwitch
                          checked={r.allBustaPaid}
                          label={`Busta pagata ${r.displayName}`}
                          onChange={(checked) => onToggleMemberBustaPaid(r, checked)}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ============ SUB-VIEW 2: PREVENDITE STAFF (M..U) ============ */}
      {subView === 'presales' && (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-2.5">
            {staffSummary.presales.length === 0 ? (
              <div className="apple-surface rounded-[16px] p-6 text-center text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
                Nessuna prevendita staff registrata. Usa “Importa” o “Aggiungi PR”.
              </div>
            ) : (
              staffSummary.presales.map((cp) => (
                <div key={cp.row.id} className="apple-surface rounded-[16px] p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold truncate">
                        {cp.member?.full_name || cp.row.promoter_name}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                        {cp.planName}
                        {cp.rateApplied > 0 ? ` · ${formatEur(cp.rateApplied, true)}/preve` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <MancantiBadge value={cp.mancanti} compact />
                      <button
                        type="button"
                        onClick={() => onDeletePresale(cp.row.id)}
                        aria-label="Elimina riga prevendite"
                        className="p-1.5 rounded-full cursor-pointer"
                        style={{ color: 'var(--status-red)' }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="min-w-0">
                      <span className="block text-[11px] mb-1 truncate" style={{ color: 'var(--ink-secondary)' }}>
                        N. preve
                      </span>
                      <NumericCellInput
                        value={cp.row.quantity}
                        integer
                        onCommit={(v) => onUpdatePresale(cp.row.id, { quantity: v })}
                        ariaLabel="Numero prevendite"
                      />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[11px] mb-1 truncate" style={{ color: 'var(--ink-secondary)' }}>
                        € preve
                      </span>
                      <NumericCellInput
                        value={cp.row.revenue}
                        onCommit={(v) => onUpdatePresale(cp.row.id, { revenue: v })}
                        ariaLabel="Incasso prevendite"
                      />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[11px] mb-1 truncate" style={{ color: 'var(--ink-secondary)' }}>
                        Scarico €
                      </span>
                      <NumericCellInput
                        value={cp.row.scarico}
                        onCommit={(v) => onUpdatePresale(cp.row.id, { scarico: v })}
                        ariaLabel="Scarico prevendite"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        Note (€)
                      </span>
                      <NumericCellInput
                        value={cp.row.note_amount}
                        allowNegative
                        onCommit={(v) => onUpdatePresale(cp.row.id, { note_amount: v })}
                        ariaLabel="Note rettifica"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        Dati (€)
                      </span>
                      <div className="flex items-center gap-1">
                        <NumericCellInput
                          value={cp.row.paid_cash}
                          onCommit={(v) => onUpdatePresale(cp.row.id, { paid_cash: v })}
                          ariaLabel="Soldi dati"
                          className="flex-1"
                        />
                        {cp.mancanti > 0.01 && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdatePresale(cp.row.id, {
                                paid_cash: Math.max(0, cp.row.scarico + cp.row.note_amount),
                              })
                            }
                            aria-label="Salda"
                            className="flex h-[38px] w-9 shrink-0 items-center justify-center rounded-[8px] apple-press cursor-pointer"
                            style={{
                              backgroundColor: 'var(--status-green-bg)',
                              color: 'var(--status-green)',
                            }}
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center justify-between pt-2"
                    style={{ borderTop: '0.5px solid var(--separator)' }}
                  >
                    <div className="tabular-nums">
                      <span className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Busta:{' '}
                      </span>
                      <strong className="text-[15px]">{formatEur(cp.bustaFinal, true)}</strong>
                    </div>
                    {cp.bustaFinal > 0 && (
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <span className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                          Pagata
                        </span>
                        <AppleSwitch
                          checked={cp.row.is_busta_paid}
                          label="Busta pagata"
                          onChange={(checked) =>
                            onUpdatePresale(cp.row.id, { is_busta_paid: checked })
                          }
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block apple-surface rounded-[16px] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[840px]">
              <thead>
                <tr
                  className="text-[12px] font-medium"
                  style={{
                    color: 'var(--ink-secondary)',
                    borderBottom: '0.5px solid var(--separator)',
                  }}
                >
                  <th className="py-3 pl-4 pr-2 font-medium min-w-[155px]">Promoter</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[78px]">N. preve</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[98px]">€ preve</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[98px]">Scarico</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[86px]">Note €</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[128px]">Dati €</th>
                  <th className="py-3 px-2 text-right font-medium w-[94px]">Manc.</th>
                  <th className="py-3 px-2 text-right font-medium w-[92px]">Busta</th>
                  <th className="py-3 px-2 text-center font-medium w-[68px]">Pagata</th>
                  <th className="py-3 pr-3 w-[34px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)] text-[14px]">
                {staffSummary.presales.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-10 text-center"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      {ownerPromoterId === 'lollo'
                        ? 'Nessuna prevendita registrata. Incolla il report TicketSMS o aggiungi un PR.'
                        : 'Nessuna prevendita registrata. Incolla un report CSV/Excel o aggiungi un PR.'}
                    </td>
                  </tr>
                ) : (
                  staffSummary.presales.map((cp) => (
                    <tr key={cp.row.id} className="group hover:bg-[var(--bg-hover)]">
                      <td className="py-2 pl-4 pr-2">
                        <div className="font-semibold leading-tight">
                          {cp.member?.full_name || cp.row.promoter_name}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {cp.planName}
                          {cp.rateApplied > 0 ? ` · ${formatEur(cp.rateApplied, true)}/px` : ''}
                        </div>
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={cp.row.quantity}
                          integer
                          onCommit={(v) => onUpdatePresale(cp.row.id, { quantity: v })}
                          ariaLabel="N preve"
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={cp.row.revenue}
                          onCommit={(v) => onUpdatePresale(cp.row.id, { revenue: v })}
                          ariaLabel="€ preve"
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={cp.row.scarico}
                          onCommit={(v) => onUpdatePresale(cp.row.id, { scarico: v })}
                          ariaLabel="Scarico"
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={cp.row.note_amount}
                          allowNegative
                          onCommit={(v) => onUpdatePresale(cp.row.id, { note_amount: v })}
                          ariaLabel="Note"
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <div className="flex items-center gap-1">
                          <NumericCellInput
                            value={cp.row.paid_cash}
                            onCommit={(v) => onUpdatePresale(cp.row.id, { paid_cash: v })}
                            ariaLabel="Dati"
                            className="flex-1"
                          />
                          {cp.mancanti > 0.01 && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdatePresale(cp.row.id, {
                                  paid_cash: Math.max(0, cp.row.scarico + cp.row.note_amount),
                                })
                              }
                              title="Segna tutto ricevuto"
                              aria-label="Salda"
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] apple-press cursor-pointer"
                              style={{
                                backgroundColor: 'var(--status-green-bg)',
                                color: 'var(--status-green)',
                              }}
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <MancantiBadge value={cp.mancanti} compact />
                      </td>
                      <td className="py-2 px-2 text-right font-bold tabular-nums whitespace-nowrap">
                        {formatEur(cp.bustaFinal, true)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex justify-center">
                          <AppleSwitch
                            checked={cp.row.is_busta_paid}
                            label="Busta pagata"
                            onChange={(checked) =>
                              onUpdatePresale(cp.row.id, { is_busta_paid: checked })
                            }
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <button
                          type="button"
                          onClick={() => onDeletePresale(cp.row.id)}
                          aria-label="Elimina"
                          className="p-1.5 rounded-[8px] opacity-40 group-hover:opacity-100 hover:bg-[var(--status-red-bg)] transition-opacity cursor-pointer"
                          style={{ color: 'var(--status-red)' }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ============ SUB-VIEW 3: TAVOLI STAFF (W..AH, COLLEGATI A LOLLO & CICCIO) ============ */}
      {subView === 'tables' && (
        <>

          {/* Mobile Tavoli Cards */}
          <div className="md:hidden space-y-2.5">
            {staffSummary.tables.length === 0 ? (
              <div className="apple-surface rounded-[16px] p-6 text-center space-y-3">
                <p className="text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
                  Nessun tavolo {staffGroup.name} registrato.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setNewTblMemberId(defaultMemberId);
                    setNewTblScarico('DA SCARICARE');
                    setShowAddTableModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Aggiungi tavolo
                </button>
              </div>
            ) : (
              staffSummary.tables.map((ct) => {
                const isExp = Boolean(expandedTableCards[ct.row.id]);
                const combinedBonus = ct.combinedMemberTablesCount >= 2 && staffGroup.sum_tables_per_pr;
                const isNoScarico = ct.row.scarico_status !== 'DA SCARICARE';
                return (
                  <div key={ct.row.id} className="apple-surface rounded-[16px] p-3.5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StaffMemberPickerButton
                            members={members}
                            selectedMemberId={ct.row.staff_member_id}
                            fallbackName={ct.member?.nickname || ct.row.promoter_name}
                            prioritizedIds={prioritizedMemberIds}
                            usageScores={memberUsageScore}
                            subtitle={`Tavolo “${ct.row.table_name}”`}
                            onQuickCreate={onQuickCreateMember}
                            onSelect={(m) =>
                              onUpdateTable(ct.row.id, {
                                staff_member_id: m.id,
                                promoter_name: m.nickname || m.full_name,
                              })
                            }
                          />
                          <StaffScaricoPill
                            status={ct.row.scarico_status}
                            onClick={() =>
                              onUpdateTable(ct.row.id, {
                                scarico_status: nextStaffScarico(ct.row.scarico_status),
                              })
                            }
                          />
                          {combinedBonus && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                              style={{
                                backgroundColor: 'rgba(88, 86, 214, 0.14)',
                                color: '#5856D6',
                              }}
                            >
                              Somma {ct.combinedMemberTablesCount} tav. ({formatEur(ct.combinedMemberCredit)}) →{' '}
                              {formatPercent(ct.rateApplied)}
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          defaultValue={ct.row.table_name}
                          key={`${ct.row.id}-${ct.row.table_name}`}
                          aria-label="Nome tavolo"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== ct.row.table_name) {
                              onUpdateTable(ct.row.id, { table_name: v || 'Tavolo' });
                            }
                          }}
                          className="mt-1.5 font-semibold text-[16px] bg-transparent w-full truncate"
                        />
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[16px] font-bold tabular-nums">
                          {formatEur(ct.credito)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDeleteTable(ct.row.id)}
                          aria-label="Elimina tavolo"
                          className="p-1.5 rounded-full cursor-pointer"
                          style={{ color: 'var(--status-red)' }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Stepper + Price + Extra toggle */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AppleStepper
                          size="sm"
                          value={ct.row.payers_count}
                          label="Paganti"
                          onChange={(n) => onUpdateTable(ct.row.id, { payers_count: n })}
                        />
                        <span className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                          ×
                        </span>
                        <NumericCellInput
                          value={ct.row.price}
                          prefix="€"
                          onCommit={(v) => onUpdateTable(ct.row.id, { price: v })}
                          ariaLabel="Prezzo"
                          className="w-[74px]"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTableCards((p) => ({ ...p, [ct.row.id]: !p[ct.row.id] }))
                        }
                        className="inline-flex items-center gap-0.5 text-[12px] font-medium cursor-pointer"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        Extra
                        {isExp ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    {isExp && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="block text-[10px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                            Extra Sì scar. (€)
                          </span>
                          <NumericCellInput
                            value={ct.row.extra}
                            onCommit={(v) => onUpdateTable(ct.row.id, { extra: v })}
                            ariaLabel="Extra sì scarico"
                          />
                        </div>
                        <div>
                          <span className="block text-[10px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                            Extra No scar. (€)
                          </span>
                          <NumericCellInput
                            value={ct.row.extra_no_scarico}
                            onCommit={(v) => onUpdateTable(ct.row.id, { extra_no_scarico: v })}
                            ariaLabel="Extra no scarico"
                          />
                        </div>
                        <div>
                          <span className="block text-[10px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                            Pag. sovr.
                          </span>
                          <NumericCellInput
                            value={ct.row.surcharge_payers_count}
                            integer
                            onCommit={(v) =>
                              onUpdateTable(ct.row.id, { surcharge_payers_count: v })
                            }
                            ariaLabel="Paganti sovraprezzo"
                          />
                        </div>
                        <div>
                          <span className="block text-[10px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                            Prezzo rial.
                          </span>
                          <NumericCellInput
                            value={ct.row.surcharge_price}
                            onCommit={(v) => onUpdateTable(ct.row.id, { surcharge_price: v })}
                            ariaLabel="Prezzo rialzato"
                          />
                        </div>
                      </div>
                    )}

                    {/* Cash Dati + Mancanti + Busta Paid */}
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 pt-2.5"
                      style={{ borderTop: '0.5px solid var(--separator)' }}
                    >
                      <div className="flex items-center gap-1.5">
                        {isNoScarico ? (
                          <span
                            className="text-[12px] font-medium"
                            style={{ color: 'var(--ink-secondary)' }}
                          >
                            Nessuno scarico dovuto
                          </span>
                        ) : (
                          <>
                            <NumericCellInput
                              value={ct.row.paid_cash}
                              prefix="€"
                              placeholder="Dati"
                              onCommit={(v) => onUpdateTable(ct.row.id, { paid_cash: v })}
                              ariaLabel="Soldi dati tavolo"
                              className="w-[92px]"
                            />
                            {ct.mancanti > 0.01 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateTable(ct.row.id, { paid_cash: ct.scaricoApplied })
                                }
                                className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold apple-press cursor-pointer"
                                style={{
                                  backgroundColor: 'var(--status-green-bg)',
                                  color: 'var(--status-green)',
                                }}
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                Salda
                              </button>
                            ) : (
                              <MancantiBadge value={ct.mancanti} compact />
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2 tabular-nums">
                        <span className="text-[13px] font-bold">
                          {formatEur(ct.bustaFinal, true)}
                        </span>
                        {ct.bustaFinal > 0 && (
                          <AppleSwitch
                            checked={ct.row.is_busta_paid}
                            label="Busta tavolo pagata"
                            onChange={(checked) =>
                              onUpdateTable(ct.row.id, { is_busta_paid: checked })
                            }
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Tavoli Table */}
          <div className="hidden md:block apple-surface rounded-[16px] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[920px]">
              <thead>
                <tr
                  className="text-[12px] font-medium"
                  style={{
                    color: 'var(--ink-secondary)',
                    borderBottom: '0.5px solid var(--separator)',
                  }}
                >
                  <th className="py-3 pl-4 pr-2 font-medium w-[132px]">Promoter</th>
                  <th className="py-3 px-2 font-medium min-w-[145px]">Nome tavolo</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[66px]">Pag.</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[78px]">Prezzo €</th>
                  {showDesktopSov && (
                    <>
                      <th className="py-3 px-1.5 text-right font-medium w-[66px]">Sovr.</th>
                      <th className="py-3 px-1.5 text-right font-medium w-[78px]">Rial. €</th>
                    </>
                  )}
                  <th className="py-3 px-1.5 text-right font-medium w-[78px]">Extra €</th>
                  <th className="py-3 px-2 text-right font-medium w-[80px]">Credito</th>
                  <th className="py-3 px-2 text-center font-medium w-[104px]">Scarico</th>
                  <th className="py-3 px-1.5 text-right font-medium w-[114px]">Dati €</th>
                  <th className="py-3 px-2 text-right font-medium w-[84px]">Manc.</th>
                  <th className="py-3 px-2 text-right font-medium w-[94px]">Busta</th>
                  <th className="py-3 px-2 text-center font-medium w-[62px]">Pag.</th>
                  <th className="py-3 pr-3 w-[34px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)] text-[14px]">
                {staffSummary.tables.length === 0 ? (
                  <tr>
                    <td
                      colSpan={showDesktopSov ? 14 : 12}
                      className="py-10 text-center"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      Nessun tavolo staff registrato in questa serata.
                    </td>
                  </tr>
                ) : (
                  staffSummary.tables.map((ct) => {
                    const combinedBonus =
                      ct.combinedMemberTablesCount >= 2 && staffGroup.sum_tables_per_pr;
                    const isNoScarico = ct.row.scarico_status !== 'DA SCARICARE';
                    return (
                      <tr key={ct.row.id} className="group hover:bg-[var(--bg-hover)]">
                        <td className="py-2 pl-4 pr-2">
                          <StaffMemberPickerButton
                            members={members}
                            selectedMemberId={ct.row.staff_member_id}
                            fallbackName={ct.member?.nickname || ct.row.promoter_name}
                            prioritizedIds={prioritizedMemberIds}
                            usageScores={memberUsageScore}
                            subtitle={`Tavolo “${ct.row.table_name}”`}
                            onQuickCreate={onQuickCreateMember}
                            onSelect={(m) =>
                              onUpdateTable(ct.row.id, {
                                staff_member_id: m.id,
                                promoter_name: m.nickname || m.full_name,
                              })
                            }
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            defaultValue={ct.row.table_name}
                            key={`${ct.row.id}-${ct.row.table_name}-d`}
                            aria-label="Nome tavolo"
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v !== ct.row.table_name) {
                                onUpdateTable(ct.row.id, { table_name: v || 'Tavolo' });
                              }
                            }}
                            className="apple-input w-full rounded-[8px] px-2.5 py-1.5 text-[14px] font-medium"
                          />
                        </td>
                        <td className="py-2 px-1.5">
                          <NumericCellInput
                            value={ct.row.payers_count}
                            integer
                            onCommit={(v) => onUpdateTable(ct.row.id, { payers_count: v })}
                            ariaLabel="Paganti"
                          />
                        </td>
                        <td className="py-2 px-1.5">
                          <NumericCellInput
                            value={ct.row.price}
                            onCommit={(v) => onUpdateTable(ct.row.id, { price: v })}
                            ariaLabel="Prezzo"
                          />
                        </td>
                        {showDesktopSov && (
                          <>
                            <td className="py-2 px-1.5">
                              <NumericCellInput
                                value={ct.row.surcharge_payers_count}
                                integer
                                onCommit={(v) =>
                                  onUpdateTable(ct.row.id, { surcharge_payers_count: v })
                                }
                                ariaLabel="Paganti sovraprezzo"
                              />
                            </td>
                            <td className="py-2 px-1.5">
                              <NumericCellInput
                                value={ct.row.surcharge_price}
                                onCommit={(v) =>
                                  onUpdateTable(ct.row.id, { surcharge_price: v })
                                }
                                ariaLabel="Prezzo rialzato"
                              />
                            </td>
                          </>
                        )}
                        <td className="py-2 px-1.5">
                          <NumericCellInput
                            value={ct.row.extra}
                            onCommit={(v) => onUpdateTable(ct.row.id, { extra: v })}
                            ariaLabel="Extra"
                          />
                          {ct.row.extra_no_scarico > 0 && (
                            <div
                              className="mt-0.5 text-right text-[10px] tabular-nums whitespace-nowrap"
                              style={{ color: 'var(--ink-tertiary)' }}
                              title="Extra no scarico (sincronizzato da Lollo & Ciccio)"
                            >
                              +{formatEur(ct.row.extra_no_scarico)} no sc.
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">
                          {formatEur(ct.credito)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <StaffScaricoPill
                            status={ct.row.scarico_status}
                            onClick={() =>
                              onUpdateTable(ct.row.id, {
                                scarico_status: nextStaffScarico(ct.row.scarico_status),
                              })
                            }
                          />
                        </td>
                        <td className="py-2 px-1.5">
                          {isNoScarico ? (
                            <div
                              className="text-right text-[12px] pr-2"
                              style={{ color: 'var(--ink-tertiary)' }}
                            >
                              —
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <NumericCellInput
                                value={ct.row.paid_cash}
                                onCommit={(v) => onUpdateTable(ct.row.id, { paid_cash: v })}
                                ariaLabel="Dati"
                                className="flex-1"
                              />
                              {ct.mancanti > 0.01 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdateTable(ct.row.id, { paid_cash: ct.scaricoApplied })
                                  }
                                  title="Segna tutto ricevuto"
                                  aria-label="Salda"
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] apple-press cursor-pointer"
                                  style={{
                                    backgroundColor: 'var(--status-green-bg)',
                                    color: 'var(--status-green)',
                                  }}
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {isNoScarico ? (
                            <span
                              className="text-[11px] font-medium whitespace-nowrap"
                              style={{ color: 'var(--ink-tertiary)' }}
                            >
                              0 €
                            </span>
                          ) : (
                            <MancantiBadge value={ct.mancanti} compact />
                          )}
                        </td>
                        <td className="py-2 pl-2 pr-4 text-right tabular-nums whitespace-nowrap">
                          <div className="font-bold">{formatEur(ct.bustaFinal, true)}</div>
                          {combinedBonus && ct.rateApplied > 0 && (
                            <div className="text-[10px] font-semibold" style={{ color: '#5856D6' }}>
                              Σ {ct.combinedMemberTablesCount} tav. ({formatPercent(ct.rateApplied)})
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <div className="flex justify-center">
                            <AppleSwitch
                              checked={ct.row.is_busta_paid}
                              label="Busta pagata"
                              onChange={(checked) =>
                                onUpdateTable(ct.row.id, { is_busta_paid: checked })
                              }
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <button
                            type="button"
                            onClick={() => onDeleteTable(ct.row.id)}
                            aria-label="Elimina tavolo"
                            className="p-1.5 rounded-[8px] opacity-40 group-hover:opacity-100 hover:bg-[var(--status-red-bg)] transition-opacity cursor-pointer"
                            style={{ color: 'var(--status-red)' }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Floating Mobile Quick-Add Button */}
      <button
        type="button"
        onClick={() => {
          if (subView === 'presales') {
            setNewPreveMemberId(defaultMemberId);
            setShowAddPresaleModal(true);
          } else {
            setNewTblMemberId(defaultMemberId);
            setNewTblScarico('DA SCARICARE');
            setShowModalSov(false);
            setShowAddTableModal(true);
          }
        }}
        className="md:hidden fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-[14px] font-semibold text-white apple-press cursor-pointer"
        style={{
          backgroundColor: 'var(--accent)',
          boxShadow: '0 8px 24px rgba(0, 113, 227, 0.38)',
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {subView === 'presales' ? 'PR' : 'Tavolo'}
      </button>

      {/* Import Presales Report Modal */}
      <AppleModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        title={
          ownerPromoterId === 'lollo'
            ? `Importa report TicketSMS · ${staffGroup.name}`
            : `Importa report prevendite · ${staffGroup.name}`
        }
        subtitle={
          ownerPromoterId === 'lollo'
            ? 'Incolla le righe dal report TicketSMS (colonne A:L del foglio Reverse): raggruppa automaticamente ogni sotto-PR, calcola scarichi e buste.'
            : 'Incolla le righe dal tuo foglio Excel o Google Sheets: raggruppa automaticamente ogni sotto-PR, calcola scarichi e buste.'
        }
        maxWidth="max-w-[580px]"
      >
        <div className="space-y-4">
          <textarea
            rows={7}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={
              ownerPromoterId === 'lollo'
                ? 'Incolla qui direttamente da TicketSMS / Excel / Google Sheets…'
                : 'Incolla qui direttamente da Excel / Google Sheets…'
            }
            className="apple-input w-full rounded-[12px] p-3 text-[16px] md:text-[13px] font-mono"
          />

          {importPreview.length > 0 && (
            <div
              className="rounded-[12px] p-3.5 max-h-[200px] overflow-y-auto space-y-1.5"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                Rilevati {importPreview.length} sotto-PR
              </div>
              {importPreview.map((r) => (
                <div
                  key={r.promoterName}
                  className="flex items-center justify-between text-[13px] tabular-nums"
                >
                  <span className="font-semibold truncate">{r.promoterName}</span>
                  <span className="shrink-0">
                    {r.quantity} preve · {formatEur(r.revenue)} · Scar. {formatEur(r.scarico)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="rounded-[10px] px-4 py-2 text-[14px] font-medium apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={importing || importPreview.length === 0}
              onClick={handleApplyImport}
              className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer disabled:opacity-45"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {importing ? 'Importazione…' : `Importa ${importPreview.length} PR`}
            </button>
          </div>
        </div>
      </AppleModal>

      {/* Add Sub-PR Presale Modal */}
      <AppleModal
        open={showAddPresaleModal}
        onClose={() => setShowAddPresaleModal(false)}
        title="Aggiungi prevendite sotto-PR"
        subtitle={`${event.venue_name} · ${event.title}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddPresaleSubmit(false);
          }}
          className="space-y-4"
        >
          <div>
            <span
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Sotto-PR
            </span>
            <StaffMemberPicker
              members={members}
              selectedMemberId={newPreveMemberId || null}
              prioritizedIds={prioritizedMemberIds}
              usageScores={memberUsageScore}
              compact
              onQuickCreate={onQuickCreateMember}
              onSelect={(m) => setNewPreveMemberId(m.id)}
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                N. preve
              </span>
              <NumericCellInput
                value={newPreveQty}
                integer
                onCommit={setNewPreveQty}
                ariaLabel="Numero prevendite"
              />
            </div>
            <div>
              <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                € preve
              </span>
              <NumericCellInput
                value={newPreveRev}
                onCommit={(v) => {
                  setNewPreveRev(v);
                  if (newPreveScarico === 0) setNewPreveScarico(v);
                }}
                ariaLabel="Incasso prevendite"
              />
            </div>
            <div>
              <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Scarico €
              </span>
              <NumericCellInput
                value={newPreveScarico}
                onCommit={setNewPreveScarico}
                ariaLabel="Scarico"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => handleAddPresaleSubmit(true)}
              className="rounded-[10px] px-3.5 py-2 text-[13px] font-semibold apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              Salva e altro
            </button>
            <button
              type="submit"
              className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Aggiungi
            </button>
          </div>
        </form>
      </AppleModal>

      {/* Add Sub-PR Table Modal / Sheet */}
      <AppleModal
        open={showAddTableModal}
        onClose={() => setShowAddTableModal(false)}
        title={`Nuovo tavolo · ${staffGroup.name}`}
        subtitle={`${event.venue_name} · ${event.title}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddTableSubmit(false);
          }}
          className="space-y-4"
        >
          <div>
            <span
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Sotto-PR (tavoli dello stesso PR si sommano per gli scaglioni)
            </span>
            <StaffMemberPicker
              members={members}
              selectedMemberId={newTblMemberId || null}
              prioritizedIds={prioritizedMemberIds}
              usageScores={memberUsageScore}
              compact
              onQuickCreate={onQuickCreateMember}
              onSelect={(m) => setNewTblMemberId(m.id)}
            />
          </div>

          <div>
            <label
              htmlFor="st-tbl-name"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nome tavolo
            </label>
            <input
              ref={modalTblNameRef}
              id="st-tbl-name"
              type="text"
              required
              autoComplete="off"
              value={newTblName}
              onChange={(e) => setNewTblName(e.target.value)}
              placeholder="Es. Savage, Privè, 5Stelle…"
              className="apple-input w-full rounded-[10px] px-3 py-2.5 text-[16px] md:text-[15px]"
            />
          </div>

          {/* Paganti Stepper + Quick Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                N° paganti
              </span>
              <div className="flex items-center gap-2">
                <AppleStepper
                  value={newTblPayers}
                  onChange={setNewTblPayers}
                  label="Numero paganti"
                />
                <NumericCellInput
                  value={newTblPayers}
                  integer
                  onCommit={setNewTblPayers}
                  ariaLabel="Paganti"
                  className="w-16"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PAYERS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNewTblPayers(n)}
                  className="rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums apple-press cursor-pointer"
                  style={{
                    backgroundColor:
                      newTblPayers === n ? 'var(--accent)' : 'var(--bg-surface-secondary)',
                    color: newTblPayers === n ? '#FFFFFF' : 'var(--ink-primary)',
                  }}
                >
                  {n} px
                </button>
              ))}
            </div>
          </div>

          {/* Prezzo + Quick Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Prezzo (€ / px)
              </span>
              <NumericCellInput
                value={newTblPrice}
                prefix="€"
                onCommit={setNewTblPrice}
                ariaLabel="Prezzo tavolo"
                className="w-28"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quickTablePrices.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNewTblPrice(p)}
                  className="rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums apple-press cursor-pointer"
                  style={{
                    backgroundColor:
                      newTblPrice === p ? 'var(--accent)' : 'var(--bg-surface-secondary)',
                    color: newTblPrice === p ? '#FFFFFF' : 'var(--ink-primary)',
                  }}
                >
                  {p} €
                </button>
              ))}
            </div>
          </div>

          {/* Stato scarico (sincronizzato con Lollo & Ciccio) */}
          <div>
            <span
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Stato scarico (collegato a Lollo &amp; Ciccio)
            </span>
            <SegmentedControl<ScaricoStatus>
              ariaLabel="Stato scarico tavolo"
              size="sm"
              className="w-full"
              value={newTblScarico}
              onChange={setNewTblScarico}
              options={[
                { value: 'DA SCARICARE', label: 'Da scaricare' },
                { value: 'DA NON SCARICARE', label: 'No scarico (PR 0 €)' },
              ]}
            />
          </div>

          {/* Extra & Sovraprezzo collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setShowModalSov((v) => !v)}
              className="inline-flex items-center gap-1 text-[13px] font-medium cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              {showModalSov ? 'Nascondi extra e sovraprezzo' : '+ Extra o sovraprezzo'}
            </button>
            {showModalSov && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <div>
                  <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Extra Sì scar. (€)
                  </span>
                  <NumericCellInput
                    value={newTblExtra}
                    onCommit={setNewTblExtra}
                    ariaLabel="Extra sì scarico"
                  />
                </div>
                <div>
                  <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Extra No scar. (€)
                  </span>
                  <NumericCellInput
                    value={newTblExtraNo}
                    onCommit={setNewTblExtraNo}
                    ariaLabel="Extra no scarico"
                  />
                </div>
                <div>
                  <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Pag. sovr.
                  </span>
                  <NumericCellInput
                    value={newTblSovPayers}
                    integer
                    onCommit={setNewTblSovPayers}
                    ariaLabel="Paganti sovraprezzo"
                  />
                </div>
                <div>
                  <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Prezzo rial.
                  </span>
                  <NumericCellInput
                    value={newTblSovPrice}
                    onCommit={setNewTblSovPrice}
                    ariaLabel="Prezzo rialzato"
                  />
                </div>
              </div>
            )}
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-2 pt-3"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <div className="tabular-nums">
              <span className="block text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                Credito stimato
              </span>
              <span className="text-[18px] font-bold">
                {formatEur(
                  newTblPayers * newTblPrice +
                    newTblSovPayers * newTblSovPrice +
                    newTblExtra +
                    newTblExtraNo
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAddTableSubmit(true)}
                className="rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                Salva e altro
              </button>
              <button
                type="submit"
                className="rounded-[10px] px-4 py-2.5 text-[14px] font-semibold text-white apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Aggiungi
              </button>
            </div>
          </div>
        </form>
      </AppleModal>
    </div>
  );
}
