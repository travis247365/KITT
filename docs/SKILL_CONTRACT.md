# KITT skill contract (v0.1)

Every capability is a **skill** in `src/skills/<id>/index.js`. The hub loads the skills listed in `config.skills.enabled`,
runs their migrations, registers their routines, and routes voice intents to them. A skill that fails to load is reported
as *unavailable* and never takes the hub down.

```js
export default function define(ctx) {
  return {
    id: 'money',                      // must equal the folder name
    name: 'Money Dashboard',
    description: 'one line, spoken in "Kit, help"',
    aliases: ['cash'],                // optional: extra names for `kitt brief <alias>`
    migrations: [ 'CREATE TABLE IF NOT EXISTS money_tx (...)' ],   // versioned by index; append, never edit
    intents: [
      { name: 'position', description: 'cash position across wallets', examples: ["what's my cash position"],
        patterns: ["(what's|what is) my cash position", 'cash position'], slots: [] },
      { name: 'log_cash', description: 'log a cash spend', examples: ['log cash 200 fuel'],
        patterns: ['log cash {amount} {note}', 'log cash {amount}'], slots: ['amount', 'note'], write: true },
    ],
    routines: [ { name: 'money.daily_rollup', cron: '0 6 * * *', description: '...', catchUpMinutes: 360, run: async (ctx) => ({ summary, speak?, notify?: { push?: {title, body, tags, priority}, email?: {subject, html, text} } }) } ],
    async handle(intent, slots, ctx) { return { speak, display?, confirm?: { summary, action } }; },
    async execute(action, ctx) { return { speak }; },      // required when any intent has write:true
    async brief(ctx) { return { speak, decisions? } | string | null; }, // ctx.kind = 'morning' | 'evening' | 'full'; decisions = how many things need the owner's decision (the brief says the total second)
    async health(ctx) { return { ok, detail }; },
    async dashboard(app) { return '<table>…</table>'; },    // optional HTML panel (escape everything)
    routes: [ { method: 'POST', path: '/import', scope: 'write', handler: async (c) => ({...}) } ], // mounted at /v1/<id>/import
  };
}
```

## The context object (`ctx`)
`db` (node:sqlite DatabaseSync) · `kv.get/set/del/list(ns,key)` · `config` · `secrets` (never log) · `paths` · `log` ·
`brain.speak(prompt)`, `brain.extract(prompt, schema)`, `brain.classify` · `notifier.push/email` · `composio.execute(slug, params)` ·
`skills` (other loaded skills by id) · `tz` · per-call: `source` (siri|cli|cron|api|whatsapp), `text`, `now`.
Shared services live in `src/services/` (gmail, calendar) — instantiate once in `define()`.

## Rules
1. **Deterministic first.** Parse, count and decide in code. Use `brain` only to turn facts into speech or to extract from free text.
2. **Speak for a driver.** Under 80 words per answer; lead with the number or the decision; no symbols. The hub runs `speakable()` on
   everything, but write plain English in the first place. Long answers: return the lot — the hub clips and offers "Kit, more".
3. **Writes need confirmation.** Return `confirm: { summary, action }` from `handle()`; the hub speaks the summary, waits for
   "Kit, confirm", then calls `execute(action)`. Never send email/WhatsApp/DMs — create drafts.
4. **Never break the brief.** `brief()` must return within 25 s or return `null`. Catch your own errors; return a one-sentence
   degraded answer ("Mail is unreachable right now") rather than throwing.
5. **Own your tables.** Prefix with the skill id. Store provenance with every derived number (`EXTRACTED`, `INFERRED`, `ASSUMED`).
6. **Composio links.** When `composio.execute` throws with `needsLink`, say which toolkit and surface it in `health()`.
7. **Tests.** `test/skills/<id>.test.js` with fixtures only — no network, no `claude -p`. Parsers get table-driven tests.
8. **Secrets** come from `ctx.secrets` (KITT_* in `~/.config/kitt/kitt.env`); document each one in `docs/SETUP.md`.
9. **Client data** (company clients, staff, customers) stays local; never put it in a push notification title or an email subject.
