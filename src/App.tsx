import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { toast, Toaster } from 'sonner';
import { supabase, TEAM_ACCOUNTS } from './lib/supabase';
import {
  getBiometricCapability,
  getLocalCredentialId,
  isBiometricPromptDismissed,
  isLockOnOpenEnabled,
  isSessionUnlockedThisVisit,
  markSessionUnlockedThisVisit,
  type BiometricCapability,
} from './lib/biometrics';
import { useTheme } from './hooks/useTheme';
import { useAppData } from './hooks/useAppData';
import { useStaffData } from './hooks/useStaffData';
import { LockScreen } from './components/LockScreen';
import { BiometricSetupModal } from './components/BiometricSetupModal';
import { AppShell, type NavTab } from './components/AppShell';
import { EventWorkspace } from './components/EventWorkspace';
import { NewEventModal } from './components/NewEventModal';
import { SpotlightSearch } from './components/SpotlightSearch';

const StaffWorkspace = lazy(() =>
  import('./components/StaffWorkspace').then((m) => ({ default: m.StaffWorkspace }))
);
const CashCollectionView = lazy(() =>
  import('./components/CashCollectionView').then((m) => ({ default: m.CashCollectionView }))
);
const DashboardView = lazy(() =>
  import('./components/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const LedgerView = lazy(() =>
  import('./components/LedgerView').then((m) => ({ default: m.LedgerView }))
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({ default: m.SettingsView }))
);

