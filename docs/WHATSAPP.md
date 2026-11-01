# WhatsApp Assistant — read before linking anything

**Verdict (research 2026-10-26):** there is no sanctioned way to read a personal WhatsApp number programmatically.
- Meta Cloud API needs the number registered as a business number; a number already on consumer WhatsApp "cannot be registered
  unless deleted first", which erases history. Coexistence (WhatsApp Business app + Cloud API) is for the Business app and its
  country availability for Zambia is unconfirmed; it also routes your chats through Meta's business platform.
- The practical path is a **linked device** (same mechanism as WhatsApp Web) using the open-source `@whiskeysockets/baileys`
  library (v7.0.0-rc14 verified to load on Node 26, ~100 MB resident). It is an **unofficial client**. WhatsApp's terms prohibit
  third-party clients; accounts can be banned. The number at risk is your MoMo and 2FA identity.

**If you accept that risk** (your decision, nothing is linked until you scan):
1. Back up WhatsApp to iCloud first (WhatsApp > Settings > Chats > Chat backup).
2. The listener's libraries are already installed (`@whiskeysockets/baileys` 7.0.0-rc14 and `qrcode`, installed with `--ignore-scripts`).
3. `kitt whatsapp link` starts the listener and opens a pairing page at `http://127.0.0.1:7899/` (this Mac only). On your phone:
   WhatsApp > Settings > Linked devices > Link a device > scan the code on the page. It turns green when connected.
   (Baileys v7 removed the terminal QR, so the page is the only way to see the code. The code refreshes about every 20 seconds.)
4. Keep `whatsapp.allow_send` **false** (default): KITT only reads, digests and drafts; you send from the phone.
   Setting it true lets the listener send *approved* drafts with a 3–8 s delay, max 20/day, existing contacts only.
5. Once linked, keep it running: `sh ~/dev/kitt/scripts/install-whatsapp.sh` (launchd; refuses to install until the pairing is complete).
6. `kitt whatsapp status` shows the state; the hub's health page turns green only when the listener is linked and receiving.

Behaviour worth knowing: messages that arrive in the first sync after linking are stored as already read so the digest starts clean; your own
messages are stored as read; reactions and protocol messages are skipped; group names come from the group metadata. Unlinking the device on the
phone moves the old credentials aside (never deleted) and a fresh code appears. A second listener refuses to start (port 7899 is the lock).

**The official route instead:** Meta's WhatsApp Cloud API through a business solution provider needs a *separate* business number and cannot
read your personal chats. It suits an assistant number that people message, not a digest of your own inbox. Provider pricing and country
availability for Zambia were not verified here; check before committing.

Voice notes: `brew install yap` (Apple on-device speech) gives transcription without a cloud call; wire-up is a TODO.
Data protection: this is not legal advice. Check the data-protection rules that apply to you before processing chats. By design nothing
leaves the Mac except what you explicitly ask the LLM to summarise (and even that can be disabled per skill).

**If you do not accept it**, the skill still works as a draft/outbox manager fed by WhatsApp's own "Linked devices" is NOT
used; the honest alternative is a separate business number for an assistant (Twilio/Meta), which cannot read your personal chats.
