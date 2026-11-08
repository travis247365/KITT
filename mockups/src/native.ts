/**
 * The native Kitt apps (iPhone, iPad, Mac; apps/KITT/KITT/KittSurface.swift) show this web app inside a web view and talk to it
 * through this bridge. The app injects `window.__KITT_NATIVE__` before the page runs, and the connection into localStorage, so
 * the page never shows its own Connect form there: the app owns the hub address and the token (Keychain).
 *
 * Page → app: `nativePost({ type, ... })`:  mic (start listening) · answer {speak} (read it aloud) · play {id, file, title} ·
 *   pause · settings (open the app's connection screen) · disconnect · console (the app's hub console).
 * App → page: window events with a `detail`:  kitt:listening {text} (words so far) · kitt:say {text} (the final words; empty
 *   = nothing heard) · kitt:player {playing, position, duration, id, title, file}.
 */
export interface NativeHost { platform: 'ios' | 'macos'; speech?: boolean; player?: boolean }

declare global {
  interface Window {
    __KITT_NATIVE__?: NativeHost;
    webkit?: { messageHandlers?: { kitt?: { postMessage(message: unknown): void } } };
  }
}

export function nativeHost(): NativeHost | null {
  return (typeof window !== 'undefined' && window.__KITT_NATIVE__) || null;
}

export function nativePost(message: Record<string, unknown>): boolean {
  try {
    const h = typeof window !== 'undefined' ? window.webkit?.messageHandlers?.kitt : undefined;
    if (!h) return false;
    h.postMessage(message);
    return true;
  } catch { return false; }
}

export function onNative<T>(name: string, fn: (detail: T) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<T>).detail);
  window.addEventListener(name, h);
  return () => window.removeEventListener(name, h);
}
