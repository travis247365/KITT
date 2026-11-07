# The web app

`mockups/` holds KITT's web client: the same hub on a phone, a tablet, a laptop, a Mac or a television browser. It began as the design
prototype (still there, with synthetic data, at `#/demo`); since 0.3.0 the front door (`#/app`, the default route) is the live app.

## Where it runs

| Where | Address | Notes |
|---|---|---|
| From the hub, on your own network | `http://<your-mac>:2000/app/` | plain http, no tunnel, same origin: the hub serves `mockups/dist` |
| Hosted (Vercel project `kitt-mockups`) | `https://kitt-mockups-tpcl.vercel.app/` | an https page may only call an **https** hub (browsers block http from https), so this copy needs the tunnel below |
| Development | `cd mockups && npm run dev` | http://localhost:5173, talking to whatever hub address you enter |

The hub serves the files it finds in `mockups/dist` (`server.web_dir` in `kitt.json` overrides the folder). Build them with
`cd mockups && npm install && npm run build`, then restart the hub (`node bin/kitt restart`). No build yet → `/app` answers 404 with the hint.

## Connecting

The first screen (and Settings) asks for the hub address and the **app token** (`kitt token new` on the Mac). The pair is kept in that
browser only (localStorage) and sent to nothing but the hub. A television browser, where typing is painful, can be connected once from
the address bar:

```
http://<your-mac>:2000/app/#/tv?hub=http://<your-mac>:2000&token=<app token>
```

The secret is removed from the address as soon as it is stored.

## Screens: the designed surfaces, on the hub's data

The screens are the ones designed in the prototype (`src/surfaces/`), unchanged; what changed is where their world comes from.
`src/liveWorld.ts` builds the `World` the screens read from the hub's own routes, and `src/state.tsx` sends "Talk to Kit", Confirm and
Cancel to the hub instead of the prototype's grammar whenever a hub is connected and the route is not under `#/demo`.

| Surface | Route | What it shows | Where the data comes from |
|---|---|---|---|
| iPhone | `#/app` up to 760 px | Now (the priority stack, decisions first with Confirm / Cancel), Briefs (the rendered episodes with a player and the brief's text), Skills (every skill's screen), Settings (connection, hub health, routines, display) | `/v1/state`, `/v1/events` (every 20 s), `/v1/skills/{id}/view` (Security, Board, Money, Inbox, WhatsApp, Subscriptions every minute, the rest when opened), `/v1/episodes` + `/v1/audio/{file}` |
| iPad / laptop / Mac | `#/app` above 760 px | the command centre: skills by priority in the sidebar, the priority board or a skill's screen, the Ask panel, hub health and last commands, a Connection pane | the same |
| Apple TV / big screen | `#/tv` | the glance board at 1920 × 1080 scaled to the screen: headline, five LED tiles, status chips; arrows move, Enter opens, Space plays the newest brief, Y / N decide a pending action | the same |
| Watch, CarPlay, Lock Screen | `#/demo/…` only | design frames; those devices are the native apps' job | synthetic |

Ask goes to `/v1/ask` with `source: web`; a reply that needs a decision shows Confirm / Cancel, which call `/v1/confirm` and `/v1/cancel`
with the code the hub gave (a changed request is refused and shown again). What the hub does not report is empty, never invented, and
every figure keeps its *Measured* / *Modelled* / *Assumed* mark as the native apps do.

## Away from home: the tunnel (yours)

The hub listens on this Mac. For the hosted copy, or for the phone away from the house, it needs an https address:

1. `ngrok http 2000` (ngrok is installed and authenticated on the Mac, see `docs/SETUP.md`; a reserved domain keeps the address stable).
2. Put that address in `server.public_base_url` in `~/.config/kitt/kitt.json`.
3. Use it as the hub address in the hosted app. The hub's CORS list (`server.web_origins`) names the *web app's* origins, not the hub's own;
   the Vercel production and preview origins are the default, add any other host you serve the app from.

Tailscale Funnel or a Cloudflare Tunnel do the same job.

## Live and not live

Live: everything on the screens above. Not on the web: Siri, CarPlay, widgets and push, which are the native apps' job. A 2017-class
webOS television browser cannot run the web app (it targets 2019+ browsers, `es2018`); the hub's own `/tv` page (ES5) remains for that.

## Deploying the hosted copy

`npx vercel --prod` from the repository root (the project is linked in `.vercel/`, root directory `mockups`). Pushes to the repository
also deploy, provided the commit author's e-mail belongs to a member of the Vercel team: Vercel blocks a deployment whose author it
cannot match, which is why this repository's git identity is the GitHub no-reply address.

The root `.vercelignore` uploads only `mockups/` and strips everything else, `.git` included, so a Vercel "ignored build step" that runs
`git diff` can never work here (it exits 129 and the deployment errors, as every push did until 0.3.1). Every push builds instead.
