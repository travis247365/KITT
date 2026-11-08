import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A security check that could not run must not clear what it found before, and must not become the baseline the next run diffs
// against (round 3 review of the R1 fix, 9 Nov 2026). gh is replaced by a stub script that answers from files in a scratch folder.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitt-sec-'));
process.env.KITT_CONFIG_DIR = path.join(tmp, 'cfg'); process.env.KITT_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.KITT_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.env'), '');
fs.writeFileSync(path.join(process.env.KITT_CONFIG_DIR, 'kitt.json'), JSON.stringify({ skills: { enabled: ['security'] } }));
const stubDir = path.join(tmp, 'stub'); fs.mkdirSync(stubDir);
const gh = path.join(stubDir, 'gh');
fs.writeFileSync(gh, `#!/bin/bash
# gh api -i -X GET <endpoint>
D=$(dirname "$0"); MODE=$(cat "$D/mode"); VIS=$(cat "$D/vis"); EP="$5"
reply() { printf 'HTTP/2.0 %s\\r\\n\\r\\n%s' "$1" "$2"; }
[ "$MODE" = down ] && { echo "connection refused" >&2; exit 1; }
case "$EP" in
  /user/repos*) PRIV=true; [ "$VIS" = public ] && PRIV=false
    reply "200 OK" "[{\\"name\\":\\"r1\\",\\"private\\":$PRIV,\\"archived\\":false,\\"pushed_at\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\",\\"owner\\":{\\"login\\":\\"o\\"}}]";;
  *) [ "$MODE" = partial ] && { echo "API rate limit exceeded" >&2; exit 1; }
     case "$EP" in
       /user) reply "200 OK" '{"login":"o","two_factor_authentication":false}';;
       */vulnerability-alerts) reply "204 No Content" "";;
       */dependabot/alerts*) reply "200 OK" '[{"security_advisory":{"severity":"critical"}}]';;
       */secret-scanning/alerts*) reply "200 OK" '[{"secret_type":"x"}]';;
       *) reply "404 Not Found" '{}';;
     esac;;
esac
`, { mode: 0o755 });
process.env.KITT_GH_BIN = gh;
const set = (mode, vis) => { fs.writeFileSync(path.join(stubDir, 'mode'), mode); fs.writeFileSync(path.join(stubDir, 'vis'), vis); };

test('a GitHub check that could not run, wholly or in part, keeps its findings and is not a diff baseline', async () => {
  const { createApp } = await import('../../src/app.js');
  const app = await createApp();
  const sec = app.skills.security._internal;
  const open = () => sec.openFindings().map((f) => f.key).sort();

  set('ok', 'public');
  await sec.runAll({ source: 'test', only: ['github'] });
  const found = ['github.2fa', 'github.dependabot.critical:r1', 'github.secrets:r1'];
  for (const k of found) assert.ok(open().includes(k), `found ${k}`);

  set('partial', 'public');   // the repo list answers, every later call fails (a rate limit part-way through)
  const p = await sec.runAll({ source: 'test', only: ['github'] });
  assert.match(p.notes.github, /partial/);
  for (const k of found) assert.ok(open().includes(k), `a sub-check that could not run keeps ${k}`);

  set('down', 'public');
  const d = await sec.runAll({ source: 'test', only: ['github'] });
  assert.match(d.notes.github, /^failed/);
  for (const k of found) assert.ok(open().includes(k), `an unreachable GitHub keeps ${k}`);

  // private, then a failed run, then public: the flip is still reported (the failed run is not the baseline)
  set('ok', 'private'); await sec.runAll({ source: 'test', only: ['github'] });
  set('down', 'private'); await sec.runAll({ source: 'test', only: ['github'] });
  set('ok', 'public'); await sec.runAll({ source: 'test', only: ['github'] });
  const flips = sec.openFindings().filter((f) => f.key === 'change:github:repo.visibility:r1');
  assert.equal(flips.length, 1); assert.equal(flips[0].severity, 'CRITICAL');
  app.scheduler?.stop?.();
});
