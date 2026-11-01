#!/usr/bin/env python3
"""Generate and sign KITT's Siri Shortcuts (.shortcut plists) for the iPhone / CarPlay.

Usage: build_shortcuts.py <out_dir> <base_url> <token> [feed_token]
Verified 2026-10-26 on macOS: plistlib binary plists with these action identifiers sign cleanly with
`/usr/bin/shortcuts sign --mode people-who-know-me`. Install: AirDrop or iCloud Drive → tap → Add Shortcut;
or `open <file>` on the Mac and let iCloud sync it to the iPhone. Say "Hey Siri, <shortcut name>" in the car.
"""
import plistlib, sys, uuid, pathlib, subprocess, json

out = pathlib.Path(sys.argv[1]); base = sys.argv[2].rstrip('/'); token = sys.argv[3]; feed_token = sys.argv[4] if len(sys.argv) > 4 else None
out.mkdir(parents=True, exist_ok=True)

def tok(s): return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}
def tok_attach(att): return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": att}}, "WFSerializationType": "WFTextTokenString"}
def dict_field(items): return {"Value": {"WFDictionaryFieldValueItems": items}, "WFSerializationType": "WFDictionaryFieldValue"}
def kv(k, v): return {"WFItemType": 0, "WFKey": tok(k), "WFValue": v}
def uid(): return str(uuid.uuid4()).upper()
def speak(): return {"WFWorkflowActionIdentifier": "is.workflow.actions.speaktext", "WFWorkflowActionParameters": {"WFSpeakTextWait": True, "WFSpeakTextRate": 0.5, "WFSpeakTextPitch": 1.0, "WFSpeakTextLanguage": "en-GB"}}
def get_value(key): return {"WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey", "WFWorkflowActionParameters": {"UUID": uid(), "WFGetDictionaryValueType": "Value", "WFDictionaryKey": key}}
def ask(prompt, u): return {"WFWorkflowActionIdentifier": "is.workflow.actions.ask", "WFWorkflowActionParameters": {"UUID": u, "WFAskActionPrompt": tok(prompt), "WFInputType": "Text", "WFAllowsMultilineText": True}}
def http(url, method, body_items=None, u=None):
    p = {"UUID": u or uid(), "WFURL": url, "WFHTTPMethod": method, "Advanced": True, "ShowHeaders": True,
         "WFHTTPHeaders": dict_field([kv("Authorization", tok(f"Bearer {token}")), kv("ngrok-skip-browser-warning", tok("1"))])}
    if body_items is not None:
        p["WFHTTPBodyType"] = "JSON"; p["WFJSONValues"] = dict_field(body_items)
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl", "WFWorkflowActionParameters": p}
def base_wf(actions, has_input=False, glyph=59511, color=4282601983):
    return {"WFWorkflowActions": actions, "WFWorkflowClientVersion": "2605.0.5", "WFWorkflowMinimumClientVersion": 900, "WFWorkflowMinimumClientVersionString": "900",
            "WFWorkflowIcon": {"WFWorkflowIconStartColor": color, "WFWorkflowIconGlyphNumber": glyph}, "WFWorkflowImportQuestions": [],
            "WFWorkflowInputContentItemClasses": ["WFStringContentItem", "WFRichTextContentItem", "WFURLContentItem"], "WFWorkflowTypes": ["NCWidget", "WatchKit"],
            "WFWorkflowHasShortcutInputVariables": has_input, "WFWorkflowHasOutputFallback": False, "WFWorkflowOutputContentItemClasses": [], "WFQuickActionSurfaces": [],
            "WFWorkflowNoInputBehavior": {"Name": "WFWorkflowNoInputBehaviorShowError", "Parameters": {}}}
def ask_output(u): return {"OutputUUID": u, "OutputName": "Provided Input", "Type": "ActionOutput"}

shortcuts = {}
# 1) "Kit" — free-form command: Siri asks, POSTs to /v1/ask, speaks the answer.
u = uid(); shortcuts["Kit"] = base_wf([ask("Yes, Travis?", u), http(f"{base}/v1/ask", "POST", [kv("text", tok_attach(ask_output(u))), kv("source", tok("siri"))]), get_value("speak"), speak()])
# 2) "Kit Brief" — morning brief, no questions asked.
shortcuts["Kit Brief"] = base_wf([http(f"{base}/v1/brief/morning?source=siri", "GET"), get_value("speak"), speak()], glyph=59771)
# 3) "Kit Recap" — evening recap.
shortcuts["Kit Recap"] = base_wf([http(f"{base}/v1/brief/evening?source=siri", "GET"), get_value("speak"), speak()], glyph=59771)
# 4) "Kit Idea" — capture an idea.
u2 = uid(); shortcuts["Kit Idea"] = base_wf([ask("What's the idea?", u2), http(f"{base}/v1/idea", "POST", [kv("text", tok_attach(ask_output(u2))), kv("source", tok("siri"))]), get_value("speak"), speak()], glyph=59743)
# 5) "Kit Confirm" / 6) "Kit Cancel" / 7) "Kit More"
shortcuts["Kit Confirm"] = base_wf([http(f"{base}/v1/confirm", "POST", [kv("source", tok("siri"))]), get_value("speak"), speak()], glyph=59496)
shortcuts["Kit Cancel"] = base_wf([http(f"{base}/v1/cancel", "POST", [kv("source", tok("siri"))]), get_value("speak"), speak()], glyph=59496)
shortcuts["Kit More"] = base_wf([http(f"{base}/v1/more?source=siri", "GET"), get_value("speak"), speak()], glyph=59496)
# 8) "Kit Plate" / 9) "Kit Security" / 10) "Kit Money" — one-shot briefs for the most used skills
for name, path in [("Kit Plate", "chief"), ("Kit Security", "security"), ("Kit Money", "money"), ("Kit Inbox", "receptionist")]:
    shortcuts[name] = base_wf([http(f"{base}/v1/brief/{path}?source=siri", "GET"), get_value("speak"), speak()], glyph=59771)
# 11) "Kit SMS Relay" — fed by an iPhone Automation ("When I get a message from MTN/Airtel/FNB/Stanbic → Run Immediately").
#     Shortcut Input is the message text; the hub routes by body content when the sender is unknown.
shortcuts["Kit SMS Relay"] = base_wf([http(f"{base}/v1/sms", "POST", [kv("body", tok_attach({"Type": "ExtensionInput"})), kv("source", tok("ios-automation"))])], has_input=True, glyph=59511, color=4292093695)

results = []
for name, wf in shortcuts.items():
    slug = name.lower().replace(' ', '-')
    unsigned = out / f"{slug}.shortcut"; signed = out / f"{slug}.signed.shortcut"
    with open(unsigned, 'wb') as f: plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)
    r = subprocess.run(["/usr/bin/shortcuts", "sign", "--mode", "people-who-know-me", "--input", str(unsigned), "--output", str(signed)], capture_output=True, text=True)
    ok = r.returncode == 0 and signed.exists() and signed.stat().st_size > 0
    results.append({"name": name, "file": str(signed if ok else unsigned), "signed": ok, "error": (r.stderr or r.stdout).strip()[:200] if not ok else ""})
    if ok: unsigned.unlink(missing_ok=True)
manifest = {"base_url": base, "feed_url": f"{base}/feed/{feed_token}/kitt.xml" if feed_token else None, "shortcuts": results}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2))
print(json.dumps(manifest, indent=2))
