// Screenshot the Apple TV mockups for review. Run: node qa/tv.mjs
import { open, SHOTS } from './lib.mjs';
const D = `${SHOTS}/tv`;
for (const [name, hash] of [['now', 'frame/tv-now?scenario=morning'], ['ok', 'frame/tv-ok'], ['pair', 'frame/tv-pair'], ['shelf', 'frame/tv-shelf?scenario=morning'], ['now-pending', 'frame/tv-now?scenario=pending'], ['now-offline', 'frame/tv-now?scenario=offline']]) {
  const t = await open({ hash, w: 1920, h: 1080 });
  await t.shot(`${D}/${name}.png`);
  console.log(name, JSON.stringify({ errors: t.errors }));
  await t.close();
}
const g = await open({ hash: 'appletv', w: 1440, h: 900 });
await g.shot(`${D}/gallery.png`); console.log('gallery', JSON.stringify({ errors: g.errors })); await g.close();
