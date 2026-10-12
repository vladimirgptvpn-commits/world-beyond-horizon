// Optional local terminal demo. Gameplay in ChatGPT uses adventure-runtime skill.
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createGame, applyAction, parseSimpleCommand, describeScene, heroHeading, FORMAT_VERSION } from './core.mjs';

const rl = createInterface({ input, output });
const ask = prompt => rl.question(prompt);
const saveDir = resolve(process.cwd(), '.saves');
let state;
try {
  console.log('Мир за горизонтом — локальное демо v0.2');
  const load = (await ask('Загрузить локальное сохранение? Укажи путь или нажми Enter: ')).trim();
  if (load) {
    const loaded = JSON.parse(await readFile(resolve(load), 'utf8'));
    if (loaded.format_version !== FORMAT_VERSION || !loaded.hero || !loaded.location_id) throw new Error('Неподдерживаемый файл сохранения');
    state = loaded;
  } else {
    const name = await ask('1/5 Имя героя: ');
    const gender = await ask('2/5 Пол: ');
    const ageText = await ask('3/5 Возраст: ');
    const origin = await ask('4/5 Происхождение: ');
    const defining_trait = await ask('5/5 Главная особенность: ');
    const age = /^\d+$/.test(ageText.trim()) ? Number(ageText) : ageText;
    state = createGame({ name, gender, age, origin, defining_trait }, randomUUID());
    console.log(`${heroHeading(state.hero)}: ${state.hero.name}, ${state.hero.age}, ${state.hero.origin}; ${state.hero.defining_trait}.`);
    const confirm = (await ask('Начать приключение? (да/нет): ')).trim().toLocaleLowerCase('ru-RU');
    if (!['да', 'д', 'yes', 'y'].includes(confirm)) { console.log('Создание героя отменено.'); process.exit(0); }
  }
  console.log('\n' + describeScene(state));
  console.log('Напиши «помощь» для списка команд, «сохранить игру» для локального сохранения, «выход» для выхода.');
  while (true) {
    const line = (await ask('\n> ')).trim();
    if (['выход', 'exit', 'quit'].includes(line.toLocaleLowerCase('ru-RU'))) break;
    if (line.toLocaleLowerCase('ru-RU') === 'сохранить игру') {
      await mkdir(saveDir, { recursive: true });
      const target = join(saveDir, `${state.adventure_id}.json`);
      const temp = `${target}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'w' });
      await rename(temp, target);
      const verify = JSON.parse(await readFile(target, 'utf8'));
      if (verify.revision !== state.revision || verify.adventure_id !== state.adventure_id) throw new Error('Проверка сохранения не прошла');
      console.log(`Игра сохранена локально: ${target}. Google Drive не используется.`);
      continue;
    }
    const result = applyAction(state, parseSimpleCommand(line));
    console.log(result.text);
    state = result.state;
  }
} catch (error) {
  console.error('Ошибка:', error.message);
  process.exitCode = 1;
} finally { rl.close(); }
