#!/usr/bin/env node
// Guard for the always-on TV view: LG webOS 3.5 (2017 TV) ships a ~2014 Chromium. Render /tv with a stub hub and fail on anything that engine cannot run.
// Usage: node scripts/nosleep/check-tv-es5.mjs
import { renderTV } from '../../src/web/tv.js';

const stub = { state: async () => ({ version: '0.1.0', brain: { ok: true }, skills: { money: { ok: true }, chief: { ok: false, name: 'Chief of Staff', detail: 'x' } }, unavailable: [], pending: [{}], coverage: { days: 7, uptime_pct: 50 }, briefs: { morning: { at: new Date().toISOString(), text: 'Good morning.' } } }) };
const html = await renderTV(stub);
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';

const JS_BAD = [[/=>/, 'arrow function'], [/\b(let|const)\s/, 'let/const'], [/`/, 'template literal'], [/\bclass\s+\w/, 'class'], [/\.\.\./, 'spread/rest'], [/\bPromise\b|\basync\b|\bawait\b/, 'promises/async'], [/\bfetch\(/, 'fetch']];
const CSS_BAD = [[/display:\s*grid|grid-template/i, 'CSS grid'], [/(^|[;{\s])gap:/i, 'flex/grid gap'], [/var\(--/, 'CSS variables'], [/backdrop-filter|blur\(/i, 'blur/backdrop-filter'], [/aspect-ratio/i, 'aspect-ratio'], [/\b(clamp|min|max)\(/i, 'min()/max()/clamp()'], [/\binset:/i, 'inset shorthand'], [/:is\(|:where\(|:has\(/i, 'modern selectors']];

const problems = [];
for (const [re, what] of JS_BAD) if (re.test(script)) problems.push(`script uses ${what}`);
for (const [re, what] of CSS_BAD) if (re.test(css)) problems.push(`css uses ${what}`);
if (!/<meta http-equiv="refresh"/.test(html)) problems.push('no meta refresh (a TV page must self-refresh)');
if (html.length > 20000) problems.push(`page is ${html.length} bytes (keep a TV page small)`);

console.log(JSON.stringify({ bytes: html.length, scriptBytes: script.length, cssBytes: css.length, problems }));
if (problems.length) { console.error('TV view is not safe for webOS 3.5:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('TV view passes the ES5 / old-Chromium checks');
