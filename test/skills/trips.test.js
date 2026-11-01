import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpotifyEmail, resolveDate, cityFromVenue, kindFromSubject } from '../../src/skills/trips/parse.js';

const RECO = `header https://open.spotify.com/concerts
Upcoming events near you
Gradient border https://open.spotify.com/concerts
artist image 1 https://attr.spotify.com/events/v1/webtickets/4cnK?p=1
Gradient border https://open.spotify.com/concerts
DJ Maphorisa
Sat, Nov 21
GENYSIS LOUNGE, Refilwe
get tickets ( https://attr.spotify.com/events/v1/webtickets/4cnK?p=1&concert_uri=spotify:concert:4cnK )
Not interested ( https://open.spotify.com/concert/4cnK?notInterested=1 )
artist image 2 https://attr.spotify.com/events/v1/ticketmaster/4r0B?p=1 | artist image 3 https://attr.spotify.com/events/v1/webtickets/3jjD?p=1
Sat, Jan 09 | Thu, Dec 17
Tyla | Brandy
SunBet Arena Time Square, Pretoria | Sunbet Arena, Times Square, Pretoria, Pretoria
get tickets ( https://attr.spotify.com/events/v1/ticketmaster/4r0B?p=1 ) | get tickets ( https://attr.spotify.com/events/v1/webtickets/3jjD?p=1 )
Not interested ( https://open.spotify.com/concert/4r0B?notInterested=1 ) | Not interested ( https://open.spotify.com/concert/3jjD?notInterested=1 )
All your
Events,
All together | Live Events https://open.spotify.com/concerts
see upcoming events ( https://open.spotify.com/concerts )`;

test('spotify recommendation layout → three events with resolved years and cities', () => {
  const ev = parseSpotifyEmail({ subject: 'DJ Maphorisa, Tyla live: personalised concert recommendations near you', text: RECO, ts: '2026-10-25T15:49:52Z' });
  assert.equal(ev.length, 3);
  const [a, b, c] = ev;
  assert.deepEqual([a.artist, a.date, a.venue, a.city, a.country, a.airport], ['DJ Maphorisa', '2026-11-21', 'GENYSIS LOUNGE, Refilwe', 'Refilwe', 'ZA', 'JNB']);
  assert.match(a.ticket_url, /webtickets\/4cnK/);
  assert.deepEqual([b.artist, b.date, b.city], ['Tyla', '2027-01-09', 'Pretoria']);
  assert.match(b.ticket_url, /ticketmaster\/4r0B/);
  assert.deepEqual([c.artist, c.date, c.city], ['Brandy', '2026-12-17', 'Pretoria']);
});

test('grab-your-tickets layout and subject-only fallback', () => {
  const g = parseSpotifyEmail({ subject: '🎫 Dave in Pretoria. 🎫', text: 'Few tickets left! header get tickets artist image 1 Grab your tickets to Dave at SunBet Arena Time Square on Sat, Oct 3 now. The clock is ticking!', ts: '2026-09-20T20:46:54Z' });
  assert.equal(g.length, 1); assert.deepEqual([g[0].artist, g[0].date, g[0].city], ['Dave', '2026-10-03', 'Pretoria']);
  const f = parseSpotifyEmail({ subject: '🎫 Masego Live: Your Fave Just Announced a Show!', text: "You're one of Masego's top fans. Masego\nFri, Aug 14\nThe Pavilion, Cape Town\nGET THE DETAILS", ts: '2026-06-28T06:52:51Z' });
  assert.equal(f.length, 1); assert.deepEqual([f[0].artist, f[0].date, f[0].city, f[0].airport], ['Masego', '2026-08-14', 'Cape Town', 'CPT']);
  assert.equal(kindFromSubject('🎫 Get your hands on Kabza De Small tickets. 🎫'), 'ticket_push');
  assert.equal(kindFromSubject('Tyla, Brandy live: personalized concert recommendations near you'), 'recommendation');
});

test('date and city helpers', () => {
  assert.equal(resolveDate('Sat, Jan 09', '2026-10-25T00:00:00Z'), '2027-01-09');
  assert.equal(resolveDate('Sat, Nov 21', '2026-10-25T00:00:00Z'), '2026-11-21');
  assert.equal(resolveDate('Mon, Oct 26, 2026', '2026-10-25T00:00:00Z'), '2026-10-26');
  assert.deepEqual(cityFromVenue('FNB Stadium, Soccer City Ave, Nasrec, Johannesburg'), { city: 'Johannesburg', country: 'ZA', airport: 'JNB' });
  assert.deepEqual(cityFromVenue('Some Hall, Lusaka'), { city: 'Lusaka', country: 'ZM', airport: 'LUN' });
  assert.equal(cityFromVenue('Mystery Venue, Nowhere').airport, null);
});
