import test from 'node:test';
import assert from 'node:assert/strict';
import { stableRoll, makeRegion, makeNPC, createSociety, assessRisk, resolveSocietyTurn } from '../engine/simulation.mjs';
const run = (s, action) => resolveSocietyTurn(s, action);
const move = (s, to) => run(s, { kind: 'travel', to }).state;

test('simulation is deterministic for equal input, seed, and turn', () => {
  const a = createSociety('same-seed'), b = createSociety('same-seed');
  assert.deepEqual(a, b);
  assert.equal(stableRoll('s', 'x'), stableRoll('s', 'x'));
  assert.deepEqual(run(a, { kind: 'ask_help', npcId: 'ilyana' }), run(b, { kind: 'ask_help', npcId: 'ilyana' }));
});

test('peacefulShare is a population-level tendency, not a combat probability or reroll', () => {
  const region = makeRegion({ id: 'start', peacefulShare: .7 });
  let friendly = 0, adversarial = 0;
  for (let i = 0; i < 500; i++) {
    const n = makeNPC({ id: `visitor-${i}`, name: `Visitor ${i}`, regionId: 'start' }, 'population-test', region);
    if (n.stance === 'peaceful') friendly++; else adversarial++;
    assert.equal(n.stance, makeNPC({ id: n.id, name: n.name, regionId: 'start' }, 'population-test', region).stance);
  }
  assert.ok(friendly > 300 && friendly < 400, `peaceful count: ${friendly}`);
  assert.equal(friendly + adversarial, 500);
});

test('danger varies by location, not by avatar level or time elapsed in real life', () => {
  const s = createSociety('geography');
  const village = assessRisk(s, { regionId: 'village', minutes: 600 });
  const forest = assessRisk(s, { regionId: 'forest', minutes: 600 });
  const camp = assessRisk(s, { regionId: 'deep_forest', minutes: 600 });
  const institution = assessRisk(s, { regionId: 'institution', minutes: 600 });
  assert.ok(village.score < forest.score && forest.score < camp.score);
  assert.ok(institution.score > village.score);
  const stronger = structuredClone(s);
  stronger.player.combat = 90;
  stronger.turn = 9999;
  assert.deepEqual(assessRisk(stronger, { regionId: 'village' }), assessRisk(s, { regionId: 'village' }));
  assert.ok(assessRisk(s, { regionId: 'forest', minutes: 1320 }).score >= forest.score);
});

test('NPC has stable resources, interests and no unlimited free gifts', () => {
  const source = createSociety('coherent');
  const original = structuredClone(source);
  let s = source;
  for (let i = 0; i < 25; i++) s = run(s, { kind: 'ask_help', npcId: 'ilyana' }).state;
  assert.deepEqual(source, original);
  assert.equal(s.player.coins + s.npcs.ilyana.coins, 12);
  assert.ok(s.npcs.ilyana.coins >= 0);
  assert.ok(s.npcs.ilyana.memory.some(m => m.kind === 'help_request'));
  assert.ok(s.events.every(e => e.type === 'help_request'));
});

test('merchant can counteroffer, decline and record accepted agreement once', () => {
  let s = createSociety('haggle');
  const originalCoins = s.npcs.danil.coins;
  const response = run(s, { kind: 'offer', npcId: 'danil', price: 9, value: 12, service: 'evening work' });
  assert.equal(response.outcome, 'counter');
  assert.ok(response.detail.counter > 0 && response.detail.counter < 9);
  assert.equal(s.npcs.danil.coins, originalCoins);
  s = response.state;
  const accepted = run(s, { kind: 'accept_offer', npcId: 'danil' });
  assert.equal(accepted.outcome, 'contract');
  assert.equal(accepted.state.contracts.length, 1);
  assert.equal(accepted.state.player.coins, response.detail.counter);
  assert.equal(accepted.state.npcs.danil.coins, originalCoins - response.detail.counter);
  assert.equal(accepted.state.ledger.length, 1);
  assert.equal(run(accepted.state, { kind: 'accept_offer', npcId: 'danil' }).ok, false);
  assert.equal(run(s, { kind: 'offer', npcId: 'danil', price: 1000, value: 1 }).outcome, 'refuse');
});

test('withdrawal leaves real accounting and reputation consequences, not forced intimacy', () => {
  let s = createSociety('contracts');
  s = run(s, { kind: 'offer', npcId: 'danil', price: 8, value: 18, service: 'personal appointment' }).state;
  const accepted = run(s, { kind: 'accept_offer', npcId: 'danil' });
  assert.equal(accepted.outcome, 'contract');
  s = accepted.state;
  const id = s.contracts[0].id;
  const initialRelationship = s.npcs.danil.relationship;
  s = run(s, { kind: 'cancel_contract', npcId: 'danil', contractId: id, refund: 0 }).state;
  assert.equal(s.contracts[0].status, 'disputed');
  assert.ok(s.npcs.danil.relationship < initialRelationship);
  assert.equal(s.ledger.length, 1);
  assert.equal(s.player.health, 10);
  assert.equal(run(s, { kind: 'cancel_contract', npcId: 'danil', contractId: id }).ok, false);
});

