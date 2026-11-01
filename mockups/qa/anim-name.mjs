// Contact sheet of the KITT name at 5 poses of the sweep for each level. Run: node qa/anim-name.mjs
import { open, SHOTS } from './lib.mjs';
const D = `${SHOTS}/anim`;
const rows = [];
for (const [name, hash] of [['green', 'frame/tv2-now?scenario=quiet'], ['amber', 'frame/tv2-now?scenario=morning'], ['critical', 'frame/tv2-now?scenario=critical']]) {
  const t = await open({ hash, w: 1920, h: 1080 });
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    await t.page.evaluate((f) => document.getAnimations().forEach((an) => { an.pause(); an.currentTime = f * an.effect.getTiming().duration - (f === 1 ? 1 : 0); }), f);
    await t.page.waitForTimeout(60);
    const p = `${D}/name-${name}-${f * 100}.png`;
    await t.shot(p, { clip: { x: 170, y: 105, width: 190, height: 60 } });
    rows.push(p);
  }
  await t.close();
}
console.log(rows.join('\n'));
