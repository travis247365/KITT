import { open, SHOTS } from './lib.mjs';
const D = `${SHOTS}/anim`;
for (const [n, h] of [['ok', 'frame/tv2-ok'], ['pair', 'frame/tv2-pair'], ['shelf', 'frame/tv2-shelf?scenario=critical'], ['now-critical', 'frame/tv2-now?scenario=critical'], ['now-quiet', 'frame/tv2-now?scenario=quiet'], ['now-scanner-critical', 'frame/tv2-now-scanner?scenario=critical']]) {
  const t = await open({ hash: h, w: 1920, h: 1080 });
  await t.page.evaluate(() => document.getAnimations().forEach((an) => { an.pause(); an.currentTime = 0.5 * an.effect.getTiming().duration; }));
  await t.page.waitForTimeout(80);
  await t.shot(`${D}/screen-${n}.png`); console.log(n, JSON.stringify(t.errors)); await t.close();
}
