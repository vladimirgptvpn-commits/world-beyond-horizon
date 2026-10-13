import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, parseSimpleCommand, publicState, renderMap, grammaticalGender, heroHeading } from '../engine/core.mjs';
const hero = { name: 'Мирон', gender: 'мужчина', age: 34, origin: 'ремесленник', defining_trait: 'наблюдательность' };
const make = () => createGame(hero, 'test-1');
const step = (s, a) => applyAction(s, a).state;

test('five character answers are enough and name is not generated', () => {
  assert.equal(make().hero.name, 'Мирон');
  assert.throws(() => createGame({ ...hero, name: '' }));
});
test('world freezes on read-only commands', () => {
  const s = make();
  for (const type of ['look', 'map', 'status', 'help', 'inventory', 'journal']) {
    const r = applyAction(s, { type });
    assert.equal(r.state.game_time, 0);
    assert.equal(r.state.revision, 0);
  }
  assert.equal(s.game_time, 0);
});
test('movement advances time and uses valid paths', () => {
  const s = make();
  const r = applyAction(s, { type: 'go', destination: 'трактир' });
  assert.equal(r.state.location_id, 'inn');
  assert.equal(r.state.game_time, 10);
  assert.equal(s.location_id, 'square');
  assert.equal(applyAction(s, { type: 'go', destination: 'башня' }).ok, false);
});
test('map exploration unlocks tower without retroactive changes', () => {
  let s = step(make(), { type: 'go', destination: 'лес' });
  assert.equal(applyAction(s, { type: 'go', destination: 'башня' }).ok, false);
  s = step(s, { type: 'explore' });
  assert.ok(renderMap(s).includes('Старая башня'));
  s = step(s, { type: 'go', destination: 'башня' });
  assert.equal(s.location_id, 'tower');
});
test('taking and returning an item changes persistent state once', () => {
  let s = step(make(), { type: 'talk', npc: 'Ильяна' });
  s = step(s, { type: 'go', destination: 'трактир' });
  s = step(s, { type: 'take', item: 'фонарь' });
  s = step(s, { type: 'go', destination: 'площадь' });
  s = step(s, { type: 'give', npc: 'Ильяна', item: 'фонарь' });
  assert.equal(s.reputation, 2);
  assert.equal(s.flags.returned_lantern, true);
  assert.ok(!s.hero.inventory.includes('фонарь'));
  assert.equal(applyAction(s, { type: 'give', npc: 'Ильяна', item: 'фонарь' }).ok, false);
  assert.equal(s.reputation, 2);
});
test('NPC schedule triggers exactly once at minute 60, not during absence', () => {
  let s = make();
  s = step(s, { type: 'wait', minutes: 59 });
  assert.equal(s.npc_locations.ilyana, 'square');
  assert.equal(s.events.filter(e => e.type === 'npc_move').length, 0);
  const before = structuredClone(s);
  s = step(s, { type: 'wait', minutes: 1 });
  assert.equal(s.npc_locations.ilyana, 'inn');
  assert.equal(s.events.filter(e => e.type === 'npc_move').length, 1);
  s = step(s, { type: 'wait', minutes: 30 });
  assert.equal(s.events.filter(e => e.type === 'npc_move').length, 1);
  assert.equal(before.npc_locations.ilyana, 'square');
});
test('rejected or unknown actions do not mutate or tick', () => {
  const s = make();
  for (const action of [ { type: 'go', destination: 'tower' }, { type: 'take', item: 'фонарь' }, { type: 'wait', minutes: -1 }, { type: 'attack' } ]) {
    const r = applyAction(s, action);
    assert.equal(r.ok, false);
    assert.deepEqual(r.state, s);
  }
});
test('private world facts never leak in public state', () => {
  const s = make();
  assert.ok(s.world_truths.magic_exists);
  assert.equal('world_truths' in publicState(s), false);
});
test('basic natural-language grammar translates common commands', () => {
  const s = make();
  assert.equal(step(s, parseSimpleCommand('Идти в трактир')).location_id, 'inn');
  assert.equal(parseSimpleCommand('Ждать 30').minutes, 30);
  assert.equal(parseSimpleCommand('Поговорить с Ильяной').type, 'talk');
});
test('snapshot JSON roundtrip preserves version, time, events, and secrets', () => {
  const s = step(make(), { type: 'wait', minutes: 65 });
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(restored, s);
  assert.equal(restored.format_version, '0.2.0');
  assert.equal(restored.npc_locations.ilyana, 'inn');
});
test('bounded action log does not grow without limit', () => {
  let s = make();
  for (let i=0; i<120; i++) s = step(s, { type: 'wait', minutes: 1 });
  assert.ok(s.events.length <= 100);
  assert.equal(s.game_time, 120);
});

