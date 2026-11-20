import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, UserPlus, X } from 'lucide-react';
import { AppleModal } from './AppleControls';
import type { StaffMember } from '../../types/staff';

function memberDisplayName(m: StaffMember): string {
  return m.nickname?.trim() || m.full_name;
}

export function StaffMemberPicker({
  members,
  selectedMemberId,
  onSelect,
  onQuickCreate,
  prioritizedIds = [],
  usageScores,
  compact = false,
  autoFocusSearch = false,
}: {
  members: StaffMember[];
  selectedMemberId: string | null;
  onSelect: (member: StaffMember) => void;
  onQuickCreate?: (fullName: string) => Promise<StaffMember | null>;
  prioritizedIds?: string[];
  usageScores?: Map<string, number>;
  compact?: boolean;
  autoFocusSearch?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeMembers = useMemo(
    () => members.filter((m) => m.is_active),
    [members]
  );

  const prioritizedSet = useMemo(() => new Set(prioritizedIds), [prioritizedIds]);

  // Top quick-pick chips: in-event PRs first, then most frequent, then Io
  const quickChips = useMemo(() => {
    const scored = activeMembers.map((m) => {
      const inEventBoost = prioritizedSet.has(m.id) ? 1000 : 0;
      const freqBoost = usageScores?.get(m.id) || 0;
      const selfBoost = m.is_self ? 5 : 0;
      const selectedBoost = m.id === selectedMemberId ? 2000 : 0;
      return { m, score: selectedBoost + inEventBoost + freqBoost + selfBoost };
    });
    scored.sort((a, b) => b.score - a.score || memberDisplayName(a.m).localeCompare(memberDisplayName(b.m)));
    return scored.slice(0, compact ? 8 : 10).map((x) => x.m);
  }, [activeMembers, prioritizedSet, usageScores, selectedMemberId, compact]);

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (!showAll) return [];
      return [...activeMembers].sort((a, b) =>
        memberDisplayName(a).localeCompare(memberDisplayName(b))
      );
    }
    return activeMembers
      .filter((m) => {
        if (m.full_name.toLowerCase().includes(q)) return true;
        if (m.nickname && m.nickname.toLowerCase().includes(q)) return true;
        if (m.aliases.some((a) => a.toLowerCase().includes(q))) return true;
        return false;
      })
      .sort((a, b) => {
        const aNick = memberDisplayName(a).toLowerCase();
        const bNick = memberDisplayName(b).toLowerCase();
        const aStarts = aNick.startsWith(q) || a.full_name.toLowerCase().startsWith(q) ? 1 : 0;
        const bStarts = bNick.startsWith(q) || b.full_name.toLowerCase().startsWith(q) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        return (usageScores?.get(b.id) || 0) - (usageScores?.get(a.id) || 0);
      });
  }, [activeMembers, query, showAll, usageScores]);

  const exactExists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return activeMembers.some(
      (m) =>
        m.full_name.toLowerCase() === q ||
        m.nickname.toLowerCase() === q ||
        m.aliases.some((a) => a.toLowerCase() === q)
    );
  }, [activeMembers, query]);

  const handleCreate = async () => {
    const name = query.trim();
    if (!name || !onQuickCreate || creating) return;
    setCreating(true);
    try {
      const created = await onQuickCreate(name);
      if (created) {
        onSelect(created);
        setQuery('');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Quick-Tap Chips */}
      {quickChips.length > 0 && !query.trim() && (
        <div className="flex flex-wrap gap-1.5">
          {quickChips.map((m) => {
            const active = m.id === selectedMemberId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(m)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold apple-press cursor-pointer transition-colors"
                style={{
                  backgroundColor: active ? 'var(--accent)' : 'var(--bg-surface-secondary)',
                  color: active ? '#FFFFFF' : 'var(--ink-primary)',
                }}
              >
                {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{memberDisplayName(m)}</span>
              </button>
            );
          })}
          {activeMembers.length > quickChips.length && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium apple-press cursor-pointer transition-colors"
              style={{
                backgroundColor: showAll ? 'var(--accent-subtle)' : 'transparent',
                color: 'var(--accent)',
                border: '0.5px solid var(--separator-strong)',
              }}
            >
              {showAll ? 'Chiudi elenco' : `Tutti (${activeMembers.length})`}
            </button>
          )}
        </div>
      )}

      {/* Instant Live Search */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: 'var(--ink-tertiary)' }}
          aria-hidden="true"
        />
        <input
          ref={searchInputRef}
          type="text"
          autoFocus={autoFocusSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca PR per nome o soprannome…"
          aria-label="Cerca sotto-PR"
          className="apple-input w-full rounded-[10px] pl-9 pr-8 py-2 text-[16px] md:text-[14px]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Svuota ricerca PR"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 cursor-pointer"
            style={{ color: 'var(--ink-tertiary)' }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Matching Results List or Full List */}
      {(query.trim() !== '' || showAll) && (
        <div
          className="rounded-[12px] max-h-[210px] overflow-y-auto divide-y"
          style={{
            backgroundColor: 'var(--bg-surface-secondary)',
            borderColor: 'var(--separator)',
          }}
        >
          {filteredList.map((m) => {
            const active = m.id === selectedMemberId;
            const nick = memberDisplayName(m);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m);
                  setQuery('');
                  setShowAll(false);
                }}
                className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left apple-press cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{
                      backgroundColor: active ? 'var(--accent)' : 'var(--bg-surface)',
                      color: active ? '#FFFFFF' : 'var(--ink-primary)',
                    }}
                  >
                    {nick.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold truncate">{nick}</div>
                    {m.full_name.toLowerCase() !== nick.toLowerCase() && (
                      <div className="text-[11px] truncate" style={{ color: 'var(--ink-secondary)' }}>
                        {m.full_name}
                      </div>
                    )}
                  </div>
                </div>
                {active && (
                  <Check className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                )}
              </button>
            );
          })}

          {query.trim() !== '' && !exactExists && onQuickCreate && (
            <button
              type="button"
              disabled={creating}
              onClick={handleCreate}
              className="w-full px-3 py-2.5 flex items-center gap-2 text-left text-[13px] font-semibold apple-press cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{creating ? 'Creazione…' : `Crea nuovo PR “${query.trim()}”`}</span>
            </button>
          )}

          {filteredList.length === 0 && (!onQuickCreate || exactExists) && (
            <div className="px-3 py-4 text-center text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              Nessun PR trovato.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact clickable PR pill that opens an instant Apple sheet/modal to switch a table's PR in 1 tap.
 */
export function StaffMemberPickerButton({
  members,
  selectedMemberId,
  fallbackName,
  onSelect,
  onQuickCreate,
  prioritizedIds,
  usageScores,
  subtitle,
  variant = 'accent',
}: {
  members: StaffMember[];
  selectedMemberId: string | null;
  fallbackName: string;
  onSelect: (member: StaffMember) => void;
  onQuickCreate?: (fullName: string) => Promise<StaffMember | null>;
  prioritizedIds?: string[];
  usageScores?: Map<string, number>;
  subtitle?: string;
  variant?: 'accent' | 'subtle';
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => (selectedMemberId ? members.find((m) => m.id === selectedMemberId) : undefined),
    [members, selectedMemberId]
  );
  const label = selected ? memberDisplayName(selected) : fallbackName || 'Assegna PR';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Tocca per cambiare sotto-PR"
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold apple-press cursor-pointer transition-colors max-w-full"
        style={
          variant === 'accent'
            ? {
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent)',
              }
            : {
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--ink-primary)',
              }
        }
      >
        <span className="truncate max-w-[120px]">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-75" aria-hidden="true" />
      </button>

      <AppleModal
        open={open}
        onClose={() => setOpen(false)}
        title="Seleziona sotto-PR"
        subtitle={subtitle || 'Tocca un PR rapido o cerca per nome / soprannome'}
        maxWidth="max-w-[460px]"
      >
        <StaffMemberPicker
          members={members}
          selectedMemberId={selectedMemberId}
          prioritizedIds={prioritizedIds}
          usageScores={usageScores}
          autoFocusSearch={false}
          onQuickCreate={onQuickCreate}
          onSelect={(m) => {
            onSelect(m);
            setOpen(false);
          }}
        />
      </AppleModal>
    </>
  );
}
