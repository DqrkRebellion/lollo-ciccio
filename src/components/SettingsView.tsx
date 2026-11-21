import React, { useEffect, useState } from 'react';
import {
  Building2,
  Calculator,
  Database,
  Download,
  Fingerprint,
  KeyRound,
  Lock,
  LogOut,
  Palette,
  Plus,
  ScanFace,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AppleModal,
  AppleSwitch,
  NumericCellInput,
  SegmentedControl,
} from './ui/AppleControls';
import { supabase } from '../lib/supabase';
import {
  deletePasskey,
  enrollDeviceBiometrics,
  getBiometricCapability,
  getLocalCredentialId,
  isLockOnOpenEnabled,
  listOwnPasskeys,
  setLockOnOpenEnabled,
  type BiometricCapability,
  type StoredPasskey,
} from '../lib/biometrics';
import { exportEventsToCsv, formatDateShort, formatEur } from '../lib/format';
import type {
  AppSettings,
  BonusSplitMode,
  BonusTier,
  EventMode,
  EventSummary,
  FullEvent,
  PresaleInputMode,
  Promoter,
  ScaricoStatus,
  ThemePreference,
  Venue,
} from '../types';
import type { TicketSmsSyncStatus } from '../types/ticketsms';
import type { SyncState } from '../hooks/useAppData';

