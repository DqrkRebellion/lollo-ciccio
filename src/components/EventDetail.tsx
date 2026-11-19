import React, { useMemo, useState } from 'react';
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
  Share2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  APPLE_SPRING_SNAPPY,
  AppleModal,
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
      className="rounded-full px-2.5 py-1 text-[11px] font-semibold apple-press cursor-pointer whitespace-nowrap transition-colors"
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
  onBackMobile,
  onUpdateEvent,
  onDuplicateEvent,
  onDeleteEvent,
  onUpsertPresale,
  onUpsertReconciliation,
  onAddTable,
  onUpdateTable,
  onDeleteTable,
}: {
  event: FullEvent;
  summary: EventSummary;
  settings: AppSettings;
  promoters: Promoter[];
  venues: Venue[];
  onBackMobile?: () => void;
  onUpdateEvent: (id: string, patch: Partial<EventRecord>) => Promise<void>;
  onDuplicateEvent: (ev: FullEvent) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onUpsertPresale: (
    eventId: string,
    promoterId: string,
    patch: Partial<Pick<EventPresale, 'quantity' | 'revenue' | 'one_to_one'>>
  ) => Promise<void>;
  onUpsertReconciliation: (
    eventId: string,
    promoterId: string,
    patch: Partial<
      Pick<EventPrReconciliation, 'lista_pr_count' | 'note_amount' | 'note_text' | 'scaricato_amount'>
    >
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Import prevendite state
  const [importText, setImportText] = useState('');

  // Quick-add table form state (used both inline desktop and sheet mobile)
  const defaultVenueObj = venues.find((v) => v.id === event.venue_id || v.name === event.venue_name);
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
  const [newTableExtraNo, setNewTableExtraNo] = useState<number>(0);
  const [newTableExtraSi, setNewTableExtraSi] = useState<number>(0);
  const [newTableScarico, setNewTableScarico] = useState<ScaricoStatus>(
    settings.default_table_scarico
  );

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

  const handleQuickAddTable = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTableName.trim() && newTablePayers === 0 && newTableExtraNo === 0 && newTableExtraSi === 0) {
      return;
    }
    await onAddTable(event.id, {
      promoter_id: newTablePr,
      table_name: newTableName.trim() || 'Nuovo tavolo',
      payers_count: newTablePayers,
      price: newTablePrice,
      surcharge_payers_count: 0,
      surcharge_price: 0,
      extra_no_scarico: newTableExtraNo,
      extra_si_scarico: newTableExtraSi,
      scarico_status: newTableScarico,
    });
    setNewTableName('');
    setNewTablePayers(0);
    setNewTableExtraNo(0);
    setNewTableExtraSi(0);
    setShowAddTableModal(false);
    toast.success('Tavolo aggiunto');
  };

  const handleImportPreview = useMemo(
    () => parsePresaleReport(importText, promoters),
    [importText, promoters]
  );

  const handleApplyImport = async () => {
    if (handleImportPreview.length === 0) return;
    await Promise.all(
      handleImportPreview.map((row) =>
        onUpsertPresale(event.id, row.promoterId, {
          quantity: row.quantity,
          revenue: row.revenue,
          one_to_one: row.one_to_one,
        })
      )
    );
    setImportText('');
    setShowImportModal(false);
    toast.success('Report prevendite importato');
  };

  // Presales input mode: "Totale − Lollo = Ciccio" mirrors the original Google Sheet
  const primaryPrId = summary.promoterOrder[0] || 'lollo';
  const secondaryPrId = summary.promoterOrder[1] || 'ciccio';
  const isTotalMinusMode =
    event.presale_input_mode === 'total_minus_primary' && summary.promoterOrder.length === 2;

  const handleTotalPresaleEdit = (
    field: 'quantity' | 'revenue' | 'one_to_one',
    newTotal: number
  ) => {
    const primaryRow = event.presales.find((p) => p.promoter_id === primaryPrId);
    const primaryVal = primaryRow ? Number(primaryRow[field]) || 0 : 0;
    const secondaryNext = Math.max(0, Math.round((newTotal - primaryVal) * 100) / 100);
    onUpsertPresale(event.id, secondaryPrId, { [field]: secondaryNext });
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
    const secondaryNext = Math.max(0, Math.round((currentTotal - newPrimaryVal) * 100) / 100);
    onUpsertPresale(event.id, primaryPrId, { [field]: newPrimaryVal });
    onUpsertPresale(event.id, secondaryPrId, { [field]: secondaryNext });
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
    const targetScaricato = Math.max(0, Math.round((pr.scaricoTotal + pr.noteAmount) * 100) / 100);
    onUpsertReconciliation(event.id, promoterId, { scaricato_amount: targetScaricato });
    toast.success(`Scarico ${getPromoter(promoterId).display_name} saldato`);
  };

  const handleSettleAll = () => {
    for (const pid of summary.promoterOrder) {
      const pr = summary.byPromoter[pid];
      if (!pr || Math.abs(pr.mancanti) < 0.01) continue;
      const targetScaricato = Math.max(
        0,
        Math.round((pr.scaricoTotal + pr.noteAmount) * 100) / 100
      );
      onUpsertReconciliation(event.id, pid, { scaricato_amount: targetScaricato });
    }
    toast.success('Scarichi serata saldati');
  };

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 sm:px-6 lg:px-8 pt-4 pb-28 lg:pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
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
              Storico 3 PR
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowEditMeta(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Modifica dati</span>
          </button>
          <button
            type="button"
            onClick={handleCopyWhatsApp}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
            title="Copia riepilogo WhatsApp"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">WhatsApp</span>
          </button>
          <button
            type="button"
            onClick={() => onDuplicateEvent(event)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium apple-surface apple-press cursor-pointer"
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
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-[26px] sm:text-[32px] font-bold tracking-tight truncate">
            {event.title}
          </h1>
          <p className="mt-0.5 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            {formatDateFull(event.event_date)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl<EventMode>
            ariaLabel="Modalità serata"
            size="sm"
            value={event.mode}
            onChange={(m) => onUpdateEvent(event.id, { mode: m })}
            options={[
              { value: 'NO OSPITE', label: `No ospite (${formatPercent(rules.table_rate_no_guest)})` },
              { value: 'OSPITE', label: `Ospite (${formatPercent(rules.table_rate_guest)})` },
              { value: '-', label: 'Off' },
            ]}
          />

          <label
            className="inline-flex items-center gap-2.5 rounded-[12px] px-3 py-1.5 apple-surface cursor-pointer select-none"
          >
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

      {/* 1. Unified Financial Overview Strip (Apple Wallet / Stocks craft) */}
      <section className="apple-surface rounded-[18px] overflow-hidden mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-[var(--separator)]">
          {/* PX Totali */}
          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Ingressi totali
            </span>
            <div className="mt-1 text-[28px] font-bold tracking-tight tabular-nums leading-none">
              {formatInt(summary.pxTotal)}
              <span className="ml-1 text-[14px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>
                px
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span>Preve {formatInt(summary.pxPresales)}</span>
              <span>·</span>
              <span>Tavoli {formatInt(summary.pxTables)}</span>
            </div>
          </div>

          {/* Fatturato Totale */}
          <div className="p-4 sm:p-5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Fatturato totale
            </span>
            <div className="mt-1 text-[28px] font-bold tracking-tight tabular-nums leading-none">
              {formatEur(summary.revenueTotal)}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              <span>Preve {formatEur(summary.revenuePresales)}</span>
              <span>·</span>
              <span>Tavoli {formatEur(summary.revenueTables)}</span>
            </div>
          </div>

          {/* Busta Totale */}
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Busta serata
              </span>
              <button
                type="button"
                onClick={() => setShowFormula((s) => !s)}
                className="inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                style={{ color: 'var(--accent)' }}
              >
                <Info className="h-3 w-3" aria-hidden="true" />
                Dettaglio
              </button>
            </div>
            <div
              className="mt-1 text-[28px] font-bold tracking-tight tabular-nums leading-none"
              style={{ color: event.is_busta_paid ? 'var(--status-green)' : 'var(--ink-primary)' }}
            >
              {formatEur(summary.bustaTotal, true)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {summary.bonusAmount > 0 ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
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
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Cassa · Mancanti
              </span>
              {summary.mancantiTotal > 0.01 && (
                <button
                  type="button"
                  onClick={handleSettleAll}
                  className="text-[11px] font-semibold cursor-pointer apple-press"
                  style={{ color: 'var(--accent)' }}
                >
                  Salda tutto
                </button>
              )}
            </div>
            <div className="mt-1.5">
              <MancantiBadge value={summary.mancantiTotal} />
            </div>
            <div className="mt-2 text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              Scarico {formatEur(summary.scaricoTotal)} · Versati {formatEur(summary.scaricatoTotal)}
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
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] mb-2">
              <span className="font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Scaglioni bonus fatturato
              </span>
              <span className="tabular-nums font-medium">
                {summary.nextBonusTier ? (
                  <>
                    Mancano{' '}
                    <strong style={{ color: 'var(--accent)' }}>
                      {formatEur(summary.amountToNextBonus)}
                    </strong>{' '}
                    per bonus {formatEur(summary.nextBonusTier.bonus)} (soglia{' '}
                    {formatEur(summary.nextBonusTier.threshold)})
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
                  backgroundColor:
                    summary.bonusAmount > 0 ? '#34C759' : 'var(--accent)',
                }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums" style={{ color: 'var(--ink-tertiary)' }}>
              <span>€ 0</span>
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
                    <span className="ml-1.5 text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                      (ripartito{' '}
                      {rules.bonus_split_mode === 'equal'
                        ? '50/50'
                        : rules.bonus_split_mode === 'px_proportional'
                          ? 'in base ai PX'
                          : 'in proporzione al fatturato'}
                      )
                    </span>
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
                      className="text-[12px] font-medium cursor-pointer"
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

      {/* 2. Riepilogo per PR (Mirrors G1:I8 — PX, Lista PR, Scarico, Note, Scaricato, Mancanti, Busta) */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5 px-1">
          <h2 className="text-[18px] font-semibold">Riepilogo PR &amp; Cassa</h2>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              <span>Costo lista</span>
              <NumericCellInput
                value={event.lista_cost}
                onCommit={(v) => onUpdateEvent(event.id, { lista_cost: v })}
                prefix="€"
                ariaLabel="Costo lista PR"
                className="w-20"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
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
        </div>

        <div className="apple-surface rounded-[16px] overflow-x-auto">
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
                          <div className="text-[11px] tabular-nums" style={{ color: 'var(--ink-tertiary)' }}>
                            {formatEur(pr.revenueTotal)} fatt.
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right font-semibold tabular-nums">
                      {formatInt(pr.pxTotal)}
                      <div className="text-[11px] font-normal" style={{ color: 'var(--ink-tertiary)' }}>
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

      {/* 3. Sezione Prevendite */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 px-1">
          <div className="flex items-center gap-3">
            <h2 className="text-[18px] font-semibold">Prevendite</h2>
            {summary.promoterOrder.length === 2 && (
              <SegmentedControl<PresaleInputMode>
                ariaLabel="Modalità inserimento prevendite"
                size="sm"
                value={event.presale_input_mode}
                onChange={(m) => onUpdateEvent(event.id, { presale_input_mode: m })}
                options={[
                  { value: 'per_pr', label: 'Per PR' },
                  { value: 'total_minus_primary', label: 'Totale − Lollo' },
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
            Importa report
          </button>
        </div>

        <div className="apple-surface rounded-[16px] overflow-x-auto">
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
                <th className="py-3 pl-2 pr-4 text-right font-medium w-[160px]">
                  Totale One to One (€)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)] text-[14px]">
              {/* Optional editable TOTALE row at top when in Totale - Lollo mode */}
              {isTotalMinusMode && (
                <tr style={{ backgroundColor: 'var(--bg-hover)' }}>
                  <td className="py-2.5 pl-4 pr-2 font-semibold">
                    Totale serata
                    <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--ink-tertiary)' }}>
                      (auto-calcola {getPromoter(secondaryPrId).display_name})
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
                    <NumericCellInput
                      value={summary.oneToOnePresales}
                      prefix="€"
                      onCommit={(v) => handleTotalPresaleEdit('one_to_one', v)}
                      ariaLabel="Totale One to One prevendite"
                    />
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
                          <span className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
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
                        <NumericCellInput
                          value={oto}
                          prefix="€"
                          onCommit={(v) =>
                            isTotalMinusMode && pid === primaryPrId
                              ? handlePrimaryPresaleEditInTotalMode('one_to_one', v)
                              : onUpsertPresale(event.id, pid, { one_to_one: v })
                          }
                          ariaLabel={`One to One ${meta.display_name}`}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Summary Footer Row when in normal per_pr mode */}
              {!isTotalMinusMode && (
                <tr
                  className="font-semibold tabular-nums"
                  style={{ backgroundColor: 'var(--bg-hover)' }}
                >
                  <td className="py-2.5 pl-4 pr-2">Totale prevendite</td>
                  <td className="py-2.5 px-4 text-right">{formatInt(summary.pxPresales)}</td>
                  <td className="py-2.5 px-4 text-right">{formatEur(summary.revenuePresales)}</td>
                  <td className="py-2.5 pl-2 pr-6 text-right">{formatEur(summary.oneToOnePresales)}</td>
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
              onClick={() => setShowAddTableModal(true)}
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
          <table className="w-full text-left border-collapse">
            <thead>
              <tr
                className="text-[12px] font-medium"
                style={{
                  color: 'var(--ink-secondary)',
                  borderBottom: '0.5px solid var(--separator)',
                }}
              >
                <th className="py-3 pl-4 pr-2 font-medium w-[90px]">PR</th>
                <th className="py-3 px-2 font-medium min-w-[155px]">Nome tavolo</th>
                <th className="py-3 px-1.5 text-right font-medium w-[74px]">Paganti</th>
                <th className="py-3 px-1.5 text-right font-medium w-[86px]">Prezzo</th>
                {showSurcharge && (
                  <>
                    <th className="py-3 px-1.5 text-right font-medium w-[74px]">Pag. 2</th>
                    <th className="py-3 px-1.5 text-right font-medium w-[86px]">Sovrapr.</th>
                  </>
                )}
                <th className="py-3 px-1.5 text-right font-medium w-[92px]">Extra No sc.</th>
                <th className="py-3 px-1.5 text-right font-medium w-[92px]">Extra Sì sc.</th>
                <th className="py-3 px-2 text-right font-medium w-[88px]">Credito</th>
                <th className="py-3 px-2 text-center font-medium w-[112px]">Scarico</th>
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
                          prefix="€"
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
                              prefix="€"
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
                          prefix="€"
                          onCommit={(v) => onUpdateTable(event.id, t.id, { extra_no_scarico: v })}
                          ariaLabel={`Extra no scarico ${t.table_name}`}
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <NumericCellInput
                          value={t.extra_si_scarico}
                          prefix="€"
                          onCommit={(v) => onUpdateTable(event.id, t.id, { extra_si_scarico: v })}
                          ariaLabel={`Extra sì scarico ${t.table_name}`}
                        />
                      </td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums">
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
                        className="py-2 px-2 text-right font-medium tabular-nums"
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
                          className="p-1.5 rounded-[8px] opacity-40 group-hover:opacity-100 hover:bg-[var(--status-red-bg)] transition-all cursor-pointer"
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
                      if (e.key === 'Enter') handleQuickAddTable();
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
                    prefix="€"
                    onCommit={setNewTablePrice}
                    ariaLabel="Prezzo nuovo tavolo"
                  />
                </td>
                {showSurcharge && (
                  <>
                    <td className="py-2.5 px-1.5 text-center text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                      —
                    </td>
                    <td className="py-2.5 px-1.5 text-center text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                      —
                    </td>
                  </>
                )}
                <td className="py-2.5 px-1.5">
                  <NumericCellInput
                    value={newTableExtraNo}
                    prefix="€"
                    onCommit={setNewTableExtraNo}
                    ariaLabel="Extra no scarico nuovo tavolo"
                  />
                </td>
                <td className="py-2.5 px-1.5">
                  <NumericCellInput
                    value={newTableExtraSi}
                    prefix="€"
                    onCommit={setNewTableExtraSi}
                    ariaLabel="Extra sì scarico nuovo tavolo"
                  />
                </td>
                <td className="py-2.5 px-2 text-right font-semibold tabular-nums text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
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
                    onClick={() => handleQuickAddTable()}
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

        {/* Mobile Cards for Tavoli */}
        <div className="md:hidden space-y-2.5">
          {event.tables.length === 0 ? (
            <div className="apple-surface rounded-[16px] p-6 text-center">
              <p className="text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
                Nessun tavolo registrato in questa serata.
              </p>
              <button
                type="button"
                onClick={() => setShowAddTableModal(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer"
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
              return (
                <div key={t.id} className="apple-surface rounded-[16px] p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => cycleTablePromoter(t)}
                        className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold apple-press cursor-pointer"
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
                        className="font-semibold text-[15px] bg-transparent outline-none min-w-0 flex-1 truncate"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[15px] font-bold tabular-nums">
                        {formatEur(tc.credito)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteTable(event.id, t.id)}
                        aria-label={`Rimuovi ${t.table_name}`}
                        className="p-1.5 rounded-full"
                        style={{ color: 'var(--status-red)' }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        Paganti
                      </span>
                      <NumericCellInput
                        value={t.payers_count}
                        integer
                        onCommit={(v) => onUpdateTable(event.id, t.id, { payers_count: v })}
                        ariaLabel="Paganti"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        Prezzo
                      </span>
                      <NumericCellInput
                        value={t.price}
                        prefix="€"
                        onCommit={(v) => onUpdateTable(event.id, t.id, { price: v })}
                        ariaLabel="Prezzo"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] mb-1" style={{ color: 'var(--ink-secondary)' }}>
                        Ex. No sc.
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
                        Ex. Sì sc.
                      </span>
                      <NumericCellInput
                        value={t.extra_si_scarico}
                        prefix="€"
                        onCommit={(v) => onUpdateTable(event.id, t.id, { extra_si_scarico: v })}
                        ariaLabel="Extra sì scarico"
                      />
                    </div>
                  </div>

                  <div
                    className="flex items-center justify-between pt-2"
                    style={{ borderTop: '0.5px solid var(--separator)' }}
                  >
                    <ScaricoPill
                      status={t.scarico_status}
                      onClick={() =>
                        onUpdateTable(event.id, t.id, {
                          scarico_status: nextScarico(t.scarico_status),
                        })
                      }
                    />
                    <span className="text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                      Da scaricare: <strong>{formatEur(tc.scaricoApplied)}</strong>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Add Table Modal / Mobile Bottom Sheet */}
      <AppleModal
        open={showAddTableModal}
        onClose={() => setShowAddTableModal(false)}
        title="Nuovo tavolo"
        subtitle={`${event.venue_name} · ${event.title}`}
      >
        <form onSubmit={handleQuickAddTable} className="space-y-4">
          <div>
            <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
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
              id="add-tbl-name"
              type="text"
              required
              autoComplete="off"
              placeholder="Es. Savage, Privè, Compleanno…"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              className="apple-input w-full rounded-[10px] px-3 py-2.5 text-[15px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
                N° paganti
              </span>
              <NumericCellInput
                value={newTablePayers}
                integer
                onCommit={setNewTablePayers}
                ariaLabel="Numero paganti"
              />
            </div>
            <div>
              <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
                Prezzo (€ / px)
              </span>
              <NumericCellInput
                value={newTablePrice}
                prefix="€"
                onCommit={setNewTablePrice}
                ariaLabel="Prezzo a persona"
              />
            </div>
          </div>

          {/* Quick Table Price Chips */}
          {settings.quick_table_prices.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] mr-1" style={{ color: 'var(--ink-tertiary)' }}>
                Prezzi rapidi:
              </span>
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
                  € {p}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
                Extra No scarico (€)
              </span>
              <NumericCellInput
                value={newTableExtraNo}
                prefix="€"
                onCommit={setNewTableExtraNo}
                ariaLabel="Extra no scarico"
              />
            </div>
            <div>
              <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
                Extra Sì scarico (€)
              </span>
              <NumericCellInput
                value={newTableExtraSi}
                prefix="€"
                onCommit={setNewTableExtraSi}
                ariaLabel="Extra sì scarico"
              />
            </div>
          </div>

          <div>
            <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
              Stato scarico
            </span>
            <SegmentedControl<ScaricoStatus>
              ariaLabel="Stato scarico tavolo"
              value={newTableScarico}
              onChange={setNewTableScarico}
              className="w-full"
              options={[
                { value: 'DA SCARICARE', label: 'Da scaricare' },
                { value: 'DA NON SCARICARE', label: 'Da non scaricare' },
                { value: '-', label: '—' },
              ]}
            />
          </div>

          <div
            className="flex items-center justify-between pt-3"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <div className="tabular-nums">
              <span className="block text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                Credito stimato
              </span>
              <span className="text-[18px] font-bold">
                {formatEur(newTablePayers * newTablePrice + newTableExtraNo + newTableExtraSi)}
              </span>
            </div>
            <button
              type="submit"
              className="rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Aggiungi tavolo
            </button>
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
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[15px]"
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
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[15px]"
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
                className="apple-input w-full rounded-[10px] px-3 py-2 text-[15px] tabular-nums"
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
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[14px]"
            />
          </div>

          <div className="flex justify-end pt-2">
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
            className="apple-input w-full rounded-[12px] p-3 text-[13px] font-mono"
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
        subtitle={`Verranno rimossi tutti i tavoli e le prevendite di “${event.title}”. Potrai comunque annullare subito dopo.`}
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
