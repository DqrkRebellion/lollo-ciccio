import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://my.ticketsms.it',
  'https://dqrkrebellion.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://dqrkrebellion.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseMoney(raw: string | null | undefined): number {
  let cleaned = (raw || '')
    .replace(/&euro;|€/gi, '')
    .replace(/\u00a0/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? round2(n) : 0;
}

function parseIntSafe(raw: string | null | undefined): number {
  const cleaned = (raw || '').replace(/[.,\s]/g, '');
  const m = cleaned.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function normText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normCompact(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

interface ParsedCsvRow {
  promoter_name: string;
  ticket_type: string;
  price: number;
  online_qty: number;
  online_revenue: number;
  one_to_one_qty: number;
  one_to_one_revenue: number;
  box_office_qty: number;
  box_office_revenue: number;
  total_qty: number;
  total_revenue: number;
  row_order: number;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseEventReportCsv(rawText: string): ParsedCsvRow[] {
  const text = (rawText || '').replace(/^\uFEFF/, '');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const first = lines[0];
  const delimiter = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rawRows = lines
    .map((l) => parseDelimitedLine(l, delimiter))
    .filter((row) => row.some((c) => c.trim().length > 0));
  if (rawRows.length === 0) return [];

  const headerLower = rawRows[0].map((c) => c.trim().toLowerCase());
  const hasHeader = headerLower.some((h) =>
    ['promoter', 'tipologia', 'incasso', 'one to one', 'online'].some((k) => h.includes(k))
  );

  const colMap = {
    promoter: 0,
    ticket_type: 1,
    price: 2,
    online_qty: 3,
    online_rev: 4,
    oto_qty: 5,
    oto_rev: 6,
    box_qty: 7,
    box_rev: 8,
    tot_qty: 9,
    tot_rev: 10,
  };

  if (hasHeader) {
    headerLower.forEach((h, idx) => {
      if (h === 'promoter') colMap.promoter = idx;
      else if (h.includes('tipologia')) colMap.ticket_type = idx;
      else if (h.includes('prezzo')) colMap.price = idx;
      else if (h === 'online') colMap.online_qty = idx;
      else if (h.includes('incasso') && h.includes('online')) colMap.online_rev = idx;
      else if (h === 'one to one' || h === 'one-to-one' || h === '1to1') colMap.oto_qty = idx;
      else if (
        h.includes('incasso') &&
        (h.includes('one to one') || h.includes('one-to-one') || h.includes('1to1'))
      ) {
        colMap.oto_rev = idx;
      } else if (h === 'cassa') colMap.box_qty = idx;
      else if (h.includes('incasso') && h.includes('cassa')) colMap.box_rev = idx;
      else if (h === 'totale') colMap.tot_qty = idx;
      else if (h === 'incasso') colMap.tot_rev = idx;
    });
  }

  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  const cell = (row: string[], idx: number) => (idx < row.length ? row[idx].trim() : '');

  const rowsByKey = new Map<string, ParsedCsvRow>();
  const orderedKeys: string[] = [];

  for (const row of dataRows) {
    if (row.length < 4) continue;
    const promoter = cell(row, colMap.promoter).replace(/\s+/g, ' ').trim();
    const ticketType = cell(row, colMap.ticket_type).replace(/\s+/g, ' ').trim();
    if (!promoter || promoter.toLowerCase() === 'promoter' || promoter.toLowerCase() === 'totale') {
      continue;
    }

    const price = parseMoney(cell(row, colMap.price));
    const onlineQty = parseIntSafe(cell(row, colMap.online_qty));
    const onlineRev = parseMoney(cell(row, colMap.online_rev));
    const otoQty = parseIntSafe(cell(row, colMap.oto_qty));
    const otoRev = parseMoney(cell(row, colMap.oto_rev));
    const boxQty = parseIntSafe(cell(row, colMap.box_qty));
    const boxRev = parseMoney(cell(row, colMap.box_rev));

    const rawTotQty = cell(row, colMap.tot_qty);
    const rawTotRev = cell(row, colMap.tot_rev);
    const totQty = rawTotQty ? parseIntSafe(rawTotQty) : onlineQty + otoQty + boxQty;
    const totRev = rawTotRev ? parseMoney(rawTotRev) : round2(onlineRev + otoRev + boxRev);

    const key = `${promoter}\u0000${ticketType}\u0000${price.toFixed(2)}`;
    const prev = rowsByKey.get(key);
    if (prev) {
      prev.online_qty += onlineQty;
      prev.online_revenue = round2(prev.online_revenue + onlineRev);
      prev.one_to_one_qty += otoQty;
      prev.one_to_one_revenue = round2(prev.one_to_one_revenue + otoRev);
      prev.box_office_qty += boxQty;
      prev.box_office_revenue = round2(prev.box_office_revenue + boxRev);
      prev.total_qty += totQty;
      prev.total_revenue = round2(prev.total_revenue + totRev);
    } else {
      orderedKeys.push(key);
      rowsByKey.set(key, {
        promoter_name: promoter,
        ticket_type: ticketType,
        price,
        online_qty: onlineQty,
        online_revenue: onlineRev,
        one_to_one_qty: otoQty,
        one_to_one_revenue: otoRev,
        box_office_qty: boxQty,
        box_office_revenue: boxRev,
        total_qty: totQty,
        total_revenue: totRev,
        row_order: orderedKeys.length - 1,
      });
    }
  }

  return orderedKeys.map((k) => rowsByKey.get(k)!);
}

interface VenueRow {
  id: string;
  name: string;
  default_mode: string | null;
  default_lista_cost: number | null;
}

function resolveVenueForTicketSms(
  evName: string,
  locationName: string,
  locationFull: string | null,
  venues: VenueRow[]
): { venueId: string | null; venueName: string; mode: string; listaCost: number } {
  const byLower = new Map<string, VenueRow>();
  for (const v of venues) {
    byLower.set(String(v.name || '').trim().toLowerCase(), v);
  }

  const pick = (targetLower: string) => {
    const v = byLower.get(targetLower);
    if (!v) return null;
    return {
      venueId: String(v.id),
      venueName: String(v.name),
      mode: String(v.default_mode || 'NO OSPITE'),
      listaCost: Number(v.default_lista_cost || 0),
    };
  };

  const nameLow = (evName || '').toLowerCase();
  const locLow = `${locationName || ''} ${locationFull || ''}`.toLowerCase();
  const bothLow = `${nameLow} ${locLow}`;

  if (bothLow.includes('tpf') || bothLow.includes('ti porto fuori') || locLow.includes('kojak')) {
    const h = pick('tpf');
    if (h) return h;
  }
  if (nameLow.includes('capcreus') || nameLow.includes('cap creus')) {
    const h = pick('capcreus');
    if (h) return h;
  }
  if (bothLow.includes('million')) {
    const h = pick('million');
    if (h) return h;
  }
  if (locLow.includes('capcreus') || locLow.includes('cap creus')) {
    const h = pick('capcreus');
    if (h) return h;
  }
  if (nameLow.includes('matilda')) {
    const h = pick('matilda');
    if (h) return h;
  }
  if (bothLow.includes('touchè') || bothLow.includes('touche')) {
    const h = pick('touchè') || pick('touche');
    if (h) return h;
  }
  if (locLow.includes('matilda')) {
    const h = pick('matilda');
    if (h) return h;
  }
  if (bothLow.includes('vie en rose')) {
    const h = pick('la vie en rose');
    if (h) return h;
  }
  if (bothLow.includes('santaf')) {
    const h = pick('santafè') || pick('santafe');
    if (h) return h;
  }
  if (bothLow.includes('marina bay')) {
    const h = pick('marina bay');
    if (h) return h;
  }
  if (bothLow.includes('eden')) {
    const h = pick('eden');
    if (h) return h;
  }
  if (bothLow.includes('astoria')) {
    const h = pick('astoria');
    if (h) return h;
  }

  for (const v of venues) {
    const vname = String(v.name || '').trim();
    if (vname && bothLow.includes(vname.toLowerCase())) {
      return {
        venueId: String(v.id),
        venueName: vname,
        mode: String(v.default_mode || 'NO OSPITE'),
        listaCost: Number(v.default_lista_cost || 0),
      };
    }
  }

  return {
    venueId: null,
    venueName: (locationName || '').trim() || 'TicketSMS',
    mode: 'NO OSPITE',
    listaCost: 0,
  };
}

interface StaffMemberRow {
  id: string;
  full_name: string;
  nickname: string | null;
  aliases: string[] | null;
  is_self: boolean;
  plan_id: string | null;
}

function matchStaffMember(rawName: string, members: StaffMemberRow[]): StaffMemberRow | null {
  const clean = (rawName || '').trim().toLowerCase();
  if (!clean) return null;

  if (clean === 'io' || clean === 'me' || clean.startsWith('io (')) {
    const selfM = members.find((m) => m.is_self);
    if (selfM) return selfM;
  }

  for (const m of members) {
    if (String(m.full_name || '').trim().toLowerCase() === clean) return m;
    const nick = String(m.nickname || '').trim().toLowerCase();
    if (nick && nick === clean) return m;
    const aliases = Array.isArray(m.aliases) ? m.aliases : [];
    if (aliases.some((a) => String(a).trim().toLowerCase() === clean)) return m;
  }

  return null;
}

function buildIosShortcutScript(endpointUrl: string, syncKey: string): string {
  // Self-contained JavaScript for Apple iOS Shortcuts -> "Esegui JavaScript su pagina web"
  // Runs directly inside Safari on https://my.ticketsms.it using Safari's logged-in session!
  return `(async () => {
  const ENDPOINT = ${JSON.stringify(endpointUrl)};
  const SYNC_KEY = ${JSON.stringify(syncKey)};
  let done = false;
  const finish = (msg) => {
    if (!done) {
      done = true;
      completion(String(msg));
    }
  };

  try {
    if (location.hostname !== 'my.ticketsms.it') {
      return finish('⚠️ Apri prima https://my.ticketsms.it su Safari e riprova.');
    }

    const parseMoney = (raw) => {
      let s = (raw || '').replace(/[€\\u00a0\\s]/g, '');
      if (s.includes(',') && s.includes('.')) s = s.replace(/\\./g, '').replace(',', '.');
      else if (s.includes(',')) s = s.replace(',', '.');
      const m = s.match(/-?\\d+(?:\\.\\d+)?/);
      return m ? Math.round(parseFloat(m[0]) * 100) / 100 : 0;
    };
    const parseIntSafe = (raw) => {
      const m = (raw || '').replace(/[.,\\s]/g, '').match(/-?\\d+/);
      return m ? parseInt(m[0], 10) : 0;
    };
    const parseSoldEntered = (raw) => {
      const p = (raw || '').split('/');
      return p.length === 2 ? [parseIntSafe(p[0]), parseIntSafe(p[1])] : [parseIntSafe(raw), 0];
    };
    const extractEid = (link) => {
      const m = String(link || '').match(/eid=(\\d+)/);
      return m ? parseInt(m[1], 10) : null;
    };

    const fetchEventsList = async (includeTerminated, maxPages) => {
      const out = [];
      for (let page = 1; page <= maxPages; page++) {
        const res = await fetch(
          '/ajax/event/listEvents.php?includeTerminated=' + includeTerminated + '&page=' + page,
          { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }
        );
        if (res.url && res.url.toLowerCase().includes('login.php')) {
          throw new Error('Sessione TicketSMS scaduta: fai prima il login su my.ticketsms.it.');
        }
        if (!res.ok) throw new Error('Errore TicketSMS HTTP ' + res.status);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch {
          throw new Error('Sessione TicketSMS scaduta: fai prima il login su my.ticketsms.it.');
        }
        if (!data || !data.result) {
          throw new Error('Risposta TicketSMS non valida (controlla il login).');
        }
        for (const item of data.events || []) {
          const dashLink = item.dashEventLink || (item.actions && item.actions.dashEventLink) || '';
          const eid = extractEid(dashLink);
          if (!eid) continue;
          out.push({
            event_id: eid,
            name: String(item.eventName || '').trim(),
            event_date: String(item.eventDatetime || '').trim(),
            weekday: String(item.eventDateWeekDay || '').trim(),
            month: String(item.eventDateMonth || '').trim(),
            year: String(item.eventDateYear || '').trim(),
            location_name: String(item.eventLocationName || '').trim(),
            cover_image_url: item.eventCoverImageUrl || null,
            dash_url: dashLink,
            shop_url: (item.actions && item.actions.shopButtonLink) || null,
            is_active: !includeTerminated,
            is_canceled: Boolean(item.isEventCanceled),
            is_approved: item.isEventApproved !== false,
            is_admin: Boolean(item.isUserEventAdmin),
          });
        }
        if (data.isLastPage !== false) break;
      }
      return out;
    };

    const parseDashHtml = (htmlText) => {
      const doc = new DOMParser().parseFromString(htmlText, 'text/html');
      let location_full = null;
      const navLi = doc.querySelector('.event-navigation-bar .page-breadcrumb li');
      if (navLi) {
        location_full = navLi.textContent.replace(/\\s+/g, ' ').trim().replace(/^presso\\s+/i, '').trim() || null;
      }

      let tickets_sent = 0, total_profit = 0, entered = 0, time_to_end = null;
      doc.querySelectorAll('.dashboard-stat').forEach((stat) => {
        const numEl = stat.querySelector('.details .number');
        const descEl = stat.querySelector('.details .desc');
        if (!numEl || !descEl) return;
        const numTxt = numEl.textContent.replace(/\\s+/g, ' ').trim();
        const descTxt = descEl.textContent.replace(/\\s+/g, ' ').trim().toLowerCase();
        if (descTxt.includes('ticket') || descTxt.includes('bigliett') || descTxt.includes('inviat')) {
          tickets_sent = parseIntSafe(numTxt);
        } else if (descTxt.includes('profitto') || descTxt.includes('incasso') || descTxt.includes('totale')) {
          total_profit = parseMoney(numTxt);
        } else if (descTxt.includes('entrat')) {
          entered = parseIntSafe(numTxt);
        } else if (descTxt.includes('fine') || descTxt.includes('vendita')) {
          time_to_end = numTxt;
        }
      });

      const ticket_types = [];
      const byClass = {};
      const repDiv = doc.querySelector('#printTableReport');
      if (repDiv) {
        repDiv.querySelectorAll('tbody tr').forEach((tr) => {
          const classes = Array.from(tr.classList || []);
          const detailCls = classes.find((c) => c.startsWith('typeTicket'));
          const tds = tr.querySelectorAll('td');
          if (detailCls && byClass[detailCls]) {
            if (tds.length >= 5) {
              const label = tds[2].textContent.replace(/\\s+/g, ' ').trim().toLowerCase();
              const qty = parseIntSafe(tds[3].textContent);
              const amt = parseMoney(tds[4].textContent);
              const t = byClass[detailCls];
              if (label.includes('online')) { t.online_sold = qty; t.online_total = amt; }
              else if (label.includes('one to one')) { t.one_to_one_sold = qty; t.one_to_one_total = amt; }
              else if (label.includes('cassa')) { t.box_office_sold = qty; t.box_office_total = amt; }
            }
            return;
          }
          if (tds.length < 5) return;
          const firstTxt = tds[0].textContent.replace(/\\s+/g, ' ').trim();
          if (firstTxt.toUpperCase().startsWith('TOTALE')) return;
          let tid = null, clsKey = null;
          const link = tds[0].querySelector('a[onclick]');
          if (link) {
            const m = (link.getAttribute('onclick') || '').match(/typeTicket(\\d+)/);
            if (m) { tid = parseInt(m[1], 10); clsKey = 'typeTicket' + tid; }
          }
          const bTag = tds[0].querySelector('b');
          const [sold, ent] = parseSoldEntered(tds[3].textContent);
          const tt = {
            ticket_type_id: tid,
            name: bTag ? bTag.textContent.trim() : firstTxt,
            description: tds[1].textContent.replace(/\\s+/g, ' ').trim(),
            price: parseMoney(tds[2].textContent),
            sold,
            entered: ent,
            total: parseMoney(tds[4].textContent),
            online_sold: 0, online_total: 0,
            one_to_one_sold: 0, one_to_one_total: 0,
            box_office_sold: 0, box_office_total: 0,
          };
          ticket_types.push(tt);
          if (clsKey) byClass[clsKey] = tt;
        });
      }

      const team_sales = [];
      const totCell = doc.querySelector('#totIncasso');
      const teamTbl = totCell ? totCell.closest('table') : null;
      if (teamTbl) {
        teamTbl.querySelectorAll('tbody tr').forEach((tr) => {
          const tds = tr.querySelectorAll('td');
          if (tds.length < 3 || tds[2].id === 'totIncasso') return;
          const fullTxt = tds[0].textContent.replace(/\\s+/g, ' ').trim();
          if (fullTxt.toUpperCase() === 'TOTALE') return;
          let pr_id = null, pr_name = fullTxt;
          const a = tds[0].querySelector('a[href]');
          if (a) {
            const mp = (a.getAttribute('href') || '').match(/pid=(\\d+)/);
            if (mp) pr_id = parseInt(mp[1], 10);
            pr_name = a.textContent.replace(/\\s+/g, ' ').trim();
          }
          const ms = fullTxt.match(/\\(\\s*\\+\\s*(\\d+)\\s*PR\\s*\\)/i);
          const [sold, ent] = parseSoldEntered(tds[1].textContent);
          team_sales.push({
            pr_id,
            pr_name,
            sub_pr_count: ms ? parseInt(ms[1], 10) : 0,
            is_self: pr_id === null && (pr_name.toLowerCase() === 'io' || pr_name.toLowerCase() === 'me'),
            sold,
            entered: ent,
            total: parseMoney(tds[2].textContent),
          });
        });
      }

      return { tickets_sent, total_profit, entered, time_to_end, location_full, ticket_types, team_sales };
    };

    const decodeCsv = (buf) => {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        return new TextDecoder('iso-8859-1').decode(buf);
      }
    };

    const activeEvents = await fetchEventsList(false, 5);
    const terminatedEvents = await fetchEventsList(true, 1);
    const evMap = new Map();
    for (const ev of activeEvents) evMap.set(ev.event_id, ev);
    for (const ev of terminatedEvents) {
      if (!evMap.has(ev.event_id)) evMap.set(ev.event_id, ev);
    }
    const allEvents = Array.from(evMap.values());

    // Fetch Dashboard + CSV in parallel (4 at a time) so it finishes in ~2s on mobile!
    const enriched = new Array(allEvents.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < allEvents.length) {
        const idx = cursor++;
        const ev = allEvents[idx];
        const [dashRes, csvRes] = await Promise.all([
          fetch('/DashEvent.php?eid=' + ev.event_id, { credentials: 'include' }),
          fetch('/action/csvReportEvent.php?eid=' + ev.event_id, { credentials: 'include' }),
        ]);
        if (
          (dashRes.url && dashRes.url.toLowerCase().includes('login.php')) ||
          (csvRes.url && csvRes.url.toLowerCase().includes('login.php'))
        ) {
          throw new Error('Sessione TicketSMS scaduta: fai prima il login.');
        }
        const dashHtml = dashRes.ok ? await dashRes.text() : '';
        const dash = dashHtml ? parseDashHtml(dashHtml) : null;
        let csv_text = '';
        if (csvRes.ok) {
          const buf = await csvRes.arrayBuffer();
          const decoded = decodeCsv(buf);
          const head = decoded.slice(0, 200).trim().toLowerCase();
          if (!head.startsWith('<!doctype') && !head.startsWith('<html')) {
            csv_text = decoded;
          }
        }
        enriched[idx] = { ...ev, dash, csv_text };
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, allEvents.length)) }, worker));

    const postRes = await fetch(ENDPOINT, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-key': SYNC_KEY,
      },
      body: JSON.stringify({
        source: 'ios_shortcut',
        events: enriched,
      }),
    });

    const out = await postRes.json().catch(() => ({}));
    if (!postRes.ok || !out.ok) {
      throw new Error(out.error || 'Errore sync Gestionale HTTP ' + postRes.status);
    }

    finish('✅ ' + (out.message || 'Dati TicketSMS sincronizzati!'));
  } catch (err) {
    finish('❌ ' + (err && err.message ? err.message : String(err)));
  }
})();`;
}

interface IncomingTicketType {
  ticket_type_id: number | null;
  name: string;
  description?: string;
  price: number;
  sold: number;
  entered: number;
  total: number;
  online_sold?: number;
  online_total?: number;
  one_to_one_sold?: number;
  one_to_one_total?: number;
  box_office_sold?: number;
  box_office_total?: number;
}

interface IncomingTeamSale {
  pr_id: number | null;
  pr_name: string;
  sub_pr_count?: number;
  is_self?: boolean;
  sold: number;
  entered: number;
  total: number;
}

interface IncomingEvent {
  event_id: number;
  name: string;
  event_date?: string;
  weekday?: string;
  month?: string;
  year?: string;
  location_name?: string;
  cover_image_url?: string | null;
  dash_url?: string;
  shop_url?: string | null;
  is_active?: boolean;
  is_canceled?: boolean;
  is_approved?: boolean;
  is_admin?: boolean;
  dash?: {
    tickets_sent?: number;
    total_profit?: number;
    entered?: number;
    time_to_end?: string | null;
    location_full?: string | null;
    ticket_types?: IncomingTicketType[];
    team_sales?: IncomingTeamSale[];
  } | null;
  csv_text?: string;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ingestSecret = (Deno.env.get('TICKETSMS_INGEST_SECRET') || '').trim();

    if (!supabaseUrl || !serviceRoleKey || !ingestSecret) {
      return jsonResponse(
        { error: 'Configurazione server mancante (TICKETSMS_INGEST_SECRET)' },
        500,
        origin
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Payload JSON non valido' }, 400, origin);
    }

    // ------------------------------------------------------------------
    // Action 1: Return personalized iOS Shortcut JS to authenticated Lollo
    // ------------------------------------------------------------------
    if (body.action === 'get_ios_script') {
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!token) {
        return jsonResponse({ error: 'Autenticazione richiesta' }, 401, origin);
      }
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) {
        return jsonResponse({ error: 'Sessione non valida o scaduta' }, 401, origin);
      }
      const metaPromoter = String(userData.user.user_metadata?.promoter_id || '').toLowerCase();
      const userEmail = String(userData.user.email || '').toLowerCase();
      const isLollo =
        metaPromoter === 'lollo' || (!metaPromoter && userEmail.startsWith('lollo@'));
      if (!isLollo) {
        return jsonResponse(
          { error: 'Il Comando Rapido TicketSMS è riservato al profilo Lollo' },
          403,
          origin
        );
      }

      const endpointUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/ingest-ticketsms-sync`;
      const script = buildIosShortcutScript(endpointUrl, ingestSecret);
      return jsonResponse(
        {
          ok: true,
          shortcut_name: 'Aggiorna TicketSMS',
          endpoint_url: endpointUrl,
          script,
        },
        200,
        origin
      );
    }

    // ------------------------------------------------------------------
    // Action 2: Ingest TicketSMS data from iOS Shortcut (Lollo only)
    // ------------------------------------------------------------------
    const providedKey = (req.headers.get('x-sync-key') || '').trim();
    if (!providedKey || !timingSafeEqual(providedKey, ingestSecret)) {
      return jsonResponse({ error: 'Chiave sincronizzazione non valida' }, 401, origin);
    }

    const incomingEvents: IncomingEvent[] = Array.isArray(body.events) ? body.events : [];
    if (incomingEvents.length === 0) {
      return jsonResponse({ error: 'Nessun evento TicketSMS ricevuto' }, 400, origin);
    }

    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);
    const ownerPromoterId = 'lollo';

    // Deduplicate incoming events by event_id
    const eventsById = new Map<number, IncomingEvent>();
    for (const ev of incomingEvents) {
      const eid = Number(ev.event_id);
      if (!Number.isFinite(eid) || eid <= 0) continue;
      eventsById.set(eid, { ...ev, event_id: eid });
    }

    const parsedReportsById = new Map<number, ParsedCsvRow[]>();
    const rawEventRows: Record<string, unknown>[] = [];
    const ticketTypesByKey = new Map<string, Record<string, unknown>>();
    const teamByKey = new Map<string, Record<string, unknown>>();

    let activeEventsCount = 0;

    for (const [eid, ev] of eventsById.entries()) {
      if (ev.is_active) activeEventsCount += 1;
      const dash = ev.dash || null;
      const csvRows = ev.csv_text ? parseEventReportCsv(ev.csv_text) : [];
      parsedReportsById.set(eid, csvRows);

      rawEventRows.push({
        event_id: eid,
        name: String(ev.name || ''),
        event_date: ev.event_date || null,
        weekday: ev.weekday || '',
        month: ev.month || '',
        year: String(ev.year || ''),
        location_name: ev.location_name || '',
        location_full: dash?.location_full || ev.location_name || '',
        cover_image_url: ev.cover_image_url ?? null,
        dash_url: ev.dash_url || '',
        shop_url: ev.shop_url ?? null,
        is_active: Boolean(ev.is_active),
        is_canceled: Boolean(ev.is_canceled),
        is_approved: ev.is_approved !== false,
        is_admin: Boolean(ev.is_admin),
        tickets_sent: Number(dash?.tickets_sent || 0),
        total_profit: round2(Number(dash?.total_profit || 0)),
        entered: Number(dash?.entered || 0),
        time_to_end: dash?.time_to_end ?? null,
        synced_at: nowIso,
      });

      for (const tt of dash?.ticket_types || []) {
        const tKey = `${eid}\u0000${tt.name}`;
        const prev = ticketTypesByKey.get(tKey);
        if (prev) {
          prev.sold = Number(prev.sold) + Number(tt.sold || 0);
          prev.entered = Number(prev.entered) + Number(tt.entered || 0);
          prev.total = round2(Number(prev.total) + Number(tt.total || 0));
          prev.online_sold = Number(prev.online_sold) + Number(tt.online_sold || 0);
          prev.online_total = round2(Number(prev.online_total) + Number(tt.online_total || 0));
          prev.one_to_one_sold = Number(prev.one_to_one_sold) + Number(tt.one_to_one_sold || 0);
          prev.one_to_one_total = round2(
            Number(prev.one_to_one_total) + Number(tt.one_to_one_total || 0)
          );
          prev.box_office_sold = Number(prev.box_office_sold) + Number(tt.box_office_sold || 0);
          prev.box_office_total = round2(
            Number(prev.box_office_total) + Number(tt.box_office_total || 0)
          );
        } else {
          ticketTypesByKey.set(tKey, {
            event_id: eid,
            ticket_type_id: tt.ticket_type_id ?? null,
            name: String(tt.name || ''),
            description: String(tt.description || ''),
            price: round2(Number(tt.price || 0)),
            sold: Number(tt.sold || 0),
            entered: Number(tt.entered || 0),
            total: round2(Number(tt.total || 0)),
            online_sold: Number(tt.online_sold || 0),
            online_total: round2(Number(tt.online_total || 0)),
            one_to_one_sold: Number(tt.one_to_one_sold || 0),
            one_to_one_total: round2(Number(tt.one_to_one_total || 0)),
            box_office_sold: Number(tt.box_office_sold || 0),
            box_office_total: round2(Number(tt.box_office_total || 0)),
            synced_at: nowIso,
          });
        }
      }

      for (const m of dash?.team_sales || []) {
        const mKey = `${eid}\u0000${m.pr_name}`;
        const prev = teamByKey.get(mKey);
        if (prev) {
          prev.sold = Number(prev.sold) + Number(m.sold || 0);
          prev.entered = Number(prev.entered) + Number(m.entered || 0);
          prev.total = round2(Number(prev.total) + Number(m.total || 0));
          prev.sub_pr_count = Math.max(Number(prev.sub_pr_count), Number(m.sub_pr_count || 0));
        } else {
          teamByKey.set(mKey, {
            event_id: eid,
            pr_id: m.pr_id ?? null,
            pr_name: String(m.pr_name || ''),
            sub_pr_count: Number(m.sub_pr_count || 0),
            is_self: Boolean(m.is_self),
            sold: Number(m.sold || 0),
            entered: Number(m.entered || 0),
            total: round2(Number(m.total || 0)),
            synced_at: nowIso,
          });
        }
      }
    }

    // 1. Upsert raw TicketSMS tables
    const { error: evErr } = await admin
      .from('ticketsms_events')
      .upsert(rawEventRows, { onConflict: 'event_id' });
    if (evErr) throw new Error(`ticketsms_events upsert: ${evErr.message}`);

    const ttRows = Array.from(ticketTypesByKey.values());
    if (ttRows.length > 0) {
      const { error: ttErr } = await admin
        .from('ticketsms_ticket_types')
        .upsert(ttRows, { onConflict: 'event_id,name' });
      if (ttErr) throw new Error(`ticketsms_ticket_types upsert: ${ttErr.message}`);
    }

    const teamRows = Array.from(teamByKey.values());
    if (teamRows.length > 0) {
      const { error: teamErr } = await admin
        .from('ticketsms_team_sales')
        .upsert(teamRows, { onConflict: 'event_id,pr_name' });
      if (teamErr) throw new Error(`ticketsms_team_sales upsert: ${teamErr.message}`);
    }

    for (const [eid, rows] of parsedReportsById.entries()) {
      const { error: rpcErr } = await admin.rpc('replace_ticketsms_report_rows', {
        p_event_id: eid,
        p_rows: rows.map((r) => ({ ...r, synced_at: nowIso })),
      });
      if (rpcErr) throw new Error(`replace_ticketsms_report_rows(${eid}): ${rpcErr.message}`);
    }

    // 2. Load app metadata in parallel
    const [venuesRes, settingsRes, promotersRes, appEventsRes, staffMembersRes, staffPlansRes] =
      await Promise.all([
        admin.from('venues').select('id,name,default_mode,default_lista_cost'),
        admin.from('app_settings').select('*').eq('id', 1).maybeSingle(),
        admin.from('promoters').select('id,is_active,sort_order').order('sort_order', { ascending: true }),
        admin.from('events').select('id,title,venue_id,venue_name,event_date,ticketsms_event_id'),
        admin
          .from('staff_members')
          .select('id,full_name,nickname,aliases,is_self,plan_id')
          .eq('owner_promoter_id', ownerPromoterId),
        admin
          .from('staff_commission_plans')
          .select('id,name,presale_tiers,table_tiers,is_default')
          .eq('owner_promoter_id', ownerPromoterId)
          .order('is_default', { ascending: false }),
      ]);

    const firstMetaErr =
      venuesRes.error ||
      settingsRes.error ||
      promotersRes.error ||
      appEventsRes.error ||
      staffMembersRes.error ||
      staffPlansRes.error;
    if (firstMetaErr) throw new Error(`Metadata fetch: ${firstMetaErr.message}`);

    const venues = (venuesRes.data || []) as VenueRow[];
    const appSettings = settingsRes.data || {};
    const defaultPresaleMode = String(
      appSettings.default_presale_input_mode || 'total_minus_primary'
    );
    const defaultListaCost = Number(appSettings.default_lista_cost || 0);

    const activePrIds = (promotersRes.data || [])
      .filter((p) => p.is_active)
      .map((p) => String(p.id));
    if (activePrIds.length === 0) activePrIds.push('lollo', 'ciccio');
    if (!activePrIds.includes('lollo')) activePrIds.push('lollo');

    const appEvents = (appEventsRes.data || []) as {
      id: string;
      title: string;
      venue_id: string | null;
      venue_name: string;
      event_date: string;
      ticketsms_event_id: number | null;
    }[];
    const byTsId = new Map<number, (typeof appEvents)[number]>();
    for (const ae of appEvents) {
      if (ae.ticketsms_event_id !== null && ae.ticketsms_event_id !== undefined) {
        byTsId.set(Number(ae.ticketsms_event_id), ae);
      }
    }

    const staffMembers = (staffMembersRes.data || []) as StaffMemberRow[];
    const staffPlans = staffPlansRes.data || [];
    const defaultPlanId = staffPlans[0] ? String(staffPlans[0].id) : null;
    const selfNoBustaPlan = staffPlans.find((p) => {
      const n = String(p.name || '').toLowerCase();
      const pt = Array.isArray(p.presale_tiers) ? p.presale_tiers : [];
      const tt = Array.isArray(p.table_tiers) ? p.table_tiers : [];
      return n.includes('nessuna busta') || n.includes('capo') || (pt.length === 0 && tt.length === 0);
    });
    const selfPlanId = selfNoBustaPlan ? String(selfNoBustaPlan.id) : null;

    let createdEvents = 0;
    let updatedPresales = 0;
    let updatedStaffRows = 0;

    // 3. Sync each TicketSMS event into Lollo & Ciccio (`events`, Lollo's `event_presales`) + `Reverse` (`staff_event_presales`)
    for (const [eid, ev] of eventsById.entries()) {
      const dash = ev.dash || null;
      const reportRows = parsedReportsById.get(eid) || [];
      const venueInfo = resolveVenueForTicketSms(
        ev.name,
        ev.location_name || '',
        dash?.location_full ?? null,
        venues
      );

      let matchedEvent = byTsId.get(eid) || null;
      if (!matchedEvent && ev.event_date) {
        const unlinkedSameDate = appEvents.filter(
          (ae) => ae.ticketsms_event_id === null && String(ae.event_date || '') === ev.event_date
        );
        const sameVenue = unlinkedSameDate.filter(
          (ae) => String(ae.venue_name || '').trim().toLowerCase() === venueInfo.venueName.toLowerCase()
        );
        if (sameVenue.length === 1) {
          matchedEvent = sameVenue[0];
        } else if (sameVenue.length > 1) {
          const tsTokens = new Set(normText(ev.name).split(' ').filter(Boolean));
          matchedEvent = sameVenue.reduce((best, cur) => {
            const bestScore = normText(best.title)
              .split(' ')
              .filter((t) => tsTokens.has(t)).length;
            const curScore = normText(cur.title)
              .split(' ')
              .filter((t) => tsTokens.has(t)).length;
            return curScore > bestScore ? cur : best;
          });
        } else if (unlinkedSameDate.length > 0) {
          const tsComp = normCompact(ev.name);
          for (const ae of unlinkedSameDate) {
            const aeComp = normCompact(ae.title);
            if (tsComp && aeComp && (tsComp.includes(aeComp) || aeComp.includes(tsComp))) {
              matchedEvent = ae;
              break;
            }
          }
        }

        if (matchedEvent) {
          await admin.from('events').update({ ticketsms_event_id: eid }).eq('id', matchedEvent.id);
          matchedEvent.ticketsms_event_id = eid;
          byTsId.set(eid, matchedEvent);
        }
      }

      let justCreated = false;
      if (!matchedEvent) {
        const hasSales = reportRows.length > 0 || Number(dash?.tickets_sent || 0) > 0;
        if (ev.is_canceled && !hasSales) continue;

        const { data: insertedEv, error: insErr } = await admin
          .from('events')
          .insert({
            title: (ev.name || '').trim() || `Serata TicketSMS ${eid}`,
            venue_id: venueInfo.venueId,
            venue_name: venueInfo.venueName,
            event_date: ev.event_date || todayIso,
            mode: venueInfo.mode,
            era: '2PX',
            lista_cost: venueInfo.listaCost ? venueInfo.listaCost : defaultListaCost,
            presale_input_mode: defaultPresaleMode,
            ticketsms_event_id: eid,
          })
          .select('id,title,venue_id,venue_name,event_date,ticketsms_event_id')
          .single();
        if (insErr || !insertedEv) continue;

        matchedEvent = insertedEv;
        appEvents.push(matchedEvent);
        byTsId.set(eid, matchedEvent);
        createdEvents += 1;
        justCreated = true;

        await Promise.all([
          admin.from('event_presales').upsert(
            activePrIds.map((pid) => ({ event_id: matchedEvent!.id, promoter_id: pid })),
            { onConflict: 'event_id,promoter_id', ignoreDuplicates: true }
          ),
          admin.from('event_pr_reconciliations').upsert(
            activePrIds.map((pid) => ({ event_id: matchedEvent!.id, promoter_id: pid })),
            { onConflict: 'event_id,promoter_id', ignoreDuplicates: true }
          ),
        ]);
      }

      const appEventId = String(matchedEvent.id);
      const hasCsv = reportRows.length > 0;
      let totQty = 0;
      let totRev = 0;
      let totOto = 0;

      if (hasCsv) {
        totQty = reportRows.reduce((a, r) => a + r.total_qty, 0);
        totRev = round2(reportRows.reduce((a, r) => a + r.total_revenue, 0));
        totOto = round2(reportRows.reduce((a, r) => a + r.one_to_one_revenue, 0));
      } else if (dash && (Number(dash.tickets_sent || 0) > 0 || Number(dash.total_profit || 0) > 0)) {
        totQty = Number(dash.tickets_sent || 0);
        totRev = round2(Number(dash.total_profit || 0));
        totOto = round2(
          (dash.ticket_types || []).reduce((a, t) => a + Number(t.one_to_one_total || 0), 0)
        );
      }

      // Update ONLY Lollo's row in event_presales (Ciccio's total is entered manually!)
      if (hasCsv || justCreated || ev.is_active || totQty > 0) {
        await admin.from('event_presales').upsert(
          {
            event_id: appEventId,
            promoter_id: 'lollo',
            quantity: totQty,
            revenue: totRev,
            one_to_one: totOto,
          },
          { onConflict: 'event_id,promoter_id' }
        );
        updatedPresales += 1;
      }

      // Sync Reverse sub-PR presales (`staff_event_presales` owner='lollo')
      if (hasCsv) {
        const grouped = new Map<
          string,
          { promoter_name: string; quantity: number; revenue: number; scarico: number }
        >();
        for (const r of reportRows) {
          const prClean = r.promoter_name.trim();
          if (!prClean) continue;
          const key = prClean.toLowerCase();
          const b = grouped.get(key) || {
            promoter_name: prClean,
            quantity: 0,
            revenue: 0,
            scarico: 0,
          };
          b.quantity += r.total_qty;
          b.revenue = round2(b.revenue + r.total_revenue);
          b.scarico = round2(b.scarico + r.one_to_one_revenue);
          grouped.set(key, b);
        }

        const activeBuckets = Array.from(grouped.values()).filter(
          (b) => b.quantity > 0 || b.revenue > 0 || b.scarico > 0
        );

        if (activeBuckets.length > 0) {
          const { data: existingSpData } = await admin
            .from('staff_event_presales')
            .select('id,staff_member_id,promoter_name,quantity,revenue,scarico,sort_order')
            .eq('owner_promoter_id', ownerPromoterId)
            .eq('event_id', appEventId);

          const existingSp = existingSpData || [];
          let nextSort =
            Math.max(-1, ...existingSp.map((x) => Number(x.sort_order || 0))) + 1;

          for (const bucket of activeBuckets) {
            const prName = bucket.promoter_name;
            let member = matchStaffMember(prName, staffMembers);

            if (!member) {
              const isSelf = prName.toLowerCase() === 'io' || prName.toLowerCase() === 'me';
              const { data: createdM } = await admin
                .from('staff_members')
                .insert({
                  owner_promoter_id: ownerPromoterId,
                  full_name: isSelf ? 'Io (Lollo)' : prName,
                  nickname: isSelf ? 'Io' : prName.split(' ')[0],
                  aliases: isSelf ? ['io'] : [prName.toLowerCase()],
                  plan_id: isSelf ? selfPlanId : defaultPlanId,
                  is_self: isSelf,
                  is_active: true,
                })
                .select('id,full_name,nickname,aliases,is_self,plan_id')
                .single();
              if (createdM) {
                member = createdM as StaffMemberRow;
                staffMembers.push(member);
              }
            }

            const memberId = member ? String(member.id) : null;
            const existingRow = existingSp.find(
              (sp) =>
                (memberId && String(sp.staff_member_id || '') === memberId) ||
                String(sp.promoter_name || '').trim().toLowerCase() === prName.toLowerCase()
            );

            if (existingRow) {
              const sameVals =
                Number(existingRow.quantity || 0) === bucket.quantity &&
                Math.abs(Number(existingRow.revenue || 0) - bucket.revenue) < 0.005 &&
                Math.abs(Number(existingRow.scarico || 0) - bucket.scarico) < 0.005 &&
                (!memberId || String(existingRow.staff_member_id || '') === memberId);

              if (!sameVals) {
                // Preserves paid_cash, note_amount, note_text, busta_override, is_busta_paid!
                await admin
                  .from('staff_event_presales')
                  .update({
                    staff_member_id: memberId || existingRow.staff_member_id,
                    quantity: bucket.quantity,
                    revenue: bucket.revenue,
                    scarico: bucket.scarico,
                  })
                  .eq('id', existingRow.id);
                updatedStaffRows += 1;
              }
            } else {
              const { data: insertedSp } = await admin
                .from('staff_event_presales')
                .insert({
                  owner_promoter_id: ownerPromoterId,
                  event_id: appEventId,
                  staff_member_id: memberId,
                  promoter_name: prName,
                  quantity: bucket.quantity,
                  revenue: bucket.revenue,
                  scarico: bucket.scarico,
                  sort_order: nextSort,
                })
                .select('id,staff_member_id,promoter_name,quantity,revenue,scarico,sort_order')
                .single();
              nextSort += 1;
              updatedStaffRows += 1;
              if (insertedSp) existingSp.push(insertedSp);
            }
          }
        }
      }
    }

    const msgParts = [
      `Sincronizzati ${eventsById.size} eventi (${activeEventsCount} attivi)`,
    ];
    if (createdEvents > 0) {
      msgParts.push(
        `${createdEvents} nuov${createdEvents === 1 ? 'a' : 'e'} serat${createdEvents === 1 ? 'a' : 'e'} creat${createdEvents === 1 ? 'a' : 'e'}`
      );
    }
    msgParts.push(`${updatedPresales} prevendite aggiornate`);
    const summaryMessage = `${msgParts.join(', ')}.`;

    await admin.from('ticketsms_sync_status').upsert(
      {
        id: 1,
        status: 'ok',
        events_synced: eventsById.size,
        message: summaryMessage,
        synced_at: nowIso,
      },
      { onConflict: 'id' }
    );

    return jsonResponse(
      {
        ok: true,
        events_synced: eventsById.size,
        active_events: activeEventsCount,
        created_events: createdEvents,
        updated_presales: updatedPresales,
        updated_staff_rows: updatedStaffRows,
        message: summaryMessage,
      },
      200,
      origin
    );
  } catch (err) {
    console.error('ingest-ticketsms-sync failed:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Errore interno sincronizzazione TicketSMS' },
      500,
      origin
    );
  }
});
