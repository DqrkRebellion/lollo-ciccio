import type { EventRecord } from '../types';

const ITALY_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns the YYYY-MM-DD cutoff date for active nightlife events in Italy (Europe/Rome).
 * Uses a 06:00 AM rollover so an event running late into the night (e.g. 00:00–05:59)
 * stays classified as "Attiva" until the morning after.
 */
export function getActiveEventCutoffIso(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return ITALY_DATE_FMT.format(shifted);
}

/**
 * True when the event date is today's active club night or in the future.
 * Deterministic and shared identically across all team profiles.
 */
export function isEventActive(
  event: Pick<EventRecord, 'event_date'>,
  cutoffIso: string = getActiveEventCutoffIso()
): boolean {
  return Boolean(event.event_date) && event.event_date >= cutoffIso;
}

/**
 * Splits events exclusively into:
 * - active: today / upcoming, sorted nearest first (ascending date)
 * - past: finished nights, sorted most recent first (descending date)
 */
export function splitActiveAndPastEvents<T extends Pick<EventRecord, 'event_date'>>(
  events: T[],
  now: Date = new Date()
): { active: T[]; past: T[]; cutoffIso: string } {
  const cutoffIso = getActiveEventCutoffIso(now);
  const active: T[] = [];
  const past: T[] = [];

  for (const ev of events) {
    if (isEventActive(ev, cutoffIso)) {
      active.push(ev);
    } else {
      past.push(ev);
    }
  }

  active.sort((a, b) => a.event_date.localeCompare(b.event_date));
  past.sort((a, b) => b.event_date.localeCompare(a.event_date));

  return { active, past, cutoffIso };
}
