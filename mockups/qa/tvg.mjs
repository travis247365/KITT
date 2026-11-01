import { open, SHOTS } from './lib.mjs';
const g = await open({ hash: 'appletv', w: 1440, h: 1500 });
await g.shot(`${SHOTS}/tv/gallery.png`); console.log(JSON.stringify({ errors: g.errors })); await g.close();