function formatSyncTimeIt(iso: string | null | undefined): string {
  if (!iso) return 'In attesa';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'In attesa';
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const APPLE_COLORS = [
  '#0071E3',
  '#5856D6',
  '#AF52DE',
  '#FF2D55',
  '#FF3B30',
  '#FF9500',
  '#34C759',
  '#30B0C7',
  '#32ADE6',
  '#8E8E93',
];

type SettingsSection = 'rules' | 'venues' | 'team' | 'preferences' | 'account' | 'data';

export function SettingsView({
  settings,
  promoters,
  venues,
  events,
  summaries,
  themePreference,
  onChangeTheme,
  syncState,
  ticketSmsSyncStatus = null,
  userEmail,
  userDisplayName,
  userPromoterId,
  onUpdateSettings,
  onUpsertVenue,
  onUpsertPromoter,
  onLockNow,
  onSignOut,
}: {
  settings: AppSettings;
  promoters: Promoter[];
  venues: Venue[];
  events: FullEvent[];
  summaries: Map<string, EventSummary>;
  themePreference: ThemePreference;
  onChangeTheme: (pref: ThemePreference) => void;
  syncState: SyncState;
  ticketSmsSyncStatus?: TicketSmsSyncStatus | null;
  userEmail: string;
  userDisplayName: string;
  userPromoterId: string;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onUpsertVenue: (venue: Partial<Venue> & { name: string }) => Promise<void>;
  onUpsertPromoter: (promoter: Promoter) => Promise<void>;
  onLockNow: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [section, setSection] = useState<SettingsSection>('rules');

  // Bonus tier add form
  const [newTierThreshold, setNewTierThreshold] = useState(0);
  const [newTierBonus, setNewTierBonus] = useState(0);

  // Venue modal
  const [venueModalOpen, setVenueModalOpen] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Partial<Venue> & { name: string }>({
    name: '',
    color: '#0071E3',
    default_mode: 'NO OSPITE',
    default_table_price: 30,
    default_lista_cost: 0,
    is_archived: false,
  });

  // Promoter modal
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [editingPr, setEditingPr] = useState<Promoter>({
    id: '',
    display_name: '',
    full_name: '',
    color: '#0071E3',
    is_active: true,
    sort_order: promoters.length + 1,
  });
  const [isNewPr, setIsNewPr] = useState(false);

  // Quick prices text draft
  const [quickPricesDraft, setQuickPricesDraft] = useState(() =>
    settings.quick_table_prices.join(', ')
  );

  // Change PIN form
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);

  // Biometrics / Face ID state
  const [bioCap, setBioCap] = useState<BiometricCapability | null>(null);
  const [passkeys, setPasskeys] = useState<StoredPasskey[]>([]);
  const [bioEnrolling, setBioEnrolling] = useState(false);
  const [lockOnOpen, setLockOnOpen] = useState(() => isLockOnOpenEnabled());
  const localCredId = getLocalCredentialId(userPromoterId);

  useEffect(() => {
    getBiometricCapability().then(setBioCap);
    listOwnPasskeys().then(setPasskeys);
  }, []);

  const handleEnrollBio = async () => {
    setBioEnrolling(true);
    try {
      await enrollDeviceBiometrics(userPromoterId);
      setLockOnOpen(true);
      const updated = await listOwnPasskeys();
      setPasskeys(updated);
      toast.success(`${bioCap?.label || 'Biometria'} attivato su questo dispositivo`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Attivazione non completata';
      if (!msg.toLowerCase().includes('annullat') && !msg.toLowerCase().includes('abort')) {
        toast.error(msg);
      }
    } finally {
      setBioEnrolling(false);
    }
  };

  const handleRemovePasskey = async (pk: StoredPasskey) => {
    try {
      await deletePasskey(pk.id, pk.credential_id, userPromoterId);
      setPasskeys((prev) => prev.filter((x) => x.id !== pk.id));
      toast.success(`Dispositivo “${pk.device_name}” rimosso`);
    } catch {
      toast.error('Impossibile rimuovere il dispositivo');
    }
  };

  const navItems: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'rules', label: 'Buste & Regole', icon: Calculator },
    { id: 'venues', label: 'Locali', icon: Building2 },
    { id: 'team', label: 'Team PR', icon: Users },
    { id: 'preferences', label: 'Aspetto & Input', icon: Palette },
    { id: 'account', label: 'Account & PIN', icon: KeyRound },
    { id: 'data', label: 'Dati & Backup', icon: Database },
  ];

  const sortedTiers = [...settings.bonus_tiers].sort((a, b) => a.threshold - b.threshold);

  const handleSaveTiers = (tiers: BonusTier[]) => {
    const cleaned = tiers
      .filter((t) => t.threshold > 0 && t.bonus >= 0)
      .sort((a, b) => b.threshold - a.threshold);
    onUpdateSettings({ bonus_tiers: cleaned });
  };

  const handleAddTier = () => {
    if (newTierThreshold <= 0 || newTierBonus <= 0) {
      toast.error('Inserisci una soglia e un bonus maggiori di zero');
      return;
    }
    handleSaveTiers([
      ...settings.bonus_tiers.filter((t) => t.threshold !== newTierThreshold),
      { threshold: newTierThreshold, bonus: newTierBonus },
    ]);
    setNewTierThreshold(0);
    setNewTierBonus(0);
    toast.success('Scaglione bonus aggiunto');
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(newPin)) {
      toast.error('Il codice PIN deve essere composto da 6 cifre numeriche');
      return;
    }
    if (newPin !== confirmPin) {
      toast.error('I due codici PIN non coincidono');
      return;
    }
    setPinSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPin });
      if (error) throw error;
      setNewPin('');
      setConfirmPin('');
      toast.success('Codice PIN aggiornato con successo');
    } catch (err) {
      console.error(err);
      toast.error('Impossibile aggiornare il PIN');
    } finally {
      setPinSaving(false);
    }
  };

  const handleExportCsv = () => {
    const csv = '\uFEFF' + exportEventsToCsv(events, summaries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lollo-ciccio-serate-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('File CSV esportato');
  };

  const handleExportJson = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      settings,
      promoters,
      venues,
      events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lollo-ciccio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup JSON scaricato');
  };

  const saveQuickPrices = () => {
    const parsed = quickPricesDraft
      .split(/[,;\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (parsed.length === 0) return;
    const unique = Array.from(new Set(parsed)).sort((a, b) => a - b);
    onUpdateSettings({ quick_table_prices: unique });
    setQuickPricesDraft(unique.join(', '));
    toast.success('Prezzi rapidi salvati');
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-12">
      <div className="mb-5">
        <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight">Impostazioni</h1>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Settings Sidebar (Apple macOS System Settings style) */}
        <nav
          aria-label="Categorie impostazioni"
          className="md:w-[220px] shrink-0 flex md:flex-col gap-1 overflow-x-auto pb-1 md:pb-0"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className="inline-flex md:flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[14px] font-medium whitespace-nowrap apple-press cursor-pointer transition-colors"
                style={{
                  backgroundColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#FFFFFF' : 'var(--ink-primary)',
                }}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Settings Pane Content */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* 1. BUSTE & REGOLE */}
          {section === 'rules' && (
            <>
              <div className="apple-surface rounded-[16px] overflow-hidden">
                <div className="apple-list">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 px-4 sm:px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium">Nome squadra / intestazione</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Visibile nella sidebar e nei riepiloghi
                      </div>
                    </div>
                    <input
                      type="text"
                      defaultValue={settings.team_name}
                      key={settings.team_name}
                      aria-label="Nome squadra"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== settings.team_name) onUpdateSettings({ team_name: v });
                      }}
                      className="apple-input w-full sm:w-44 rounded-[8px] px-3 py-1.5 text-[16px] md:text-[14px] font-medium sm:text-right"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div>
                      <div className="text-[14px] font-medium">Provvigione per prevendita</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Importo maturato in busta per ogni prevendita venduta
                      </div>
                    </div>
                    <NumericCellInput
                      value={settings.presale_commission}
                      prefix="€"
                      onCommit={(v) => {
                        onUpdateSettings({ presale_commission: v });
                        toast.success('Provvigione prevendita aggiornata');
                      }}
                      ariaLabel="Provvigione per prevendita"
                      className="w-24"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div>
                      <div className="text-[14px] font-medium">Percentuale tavoli · No ospite</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Default storico del foglio: 10% sul credito tavoli
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <NumericCellInput
                        value={Math.round(settings.table_rate_no_guest * 10000) / 100}
                        onCommit={(v) => {
                          onUpdateSettings({ table_rate_no_guest: v / 100 });
                          toast.success('Percentuale No ospite aggiornata');
                        }}
                        ariaLabel="Percentuale tavoli No ospite"
                        className="w-20"
                      />
                      <span className="text-[14px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        %
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div>
                      <div className="text-[14px] font-medium">Percentuale tavoli · Ospite</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Default storico del foglio: 8% sul credito tavoli
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <NumericCellInput
                        value={Math.round(settings.table_rate_guest * 10000) / 100}
                        onCommit={(v) => {
                          onUpdateSettings({ table_rate_guest: v / 100 });
                          toast.success('Percentuale Ospite aggiornata');
                        }}
                        ariaLabel="Percentuale tavoli Ospite"
                        className="w-20"
                      />
                      <span className="text-[14px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        %
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div>
                      <div className="text-[14px] font-medium">Costo lista PR predefinito</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Precompilato nelle nuove serate (€ per ingresso lista)
                      </div>
                    </div>
                    <NumericCellInput
                      value={settings.default_lista_cost}
                      prefix="€"
                      onCommit={(v) => onUpdateSettings({ default_lista_cost: v })}
                      ariaLabel="Costo lista predefinito"
                      className="w-24"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5">
                    <div>
                      <div className="text-[14px] font-medium">Ripartizione bonus tra i PR</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Nel foglio originale il bonus viene diviso in proporzione al fatturato
                      </div>
                    </div>
                    <SegmentedControl<BonusSplitMode>
                      ariaLabel="Ripartizione bonus"
                      size="sm"
                      value={settings.bonus_split_mode}
                      onChange={(m) => {
                        onUpdateSettings({ bonus_split_mode: m });
                        toast.success('Ripartizione bonus aggiornata');
                      }}
                      options={[
                        { value: 'revenue_proportional', label: 'Fatturato' },
                        { value: 'px_proportional', label: 'PX' },
                        { value: 'equal', label: '50 / 50' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              {/* Bonus Tiers Editor */}
              <div className="apple-surface rounded-[16px] overflow-hidden">
                <div
                  className="px-5 py-3.5"
                  style={{ borderBottom: '0.5px solid var(--separator)' }}
                >
                  <h2 className="text-[15px] font-semibold">Scaglioni bonus fatturato serata</h2>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                    Se il fatturato totale (€ Preve + € Tavoli) supera la soglia, si aggiunge il bonus alla busta
                  </p>
                </div>

                <div className="apple-list">
                  {sortedTiers.map((tier, idx) => (
                    <div
                      key={`${tier.threshold}-${idx}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 tabular-nums"
                    >
                      <div className="flex items-center gap-3 text-[14px]">
                        <span style={{ color: 'var(--ink-secondary)' }}>Oltre</span>
                        <strong className="font-semibold">{formatEur(tier.threshold)}</strong>
                        <span style={{ color: 'var(--ink-tertiary)' }}>→</span>
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                          style={{
                            backgroundColor: 'var(--status-green-bg)',
                            color: 'var(--status-green)',
                          }}
                        >
                          +{formatEur(tier.bonus)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveTiers(
                            settings.bonus_tiers.filter((t) => t.threshold !== tier.threshold)
                          )
                        }
                        aria-label={`Rimuovi soglia ${tier.threshold}`}
                        className="p-1.5 rounded-[8px] hover:bg-[var(--status-red-bg)] cursor-pointer"
                        style={{ color: 'var(--status-red)' }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}

                  <div
                    className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3"
                    style={{ backgroundColor: 'var(--bg-hover)' }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        Soglia
                      </span>
                      <NumericCellInput
                        value={newTierThreshold}
                        prefix="€"
                        onCommit={setNewTierThreshold}
                        ariaLabel="Nuova soglia fatturato"
                        className="w-28"
                      />
                      <span className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        Bonus
                      </span>
                      <NumericCellInput
                        value={newTierBonus}
                        prefix="€"
                        onCommit={setNewTierBonus}
                        ariaLabel="Nuovo importo bonus"
                        className="w-24"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddTier}
                      className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold text-white apple-press cursor-pointer"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Aggiungi soglia
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 2. LOCALI */}
          {section === 'venues' && (
            <div className="apple-surface rounded-[16px] overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-3.5"
                style={{ borderBottom: '0.5px solid var(--separator)' }}
              >
                <div>
                  <h2 className="text-[15px] font-semibold">Locali gestiti ({venues.length})</h2>
                  <p className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                    Ogni locale può avere modalità e prezzo tavolo predefiniti
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingVenue({
                      name: '',
                      color: '#0071E3',
                      default_mode: 'NO OSPITE',
                      default_table_price: 30,
                      default_lista_cost: 0,
                      is_archived: false,
                    });
                    setVenueModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold text-white apple-press cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Nuovo locale
                </button>
              </div>

              <div className="apple-list">
                {venues.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="h-3.5 w-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: v.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold truncate">
                          {v.name}
                          {v.is_archived && (
                            <span
                              className="ml-2 text-[11px] font-normal"
                              style={{ color: 'var(--ink-tertiary)' }}
                            >
                              Archiviato
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                          Default: {v.default_mode} · Tavolo {formatEur(v.default_table_price)}
                          {v.default_lista_cost > 0 ? ` · Lista ${formatEur(v.default_lista_cost)}` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingVenue({ ...v });
                        setVenueModalOpen(true);
                      }}
                      className="rounded-[8px] px-3 py-1 text-[12px] font-medium apple-press cursor-pointer"
                      style={{
                        backgroundColor: 'var(--bg-surface-secondary)',
                        color: 'var(--ink-primary)',
                      }}
                    >
                      Modifica
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. TEAM PR */}
          {section === 'team' && (
            <div className="apple-surface rounded-[16px] overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-3.5"
                style={{ borderBottom: '0.5px solid var(--separator)' }}
              >
                <div>
                  <h2 className="text-[15px] font-semibold">Promoter &amp; Team</h2>
                  <p className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                    I PR attivi vengono precompilati automaticamente nelle nuove serate
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsNewPr(true);
                    setEditingPr({
                      id: '',
                      display_name: '',
                      full_name: '',
                      color: '#34C759',
                      is_active: true,
                      sort_order: promoters.length + 1,
                    });
                    setPrModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold text-white apple-press cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Aggiungi PR
                </button>
              </div>

              <div className="apple-list">
                {promoters.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold">
                          {p.display_name}{' '}
                          <span className="font-normal" style={{ color: 'var(--ink-secondary)' }}>
                            · {p.full_name}
                          </span>
                        </div>
                        <div className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                          {p.is_active ? 'Attivo sulle nuove serate' : 'Solo storico archivio'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <AppleSwitch
                        checked={p.is_active}
                        label={`Stato attivo ${p.display_name}`}
                        onChange={(checked) => onUpsertPromoter({ ...p, is_active: checked })}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsNewPr(false);
                          setEditingPr({ ...p });
                          setPrModalOpen(true);
                        }}
                        className="rounded-[8px] px-3 py-1 text-[12px] font-medium apple-press cursor-pointer"
                        style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                      >
                        Modifica
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. ASPETTO & INPUT */}
          {section === 'preferences' && (
            <div className="apple-surface rounded-[16px] overflow-hidden">
              <div className="apple-list">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[14px] font-medium">Aspetto interfaccia</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      La modalità scura è ideale di notte all’ingresso del locale
                    </div>
                  </div>
                  <SegmentedControl<ThemePreference>
                    ariaLabel="Tema interfaccia"
                    size="sm"
                    value={themePreference}
                    onChange={onChangeTheme}
                    options={[
                      { value: 'system', label: 'Sistema' },
                      { value: 'light', label: 'Chiaro' },
                      { value: 'dark', label: 'Scuro' },
                    ]}
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[14px] font-medium">Modalità inserimento prevendite</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      Scegli tra inserimento per singolo PR o Totale − Lollo (attiva su tutte le serate)
                    </div>
                  </div>
                  <SegmentedControl<PresaleInputMode>
                    ariaLabel="Modalità inserimento prevendite"
                    size="sm"
                    value={settings.default_presale_input_mode}
                    onChange={(m) => {
                      onUpdateSettings({ default_presale_input_mode: m });
                      toast.success(
                        m === 'total_minus_primary'
                          ? 'Modalità prevendite: Totale − Lollo'
                          : 'Modalità prevendite: Per PR'
                      );
                    }}
                    options={[
                      { value: 'per_pr', label: 'Per PR' },
                      { value: 'total_minus_primary', label: 'Totale − Lollo' },
                    ]}
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[14px] font-medium">Scarico predefinito nuovi tavoli</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      Stato assegnato automaticamente quando aggiungi un tavolo
                    </div>
                  </div>
                  <SegmentedControl<ScaricoStatus>
                    ariaLabel="Scarico predefinito nuovi tavoli"
                    size="sm"
                    value={settings.default_table_scarico}
                    onChange={(s) => onUpdateSettings({ default_table_scarico: s })}
                    options={[
                      { value: 'DA SCARICARE', label: 'Da scaricare' },
                      { value: 'DA NON SCARICARE', label: 'No scarico' },
                      { value: '-', label: '—' },
                    ]}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <div className="text-[14px] font-medium">Mostra sempre colonne sovraprezzo</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      Mostra N paganti 2 e Sovraprezzo nella tabella tavoli di default
                    </div>
                  </div>
                  <AppleSwitch
                    checked={settings.show_surcharge_columns}
                    label="Mostra colonne sovraprezzo"
                    onChange={(checked) => onUpdateSettings({ show_surcharge_columns: checked })}
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[14px] font-medium">Prezzi rapidi tavoli (€)</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      Pulsanti rapidi nel modulo Nuovo tavolo (separati da virgola)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={quickPricesDraft}
                      onChange={(e) => setQuickPricesDraft(e.target.value)}
                      onBlur={saveQuickPrices}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveQuickPrices();
                      }}
                      aria-label="Prezzi rapidi tavoli"
                      className="apple-input w-full sm:w-40 rounded-[8px] px-3 py-1.5 text-[16px] md:text-[14px] tabular-nums"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. ACCOUNT & PIN */}
          {section === 'account' && (
            <>
              <div className="apple-surface rounded-[16px] overflow-hidden">
                <div className="apple-list">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <div className="text-[14px] font-semibold">
                        Profilo connesso: {userDisplayName}
                      </div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        {userEmail} · Cloud{' '}
                        <span
                          style={{
                            color:
                              syncState === 'error' ? 'var(--status-red)' : 'var(--status-green)',
                          }}
                        >
                          {syncState === 'live'
                            ? 'Sincronizzato in tempo reale'
                            : syncState === 'saving'
                              ? 'Salvataggio…'
                              : syncState === 'connecting'
                                ? 'Connessione…'
                                : 'Errore connessione'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={onLockNow}
                        className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold apple-press cursor-pointer"
                        style={{
                          backgroundColor: 'var(--bg-surface-secondary)',
                          color: 'var(--ink-primary)',
                        }}
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Blocca ora
                      </button>
                      <button
                        type="button"
                        onClick={onSignOut}
                        className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold apple-press cursor-pointer"
                        style={{
                          backgroundColor: 'var(--status-red-bg)',
                          color: 'var(--status-red)',
                        }}
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                        Esci
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Face ID / Touch ID / Android Biometrics Card */}
              <div className="apple-surface rounded-[16px] overflow-hidden">
                <div
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  style={{ borderBottom: '0.5px solid var(--separator)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
                      style={{
                        backgroundColor: 'var(--accent-subtle)',
                        color: 'var(--accent)',
                      }}
                    >
                      {bioCap?.platform === 'ios' ? (
                        <ScanFace className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Fingerprint className="h-5 w-5" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-semibold">
                        {bioCap?.label || 'Face ID & Biometria'}
                      </h2>
                      <p className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        {bioCap?.supported
                          ? localCredId
                            ? `Attivo su questo ${bioCap.deviceName}`
                            : `Disponibile su questo ${bioCap.deviceName} (Apple & Android)`
                          : 'Non rilevato su questo browser'}
                      </p>
                    </div>
                  </div>

                  {bioCap?.supported && (
                    <button
                      type="button"
                      disabled={bioEnrolling}
                      onClick={handleEnrollBio}
                      className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      {bioEnrolling
                        ? 'Verifica…'
                        : localCredId
                          ? 'Aggiungi dispositivo'
                          : `Attiva ${bioCap.label}`}
                    </button>
                  )}
                </div>

                <div className="apple-list">
                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div>
                      <div className="text-[14px] font-medium">
                        Richiedi {bioCap?.label || 'Face ID'} / PIN all’apertura
                      </div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Quando riapri il sito mostra subito lo sblocco biometrico automatico
                      </div>
                    </div>
                    <AppleSwitch
                      checked={lockOnOpen}
                      label="Richiedi sblocco all'apertura"
                      onChange={(checked) => {
                        setLockOnOpen(checked);
                        setLockOnOpenEnabled(checked);
                        toast.success(
                          checked
                            ? 'Sblocco automatico all’apertura attivato'
                            : 'Blocco all’apertura disattivato'
                        );
                      }}
                    />
                  </div>

                  {passkeys.length > 0 &&
                    passkeys.map((pk) => {
                      const isThisDevice = pk.credential_id === localCredId;
                      return (
                        <div
                          key={pk.id}
                          className="flex items-center justify-between gap-3 px-5 py-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Smartphone
                              className="h-4 w-4 shrink-0"
                              style={{ color: 'var(--ink-secondary)' }}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold truncate">
                                {pk.device_name}
                                {isThisDevice && (
                                  <span
                                    className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                    style={{
                                      backgroundColor: 'var(--status-green-bg)',
                                      color: 'var(--status-green)',
                                    }}
                                  >
                                    Questo dispositivo
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                                Registrato il {formatDateShort(pk.created_at.slice(0, 10))}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemovePasskey(pk)}
                            aria-label={`Rimuovi ${pk.device_name}`}
                            className="p-1.5 rounded-[8px] hover:bg-[var(--status-red-bg)] cursor-pointer"
                            style={{ color: 'var(--status-red)' }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>

              <form
                onSubmit={handleChangePin}
                className="apple-surface rounded-[16px] p-5 space-y-4"
              >
                <div>
                  <h2 className="text-[15px] font-semibold">Cambia il tuo codice PIN (6 cifre)</h2>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                    Modifica il codice personale usato per sbloccare l’app su {userDisplayName}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="new-pin-input"
                      className="block text-[12px] font-medium mb-1"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      Nuovo PIN (6 cifre)
                    </label>
                    <input
                      id="new-pin-input"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px] tracking-widest tabular-nums"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="confirm-pin-input"
                      className="block text-[12px] font-medium mb-1"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      Conferma nuovo PIN
                    </label>
                    <input
                      id="confirm-pin-input"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px] tracking-widest tabular-nums"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={pinSaving || newPin.length !== 6 || confirmPin.length !== 6}
                    className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer disabled:opacity-45"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    {pinSaving ? 'Aggiornamento…' : 'Aggiorna PIN'}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* 6. DATI & BACKUP */}
          {section === 'data' && (
            <div className="apple-surface rounded-[16px] overflow-hidden">
              <div className="apple-list">
                {(userPromoterId === 'lollo' || userPromoterId === 'ciccio') && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 px-4 sm:px-5 py-4">
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium">Sincronizzazione TicketSMS</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                        Automatica ogni giorno alle 15:00 · Ultimo sync:{' '}
                        {formatSyncTimeIt(ticketSmsSyncStatus?.synced_at)}
                      </div>
                      {ticketSmsSyncStatus &&
                        (ticketSmsSyncStatus.status === 'session_expired' ||
                          ticketSmsSyncStatus.status === 'error') && (
                          <div
                            className="mt-1 text-[12px] font-medium"
                            style={{
                              color:
                                ticketSmsSyncStatus.status === 'session_expired'
                                  ? 'var(--status-orange)'
                                  : 'var(--status-red)',
                            }}
                          >
                            {ticketSmsSyncStatus.message ||
                              (ticketSmsSyncStatus.status === 'session_expired'
                                ? 'Sessione scaduta: aggiorna il cookie TicketSMS'
                                : 'Errore ultimo sync')}
                          </div>
                        )}
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 self-start sm:self-auto"
                      style={{
                        backgroundColor:
                          ticketSmsSyncStatus?.status === 'session_expired'
                            ? 'var(--status-orange-bg)'
                            : ticketSmsSyncStatus?.status === 'error'
                              ? 'var(--status-red-bg)'
                              : 'var(--status-green-bg)',
                        color:
                          ticketSmsSyncStatus?.status === 'session_expired'
                            ? 'var(--status-orange)'
                            : ticketSmsSyncStatus?.status === 'error'
                              ? 'var(--status-red)'
                              : 'var(--status-green)',
                      }}
                    >
                      Ogni giorno · 15:00
                    </span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 px-4 sm:px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">Esporta riepilogo CSV (Excel / Sheets)</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      Tabella completa di tutte le {events.length} serate con PX, fatturato, buste e scarichi
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold text-white apple-press cursor-pointer shrink-0 self-start sm:self-auto"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Scarica CSV
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 px-4 sm:px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">Backup completo JSON</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                      Include ogni singolo tavolo, prevendita, locale, PR e impostazione
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold apple-press cursor-pointer shrink-0 self-start sm:self-auto"
                    style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Scarica JSON
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Venue Modal */}
      <AppleModal
        open={venueModalOpen}
        onClose={() => setVenueModalOpen(false)}
        title={editingVenue.id ? `Modifica ${editingVenue.name}` : 'Nuovo locale'}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editingVenue.name.trim()) return;
            await onUpsertVenue(editingVenue);
            setVenueModalOpen(false);
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="venue-name-in"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nome locale
            </label>
            <input
              id="venue-name-in"
              type="text"
              required
              value={editingVenue.name}
              onChange={(e) => setEditingVenue((v) => ({ ...v, name: e.target.value }))}
              placeholder="Es. Touchè, Million, TPF…"
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px]"
            />
          </div>

          <div>
            <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
              Colore identificativo
            </span>
            <div className="flex flex-wrap gap-2">
              {APPLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditingVenue((v) => ({ ...v, color: c }))}
                  aria-label={`Colore ${c}`}
                  className="h-7 w-7 rounded-full cursor-pointer transition-transform apple-press"
                  style={{
                    backgroundColor: c,
                    boxShadow: editingVenue.color === c ? `0 0 0 2px var(--bg-surface), 0 0 0 4px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
              Modalità predefinita
            </span>
            <SegmentedControl<EventMode>
              ariaLabel="Modalità predefinita locale"
              value={editingVenue.default_mode || 'NO OSPITE'}
              onChange={(m) => setEditingVenue((v) => ({ ...v, default_mode: m }))}
              className="w-full"
              options={[
                { value: 'NO OSPITE', label: 'No ospite' },
                { value: 'OSPITE', label: 'Ospite' },
                { value: '-', label: 'Off' },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
                Prezzo tavolo default
              </span>
              <NumericCellInput
                value={editingVenue.default_table_price ?? 30}
                prefix="€"
                onCommit={(val) => setEditingVenue((v) => ({ ...v, default_table_price: val }))}
                ariaLabel="Prezzo tavolo predefinito"
              />
            </div>
            <div>
              <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
                Costo lista default
              </span>
              <NumericCellInput
                value={editingVenue.default_lista_cost ?? 0}
                prefix="€"
                onCommit={(val) => setEditingVenue((v) => ({ ...v, default_lista_cost: val }))}
                ariaLabel="Costo lista predefinito"
              />
            </div>
          </div>

          {editingVenue.id && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[14px] font-medium">Archivia locale</span>
              <AppleSwitch
                checked={Boolean(editingVenue.is_archived)}
                label="Archivia locale"
                onChange={(checked) => setEditingVenue((v) => ({ ...v, is_archived: checked }))}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setVenueModalOpen(false)}
              className="rounded-[10px] px-4 py-2 text-[14px] font-medium apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              Annulla
            </button>
            <button
              type="submit"
              className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Salva locale
            </button>
          </div>
        </form>
      </AppleModal>

      {/* Promoter Modal */}
      <AppleModal
        open={prModalOpen}
        onClose={() => setPrModalOpen(false)}
        title={isNewPr ? 'Nuovo Promoter' : `Modifica ${editingPr.display_name}`}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editingPr.display_name.trim() || !editingPr.full_name.trim()) return;
            const slug = isNewPr
              ? editingPr.display_name
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, '')
                  .slice(0, 16) || `pr${Date.now()}`
              : editingPr.id;
            await onUpsertPromoter({
              ...editingPr,
              id: slug,
              display_name: editingPr.display_name.trim(),
              full_name: editingPr.full_name.trim(),
            });
            setPrModalOpen(false);
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="pr-disp-name"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nome breve (es. Lollo, Ciccio)
            </label>
            <input
              id="pr-disp-name"
              type="text"
              required
              value={editingPr.display_name}
              onChange={(e) => setEditingPr((p) => ({ ...p, display_name: e.target.value }))}
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px]"
            />
          </div>
          <div>
            <label
              htmlFor="pr-full-name"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nome completo (usato per import prevendite)
            </label>
            <input
              id="pr-full-name"
              type="text"
              required
              value={editingPr.full_name}
              onChange={(e) => setEditingPr((p) => ({ ...p, full_name: e.target.value }))}
              className="apple-input w-full rounded-[10px] px-3 py-2 text-[16px] md:text-[15px]"
            />
          </div>
          <div>
            <span className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>
              Colore badge
            </span>
            <div className="flex flex-wrap gap-2">
              {APPLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditingPr((p) => ({ ...p, color: c }))}
                  aria-label={`Colore ${c}`}
                  className="h-7 w-7 rounded-full cursor-pointer apple-press"
                  style={{
                    backgroundColor: c,
                    boxShadow:
                      editingPr.color === c ? `0 0 0 2px var(--bg-surface), 0 0 0 4px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPrModalOpen(false)}
              className="rounded-[10px] px-4 py-2 text-[14px] font-medium apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
            >
              Annulla
            </button>
            <button
              type="submit"
              className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Salva PR
            </button>
          </div>
        </form>
      </AppleModal>
    </div>
  );
}
