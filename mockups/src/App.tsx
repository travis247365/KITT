import { useEffect, useState, type ReactNode } from 'react';
import { StoreProvider, useStore, type Appearance } from './state';
import { SCENARIOS } from './data';
import type { LayoutPref } from './engine';
import { CAR, PAD, PHONE, CarFrame, PadFrame, PhoneFrame, WatchFrame } from './devices/Frames';
import { FitStage, useNarrow } from './devices/Stage';
import { FRAMES } from './frames';
import { Phone } from './surfaces/Phone';
import { Pad } from './surfaces/Pad';
import { Watch, WATCH_PAGES, type WatchPage } from './surfaces/Watch';
import { Car, CarControls } from './surfaces/Car';
import { Surfaces } from './surfaces/Surfaces';
import { TV_SCREENS, type TvScreen } from './surfaces/AppleTv';
import { TV2_SCREENS, TV2_VARIANTS, type Tv2Screen, type TvVariant } from './surfaces/AppleTv2';
import { TvFullV1, TvFullV2, TvGalleryV1, TvGalleryV2 } from './surfaces/AppleTvPages';
import { Lab, ProtoBar, WATCH_FRAME } from './lab/Lab';
import { Seg } from './kit';

function useHash(): string {
  const [h, setH] = useState(() => window.location.hash.replace(/^#\/?/, ''));
  useEffect(() => { const f = () => setH(window.location.hash.replace(/^#\/?/, '')); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}
function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return w;
}

/** `#/iphone?scenario=critical&appearance=dark&layout=drive&large=1` — deep links that set the demo state. */
function useOverrides(hash: string) {
  const { set, scenario } = useStore();
  useEffect(() => {
    const q = new URLSearchParams(hash.split('?')[1] ?? '');
    const sc = q.get('scenario'); if (sc && SCENARIOS.some((s) => s.id === sc)) scenario(sc as (typeof SCENARIOS)[number]['id']);
    const ap = q.get('appearance') as Appearance | null; if (ap && ['system', 'light', 'dark'].includes(ap)) set({ appearance: ap });
    const ly = q.get('layout') as LayoutPref | null; if (ly && ['auto', 'drive', 'glance', 'desk'].includes(ly)) set({ layout: ly });
    if (q.has('large')) set({ large: q.get('large') === '1' });
  }, [hash]); // eslint-disable-line
}

const Fixed = ({ children, bg = '#2b2b2b' }: { children: ReactNode; bg?: string }) => <div style={{ position: 'fixed', inset: 0, background: bg, display: 'flex', flexDirection: 'column' }}>{children}</div>;


function Routes() {
  const hash = useHash(); const w = useWidth(); const narrow = useNarrow(520); const bareIpad = useNarrow(1300);
  const [watchPage, setWatchPage] = useState<WatchPage>('face');
  useOverrides(hash);
  const route = hash.split('?')[0].replace(/\/$/, '');
  const r = route || (w <= 520 ? 'iphone' : w < 1100 ? 'ipad' : 'lab');

  if (r.startsWith('frame/')) {
    const f = FRAMES[r.slice(6)];
    return f ? <div id="frame" data-ready="1" style={{ width: f.w, height: f.h, position: 'relative', overflow: 'hidden' }}>{f.el}</div> : <p style={{ color: '#fff', padding: 24 }}>Unknown frame. Try: {Object.keys(FRAMES).join(', ')}</p>;
  }
  if (r.startsWith('appletv/')) {
    const [, sc, vr] = r.split('/');
    const screen = (TV2_SCREENS.find((t) => t.id === sc)?.id ?? 'now') as Tv2Screen;
    const variant = (TV2_VARIANTS.find((v) => v.id === vr)?.id ?? 'hybrid') as TvVariant;
    return <TvFullV2 screen={screen} variant={variant} />;
  }
  if (r.startsWith('appletv-v1/')) return <TvFullV1 screen={(TV_SCREENS.find((t) => t.id === r.slice(11))?.id ?? 'now') as TvScreen} />;
  switch (r) {
    case 'iphone':
      if (narrow) return <div style={{ position: 'fixed', inset: 0 }}><Phone bleed /></div>;
      return <Fixed><div style={{ flex: 1, minHeight: 0 }}><FitStage width={PHONE.w + 20} height={PHONE.h + 20} padding={24} maxScale={1.4}><PhoneFrame><Phone /></PhoneFrame></FitStage></div><ProtoBar /></Fixed>;
    case 'ipad':
      return <Fixed><div style={{ flex: 1, minHeight: 0 }}>{bareIpad ? <FitStage width={PAD.w} height={PAD.h} maxScale={1.6}><div style={{ width: PAD.w, height: PAD.h }}><Pad /></div></FitStage> : <FitStage width={PAD.w + 20} height={PAD.h + 20} padding={24}><PadFrame><Pad /></PadFrame></FitStage>}</div><ProtoBar /></Fixed>;
    case 'watch':
      return <Fixed><div style={{ flex: 1, minHeight: 0 }}><FitStage width={WATCH_FRAME.w} height={WATCH_FRAME.h} padding={20} maxScale={2.4}><WatchFrame><Watch page={watchPage} onPage={setWatchPage} /></WatchFrame></FitStage></div><div style={{ display: 'flex', justifyContent: 'center', padding: '8px 16px 64px' }} data-theme="dark"><Seg<WatchPage> label="Watch page" value={watchPage} onChange={setWatchPage} options={WATCH_PAGES.map((p) => ({ value: p.id, label: p.label }))} /></div><ProtoBar /></Fixed>;
    case 'car':
      return <Fixed><div style={{ flex: 1, minHeight: 0 }}><FitStage width={CAR.w + 20} height={CAR.h + 20} padding={24}><CarFrame><Car /></CarFrame></FitStage></div><div style={{ padding: '0 16px 64px', display: 'flex', justifyContent: 'center' }} data-theme="dark"><CarControls /></div><ProtoBar /></Fixed>;
    case 'appletv':
      return <div style={{ position: 'fixed', inset: 0, overflow: 'auto' }}><TvGalleryV2 /></div>;
    case 'appletv-v1':
      return <div style={{ position: 'fixed', inset: 0, overflow: 'auto' }}><TvGalleryV1 /></div>;
    case 'surfaces':
      return <div style={{ position: 'fixed', inset: 0, overflow: 'auto', background: '#3a3a3a' }}><Surfaces /><ProtoBar /></div>;
    default:
      return <div style={{ position: 'fixed', inset: 0, overflow: 'auto', background: '#3a3a3a' }}><Lab /></div>;
  }
}

export function App() { return <StoreProvider><Routes /></StoreProvider>; }
