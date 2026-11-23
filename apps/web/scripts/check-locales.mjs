// Fails when en.json and es.json drift: missing keys, or a translation that drops or
// renames an {{interpolation}} or <tag>. bpmnNames and bpmnUi are lookup tables that
// fall back to the English source text, so English may leave them empty.
import { readFileSync } from 'node:fs';

const load = lng => JSON.parse(readFileSync(new URL(`../src/locales/${lng}.json`, import.meta.url), 'utf8'));
const LOOKUP_TABLES = new Set(['bpmnNames', 'bpmnUi']);

function flatten(value, prefix = '', out = new Map()) {
  if (Array.isArray(value)) out.set(prefix, `[array:${value.length}]`);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (!prefix && LOOKUP_TABLES.has(key)) continue;
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
  else out.set(prefix, String(value));
  return out;
}
const tokens = text => [...text.matchAll(/{{\s*(\w+)\s*}}|<\/?(\w+)>/g)].map(m => m[0].replace(/\s/g, '')).sort().join(' ');

const [en, es] = ['en', 'es'].map(lng => flatten(load(lng)));
const problems = [];
for (const key of en.keys()) if (!es.has(key)) problems.push(`es is missing ${key}`);
for (const key of es.keys()) if (!en.has(key)) problems.push(`en is missing ${key}`);
for (const [key, text] of en) {
  if (!es.has(key)) continue;
  if (text.startsWith('[array:') || es.get(key).startsWith('[array:')) { if (text !== es.get(key)) problems.push(`${key}: array length differs`); continue; }
  if (tokens(text) !== tokens(es.get(key))) problems.push(`${key}: placeholders differ (en: ${tokens(text) || '-'} | es: ${tokens(es.get(key)) || '-'})`);
}
const scenarios = load('es').scenarios;
for (const [id, scenario] of Object.entries(load('en').scenarios)) {
  if (scenario.notes.length !== scenarios[id]?.notes?.length) problems.push(`scenarios.${id}.notes: different number of notes`);
}

if (problems.length) { console.error(`Locale check failed:\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log(`Locales OK: ${en.size} keys match in en and es.`);
