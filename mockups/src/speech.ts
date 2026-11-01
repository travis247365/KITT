// Optional browser text-to-speech so the mockup can actually talk (en-GB, like the hub's Daniel voice). Safe when unsupported.
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => /daniel/i.test(v.name) && /en-GB/i.test(v.lang)) ?? voices.find((v) => /^en-GB/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang));
}

export function speak(text: string, onEnd?: () => void): boolean {
  if (!canSpeak()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(); if (v) u.voice = v; u.lang = v?.lang ?? 'en-GB'; u.rate = 1;
    u.onend = () => onEnd?.(); u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}

export function stopSpeaking() { try { if (canSpeak()) window.speechSynthesis.cancel(); } catch { /* ignore */ } }
