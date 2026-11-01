// Shared QA harness: isolated headless Chrome per script (safe to run several agents in parallel).
// Usage in a script:  import { open } from './lib.mjs';
//   const t = await open({ hash: 'iphone?scenario=pending&appearance=dark', w: 393, h: 852 });
//   await t.shot(`${SHOTS}/x.png`); console.log(await t.page.evaluate(() => document.title)); await t.close();
// Base URL defaults to the production-build preview on :4199; override with QA_BASE (must end with /).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

export const SHOTS = fileURLToPath(new URL('./shots', import.meta.url));
export const BASE = process.env.QA_BASE || 'http://127.0.0.1:4199/';
export async function open({ hash = 'lab', w = 1440, h = 900, scale = 1, reducedMotion = false, colorScheme = 'light', touch = false } = {}) {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', colorScheme, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => errors.push(`requestfailed ${r.url()}`));
  await page.goto(`${BASE}#/${hash}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return { page, ctx, browser, errors, shot: (path, opts = {}) => page.screenshot({ path, ...opts }), close: () => browser.close() };
}
