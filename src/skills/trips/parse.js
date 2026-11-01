// Pure parsers for the Trip Planner: Spotify concert e-mails (three layouts) and venue → city/airport mapping.
const DOW = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE_RE = new RegExp(`^${DOW},?\\s+${MON}\\.?\\s+\\d{1,2}(?:,\\s*\\d{4})?$`, 'i');
const DATE_IN = new RegExp(`(${DOW}),?\\s+(${MON})\\.?\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?`, 'i');

export const CITY_INFO = {
  pretoria: { country: 'ZA', airport: 'JNB' }, johannesburg: { country: 'ZA', airport: 'JNB' }, sandton: { country: 'ZA', airport: 'JNB' }, nasrec: { country: 'ZA', airport: 'JNB' }, soweto: { country: 'ZA', airport: 'JNB' }, midrand: { country: 'ZA', airport: 'JNB' }, refilwe: { country: 'ZA', airport: 'JNB' }, centurion: { country: 'ZA', airport: 'JNB' },
  'cape town': { country: 'ZA', airport: 'CPT' }, durban: { country: 'ZA', airport: 'DUR' }, 'port elizabeth': { country: 'ZA', airport: 'PLZ' }, gqeberha: { country: 'ZA', airport: 'PLZ' },
  lusaka: { country: 'ZM', airport: 'LUN' }, kitwe: { country: 'ZM', airport: 'NLA' }, ndola: { country: 'ZM', airport: 'NLA' }, livingstone: { country: 'ZM', airport: 'LVI' },
  harare: { country: 'ZW', airport: 'HRE' }, gaborone: { country: 'BW', airport: 'GBE' }, windhoek: { country: 'NA', airport: 'WDH' }, lilongwe: { country: 'MW', airport: 'LLW' }, blantyre: { country: 'MW', airport: 'BLZ' },
  nairobi: { country: 'KE', airport: 'NBO' }, 'dar es salaam': { country: 'TZ', airport: 'DAR' }, kampala: { country: 'UG', airport: 'EBB' }, kigali: { country: 'RW', airport: 'KGL' }, lagos: { country: 'NG', airport: 'LOS' }, accra: { country: 'GH', airport: 'ACC' },
  london: { country: 'GB', airport: 'LHR' }, dubai: { country: 'AE', airport: 'DXB' }, paris: { country: 'FR', airport: 'CDG' }, 'new york': { country: 'US', airport: 'JFK' }, amsterdam: { country: 'NL', airport: 'AMS' },
};

const VENUES = { 'sunbet arena': 'pretoria', 'time square': 'pretoria', 'times square': 'pretoria', 'fnb stadium': 'johannesburg', 'soccer city': 'johannesburg', 'ticketpro dome': 'johannesburg', 'ellis park': 'johannesburg', 'loftus': 'pretoria', 'grand arena': 'cape town', 'grandwest': 'cape town', 'kings park': 'durban', 'moses mabhida': 'durban', 'mulungushi': 'lusaka', 'heroes stadium': 'lusaka', 'levy junction': 'lusaka', 'showgrounds': 'lusaka' };

export function cityFromVenue(venue) {
  const v = String(venue || '').toLowerCase();
  for (const [k, city] of Object.entries(VENUES)) if (v.includes(k) && !Object.keys(CITY_INFO).some((c) => v.includes(c))) return { city: cap(city), ...CITY_INFO[city] };
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of parts.slice().reverse()) if (CITY_INFO[p]) return { city: cap(p), ...CITY_INFO[p] };
  for (const [city, info] of Object.entries(CITY_INFO)) if (v.includes(city)) return { city: cap(city), ...info };
  return { city: parts.length ? cap(parts[parts.length - 1]) : '', country: null, airport: null };
}
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** "Sat, Nov 21" (+ e-mail date for the year) → ISO date; picks the next occurrence on/after the e-mail date. */
export function resolveDate(text, emailDate) {
  const m = DATE_IN.exec(text); if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()]; const day = Number(m[3]);
  const base = emailDate ? new Date(emailDate) : new Date();
  let year = m[4] ? Number(m[4]) : base.getUTCFullYear();
  if (!m[4]) { const cand = Date.UTC(year, mon - 1, day); if (cand < base.getTime() - 2 * 86400000) year += 1; }
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const NOISE = /^(artist image|gradient border|header|see upcoming events|all your|events,|all together|live events|get the latest|not interested|-+$|get spotify|\*|if you don|terms of use|privacy policy|contact us|spotify ab)/i;
const VENUE_WORDS = /arena|stadium|lounge|hall|club|theatre|theater|park|dome|centre|center|grounds|pavilion|bar|hotel|amphitheat|field|square|oval|house|garden|room|venue/i;

function cleanLine(l) { return l.replace(/\(\s*https?:[^)]*\)/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(); }