export default function App() {
  const { preference, setPreference, isDark } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [visitUnlocked, setVisitUnlocked] = useState<boolean>(() => {
    if (!isLockOnOpenEnabled()) return true;
    return isSessionUnlockedThisVisit();
  });
  const [bioCap, setBioCap] = useState<BiometricCapability | null>(null);
  const [showBioPrompt, setShowBioPrompt] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('events');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [cashEventId, setCashEventId] = useState<string | null>(null);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    getBiometricCapability().then(setBioCap);
  }, []);

  // Auth listener
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const currentAccount = useMemo(() => {
    const email = session?.user?.email || '';
    const matched = TEAM_ACCOUNTS.find((a) => a.email === email);
    if (matched) return matched;
    return {
      promoterId: 'lollo',
      email,
      displayName: String(session?.user?.user_metadata?.display_name || 'Lollo'),
      fullName: String(session?.user?.user_metadata?.full_name || 'Lorenzo Biondi'),
      initials: 'LC',
      color: '#0071E3',
    };
  }, [session]);

  const ownerPromoterId: 'lollo' | 'ciccio' =
    currentAccount.promoterId === 'ciccio' ? 'ciccio' : 'lollo';

  const isUnlocked = Boolean(session) && visitUnlocked;
  const data = useAppData(isUnlocked);
  const staffData = useStaffData(isUnlocked, ownerPromoterId, data.pushUndo, () => {
    data.fetchAll(true);
  });

  const handleSelectNavTab = (tab: NavTab) => {
    if (tab === activeTab && (tab === 'events' || tab === 'staff') && selectedEventId) {
      setSelectedEventId(null);
    }
    setActiveTab(tab);
  };

  // Global Apple keyboard shortcuts (⌘K search, ⌘Z undo, ⌘⇧Z / Ctrl+Y redo)
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isEditingText) return;

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        data.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        data.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, data.undo, data.redo]);

  const openMancantiCount = useMemo(() => {
    let count = 0;
    for (const ev of data.events) {
      if (ev.era !== '2PX') continue;
      const s = data.summaries.get(ev.id);
      if (s && s.mancantiTotal > 0.01) count += 1;
    }
    return count;
  }, [data.events, data.summaries]);

  const openStaffMancantiCount = useMemo(() => {
    let count = 0;
    for (const s of staffData.summariesByEvent.values()) {
      if (s.totalMancanti > 0.01) count += 1;
    }
    return count;
  }, [staffData.summariesByEvent]);

  const handleOpenEventFromAnywhere = (eventId: string) => {
    setSelectedEventId(eventId);
    setActiveTab((cur) => (cur === 'staff' ? 'staff' : 'events'));
  };

  if (!authReady) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-canvas)' }}
      >
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <>
      <Toaster
        position="bottom-right"
        theme={isDark ? 'dark' : 'light'}
        toastOptions={{
          style: {
            borderRadius: '14px',
            fontFamily: 'inherit',
          },
        }}
      />

      {!isUnlocked ? (
        <LockScreen
          onAuthenticated={(method, promoterId) => {
            setVisitUnlocked(true);
            supabase.auth.getSession().then(({ data: d }) => setSession(d.session ?? null));
            // Offer 1-tap Face ID / Android Biometrics activation right after first PIN unlock
            if (
              method === 'pin' &&
              bioCap?.supported &&
              !getLocalCredentialId(promoterId) &&
              !isBiometricPromptDismissed(promoterId)
            ) {
              window.setTimeout(() => setShowBioPrompt(true), 450);
            }
          }}
        />
      ) : (
        <AppShell
          activeTab={activeTab}
          onSelectTab={handleSelectNavTab}
          teamName={data.settings.team_name}
          staffName={staffData.group.name}
          userDisplayName={currentAccount.displayName}
          userColor={currentAccount.color}
          syncState={data.syncState}
          openMancantiCount={openMancantiCount}
          openStaffMancantiCount={openStaffMancantiCount}
          canUndo={data.canUndo}
          undoCount={data.undoCount}
          lastUndoLabel={data.lastUndoLabel}
          onUndo={data.undo}
          isDark={isDark}
          onToggleTheme={() => setPreference(isDark ? 'light' : 'dark')}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNewEvent={() => setNewEventOpen(true)}
        >
          {data.loading && data.events.length === 0 ? (
            <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
              <div
                className="h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
              />
              <span className="text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
                Caricamento serate dal cloud…
              </span>
            </div>
          ) : (
            <>
              {activeTab === 'events' && (
                <EventWorkspace
                  events={data.events}
                  summaries={data.summaries}
                  selectedEventId={selectedEventId}
                  onSelectEvent={setSelectedEventId}
                  settings={data.settings}
                  promoters={data.promoters}
                  venues={data.venues}
                  ownerPromoterId={ownerPromoterId}
                  staffGroupName={staffData.group.name}
                  staffSummariesByEvent={staffData.summariesByEvent}
                  staffMembers={staffData.members}
                  staffMemberUsageScore={staffData.memberUsageScore}
                  staffTableByEventTableId={staffData.staffTableByEventTableId}
                  canUndo={data.canUndo}
                  canRedo={data.canRedo}
                  lastUndoLabel={data.lastUndoLabel}
                  lastRedoLabel={data.lastRedoLabel}
                  onUndo={data.undo}
                  onRedo={data.redo}
                  onOpenNewEvent={() => setNewEventOpen(true)}
                  onUpdateEvent={data.updateEvent}
                  onDuplicateEvent={async (ev) => {
                    const created = await data.duplicateEvent(ev);
                    if (created) setSelectedEventId(created.id);
                  }}
                  onDeleteEvent={async (id) => {
                    await data.deleteEvent(id);
                    if (selectedEventId === id) setSelectedEventId(null);
                  }}
                  onUpsertPresale={data.upsertPresale}
                  onUpsertPresalesBatch={data.upsertPresalesBatch}
                  onUpsertReconciliation={data.upsertReconciliation}
                  onUpsertReconciliationsBatch={data.upsertReconciliationsBatch}
                  onAddTable={async (evId, tbl) => {
                    const created = await data.addTable(evId, tbl);
                    if (created) staffData.fetchStaff(true);
                    return created;
                  }}
                  onUpdateTable={async (evId, tblId, patch) => {
                    await data.updateTable(evId, tblId, patch);
                    staffData.fetchStaff(true);
                  }}
                  onDeleteTable={async (evId, tblId) => {
                    await data.deleteTable(evId, tblId);
                    staffData.fetchStaff(true);
                  }}
                  onAssignSubPrToTable={staffData.assignSubPrToEventTable}
                  onQuickCreateStaffMember={(fullName) =>
                    staffData.upsertMember({ full_name: fullName })
                  }
                />
              )}

              <Suspense
                fallback={
                  <div className="min-h-[60vh] flex items-center justify-center">
                    <div
                      className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
                      style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
                    />
                  </div>
                }
              >
                {activeTab === 'staff' && (
                  <StaffWorkspace
                    events={data.events}
                    mainSummaries={data.summaries}
                    ownerPromoterId={ownerPromoterId}
                    staffData={staffData}
                    venues={data.venues}
                    quickTablePrices={data.settings.quick_table_prices}
                    selectedEventId={selectedEventId}
                    onSelectEvent={setSelectedEventId}
                    canUndo={data.canUndo}
                    canRedo={data.canRedo}
                    lastUndoLabel={data.lastUndoLabel}
                    lastRedoLabel={data.lastRedoLabel}
                    onUndo={data.undo}
                    onRedo={data.redo}
                    onOpenNewEvent={() => setNewEventOpen(true)}
                    onOpenCashCollection={(eventId) => {
                      setCashEventId(eventId);
                      setActiveTab('cash');
                    }}
                    onSyncPresalesToMain={async (eventId, quantity, revenue, oneToOne) => {
                      await data.upsertPresalesBatch(
                        eventId,
                        [
                          {
                            promoterId: ownerPromoterId,
                            patch: { quantity, revenue, one_to_one: oneToOne },
                          },
                        ],
                        `Sincronizza preve ${staffData.group.name} su Serata`
                      );
                      toast.success(
                        `Prevendite di ${currentAccount.displayName} aggiornate sulla serata (${quantity} px)`
                      );
                    }}
                  />
                )}

                {activeTab === 'cash' && (
                  <CashCollectionView
                    events={data.events}
                    selectedEventId={cashEventId ?? selectedEventId}
                    onSelectEvent={setCashEventId}
                    staffData={staffData}
                    venues={data.venues}
                    canUndo={data.canUndo}
                    lastUndoLabel={data.lastUndoLabel}
                    onUndo={data.undo}
                    onOpenEventInStaff={(eventId) => {
                      setSelectedEventId(eventId);
                      setActiveTab('staff');
                    }}
                  />
                )}

                {activeTab === 'dashboard' && (
                  <DashboardView
                    events={data.events}
                    summaries={data.summaries}
                    promoters={data.promoters}
                    venues={data.venues}
                    onOpenEvent={handleOpenEventFromAnywhere}
                  />
                )}

                {activeTab === 'ledger' && (
                  <LedgerView
                    events={data.events}
                    summaries={data.summaries}
                    promoters={data.promoters}
                    onOpenEvent={handleOpenEventFromAnywhere}
                    onUpdateEvent={data.updateEvent}
                    onUpsertReconciliationsBatch={data.upsertReconciliationsBatch}
                  />
                )}

                {activeTab === 'settings' && (
                  <SettingsView
                    settings={data.settings}
                    promoters={data.promoters}
                    venues={data.venues}
                    events={data.events}
                    summaries={data.summaries}
                    themePreference={preference}
                    onChangeTheme={setPreference}
                    syncState={data.syncState}
                    userEmail={currentAccount.email}
                    userDisplayName={currentAccount.displayName}
                    userPromoterId={currentAccount.promoterId}
                    onUpdateSettings={data.updateSettings}
                    onUpsertVenue={data.upsertVenue}
                    onUpsertPromoter={data.upsertPromoter}
                    onLockNow={() => {
                      markSessionUnlockedThisVisit(false);
                      setVisitUnlocked(false);
                    }}
                    onSignOut={async () => {
                      markSessionUnlockedThisVisit(false);
                      setVisitUnlocked(false);
                      await supabase.auth.signOut();
                      setSession(null);
                    }}
                  />
                )}
              </Suspense>
            </>
          )}

          {bioCap?.supported && (
            <BiometricSetupModal
              open={showBioPrompt}
              onClose={() => setShowBioPrompt(false)}
              promoterId={currentAccount.promoterId}
              displayName={currentAccount.displayName}
              capability={bioCap}
              onEnrolled={() => setShowBioPrompt(false)}
            />
          )}

          <NewEventModal
            open={newEventOpen}
            onClose={() => setNewEventOpen(false)}
            venues={data.venues}
            defaultListaCost={data.settings.default_lista_cost}
            onSubmit={async (input) => {
              const created = await data.createEvent(input);
              if (created) {
                setSelectedEventId(created.id);
                setActiveTab('events');
              }
            }}
          />

          <SpotlightSearch
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            events={data.events}
            summaries={data.summaries}
            onSelectEvent={handleOpenEventFromAnywhere}
          />
        </AppShell>
      )}
    </>
  );
}
