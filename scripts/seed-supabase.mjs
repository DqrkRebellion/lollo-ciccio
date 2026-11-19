import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://inltzlcgccfnblfepnkw.supabase.co';
const keysBuf = fs.readFileSync(path.join(process.env.TEMP, 'lc_api_keys.json'));
const keysRaw =
  keysBuf[0] === 0xff && keysBuf[1] === 0xfe
    ? keysBuf.slice(2).toString('utf16le')
    : keysBuf.toString('utf8').replace(/^\uFEFF/, '');
const keys = JSON.parse(keysRaw);
const serviceKey = keys.find((k) => k.id === 'service_role')?.api_key;
if (!serviceKey) throw new Error('Missing service_role key');

const supabase = createClient(SUPABASE_URL, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const VENUE_STYLES = {
  'Touchè': { color: '#0071E3', default_mode: 'NO OSPITE', default_table_price: 30 },
  'TPF': { color: '#5856D6', default_mode: 'NO OSPITE', default_table_price: 30 },
  'Million': { color: '#AF52DE', default_mode: 'NO OSPITE', default_table_price: 30 },
  'Astoria': { color: '#FF9500', default_mode: 'NO OSPITE', default_table_price: 25 },
  'Capcreus': { color: '#34C759', default_mode: 'NO OSPITE', default_table_price: 30 },
  'Marina Bay': { color: '#32ADE6', default_mode: 'NO OSPITE', default_table_price: 30 },
  'Matilda': { color: '#FF2D55', default_mode: 'NO OSPITE', default_table_price: 30 },
  'Santafè': { color: '#FF6B00', default_mode: 'NO OSPITE', default_table_price: 30 },
  'Eden': { color: '#30B0C7', default_mode: 'NO OSPITE', default_table_price: 30 },
  'La Vie En Rose': { color: '#FF375F', default_mode: 'NO OSPITE', default_table_price: 30 },
};

function randomPin() {
  return String(crypto.randomInt(100000, 999999));
}

async function ensureUser(email, promoterId, displayName, fullName) {
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = listData.users.find((u) => u.email === email);
  const pin = randomPin();
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: pin,
      email_confirm: true,
      user_metadata: { promoter_id: promoterId, display_name: displayName, full_name: fullName },
    });
    if (error) throw error;
    return { email, promoterId, pin, existed: true };
  }
  const { error } = await supabase.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
    user_metadata: { promoter_id: promoterId, display_name: displayName, full_name: fullName },
  });
  if (error) throw error;
  return { email, promoterId, pin, existed: false };
}

async function main() {
  console.log('1) Ensuring team accounts...');
  const lolloAcc = await ensureUser('lollo@lollociccio.app', 'lollo', 'Lollo', 'Lorenzo Biondi');
  const ciccioAcc = await ensureUser('ciccio@lollociccio.app', 'ciccio', 'Ciccio', 'Francesco Troiano');
  // Save locally in TEMP only so we can test and report to user
  fs.writeFileSync(
    path.join(process.env.TEMP, 'lc_pins.json'),
    JSON.stringify({ lollo: lolloAcc, ciccio: ciccioAcc }, null, 2),
    'utf8'
  );
  console.log('   Accounts ready:', lolloAcc.email, ciccioAcc.email);

  const seedPath = path.resolve('scripts/seed-data.json');
  const eventsData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  console.log('2) Upserting venues...');
  const venueNames = [...new Set(eventsData.map((e) => e.venue_name))];
  const venueRows = venueNames.map((name) => ({
    name,
    color: VENUE_STYLES[name]?.color || '#0071E3',
    default_mode: VENUE_STYLES[name]?.default_mode || 'NO OSPITE',
    default_table_price: VENUE_STYLES[name]?.default_table_price || 30,
  }));
  const { data: venues, error: vErr } = await supabase
    .from('venues')
    .upsert(venueRows, { onConflict: 'name' })
    .select();
  if (vErr) throw vErr;
  const venueMap = new Map(venues.map((v) => [v.name, v.id]));
  console.log(`   Upserted ${venues.length} venues.`);

  console.log('3) Checking existing events...');
  const { count: existingCount, error: cErr } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
  if (cErr) throw cErr;

  if (existingCount > 0) {
    console.log(`   Database already contains ${existingCount} events. Skipping event seed to prevent duplicates.`);
    return;
  }

  console.log(`4) Importing ${eventsData.length} historical events...`);
  let totalTables = 0;
  for (const ev of eventsData) {
    const { data: insertedEv, error: evErr } = await supabase
      .from('events')
      .insert({
        title: ev.title,
        sheet_name: ev.sheet_name,
        venue_id: venueMap.get(ev.venue_name) || null,
        venue_name: ev.venue_name,
        event_date: ev.event_date,
        mode: ev.mode,
        era: ev.era,
        is_busta_paid: ev.is_busta_paid,
        lista_cost: ev.lista_cost,
        general_note_amount: ev.general_note_amount,
        busta_override: ev.busta_override,
      })
      .select()
      .single();
    if (evErr) throw evErr;

    if (ev.presales.length > 0) {
      const { error: pErr } = await supabase.from('event_presales').insert(
        ev.presales.map((p) => ({
          event_id: insertedEv.id,
          promoter_id: p.promoter_id,
          quantity: p.quantity,
          revenue: p.revenue,
          one_to_one: p.one_to_one,
        }))
      );
      if (pErr) throw pErr;
    }

    if (ev.tables.length > 0) {
      totalTables += ev.tables.length;
      const { error: tErr } = await supabase.from('event_tables').insert(
        ev.tables.map((t) => ({
          event_id: insertedEv.id,
          promoter_id: t.promoter_id,
          table_name: t.table_name,
          payers_count: t.payers_count,
          price: t.price,
          surcharge_payers_count: t.surcharge_payers_count,
          surcharge_price: t.surcharge_price,
          extra_no_scarico: t.extra_no_scarico,
          extra_si_scarico: t.extra_si_scarico,
          scarico_status: t.scarico_status,
          sort_order: t.sort_order,
        }))
      );
      if (tErr) throw tErr;
    }

    if (ev.reconciliations.length > 0) {
      const { error: rErr } = await supabase.from('event_pr_reconciliations').insert(
        ev.reconciliations.map((r) => ({
          event_id: insertedEv.id,
          promoter_id: r.promoter_id,
          lista_pr_count: r.lista_pr_count,
          note_amount: r.note_amount,
          scaricato_amount: r.scaricato_amount,
        }))
      );
      if (rErr) throw rErr;
    }
  }
  console.log(`DONE! Imported ${eventsData.length} events and ${totalTables} tables into Supabase.`);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
