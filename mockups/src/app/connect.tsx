// The pieces the designed surfaces need when they run on the hub: the connection form and gate, the live settings block,
// the real briefs with a player, and one shared audio element so the TV, the phone and the iPad never play over each other.
import { useEffect, useState } from 'react';
import { nativeHost, nativePost, onNative } from '../native';
import { Icon } from '../icons';
import { Btn } from '../kit';
import { KittName, Mark, ScannerBar } from '../surfaces/AppleTv2';
import { mixedContent, normalizeURL, type Episode } from '../hub';
import { useLive } from '../live';
import { ago, fmtWhen, mmss } from '../model';

export function ConnForm({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const live = useLive();
  const [url, setUrl] = useState(live.conn?.url ?? live.hubHere ?? '');
  const [token, setToken] = useState(live.conn?.token ?? ''); const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const host = nativeHost();
  if (host) {
    // Inside the iPhone, iPad or Mac app the hub address and token live in the app (Keychain), not in this page.
    return (
      <div className="kw-form">
        <p className="t-small muted">{live.conn ? `Connected through the app to ${live.conn.url}.` : 'The app manages the connection to the hub.'}</p>
        <div className="actions">
          <Btn kind="primary" icon="sliders" onClick={() => nativePost({ type: 'settings' })}>Connection settings</Btn>
          <Btn kind="ghost" onClick={() => nativePost({ type: 'console' })}>Hub console</Btn>
          {live.conn && <Btn kind="ghost" onClick={() => nativePost({ type: 'disconnect' })}>Disconnect</Btn>}
        </div>
      </div>
    );
  }
  const mixed = mixedContent(normalizeURL(url));
  const submit = async () => {
    setBusy(true); setErr(null); setOk(null);
    try { await live.connect({ url, token }); setOk('Connected.'); onDone?.(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <form className="kw-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label><span className="eyebrow muted">Hub address</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://your-mac.local:2000" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" /></label>
      <label><span className="eyebrow muted">App token</span>
        <span style={{ display: 'flex', gap: 8 }}><input type={show ? 'text' : 'password'} value={token} onChange={(e) => setToken(e.target.value)} placeholder="from: kitt token new" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flex: 1 }} />
          <button type="button" className="icon-btn" aria-label={show ? 'Hide token' : 'Show token'} onClick={() => setShow(!show)}><Icon name={show ? 'eye' : 'lock'} size={18} /></button></span></label>
      {mixed && <p className="t-small kw-bad">This page is https and that hub address is http: the browser will block it. Open the app from the hub itself (http://&lt;mac&gt;:2000/app) or give the hub an https address.</p>}
      {err && <p className="t-small kw-bad" role="alert">{err}</p>}
      {ok && <p className="t-small kw-ok">{ok}</p>}
      <div className="actions">
        <Btn kind="primary" icon="check" disabled={busy || !url.trim() || !token.trim()}>{busy ? 'Connecting…' : live.conn ? 'Save and reconnect' : 'Connect'}</Btn>
        {live.conn && compact && <Btn kind="ghost" onClick={() => { live.disconnect(); setToken(''); }}>Disconnect</Btn>}
      </div>
    </form>
  );
}

/** Shown instead of the app until a hub is connected. */
export function ConnectScreen({ tv }: { tv?: boolean }) {
  return (
    <div className="kw-connect ds2" data-theme="dark">
      <div className="kw-connect-box">
        <div className="kw-brand"><Mark size={48} /><div><KittName level="green" className="kw-word" /><p className="kw-sub">Personal assistant</p></div></div>
        <ScannerBar level="green" />
        <div>
          <h1 className="t-title"><b>Connect</b> to your hub</h1>
          <p className="t-body muted" style={{ marginTop: 8 }}>Kitt’s brain runs on your own Mac. This screen talks to it with the app token and shows nothing until it does.</p>
        </div>
        <ConnForm />
        <p className="t-micro muted">
          {tv ? <>On a television, connect once from the address bar instead: <code>…/#/tv?hub=http://&lt;mac&gt;:2000&amp;token=…</code> (the secret is dropped from the address as soon as it is stored). </> : null}
          On your home Wi-Fi the hub serves this app itself at <code>http://&lt;your-mac&gt;:2000/app</code>; away from home it needs the hub’s https address.
          Want a look first? <a href="#/demo">Open the design prototype</a> (synthetic data).
        </p>
      </div>
    </div>
  );
}

/** The connection, the routines and the version: the Settings tab of the phone and the Hub pane of the iPad, when live. */
export function LiveSettings() {
  const live = useLive();
  const routines = live.state?.routines ?? []; const failed = routines.filter((r) => r.last_status === 'error');
  return (
    <>
      <h2 className="eyebrow muted">Hub</h2>
      <div className="set-row">
        <div><div className="row-title">{live.conn?.url}</div><div className="row-sub">{live.status === 'online' ? `Hub ${live.state?.version ?? ''}${live.state?.tz ? ` · ${live.state.tz}` : ''}${live.lastOk ? ` · read ${ago(new Date(live.lastOk).toISOString())}` : ''}` : live.status === 'offline' ? `Unreachable: ${live.error ?? ''}` : 'Connecting…'}</div></div>
        <span className="hub-chip">{live.status === 'online' ? <><span className="dot-live" />Online</> : <><span className="dot-off" />{live.status === 'offline' ? 'Offline' : 'Connecting'}</>}</span>
      </div>
      <div className="set-sec"><ConnForm compact /></div>
      <div className="set-sec">
        <h2 className="eyebrow muted" style={{ marginBottom: 6 }}>Routines</h2>
        {!routines.length && <p className="t-small muted">No routines reported.</p>}
        {failed.length > 0 && <div className="notice notice--attention" style={{ marginBottom: 8 }}><Icon name="warn" size={18} /><span>{failed.length === 1 ? '1 routine' : `${failed.length} routines`} failed last run: {failed.map((r) => r.name).join(', ')}.</span></div>}
        <ul>{routines.slice(0, 30).map((r) => <li className="row" key={r.name} style={{ minHeight: 40, padding: '6px 0' }}><div className="row-main"><div className="row-title" style={{ fontSize: 14 }}>{r.name}</div><div className="row-sub">{r.last_run_at ? `last ran ${ago(r.last_run_at)}` : 'never ran'}</div></div><span className={`kw-tag${r.last_status === 'error' ? ' kw-tag--bad' : r.last_status === 'ok' ? ' kw-tag--ok' : ''}`}>{r.last_status || '–'}</span></li>)}</ul>
      </div>
      <div className="set-sec">
        <h2 className="eyebrow muted" style={{ marginBottom: 6 }}>About</h2>
        <p className="t-small">KITT web {__APP_VERSION__} · hub {live.state?.version ?? '–'}. The iPhone, iPad, Mac, Apple TV and CarPlay apps are native and share this hub.</p>
        <p className="t-micro muted" style={{ marginTop: 6 }}>Big screen: open <a href="#/tv">#/tv</a>. Design prototype with synthetic data: <a href="#/demo">#/demo</a>.</p>
      </div>
    </>
  );
}

// ---- one brief player for every surface ----

let audioEl: HTMLAudioElement | null = null;
let currentEp: Episode | null = null;
let loading = false;
const subs = new Set<() => void>();
// On the iPhone and iPad the app plays briefs itself (lock-screen controls, background audio, the copies kept for the car) and
// reports back here once a second; this page only shows that state and asks for play / pause.
const nativePlayer = Boolean(nativeHost()?.player);
type NativePlayerState = { playing: boolean; position: number; duration: number; id?: number | null; title?: string; file?: string };
let nativeState: NativePlayerState | null = null;
if (nativePlayer) {
  onNative<NativePlayerState | null>('kitt:player', (d) => {
    nativeState = d;
    if (d?.id != null && currentEp?.id !== d.id) currentEp = { id: d.id, slug: '', title: d.title ?? 'Brief', file: d.file ?? '', duration_s: d.duration ? Math.round(d.duration) : undefined };
    subs.forEach((f) => f());
  });
}
const notify = () => subs.forEach((f) => f());
function el(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    for (const ev of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'error']) audioEl.addEventListener(ev, notify);
  }
  return audioEl;
}

export function useBriefPlayer() {
  const live = useLive();
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const a = audioEl;
  const playing = nativePlayer ? Boolean(nativeState?.playing) : Boolean(a && !a.paused && !a.ended);
  const play = async (ep?: Episode) => {
    if (nativePlayer) {
      let target = ep ?? currentEp;
      if (!target) { loading = true; notify(); try { target = (await live.episodes())[0] ?? null; } finally { loading = false; } if (!target) { notify(); throw new Error('No brief rendered yet'); } }
      currentEp = target; notify();
      nativePost({ type: 'play', id: target.id, file: target.file, title: target.title });
      return;
    }
    const e = el();
    let target = ep ?? currentEp;
    if (!target) { loading = true; notify(); try { target = (await live.episodes())[0] ?? null; } finally { loading = false; } if (!target) { notify(); throw new Error('No brief rendered yet'); } }
    if (currentEp?.id !== target.id || !e.src) { loading = true; notify(); try { e.src = await live.audioURL(target.file); currentEp = target; } finally { loading = false; } }
    notify();
    await e.play();
  };
  const pause = () => { if (nativePlayer) { nativePost({ type: 'pause' }); return; } audioEl?.pause(); };
  const toggle = () => (playing ? Promise.resolve(pause()) : play());
  if (nativePlayer) return { playing, loading, current: currentEp, position: nativeState?.position ?? 0, duration: nativeState?.duration || currentEp?.duration_s || 0, play, pause, toggle };
  return { playing, loading, current: currentEp, position: a?.currentTime ?? 0, duration: a && Number.isFinite(a.duration) ? a.duration : currentEp?.duration_s ?? 0, play, pause, toggle };
}

/** The phone's Briefs tab when live: the hub's episodes, the shared player, the brief's text as transcript. */
export function LiveBriefs() {
  const live = useLive(); const player = useBriefPlayer();
  const [eps, setEps] = useState<Episode[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let on = true; live.episodes().then((e) => { if (on) setEps(e); }).catch((e: Error) => { if (on) setErr(e.message); }); return () => { on = false; }; }, [live]);
  const current = player.current ?? eps?.[0] ?? null;
  const pct = player.duration ? Math.min(100, (player.position / player.duration) * 100) : 0;
  const go = (ep: Episode) => { setErr(null); (player.current?.id === ep.id ? player.toggle() : player.play(ep)).catch((e: Error) => setErr(e.message)); };
  return (
    <>
      <header className="hdr"><div className="hdr-l"><span className="accent-block" /><h1 className="t-title">Today’s <b>brief</b></h1></div></header>
      {err && <div className="notice notice--attention" style={{ marginBottom: 12 }}><Icon name="warn" size={18} /><span>{err}</span></div>}
      {eps && !eps.length && <div className="notice" style={{ marginBottom: 12 }}><Icon name="clock" size={18} /><span>The hub has not rendered a brief yet. The morning brief renders at 07:05, the evening recap at 17:45.</span></div>}
      {current && (
        <div className="player">
          <p className="eyebrow">{current.title} · {fmtWhen(current.published_at || current.created_at, live.state?.tz)}</p>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16 }}>
            <button type="button" className="play-btn" aria-label={player.playing ? 'Pause brief' : 'Play brief'} disabled={player.loading} onClick={() => go(current)}><Icon name={player.playing ? 'pause' : 'play'} size={28} /></button>
            <div><p className="card-title">{player.loading ? 'Loading…' : `${mmss(player.position)} / ${player.duration ? mmss(player.duration) : '–:––'}`}</p><p className="t-small" style={{ opacity: 0.8, marginTop: 4 }}>Plays here, in the car through the iPhone app, and in Apple Podcasts</p></div>
          </div>
          <div className="prog" aria-hidden="true"><i style={{ width: `${pct}%`, animation: 'none' }} /></div>
        </div>
      )}
      {current?.description && (<><h2 className="eyebrow muted" style={{ margin: '24px 0 10px' }}>Transcript</h2><p className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{current.description}</p></>)}
      {eps && eps.length > 0 && (
        <>
          <div className="rule-h" style={{ margin: '22px 0 4px' }} />
          <ul>
            {eps.map((ep) => (
              <li className="row" key={ep.id}>
                <Icon name={ep.slug === 'evening' ? 'moon' : 'sun'} size={20} />
                <div className="row-main"><div className="row-title">{ep.title}</div><div className="row-sub">{fmtWhen(ep.published_at || ep.created_at, live.state?.tz)}{ep.duration_s ? ` · ${mmss(ep.duration_s)}` : ''}</div></div>
                <button type="button" className="icon-btn" aria-label={player.current?.id === ep.id && player.playing ? `Pause ${ep.title}` : `Play ${ep.title}`} onClick={() => go(ep)}><Icon name={player.current?.id === ep.id && player.playing ? 'pause' : 'play'} size={20} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
