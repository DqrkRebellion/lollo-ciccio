import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  FileSpreadsheet,
  Info,
  Plus,
  Redo2,
  Share2,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  APPLE_SPRING_SNAPPY,
  AppleModal,
  AppleStepper,
  AppleSwitch,
  MancantiBadge,
  NumericCellInput,
  SegmentedControl,
} from './ui/AppleControls';
import { computeTable, resolveRules } from '../lib/calculations';
import {
  buildWhatsAppSummary,
  formatDateFull,
  formatEur,
  formatInt,
  formatPercent,
  parsePresaleReport,
} from '../lib/format';
import type {
  AppSettings,
  EventMode,
  EventPresale,
  EventPrReconciliation,
  EventRecord,
  EventSummary,
  EventTable,
  FullEvent,
  PresaleInputMode,
  Promoter,
  ScaricoStatus,
  Venue,
} from '../types';

const SCARICO_CYCLE: ScaricoStatus[] = ['DA SCARICARE', 'DA NON SCARICARE', '-'];
const QUICK_PAYERS = [5, 8, 10, 12, 15, 20];

function nextScarico(cur: ScaricoStatus): ScaricoStatus {
  const i = SCARICO_CYCLE.indexOf(cur);
  return SCARICO_CYCLE[(i + 1) % SCARICO_CYCLE.length];
}

function ScaricoPill({
  status,
  onClick,
}: {
  status: ScaricoStatus;
  onClick: () => void;
}) {
  const styles =
    status === 'DA SCARICARE'
      ? { bg: 'var(--accent-subtle)', fg: 'var(--accent)', label: 'Da scaricare' }
      : status === 'DA NON SCARICARE'
        ? {
            bg: 'var(--bg-surface-secondary)',
            fg: 'var(--ink-secondary)',
            label: 'No scarico',
          }
        : { bg: 'var(--bg-surface-secondary)', fg: 'var(--ink-tertiary)', label: '—' };

  return (
    <button
      type="button"
      onClick={onClick}
      title="Clicca per cambiare stato scarico"
      className="rounded-full px-2.5 py-1 text-[12px] md:text-[11px] font-semibold apple-press cursor-pointer whitespace-nowrap transition-colors"
      style={{ backgroundColor: styles.bg, color: styles.fg }}
    >
      {styles.label}
    </button>
  );
}

