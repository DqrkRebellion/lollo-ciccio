import React from 'react';
import {
  Banknote,
  BarChart3,
  CalendarRange,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Ticket,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import type { SyncState } from '../hooks/useAppData';

export type NavTab =
  | 'events'
  | 'staff'
  | 'cash'
  | 'ticketsms'
  | 'dashboard'
  | 'ledger'
  | 'settings';

export function AppShell({
  activeTab,
  onSelectTab,
  teamName,
  staffName,
  userDisplayName,
  userColor,
  syncState,
  openMancantiCount,
  openStaffMancantiCount,
  ticketSmsAlert = false,
  ticketSmsActiveCount = 0,
  canUndo,
  undoCount,
  lastUndoLabel,
  onUndo,
  isDark,
  onToggleTheme,
  onOpenSearch,
  onOpenNewEvent,
  children,
}: {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  teamName: string;
  staffName: string;
  userDisplayName: string;
  userColor: string;
  syncState: SyncState;
  openMancantiCount: number;
  openStaffMancantiCount: number;
  ticketSmsAlert?: boolean;
  ticketSmsActiveCount?: number;
  canUndo: boolean;
  undoCount: number;
  lastUndoLabel: string | null;
  onUndo: () => Promise<void>;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenNewEvent: () => void;
  children: React.ReactNode;
}) {
  const desktopNavItems: {
    id: NavTab;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    alertDot?: boolean;
  }[] = [
    { id: 'events', label: 'Serate', shortLabel: 'Serate', icon: CalendarRange },
    {
      id: 'staff',
      label: staffName,
      shortLabel: staffName,
      icon: Users,
      badge: openStaffMancantiCount > 0 ? openStaffMancantiCount : undefined,
    },
    {
      id: 'cash',
      label: 'Raccolta soldi',
      shortLabel: 'Raccolta',
      icon: Banknote,
    },
    {
      id: 'ticketsms',
      label: 'TicketSMS',
      shortLabel: 'TicketSMS',
      icon: Ticket,
      badge: !ticketSmsAlert && ticketSmsActiveCount > 0 ? ticketSmsActiveCount : undefined,
      alertDot: ticketSmsAlert,
    },
    { id: 'dashboard', label: 'Dashboard', shortLabel: 'Stats', icon: BarChart3 },
    {
      id: 'ledger',
      label: 'Saldi & Buste',
      shortLabel: 'Saldi',
      icon: Wallet,
      badge: openMancantiCount > 0 ? openMancantiCount : undefined,
    },
    { id: 'settings', label: 'Impostazioni', shortLabel: 'Altro', icon: Settings },
  ];

  // Clean 5-tab iOS bottom bar (TicketSMS & Impostazioni are 1 tap away in the mobile top header!)
  const mobileNavItems = desktopNavItems.filter(
    (item) => item.id !== 'settings' && item.id !== 'ticketsms'
  );

  const syncLabel =
    syncState === 'live'
      ? 'Cloud live'
      : syncState === 'saving'
        ? 'Salvataggio…'
        : syncState === 'connecting'
          ? 'Connessione…'
          : 'Offline';

  const syncDotColor =
    syncState === 'live'
      ? '#34C759'
      : syncState === 'saving'
        ? '#0071E3'
        : syncState === 'connecting'
          ? '#FF9500'
          : '#FF3B30';

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row">
      {/* Desktop macOS Translucent Sidebar */}
      <aside
        className="hidden lg:flex lg:w-[236px] shrink-0 flex-col justify-between h-dvh sticky top-0 apple-sidebar select-none"
        style={{ borderRight: '0.5px solid var(--separator)' }}
      >
        <div className="p-3.5 space-y-4">
          {/* Brand Header */}
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[12px] font-bold text-white"
                style={{
                  background: 'linear-gradient(135deg, #0071E3 0%, #5856D6 100%)',
                }}
              >
                LC
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-bold tracking-tight truncate">{teamName}</div>
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: syncDotColor }}
                  />
                  {syncLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Spotlight Quick Search Trigger */}
          <button
            type="button"
            onClick={onOpenSearch}
            className="w-full flex items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-[13px] apple-press cursor-pointer transition-colors"
            style={{
              backgroundColor: 'var(--bg-surface-secondary)',
              color: 'var(--ink-secondary)',
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Cerca…
            </span>
            <kbd
              className="rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--ink-tertiary)',
              }}
            >
              ⌘K
            </kbd>
          </button>

          {/* Primary Navigation */}
          <nav aria-label="Navigazione principale" className="space-y-1">
            {desktopNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className="w-full flex items-center justify-between gap-2.5 rounded-[10px] px-3 py-2 text-[14px] font-medium apple-press cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--bg-active)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--ink-primary)',
                  }}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
                    {item.label}
                  </span>
                  {item.alertDot ? (
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: '#FF9500' }}
                      title="Attenzione sincronizzazione TicketSMS"
                    />
                  ) : (
                    item.badge !== undefined && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none"
                        style={{
                          backgroundColor:
                            item.id === 'ticketsms'
                              ? 'var(--accent-subtle)'
                              : 'var(--status-red-bg)',
                          color:
                            item.id === 'ticketsms' ? 'var(--accent)' : 'var(--status-red)',
                        }}
                      >
                        {item.badge}
                      </span>
                    )
                  )}
                </button>
              );
            })}
          </nav>

          {/* New Event Action + Quick Global Undo */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={onOpenNewEvent}
              className="w-full flex items-center justify-center gap-1.5 rounded-[11px] py-2.5 px-3 text-[13px] font-semibold text-white apple-press cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuova serata
            </button>

            {canUndo && (
              <button
                type="button"
                onClick={() => onUndo()}
                title={lastUndoLabel ? `Annulla: ${lastUndoLabel}` : 'Annulla ultima modifica'}
                className="w-full flex items-center justify-between gap-2 rounded-[10px] py-2 px-3 text-[12px] font-semibold apple-press cursor-pointer"
                style={{
                  backgroundColor: 'var(--accent-subtle)',
                  color: 'var(--accent)',
                }}
              >
                <span className="inline-flex items-center gap-1.5 truncate">
                  <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Annulla ({undoCount})</span>
                </span>
                <kbd className="text-[10px] opacity-75">⌘Z</kbd>
              </button>
            )}
          </div>
        </div>

        {/* Sidebar Footer: Active PR + Theme Quick Toggle */}
        <div
          className="p-3.5 flex items-center justify-between gap-2"
          style={{ borderTop: '0.5px solid var(--separator)' }}
        >
          <button
            type="button"
            onClick={() => onSelectTab('settings')}
            className="flex items-center gap-2.5 min-w-0 cursor-pointer"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: userColor }}
            >
              {userDisplayName.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 text-left">
              <div className="text-[13px] font-semibold truncate leading-tight">
                {userDisplayName}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                Profilo attivo
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
            className="flex h-8 w-8 items-center justify-center rounded-full apple-press cursor-pointer hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {isDark ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Translucent Top Header */}
      <header
        className="lg:hidden sticky top-0 z-30 apple-chrome flex items-center justify-between gap-2 px-4 h-[52px]"
        style={{
          borderBottom: '0.5px solid var(--separator)',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[11px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #0071E3 0%, #5856D6 100%)' }}
          >
            LC
          </span>
          <span className="text-[15px] font-bold tracking-tight truncate">{teamName}</span>
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: syncDotColor }}
            title={syncLabel}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!canUndo}
            onClick={() => onUndo()}
            aria-label={lastUndoLabel ? `Annulla: ${lastUndoLabel}` : 'Annulla ultima modifica'}
            title={lastUndoLabel ? `Annulla: ${lastUndoLabel}` : 'Annulla'}
            className="relative flex h-8 items-center justify-center gap-1 rounded-full px-2.5 text-[12px] font-semibold apple-press cursor-pointer disabled:opacity-30"
            style={{
              backgroundColor: canUndo ? 'var(--accent-subtle)' : 'var(--bg-surface-secondary)',
              color: canUndo ? 'var(--accent)' : 'var(--ink-secondary)',
            }}
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            {canUndo && <span className="tabular-nums">{undoCount}</span>}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('ticketsms')}
            aria-label="TicketSMS"
            title="TicketSMS"
            className="relative flex h-8 w-8 items-center justify-center rounded-full apple-press cursor-pointer"
            style={{
              backgroundColor:
                activeTab === 'ticketsms' ? 'var(--accent)' : 'var(--bg-surface-secondary)',
              color: activeTab === 'ticketsms' ? '#FFFFFF' : 'var(--ink-primary)',
            }}
          >
            <Ticket className="h-4 w-4" aria-hidden="true" />
            {ticketSmsAlert && (
              <span
                className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-surface)]"
                style={{ backgroundColor: '#FF9500' }}
              />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Cerca serate"
            className="flex h-8 w-8 items-center justify-center rounded-full apple-press cursor-pointer"
            style={{ backgroundColor: 'var(--bg-surface-secondary)', color: 'var(--ink-primary)' }}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
            className="flex h-8 w-8 items-center justify-center rounded-full apple-press cursor-pointer"
            style={{ backgroundColor: 'var(--bg-surface-secondary)', color: 'var(--ink-primary)' }}
          >
            {isDark ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('settings')}
            aria-label="Impostazioni e profilo"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white apple-press cursor-pointer"
            style={{
              backgroundColor: userColor,
              boxShadow: activeTab === 'settings' ? '0 0 0 2px var(--bg-surface), 0 0 0 4px var(--accent)' : 'none',
            }}
          >
            {userDisplayName.slice(0, 2).toUpperCase()}
          </button>
          <button
            type="button"
            onClick={onOpenNewEvent}
            aria-label="Nuova serata"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white apple-press cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 min-w-0">
        {children}
      </main>

      {/* Mobile Translucent iOS Bottom Tab Bar */}
      <nav
        aria-label="Navigazione inferiore"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 apple-chrome"
        style={{
          borderTop: '0.5px solid var(--separator)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="grid grid-cols-5 h-[58px]">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className="relative flex flex-col items-center justify-center gap-0.5 apple-press cursor-pointer"
                style={{
                  color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                }}
              >
                <div className="relative">
                  <Icon className="h-[20px] w-[20px]" aria-hidden="true" />
                  {item.badge !== undefined && (
                    <span
                      className="absolute -top-1 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full px-1 text-[10px] font-bold text-white tabular-nums"
                      style={{ backgroundColor: '#FF3B30' }}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
