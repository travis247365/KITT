// Merchant rules for the Subscription Auditor. Each rule: how to recognise the sender/subject, what kind of mail it is,
// and defaults for cadence/category. Amounts are extracted generically (see extractAmount) unless a rule overrides.
export const KINDS = ['receipt', 'confirmation', 'expiring', 'past_due', 'paused', 'renewal_notice', 'cancelled'];

export const RULES = [
  { merchant: 'apple', display: 'Apple (iCloud+, App Store)', from: /apple\.com$/, subject: /billing problem|credit card was declined|payment (failed|problem|declined)|update your payment/i, kind: 'past_due', category: 'software' },
  { merchant: 'spotify', display: 'Spotify Premium', from: /spotify\.com$/, subject: /payment (failed|problem|declined)|couldn.t process|update your payment/i, kind: 'past_due', category: 'media' },
  { merchant: 'apple', display: 'Apple (iCloud+, App Store)', from: /apple\.com$/, subject: /receipt from apple/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'apple', display: 'Apple (iCloud+, App Store)', from: /apple\.com$/, subject: /subscription is confirmed/i, kind: 'confirmation', category: 'software' },
  { merchant: 'apple', display: 'Apple (iCloud+, App Store)', from: /apple\.com$/, subject: /subscription is expiring|will expire/i, kind: 'expiring', category: 'software' },
  { merchant: 'apple', display: 'Apple (iCloud+, App Store)', from: /apple\.com$/, subject: /subscription (has been )?cancell?ed|renewal.*(failed|problem)/i, kind: 'cancelled', category: 'software' },
  { merchant: 'spotify', display: 'Spotify Premium', from: /spotify\.com$/, subject: /order confirmation|receipt|payment/i, kind: 'receipt', category: 'media', cadence: 'monthly' },
  { merchant: 'googleplay', display: 'Google Play subscriptions', from: /google\.com$/, subject: /order receipt/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'anthropic', display: 'Anthropic (Claude)', from: /anthropic\.com$/, subject: /receipt|invoice/i, kind: 'receipt', category: 'ai', cadence: 'monthly' },
  { merchant: 'anthropic', display: 'Anthropic (Claude)', from: /anthropic\.com$/, subject: /paused|payment (was )?unsuccessful|failed/i, kind: 'past_due', category: 'ai' },
  { merchant: 'microsoft', display: 'Microsoft 365', from: /microsoft\.com$/, subject: /past due|pay your/i, kind: 'past_due', category: 'software', cadence: 'monthly' },
  { merchant: 'microsoft', display: 'Microsoft 365', from: /microsoft\.com$/, subject: /invoice|receipt|order confirmation/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'cloudflare', display: 'Cloudflare', from: /cloudflare\.com$/, subject: /invoice/i, kind: 'receipt', category: 'infra', cadence: 'monthly' },
  { merchant: 'vercel', display: 'Vercel', from: /vercel\.com$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'infra', cadence: 'monthly' },
  { merchant: 'fly', display: 'Fly.io', from: /fly\.io$/, subject: /invoice|receipt|payment|overdue|past due/i, kind: 'receipt', category: 'infra', cadence: 'monthly' },
  { merchant: 'fly', display: 'Fly.io', from: /fly\.io$/, subject: /overdue|past due|failed/i, kind: 'past_due', category: 'infra' },
  { merchant: 'github', display: 'GitHub', from: /github\.com$/, subject: /receipt|payment|invoice/i, kind: 'receipt', category: 'infra', cadence: 'monthly' },
  { merchant: 'notion', display: 'Notion', from: /notion\.so$|makenotion\.com$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'canva', display: 'Canva', from: /canva\.com$/, subject: /receipt|invoice|payment|renew/i, kind: 'receipt', category: 'software', cadence: 'annual' },
  { merchant: 'adobe', display: 'Adobe', from: /adobe\.com$/, subject: /receipt|invoice|payment|renew/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'zoom', display: 'Zoom', from: /zoom\.us$/, subject: /receipt|invoice|payment|renew/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'netflix', display: 'Netflix', from: /netflix\.com$/, subject: /payment|receipt|price|membership/i, kind: 'receipt', category: 'media', cadence: 'monthly' },
  { merchant: 'showmax', display: 'Showmax', from: /showmax\.com$/, subject: /payment|receipt|renew/i, kind: 'receipt', category: 'media', cadence: 'monthly' },
  { merchant: 'dstv', display: 'DStv / MultiChoice', from: /dstv\.com$|multichoice\.com$/, subject: /payment|receipt|due|renew/i, kind: 'receipt', category: 'media', cadence: 'monthly' },
  { merchant: 'ngrok', display: 'ngrok', from: /ngrok\.com$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'infra', cadence: 'monthly' },
  { merchant: 'composio', display: 'Composio', from: /composio\.dev$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'ai', cadence: 'monthly' },
  { merchant: 'firecrawl', display: 'Firecrawl', from: /firecrawl\.dev$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'ai', cadence: 'monthly' },
  { merchant: 'openai', display: 'OpenAI (ChatGPT)', from: /openai\.com$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'ai', cadence: 'monthly' },
  { merchant: 'zapier', display: 'Zapier', from: /zapier\.com$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'namecheap', display: 'Namecheap domains', from: /namecheap\.com$/, subject: /receipt|invoice|renew|order/i, kind: 'receipt', category: 'infra', cadence: 'annual' },
  { merchant: 'godaddy', display: 'GoDaddy', from: /godaddy\.com$/, subject: /receipt|invoice|renew|order/i, kind: 'receipt', category: 'infra', cadence: 'annual' },
  { merchant: 'supabase', display: 'Supabase', from: /supabase\.(com|io)$/, subject: /receipt|invoice|payment/i, kind: 'receipt', category: 'infra', cadence: 'monthly' },
  { merchant: 'linkedin', display: 'LinkedIn Premium', from: /linkedin\.com$/, subject: /receipt|invoice|payment|premium/i, kind: 'receipt', category: 'software', cadence: 'monthly' },
  { merchant: 'vehicle_insurance', display: 'Vehicle insurance', from: /stanbic\.com$/, subject: /insurance.*renewal/i, kind: 'renewal_notice', category: 'insurance', cadence: 'annual' },
];

