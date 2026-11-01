// Re-capture the frames that triage flagged, after the fixes. Run: node qa/after.mjs
import { open, SHOTS } from './lib.mjs';
const D = `${SHOTS}/after`;
const jobs = [
  ['phone-offline-light', 'frame/phone-now?scenario=offline&appearance=light', 393, 852, 1],
  ['watch-alert-dark', 'frame/watch-notif?scenario=pending&appearance=dark', 208, 248, 2],
  ['watch-now-dark', 'frame/watch-now?scenario=pending&appearance=dark', 208, 248, 2],
  ['pad-shoplog-light', 'frame/pad-shoplog?scenario=morning&appearance=light', 1194, 834, 1],
  ['car-pending-dark', 'frame/car?scenario=pending&appearance=dark', 1280, 720, 1],
  ['widgets-light', 'frame/widgets?scenario=morning&appearance=light', 400, 420, 1],
];
for (const [name, hash, w, h, scale] of jobs) {
  const t = await open({ hash, w, h, scale });
  await t.shot(`${D}/${name}.png`);
  const text = await t.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
  console.log(name, JSON.stringify({ errors: t.errors, text }));
  await t.close();
}
