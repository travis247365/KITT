// Shared Google Calendar access over Composio (GOOGLECALENDAR_EVENTS_LIST, camelCase params — verified 2026-10-26).
import { log } from '../log.js';

export const CALENDAR_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cal_events (
     id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL DEFAULT 'primary', summary TEXT, description TEXT, location TEXT,
     start_ts TEXT, end_ts TEXT, all_day INTEGER NOT NULL DEFAULT 0, status TEXT, event_type TEXT, html_link TEXT, hangout INTEGER NOT NULL DEFAULT 0,
     attendees INTEGER NOT NULL DEFAULT 0, updated TEXT, fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS cal_start ON cal_events(start_ts);`,
];

export function normalizeEvent(e, calendarId = 'primary') {
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const startTs = e.start?.dateTime || (e.start?.date ? `${e.start.date}T00:00:00` : null);
  const endTs = e.end?.dateTime || (e.end?.date ? `${e.end.date}T00:00:00` : null);
  return {
    id: e.id, calendar_id: calendarId, summary: e.summary || '(no title)', description: (e.description || '').slice(0, 2000), location: e.location || '',
    start_ts: startTs, end_ts: endTs, all_day: allDay ? 1 : 0, status: e.status || '', event_type: e.eventType || 'default', html_link: e.htmlLink || '',
    hangout: e.hangoutLink || e.conferenceData ? 1 : 0, attendees: Array.isArray(e.attendees) ? e.attendees.length : 0, updated: e.updated || null,
  };
}

export function createCalendar({ db, composio, tz = 'Africa/Lusaka' }) {
  let _upsert = null; // prepared lazily: migrations run after define()
  const upsert = { run: (row) => (_upsert ||= db.prepare(UPSERT_SQL)).run(row) };
  const UPSERT_SQL = `INSERT INTO cal_events(id, calendar_id, summary, description, location, start_ts, end_ts, all_day, status, event_type, html_link, hangout, attendees, updated, fetched_at)
    VALUES (@id, @calendar_id, @summary, @description, @location, @start_ts, @end_ts, @all_day, @status, @event_type, @html_link, @hangout, @attendees, @updated, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, description = excluded.description, location = excluded.location, start_ts = excluded.start_ts, end_ts = excluded.end_ts,
      all_day = excluded.all_day, status = excluded.status, event_type = excluded.event_type, html_link = excluded.html_link, hangout = excluded.hangout, attendees = excluded.attendees, updated = excluded.updated, fetched_at = excluded.fetched_at`;

  async function list({ days = 30, max = 100, calendarId = 'primary', from = new Date() } = {}) {
    const timeMin = from.toISOString();
    const timeMax = new Date(from.getTime() + days * 86400000).toISOString();
    const data = await composio.execute('GOOGLECALENDAR_EVENTS_LIST', { calendarId, timeMin, timeMax, maxResults: Math.min(250, max), singleEvents: true, orderBy: 'startTime', timeZone: tz }, { timeoutMs: 90000 });
    return (data.items || []).map((e) => normalizeEvent(e, calendarId));
  }

  async function sync(opts = {}) {
    const started = Date.now();
    const events = await list(opts);
    for (const e of events) upsert.run(e);
    // drop cached events in the window that no longer exist (cancelled / deleted)
    const ids = new Set(events.map((e) => e.id));
    const from = (opts.from || new Date()).toISOString();
    const to = new Date((opts.from || new Date()).getTime() + (opts.days || 30) * 86400000).toISOString();
    for (const row of db.prepare('SELECT id FROM cal_events WHERE start_ts >= ? AND start_ts < ?').all(from, to)) if (!ids.has(row.id)) db.prepare('DELETE FROM cal_events WHERE id = ?').run(row.id);
    log.info('calendar sync', { count: events.length, ms: Date.now() - started });
    return events;
  }

  function upcoming({ days = 7, from = new Date(), limit = 50 } = {}) {
    const a = from.toISOString(); const b = new Date(from.getTime() + days * 86400000).toISOString();
    return db.prepare("SELECT * FROM cal_events WHERE start_ts >= ? AND start_ts < ? AND status <> 'cancelled' ORDER BY start_ts LIMIT ?").all(a, b, limit);
  }

  /** Events whose location looks like it is away from home (anything with a comma/city that is not the home city). */
  function awayEvents({ days = 90, homeCity = 'Lusaka' } = {}) {
    return upcoming({ days, limit: 500 }).filter((e) => e.location && !new RegExp(homeCity, 'i').test(e.location) && !/^https?:|zoom|meet\.google|teams/i.test(e.location));
  }

  return { list, sync, upcoming, awayEvents };
}
