// Skill registry. Each skill lives in src/skills/<id>/index.js and exports `default function define(ctx)`
// returning: { id, name, description, migrations?, intents, routines?, handle(intent, slots, ctx), execute?(action, ctx), brief?(ctx), health?(ctx), routes? }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db.js';
import { log } from '../log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function validateSkill(s, id) {
  const problems = [];
  if (!s || typeof s !== 'object') return [`skill ${id} did not return an object`];
  if (s.id !== id) problems.push(`id mismatch (${s.id} vs folder ${id})`);
  if (!s.name) problems.push('missing name');
  if (!Array.isArray(s.intents)) problems.push('intents must be an array');
  for (const it of s.intents || []) {
    if (!it.name) problems.push('intent without name');
    if (!Array.isArray(it.patterns) || !it.patterns.length) problems.push(`intent ${it.name} has no patterns`);
  }
  if (typeof s.handle !== 'function') problems.push('missing handle()');
  for (const r of s.routines || []) if (!r.name || !r.cron || typeof r.run !== 'function') problems.push(`bad routine ${r?.name}`);
  const writes = (s.intents || []).filter((i) => i.write);
  if (writes.length && typeof s.execute !== 'function') problems.push('has write intents but no execute()');
  return problems;
}

export async function loadSkills(ctx, enabled) {
  const skills = [];
  const failures = [];
  for (const id of enabled) {
    const file = path.join(HERE, id, 'index.js');
    if (!fs.existsSync(file)) { failures.push({ id, error: 'not implemented yet' }); continue; }
    try {
      const mod = await import(file);
      const skill = await mod.default(ctx);
      const problems = validateSkill(skill, id);
      if (problems.length) { failures.push({ id, error: problems.join('; ') }); continue; }
      if (skill.migrations?.length) migrate(ctx.db, skill.id, skill.migrations);
      skills.push(skill);
    } catch (e) {
      failures.push({ id, error: e.message });
      log.error('skill failed to load', { id, err: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') });
    }
  }
  return { skills, failures };
}

/** Run fn with a timeout; resolves {ok,value|error}. Used for brief composition so one slow skill cannot stall the car. */
export async function withTimeout(promise, ms, label = 'task') {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms); });
  try { return { ok: true, value: await Promise.race([promise, timeout]) }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { clearTimeout(t); }
}
