import type { ReactNode } from 'react';

export const PHONE = { w: 393, h: 852 };
export const PAD = { w: 1194, h: 834 };
export const WATCH = { w: 208, h: 248 };
export const CAR = { w: 1280, h: 720 };

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="ph-frame" aria-label="iPhone frame">
      <div className="ph-screen">{children}</div>
      <i className="ph-island" aria-hidden="true" />
    </div>
  );
}
export function PadFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pd-frame" aria-label="iPad frame">
      <div className="pd-screen">{children}</div>
      <i className="pd-cam" aria-hidden="true" />
    </div>
  );
}
export function WatchFrame({ children }: { children: ReactNode }) {
  return (
    <div className="wt-wrap" aria-label="Apple Watch frame">
      <i className="wt-band wt-band--top" aria-hidden="true" />
      <div className="wt-case"><div className="wt-screen">{children}</div><i className="wt-crown" aria-hidden="true" /><i className="wt-button" aria-hidden="true" /></div>
      <i className="wt-band wt-band--bot" aria-hidden="true" />
    </div>
  );
}
export function CarFrame({ children }: { children: ReactNode }) {
  return (
    <div className="car-frame" aria-label="CarPlay display">
      <div className="car-screen">{children}</div>
    </div>
  );
}
