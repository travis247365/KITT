// Skill 10 — Trip Planner: concerts from Spotify e-mails + away events from Google Calendar → trip candidates,
// itinerary skeletons (dates, flight/hotel search links, budget envelope with provenance), tentative calendar holds on confirmation.
import { createGmail, GMAIL_MIGRATIONS } from '../../services/gmail.js';
import { createCalendar, CALENDAR_MIGRATIONS } from '../../services/calendar.js';
import { parseSpotifyEmail, kindFromSubject, cityFromVenue, CITY_INFO } from './parse.js';
import { spokenList, plural, spokenDate } from '../../voice.js';
import crypto from 'node:crypto';

const MIGRATIONS = [
  ...GMAIL_MIGRATIONS, ...CALENDAR_MIGRATIONS,
  `CREATE TABLE IF NOT EXISTS trips_events (
     id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT, artist TEXT NOT NULL, date TEXT NOT NULL, venue TEXT, city TEXT, country TEXT, airport TEXT, ticket_url TEXT,
     email_id TEXT, status TEXT NOT NULL DEFAULT 'new', first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS trips_events_date ON trips_events(date);
   CREATE TABLE IF NOT EXISTS trips_plans (
     id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, title TEXT NOT NULL, dest_city TEXT, dest_airport TEXT, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
     flights_url TEXT, hotel_url TEXT, budget_zmw INTEGER, budget_provenance TEXT, visa_note TEXT, calendar_event_id TEXT, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
];

const VISA = { // ASSUMED — verify before travel (standing rule: never present an assumption as fact)
  ZA: 'South Africa: Zambian passport holders are generally visa-exempt for short visits (up to 90 days) — verify with the embassy before booking (ASSUMED).',
  ZW: 'Zimbabwe: visa-free for Zambians (SADC) — verify (ASSUMED).', BW: 'Botswana: visa-free for Zambians — verify (ASSUMED).', NA: 'Namibia: visa-free for Zambians — verify (ASSUMED).', MW: 'Malawi: visa-free for Zambians — verify (ASSUMED).',
  KE: 'Kenya: electronic travel authorisation (eTA) required before departure — verify current rules (ASSUMED).', TZ: 'Tanzania: visa-free for Zambians (SADC) — verify (ASSUMED).', UG: 'Uganda: visa likely required or e-visa — verify (ASSUMED).',
  NG: 'Nigeria: visa required for Zambians — verify (ASSUMED).', GH: 'Ghana: visa on arrival/e-visa — verify (ASSUMED).', GB: 'United Kingdom: visa required for Zambian passport holders — apply well ahead (ASSUMED).', AE: 'UAE: visa required, often via airline/hotel — verify (ASSUMED).', US: 'United States: visa required (ASSUMED).', FR: 'France/Schengen: visa required (ASSUMED).', NL: 'Netherlands/Schengen: visa required (ASSUMED).',
};

export default function define(ctx) {
  const { db, composio, config, log, tz } = ctx;
  const gmail = createGmail({ db, composio });
  const calendar = createCalendar({ db, composio, tz });
  const home = { city: config.owner?.home_city || 'Lusaka', airport: config.trips?.home_airport || 'LUN' };
  const budget = { flight_zmw: 10000, hotel_night_zmw: 2800, per_diem_zmw: 1500, ...(config.trips?.budget || {}) };
  let syncing = null;

  const eventId = (e) => crypto.createHash('sha1').update(`${e.artist.toLowerCase()}|${e.date}|${(e.city || '').toLowerCase()}`).digest('hex').slice(0, 16);

  function upsertEvent(e) {
    db.prepare(`INSERT INTO trips_events(id, source, kind, artist, date, venue, city, country, airport, ticket_url, email_id)
      VALUES (@id, @source, @kind, @artist, @date, @venue, @city, @country, @airport, @ticket_url, @email_id)
      ON CONFLICT(id) DO UPDATE SET last_seen = datetime('now'), venue = COALESCE(NULLIF(excluded.venue, ''), trips_events.venue), ticket_url = COALESCE(excluded.ticket_url, trips_events.ticket_url), kind = excluded.kind`)
      .run({ id: eventId(e), source: e.source || 'spotify', kind: e.kind || null, artist: e.artist, date: e.date, venue: e.venue || '', city: e.city || '', country: e.country || null, airport: e.airport || null, ticket_url: e.ticket_url || null, email_id: e.email_id || null });
  }

  async function syncSpotify({ max = 40, full = false } = {}) {
    const { messages: fetched } = await gmail.sync('from:(spotify.com) (concert OR tickets OR live OR events OR tour) newer_than:90d', { max, tag: 'spotify' });
    let messages = fetched;
    if (full) { db.prepare("DELETE FROM trips_events WHERE source = 'spotify'").run(); messages = gmail.byTag('spotify', 300); }
    let parsed = 0; let hydrated = 0;
    for (const m of messages) {
      const already = db.prepare('SELECT 1 FROM trips_events WHERE email_id = ? LIMIT 1').get(m.id);
      if (already) continue;
      let text = m.body_text;
      if (!text && hydrated < 12) { const h = await gmail.hydrate(m.id).catch(() => null); text = h?.body_text || ''; hydrated++; }
      if (!text) continue;
      const events = parseSpotifyEmail({ subject: m.subject, text, ts: m.ts });
      for (const e of events) { upsertEvent({ ...e, source: 'spotify', kind: kindFromSubject(m.subject), email_id: m.id }); parsed++; }
    }
    return { fetched: messages.length, parsed, hydrated };
  }

  async function syncCalendar() {
    await calendar.sync({ days: 120 });
    const away = calendar.awayEvents({ days: 120, homeCity: home.city });
    for (const ev of away) { const info = cityFromVenue(ev.location); upsertEvent({ source: 'calendar', kind: 'calendar', artist: ev.summary, date: String(ev.start_ts).slice(0, 10), venue: ev.location, ...info, email_id: `cal:${ev.id}` }); }
    return { away: away.length };
  }

  async function sync({ full = false } = {}) {
    const r = {}; try { r.spotify = await syncSpotify({ full }); } catch (e) { r.spotify = { error: e.message }; log.warn('spotify sync failed', { err: e.message }); }
    try { r.calendar = await syncCalendar(); } catch (e) { r.calendar = { error: e.message }; log.warn('calendar sync failed', { err: e.message }); }
    ctx.kv.set('trips', 'last_sync', { at: new Date().toISOString(), ...r });
    return r;
  }

  function upcoming({ days = 120, includeNotInterested = false } = {}) {
    const from = new Date().toISOString().slice(0, 10); const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    return db.prepare(`SELECT * FROM trips_events WHERE date >= ? AND date <= ? ${includeNotInterested ? '' : "AND status <> 'not_interested'"} ORDER BY date`).all(from, to);
  }

  const dstr = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const addDays = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

  function buildPlan(ev) {
    const start = addDays(ev.date, -1); const end = addDays(ev.date, 1);
    const dest = ev.airport || cityFromVenue(ev.venue || ev.city).airport || null; const city = ev.city || cityFromVenue(ev.venue).city || 'destination';
    const nights = 2;
    const flights = dest ? `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${home.airport} to ${dest} on ${start} through ${end}`)}` : null;
    const kayak = dest ? `https://www.kayak.com/flights/${home.airport}-${dest}/${start}/${end}` : null;
    const hotel = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent((ev.venue ? ev.venue.split(',')[0] + ', ' : '') + city)}&checkin=${start}&checkout=${end}&group_adults=1`;
    const budgetZmw = budget.flight_zmw + nights * budget.hotel_night_zmw + 3 * budget.per_diem_zmw;
    const visa = ev.country && ev.country !== 'ZM' ? VISA[ev.country] || `Entry rules for ${ev.country}: verify (ASSUMED).` : 'Domestic — no visa.';
    return { event_id: ev.id, title: `${ev.artist} — ${city}`, dest_city: city, dest_airport: dest, start_date: start, end_date: end, flights_url: flights, kayak_url: kayak, hotel_url: hotel, budget_zmw: budgetZmw, budget_provenance: 'ASSUMED', visa_note: visa, nights };
  }

  function savePlan(p) {
    const r = db.prepare('INSERT INTO trips_plans(event_id, title, dest_city, dest_airport, start_date, end_date, flights_url, hotel_url, budget_zmw, budget_provenance, visa_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(p.event_id, p.title, p.dest_city, p.dest_airport, p.start_date, p.end_date, p.flights_url, p.hotel_url, p.budget_zmw, p.budget_provenance, p.visa_note);
    if (p.event_id) db.prepare("UPDATE trips_events SET status = 'planned' WHERE id = ?").run(p.event_id);
    return r.id;
  }

  function findEvent(q) {
    const s = String(q || '').toLowerCase().trim(); if (!s) return null;
    const rows = upcoming({ days: 365, includeNotInterested: true });
    return rows.find((e) => e.artist.toLowerCase() === s) || rows.find((e) => e.artist.toLowerCase().includes(s) || (e.city || '').toLowerCase().includes(s) || (e.venue || '').toLowerCase().includes(s)) || null;
  }

  const spokenEvent = (e) => `${e.artist} on ${dstr(e.date)}${e.city ? ` in ${e.city}` : ''}`;

  return {
    id: 'trips', name: 'Trip Planner', aliases: ['travel'],
    description: 'concerts from Spotify e-mails and away events from your calendar, turned into trip plans',
    migrations: MIGRATIONS,
    intents: [
      { name: 'concerts', description: 'upcoming concerts worth a trip', examples: ['any concerts worth a trip'], patterns: ['(any |are there any )?concerts (worth a trip|coming up|near me|i should (see|know about))', 'what concerts are (on|coming up|happening)', 'upcoming concerts', 'any (shows|gigs) coming up', "(what's|what is) on (the )?spotify concerts"] },
      { name: 'upcoming', description: 'planned trips and away events', examples: ['what trips are coming up'], patterns: ['what trips are (coming up|planned|next)', '(any |my )?upcoming trips', 'when am i travelling( next)?', 'am i travelling soon', 'travel plans'] },
      { name: 'plan', description: 'build a trip plan for an artist or city', examples: ['plan a trip for the Tyla show'], patterns: ['plan (a |the )?trip (for|to|around) (the )?{what}( (show|concert|gig|weekend))?', 'plan the {what} (show|concert|gig|weekend|trip)', 'build (me )?an itinerary for {what}'], slots: ['what'] },
      { name: 'hold', description: 'put a tentative hold on the calendar for a planned trip', examples: ['hold the Tyla weekend'], patterns: ['hold the {what} (weekend|trip|dates|show)', 'put a hold (on|for) (the )?{what}', 'block (the )?(calendar|dates) for {what}'], slots: ['what'], write: true },
      { name: 'not_interested', description: 'hide a concert', examples: ['not interested in Brandy'], patterns: ['(i am |i\'m )?not interested in (the )?{what}( (show|concert|gig))?', 'skip (the )?{what} (show|concert|gig)', 'hide {what}'], slots: ['what'], write: true },
      { name: 'sync', description: 'refresh concerts and calendar now', examples: ['refresh my trips'], patterns: ['(refresh|sync|update) (my )?(trips|concerts|travel)( fully| full)?', 'check (for )?(new )?concerts'] },
    ],
    routines: [
      { name: 'trips.sync', cron: '40 6 * * *', description: 'pull Spotify concert e-mails and away calendar events', run: async () => { const r = await sync(); const soon = upcoming({ days: 45 }).filter((e) => e.status === 'new'); return { summary: JSON.stringify(r), notify: soon.length ? { push: { title: `KITT trips: ${plural(soon.length, 'event')} in the next 45 days`, body: soon.slice(0, 5).map(spokenEvent).join('\n'), tags: 'airplane' } } : undefined }; } },
    ],
    async handle(intent, slots, c) {
      if (intent === 'sync') {
        if (c.source === 'cli') { const r = await sync({ full: /full/i.test(c.text || '') }); return { speak: `Synced. ${r.spotify?.parsed ?? 0} concert entries parsed, ${r.calendar?.away ?? 0} away events on the calendar.`, display: r }; }
        if (!syncing) syncing = sync().catch((e) => log.warn('trips sync failed', { err: e.message })).finally(() => { syncing = null; });
        return { speak: 'Refreshing concerts and the calendar in the background. Ask again in a minute.' };
      }
      if (intent === 'concerts') {
        const ev = upcoming({ days: 150 }).filter((e) => e.source === 'spotify');
        if (!ev.length) return { speak: ctx.kv.get('trips', 'last_sync') ? 'No concerts on file for the next five months.' : "I haven't read your Spotify concert e-mails yet. Say 'refresh my trips'." };
        const byCity = {}; for (const e of ev) (byCity[e.city || 'unknown'] ||= []).push(e);
        const parts = Object.entries(byCity).map(([city, list]) => `${city}: ${spokenList(list.map((e) => `${e.artist} on ${dstr(e.date)}`), { max: 4 })}`);
        return { speak: `${plural(ev.length, 'concert')} on file. ${parts.join('. ')}. Say 'plan the' and an artist to build a trip.`, display: ev };
      }
      if (intent === 'upcoming') {
        const plans = db.prepare("SELECT * FROM trips_plans WHERE end_date >= date('now') AND status <> 'cancelled' ORDER BY start_date").all();
        const away = upcoming({ days: 120 }).filter((e) => e.source === 'calendar');
        if (!plans.length && !away.length) return { speak: 'No trips planned and nothing away from home on the calendar in the next four months.' };
        const parts = [];
        if (plans.length) parts.push(`${plural(plans.length, 'planned trip')}: ${spokenList(plans.map((p) => `${p.title}, ${dstr(p.start_date)} to ${dstr(p.end_date)}${p.calendar_event_id ? ', held on the calendar' : ', not yet on the calendar'}`), { max: 4 })}.`);
        if (away.length) parts.push(`Away events: ${spokenList(away.map(spokenEvent), { max: 4 })}.`);
        return { speak: parts.join(' '), display: { plans, away } };
      }
      if (intent === 'plan') {
        const ev = findEvent(slots.what);
        if (!ev) { const info = cityFromVenue(slots.what || ''); if (!info.airport) return { speak: `I can't find ${slots.what} among upcoming events or known cities.` }; const p = buildPlan({ id: null, artist: `Trip to ${info.city}`, date: addDays(new Date().toISOString().slice(0, 10), 14), venue: '', ...info }); const id = savePlan(p); return { speak: `Draft plan ${id}: ${info.city}, placeholder dates ${dstr(p.start_date)} to ${dstr(p.end_date)}, budget about ${p.budget_zmw.toLocaleString('en-GB')} kwacha, assumed. ${p.visa_note.replace(/\s*\(ASSUMED\)\.?$/, '')}. Links are on the dashboard.`, display: p }; }
        const p = buildPlan(ev); const id = savePlan(p);
        return { speak: `Plan ${id} for ${ev.artist}: fly ${home.airport} to ${p.dest_airport || p.dest_city} ${dstr(p.start_date)}, back ${dstr(p.end_date)}, ${p.nights} nights near ${(ev.venue || p.dest_city).split(',')[0]}. Budget envelope about ${p.budget_zmw.toLocaleString('en-GB')} kwacha, assumed not quoted. ${p.visa_note.replace(/\s*\(ASSUMED\)\.?$/, '')}. Say 'hold the ${ev.artist} weekend' to block the dates.`, display: p };
      }
      if (intent === 'hold') {
        const ev = findEvent(slots.what); const plan = ev ? db.prepare('SELECT * FROM trips_plans WHERE event_id = ? ORDER BY id DESC LIMIT 1').get(ev.id) : db.prepare("SELECT * FROM trips_plans WHERE lower(title) LIKE ? ORDER BY id DESC LIMIT 1").get(`%${String(slots.what || '').toLowerCase()}%`);
        if (!plan) return { speak: `No plan for ${slots.what} yet. Say 'plan the ${slots.what} trip' first.` };
        if (plan.calendar_event_id) return { speak: `${plan.title} is already held on the calendar.` };
        return { speak: `Hold ${plan.title} on your Google calendar from ${dstr(plan.start_date)} to ${dstr(plan.end_date)}?`, confirm: { summary: `calendar hold: ${plan.title} ${plan.start_date} → ${plan.end_date}`, action: { type: 'hold', plan_id: plan.id } } };
      }
      if (intent === 'not_interested') { const ev = findEvent(slots.what); if (!ev) return { speak: `I can't find ${slots.what}.` }; return { speak: `Hide ${spokenEvent(ev)}?`, confirm: { summary: `hide ${ev.artist}`, action: { type: 'hide', event_id: ev.id } } }; }
      return { speak: "I didn't catch which trip question that was." };
    },
    async execute(action) {
      if (action.type === 'hide') { db.prepare("UPDATE trips_events SET status = 'not_interested' WHERE id = ?").run(action.event_id); return { speak: 'Hidden.' }; }
      if (action.type === 'hold') {
        const plan = db.prepare('SELECT * FROM trips_plans WHERE id = ?').get(action.plan_id); if (!plan) return { speak: 'Plan not found.' };
        const endExclusive = addDays(plan.end_date, 1);
        const res = await composio.execute('GOOGLECALENDAR_CREATE_EVENT', { calendar_id: 'primary', summary: `HOLD: ${plan.title}`, description: `Tentative trip hold created by KITT.\nFlights: ${plan.flights_url || '-'}\nHotels: ${plan.hotel_url || '-'}\nBudget (assumed): ZMW ${plan.budget_zmw}\n${plan.visa_note}`, start_date: plan.start_date, end_date: endExclusive, timezone: tz, transparency: 'transparent' }, { timeoutMs: 60000 });
        const id = res?.id || res?.event?.id || res?.response_data?.id || null;
        db.prepare("UPDATE trips_plans SET calendar_event_id = ?, status = 'held' WHERE id = ?").run(id || 'created', plan.id);
        return { speak: `Held ${plan.title} from ${dstr(plan.start_date)} to ${dstr(plan.end_date)} as a tentative, free-time event.` };
      }
      return { speak: 'Unknown action.' };
    },
    async brief({ kind }) {
      if (kind !== 'morning') return null;
      const soon = upcoming({ days: 14 });
      const plans = db.prepare("SELECT * FROM trips_plans WHERE start_date BETWEEN date('now') AND date('now', '+14 days') AND status <> 'cancelled'").all();
      if (!soon.length && !plans.length) return null;
      const parts = [];
      if (plans.length) parts.push(`Trips: ${spokenList(plans.map((p) => `${p.title} from ${dstr(p.start_date)}`), { max: 2 })}.`);
      const concerts = soon.filter((e) => e.source === 'spotify' && e.status === 'new');
      if (concerts.length) parts.push(`${plural(concerts.length, 'concert')} within two weeks: ${spokenList(concerts.map(spokenEvent), { max: 2 })}.`);
      return parts.length ? { speak: parts.join(' ') } : null;
    },
    async view() { return { events: upcoming({ days: 365, includeNotInterested: true }), plans: db.prepare('SELECT * FROM trips_plans ORDER BY start_date DESC LIMIT 20').all(), last_sync: ctx.kv.get('trips', 'last_sync'), home }; },
    async health() { const ls = ctx.kv.get('trips', 'last_sync'); const bad = ls && (ls.spotify?.error || ls.calendar?.error); return { ok: !bad, detail: ls ? `last sync ${ls.at}${bad ? `; errors: ${ls.spotify?.error || ''} ${ls.calendar?.error || ''}` : ''}; ${upcoming({ days: 365 }).length} upcoming events` : 'never synced' }; },
    async dashboard() {
      const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const ev = upcoming({ days: 365, includeNotInterested: true });
      const plans = db.prepare('SELECT * FROM trips_plans ORDER BY start_date DESC LIMIT 20').all();
      return `<h3>Upcoming events</h3><table><tr><th>Date</th><th>Who</th><th>Venue</th><th>City</th><th>Source</th><th>Status</th><th>Tickets</th></tr>${ev.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.artist)}</td><td>${esc(e.venue)}</td><td>${esc(e.city)}</td><td>${esc(e.source)}</td><td>${esc(e.status)}</td><td>${e.ticket_url ? `<a href="${esc(e.ticket_url)}">link</a>` : ''}</td></tr>`).join('')}</table>
<h3>Plans</h3><table><tr><th>Title</th><th>Dates</th><th>Budget ZMW (${plans[0]?.budget_provenance || 'ASSUMED'})</th><th>Links</th><th>Visa</th><th>Status</th></tr>${plans.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(p.start_date)} → ${esc(p.end_date)}</td><td>${esc(p.budget_zmw)}</td><td>${p.flights_url ? `<a href="${esc(p.flights_url)}">flights</a> ` : ''}${p.hotel_url ? `<a href="${esc(p.hotel_url)}">hotels</a>` : ''}</td><td>${esc(p.visa_note)}</td><td>${esc(p.status)}</td></tr>`).join('')}</table>`;
    },
    _internal: { parseSpotifyEmail, buildPlan, upsertEvent, upcoming, findEvent, sync, CITY_INFO },
  };
}