test('female character gets feminine heading and NPC speech', () => {
  const lisa = createGame({ name: 'Лиза', gender: 'женский', age: 19, origin: 'служанка', defining_trait: 'сексуальность' });
  assert.equal(heroHeading(lisa.hero), 'Героиня');
  const spoken = applyAction(lisa, { type: 'talk', npc: 'Ильяна' });
  assert.ok(spoken.text.includes('не должна'));
  assert.ok(!spoken.text.includes('не должен'));
  assert.equal(spoken.state.hero.gender, 'женский');
  assert.equal(spoken.state.hero.defining_trait, 'сексуальность');
});

test('male and neutral character speech remains grammatically correct', () => {
  const man = make();
  assert.equal(grammaticalGender(man.hero.gender), 'masculine');
  assert.equal(heroHeading(man.hero), 'Герой');
  assert.ok(applyAction(man, { type: 'talk', npc: 'Ильяна' }).text.includes('не должен'));
  const neutral = createGame({ ...hero, name: 'Рен', gender: 'не указан' });
  assert.equal(heroHeading(neutral.hero), 'Персонаж');
  const spoken = applyAction(neutral, { type: 'talk', npc: 'Ильяна' }).text;
  assert.ok(spoken.includes('Но помогать необязательно'));
  assert.ok(!spoken.includes('не должен') && !spoken.includes('не должна'));
});

test('new games include stable simulation state but public view hides NPC plans and traits', () => {
  const game = make();
  assert.equal(game.society.version, '0.3.0');
  assert.equal(game.society.regions.village.peacefulShare, .7);
  const publicView = publicState(game);
  assert.ok(!('society' in publicView));
  assert.ok(!JSON.stringify(publicView).includes('obtain_valuables'));
  assert.equal(publicView.public_society.health, 10);
  assert.equal(publicView.public_society.coins, 0);
});

test('trade interactions require an NPC to be present and keep old movement rules', () => {
  let game = make();
  assert.equal(applyAction(game, { type: 'interact', kind: 'offer', npc: 'Данил', price: 20, value: 10 }).ok, false);
  game = step(game, { type: 'go', destination: 'трактир' });
  const negotiated = applyAction(game, { type: 'interact', kind: 'offer', npc: 'Данил', price: 9, value: 12 });
  assert.ok(negotiated.ok);
  assert.equal(negotiated.state.society.npcs.danil.memory.some(m => m.kind === 'offer'), true);
  assert.equal(negotiated.state.game_time, 15);
  assert.equal(game.game_time, 10);
});

test('legacy v0.2 save without society upgrades lazily, preserving the hero', () => {
  const legacy = make();
  delete legacy.society;
  const restored = JSON.parse(JSON.stringify(legacy));
  assert.equal(applyAction(restored, { type: 'look' }).state.society, undefined);
  const moved = applyAction(restored, { type: 'go', destination: 'лес' });
  assert.equal(moved.ok, true);
  assert.equal(moved.state.society.version, '0.3.0');
  assert.equal(moved.state.society.regionId, 'forest');
  assert.deepEqual(moved.state.hero, legacy.hero);
  assert.equal(moved.state.format_version, '0.2.0');
});

test('exploration can reach dangerous area with actual ambush and escape options', () => {
  let threatGame = null;
  for (let i = 0; i < 80; i++) {
    let game = createGame(hero, `encounter-sample-${i}`);
    game.society.player.coins = 4;
    game = step(game, { type: 'go', destination: 'лес' });
    game = step(game, { type: 'explore' });
    const moved = applyAction(game, { type: 'go', destination: 'башня' });
    if (moved.ok && moved.state.society.activeThreat) { threatGame = moved.state; break; }
  }
  assert.ok(threatGame);
  assert.equal(threatGame.location_id, 'tower');
  assert.equal(applyAction(threatGame, { type: 'go', destination: 'лес' }).ok, false);
  const payment = applyAction(threatGame, { type: 'interact', kind: 'pay_demand' });
  assert.equal(payment.ok, true);
  assert.equal(payment.state.society.activeThreat, null);
  assert.ok(payment.state.society.player.coins < threatGame.society.player.coins);
});

test('persistent injury from attack is visible without revealing hidden NPC state', () => {
  let injured = null;
  for (let i = 0; i < 80; i++) {
    let game = createGame(hero, `fight-example-${i}`);
    game = step(game, { type: 'go', destination: 'лес' });
    game = step(game, { type: 'explore' });
    game = step(game, { type: 'go', destination: 'башня' });
    const attack = applyAction(game, { type: 'interact', kind: 'attack', npc: 'Главарь шайки' });
    if (attack.ok && attack.state.society.player.health < game.society.player.health) {
      injured = attack.state; break;
    }
  }
  assert.ok(injured);
  assert.ok(publicState(injured).public_society.injuries.length > 0);
  assert.equal(publicState(injured).society, undefined);
});