/** Sender domains used to build the Gmail query (Gmail's from: matches domains without wildcards). */
export const DOMAINS = ['apple.com', 'spotify.com', 'google.com', 'anthropic.com', 'microsoft.com', 'cloudflare.com', 'vercel.com', 'fly.io', 'github.com', 'notion.so', 'makenotion.com', 'canva.com', 'adobe.com', 'zoom.us', 'netflix.com', 'showmax.com', 'dstv.com', 'multichoice.com', 'ngrok.com', 'composio.dev', 'firecrawl.dev', 'openai.com', 'zapier.com', 'namecheap.com', 'godaddy.com', 'supabase.com', 'supabase.io', 'linkedin.com', 'stanbic.com'];

/** Senders that look like receipts but are income or one-off payments, not subscriptions. */
export const EXCLUDE = [
  { from: /zohobooks\.com$|zoho\.com$/, why: 'TPCL invoicing (income), not a subscription' },
  { from: /fnbzambia\.co\.zm$/, why: 'bank payment receipts belong to the Money skill' },
  { from: /zra\.org\.zm$/, why: 'tax receipts' },
];

export function matchRule(msg) {
  const email = String(msg.sender_email || '').toLowerCase();
  const subject = String(msg.subject || '');
  for (const ex of EXCLUDE) if (ex.from.test(email)) return { excluded: true, why: ex.why };
  for (const r of RULES) if (r.from.test(email) && r.subject.test(subject)) return { rule: r };
  return null;
}

