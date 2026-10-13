// Generic social and physical simulation for World Beyond Horizon v0.3.
 // No profession-specific shortcuts and no protagonist immunity.
export const SOCIETY_VERSION = '0.3.0';
const bound = (n, min = 0, max = 1) => Math.max(min, Math.min(max, Number(n) || 0));
const integer = (n, min = 0) => Math.max(min, Math.floor(Number(n) || 0));
const amountOK = n => Number.isSafeInteger(n) && n >= 0;
const clone = s => structuredClone(s);
export function stableRoll(seed, key) {
  const source = `${seed}:${key}`;
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) { h ^= source.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
export function makeRegion(input) {
  if (!input?.id || typeof input.id !== 'string') throw new Error('Region id required');
  return {
    id: input.id, peacefulShare: bound(input.peacefulShare ?? .7),
    hazard: bound(input.hazard ?? .1), crime: bound(input.crime ?? .15),
    oppression: bound(input.oppression ?? .1), protection: bound(input.protection ?? .6),
    routes: [...(input.routes || [])]
  };
}
export function makeNPC(raw, seed, region) {
  if (!raw?.id || !raw?.name || !raw?.regionId || !region) throw new Error('NPC identity and location required');
  const trait = (name, baseline) => bound(raw.traits?.[name] ?? baseline + (stableRoll(seed, `${raw.id}:${name}`) - .5) * .4);
  return {
    id: raw.id, name: raw.name, regionId: raw.regionId,
    health: integer(raw.health ?? 10), coins: integer(raw.coins ?? 0),
    combat: integer(raw.combat ?? 2), relationship: bound(raw.relationship ?? 0, -1, 1),
    traits: { greed: trait('greed', .5), aggression: trait('aggression', .35),
      empathy: trait('empathy', .5), caution: trait('caution', .6), honesty: trait('honesty', .55) },
    stance: raw.stance || (stableRoll(seed, `stance:${raw.id}:${raw.regionId}`) < region.peacefulShare ? 'peaceful' : 'adverse'),
    goals: [...(raw.goals || [])], knowledge: [...(raw.knowledge || [])], memory: []
  };
}
export function createSociety(seed = 'demo', config = {}) {
  const defaults = [
    { id: 'village', peacefulShare: .70, hazard: .06, crime: .09, oppression: .1, protection: .8, routes: ['forest', 'market'] },
    { id: 'forest', peacefulShare: .35, hazard: .48, crime: .5, oppression: .04, protection: .08, routes: ['village', 'deep_forest'] },
    { id: 'deep_forest', peacefulShare: .20, hazard: .75, crime: .85, oppression: .03, protection: .02, routes: ['forest'] },
    { id: 'market', peacefulShare: .55, hazard: .08, crime: .4, oppression: .38, protection: .5, routes: ['village', 'institution'] },
    { id: 'institution', peacefulShare: .35, hazard: .08, crime: .36, oppression: .83, protection: .24, routes: ['market'] }
  ];
  const regions = Object.fromEntries((config.regions || defaults).map(x => { const r = makeRegion(x); return [r.id, r]; }));
  const definitions = config.npcs || [
    { id: 'ilyana', name: 'Ильяна', regionId: 'village', coins: 12, combat: 1,
      traits: { empathy: .72, greed: .26, aggression: .08, caution: .6 }, stance: 'peaceful', goals: ['recover_lantern'] },
    { id: 'danil', name: 'Данил', regionId: 'village', coins: 65, combat: 3,
      traits: { greed: .78, empathy: .38, caution: .7, aggression: .35 }, stance: 'peaceful', goals: ['profit', 'protect_inn'] },
    { id: 'bandit', name: 'Главарь шайки', regionId: 'deep_forest', coins: 9, combat: 8,
      traits: { greed: .92, aggression: .87, empathy: .08, caution: .42 }, stance: 'adverse', goals: ['obtain_valuables'] }
  ];
  const npcs = {};
  for (const d of definitions) {
    if (!regions[d.regionId] || npcs[d.id]) throw new Error('Invalid or duplicate NPC identity/region');
    npcs[d.id] = makeNPC(d, seed, regions[d.regionId]);
  }
  const initial = config.regionId || 'village';
  if (!regions[initial]) throw new Error('Unknown initial region');
  const p = config.player || {};
  return {
    version: SOCIETY_VERSION, seed: String(seed), regionId: initial, turn: 0,
    player: { health: integer(p.health ?? 10), combat: integer(p.combat ?? 2),
      coins: integer(p.coins ?? 0), injuries: [...(p.injuries || [])] },
    regions, npcs, contracts: [], ledger: [], events: [], activeThreat: null
  };
}
export function assessRisk(society, { regionId = society.regionId, npcId, minutes = 600 } = {}) {
  const r = society.regions[regionId];
  if (!r) throw new Error('Unknown region');
  const npc = npcId ? society.npcs[npcId] : null;
  if (npcId && (!npc || npc.regionId !== regionId)) throw new Error('NPC not in region');
  const hour = integer(minutes) % 1440;
  const night = (hour >= 1200 || hour < 300) ? .12 : 0;
  const actorRisk = npc ? npc.traits.aggression * .23 + npc.traits.greed * .13 - npc.traits.caution * .13 : 0;
  const score = bound(r.hazard * .32 + r.crime * .32 + r.oppression * .18 -
    r.protection * .24 + actorRisk + night);
  return { regionId, score: Math.round(score * 100),
    band: score < .2 ? 'low' : score < .45 ? 'elevated' : 'severe' };
}
function event(s, e) {
  s.turn++;
  s.events.push({ turn: s.turn, ...e });
  if (s.events.length > 100) s.events.splice(0, s.events.length - 100);
}
const good = (state, text, outcome, detail = null) => ({ ok: true, state, text, outcome, detail });
const bad = (state, text) => ({ ok: false, state, text, outcome: 'invalid', detail: null });
function transfer(s, from, to, coins, reason) {
  if (!amountOK(coins) || coins < 1) throw new Error('Transfer must be positive whole coins');
  const payer = from === 'player' ? s.player : s.npcs[from];
  const receiver = to === 'player' ? s.player : s.npcs[to];
  if (!payer || !receiver || payer.coins < coins) throw new Error('Insufficient funds');
  payer.coins -= coins; receiver.coins += coins;
  s.ledger.push({ turn: s.turn + 1, from, to, coins, reason });
}
function remember(npc, kind, turn, note) {
  npc.memory.push({ kind, turn, note });
  if (npc.memory.length > 40) npc.memory.shift();
}
export function resolveSocietyTurn(original, action) {
  if (!original || original.version !== SOCIETY_VERSION) throw new Error('Incompatible society state');
  if (!action || typeof action.kind !== 'string') return bad(original, 'Specify action kind');
  if (original.player.health <= 0) return bad(original, 'The hero has died');
  const s = clone(original);
  const { kind } = action;
  if (kind === 'travel') {
    if (!s.regions[action.to]) return bad(original, 'Unknown region');
    if (!s.regions[s.regionId].routes.includes(action.to)) return bad(original, 'No route');
    if (s.activeThreat) return bad(original, 'Resolve the active threat first');
    const from = s.regionId;
    s.regionId = action.to;
    let threat = null;
    const adversaries = Object.values(s.npcs).filter(n => n.regionId === action.to && n.health > 0 && n.stance === 'adverse');
    for (const npc of adversaries) {
      const rating = assessRisk(s, { npcId: npc.id, minutes: action.minutes ?? 600 });
      const chance = bound(rating.score / 120 + npc.traits.greed * .16 + npc.traits.aggression * .12 - .2);
      if (stableRoll(s.seed, `threat:${action.to}:${npc.id}:${s.turn + 1}`) < chance) {
        const demand = Math.max(1, Math.min(s.player.coins, 3));
        threat = { npcId: npc.id, demand, from, since: s.turn + 1 };
        s.activeThreat = threat;
        remember(npc, 'threat', s.turn + 1, 'Threatened the traveller');
        break;
      }
    }
    event(s, { type: 'travel', from, to: action.to, threat: !!threat });
    return good(s, threat
      ? `${s.npcs[threat.npcId].name} преграждает путь и требует ${threat.demand} монет. Можно откупиться, бежать или сопротивляться.`
      : 'Переход завершён; опасность не обязана обернуться нападением.', threat ? 'threat' : 'travel',
      threat ? { npcId: threat.npcId, demand: threat.demand } : null);
  }
  if (kind === 'pay_demand' || kind === 'flee') {
    if (!s.activeThreat) return bad(original, 'No active threat');
    const t = s.activeThreat, npc = s.npcs[t.npcId];
    if (kind === 'pay_demand') {
      if (t.demand > s.player.coins) return bad(original, 'Insufficient funds');
      transfer(s, 'player', npc.id, t.demand, 'extortion');
      s.activeThreat = null;
      event(s, { type: 'extortion_payment', npcId: npc.id, coins: t.demand });
      return good(s, `Отдано ${t.demand} монет. Противник отступает.`, 'paid');
    }
    const chance = bound(.47 + (s.player.combat - npc.combat) * .075 + npc.traits.caution * .1);
    const escape = stableRoll(s.seed, `flee:${npc.id}:${s.turn + 1}`) < chance;
    if (escape) { s.regionId = t.from; s.activeThreat = null; }
    else {
      const damage = Math.max(1, Math.ceil((npc.combat - s.player.combat) / 3));
      s.player.health = Math.max(0, s.player.health - damage);
      s.player.injuries.push({ turn: s.turn + 1, damage, cause: 'failed_escape' });
      if (s.player.health === 0) s.activeThreat = null;
    }
    event(s, { type: 'flee', npcId: npc.id, escaped: escape, health: s.player.health });
    return good(s, escape ? 'Удаётся скрыться от преследователя.' :
      s.player.health ? 'Побег сорвался, получена травма. Противник ещё рядом.' : 'Герой погиб от полученных травм.',
      escape ? 'escaped' : 'caught');
  }
  const npc = s.npcs[action.npcId];
  if (!npc || npc.regionId !== s.regionId || npc.health <= 0) return bad(original, 'NPC is unavailable');
  if (s.activeThreat && kind !== 'attack') return bad(original, 'Resolve the immediate threat first');
  if (kind === 'ask_help') {
    const generosity = bound(npc.traits.empathy * .55 + Math.max(0, npc.relationship) * .45 -
      npc.traits.greed * .25 - (npc.stance === 'adverse' ? .2 : 0));
    const granted = npc.coins > 0 && stableRoll(s.seed, `help:${npc.id}:${s.turn + 1}`) < generosity;
    if (granted) transfer(s, npc.id, 'player', 1, 'voluntary_assistance');
    remember(npc, 'help_request', s.turn + 1, granted ? 'Shared one coin' : 'Declined');
    event(s, { type: 'help_request', npcId: npc.id, granted });
    return good(s, granted ? `${npc.name} по собственному решению отдаёт одну монету.` :
      `${npc.name} отказывает в помощи.`, granted ? 'help' : 'refused');
  }
  if (kind === 'offer') {
    if (!amountOK(action.price) || !amountOK(action.value) || action.price < 1)
      return bad(original, 'Price and value must be nonnegative whole coins');
    const ceiling = Math.min(npc.coins, Math.max(0, Math.round(
      action.value * (1.35 - npc.traits.greed * .85) + npc.relationship * 2)));
    const decision = action.price <= ceiling ? 'accept' :
      action.price <= Math.round(ceiling * 1.7) && ceiling > 0 ? 'counter' : 'refuse';
    const offered = decision === 'accept' ? action.price : decision === 'counter' ? ceiling : null;
    remember(npc, 'offer', s.turn + 1, { asked: action.price, value: action.value, decision });
    // One unresolved offer per NPC; confirmation must happen immediately.
    npc.memory = npc.memory.filter(m => m.kind !== 'open_offer');
    if (offered !== null) remember(npc, 'open_offer', s.turn + 1,
      { price: offered, service: String(action.service || 'service').slice(0, 100) });
    event(s, { type: 'offer', npcId: npc.id, asking: action.price, decision, offer: offered });
    return good(s, decision === 'accept' ? `${npc.name} согласен/согласна заплатить ${offered} монет при подтверждении.` :
      decision === 'counter' ? `${npc.name} предлагает лишь ${offered} монет.` :
      `${npc.name} отказывается от цены.`, decision, { counter: decision === 'counter' ? offered : null });
  }
  if (kind === 'accept_offer') {
    const proposed = npc.memory.find(m => m.kind === 'open_offer');
    if (!proposed || proposed.turn !== s.turn) return bad(original, 'No currently available offer');
    const { price, service } = proposed.note;
    if (!amountOK(price) || price < 1 || npc.coins < price) return bad(original, 'Offer cannot be funded');
    transfer(s, npc.id, 'player', price, 'advance_payment');
    const contractId = `${npc.id}:${s.turn + 1}`;
    s.contracts.push({ id: contractId, npcId: npc.id, amount: price, refunded: 0,
      service, status: 'pending', createdTurn: s.turn + 1 });
    npc.memory = npc.memory.filter(m => m.kind !== 'open_offer');
    remember(npc, 'contract', s.turn + 1, `Advance ${price}`);
    event(s, { type: 'contract', contractId, npcId: npc.id, coins: price });
    return good(s, `Получено ${price} монет аванса; обязательство записано.`, 'contract', { contractId });
  }
  if (kind === 'cancel_contract') {
    const contract = s.contracts.find(x => x.id === action.contractId && x.npcId === npc.id && x.status === 'pending');
    if (!contract) return bad(original, 'No pending agreement');
    if (!amountOK(action.refund ?? 0) || action.refund > contract.amount) return bad(original, 'Invalid refund');
    const refund = action.refund ?? 0;
    if (refund > s.player.coins) return bad(original, 'Insufficient funds for refund');
    if (refund) transfer(s, 'player', npc.id, refund, 'contract_refund');
    contract.refunded = refund; contract.status = refund === contract.amount ? 'cancelled' : 'disputed';
    npc.relationship = bound(npc.relationship - .18 - (contract.amount - refund) / contract.amount * .30, -1, 1);
    remember(npc, 'contract_dispute', s.turn + 1, `Refunded ${refund} of ${contract.amount}`);
    event(s, { type: 'contract_cancel', contractId: contract.id, npcId: npc.id, refund,
      unpaid: contract.amount - refund });
    return good(s, refund === contract.amount ? 'Договорённость расторгнута, аванс возвращён.' :
      'Договорённость расторгнута; остаётся спор из-за невозвращённого аванса.', 'contract_cancelled');
  }
  if (kind === 'attack') {
    const winChance = bound(.42 + (s.player.combat - npc.combat) * .075);
    const won = stableRoll(s.seed, `fight:${npc.id}:${s.turn + 1}`) < winChance;
    const damage = Math.max(1, Math.min(5, Math.abs(s.player.combat - npc.combat) + 1));
    if (won) {
      npc.health = Math.max(0, npc.health - damage);
      remember(npc, 'injured', s.turn + 1, `Damage ${damage}`);
    } else {
      s.player.health = Math.max(0, s.player.health - damage);
      s.player.injuries.push({ turn: s.turn + 1, damage, cause: 'fight' });
      remember(npc, 'opponent_wounded', s.turn + 1, `Damage ${damage}`);
    }
    if (npc.health === 0 || s.player.health === 0 || won) s.activeThreat = null;
    event(s, { type: 'fight', npcId: npc.id, heroWonExchange: won, damage,
      playerHealth: s.player.health, npcHealth: npc.health });
    return good(s, won ? `${npc.name} получает рану, противник отступает после удара.` :
      s.player.health ? `Герой ранен и теряет ${damage} здоровья.` : 'Герой погиб от ран.',
      won ? 'npc_injured' : 'player_injured');
  }
  return bad(original, 'Unknown encounter action');
}
