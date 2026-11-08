# KITT user acceptance test (UAT)

Log every finding in `docs/UAT_LOG.md` (one line each: where, what you did, what you expected, what happened, screenshot name). Severity: **S1** blocks use, **S2** wrong or confusing, **S3** polish.

## Connect each device once
| Device | Install | Hub address | Token |
|---|---|---|---|
| This Mac | already in `~/Applications/KITT.app` | `http://127.0.0.1:2000` | the app token is on the clipboard: paste it |
| iPad, iPhone | `bash scripts/uat-install.sh` (needs your Apple ID in Xcode and Developer Mode on) | over Tailscale `http://<the Mac's Tailscale address>:2000`; or at home `bash scripts/uat-lan.sh on` (open for 4 hours, then it closes by itself; `off` closes it sooner), then `http://<your-mac-name>.local:2000` | `grep ^KITT_APP_TOKEN= ~/.config/kitt/kitt.env \| cut -d= -f2- \| pbcopy`, then paste (Universal Clipboard carries it to the iPad/iPhone) |
| Apple TV | later, from Xcode | same address as the iPad (Tailscale, or a `uat-lan.sh on` window at home) | typed with the iPhone keyboard |

## Test cases
| # | Do this | Expected |
|---|---|---|
| 1 | Open the app, enter the address and token, Connect | The board loads within 5 s: skills, a status chip, no error text |
| 2 | Look at the status | It shows **Needs attention** and names WhatsApp and Subscriptions (they are really unhealthy right now) |
| 3 | Ask "good morning" | A spoken-style brief: greeting, "N things need your decision" second, then items, then "That's the brief." |
| 4 | Ask "log cash 50 parking" | A decision appears with Confirm and Cancel; nothing is logged yet |
| 5 | Press Cancel | "Cancelled"; the decision disappears; the cash is not logged |
| 6 | Ask it again, press Confirm | "Logged 50 kwacha cash for parking"; the decision disappears |
| 7 | Ask for a second decision, then confirm the first screen's old copy (leave the app open on one device, create another from a second device or the Mac) | The old one is refused ("That request changed") and nothing runs |
| 8 | Quit the hub (`kitt` stop), look at the app | It says the hub is unreachable and shows the cached copy; it recovers when the hub is back |
| 9 | Enter a wrong token | It says the hub rejected the token, not "offline" |
| 10 | Rotate/resize (iPad), dark/light mode, large text | Nothing is cut off; text stays readable |

## In the car (iPhone, 0.2.0)
| # | Do this | Expected |
|---|---|---|
| 11 | With the hub reachable (Tailscale, or a `uat-lan.sh on` window at home) open **Briefs** | The newest briefs list with "Today HH:MM · m:ss"; none says "needs the hub" after a few seconds |
| 12 | Press play on one, lock the phone | It keeps playing; the lock screen shows "Morning brief · Kitt" with the artwork, play/pause and the 15 s skips work |
| 13 | Plug into CarPlay (or Bluetooth) with it playing | CarPlay's Now Playing shows the brief; steering-wheel play/pause and skip work |
| 14 | Away from home, Airplane mode on: "Hey Siri, play my brief in Kitt" | The newest brief plays from the phone's copy; Siri says "Playing your morning brief" |
| 15 | "Hey Siri, play my evening recap in Kitt" | The evening one |
| 16 | With the hub reachable (Tailscale, or a `uat-lan.sh on` window at home): "Hey Siri, ask Kitt" → "what's my cash position" | Siri reads the hub's answer |
| 17 | Ask "log cash 50 parking" in the app, then "Hey Siri, confirm with Kitt" | Siri says "Logged 50 kwacha cash for parking"; the decision disappears |
| 18 | With the phone off Tailscale and no window open: "Hey Siri, ask Kitt what's on my plate" | Siri says the hub is not reachable (not a raw error, not silence) |
