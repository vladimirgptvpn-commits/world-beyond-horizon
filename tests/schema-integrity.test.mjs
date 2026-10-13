import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
test('every JSON file in the v0.3 simulation suite is valid JSON', () => {
  const files = [
    'schemas/world.schema.json', 'schemas/character.schema.json', 'schemas/save.schema.json',
    'schemas/runtime-v0.2.schema.json', 'schemas/society-v0.3.schema.json',
    'tests/scenarios/npc-autonomy-danger.json', 'examples/starter-world/world.json'
  ];
  for (const name of files) assert.ok(read(name), name);
});
test('existing save format remains v0.2 and allows optional v0.3 society state', () => {
  const runtime = read('schemas/runtime-v0.2.schema.json');
  assert.equal(runtime.properties.format_version.const, '0.2.0');
  assert.equal(runtime.properties.society.$ref, 'society-v0.3.schema.json');
  assert.equal(runtime.required.includes('society'), false);
  const society = read('schemas/society-v0.3.schema.json');
  assert.equal(society.properties.version.const, '0.3.0');
  assert.ok(society.required.includes('activeThreat'));
  assert.ok(society.required.includes('ledger'));
});
test('behavioral scenario suite remains proposals, not falsely identified as runnable', () => {
  const scenarios = read('tests/scenarios/npc-autonomy-danger.json');
  assert.equal(scenarios.status, 'manual_behavioral_acceptance_cases_not_executable_engine_tests');
  assert.ok(scenarios.cases.length >= 15);
});