const CURRENCY = [
  [/US\$\s?([\d,]+(?:\.\d{1,2})?)/i, 'USD'], [/USD\s?([\d,]+(?:\.\d{1,2})?)/i, 'USD'], [/\$\s?([\d,]+(?:\.\d{1,2})?)/, 'USD'],
  [/ZMW\s?([\d,]+(?:\.\d{1,2})?)/i, 'ZMW'], [/\bK\s?([\d,]+(?:\.\d{1,2})?)\b/, 'ZMW'],
  [/€\s?([\d,]+(?:\.\d{1,2})?)/, 'EUR'], [/£\s?([\d,]+(?:\.\d{1,2})?)/, 'GBP'], [/\bR\s?([\d,]+(?:\.\d{2}))\b/, 'ZAR'],
];

/** Pull the most plausible charged amount from text: prefer the amount nearest to "total"/"amount"/"charged". */
export function extractAmount(text) {
  const t = String(text || '');
  if (!t) return null;
  const hits = [];
  for (const [re, ccy] of CURRENCY) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(t))) { const v = Number(m[1].replace(/,/g, '')); if (Number.isFinite(v) && v >= 0) hits.push({ amount: v, currency: ccy, index: m.index }); }
  }
  if (!hits.length) return null;
  // de-duplicate the same position matched by several patterns (US$ vs $)
  hits.sort((a, b) => a.index - b.index);
  const dedup = hits.filter((h, i) => i === 0 || h.index !== hits[i - 1].index);
  // prefer the amount that follows the LAST "total"/"charged" anchor ("Subtotal" does not count)
  let anchor = null; const anchorRe = /\b(total|amount (?:due|charged|paid)|charged|you paid|payment of)\b/gi; let am;
  while ((am = anchorRe.exec(t))) anchor = am;
  if (anchor) {
    const near = dedup.filter((h) => h.index >= anchor.index).sort((a, b) => a.index - b.index)[0];
    if (near) return { amount: near.amount, currency: near.currency, provenance: 'EXTRACTED' };
  }
  return { amount: dedup[0].amount, currency: dedup[0].currency, provenance: 'EXTRACTED' };
}

export function extractCadence(text) {
  const t = String(text || '');
  if (/\b(annual|yearly|per year|\/\s?year|\/\s?yr|12 months)\b/i.test(t)) return 'annual';
  if (/\b(monthly|per month|\/\s?month|\/\s?mo)\b/i.test(t)) return 'monthly';
  if (/\b(weekly|per week)\b/i.test(t)) return 'weekly';
  return null;
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** "Renews 3 November 2026" / "renews on Nov 3, 2026" → ISO date. */
export function extractRenewalDate(text) {
  const t = String(text || '');
  let m = /renews?(?: on)?\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  m = /renews?(?: on)?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  m = /(?:expires?|will expire|renewal date)[^\d]{0,20}(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
}

function iso(y, mo, d) { if (!y || !mo || !d || d > 31) return null; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

/** Product/plan name heuristics for the display label: "iCloud+ with 2 TB (Monthly)", "Premium Family". */
export function extractPlan(text) {
  const t = String(text || '');
  const m = /(iCloud\+[^.\n]{0,45}|Apple One[^.\n]{0,20}|Premium (?:Family|Duo|Individual|Student)|Microsoft 365[^.\n]{0,20}|Claude (?:Pro|Max)[^.\n]{0,10}|ChatGPT (?:Plus|Pro)|Pro Plan|Business Plan|Annual Plan[^.\n]{0,25}|Monthly Plan[^.\n]{0,25}|Paste[^.\n]{0,30})/i.exec(t);
  if (!m) return null;
  let plan = m[1];
  const close = plan.indexOf(')');
  if (close > 0) plan = plan.slice(0, close + 1); // "iCloud+ with 2 TB (Monthly) Renews…" → stop at the plan's closing bracket
  else if (plan.includes('(')) plan = plan.slice(0, plan.indexOf('('));
  return plan.trim().replace(/\s+/g, ' ');
}
