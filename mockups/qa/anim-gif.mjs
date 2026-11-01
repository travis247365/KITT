// Record the three status levels sweeping, as a GIF. Run: node qa/anim-gif.mjs
import { open, SHOTS } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const D = `${SHOTS}/anim/frames`; mkdirSync(D, { recursive: true });
const t = await open({ hash: 'appletv', w: 1440, h: 1000 });
const box = await t.page.evaluate(() => { const r = document.querySelector('.tvg2-status').getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }; });
const N = 48, STEP = 80;
await t.page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
for (let i = 0; i < N; i++) {
  await t.page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), i * STEP);
  await t.shot(`${D}/f${String(i).padStart(3, '0')}.png`, { clip: box, animations: 'allow' });
}
console.log(JSON.stringify(box), t.errors); await t.close();
