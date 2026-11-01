import { open, SHOTS } from './lib.mjs';
const t = await open({ hash: 'frame/phone-now?scenario=critical&appearance=dark', w: 393, h: 852 });
await t.shot(`${SHOTS}/smoke.png`);
console.log(JSON.stringify({ title: await t.page.title(), errors: t.errors, text: (await t.page.evaluate(() => document.body.innerText)).slice(0, 120) }));
await t.close();
