import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Search, Sparkles, X } from 'lucide-react';
import { APPLE_SPRING_SNAPPY } from './ui/AppleControls';
import { formatDateShort, formatEur } from '../lib/format';
import type { EventSummary, FullEvent } from '../types';

export function SpotlightSearch({
  open,
  onClose,
  events,
  summaries,
  onSelectEvent,
}: {
  open: boolean;
  onClose: () => void;
  events: FullEvent[];
  summaries: Map<string, EventSummary>;
  onSelectEvent: (eventId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events.slice(0, 8);
    return events
      .filter((ev) => {
        if (ev.title.toLowerCase().includes(q)) return true;
        if (ev.venue_name.toLowerCase().includes(q)) return true;
        if (ev.event_date.includes(q)) return true;
        if (ev.tables.some((t) => t.table_name.toLowerCase().includes(q))) return true;
        return false;
      })
      .slice(0, 12);
  }, [events, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(results.length - 1, c + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === 'Enter' && results[cursor]) {
        e.preventDefault();
        onSelectEvent(results[cursor].id);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      if (window.scrollX !== 0) {
        window.scrollTo({ left: 0, top: window.scrollY });
      }
    };
  }, [open, results, cursor, onSelectEvent, onClose]);

  const content = (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[max(12vh,calc(env(safe-area-inset-top)+16px))] px-4 overflow-x-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Ricerca rapida serate e tavoli"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-[4px]"
          />
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={APPLE_SPRING_SNAPPY}
            className="relative z-10 w-full max-w-[560px] rounded-[18px] overflow-hidden overscroll-contain"
            style={{
              backgroundColor: 'var(--bg-chrome-elevated)',
              backdropFilter: 'blur(28px) saturate(180%)',
              WebkitBackdropFilter: 'blur(28px) saturate(180%)',
              boxShadow: 'var(--shadow-floating)',
            }}
          >
            <div
              className="flex items-center gap-3 px-4 py-3.5"
              style={{ borderBottom: '0.5px solid var(--separator)' }}
            >
              <Search className="h-5 w-5 shrink-0" style={{ color: 'var(--ink-secondary)' }} aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca serata, locale o nome tavolo…"
                className="flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--ink-tertiary)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Svuota ricerca"
                  className="p-1 rounded-full cursor-pointer"
                  style={{ color: 'var(--ink-tertiary)' }}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <kbd
                className="hidden sm:inline-block rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface-secondary)',
                  color: 'var(--ink-secondary)',
                }}
              >
                ESC
              </kbd>
            </div>

            <div className="max-h-[55vh] overflow-y-auto py-1.5">
              {results.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Sparkles className="h-6 w-6 mx-auto mb-2" style={{ color: 'var(--ink-tertiary)' }} aria-hidden="true" />
                  <p className="text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
                    Nessun risultato per “{query}”
                  </p>
                </div>
              ) : (
                results.map((ev, idx) => {
                  const s = summaries.get(ev.id);
                  const active = idx === cursor;
                  const matchingTable = query.trim()
                    ? ev.tables.find((t) =>
                        t.table_name.toLowerCase().includes(query.trim().toLowerCase())
                      )
                    : null;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => {
                        onSelectEvent(ev.id);
                        onClose();
                      }}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer"
                      style={{
                        backgroundColor: active ? 'var(--bg-active)' : 'transparent',
                      }}
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <Calendar
                          className="h-4 w-4 shrink-0"
                          style={{ color: active ? 'var(--accent)' : 'var(--ink-tertiary)' }}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-semibold truncate">{ev.title}</span>
                            <span
                              className="text-[12px] font-medium shrink-0"
                              style={{ color: 'var(--ink-secondary)' }}
                            >
                              {ev.venue_name}
                            </span>
                          </div>
                          <div className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
                            {formatDateShort(ev.event_date)}
                            {matchingTable ? ` · Tavolo “${matchingTable.table_name}”` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-[13px] font-semibold">{formatEur(s?.revenueTotal ?? 0)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                          {s?.pxTotal ?? 0} px · Busta {formatEur(s?.bustaTotal ?? 0)}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}
