// Verify the animated top border + KITT name per status level. Run: node qa/anim.mjs
import { open, SHOTS } from './lib.mjs';
const D = `${SHOTS}/anim`;
const cases = [['green', 'frame/tv2-now?scenario=quiet'], ['amber', 'frame/tv2-now?scenario=morning'], ['critical', 'frame/tv2-now?scenario=critical'], ['amber-offline', 'frame/tv2-now?scenario=offline'], ['amber-pending', 'frame/tv2-now?scenario=pending']];
for (const [name, hash] of cases) {
  const t = await open({ hash, w: 1920, h: 1080 });
  const info = await t.page.evaluate(() => {
    const bar = document.querySelector('.sb'), i = document.querySelector('.sb i'), kn = document.querySelector('.kn');
    const a = (el) => el.getAnimations().map((x) => ({ name: x.animationName, state: x.playState, dur: x.effect.getTiming().duration }));
    return { level: bar.dataset.level, knLevel: kn.dataset.level, bar: a(i), name: a(kn), chip: document.querySelector('.tv2-chip').textContent };
  });
  console.log(name, JSON.stringify(info));
  // pause both animations at 0%, 50%, 100% of the first leg to inspect the three poses
  for (const [tag, f] of [['a', 0.02], ['b', 0.5], ['c', 0.98]]) {
    await t.page.evaluate((f) => document.getAnimations().forEach((an) => { an.pause(); an.currentTime = f * an.effect.getTiming().duration; }), f);
    await t.page.waitForTimeout(80);
    await t.shot(`${D}/${name}-${tag}.png`, { clip: { x: 0, y: 40, width: 1920, height: 200 } });
  }
  console.log(name, 'errors', JSON.stringify(t.errors));
  await t.close();
}
// reduced motion: both frozen
const r = await open({ hash: 'frame/tv2-now?scenario=critical', w: 1920, h: 1080, reducedMotion: true });
console.log('reduced', JSON.stringify(await r.page.evaluate(() => ({ bar: document.querySelector('.sb i').getAnimations().length, name: document.querySelector('.kn').getAnimations().length }))));
await r.shot(`${D}/critical-reduced.png`, { clip: { x: 0, y: 40, width: 1920, height: 200 } });
await r.close();
const g = await open({ hash: 'appletv', w: 1440, h: 2300 });
await g.page.waitForTimeout(300);
await g.shot(`${D}/gallery.png`);
console.log('gallery errors', JSON.stringify(g.errors)); await g.close();
