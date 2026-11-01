// Screenshot the Design System v2 Apple TV mockups. Run: node qa/tv2.mjs
import { open, SHOTS } from './lib.mjs';
const D = `${SHOTS}/tv2`;
for (const [name, hash] of [['now-hybrid', 'frame/tv2-now?scenario=morning'], ['now-scanner', 'frame/tv2-now-scanner?scenario=morning'], ['now-grid', 'frame/tv2-now-grid?scenario=morning'], ['ok', 'frame/tv2-ok'], ['pair', 'frame/tv2-pair'], ['shelf', 'frame/tv2-shelf?scenario=morning'], ['now-pending', 'frame/tv2-now?scenario=pending'], ['now-critical', 'frame/tv2-now?scenario=critical']]) {
  const t = await open({ hash, w: 1920, h: 1080 });
  await t.page.emulateMedia({ reducedMotion: 'reduce' });
  await t.shot(`${D}/${name}.png`);
  console.log(name, JSON.stringify({ errors: t.errors }));
  await t.close();
}
const g = await open({ hash: 'appletv', w: 1440, h: 2000 });
await g.shot(`${D}/gallery.png`); console.log('gallery', JSON.stringify({ errors: g.errors })); await g.close();
