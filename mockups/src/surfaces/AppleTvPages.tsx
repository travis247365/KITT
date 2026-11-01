// Pages for the Apple TV mockups: the v2 gallery (with the three-direction comparison), the full-size interactive screen, and the v1 (TPCL) pages kept as they were.
import { ScaledBox, FitStage } from '../devices/Stage';
import { ProtoBar } from '../lab/Lab';
import { AppleTv, TV, TV_SCREENS, type TvScreen } from './AppleTv';
import { AppleTv2, KittName, LEVELS, ScannerBar, TV2, TV2_SCREENS, TV2_VARIANTS, type Tv2Screen, type TvVariant } from './AppleTv2';

const thumb = (href: string, label: string, el: React.ReactNode) => (
  <a className="tvg2-thumb" href={href} aria-label={label}><div className="tvg2-frame"><ScaledBox width={TV2.w} height={TV2.h} scale={0.3}>{el}</ScaledBox></div></a>
);

export function TvGalleryV2() {
  return (
    <div className="tvg2">
      <div className="tvg2-head">
        <h1>Apple TV (tvOS) in Design System v2, “Scanner Grid”</h1>
        <p>The red-scanner and neon-grid hybrid (the “Scanner Grid” design system), drawn at the real 1920 x 1080. First the three directions side by side on the same Now screen, then the four hybrid screens. Open any screen full size and drive it with the keyboard the way the Siri Remote drives the real app. All figures are demo data.</p>
      </div>
      <h2 className="tvg2-sec">Status colours · the animated top border and KITT name</h2>
      <div className="tvg2-status">
        {LEVELS.map((l) => (
          <div key={l.id} className="tvg2-status-cell ds2">
            <KittName level={l.id} className="tvg2-status-name" />
            <ScannerBar level={l.id} />
            <h3>{l.label}</h3>
            <p><b>{l.rule}</b> {l.when}</p>
          </div>
        ))}
      </div>
      <h2 className="tvg2-sec">Direction compare · the Now screen</h2>
      <div className="tvg2-grid">
        {TV2_VARIANTS.map((v) => (
          <div key={v.id}>
            {thumb(`#/appletv/now/${v.id}`, `Open ${v.label} full size`, <AppleTv2 screen="now" variant={v.id} />)}
            <div className="tvg2-cap"><h3>{v.label}</h3><p>{v.what}</p><a className="tvg2-open" href={`#/appletv/now/${v.id}`}>Open full size</a></div>
          </div>
        ))}
      </div>
      <h2 className="tvg2-sec">Hybrid · four screens</h2>
      <div className="tvg2-grid">
        {TV2_SCREENS.map((s) => (
          <div key={s.id}>
            {thumb(`#/appletv/${s.id}`, `Open ${s.label} full size`, <AppleTv2 screen={s.id} />)}
            <div className="tvg2-cap"><h3>{s.label}</h3><p>{s.what}</p><a className="tvg2-open" href={`#/appletv/${s.id}`}>Open full size</a></div>
          </div>
        ))}
      </div>
      <div className="tvg2-remote">
        <b>Siri Remote.</b> Swipe on the clickpad moves focus (here: arrow keys). <b>Select</b> is a click (Enter). <b>Menu</b> goes back (Escape). <b>Play/Pause</b> reads the brief (Space).
        Voice is the system Siri button with a phrase that names the app, “Ask Kit …”; a tvOS app cannot listen on the remote’s microphone itself. No screen needs typing.
        The earlier TPCL (v1) set is kept: <a className="tvg2-open" href="#/appletv-v1">open the v1 Apple TV mockups</a>.
      </div>
    </div>
  );
}

export function TvFullV2({ screen, variant }: { screen: Tv2Screen; variant: TvVariant }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}><FitStage width={TV2.w} height={TV2.h} padding={16} maxScale={1.6}><AppleTv2 screen={screen} variant={variant} interactive /></FitStage></div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px 14px', color: '#eaf6ff', fontSize: 14, fontFamily: '-apple-system, sans-serif' }}>
        {TV2_SCREENS.map((t) => <a key={t.id} href={`#/appletv/${t.id}${variant === 'hybrid' ? '' : `/${variant}`}`} style={{ color: t.id === screen ? '#19e6ff' : '#eaf6ff', fontWeight: t.id === screen ? 700 : 500, padding: '8px 10px' }}>{t.label}</a>)}
        <span style={{ opacity: 0.4 }}>|</span>
        {TV2_VARIANTS.map((v) => <a key={v.id} href={`#/appletv/${screen}${v.id === 'hybrid' ? '' : `/${v.id}`}`} style={{ color: v.id === variant ? '#19e6ff' : '#8fa3b8', fontWeight: v.id === variant ? 700 : 500, padding: '8px 10px' }}>{v.label}</a>)}
        <span style={{ opacity: 0.66 }}>Arrows: swipe · Enter: Select · Esc: Menu · Space: Play/Pause · <a href="#/appletv" style={{ color: '#eaf6ff' }}>all</a></span>
      </div>
      <ProtoBar />
    </div>
  );
}

/* v1 (TPCL) Apple TV pages, kept unchanged */
export function TvGalleryV1() {
  return (
    <div className="tvg">
      <div className="tvg-head"><h1>Apple TV (tvOS) mockups, v1 TPCL (kept)</h1>
        <p>The first set, in the TPCL design system. Superseded by v2 “Scanner Grid”: <a className="tvg-open" href="#/appletv">open v2</a>.</p></div>
      <div className="tvg-grid">
        {TV_SCREENS.map((s) => (
          <div className="tvg-cell" key={s.id}>
            <a className="tvg-thumb" href={`#/appletv-v1/${s.id}`} aria-label={`Open ${s.label} full size`}><div className="tvg-frame"><ScaledBox width={TV.w} height={TV.h} scale={0.33}><AppleTv screen={s.id} /></ScaledBox></div></a>
            <div className="tvg-cap"><h2>{s.label}</h2><p>{s.what}</p><a className="tvg-open" href={`#/appletv-v1/${s.id}`}>Open full size</a></div>
          </div>
        ))}
      </div>
    </div>
  );
}
export function TvFullV1({ screen }: { screen: TvScreen }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}><FitStage width={TV.w} height={TV.h} padding={16} maxScale={1.6}><AppleTv screen={screen} interactive /></FitStage></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', padding: '10px 16px 18px', color: '#fff', fontSize: 14 }}>{TV_SCREENS.map((t) => <a key={t.id} href={`#/appletv-v1/${t.id}`} style={{ color: t.id === screen ? '#00bcd4' : '#fff', padding: '8px 12px' }}>{t.label}</a>)}<a href="#/appletv" style={{ color: '#fff', padding: '8px 12px' }}>v2</a></div>
    </div>
  );
}
