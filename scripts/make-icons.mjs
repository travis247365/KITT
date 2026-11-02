#!/usr/bin/env node
// Draws the KITT mark (a light bar on a grid: original artwork, no car, no disc, no helmet, no letters in the app icon) and writes every
// icon the apps need: iOS/macOS AppIcon, the tvOS App Icon & Top Shelf brand assets, the PWA icons and the podcast artwork.
//   node scripts/make-icons.mjs      (needs Google Chrome and mockups/qa/node_modules)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../mockups/qa/node_modules/playwright-core/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = fs.readFileSync(path.join(ROOT, 'apps/KITT/KITTtv/Fonts/Orbitron-Bold.ttf')).toString('base64');
const VOID = '#050507', CYAN = '#19e6ff', RED = '#ff2a2a';

// the mark on a w x h canvas: grid floor, two hairlines, the light bar (red core to cyan) with glow
const art = ({ w, h, bar = 0.62, barY = 0.5, grid = true, bg = true, hair = true, glow = true }) => {
  const bw = w * bar, bh = Math.max(6, h * 0.075), x = (w - bw) / 2, y = h * barY - bh / 2;
  const lines = [];
  if (grid) {
    for (let i = 0; i < 6; i++) { const gy = h * (0.64 + i * 0.075); lines.push(`<line x1="0" y1="${gy}" x2="${w}" y2="${gy}"/>`); }
    for (let i = -5; i <= 5; i++) { lines.push(`<line x1="${w / 2 + i * w * 0.045}" y1="${h * 0.62}" x2="${w / 2 + i * w * 0.2}" y2="${h}"/>`); }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${RED}"/><stop offset="0.5" stop-color="#fff"/><stop offset="1" stop-color="${CYAN}"/></linearGradient>
  <filter id="b" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="${bh * 0.9}"/></filter>
  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
  <mask id="m"><rect width="${w}" height="${h}" fill="url(#fade)"/></mask></defs>
  ${bg ? `<rect width="${w}" height="${h}" fill="${VOID}"/>` : ''}
  <g stroke="${CYAN}" stroke-opacity="0.22" stroke-width="${Math.max(1, w / 700)}" mask="url(#m)">${lines.join('')}</g>
  ${hair ? `<g stroke="${CYAN}" stroke-opacity="0.55" stroke-width="${Math.max(1.5, w / 500)}"><line x1="${x}" x2="${x + bw}" y1="${y - bh * 1.6}" y2="${y - bh * 1.6}"/><line x1="${x}" x2="${x + bw}" y1="${y + bh * 2.6}" y2="${y + bh * 2.6}"/></g>` : ''}
  ${glow ? `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="url(#g)" filter="url(#b)" opacity="0.85"/>` : ''}
  <rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="url(#g)"/>
</svg>`;
};
const wordmark = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>@font-face{font-family:O;src:url(data:font/ttf;base64,${font})}text{font-family:O;font-weight:700}</style>
  <text x="${w * 0.07}" y="${h * 0.38}" font-size="${h * 0.15}" letter-spacing="${h * 0.045}" fill="${CYAN}">KITT</text></svg>`;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
async function render(file, w, h, html, { transparent = false } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;background:${transparent ? 'transparent' : VOID};overflow:hidden}svg{display:block;position:absolute;left:0;top:0}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
const json = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const INFO = { author: 'xcode', version: 1 };

// ---- source of truth for the mark -------------------------------------------------------------------------------
fs.writeFileSync(path.join(ROOT, 'apps/KITT/Icon/mark.svg'), art({ w: 1024, h: 1024, bar: 0.62 }));

// ---- iOS + macOS ---------------------------------------------------------------------------------------------------
const AI = path.join(ROOT, 'apps/KITT/KITT/Assets.xcassets/AppIcon.appiconset');
json(path.join(ROOT, 'apps/KITT/KITT/Assets.xcassets/Contents.json'), { info: INFO });
await render(path.join(AI, 'ios-1024.png'), 1024, 1024, art({ w: 1024, h: 1024 }));
const images = [{ filename: 'ios-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }];
for (const [pt, scale] of [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]]) {
  const px = pt * scale, name = `mac-${pt}${scale === 2 ? '@2x' : ''}.png`;
  // macOS icons sit inside a margin (square corners: the brand has radius 0)
  const inner = Math.round(px * 0.8), off = Math.round((px - inner) / 2);
  await render(path.join(AI, name), px, px, `<div style="position:absolute;left:${off}px;top:${off}px">${art({ w: inner, h: inner })}</div>`, { transparent: true });
  images.push({ filename: name, idiom: 'mac', scale: `${scale}x`, size: `${pt}x${pt}` });
}
json(path.join(AI, 'Contents.json'), { images, info: INFO });

// ---- tvOS brand assets ------------------------------------------------------------------------------------------------
const TV = path.join(ROOT, 'apps/KITT/KITTtv/Assets.xcassets');
const BA = path.join(TV, 'App Icon & Top Shelf Image.brandassets');
json(path.join(TV, 'Contents.json'), { info: INFO });
const imageset = (dir, stem, sizes) => json(path.join(dir, 'Contents.json'), { images: sizes.map(([scale]) => ({ idiom: 'tv', filename: `${stem}${scale === 2 ? '@2x' : ''}.png`, scale: `${scale}x` })), info: INFO });
const stack = async (name, w, h) => {
  const dir = path.join(BA, `${name}.imagestack`);
  json(path.join(dir, 'Contents.json'), { info: INFO, layers: [{ filename: 'Front.imagestacklayer' }, { filename: 'Back.imagestacklayer' }] });
  for (const layer of ['Front', 'Back']) {
    const ld = path.join(dir, `${layer}.imagestacklayer`);
    json(path.join(ld, 'Contents.json'), { info: INFO });
    const set = path.join(ld, 'Content.imageset');
    imageset(set, layer.toLowerCase(), [[1], [2]]);
    for (const s of [1, 2]) {
      const html = layer === 'Back' ? art({ w: w * s, h: h * s, bar: 0, hair: false, glow: false }) : art({ w: w * s, h: h * s, bar: 0.5, grid: false, bg: false });
      await render(path.join(set, `${layer.toLowerCase()}${s === 2 ? '@2x' : ''}.png`), w * s, h * s, html, { transparent: layer === 'Front' });
    }
  }
};
await stack('App Icon - Large', 1280, 768);
await stack('App Icon - Small', 400, 240);
for (const [name, w, h] of [['Top Shelf Image', 1920, 720], ['Top Shelf Image Wide', 2320, 720]]) {
  const set = path.join(BA, `${name}.imageset`);
  imageset(set, 'shelf', [[1], [2]]);
  for (const s of [1, 2]) await render(path.join(set, `shelf${s === 2 ? '@2x' : ''}.png`), w * s, h * s, art({ w: w * s, h: h * s, bar: 0.34, barY: 0.62 }) + wordmark(w * s, h * s));
}
json(path.join(BA, 'Contents.json'), { assets: [
  { filename: 'App Icon - Large.imagestack', idiom: 'tv', role: 'primary-app-icon', size: '1280x768' },
  { filename: 'App Icon - Small.imagestack', idiom: 'tv', role: 'primary-app-icon', size: '400x240' },
  { filename: 'Top Shelf Image Wide.imageset', idiom: 'tv', role: 'top-shelf-image-wide', size: '2320x720' },
  { filename: 'Top Shelf Image.imageset', idiom: 'tv', role: 'top-shelf-image', size: '1920x720' },
], info: INFO });

// ---- PWA (mockups) and the podcast artwork --------------------------------------------------------------------------------
await render(path.join(ROOT, 'mockups/public/apple-touch-icon.png'), 180, 180, art({ w: 180, h: 180 }));
await render(path.join(ROOT, 'mockups/public/icon-192.png'), 192, 192, art({ w: 192, h: 192 }));
await render(path.join(ROOT, 'mockups/public/icon-512.png'), 512, 512, art({ w: 512, h: 512 }));
await render(path.join(ROOT, 'apps/KITT/Icon/podcast-1400.png'), 1400, 1400, art({ w: 1400, h: 1400 }));
fs.copyFileSync(path.join(ROOT, 'apps/KITT/Icon/mark.svg'), path.join(ROOT, 'mockups/public/favicon.svg'));
fs.copyFileSync(path.join(ROOT, 'apps/KITT/Icon/mark.svg'), path.join(ROOT, 'mockups/public/icon.svg'));
await browser.close();
console.log('icons written');
