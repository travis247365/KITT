#!/bin/sh
# Connect the Chief of Staff to the COO Operations board without a terminal prompt:
#   sh scripts/connect-board.sh
# Two macOS dialogs: (1) an optional board ACCOUNT e-mail, (2) the password (hidden). With no e-mail the password must be the board's
# shared TEAM password (APP_PASSWORD); with an e-mail it is that account's password. `kitt secret set` tries the login first and
# saves nothing if the board rejects it. The password never appears in a process argument or a log.
KITT="$(cd "$(dirname "$0")/.." && pwd)/bin/kitt"
EMAIL=$(osascript -e 'text returned of (display dialog "Step 1 of 2. Board ACCOUNT e-mail for KITT. Leave it EMPTY to use the shared team password instead." default answer "" with title "KITT: connect the COO board" buttons {"Cancel", "Next"} default button "Next" giving up after 900)' 2>/dev/null) || { echo "Cancelled. Nothing changed."; exit 1; }
PW=$(osascript -e 'text returned of (display dialog "Step 2 of 2. Password for that account, or the shared TEAM password if you left the e-mail empty. Typing is hidden." default answer "" with hidden answer with title "KITT: connect the COO board" buttons {"Cancel", "Connect"} default button "Connect" giving up after 900)' 2>/dev/null) || { echo "Cancelled. Nothing changed."; exit 1; }
[ -n "$PW" ] || { echo "Nothing entered (or the dialog timed out). Nothing changed."; exit 1; }
printf '%s' "$PW" | KITT_COO_EMAIL="$EMAIL" "$KITT" secret set KITT_COO_PASSWORD || exit 1
unset PW
echo "--- first sync"
"$KITT" routine run chief.sync 2>&1 | head -20
echo "--- restarting the hub so it picks the credentials up"
"$KITT" restart
sleep 2
"$KITT" health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('chief:', d['skills']['chief'])"
