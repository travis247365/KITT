import type { ReactNode } from 'react';
import { CAR, PAD, PHONE, WATCH } from './devices/Frames';
import { Phone } from './surfaces/Phone';
import { Pad } from './surfaces/Pad';
import { Watch } from './surfaces/Watch';
import { Car } from './surfaces/Car';
import { AppleTv, TV } from './surfaces/AppleTv';
import { AppleTv2, TV2 } from './surfaces/AppleTv2';
import { LockScreen, Widgets, Island, StandBy, NotifActions } from './surfaces/Surfaces';

/** Bare, exact-size screens for QA screenshots (`#/frame/<id>`). Never scaled, no device chrome. */
export const FRAMES: Record<string, { w: number; h: number; el: ReactNode }> = {
  'phone-now': { ...PHONE, el: <Phone /> },
  'phone-talk': { ...PHONE, el: <Phone openTalk /> },
  'phone-briefs': { ...PHONE, el: <Phone initialTab="briefs" /> },
  'phone-skills': { ...PHONE, el: <Phone initialTab="skills" /> },
  'phone-money': { ...PHONE, el: <Phone initialTab="skills" initialSkill="money" /> },
  'phone-security': { ...PHONE, el: <Phone initialTab="skills" initialSkill="security" /> },
  'phone-trips': { ...PHONE, el: <Phone initialTab="skills" initialSkill="trips" /> },
  'phone-board': { ...PHONE, el: <Phone initialTab="skills" initialSkill="chief" /> },
  'phone-links': { ...PHONE, el: <Phone initialTab="skills" initialSkill="linktree" /> },
  'phone-settings': { ...PHONE, el: <Phone initialTab="settings" /> },
  'phone-drive': { ...PHONE, el: <Phone layout="drive" /> },
  'phone-glance': { ...PHONE, el: <Phone layout="glance" /> },
  'pad-now': { ...PAD, el: <Pad /> },
  'pad-money': { ...PAD, el: <Pad initialSel="money" /> },
  'pad-security': { ...PAD, el: <Pad initialSel="security" /> },
  'pad-trips': { ...PAD, el: <Pad initialSel="trips" /> },
  'pad-links': { ...PAD, el: <Pad initialSel="linktree" /> },
  'pad-shoplog': { ...PAD, el: <Pad initialSel="shoplog" /> },
  'watch-face': { ...WATCH, el: <Watch page="face" /> },
  'watch-now': { ...WATCH, el: <Watch page="now" /> },
  'watch-brief': { ...WATCH, el: <Watch page="brief" /> },
  'watch-idea': { ...WATCH, el: <Watch page="idea" /> },
  'watch-notif': { ...WATCH, el: <Watch page="notif" /> },
  car: { ...CAR, el: <Car /> },
  'tv-now': { ...TV, el: <AppleTv screen="now" /> },
  'tv-ok': { ...TV, el: <AppleTv screen="ok" /> },
  'tv-pair': { ...TV, el: <AppleTv screen="pair" /> },
  'tv-shelf': { ...TV, el: <AppleTv screen="shelf" /> },
  'tv2-now': { ...TV2, el: <AppleTv2 screen="now" /> },
  'tv2-now-scanner': { ...TV2, el: <AppleTv2 screen="now" variant="scanner" /> },
  'tv2-now-grid': { ...TV2, el: <AppleTv2 screen="now" variant="grid" /> },
  'tv2-ok': { ...TV2, el: <AppleTv2 screen="ok" /> },
  'tv2-pair': { ...TV2, el: <AppleTv2 screen="pair" /> },
  'tv2-shelf': { ...TV2, el: <AppleTv2 screen="shelf" /> },
  lock: { ...PHONE, el: <LockScreen /> },
  widgets: { w: 340, h: 360, el: <Widgets /> },
  island: { w: 400, h: 240, el: <div style={{ padding: 16, background: '#3a3a3a', height: '100%' }}><Island /></div> },
  standby: { w: 560, h: 250, el: <StandBy /> },
  notif: { w: 380, h: 200, el: <div style={{ padding: 16, background: '#3a3a3a', height: '100%' }}><NotifActions /></div> },
};
