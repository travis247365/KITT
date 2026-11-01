// Deterministic triage for the AI Receptionist. Runs before any LLM; the LLM only summarises what the rules let through.
export const CATEGORIES = ['NEEDS_REPLY', 'FYI', 'RECEIPT', 'EVENT', 'CALENDAR', 'LINKEDIN_DM', 'NEWSLETTER', 'NOISE'];

const RECEIPT_SENDERS = /apple\.com$|spotify\.com$|google\.com$|anthropic\.com$|microsoft\.com$|cloudflare\.com$|vercel\.com$|fly\.io$|github\.com$|notion\.so$|zohobooks\.com$|zoho\.com$|fnbzambia\.co\.zm$|zra\.org\.zm$|stripe\.com$|paypal\.com$|namecheap\.com$/i;
const RECEIPT_SUBJECT = /receipt|invoice|order confirmation|payment (received|confirmation|successful)|past due|renew|subscription|statement|e-?tax/i;
const AUTOMATED = /^(no-?reply|noreply|notifications?|notify|mailer-daemon|postmaster|do-?not-?reply|donotreply|alerts?|newsletter|news|hello|team|support|info|marketing|updates?|digest|calendar-notification|drive-shares-dm-noreply|comments-noreply)[@._-]/i;

export function triage(m, { vips = [], clientDomains = [], ownerEmails = [] } = {}) {
  const email = String(m.sender_email || '').toLowerCase();
  const name = String(m.sender_name || '');
  const subject = String(m.subject || '');
  const labels = safeLabels(m.labels);
  const domain = email.split('@')[1] || '';
  const vip = vips.some((v) => v.includes('@') ? v.toLowerCase() === email : (new RegExp(`\\b${escapeRe(v)}\\b`, 'i').test(name) || new RegExp(`\\b${escapeRe(v)}\\b`, 'i').test(email.split('@')[0].replace(/[._]/g, ' '))));
  const client = clientDomains.some((d) => domain === d.toLowerCase() || domain.endsWith('.' + d.toLowerCase()));
  const base = { vip: vip || client ? 1 : 0, client: client ? 1 : 0, decided_by: 'rule' };
  if (ownerEmails.map((e) => e.toLowerCase()).includes(email)) return { ...base, category: 'NOISE', why: 'own message' };
  if (/linkedin\.com$/.test(domain)) {
    if (/messaged you|sent you a message|new message|replied to your message|invitation to connect/i.test(subject) || /^messages-noreply/.test(email)) return { ...base, category: 'LINKEDIN_DM', why: 'LinkedIn message notification' };
    return { ...base, category: 'NOISE', why: 'LinkedIn digest' };
  }
  if (/spotify\.com$/.test(domain) && /concert|tickets|live|tour|events/i.test(subject)) return { ...base, category: 'EVENT', why: 'Spotify concert mail' };
  if (/calendar-notification@google\.com|calendar@|invitation|accepted:|declined:|updated invitation|tentatively accepted/i.test(`${email} ${subject}`)) return { ...base, category: 'CALENDAR', why: 'calendar traffic' };
  if (RECEIPT_SENDERS.test(domain) && RECEIPT_SUBJECT.test(subject)) return { ...base, category: 'RECEIPT', why: 'receipt sender + subject' };
  if (RECEIPT_SUBJECT.test(subject) && AUTOMATED.test(email)) return { ...base, category: 'RECEIPT', why: 'receipt-like automated mail' };
  if (labels.includes('CATEGORY_PROMOTIONS')) return { ...base, category: 'NOISE', why: 'promotions tab' };
  if (labels.includes('CATEGORY_SOCIAL')) return { ...base, category: 'NOISE', why: 'social tab' };
  if (labels.includes('CATEGORY_FORUMS')) return { ...base, category: 'FYI', why: 'forums tab' };
  if (vip || client) return { ...base, category: 'NEEDS_REPLY', why: vip ? 'VIP sender' : 'client domain' };
  if (AUTOMATED.test(email) || labels.includes('CATEGORY_UPDATES')) return { ...base, category: /unsubscribe|digest|weekly|newsletter/i.test(subject) ? 'NEWSLETTER' : 'FYI', why: 'automated sender' };
  // a human, writing to Travis directly, in Primary → wants a reply
  if (labels.includes('CATEGORY_PERSONAL') || !labels.some((l) => l.startsWith('CATEGORY_'))) return { ...base, category: 'NEEDS_REPLY', why: 'human sender in Primary' };
  return { ...base, category: 'FYI', why: 'default' };
}

function safeLabels(l) { if (Array.isArray(l)) return l; try { return JSON.parse(l || '[]'); } catch { return []; } }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Strip quoted replies and signatures so the spoken summary is about the new text only. */
export function newTextOnly(body) {
  let t = String(body || '');
  t = t.split(/\n(?:On .{5,120} wrote:|From: .+|-----Original Message-----|> )/)[0];
  t = t.split(/\n(?:--\s*$|warm regards|kind regards|best regards|regards,|thanks,|cheers,|sent from my)/i)[0];
  return t.replace(/\s+\n/g, '\n').trim();
}
