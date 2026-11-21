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
  // Ultra-fast (~1s total) JavaScript for Apple iOS Shortcuts -> "Esegui JavaScript su pagina web"
  // Fetches active events + 2 most recent past events in parallel, downloads ONLY their CSV reports
  // in parallel (no heavy DashEvent HTML needed), and POSTs to Supabase Edge Function!
  return `(function () {
  var ENDPOINT = ${JSON.stringify(endpointUrl)};
  var SYNC_KEY = ${JSON.stringify(syncKey)};
  var done = false;
  var step = 'init';
  function finish(msg) {
    if (!done) {
      done = true;
      completion(String(msg));
    }
  }

  if (location.hostname !== 'my.ticketsms.it') {
    finish('⚠️ Apri prima https://my.ticketsms.it su Safari e riprova.');
    return;
  }

  function fetchTimeout(url, opts, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    var merged = Object.assign({}, opts || {});
    if (ctrl) merged.signal = ctrl.signal;
    return fetch(url, merged).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function extractEid(link) {
    var m = String(link || '').match(/eid=(\\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function mapEvents(data, isActive) {
    var list = [];
    var arr = (data && data.events) || [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var dashLink = item.dashEventLink || (item.actions && item.actions.dashEventLink) || '';
      var eid = extractEid(dashLink);
      if (!eid) continue;
      list.push({
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
        is_active: isActive,
        is_canceled: Boolean(item.isEventCanceled),
        is_approved: item.isEventApproved !== false,
        is_admin: Boolean(item.isUserEventAdmin)
      });
    }
    return list;
  }

  function fetchList(includeTerminated) {
    return fetchTimeout(
      '/ajax/event/listEvents.php?includeTerminated=' + includeTerminated + '&page=1',
      { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } },
      4000
    ).then(function (res) {
      if (res.url && res.url.toLowerCase().indexOf('login.php') !== -1) {
        throw new Error('Sessione TicketSMS scaduta: accedi prima su my.ticketsms.it.');
      }
      if (!res.ok) throw new Error('TicketSMS HTTP ' + res.status);
      return res.text();
    }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); } catch (e) {
        throw new Error('Sessione TicketSMS scaduta: accedi prima su my.ticketsms.it.');
      }
      if (!data || !data.result) {
        throw new Error('Sessione TicketSMS non valida: rifai login su my.ticketsms.it.');
      }
      return mapEvents(data, !includeTerminated);
    });
  }

  function decodeCsv(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('iso-8859-1').decode(buf); }
  }

  step = 'lista serate';
  Promise.all([fetchList(false), fetchList(true)])
    .then(function (lists) {
      var active = lists[0];
      var recentPast = lists[1].slice(0, 2);
      var seen = {};
      var all = [];
      active.concat(recentPast).forEach(function (ev) {
        if (!seen[ev.event_id]) {
          seen[ev.event_id] = true;
          all.push(ev);
        }
      });
      if (all.length === 0) {
        throw new Error('Nessuna serata trovata sul tuo account TicketSMS.');
      }

      step = 'report CSV (' + all.length + ' serate)';
      return Promise.all(all.map(function (ev) {
        return fetchTimeout(
          '/action/csvReportEvent.php?eid=' + ev.event_id,
          { credentials: 'include' },
          4000
        ).then(function (r) {
          if (r.url && r.url.toLowerCase().indexOf('login.php') !== -1) {
            throw new Error('Sessione TicketSMS scaduta: accedi prima su my.ticketsms.it.');
          }
          if (!r.ok) return Object.assign({}, ev, { csv_text: '' });
          return r.arrayBuffer().then(function (buf) {
            var txt = decodeCsv(buf);
            var low = txt.slice(0, 150).trim().toLowerCase();
            if (low.indexOf('<!doctype') === 0 || low.indexOf('<html') === 0) {
              return Object.assign({}, ev, { csv_text: '' });
            }
            return Object.assign({}, ev, { csv_text: txt });
          });
        }).catch(function () {
          return Object.assign({}, ev, { csv_text: '' });
        });
      }));
    })
    .then(function (enriched) {
      step = 'invio al Gestionale';
      return fetchTimeout(
        ENDPOINT,
        {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
            'x-sync-key': SYNC_KEY
          },
          body: JSON.stringify({ source: 'ios_shortcut', events: enriched })
        },
        5500
      ).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (out) {
          if (!res.ok || !out.ok) {
            throw new Error(out.error || 'Errore Gestionale HTTP ' + res.status);
          }
          finish('✅ ' + (out.message || 'Dati TicketSMS aggiornati!'));
        });
      });
    })
    .catch(function (err) {
      var msg = (err && err.name === 'AbortError')
        ? 'Timeout durante: ' + step
        : (err && err.message ? err.message : String(err));
      finish('❌ ' + msg);
    });
})();`;
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

    // Action 1: Return personalized iOS Shortcut JS to authenticated Lollo
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

    // Action 2: Fast batched ingest for Lollo ONLY (Ciccio's total is entered manually)
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

    const eventsById = new Map<number, IncomingEvent>();
    for (const ev of incomingEvents) {
      const eid = Number(ev.event_id);
      if (!Number.isFinite(eid) || eid <= 0) continue;
      eventsById.set(eid, { ...ev, event_id: eid });
    }

    const parsedReportsById = new Map<number, ParsedCsvRow[]>();
    const rawEventRows: Record<string, unknown>[] = [];
    let activeEventsCount = 0;

    for (const [eid, ev] of eventsById.entries()) {
      if (ev.is_active) activeEventsCount += 1;
      const csvRows = ev.csv_text ? parseEventReportCsv(ev.csv_text) : [];
      parsedReportsById.set(eid, csvRows);

      const totQty = csvRows.reduce((a, r) => a + r.total_qty, 0);
      const totRev = round2(csvRows.reduce((a, r) => a + r.total_revenue, 0));

      rawEventRows.push({
        event_id: eid,
        name: String(ev.name || ''),
        event_date: ev.event_date || null,
        weekday: ev.weekday || '',
        month: ev.month || '',
        year: String(ev.year || ''),
        location_name: ev.location_name || '',
        location_full: ev.location_name || '',
        cover_image_url: ev.cover_image_url ?? null,
        dash_url: ev.dash_url || '',
        shop_url: ev.shop_url ?? null,
        is_active: Boolean(ev.is_active),
        is_canceled: Boolean(ev.is_canceled),
        is_approved: ev.is_approved !== false,
        is_admin: Boolean(ev.is_admin),
        tickets_sent: totQty,
        total_profit: totRev,
        synced_at: nowIso,
      });
    }

    // 1. Upsert ticketsms_events + fetch all app metadata IN PARALLEL!
    const [
      evUpsertRes,
      venuesRes,
      settingsRes,
      promotersRes,
      appEventsRes,
      staffMembersRes,
      staffPlansRes,
    ] = await Promise.all([
      admin.from('ticketsms_events').upsert(rawEventRows, { onConflict: 'event_id' }),
      admin.from('venues').select('id,name,default_mode,default_lista_cost'),
      admin.from('app_settings').select('*').eq('id', 1).maybeSingle(),
      admin
        .from('promoters')
        .select('id,is_active,sort_order')
        .order('sort_order', { ascending: true }),
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

    const firstErr =
      evUpsertRes.error ||
      venuesRes.error ||
      settingsRes.error ||
      promotersRes.error ||
      appEventsRes.error ||
      staffMembersRes.error ||
      staffPlansRes.error;
    if (firstErr) throw new Error(firstErr.message);

    // Replace report rows in parallel (non-blocking relative to matching)
    const reportRpcPromises = Array.from(parsedReportsById.entries())
      .filter(([, rows]) => rows.length > 0)
      .map(([eid, rows]) =>
        admin.rpc('replace_ticketsms_report_rows', {
          p_event_id: eid,
          p_rows: rows.map((r) => ({ ...r, synced_at: nowIso })),
        })
      );

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
    const matchedEvents: { eid: number; ev: IncomingEvent; appEventId: string; justCreated: boolean }[] = [];

    // 2. Match / create events
    for (const [eid, ev] of eventsById.entries()) {
      const reportRows = parsedReportsById.get(eid) || [];
      const venueInfo = resolveVenueForTicketSms(ev.name, ev.location_name || '', null, venues);

      let matchedEvent = byTsId.get(eid) || null;
      if (!matchedEvent && ev.event_date) {
        const unlinkedSameDate = appEvents.filter(
          (ae) => ae.ticketsms_event_id === null && String(ae.event_date || '') === ev.event_date
        );
        const sameVenue = unlinkedSameDate.filter(
          (ae) =>
            String(ae.venue_name || '').trim().toLowerCase() === venueInfo.venueName.toLowerCase()
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
        if (ev.is_canceled && reportRows.length === 0) continue;

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

      matchedEvents.push({ eid, ev, appEventId: String(matchedEvent.id), justCreated });
    }

    // 3. Batch-fetch all existing staff_event_presales for matched events in ONE single query!
    const matchedAppEventIds = matchedEvents.map((m) => m.appEventId);
    const { data: allExistingSpData } =
      matchedAppEventIds.length > 0
        ? await admin
            .from('staff_event_presales')
            .select('id,event_id,staff_member_id,promoter_name,quantity,revenue,scarico,sort_order')
            .eq('owner_promoter_id', ownerPromoterId)
            .in('event_id', matchedAppEventIds)
        : { data: [] };

    const spByEventId = new Map<
      string,
      {
        id: string;
        event_id: string;
        staff_member_id: string | null;
        promoter_name: string;
        quantity: number;
        revenue: number;
        scarico: number;
        sort_order: number;
      }[]
    >();
    for (const sp of allExistingSpData || []) {
      const k = String(sp.event_id);
      const arr = spByEventId.get(k) || [];
      arr.push(sp);
      spByEventId.set(k, arr);
    }

    // 4. Prepare batched event_presales upserts + missing staff_members + staff_event_presales writes
    const lolloPresaleUpserts: Record<string, unknown>[] = [];
    const newMembersToCreate = new Map<
      string,
      {
        owner_promoter_id: string;
        full_name: string;
        nickname: string;
        aliases: string[];
        plan_id: string | null;
        is_self: boolean;
        is_active: boolean;
      }
    >();

    const perEventBuckets = new Map<
      string,
      { promoter_name: string; quantity: number; revenue: number; scarico: number }[]
    >();

    for (const item of matchedEvents) {
      const reportRows = parsedReportsById.get(item.eid) || [];
      const hasCsv = reportRows.length > 0;
      const totQty = reportRows.reduce((a, r) => a + r.total_qty, 0);
      const totRev = round2(reportRows.reduce((a, r) => a + r.total_revenue, 0));
      const totOto = round2(reportRows.reduce((a, r) => a + r.one_to_one_revenue, 0));

      // Update ONLY Lollo's row in event_presales (Ciccio's total is entered manually!)
      if (hasCsv || item.justCreated || item.ev.is_active || totQty > 0) {
        lolloPresaleUpserts.push({
          event_id: item.appEventId,
          promoter_id: 'lollo',
          quantity: totQty,
          revenue: totRev,
          one_to_one: totOto,
        });
      }

      if (!hasCsv) continue;

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
      perEventBuckets.set(item.appEventId, activeBuckets);

      for (const bucket of activeBuckets) {
        const prName = bucket.promoter_name;
        const member = matchStaffMember(prName, staffMembers);
        if (!member) {
          const isSelf = prName.toLowerCase() === 'io' || prName.toLowerCase() === 'me';
          const memKey = isSelf ? '__self__' : prName.toLowerCase();
          if (!newMembersToCreate.has(memKey)) {
            newMembersToCreate.set(memKey, {
              owner_promoter_id: ownerPromoterId,
              full_name: isSelf ? 'Io (Lollo)' : prName,
              nickname: isSelf ? 'Io' : prName.split(' ')[0],
              aliases: isSelf ? ['io'] : [prName.toLowerCase()],
              plan_id: isSelf ? selfPlanId : defaultPlanId,
              is_self: isSelf,
              is_active: true,
            });
          }
        }
      }
    }

    // Batch-insert any new staff members in ONE query
    if (newMembersToCreate.size > 0) {
      const { data: createdMembers } = await admin
        .from('staff_members')
        .insert(Array.from(newMembersToCreate.values()))
        .select('id,full_name,nickname,aliases,is_self,plan_id');
      for (const cm of createdMembers || []) {
        staffMembers.push(cm as StaffMemberRow);
      }
    }

    const spInserts: Record<string, unknown>[] = [];
    const spUpdates: PromiseLike<unknown>[] = [];

    for (const [appEventId, activeBuckets] of perEventBuckets.entries()) {
      const existingSp = spByEventId.get(appEventId) || [];
      let nextSort = Math.max(-1, ...existingSp.map((x) => Number(x.sort_order || 0))) + 1;

      for (const bucket of activeBuckets) {
        const prName = bucket.promoter_name;
        const member = matchStaffMember(prName, staffMembers);
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
            spUpdates.push(
              admin
                .from('staff_event_presales')
                .update({
                  staff_member_id: memberId || existingRow.staff_member_id,
                  quantity: bucket.quantity,
                  revenue: bucket.revenue,
                  scarico: bucket.scarico,
                })
                .eq('id', existingRow.id)
            );
          }
        } else {
          spInserts.push({
            owner_promoter_id: ownerPromoterId,
            event_id: appEventId,
            staff_member_id: memberId,
            promoter_name: prName,
            quantity: bucket.quantity,
            revenue: bucket.revenue,
            scarico: bucket.scarico,
            sort_order: nextSort++,
          });
        }
      }
    }

    const msgParts = [`Sincronizzati ${eventsById.size} eventi (${activeEventsCount} attivi)`];
    if (createdEvents > 0) {
      msgParts.push(
        `${createdEvents} nuov${createdEvents === 1 ? 'a' : 'e'} serat${createdEvents === 1 ? 'a' : 'e'} creat${createdEvents === 1 ? 'a' : 'e'}`
      );
    }
    msgParts.push(`${lolloPresaleUpserts.length} prevendite aggiornate`);
    const summaryMessage = `${msgParts.join(', ')}.`;

    // 5. Execute ALL remaining DB writes IN PARALLEL!
    const finalWrites: PromiseLike<unknown>[] = [
      ...reportRpcPromises,
      ...spUpdates,
      admin.from('ticketsms_sync_status').upsert(
        {
          id: 1,
          status: 'ok',
          events_synced: eventsById.size,
          message: summaryMessage,
          synced_at: nowIso,
        },
        { onConflict: 'id' }
      ),
    ];

    if (lolloPresaleUpserts.length > 0) {
      finalWrites.push(
        admin
          .from('event_presales')
          .upsert(lolloPresaleUpserts, { onConflict: 'event_id,promoter_id' })
      );
    }
    if (spInserts.length > 0) {
      finalWrites.push(admin.from('staff_event_presales').insert(spInserts));
    }

    await Promise.all(finalWrites);

    return jsonResponse(
      {
        ok: true,
        events_synced: eventsById.size,
        active_events: activeEventsCount,
        created_events: createdEvents,
        updated_presales: lolloPresaleUpserts.length,
        updated_staff_rows: spInserts.length + spUpdates.length,
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
