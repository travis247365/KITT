import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Same two decisions as the Moments app:
 * 1. Strip `crossorigin` from the emitted script/stylesheet tags — under a Capacitor shell (capacitor://localhost)
 *    that attribute triggers a CORS check the local server does not satisfy and the page renders blank.
 * 2. Relative asset paths (`base: './'`) so the same bundle runs from Vercel, from a Capacitor WebView, or from a folder.
 * The app uses hash routing, so no server rewrites are needed.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(=["'][^"']*["'])?/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), stripCrossorigin()],
  base: './',
});
