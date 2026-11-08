#!/bin/bash
# Let the iPhone/iPad (or the Apple TV) reach the hub on the Wi-Fi this Mac is on, for a few hours, or stop doing so now.
#   bash scripts/uat-lan.sh on [hours]   the hub ALSO listens on every network this Mac is connected to (Wi-Fi, Ethernet, a
#                                        hotspot) for [hours] (default 4, at most 12). It ends by itself at the end time. It also
#                                        pauses within about ten seconds of the Mac joining another network (another router, by its
#                                        hardware address, or another address for the Mac) and resumes if the Mac comes back before
#                                        the end time; `off` ends it for good. The token is still required, but it is plain http:
#                                        use it on your home Wi-Fi, never a hotel or office.
#   bash scripts/uat-lan.sh off          close it now: back to this Mac (and Tailscale, when server.host is "tailscale")
# The everyday way in from the phone, at home or away, is Tailscale (docs/HOSTING.md). GRC audit 8 Nov 2026, R1: the old "on" left
# the hub open on every network the laptop joined, with no end time.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CFG=${KITT_CONFIG_DIR:-$HOME/.config/kitt}/kitt.json
MODE=${1:-}; HOURS=${2:-4}
case "$MODE" in
  on) [[ "$HOURS" =~ ^[0-9]+$ ]] && [ "$HOURS" -ge 1 ] && [ "$HOURS" -le 12 ] || { echo "hours must be a whole number from 1 to 12"; exit 2; } ;;
  off) ;;
  *) echo "usage: uat-lan.sh on [hours] | off"; exit 2 ;;
esac
NETWORK=""
if [ "$MODE" = "on" ]; then
  NETWORK=$(node --input-type=module -e "import { currentNetwork } from '$ROOT/src/net.js'; process.stdout.write(currentNetwork());")
  [ -n "$NETWORK" ] || { echo "this Mac is not on a network right now; nothing opened"; exit 1; }
  case "$NETWORK" in *router:*) ;; *) echo "could not read the router's identity for this network (System Configuration), so a window could not be tied to it; nothing opened"; exit 1;; esac
fi
[ -f "$CFG" ] || echo '{}' > "$CFG"
cp -p "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
UNTIL=$(python3 -I - "$CFG" "$MODE" "$HOURS" "$NETWORK" <<'PY'
import json, sys, datetime, re
p, mode, hours, network = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
d = json.load(open(p)); s = d.setdefault('server', {})
host = str(s.get('host', '127.0.0.1')).strip().lower()
loopback = re.fullmatch(r'127\.\d{1,3}\.\d{1,3}\.\d{1,3}', host) or host in ('::1', 'localhost', 'local')
if not (loopback or host == 'tailscale'):
    s['host'] = 'tailscale'          # every interface, an address or a name: replaced ("tailscale" binds the Tailscale address itself)
if mode == 'on':
    until = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=hours)).replace(microsecond=0)
    s['lan_until'] = until.isoformat().replace('+00:00', 'Z'); s['lan_network'] = network
    print(until.astimezone().strftime('%H:%M on %a %d %b'))
else:
    s.pop('lan_until', None); s.pop('lan_network', None)
json.dump(d, open(p, 'w'), indent=2)
PY
)
chmod 600 "$CFG"
node "$ROOT/bin/kitt" restart
PORT=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1])).get('server',{}).get('port',2000))" "$CFG")
SOCKETS=$({ /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true; } | awk 'NR>1{print $9}' | sort -u | tr '\n' ' ')
echo "the hub is listening on: ${SOCKETS:-(nothing)}"
if [ "$MODE" = "on" ]; then
  IP=$(ipconfig getifaddr en0 || true); NAME=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
  echo; echo "Open to this network until $UNTIL. It pauses if the Mac joins another network and resumes if it comes back before then."
  echo "In the app, use:  http://$NAME.local:$PORT   (or http://$IP:$PORT)"
  echo "End it now:       bash scripts/uat-lan.sh off"
  case "$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null || true)" in
    *"State = 0"*|*disabled*) echo "Note: the Mac firewall is off. Turn it on (System Settings › Network › Firewall) and allow node when asked.";;
  esac
else
  TS=" $(node --input-type=module -e "import { tailscaleAddresses } from '$ROOT/src/net.js'; process.stdout.write(tailscaleAddresses().join(' '));") "
  for s in $SOCKETS; do
    h=${s%:*}; h=${h#[}; h=${h%]}
    case "$h" in 127.*|::1) continue;; esac
    case "$TS" in *" $h "*) continue;; esac    # this Mac's own Tailscale address, not a 100.x address on the Wi-Fi
    echo "STILL OPEN to the network on $s: check ~/.config/kitt/kitt.json and run: node bin/kitt doctor"; exit 1
  done
  echo "closed: the hub answers this Mac only (plus Tailscale, when server.host is \"tailscale\" and Tailscale is connected)"
fi