/** Parse the "Upcoming events near you" / recommendations layout (blocks end at "Not interested"). */
function parseRecommendationBlocks(lines, emailDate, subject = '') {
  const events = [];
  // "🎫 Masego Live: Your Fave Just Announced a Show!" — only announcement mails name the artist in the subject
  const subjArtist = /just announced|your fave/i.test(String(subject)) ? ((/^\W*(.+?) live:/i.exec(String(subject)) || [])[1] || null) : null;
  let block = []; let ticketUrls = [];
  const flush = () => {
    const content = block.map(cleanLine).filter((l) => l && !NOISE.test(l) && !/^get tickets/i.test(l));
    const cols = (l) => l.split(/\s*\|\s*/);
    const idx = content.findIndex((l) => cols(l).every((c) => DATE_RE.test(c)));
    const dateLine = idx >= 0 ? content[idx] : null;
    if (dateLine) {
      // only the lines adjacent to the date line belong to this event (the e-mail header sits above the first block)
      const others = content.slice(Math.max(0, idx - 2), idx + 3).filter((l) => l !== dateLine);
      const dates = cols(dateLine);
      // venue line = the one with the most commas / venue words; artist line = the nearest remaining line
      const scored = others.map((l, i) => ({ l, i, score: (l.match(/,/g) || []).length * 2 + (VENUE_WORDS.test(l) ? 3 : 0) }));
      scored.sort((a, b) => b.score - a.score);
      const venueLine = scored[0]?.l || '';
      const rest = others.filter((l) => l !== venueLine);
      const before = content[idx - 1]; const after = content[idx + 1];
      const artistLine = rest.find((l) => l === before && l !== venueLine) || rest.find((l) => l === after) || rest[rest.length - 1] || '';
      const venues = cols(venueLine); let artists = cols(artistLine);
      if (subjArtist && dates.length === 1 && (!artistLine.toLowerCase().includes(subjArtist.toLowerCase()) || artistLine.length > 40)) artists = [subjArtist];
      artists = artists.map((a) => a.replace(/^you're one of .*?top fans\.?\s*/i, '').trim()).filter(Boolean);
      for (let i = 0; i < dates.length; i++) {
        const date = resolveDate(dates[i], emailDate);
        const artist = artists[i] || artists[0] || '';
        const venue = venues[i] || venues[0] || '';
        if (date && artist) events.push({ artist, date, venue, ticket_url: ticketUrls[i] || null, ...cityFromVenue(venue) });
      }
    }
    block = []; ticketUrls = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (/^get tickets/i.test(l)) { for (const u of l.matchAll(/\(\s*(https?:[^)\s]+)\s*\)/g)) ticketUrls.push(u[1]); block.push(l); continue; }
    if (/^not interested/i.test(l)) { flush(); continue; }
    block.push(l);
  }
  if (block.length) flush();
  return events;
}

/** "Grab your tickets to Dave at SunBet Arena Time Square on Sat, Oct 3 now." — the subject ("Dave in Pretoria") carries the city. */
function parseGrabLayout(text, emailDate, subject = '') {
  const out = [];
  const subjCity = /\bin ([A-Z][\w ]+?)\W*$/.exec(String(subject).replace(/[^\w\s.]/g, '').trim());
  for (const m of text.matchAll(new RegExp(`tickets to (.+?) at (.+?) on (${DOW},?\\s+${MON}\\.?\\s+\\d{1,2}(?:,\\s*\\d{4})?)`, 'gi'))) {
    const date = resolveDate(m[3], emailDate); if (!date) continue;
    const venue = m[2].trim(); let info = cityFromVenue(venue);
    if (!info.airport && subjCity) info = cityFromVenue(`${venue}, ${subjCity[1].trim()}`);
    out.push({ artist: m[1].trim(), date, venue, ticket_url: null, ...info });
  }
  return out;
}

/** Entry point. Returns deduped events [{artist,date,venue,city,country,airport,ticket_url,kind}]. */
export function parseSpotifyEmail({ subject = '', text = '', ts = null }) {
  const lines = String(text || '').split(/\r?\n/);
  let events = parseRecommendationBlocks(lines, ts, subject);
  if (!events.length) events = parseGrabLayout(text, ts, subject);
  if (!events.length) {
    // "🎫 Masego Live: Your Fave Just Announced a Show!" — artist from the subject, dates/venues scanned loosely
    const sm = /^\W*(.+?) live:/i.exec(subject) || /^\W*(.+?) in (.+?)\W*$/i.exec(subject);
    if (sm) {
      const dates = [...String(text).matchAll(new RegExp(`${DOW},?\\s+${MON}\\.?\\s+\\d{1,2}(?:,\\s*\\d{4})?`, 'gi'))].map((m) => resolveDate(m[0], ts)).filter(Boolean);
      const venueLine = lines.map(cleanLine).find((l) => VENUE_WORDS.test(l) && l.includes(','));
      if (dates.length) events.push({ artist: sm[1].trim(), date: dates[0], venue: venueLine || (sm[2] ? sm[2].trim() : ''), ticket_url: null, ...cityFromVenue(venueLine || sm[2] || '') });
    }
  }
  const seen = new Set();
  return events.filter((e) => { const k = `${e.artist.toLowerCase()}|${e.date}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function kindFromSubject(subject) {
  const s = String(subject || '');
  if (/recommendations near you/i.test(s)) return 'recommendation';
  if (/just announced/i.test(s)) return 'announcement';
  if (/few tickets left|get your hands on|in \w+\.?\W*$/i.test(s)) return 'ticket_push';
  return 'other';
}
