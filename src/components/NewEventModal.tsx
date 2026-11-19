import React, { useEffect, useState } from 'react';
import { AppleModal, NumericCellInput, SegmentedControl } from './ui/AppleControls';
import type { EventMode, Venue } from '../types';

export function NewEventModal({
  open,
  onClose,
  venues,
  defaultListaCost,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  venues: Venue[];
  defaultListaCost: number;
  onSubmit: (data: {
    title: string;
    venue_id: string | null;
    venue_name: string;
    event_date: string;
    mode: EventMode;
    lista_cost: number;
  }) => Promise<void>;
}) {
  const activeVenues = venues.filter((v) => !v.is_archived);
  const [title, setTitle] = useState('');
  const [venueId, setVenueId] = useState<string>(activeVenues[0]?.id || '');
  const [customVenue, setCustomVenue] = useState('');
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<EventMode>('NO OSPITE');
  const [listaCost, setListaCost] = useState<number>(defaultListaCost);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setEventDate(new Date().toISOString().slice(0, 10));
    const first = activeVenues[0];
    if (first) {
      setVenueId(first.id);
      setMode(first.default_mode || 'NO OSPITE');
      setListaCost(first.default_lista_cost || defaultListaCost);
    } else {
      setVenueId('__custom__');
      setMode('NO OSPITE');
      setListaCost(defaultListaCost);
    }
    setCustomVenue('');
  }, [open]);

  const handleVenueSelect = (id: string) => {
    setVenueId(id);
    const v = activeVenues.find((x) => x.id === id);
    if (v) {
      setMode(v.default_mode);
      setListaCost(v.default_lista_cost || defaultListaCost);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedVenue = activeVenues.find((v) => v.id === venueId);
    const finalVenueName =
      venueId === '__custom__' ? customVenue.trim() || 'Locale' : selectedVenue?.name || 'Locale';
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        venue_id: selectedVenue?.id ?? null,
        venue_name: finalVenueName,
        event_date: eventDate,
        mode,
        lista_cost: listaCost,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppleModal
      open={open}
      onClose={onClose}
      title="Nuova serata"
      subtitle="Imposta locale, data e modalità di calcolo busta."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="new-ev-title"
            className="block text-[13px] font-medium mb-1.5"
            style={{ color: 'var(--ink-secondary)' }}
          >
            Nome serata
          </label>
          <input
            id="new-ev-title"
            name="eventTitle"
            type="text"
            required
            autoComplete="off"
            placeholder="Es. Opening, Halloween, Grey Goose…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="apple-input w-full rounded-[10px] px-3 py-2.5 text-[15px]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="new-ev-venue"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Locale
            </label>
            <select
              id="new-ev-venue"
              value={venueId}
              onChange={(e) => handleVenueSelect(e.target.value)}
              className="apple-input w-full rounded-[10px] px-3 py-2.5 text-[15px]"
            >
              {activeVenues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
              <option value="__custom__">Altro locale…</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="new-ev-date"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Data serata
            </label>
            <input
              id="new-ev-date"
              type="date"
              required
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="apple-input w-full rounded-[10px] px-3 py-2.5 text-[15px] tabular-nums"
            />
          </div>
        </div>

        {venueId === '__custom__' && (
          <div>
            <label
              htmlFor="new-ev-custom-venue"
              className="block text-[13px] font-medium mb-1.5"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Nome nuovo locale
            </label>
            <input
              id="new-ev-custom-venue"
              type="text"
              required
              placeholder="Es. Cocoricò, Villa delle Rose…"
              value={customVenue}
              onChange={(e) => setCustomVenue(e.target.value)}
              className="apple-input w-full rounded-[10px] px-3 py-2.5 text-[15px]"
            />
          </div>
        )}

        <div>
          <span
            className="block text-[13px] font-medium mb-1.5"
            style={{ color: 'var(--ink-secondary)' }}
          >
            Modalità serata (provvigione tavoli)
          </span>
          <SegmentedControl<EventMode>
            ariaLabel="Modalità serata"
            value={mode}
            onChange={setMode}
            className="w-full"
            options={[
              { value: 'NO OSPITE', label: 'No ospite (10%)' },
              { value: 'OSPITE', label: 'Ospite (8%)' },
              { value: '-', label: 'Disattivata' },
            ]}
          />
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <div>
            <span className="block text-[14px] font-medium">Costo lista PR (€ / px)</span>
            <span className="block text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
              Lascia 0 se non applicato in questa serata
            </span>
          </div>
          <NumericCellInput
            value={listaCost}
            onCommit={setListaCost}
            prefix="€"
            ariaLabel="Costo lista PR"
            className="w-28"
          />
        </div>

        <div
          className="flex items-center justify-end gap-2.5 pt-4 mt-2"
          style={{ borderTop: '0.5px solid var(--separator)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] px-4 py-2 text-[14px] font-medium apple-press cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-surface-secondary)',
              color: 'var(--ink-primary)',
            }}
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="rounded-[10px] px-5 py-2 text-[14px] font-semibold text-white apple-press cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {submitting ? 'Creazione…' : 'Crea serata'}
          </button>
        </div>
      </form>
    </AppleModal>
  );
}