export function EventDetail({
  event,
  summary,
  settings,
  promoters,
  venues,
  canUndo,
  canRedo,
  lastUndoLabel,
  lastRedoLabel,
  onUndo,
  onRedo,
  onBackMobile,
  onUpdateEvent,
  onDuplicateEvent,
  onDeleteEvent,
  onUpsertPresale,
  onUpsertPresalesBatch,
  onUpsertReconciliation,
  onUpsertReconciliationsBatch,
  onAddTable,
  onUpdateTable,
  onDeleteTable,
}: {
  event: FullEvent;
  summary: EventSummary;
  settings: AppSettings;
  promoters: Promoter[];
  venues: Venue[];
  canUndo: boolean;
  canRedo: boolean;
  lastUndoLabel: string | null;
  lastRedoLabel: string | null;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onBackMobile?: () => void;
  onUpdateEvent: (id: string, patch: Partial<EventRecord>) => Promise<void>;
  onDuplicateEvent: (ev: FullEvent) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onUpsertPresale: (
    eventId: string,
    promoterId: string,
    patch: Partial<Pick<EventPresale, 'quantity' | 'revenue' | 'one_to_one'>>
  ) => Promise<void>;
  onUpsertPresalesBatch: (
    eventId: string,
    patches: {
      promoterId: string;
      patch: Partial<Pick<EventPresale, 'quantity' | 'revenue' | 'one_to_one'>>;
    }[],
    label?: string
  ) => Promise<void>;
  onUpsertReconciliation: (
    eventId: string,
    promoterId: string,
    patch: Partial<
      Pick<EventPrReconciliation, 'lista_pr_count' | 'note_amount' | 'note_text' | 'scaricato_amount'>
    >
  ) => Promise<void>;
  onUpsertReconciliationsBatch: (
    eventId: string,
    patches: {
      promoterId: string;
      patch: Partial<
        Pick<
          EventPrReconciliation,
          'lista_pr_count' | 'note_amount' | 'note_text' | 'scaricato_amount'
        >
      >;
    }[],
    label?: string
  ) => Promise<void>;
  onAddTable: (
    eventId: string,
    table: Omit<EventTable, 'id' | 'event_id' | 'sort_order'>
  ) => Promise<EventTable | null>;
  onUpdateTable: (eventId: string, tableId: string, patch: Partial<EventTable>) => Promise<void>;
  onDeleteTable: (eventId: string, tableId: string) => Promise<void>;
}) {
  const [showFormula, setShowFormula] = useState(false);
  const [showSurcharge, setShowSurcharge] = useState(
    () =>
      settings.show_surcharge_columns ||
      event.tables.some((t) => t.surcharge_payers_count > 0 || t.surcharge_price > 0)
  );
  const [showEditMeta, setShowEditMeta] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [showModalExtras, setShowModalExtras] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expandedMobilePrs, setExpandedMobilePrs] = useState<Record<string, boolean>>({});
  const [expandedMobileTables, setExpandedMobileTables] = useState<Record<string, boolean>>({});
  const [showMobileExtraCash, setShowMobileExtraCash] = useState(
    () => event.lista_cost > 0 || event.general_note_amount !== 0
  );

  // Import prevendite state
  const [importText, setImportText] = useState('');

  // Quick-add table form state
  const defaultVenueObj = venues.find(
    (v) => v.id === event.venue_id || v.name === event.venue_name
  );
  const defaultPrice = defaultVenueObj?.default_table_price || settings.quick_table_prices[1] || 30;
  const activePrs = useMemo(
    () => promoters.filter((p) => summary.promoterOrder.includes(p.id)),
    [promoters, summary.promoterOrder]
  );
  const selectablePrs = useMemo(
    () => (activePrs.length > 0 ? activePrs : promoters.filter((p) => p.is_active)),
    [activePrs, promoters]
  );

  const [newTablePr, setNewTablePr] = useState<string>(selectablePrs[0]?.id || 'lollo');
  const [newTableName, setNewTableName] = useState('');
  const [newTablePayers, setNewTablePayers] = useState<number>(0);
  const [newTablePrice, setNewTablePrice] = useState<number>(defaultPrice);
  const [newTableSurchargePayers, setNewTableSurchargePayers] = useState<number>(0);
  const [newTableSurchargePrice, setNewTableSurchargePrice] = useState<number>(0);
  const [newTableExtraNo, setNewTableExtraNo] = useState<number>(0);
  const [newTableExtraSi, setNewTableExtraSi] = useState<number>(0);
  const [newTableScarico, setNewTableScarico] = useState<ScaricoStatus>(
    settings.default_table_scarico
  );

  const modalTableNameRef = useRef<HTMLInputElement>(null);
  const rules = resolveRules(event, settings);

  const promoterById = useMemo(() => {
    const map = new Map<string, Promoter>();
    for (const p of promoters) map.set(p.id, p);
    return map;
  }, [promoters]);

  const getPromoter = (id: string): Promoter =>
    promoterById.get(id) || {
      id,
      display_name: id.charAt(0).toUpperCase() + id.slice(1),
      full_name: id,
      color: '#0071E3',
      is_active: true,
      sort_order: 99,
    };

  // Bonus tier progress calculation
  const sortedTiersAsc = useMemo(
    () => [...rules.bonus_tiers].sort((a, b) => a.threshold - b.threshold),
    [rules.bonus_tiers]
  );
  const maxTierThreshold = sortedTiersAsc[sortedTiersAsc.length - 1]?.threshold || 10000;
  const bonusProgressPct =
    event.mode === '-'
      ? 0
      : Math.min(100, Math.max(0, (summary.revenueTotal / maxTierThreshold) * 100));

  const handleCopyWhatsApp = async () => {
    const text = buildWhatsAppSummary(event, summary, promoters);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Riepilogo serata copiato per WhatsApp');
    } catch {
      toast.error('Impossibile copiare negli appunti');
    }
  };

  const resetNewTableForm = () => {
    setNewTableName('');
    setNewTablePayers(0);
    setNewTableSurchargePayers(0);
    setNewTableSurchargePrice(0);
    setNewTableExtraNo(0);
    setNewTableExtraSi(0);
  };

  const handleQuickAddTable = async (keepOpen = false) => {
    if (
      !newTableName.trim() &&
      newTablePayers === 0 &&
      newTableExtraNo === 0 &&
      newTableExtraSi === 0
    ) {
      toast.error('Inserisci almeno il nome o il numero di paganti');
      return;
    }
    const created = await onAddTable(event.id, {
      promoter_id: newTablePr,
      table_name: newTableName.trim() || 'Nuovo tavolo',
      payers_count: newTablePayers,
      price: newTablePrice,
      surcharge_payers_count: newTableSurchargePayers,
      surcharge_price: newTableSurchargePrice,
      extra_no_scarico: newTableExtraNo,
      extra_si_scarico: newTableExtraSi,
      scarico_status: newTableScarico,
    });
    if (!created) return;
    resetNewTableForm();
    if (keepOpen) {
      toast.success(`Tavolo “${created.table_name}” aggiunto — inserisci il prossimo`);
      window.setTimeout(() => modalTableNameRef.current?.focus(), 60);
    } else {
      setShowAddTableModal(false);
      toast.success(`Tavolo “${created.table_name}” aggiunto`);
    }
  };

  const handleImportPreview = useMemo(
    () => parsePresaleReport(importText, promoters),
    [importText, promoters]
  );

  const handleApplyImport = async () => {
    if (handleImportPreview.length === 0) return;
    await onUpsertPresalesBatch(
      event.id,
      handleImportPreview.map((row) => ({
        promoterId: row.promoterId,
        patch: {
          quantity: row.quantity,
          revenue: row.revenue,
          one_to_one: row.one_to_one,
        },
      })),
      'Import report prevendite'
    );
    setImportText('');
    setShowImportModal(false);
    toast.success('Report prevendite importato');
  };

  // --- Prevendite: Smart "Totale − Lollo → Ciccio" ---
  const primaryPrId = summary.promoterOrder.includes('lollo')
    ? 'lollo'
    : summary.promoterOrder[0] || 'lollo';
  const secondaryPrId =
    summary.promoterOrder.find((id) => id !== primaryPrId) || 'ciccio';
  const isTotalMinusMode =
    event.presale_input_mode === 'total_minus_primary' && summary.promoterOrder.length === 2;

  const primaryPresale = event.presales.find((p) => p.promoter_id === primaryPrId);

  const handleTotalPresaleEdit = (
    field: 'quantity' | 'revenue' | 'one_to_one',
    newTotal: number
  ) => {
    const primaryVal = primaryPresale ? Number(primaryPresale[field]) || 0 : 0;
    if (newTotal < primaryVal) {
      toast.error(
        `Il totale (${newTotal}) è inferiore al dato di ${getPromoter(primaryPrId).display_name} (${primaryVal})`
      );
      return;
    }
    const secondaryNext = Math.round((newTotal - primaryVal) * 100) / 100;
    onUpsertPresalesBatch(
      event.id,
      [{ promoterId: secondaryPrId, patch: { [field]: secondaryNext } }],
      'Aggiornamento totale prevendite'
    );
  };

  const handlePrimaryPresaleEditInTotalMode = (
    field: 'quantity' | 'revenue' | 'one_to_one',
    newPrimaryVal: number
  ) => {
    const currentTotal =
      field === 'quantity'
        ? summary.pxPresales
        : field === 'revenue'
          ? summary.revenuePresales
          : summary.oneToOnePresales;
    const secondaryNext = Math.max(
      0,
      Math.round((currentTotal - newPrimaryVal) * 100) / 100
    );
    onUpsertPresalesBatch(
      event.id,
      [
        { promoterId: primaryPrId, patch: { [field]: newPrimaryVal } },
        { promoterId: secondaryPrId, patch: { [field]: secondaryNext } },
      ],
      `Prevendite ${getPromoter(primaryPrId).display_name} (Ciccio auto)`
    );
  };

  const cycleTablePromoter = (t: EventTable) => {
    const ids = selectablePrs.map((p) => p.id);
    if (ids.length < 2) return;
    const next = ids[(ids.indexOf(t.promoter_id) + 1) % ids.length];
    onUpdateTable(event.id, t.id, { promoter_id: next });
  };

  const handleSettlePr = (promoterId: string) => {
    const pr = summary.byPromoter[promoterId];
    if (!pr) return;
    const targetScaricato = Math.max(
      0,
      Math.round((pr.scaricoTotal + pr.noteAmount) * 100) / 100
    );
    onUpsertReconciliationsBatch(
      event.id,
      [{ promoterId, patch: { scaricato_amount: targetScaricato } }],
      `Salda scarico ${getPromoter(promoterId).display_name}`
    );
    toast.success(`Scarico ${getPromoter(promoterId).display_name} saldato`);
  };

  const handleSettleAll = () => {
    const patches = summary.promoterOrder
      .filter((pid) => Math.abs(summary.byPromoter[pid]?.mancanti ?? 0) >= 0.01)
      .map((pid) => {
        const pr = summary.byPromoter[pid];
        return {
          promoterId: pid,
          patch: {
            scaricato_amount: Math.max(
              0,
              Math.round((pr.scaricoTotal + pr.noteAmount) * 100) / 100
            ),
          },
        };
      });
    if (patches.length === 0) return;
    onUpsertReconciliationsBatch(event.id, patches, 'Salda tutto serata');
    toast.success('Scarichi serata saldati');
  };

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4 pb-36 lg:pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {onBackMobile && (
            <button
              type="button"
              onClick={onBackMobile}
              className="lg:hidden -ml-2 inline-flex items-center gap-0.5 rounded-[10px] px-2 py-1.5 text-[15px] font-medium apple-press cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              Serate
            </button>
          )}
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{
              backgroundColor: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-card)',
              color: 'var(--ink-primary)',
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: defaultVenueObj?.color || 'var(--accent)' }}
            />
            {event.venue_name}
          </span>
          {event.era === '3PX' && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-secondary)',
              }}
            >
              3 PR
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Dedicated Undo / Redo Pill */}
          <div
            className="inline-flex items-center rounded-[10px] p-0.5 apple-surface"
            role="group"
            aria-label="Cronologia modifiche"
          >
            <button
              type="button"
              disabled={!canUndo}
              onClick={() => onUndo()}
              title={lastUndoLabel ? `Annulla: ${lastUndoLabel} (Ctrl+Z)` : 'Niente da annullare'}
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
              aria-label="Ripristina modifica"
              className="inline-flex items-center justify-center rounded-[8px] px-2 py-1 apple-press cursor-pointer disabled:opacity-30"
              style={{ color: canRedo ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowEditMeta(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 sm:px-3 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
            aria-label="Modifica dati serata"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Modifica</span>
          </button>
          <button
            type="button"
            onClick={handleCopyWhatsApp}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 sm:px-3 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
            title="Copia riepilogo WhatsApp"
            aria-label="Copia riepilogo WhatsApp"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">WhatsApp</span>
          </button>
          <button
            type="button"
            onClick={() => onDuplicateEvent(event)}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
            aria-label="Duplica serata"
            title="Duplica struttura serata"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
            style={{ color: 'var(--status-red)' }}
            aria-label="Elimina serata"
            title="Elimina serata"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Title + Event Mode + Busta Paid Switch */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3.5 mb-5">
        <div className="min-w-0">
          <h1 className="text-[24px] sm:text-[32px] font-bold tracking-tight truncate">
            {event.title}
          </h1>
          <p className="mt-0.5 text-[13px] sm:text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            {formatDateFull(event.event_date)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl<EventMode>
            ariaLabel="Modalità serata"
            size="sm"
            value={event.mode}
            onChange={(m) => onUpdateEvent(event.id, { mode: m })}
            className="w-full sm:w-auto"
            options={[
              { value: 'NO OSPITE', label: `No ospite ${formatPercent(rules.table_rate_no_guest)}` },
              { value: 'OSPITE', label: `Ospite ${formatPercent(rules.table_rate_guest)}` },
              { value: '-', label: 'Off' },
            ]}
          />

          <label className="w-full sm:w-auto inline-flex items-center justify-between sm:justify-start gap-2.5 rounded-[12px] px-3.5 py-2 sm:py-1.5 apple-surface cursor-pointer select-none">
            <span className="text-[13px] font-medium">Busta saldata</span>
            <AppleSwitch
              checked={event.is_busta_paid}
              onChange={(checked) => {
                onUpdateEvent(event.id, { is_busta_paid: checked });
                toast.success(checked ? 'Busta segnata come saldata' : 'Busta segnata da incassare');
              }}
              label="Busta saldata"
            />
          </label>
        </div>
      </div>

      {/* 1. Unified Financial Overview Strip */}
      <section className="apple-surface rounded-[18px] overflow-hidden mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-[var(--separator)]">
          {/* PX Totali */}
          <div className="p-3.5 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Ingressi totali
            </span>
            <div className="mt-1 text-[24px] sm:text-[28px] font-bold tracking-tight tabular-nums leading-none">
              {formatInt(summary.pxTotal)}
              <span className="ml-1 text-[13px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                px
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span>Preve {formatInt(summary.pxPresales)}</span>
              <span>Tavoli {formatInt(summary.pxTables)}</span>
            </div>
          </div>

          {/* Fatturato Totale */}
          <div className="p-3.5 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Fatturato totale
            </span>
            <div className="mt-1 text-[24px] sm:text-[28px] font-bold tracking-tight tabular-nums leading-none whitespace-nowrap">
              {formatEur(summary.revenueTotal)}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span className="whitespace-nowrap">Preve {formatEur(summary.revenuePresales)}</span>
              <span className="whitespace-nowrap">Tavoli {formatEur(summary.revenueTables)}</span>
            </div>
          </div>

          {/* Busta Totale */}
          <div className="p-3.5 sm:p-5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
                Busta serata
              </span>
              <button
                type="button"
                onClick={() => setShowFormula((s) => !s)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                style={{ color: 'var(--accent)' }}
              >
                <Info className="h-3 w-3" aria-hidden="true" />
                Dettaglio
              </button>
            </div>
            <div
              className="mt-1 text-[24px] sm:text-[28px] font-bold tracking-tight tabular-nums leading-none whitespace-nowrap"
              style={{ color: event.is_busta_paid ? 'var(--status-green)' : 'var(--ink-primary)' }}
            >
              {formatEur(summary.bustaTotal, true)}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {summary.bonusAmount > 0 ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                  style={{ backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)' }}
                >
                  Bonus +{formatEur(summary.bonusAmount)}
                </span>
              ) : (
                <span>Nessun bonus</span>
              )}
              {summary.isBustaOverridden && (
                <span style={{ color: 'var(--status-orange)' }}>· Manuale</span>
              )}
            </div>
          </div>

          {/* Scarico & Mancanti */}
          <div className="p-3.5 sm:p-5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
                Mancanti
              </span>
              {summary.mancantiTotal > 0.01 && (
                <button
                  type="button"
                  onClick={handleSettleAll}
                  className="text-[11px] font-semibold cursor-pointer apple-press whitespace-nowrap"
                  style={{ color: 'var(--accent)' }}
                >
                  Salda tutto
                </button>
              )}
            </div>
            <div className="mt-1.5">
              <MancantiBadge value={summary.mancantiTotal} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span className="whitespace-nowrap">Scarico {formatEur(summary.scaricoTotal)}</span>
              <span className="whitespace-nowrap">Versati {formatEur(summary.scaricatoTotal)}</span>
            </div>
          </div>
        </div>

        {/* Bonus Tier Progress Bar */}
        {event.mode !== '-' && sortedTiersAsc.length > 0 && (
          <div
            className="px-4 sm:px-5 py-3"
            style={{
              borderTop: '0.5px solid var(--separator)',
              backgroundColor: 'var(--bg-surface)',
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[12px] mb-2">
              <span className="font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Bonus fatturato
              </span>
              <span className="tabular-nums font-medium">
                {summary.nextBonusTier ? (
                  <>
                    A{' '}
                    <strong style={{ color: 'var(--accent)' }}>
                      {formatEur(summary.amountToNextBonus)}
                    </strong>{' '}
                    da {formatEur(summary.nextBonusTier.threshold)} (+
                    {formatEur(summary.nextBonusTier.bonus)})
                  </>
                ) : (
                  <span style={{ color: 'var(--status-green)' }}>
                    Massimo scaglione raggiunto (+{formatEur(summary.bonusAmount)})
                  </span>
                )}
              </span>
            </div>
            <div
              className="relative h-2 w-full rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              <motion.div
                initial={false}
                animate={{ width: `${bonusProgressPct}%` }}
                transition={APPLE_SPRING_SNAPPY}
                className="h-full rounded-full"
                style={{
                  backgroundColor: summary.bonusAmount > 0 ? '#34C759' : 'var(--accent)',
                }}
              />
            </div>
            <div
              className="mt-1.5 hidden sm:flex items-center justify-between text-[11px] tabular-nums"
              style={{ color: 'var(--ink-tertiary)' }}
            >
              <span>0 €</span>
              {sortedTiersAsc.map((t) => {
                const hit = summary.revenueTotal > t.threshold;
                return (
                  <span
                    key={t.threshold}
                    className="font-medium"
                    style={{ color: hit ? 'var(--status-green)' : 'var(--ink-tertiary)' }}
                  >
                    {formatEur(t.threshold)} → +{formatEur(t.bonus)}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Expandable Formula Breakdown */}
        <AnimatePresence initial={false}>
          {showFormula && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={APPLE_SPRING_SNAPPY}
              className="overflow-hidden"
              style={{ borderTop: '0.5px solid var(--separator)' }}
            >
              <div
                className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 text-[13px]"
                style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
              >
                <div className="space-y-1 tabular-nums">
                  <div>
                    <span style={{ color: 'var(--ink-secondary)' }}>Prevendite: </span>
                    <strong>
                      {summary.pxPresales} × {formatEur(rules.presale_commission, true)} ={' '}
                      {formatEur(summary.bustaPresales, true)}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-secondary)' }}>Tavoli ({event.mode}): </span>
                    <strong>
                      {formatEur(summary.revenueTables)} × {formatPercent(summary.tableRate)} ={' '}
                      {formatEur(summary.bustaTables, true)}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-secondary)' }}>Bonus scaglione: </span>
                    <strong>{formatEur(summary.bonusAmount, true)}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                    Forza busta (€):
                  </span>
                  <NumericCellInput
                    value={event.busta_override ?? 0}
                    placeholder="Auto"
                    onCommit={(val) =>
                      onUpdateEvent(event.id, { busta_override: val > 0 ? val : null })
                    }
                    ariaLabel="Forza importo busta manuale"
                    className="w-24"
                  />
                  {event.busta_override !== null && (
                    <button
                      type="button"
                      onClick={() => onUpdateEvent(event.id, { busta_override: null })}
                      className="text-[12px] font-semibold cursor-pointer"
                      style={{ color: 'var(--accent)' }}
                    >
                      Auto
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* 2. Riepilogo PR & Cassa — Zero-scroll cards on mobile, full table on desktop */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 px-1">
          <h2 className="text-[18px] font-semibold">Riepilogo PR &amp; Cassa</h2>

          {/* Desktop inline Lista / Rettifica */}
          <div className="hidden md:flex items-center gap-3">
            <label
              className="inline-flex items-center gap-2 text-[13px]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span>Costo lista</span>
              <NumericCellInput
                value={event.lista_cost}
                onCommit={(v) => onUpdateEvent(event.id, { lista_cost: v })}
                prefix="€"
                ariaLabel="Costo lista PR"
                className="w-20"
              />
            </label>
            <label
              className="inline-flex items-center gap-2 text-[13px]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span>Rettifica gen.</span>
              <NumericCellInput
                value={event.general_note_amount}
                onCommit={(v) => onUpdateEvent(event.id, { general_note_amount: v })}
                allowNegative
                prefix="€"
                ariaLabel="Note rettifica generale"
                className="w-24"
              />
            </label>
          </div>

          {/* Mobile toggle for Costo lista & Rettifica gen. */}
          <button
            type="button"
            onClick={() => setShowMobileExtraCash((v) => !v)}
            className="md:hidden inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-[12px] font-medium apple-surface apple-press cursor-pointer"
            style={{ color: 'var(--ink-secondary)' }}
          >
            Lista / Rettifica
            {showMobileExtraCash ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Mobile Extra Cash Settings */}
        {showMobileExtraCash && (
          <div className="md:hidden apple-surface rounded-[14px] p-3 mb-2.5 grid grid-cols-2 gap-2.5">
            <div>
              <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Costo lista (€ / px)
              </span>
              <NumericCellInput
                value={event.lista_cost}
                prefix="€"
                onCommit={(v) => onUpdateEvent(event.id, { lista_cost: v })}
                ariaLabel="Costo lista PR"
              />
            </div>
            <div>
              <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                Rettifica generale (€)
              </span>
              <NumericCellInput
                value={event.general_note_amount}
                allowNegative
                prefix="€"
                onCommit={(v) => onUpdateEvent(event.id, { general_note_amount: v })}
                ariaLabel="Rettifica generale"
              />
            </div>
          </div>
        )}

        {/* Mobile PR Cards (ZERO horizontal scroll!) */}
        <div className="md:hidden space-y-2.5">
          {summary.promoterOrder.map((pid) => {
            const pr = summary.byPromoter[pid];
            const meta = getPromoter(pid);
            if (!pr) return null;
            const expanded = Boolean(expandedMobilePrs[pid]);
            return (
              <div key={pid} className="apple-surface rounded-[16px] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                      style={{ backgroundColor: meta.color }}
                    >
                      {meta.display_name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold leading-tight">
                        {meta.display_name}
                      </div>
                      <div
                        className="text-[12px] tabular-nums"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        {formatInt(pr.pxTotal)} px ({pr.pxPresales}p · {pr.pxTables}t) ·{' '}
                        {formatEur(pr.revenueTotal)}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    <div className="text-[16px] font-bold">{formatEur(pr.bustaTotal, true)}</div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                      Busta{pr.bustaBonusShare > 0 ? ` (+${formatEur(pr.bustaBonusShare)})` : ''}
                    </div>
                  </div>
                </div>

                {/* Fast Cash Row: Scarico -> Scaricato -> Mancanti */}
                <div
                  className="flex items-center justify-between gap-2 pt-2.5"
                  style={{ borderTop: '0.5px solid var(--separator)' }}
                >
                  <div className="min-w-0">
                    <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                      Scarico: <strong className="tabular-nums">{formatEur(pr.scaricoTotal)}</strong>
                    </div>
                    <div className="mt-1">
                      <MancantiBadge value={pr.mancanti} compact />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <div className="w-[104px]">
                      <NumericCellInput
                        value={pr.scaricatoAmount}
                        prefix="€"
                        placeholder="Versato"
                        onCommit={(v) =>
                          onUpsertReconciliation(event.id, pid, { scaricato_amount: v })
                        }
                        ariaLabel={`Scaricato ${meta.display_name}`}
                      />
                    </div>
                    {pr.mancanti > 0.01 && (
                      <button
                        type="button"
                        onClick={() => handleSettlePr(pid)}
                        className="flex h-[38px] px-2.5 shrink-0 items-center justify-center gap-1 rounded-[9px] text-[12px] font-semibold apple-press cursor-pointer"
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
                </div>

                {/* Expandable Lista PR & Note € */}
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedMobilePrs((prev) => ({ ...prev, [pid]: !prev[pid] }))
                    }
                    className="inline-flex items-center gap-1 text-[12px] font-medium cursor-pointer"
                    style={{ color: 'var(--ink-tertiary)' }}
                  >
                    {expanded ? 'Nascondi lista e note' : 'Lista PR e note'}
                    {(pr.listaPrCount > 0 || pr.noteAmount !== 0) && !expanded && (
                      <span style={{ color: 'var(--accent)' }}>
                        ({pr.listaPrCount > 0 ? `${pr.listaPrCount} lista` : ''}
                        {pr.listaPrCount > 0 && pr.noteAmount !== 0 ? ' · ' : ''}
                        {pr.noteAmount !== 0 ? formatEur(pr.noteAmount) : ''})
                      </span>
                    )}
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>

                  {expanded && (
                    <div className="mt-2 grid grid-cols-2 gap-2.5">
                      <div>
                        <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                          Lista PR (px)
                        </span>
                        <NumericCellInput
                          value={pr.listaPrCount}
                          integer
                          onCommit={(v) =>
                            onUpsertReconciliation(event.id, pid, { lista_pr_count: v })
                          }
                          ariaLabel={`Lista PR ${meta.display_name}`}
                        />
                      </div>
                      <div>
                        <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                          Note / Rettifica (€)
                        </span>
                        <NumericCellInput
                          value={pr.noteAmount}
                          allowNegative
                          prefix="€"
                          onCommit={(v) =>
                            onUpsertReconciliation(event.id, pid, { note_amount: v })
                          }
                          ariaLabel={`Note ${meta.display_name}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop PR Table */}
        <div className="hidden md:block apple-surface rounded-[16px] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr
                className="text-[12px] font-medium"
                style={{
                  color: 'var(--ink-secondary)',
                  borderBottom: '0.5px solid var(--separator)',
                }}
              >
                <th className="py-3 pl-4 pr-2 font-medium">Promoter</th>
                <th className="py-3 px-2 text-right font-medium">PX</th>
                <th className="py-3 px-2 text-right font-medium w-[92px]">Lista PR</th>
                <th className="py-3 px-2 text-right font-medium">Scarico</th>
                <th className="py-3 px-2 text-right font-medium w-[108px]">Note (€)</th>
                <th className="py-3 px-2 text-right font-medium w-[148px]">Scaricato</th>
                <th className="py-3 px-2 text-right font-medium">Mancanti</th>
                <th className="py-3 pl-2 pr-4 text-right font-medium">Busta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)] text-[14px]">
              {summary.promoterOrder.map((pid) => {
                const pr = summary.byPromoter[pid];
                const meta = getPromoter(pid);
                if (!pr) return null;
                return (
                  <tr key={pid} className="transition-colors hover:bg-[var(--bg-hover)]">
                    <td className="py-3 pl-4 pr-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                          style={{ backgroundColor: meta.color }}
                        >
                          {meta.display_name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold leading-tight">{meta.display_name}</div>
                          <div
                            className="text-[11px] tabular-nums"
                            style={{ color: 'var(--ink-tertiary)' }}
                          >
                            {formatEur(pr.revenueTotal)} fatt.
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right font-semibold tabular-nums">
                      {formatInt(pr.pxTotal)}
                      <div
                        className="text-[11px] font-normal"
                        style={{ color: 'var(--ink-tertiary)' }}
                      >
                        {pr.pxPresales}p · {pr.pxTables}t
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <NumericCellInput
                        value={pr.listaPrCount}
                        integer
                        onCommit={(v) =>
                          onUpsertReconciliation(event.id, pid, { lista_pr_count: v })
                        }
                        ariaLabel={`Lista PR ${meta.display_name}`}
                      />
                    </td>
                    <td className="py-3 px-2 text-right font-medium tabular-nums">
                      {formatEur(pr.scaricoTotal)}
                    </td>
                    <td className="py-3 px-2">
                      <NumericCellInput
                        value={pr.noteAmount}
                        allowNegative
                        prefix="€"
                        onCommit={(v) =>
                          onUpsertReconciliation(event.id, pid, { note_amount: v })
                        }
                        ariaLabel={`Note rettifica ${meta.display_name}`}
                      />
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <NumericCellInput
                          value={pr.scaricatoAmount}
                          prefix="€"
                          onCommit={(v) =>
                            onUpsertReconciliation(event.id, pid, { scaricato_amount: v })
                          }
                          ariaLabel={`Scaricato ${meta.display_name}`}
                          className="w-24"
                        />
                        {pr.mancanti > 0.01 && (
                          <button
                            type="button"
                            onClick={() => handleSettlePr(pid)}
                            title={`Segna tutto scaricato (${formatEur(pr.scaricoTotal + pr.noteAmount)})`}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] apple-press cursor-pointer"
                            style={{
                              backgroundColor: 'var(--status-green-bg)',
                              color: 'var(--status-green)',
                            }}
                            aria-label={`Salda scarico ${meta.display_name}`}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <MancantiBadge value={pr.mancanti} compact />
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right tabular-nums">
                      <div className="font-bold text-[15px]">{formatEur(pr.bustaTotal, true)}</div>
                      {pr.bustaBonusShare > 0 && (
                        <div className="text-[11px]" style={{ color: 'var(--status-green)' }}>
                          incl. +{formatEur(pr.bustaBonusShare, true)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Sezione Prevendite — Smart "Totale − Lollo → Ciccio" + Zero-Scroll Mobile Cards */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 px-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[18px] font-semibold">Prevendite</h2>
            {summary.promoterOrder.length === 2 && (
              <SegmentedControl<PresaleInputMode>
                ariaLabel="Modalità inserimento prevendite"
                size="sm"
                value={event.presale_input_mode}
                onChange={(m) => onUpdateEvent(event.id, { presale_input_mode: m })}
                options={[
                  { value: 'total_minus_primary', label: 'Totale − Lollo' },
                  { value: 'per_pr', label: 'Per PR' },
                ]}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
            Importa
          </button>
        </div>

        {isTotalMinusMode && (
          <p className="text-[12px] mb-2 px-1" style={{ color: 'var(--ink-secondary)' }}>
            Inserisci il <strong>Totale serata</strong> e i dati di{' '}
            <strong>{getPromoter(primaryPrId).display_name}</strong>: le prevendite di{' '}
            <strong>{getPromoter(secondaryPrId).display_name}</strong> si calcolano in automatico.
          </p>
        )}

        {/* Mobile Prevendite Stacked Cards (ZERO horizontal scroll!) */}
        <div className="md:hidden space-y-2.5">
          {isTotalMinusMode && (
            <div
              className="apple-surface rounded-[16px] p-3.5 space-y-2.5"
              style={{
                borderLeft: '3px solid var(--accent)',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold">Totale serata</span>
                {summary.revenuePresales > 0 &&
                  summary.oneToOnePresales !== summary.revenuePresales && (
                    <button
                      type="button"
                      onClick={() => handleTotalPresaleEdit('one_to_one', summary.revenuePresales)}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold apple-press cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}
                    >
                      1to1 = Incasso
                    </button>
                  )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    N° Preve
                  </span>
                  <NumericCellInput
                    value={summary.pxPresales}
                    integer
                    onCommit={(v) => handleTotalPresaleEdit('quantity', v)}
                    ariaLabel="Totale prevendite serata"
                  />
                </div>
                <div>
                  <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Incasso (€)
                  </span>
                  <NumericCellInput
                    value={summary.revenuePresales}
                    onCommit={(v) => handleTotalPresaleEdit('revenue', v)}
                    ariaLabel="Incasso totale prevendite"
                  />
                </div>
                <div>
                  <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    1-to-1 (€)
                  </span>
                  <NumericCellInput
                    value={summary.oneToOnePresales}
                    onCommit={(v) => handleTotalPresaleEdit('one_to_one', v)}
                    ariaLabel="Totale One to One prevendite"
                  />
                </div>
              </div>
            </div>
          )}

          {summary.promoterOrder.map((pid) => {
            const row = event.presales.find((p) => p.promoter_id === pid);
            const meta = getPromoter(pid);
            const qty = row?.quantity ?? 0;
            const rev = row?.revenue ?? 0;
            const oto = row?.one_to_one ?? 0;
            const isDerived = isTotalMinusMode && pid === secondaryPrId;

            return (
              <div
                key={pid}
                className="apple-surface rounded-[16px] p-3.5 space-y-2.5"
                style={{
                  opacity: isDerived ? 0.92 : 1,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="text-[14px] font-semibold">{meta.display_name}</span>
                    {isDerived && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: 'var(--bg-surface-secondary)',
                          color: 'var(--ink-secondary)',
                        }}
                      >
                        Auto = Totale − {getPromoter(primaryPrId).display_name}
                      </span>
                    )}
                  </div>
                  {!isDerived && rev > 0 && oto !== rev && (
                    <button
                      type="button"
                      onClick={() =>
                        isTotalMinusMode && pid === primaryPrId
                          ? handlePrimaryPresaleEditInTotalMode('one_to_one', rev)
                          : onUpsertPresale(event.id, pid, { one_to_one: rev })
                      }
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold apple-press cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}
                    >
                      1to1 = Incasso
                    </button>
                  )}
                </div>

                {isDerived ? (
                  <div
                    className="grid grid-cols-3 gap-2 rounded-[10px] p-2.5 text-center tabular-nums"
                    style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                  >
                    <div>
                      <span className="block text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                        N° Preve
                      </span>
                      <span className="text-[15px] font-bold">{formatInt(qty)}</span>
                    </div>
                    <div>
                      <span className="block text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                        Incasso
                      </span>
                      <span className="text-[15px] font-bold">{formatEur(rev)}</span>
                    </div>
                    <div>
                      <span className="block text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                        One to One
                      </span>
                      <span className="text-[15px] font-bold">{formatEur(oto)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        N° Preve
                      </span>
                      <NumericCellInput
                        value={qty}
                        integer
                        onCommit={(v) =>
                          isTotalMinusMode && pid === primaryPrId
                            ? handlePrimaryPresaleEditInTotalMode('quantity', v)
                            : onUpsertPresale(event.id, pid, { quantity: v })
                        }
                        ariaLabel={`Prevendite ${meta.display_name}`}
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        Incasso (€)
                      </span>
                      <NumericCellInput
                        value={rev}
                        onCommit={(v) =>
                          isTotalMinusMode && pid === primaryPrId
                            ? handlePrimaryPresaleEditInTotalMode('revenue', v)
                            : onUpsertPresale(event.id, pid, { revenue: v })
                        }
                        ariaLabel={`Incasso ${meta.display_name}`}
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        1-to-1 (€)
                      </span>
                      <NumericCellInput
                        value={oto}
                        onCommit={(v) =>
                          isTotalMinusMode && pid === primaryPrId
                            ? handlePrimaryPresaleEditInTotalMode('one_to_one', v)
                            : onUpsertPresale(event.id, pid, { one_to_one: v })
                        }
                        ariaLabel={`One to One ${meta.display_name}`}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {!isTotalMinusMode && (
            <div
              className="flex items-center justify-between rounded-[12px] px-4 py-2.5 text-[13px] font-semibold tabular-nums"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              <span>Totale</span>
              <span>
                {formatInt(summary.pxPresales)} preve · {formatEur(summary.revenuePresales)} · 1to1{' '}
                {formatEur(summary.oneToOnePresales)}
              </span>
            </div>
          )}
        </div>

        {/* Desktop Prevendite Table */}
        <div className="hidden md:block apple-surface rounded-[16px] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[480px]">
            <thead>
              <tr
                className="text-[12px] font-medium"
                style={{
                  color: 'var(--ink-secondary)',
                  borderBottom: '0.5px solid var(--separator)',
                }}
              >
                <th className="py-3 pl-4 pr-2 font-medium">Promoter</th>
                <th className="py-3 px-2 text-right font-medium w-[140px]">Totale prevendite</th>
                <th className="py-3 px-2 text-right font-medium w-[150px]">Incasso (€)</th>
                <th className="py-3 pl-2 pr-4 text-right font-medium w-[180px]">
                  Totale One to One (€)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)] text-[14px]">
              {isTotalMinusMode && (
                <tr style={{ backgroundColor: 'var(--bg-hover)' }}>
                  <td className="py-2.5 pl-4 pr-2 font-semibold">
                    Totale serata
                    <span
                      className="ml-2 text-[11px] font-normal"
                      style={{ color: 'var(--ink-tertiary)' }}
                    >
                      (calcola {getPromoter(secondaryPrId).display_name} in automatico)
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    <NumericCellInput
                      value={summary.pxPresales}
                      integer
                      onCommit={(v) => handleTotalPresaleEdit('quantity', v)}
                      ariaLabel="Totale prevendite serata"
                    />
                  </td>
                  <td className="py-2.5 px-2">
                    <NumericCellInput
                      value={summary.revenuePresales}
                      prefix="€"
                      onCommit={(v) => handleTotalPresaleEdit('revenue', v)}
                      ariaLabel="Incasso totale prevendite"
                    />
                  </td>
                  <td className="py-2.5 pl-2 pr-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <NumericCellInput
                        value={summary.oneToOnePresales}
                        prefix="€"
                        onCommit={(v) => handleTotalPresaleEdit('one_to_one', v)}
                        ariaLabel="Totale One to One prevendite"
                        className="flex-1"
                      />
                      {summary.revenuePresales > 0 &&
                        summary.oneToOnePresales !== summary.revenuePresales && (
                          <button
                            type="button"
                            onClick={() =>
                              handleTotalPresaleEdit('one_to_one', summary.revenuePresales)
                            }
                            title="Imposta One to One uguale all'Incasso"
                            className="shrink-0 rounded-[7px] px-2 py-1 text-[11px] font-semibold apple-press cursor-pointer"
                            style={{
                              backgroundColor: 'var(--accent-subtle)',
                              color: 'var(--accent)',
                            }}
                          >
                            = Inc.
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              )}

              {summary.promoterOrder.map((pid) => {
                const row = event.presales.find((p) => p.promoter_id === pid);
                const meta = getPromoter(pid);
                const qty = row?.quantity ?? 0;
                const rev = row?.revenue ?? 0;
                const oto = row?.one_to_one ?? 0;
                const isDerivedSecondary = isTotalMinusMode && pid === secondaryPrId;

                return (
                  <tr key={pid} className="hover:bg-[var(--bg-hover)] transition-colors">
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: meta.color }}
                        />
                        <span className="font-medium">{meta.full_name}</span>
                        {isDerivedSecondary && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{
                              backgroundColor: 'var(--bg-surface-secondary)',
                              color: 'var(--ink-secondary)',
                            }}
                          >
                            Auto
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      {isDerivedSecondary ? (
                        <div className="px-2.5 py-1.5 text-right font-semibold tabular-nums">
                          {formatInt(qty)}
                        </div>
                      ) : (
                        <NumericCellInput
                          value={qty}
                          integer
                          onCommit={(v) =>
                            isTotalMinusMode && pid === primaryPrId
                              ? handlePrimaryPresaleEditInTotalMode('quantity', v)
                              : onUpsertPresale(event.id, pid, { quantity: v })
                          }
                          ariaLabel={`Totale prevendite ${meta.display_name}`}
                        />
                      )}
                    </td>
                    <td className="py-2.5 px-2">
                      {isDerivedSecondary ? (
                        <div className="px-2.5 py-1.5 text-right font-semibold tabular-nums">
                          {formatEur(rev)}
                        </div>
                      ) : (
                        <NumericCellInput
                          value={rev}
                          prefix="€"
                          onCommit={(v) =>
                            isTotalMinusMode && pid === primaryPrId
                              ? handlePrimaryPresaleEditInTotalMode('revenue', v)
                              : onUpsertPresale(event.id, pid, { revenue: v })
                          }
                          ariaLabel={`Incasso prevendite ${meta.display_name}`}
                        />
                      )}
                    </td>
                    <td className="py-2.5 pl-2 pr-4">
                      {isDerivedSecondary ? (
                        <div className="px-2.5 py-1.5 text-right font-semibold tabular-nums">
                          {formatEur(oto)}
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <NumericCellInput
                            value={oto}
                            prefix="€"
                            onCommit={(v) =>
                              isTotalMinusMode && pid === primaryPrId
                                ? handlePrimaryPresaleEditInTotalMode('one_to_one', v)
                                : onUpsertPresale(event.id, pid, { one_to_one: v })
                            }
                            ariaLabel={`One to One ${meta.display_name}`}
                            className="flex-1"
                          />
                          {rev > 0 && oto !== rev && (
                            <button
                              type="button"
                              onClick={() =>
                                isTotalMinusMode && pid === primaryPrId
                                  ? handlePrimaryPresaleEditInTotalMode('one_to_one', rev)
                                  : onUpsertPresale(event.id, pid, { one_to_one: rev })
                              }
                              title="Imposta One to One uguale all'Incasso"
                              className="shrink-0 rounded-[7px] px-2 py-1 text-[11px] font-semibold apple-press cursor-pointer"
                              style={{
                                backgroundColor: 'var(--accent-subtle)',
                                color: 'var(--accent)',
                              }}
                            >
                              = Inc.
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!isTotalMinusMode && (
                <tr
                  className="font-semibold tabular-nums"
                  style={{ backgroundColor: 'var(--bg-hover)' }}
                >
                  <td className="py-2.5 pl-4 pr-2">Totale prevendite</td>
                  <td className="py-2.5 px-4 text-right">{formatInt(summary.pxPresales)}</td>
                  <td className="py-2.5 px-4 text-right">{formatEur(summary.revenuePresales)}</td>
                  <td className="py-2.5 pl-2 pr-6 text-right">
                    {formatEur(summary.oneToOnePresales)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Sezione Tavoli */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 px-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[18px] font-semibold">Tavoli</h2>
            <span
              className="rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums"
              style={{
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-secondary)',
              }}
            >
              {event.tables.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSurcharge((s) => !s)}
              className="hidden md:inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-medium apple-surface apple-press cursor-pointer"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {showSurcharge ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                  Nascondi sovraprezzo
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  Colonne sovraprezzo
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowModalExtras(false);
                setShowAddTableModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[13px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Aggiungi tavolo
            </button>
          </div>
        </div>

        {/* Desktop Interactive Table */}
        <div className="hidden md:block apple-surface rounded-[16px] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr
                className="text-[12px] font-medium"
                style={{
                  color: 'var(--ink-secondary)',
                  borderBottom: '0.5px solid var(--separator)',
                }}
              >
                <th className="py-3 pl-4 pr-2 font-medium w-[86px]">PR</th>
                <th className="py-3 px-2 font-medium min-w-[180px]">Nome tavolo</th>
                <th className="py-3 px-1.5 text-right font-medium w-[72px]">Paganti</th>
                <th className="py-3 px-1.5 text-right font-medium w-[80px]">Prezzo €</th>
                {showSurcharge && (
                  <>
                    <th className="py-3 px-1.5 text-right font-medium w-[70px]">Pag. 2</th>
                    <th className="py-3 px-1.5 text-right font-medium w-[84px]">Sovrapr. €</th>
                  </>
                )}
                <th className="py-3 px-1.5 text-right font-medium w-[92px]">Extra No €</th>
                <th className="py-3 px-1.5 text-right font-medium w-[92px]">Extra Sì €</th>
                <th className="py-3 px-2 text-right font-medium w-[86px]">Credito</th>
                <th className="py-3 px-2 text-center font-medium w-[108px]">Scarico</th>
                <th className="py-3 px-2 text-right font-medium w-[84px]">Da scar.</th>
                <th className="py-3 pr-3 w-[36px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)] text-[14px]">
              {event.tables.length === 0 ? (
                <tr>
                  <td
                    colSpan={showSurcharge ? 12 : 10}
                    className="py-10 text-center text-[14px]"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    Nessun tavolo registrato in questa serata. Aggiungine uno qui sotto.
                  </td>
                </tr>
              ) : (
                event.tables.map((t) => {
                  const tc = computeTable(t);
                  const meta = getPromoter(t.promoter_id);
                  return (
                    <tr key={t.id} className="group hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="py-2 pl-4 pr-2">
                        <button
                          type="button"
                          onClick={() => cycleTablePromoter(t)}
                          title="Clicca per cambiare PR"
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold apple-press cursor-pointer"
                          style={{
                            backgroundColor: `${meta.color}1A`,
                            color: meta.color,
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: meta.color }}
                          />
                          {meta.display_name}
                        </button>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          defaultValue={t.table_name}
                          key={`${t.id}-${t.table_name}`}
                          aria-label="Nome tavolo"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== t.table_name) {
                              onUpdateTable(event.id, t.id, { table_name: v || 'Tavolo' });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          className="apple-input w-full rounded-[8px] px-2.5 py-1.5 text-[14px] font-medium"
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={t.payers_count}
                          integer
                          onCommit={(v) => onUpdateTable(event.id, t.id, { payers_count: v })}
                          ariaLabel={`Paganti ${t.table_name}`}
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={t.price}
                          onCommit={(v) => onUpdateTable(event.id, t.id, { price: v })}
                          ariaLabel={`Prezzo ${t.table_name}`}
                        />
                      </td>
                      {showSurcharge && (
                        <>
                          <td className="py-2 px-1.5">
                            <NumericCellInput
                              value={t.surcharge_payers_count}
                              integer
                              onCommit={(v) =>
                                onUpdateTable(event.id, t.id, { surcharge_payers_count: v })
                              }
                              ariaLabel={`Paganti sovraprezzo ${t.table_name}`}
                            />
                          </td>
                          <td className="py-2 px-1.5">
                            <NumericCellInput
                              value={t.surcharge_price}
                              onCommit={(v) =>
                                onUpdateTable(event.id, t.id, { surcharge_price: v })
                              }
                              ariaLabel={`Sovraprezzo ${t.table_name}`}
                            />
                          </td>
                        </>
                      )}
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={t.extra_no_scarico}
                          onCommit={(v) => onUpdateTable(event.id, t.id, { extra_no_scarico: v })}
                          ariaLabel={`Extra no scarico ${t.table_name}`}
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={t.extra_si_scarico}
                          onCommit={(v) => onUpdateTable(event.id, t.id, { extra_si_scarico: v })}
                          ariaLabel={`Extra sì scarico ${t.table_name}`}
                        />
                      </td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">
                        {formatEur(tc.credito)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <ScaricoPill
                          status={t.scarico_status}
                          onClick={() =>
                            onUpdateTable(event.id, t.id, {
                              scarico_status: nextScarico(t.scarico_status),
                            })
                          }
                        />
                      </td>
                      <td
                        className="py-2 px-2 text-right font-medium tabular-nums whitespace-nowrap"
                        style={{
                          color:
                            t.scarico_status === 'DA SCARICARE'
                              ? 'var(--ink-primary)'
                              : 'var(--ink-tertiary)',
                        }}
                      >
                        {formatEur(tc.scaricoApplied)}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <button
                          type="button"
                          onClick={() => onDeleteTable(event.id, t.id)}
                          aria-label={`Rimuovi tavolo ${t.table_name}`}
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

              {/* Quick Inline Add Table Row (Desktop) */}
              <tr style={{ backgroundColor: 'var(--bg-hover)' }}>
                <td className="py-2.5 pl-4 pr-2">
                  <select
                    aria-label="PR nuovo tavolo"
                    value={newTablePr}
                    onChange={(e) => setNewTablePr(e.target.value)}
                    className="apple-input rounded-[8px] px-2 py-1.5 text-[12px] font-semibold w-full"
                  >
                    {selectablePrs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2.5 px-2">
                  <input
                    type="text"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleQuickAddTable(false);
                    }}
                    placeholder="Nuovo tavolo…"
                    aria-label="Nome nuovo tavolo"
                    className="apple-input w-full rounded-[8px] px-2.5 py-1.5 text-[14px]"
                  />
                </td>
                <td className="py-2.5 px-1.5">
                  <NumericCellInput
                    value={newTablePayers}
                    integer
                    onCommit={setNewTablePayers}
                    ariaLabel="Paganti nuovo tavolo"
                  />
                </td>
                <td className="py-2.5 px-1.5">
                  <NumericCellInput
                    value={newTablePrice}
                    onCommit={setNewTablePrice}
                    ariaLabel="Prezzo nuovo tavolo"
                  />
                </td>
                {showSurcharge && (
                  <>
                    <td
                      className="py-2.5 px-1.5 text-center text-[12px]"
                      style={{ color: 'var(--ink-tertiary)' }}
                    >
                      —
                    </td>
                    <td
                      className="py-2.5 px-1.5 text-center text-[12px]"
                      style={{ color: 'var(--ink-tertiary)' }}
                    >
                      —
                    </td>
                  </>
                )}
                <td className="py-2.5 px-1.5">
                  <NumericCellInput
                    value={newTableExtraNo}
                    onCommit={setNewTableExtraNo}
                    ariaLabel="Extra no scarico nuovo tavolo"
                  />
                </td>
                <td className="py-2.5 px-1.5">
                  <NumericCellInput
                    value={newTableExtraSi}
                    onCommit={setNewTableExtraSi}
                    ariaLabel="Extra sì scarico nuovo tavolo"
                  />
                </td>
                <td
                  className="py-2.5 px-2 text-right font-semibold tabular-nums text-[13px] whitespace-nowrap"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {formatEur(
                    newTablePayers * newTablePrice + newTableExtraNo + newTableExtraSi
                  )}
                </td>
                <td className="py-2.5 px-2 text-center">
                  <ScaricoPill
                    status={newTableScarico}
                    onClick={() => setNewTableScarico(nextScarico(newTableScarico))}
                  />
                </td>
                <td colSpan={2} className="py-2.5 pr-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleQuickAddTable(false)}
                    className="inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold text-white apple-press cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Aggiungi
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile Smart Cards for Tavoli (Stepper + 1-tap PR + 1-tap Scarico + expandable Extra) */}
        <div className="md:hidden space-y-2.5">
          {event.tables.length === 0 ? (
            <div className="apple-surface rounded-[16px] p-6 text-center">
              <p className="text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
                Nessun tavolo registrato in questa serata.
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowModalExtras(false);
                  setShowAddTableModal(true);
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2.5 text-[14px] font-semibold text-white apple-press cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Aggiungi primo tavolo
              </button>
            </div>
          ) : (
            event.tables.map((t) => {
              const tc = computeTable(t);
              const meta = getPromoter(t.promoter_id);
              const hasExtras =
                t.extra_no_scarico > 0 ||
                t.extra_si_scarico > 0 ||
                t.surcharge_payers_count > 0 ||
                t.surcharge_price > 0;
              const isExpanded = Boolean(expandedMobileTables[t.id]);

              return (
                <div key={t.id} className="apple-surface rounded-[16px] p-3.5 space-y-3">
                  {/* Card Header: PR + Name + Credito + Delete */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => cycleTablePromoter(t)}
                        className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold apple-press cursor-pointer"
                        style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                      >
                        {meta.display_name}
                      </button>
                      <input
                        type="text"
                        defaultValue={t.table_name}
                        key={`${t.id}-${t.table_name}-m`}
                        aria-label="Nome tavolo"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== t.table_name) {
                            onUpdateTable(event.id, t.id, { table_name: v || 'Tavolo' });
                          }
                        }}
                        className="font-semibold text-[16px] bg-transparent rounded-[6px] px-1 -mx-1 min-w-0 flex-1 truncate"
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[16px] font-bold tabular-nums">
                        {formatEur(tc.credito)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteTable(event.id, t.id)}
                        aria-label={`Rimuovi ${t.table_name}`}
                        className="p-2 rounded-full apple-press cursor-pointer"
                        style={{ color: 'var(--status-red)' }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Primary Fast Row: Stepper Paganti + Prezzo € + Scarico Pill */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AppleStepper
                        size="sm"
                        value={t.payers_count}
                        label={`Paganti ${t.table_name}`}
                        onChange={(next) =>
                          onUpdateTable(event.id, t.id, { payers_count: next })
                        }
                      />
                      <span className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                        ×
                      </span>
                      <div className="w-[74px]">
                        <NumericCellInput
                          value={t.price}
                          prefix="€"
                          onCommit={(v) => onUpdateTable(event.id, t.id, { price: v })}
                          ariaLabel={`Prezzo ${t.table_name}`}
                        />
                      </div>
                    </div>

                    <ScaricoPill
                      status={t.scarico_status}
                      onClick={() =>
                        onUpdateTable(event.id, t.id, {
                          scarico_status: nextScarico(t.scarico_status),
                        })
                      }
                    />
                  </div>

                  {/* Footer / Expandable Extras */}
                  <div
                    className="flex items-center justify-between pt-2"
                    style={{ borderTop: '0.5px solid var(--separator)' }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMobileTables((prev) => ({ ...prev, [t.id]: !prev[t.id] }))
                      }
                      className="inline-flex items-center gap-1 text-[12px] font-medium cursor-pointer"
                      style={{ color: hasExtras ? 'var(--accent)' : 'var(--ink-tertiary)' }}
                    >
                      {isExpanded
                        ? 'Chiudi extra'
                        : hasExtras
                          ? `Extra: ${formatEur(
                              t.extra_no_scarico +
                                t.extra_si_scarico +
                                t.surcharge_payers_count * t.surcharge_price
                            )}`
                          : 'Extra / Sovraprezzo'}
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <span className="text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                      Da scaricare: <strong>{formatEur(tc.scaricoApplied)}</strong>
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div>
                        <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                          Extra No scar. (€)
                        </span>
                        <NumericCellInput
                          value={t.extra_no_scarico}
                          prefix="€"
                          onCommit={(v) => onUpdateTable(event.id, t.id, { extra_no_scarico: v })}
                          ariaLabel="Extra no scarico"
                        />
                      </div>
                      <div>
                        <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                          Extra Sì scar. (€)
                        </span>
                        <NumericCellInput
                          value={t.extra_si_scarico}
                          prefix="€"
                          onCommit={(v) => onUpdateTable(event.id, t.id, { extra_si_scarico: v })}
                          ariaLabel="Extra sì scarico"
                        />
                      </div>
                      <div>
                        <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                          Paganti 2 (sovrapr.)
                        </span>
                        <NumericCellInput
                          value={t.surcharge_payers_count}
                          integer
                          onCommit={(v) =>
                            onUpdateTable(event.id, t.id, { surcharge_payers_count: v })
                          }
                          ariaLabel="Paganti sovraprezzo"
                        />
                      </div>
                      <div>
                        <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                          Sovraprezzo (€)
                        </span>
                        <NumericCellInput
                          value={t.surcharge_price}
                          prefix="€"
                          onCommit={(v) => onUpdateTable(event.id, t.id, { surcharge_price: v })}
                          ariaLabel="Sovraprezzo"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Mobile Floating Thumb-Friendly "+ Tavolo" Button */}
      <button
        type="button"
        onClick={() => {
          setShowModalExtras(false);
          setShowAddTableModal(true);
        }}
        className="md:hidden fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-[14px] font-semibold text-white apple-press cursor-pointer"
        style={{
          backgroundColor: 'var(--accent)',
          boxShadow: '0 8px 24px rgba(0, 113, 227, 0.38)',
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Tavolo
      </button>

      {/* Add Table Modal / Mobile Bottom Sheet */}
      <AppleModal
        open={showAddTableModal}
        onClose={() => setShowAddTableModal(false)}
        title="Nuovo tavolo"
        subtitle={`${event.venue_name} · ${event.title}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleQuickAddTable(false);
          }}
          className="space-y-4"
        >
          <div>
            <span
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Promoter
            </span>
            <SegmentedControl
              ariaLabel="Seleziona promoter"
              value={newTablePr}
              onChange={setNewTablePr}
              className="w-full"
              options={selectablePrs.map((p) => ({ value: p.id, label: p.display_name }))}
            />
          </div>

          <div>
            <label
              htmlFor="add-tbl-name"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nome tavolo
            </label>
            <input
              ref={modalTableNameRef}
              id="add-tbl-name"
              type="text"
              required
              autoComplete="off"
              placeholder="Es. Savage, Privè, Compleanno…"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              className="apple-input w-full rounded-[10px] px-3 py-2.5 text-[16px] md:text-[15px]"
            />
          </div>

          {/* Fast Paganti Section: Stepper + Quick Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                N° paganti
              </span>
              <div className="flex items-center gap-2">
                <AppleStepper
                  value={newTablePayers}
                  onChange={setNewTablePayers}
                  label="Numero paganti"
                />
                <NumericCellInput
                  value={newTablePayers}
                  integer
                  onCommit={setNewTablePayers}
                  ariaLabel="Inserisci numero paganti"
                  className="w-16"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PAYERS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNewTablePayers(n)}
                  className="rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums apple-press cursor-pointer"
                  style={{
                    backgroundColor:
                      newTablePayers === n ? 'var(--accent)' : 'var(--bg-surface-secondary)',
                    color: newTablePayers === n ? '#FFFFFF' : 'var(--ink-primary)',
                  }}
                >
                  {n} px
                </button>
              ))}
            </div>
          </div>

          {/* Fast Prezzo Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Prezzo a persona
              </span>
              <NumericCellInput
                value={newTablePrice}
                prefix="€"
                onCommit={setNewTablePrice}
                ariaLabel="Prezzo a persona"
                className="w-28"
              />
            </div>
            {settings.quick_table_prices.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {settings.quick_table_prices.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setNewTablePrice(p)}
                    className="rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums apple-press cursor-pointer"
                    style={{
                      backgroundColor:
                        newTablePrice === p ? 'var(--accent)' : 'var(--bg-surface-secondary)',
                      color: newTablePrice === p ? '#FFFFFF' : 'var(--ink-primary)',
                    }}
                  >
                    {p} €
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Scarico Status */}
          <div>
            <span
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Stato scarico
            </span>
            <SegmentedControl<ScaricoStatus>
              ariaLabel="Stato scarico tavolo"
              value={newTableScarico}
              onChange={setNewTableScarico}
              className="w-full"
              options={[
                { value: 'DA SCARICARE', label: 'Da scaricare' },
                { value: 'DA NON SCARICARE', label: 'No scarico' },
                { value: '-', label: '—' },
              ]}
            />
          </div>

          {/* Collapsible Extra & Sovraprezzo */}
          <div>
            <button
              type="button"
              onClick={() => setShowModalExtras((v) => !v)}
              className="inline-flex items-center gap-1 text-[13px] font-medium cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              {showModalExtras ? 'Nascondi extra e sovraprezzo' : '+ Aggiungi extra o sovraprezzo'}
              {showModalExtras ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
            {showModalExtras && (
              <div className="mt-2.5 grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Extra No scar. (€)
                  </span>
                  <NumericCellInput
                    value={newTableExtraNo}
                    prefix="€"
                    onCommit={setNewTableExtraNo}
                    ariaLabel="Extra no scarico"
                  />
                </div>
                <div>
                  <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Extra Sì scar. (€)
                  </span>
                  <NumericCellInput
                    value={newTableExtraSi}
                    prefix="€"
                    onCommit={setNewTableExtraSi}
                    ariaLabel="Extra sì scarico"
                  />
                </div>
                <div>
                  <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Paganti 2
                  </span>
                  <NumericCellInput
                    value={newTableSurchargePayers}
                    integer
                    onCommit={setNewTableSurchargePayers}
                    ariaLabel="Paganti sovraprezzo"
                  />
                </div>
                <div>
                  <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                    Sovraprezzo (€)
                  </span>
                  <NumericCellInput
                    value={newTableSurchargePrice}
                    prefix="€"
                    onCommit={setNewTableSurchargePrice}
                    ariaLabel="Sovraprezzo"
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
                  newTablePayers * newTablePrice +
                    newTableSurchargePayers * newTableSurchargePrice +
                    newTableExtraNo +
                    newTableExtraSi
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleQuickAddTable(true)}
                className="rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold apple-press cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-surface-secondary)',
                  color: 'var(--ink-primary)',
                }}
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

      {/* Edit Event Metadata Modal */}
      <AppleModal
        open={showEditMeta}
        onClose={() => setShowEditMeta(false)}
        title="Modifica dettagli serata"
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="edit-ev-title"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nome serata
            </label>
            <input
              id="edit-ev-title"
              type="text"
              defaultValue={event.title}
              key={`${event.id}-title`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== event.title) onUpdateEvent(event.id, { title: v });
              }}
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-ev-venue"
                className="block text-[13px] font-medium mb-1.5"
                style={{ color: 'var(--ink-secondary)' }}
              >
                Locale
              </label>
              <select
                id="edit-ev-venue"
                value={event.venue_name}
                onChange={(e) => {
                  const v = venues.find((x) => x.name === e.target.value);
                  onUpdateEvent(event.id, {
                    venue_id: v?.id ?? null,
                    venue_name: e.target.value,
                  });
                }}
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px]"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="edit-ev-date"
                className="block text-[13px] font-medium mb-1.5"
                style={{ color: 'var(--ink-secondary)' }}
              >
                Data
              </label>
              <input
                id="edit-ev-date"
                type="date"
                value={event.event_date}
                onChange={(e) => onUpdateEvent(event.id, { event_date: e.target.value })}
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px] tabular-nums"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-ev-note-txt"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Appunti serata (opzionale)
            </label>
            <textarea
              id="edit-ev-note-txt"
              rows={3}
              defaultValue={event.general_note_text}
              key={`${event.id}-note`}
              placeholder="Note interne, accordi con la direzione, pagamenti extra…"
              onBlur={(e) => {
                if (e.target.value !== event.general_note_text) {
                  onUpdateEvent(event.id, { general_note_text: e.target.value });
                }
              }}
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[14px]"
            />
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={() => {
                setShowEditMeta(false);
                onDuplicateEvent(event);
              }}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-medium apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Duplica serata
            </button>
            <button
              type="button"
              onClick={() => setShowEditMeta(false)}
              className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Fine
            </button>
          </div>
        </div>
      </AppleModal>

      {/* Import Prevendite Modal */}
      <AppleModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        title="Importa report prevendite"
        subtitle="Incolla righe da TicketSMS, Excel o Google Sheets (con colonne Promoter, Quantità, Incasso, One to One)."
        maxWidth="max-w-[560px]"
      >
        <div className="space-y-4">
          <textarea
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Es.&#10;Lorenzo Biondi	73	1354,50	1295,00&#10;Francesco Troiano	68	1120,00	1120,00"
            className="apple-input w-full rounded-[12px] p-3 text-[14px] font-mono"
          />

          {handleImportPreview.length > 0 && (
            <div
              className="rounded-[12px] p-3.5 space-y-2"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                Anteprima rilevata
              </div>
              {handleImportPreview.map((r) => (
                <div
                  key={r.promoterId}
                  className="flex items-center justify-between text-[13px] tabular-nums"
                >
                  <span className="font-semibold">{getPromoter(r.promoterId).full_name}</span>
                  <span>
                    {r.quantity} preve · Incasso {formatEur(r.revenue)} · 1to1{' '}
                    {formatEur(r.one_to_one)}
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
              disabled={handleImportPreview.length === 0}
              onClick={handleApplyImport}
              className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer disabled:opacity-45"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Applica prevendite
            </button>
          </div>
        </div>
      </AppleModal>

      {/* Delete Confirmation Modal */}
      <AppleModal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Eliminare questa serata?"
        subtitle={`Verranno rimossi tutti i tavoli e le prevendite di “${event.title}”. Potrai comunque annullare con il tasto Annulla.`}
        maxWidth="max-w-[400px]"
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(false)}
            className="rounded-[10px] px-4 py-2 text-[14px] font-medium apple-press cursor-pointer"
            style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={async () => {
              setShowDeleteConfirm(false);
              await onDeleteEvent(event.id);
            }}
            className="rounded-[10px] px-4 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer"
            style={{ backgroundColor: '#FF3B30' }}
          >
            Elimina serata
          </button>
        </div>
      </AppleModal>
    </div>
  );
}
