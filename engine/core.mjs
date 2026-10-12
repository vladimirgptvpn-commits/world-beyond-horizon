// World Beyond Horizon v0.2: deterministic reference game engine.
 // ChatGPT can map free text to structured actions; this file itself is not an LLM.
export const FORMAT_VERSION = '0.2.0';
const PLACES = Object.freeze({
  square: { name: 'Деревенская площадь', text: 'Колодец, липа и скрипучая доска объявлений. За крышами темнеет лес.', exits: ['inn', 'forest'] },
  inn: { name: 'Трактир «Три свечи»', text: 'Тепло очага и запах хлеба наполняют зал.', exits: ['square'] },
  forest: { name: 'Опушка', text: 'Влажная хвоя, следы зверей. Среди корней видны древние камни.', exits: ['square', 'tower'] },
  tower: { name: 'Старая башня', text: 'Серый каменный остов возвышается над зарослями. Никто не знает всей его истории.', exits: ['forest'] }
});
const ALIASES = Object.freeze({
  square: ['площадь', 'площадь деревни', 'деревенская площадь', 'колодец'],
  inn: ['трактир', 'три свечи', 'таверна'],
  forest: ['лес', 'опушка', 'лесная опушка'],
  tower: ['башня', 'старая башня', 'руины']
});
const NPC = Object.freeze({
  ilyana: { name: 'Ильяна', aliases: ['ильяна', 'ильяне', 'ильяной', 'ильяну'] },
  danil: { name: 'Данил', aliases: ['данил', 'данила', 'данилом', 'данилу'] }
});
const LANTERN = ['фонарь', 'фонаря', 'фонарём', 'фонарем'];
const norm = value => String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/[«»"'.,!?]/g, '').replace(/\s+/g, ' ');
// Grammatical agreement follows the player's own gender entry, not the hero's name.
export function grammaticalGender(value) {
  const v = norm(value);
  if (/^(жен|дев|ж$|female|woman|girl)/.test(v)) return 'feminine';
  if (/^(муж|пар|м$|male|man|boy)/.test(v)) return 'masculine';
  return 'neutral';
}
export function heroHeading(hero) {
  const gender = grammaticalGender(hero?.gender);
  return gender === 'feminine' ? 'Героиня' : gender === 'masculine' ? 'Герой' : 'Персонаж';
}
const named = (v, terms) => terms.some(term => norm(v) === term || norm(v).includes(term));
const clone = obj => structuredClone(obj);

export function createGame(hero, adventureId = 'local-demo') {
  if (!hero || typeof hero !== 'object') throw new Error('Требуются ответы для создания героя');
  const { name, gender, age, origin, defining_trait } = hero;
  if (![name, gender, origin, defining_trait].every(v => typeof v === 'string' && v.trim())) throw new Error('Заполни имя, пол, происхождение и главную особенность');
  if (!((Number.isInteger(age) && age > 0 && age <= 130) || (typeof age === 'string' && age.trim()))) throw new Error('Укажи возраст');
  return {
    format_version: FORMAT_VERSION, adventure_id: adventureId, world_id: 'starter-village-001',
    revision: 0, turn: 0, game_time: 0, location_id: 'square',
    hero: { name: name.trim(), gender: gender.trim(), age, origin: origin.trim(), defining_trait: defining_trait.trim(), inventory: [] },
    discovered: ['square', 'inn', 'forest'], visited: ['square'],
    world_truths: { magic_exists: true, magic_rule: 'Чудеса редки и связаны с древними местами; обычные люди не умеют произвольно колдовать.' },
    npc_locations: { ilyana: 'square', danil: 'inn' },
    item_locations: { lantern: 'inn' }, flags: { found_path: false, asked_lantern: false, returned_lantern: false },
    reputation: 0, events: [], journal: []
  };
}
export function locationNames() { return Object.fromEntries(Object.entries(PLACES).map(([k, v]) => [k, v.name])); }
export function resolvePlace(value) {
  const s = norm(value);
  return Object.keys(PLACES).find(id => id === s || named(s, ALIASES[id])) || null;
}
function resolveNpc(value) {
  const s = norm(value);
  return Object.keys(NPC).find(id => id === s || named(s, NPC[id].aliases)) || null;
}
function describe(state) {
  const place = PLACES[state.location_id];
  const people = Object.entries(state.npc_locations).filter(([, p]) => p === state.location_id).map(([id]) => NPC[id].name);
  const items = state.item_locations.lantern === state.location_id ? ['фонарь'] : [];
  const exits = place.exits.filter(id => state.discovered.includes(id)).map(id => PLACES[id].name);
  return `${place.name}. ${place.text}\nРядом: ${people.join(', ') || 'никого'}. Предметы: ${items.join(', ') || 'нет'}.\nПути: ${exits.join('; ') || 'неизвестны'}.`;
}
export function describeScene(state) { return describe(state); }
export function renderMap(state) {
  return ['Карта известных мест:', ...state.discovered.map(id => {
    const v = PLACES[id];
    return `${state.location_id === id ? '▶' : state.visited.includes(id) ? '●' : '○'} ${v.name}: ${v.exits.filter(e => state.discovered.includes(e)).map(e => PLACES[e].name).join(', ') || 'нет известных переходов'}`;
  })].join('\n');
}
export function publicState(state) {
  const { world_truths, ...rest } = state;
  return clone(rest);
}
// Validate one structured action. Invalid actions never advance time.
export function applyAction(original, action) {
  if (!original || original.format_version !== FORMAT_VERSION) throw new Error('Несовместимое состояние игры');
  if (!action || typeof action.type !== 'string') return { state: original, text: 'Не поняла действие. Уточни, что ты делаешь.', ok: false };
  const s = clone(original);
  const type = action.type;
  let spent = 0, changed = false, text = '';
  const fail = (message) => ({ state: original, text: message, ok: false });
  switch (type) {
    case 'look': text = describe(s); break;
    case 'map': text = renderMap(s); break;
    case 'inventory': text = `Инвентарь: ${s.hero.inventory.join(', ') || 'пусто'}.`; break;
    case 'status': text = `${s.hero.name}, ${s.hero.origin}. Время: ${s.game_time} мин. Место: ${PLACES[s.location_id].name}. Репутация: ${s.reputation}.`; break;
    case 'journal': text = s.journal.join('\n') || 'Записей пока нет.'; break;
    case 'help': text = 'Примеры: осмотреться, карта, идти в трактир, говорить с Ильяной, взять фонарь, отдать фонарь Ильяне, исследовать, ждать 30, инвентарь, журнал.'; break;
    case 'go': {
      const to = resolvePlace(action.destination);
      if (!to) return fail('Такого места пока нет на известной карте.');
      if (!PLACES[s.location_id].exits.includes(to)) return fail('Отсюда нет прямого пути в указанное место.');
      if (!s.discovered.includes(to)) return fail('Путь ещё не открыт. Можно исследовать окрестности.');
      s.location_id = to;
      if (!s.visited.includes(to)) s.visited.push(to);
      spent = 10; changed = true; text = 'Ты добираешься до нового места.'; break;
    }
    case 'talk': {
      const id = resolveNpc(action.npc);
      if (!id || s.npc_locations[id] !== s.location_id) return fail('Этого человека сейчас здесь нет.');
      spent = 5; changed = true;
      if (id === 'ilyana') {
        if (s.flags.returned_lantern) text = 'Ильяна благодарит тебя и предлагает отдохнуть у очага.';
        else {
          const gender = grammaticalGender(s.hero.gender);
          const freeChoice = gender === 'feminine' ? 'Но ты мне ничего не должна' : gender === 'masculine' ? 'Но ты мне ничего не должен' : 'Но помогать необязательно';
          text = `Ильяна рассказывает, что забыла старый фонарь в трактире. «Если найдёшь — буду признательна. ${freeChoice}». `;
          s.flags.asked_lantern = true;
        }
      } else text = 'Данил, трактирщик, говорит: «На опушке под мхом видели старые камни. Не каждому захочется туда идти». ';
      break;
    }
    case 'explore': {
      spent = 15; changed = true;
      if (s.location_id === 'forest' && !s.flags.found_path) {
        s.flags.found_path = true; s.discovered.push('tower');
        s.journal.push('На опушке открыта тропа к старой башне.');
        text = 'Ты раздвигаешь ветви и находишь заросшую тропу к старой башне. Путь отмечен на карте.';
      } else text = `Ты внимательно исследуешь окрестности. ${describe(s)}`;
      break;
    }
    case 'take': {
      if (!named(action.item, LANTERN)) return fail('Этот предмет здесь не обнаружен.');
      if (s.item_locations.lantern !== s.location_id) return fail('Фонаря здесь нет.');
      s.item_locations.lantern = 'inventory'; s.hero.inventory.push('фонарь');
      spent = 2; changed = true; text = 'Ты берёшь старый фонарь. Он пока не зажжён.'; break;
    }
    case 'give': {
      const id = resolveNpc(action.npc);
      if (!named(action.item, LANTERN) || id !== 'ilyana') return fail('Пока передать это некому.');
      if (s.npc_locations.ilyana !== s.location_id) return fail('Ильяны сейчас здесь нет.');
      if (!s.hero.inventory.includes('фонарь')) return fail('У тебя нет фонаря.');
      if (s.flags.returned_lantern) return fail('Фонарь уже возвращён.');
      s.hero.inventory = s.hero.inventory.filter(item => item !== 'фонарь');
      s.item_locations.lantern = 'ilyana'; s.flags.returned_lantern = true; s.reputation += 2;
      s.journal.push('Ты вернул фонарь Ильяне. Она запомнила эту помощь.');
      spent = 5; changed = true; text = 'Ильяна принимает фонарь и улыбается. Теперь она тебе доверяет немного больше.'; break;
    }
    case 'wait': {
      const minutes = Number(action.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return fail('Укажи ожидание от 1 до 1440 минут.');
      spent = minutes; changed = true; text = `Проходит ${minutes} мин.`; break;
    }
    default: return fail('Пока такое действие не поддерживается правилами этой сцены. Можно уточнить намерение или выбрать другое действие.');
  }
  if (changed) {
    const oldTime = s.game_time;
    s.game_time += spent; s.turn += 1; s.revision += 1;
    if (oldTime < 60 && s.game_time >= 60 && s.npc_locations.ilyana === 'square') {
      s.npc_locations.ilyana = 'inn';
      s.events.push({ at: 60, type: 'npc_move', npc: 'ilyana', from: 'square', to: 'inn' });
      text += s.location_id === 'square' ? '\nИльяна прощается и уходит в трактир.' : s.location_id === 'inn' ? '\nИльяна приходит в трактир.' : '';
    }
    s.events.push({ at: s.game_time, type: 'action', action: type, turn: s.turn });
    if (s.events.length > 100) s.events = s.events.slice(-100);
    if (type === 'go') text += `\n${describe(s)}`;
  }
  return { state: s, text, ok: true };
}
// A small grammar for the terminal demo; ChatGPT handles broader natural language.
export function parseSimpleCommand(input) {
  const s = norm(input);
  if (/^(осмотр|смотреть|огляд|посмотр|look)/.test(s)) return { type: 'look' };
  if (/^(карта|map)$/.test(s)) return { type: 'map' };
  if (/^(инвентарь|рюкзак|inventory)$/.test(s)) return { type: 'inventory' };
  if (/^(статус|состояние)$/.test(s)) return { type: 'status' };
  if (/^(журнал|записи)$/.test(s)) return { type: 'journal' };
  if (/^(помощь|help|\?)$/.test(s)) return { type: 'help' };
  if (/^(исслед|обыск|развед)/.test(s)) return { type: 'explore' };
  if (/^(ждать|подождать|ожидать|wait)\s+\d+/.test(s)) return { type: 'wait', minutes: Number(s.match(/\d+/)[0]) };
  if (/^(идти|пойти|перейти|отправиться|двигаться|go)(?:\s|$)/.test(s)) return { type: 'go', destination: s };
  if (/^(говорить|поговорить|побеседовать|спросить|talk)(?:\s|$)/.test(s)) return { type: 'talk', npc: s };
  if (/^(взять|поднять|забрать|take)(?:\s|$)/.test(s)) return { type: 'take', item: s };
  if (/^(отдать|передать|вернуть|give)(?:\s|$)/.test(s)) return { type: 'give', item: s, npc: s };
  return { type: 'unknown' };
}
