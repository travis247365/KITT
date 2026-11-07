# KITT web

KITT's web client (since 0.3.0): the live app for a phone, tablet, laptop, Mac or television browser, talking to your own hub with the
app token. See `../docs/WEB.md`. The design prototype it grew out of, with synthetic data, is still here under `#/demo`.

Same stack and deployment pattern as the Moments app: Vite + React + TypeScript, hand-styled tokens (no UI framework),
relative asset paths and hash routing so the bundle runs from the hub's own `/app` route, from Vercel, a Capacitor WebView or a plain folder.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
```

## Routes (hash)
| Route | What |
|---|---|
| `#/app` (default) | the live app: Now, Skills, Feed, Briefs, Ask, Settings; phone / tablet / desktop layout by width |
| `#/tv` | the live glance board for a television (`?hub=…&token=…` connects it once from the address bar) |
| `#/demo` | the design prototype: all devices side by side with prototype controls (phone or iPad layout on small screens) |
| `#/demo/iphone`, `#/demo/ipad` | the prototype's phone app and iPad command centre (the bare old routes still work) |
| `#/demo/watch`, `#/demo/car`, `#/demo/surfaces`, `#/demo/appletv` | Watch, CarPlay (display only), Lock Screen / widgets / StandBy, Apple TV |
| `#/frame/<id>` | bare exact-size prototype screens for QA (see `src/frames.tsx`) |

Deep links set the demo state: `#/iphone?scenario=critical&appearance=dark&layout=drive&large=1`
(scenarios: `morning`, `pending`, `critical`, `offline`, `quiet`).

## What is real
The ranking of the priority stack, layout resolution (comfort / drive / glance / desk), the confirm-anywhere flow across
devices, the pattern grammar behind "Talk to Kit", and the server-driven skill screens (`src/views.ts` is the shape the hub's
`GET /v1/skills/{id}/view` would return). Every figure is invented and derived so totals reconcile.

## Design rules applied (TPCL)
Poppins 400/500/700 · charcoal and white, amber on light, cyan on dark · radius 0, no shadows, no gradients · bold ALL CAPS
titles on charcoal, sentence case with one bold phrase on white · every figure carries Measured / Modelled / Assumed ·
tables without vertical rules or zebra · one-stroke charts with a terminal dot and a table view.

## Deploy
Any static host works: `npm run build`, then serve `dist/` (framework Vite, root directory `mockups`).
`vercel.json` skips builds when nothing under `mockups/` changed.
