import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Fixed-size device drawn at its real point size, then scaled. */
export function ScaledBox({ width, height, scale, children }: { width: number; height: number; scale: number; children: ReactNode }) {
  return (
    <div className="scaled" style={{ width: width * scale, height: height * scale }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  );
}

/** Fills its parent and scales the device to fit (contain), centred. */
export function FitStage({ width, height, children, maxScale = 3, padding = 0 }: { width: number; height: number; children: ReactNode; maxScale?: number; padding?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); setScale(Math.max(0.1, Math.min((r.width - padding * 2) / width, (r.height - padding * 2) / height, maxScale))); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [width, height, maxScale, padding]);
  return (
    <div ref={ref} className="fit-stage">
      <ScaledBox width={width} height={height} scale={scale}>{children}</ScaledBox>
    </div>
  );
}

/** True when the viewport is narrower than `px` (used to drop device chrome on a real phone). */
export function useNarrow(px: number): boolean {
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth <= px);
  useLayoutEffect(() => { const f = () => setN(window.innerWidth <= px); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, [px]);
  return n;
}