test('guarded initial zone is not forced into threat on each move', () => {
  const s = createSociety('safe-travel');
  const toForest = move(s, 'forest');
  assert.equal(toForest.activeThreat, null);
  assert.equal(toForest.regionId, 'forest');
  const back = move(toForest, 'village');
  assert.equal(back.activeThreat, null);
  assert.equal(back.regionId, 'village');
  assert.equal(s.regionId, 'village');
});

test('bandit region can produce real threat, while some encounters remain uneventful', () => {
  let threats = 0, safe = 0;
  for (let i = 0; i < 80; i++) {
    let s = createSociety(`traveller-${i}`, { player: { coins: 8 } });
    s = move(s, 'forest');
    const outcome = run(s, { kind: 'travel', to: 'deep_forest' });
    assert.ok(outcome.ok);
    if (outcome.state.activeThreat) {
      threats++;
      assert.equal(outcome.state.activeThreat.npcId, 'bandit');
      assert.equal(outcome.outcome, 'threat');
    } else safe++;
  }
  assert.ok(threats > 0 && safe > 0, `threats=${threats} safe=${safe}`);
});

test('extortion and escape have measurable persistent outcomes', () => {
  let s;
  for (let i = 0; i < 100; i++) {
    const candidate = move(move(createSociety(`bandit-case-${i}`, { player: { coins: 8 } }), 'forest'), 'deep_forest');
    if (candidate.activeThreat) { s = candidate; break; }
  }
  assert.ok(s, 'seed producing threat exists');
  const original = structuredClone(s);
  const paid = run(s, { kind: 'pay_demand' });
  assert.ok(paid.ok);
  assert.equal(paid.state.player.coins, 5);
  assert.equal(paid.state.npcs.bandit.coins, original.npcs.bandit.coins + 3);
  assert.equal(paid.state.activeThreat, null);
  assert.deepEqual(s, original);
  const flee = run(s, { kind: 'flee' });
  assert.ok(flee.ok);
  assert.ok(flee.state.regionId === 'forest' || flee.state.player.health < s.player.health);
  assert.ok(flee.state.events.some(e => e.type === 'flee'));
});

test('fighting a stronger opponent can injure or kill hero; fights are not auto-won', () => {
  let injuries = 0;
  for (let i = 0; i < 80; i++) {
    let s = move(move(createSociety(`duel-${i}`), 'forest'), 'deep_forest');
    const before = s.player.health;
    const outcome = run(s, { kind: 'attack', npcId: 'bandit' });
    assert.ok(outcome.ok);
    if (outcome.state.player.health < before) injuries++;
    assert.equal(s.player.health, before);
  }
  assert.ok(injuries > 40, `not enough injuries: ${injuries}`);
});

test('invalid commands do not advance or alter persistent state', () => {
  const s = createSociety('invalid');
  for (const cmd of [
    { kind: 'offer', npcId: 'danil', price: -4, value: 10 },
    { kind: 'travel', to: 'unknown' },
    { kind: 'attack', npcId: 'bandit' },
    { kind: 'accept_offer', npcId: 'danil' },
    { kind: 'pay_demand' }
  ]) {
    const r = run(s, cmd);
    assert.equal(r.ok, false);
    assert.deepEqual(r.state, s);
  }
});

test('save and restore preserve profiles, obligations, health and events exactly', () => {
  let s = createSociety('save-identity', { player: { coins: 5 } });
  s = run(s, { kind: 'ask_help', npcId: 'ilyana' }).state;
  const saved = JSON.parse(JSON.stringify(s));
  assert.deepEqual(saved, s);
  assert.deepEqual(run(saved, { kind: 'ask_help', npcId: 'danil' }),
    run(s, { kind: 'ask_help', npcId: 'danil' }));
});

test('generic simulation works in custom region with custom employer, without special brothel code', () => {
  const s = createSociety('workplace', {
    regionId: 'workplace',
    regions: [
      { id: 'workplace', peacefulShare: .4, oppression: .86, protection: .1, crime: .4, routes: [] }
    ],
    npcs: [
      { id: 'manager', name: 'Employer', regionId: 'workplace', coins: 40,
        traits: { greed: .92, empathy: .15, aggression: .35, caution: .6 }, goals: ['profit'] }
    ],
    player: { coins: 2 }
  });
  assert.ok(assessRisk(s, { regionId: 'workplace' }).score > 0);
  const offer = run(s, { kind: 'offer', npcId: 'manager', price: 20, value: 10, service: 'shift' });
  assert.equal(offer.outcome, 'refuse');
  assert.equal(offer.state.player.coins, 2);
  assert.ok(offer.state.npcs.manager.memory.some(m => m.kind === 'offer'));
});
