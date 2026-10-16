# Анімація: огляд гілки `copilot/improve-animation-quality`

Огляд PR #6 (14 комітів, +1980/−158) станом на 2026-10-16. На відміну від perf-гілки
(див. [perf-review.md](perf-review.md)), ця гілка не чіпає симуляцію, і її головна заява
підтверджена кодом. Мерджити можна після чистки, список нижче.

## Стан після мерджу

Зроблено на гілці `animation` перед мерджем у `main`: legacy-режим і `setImproved` прибрано разом з усіма `if (improved)` гілками, прапорцем режиму в `animations.ts` і `PAN_STEP`; бенч `NS_ANIMATION_BENCH` і `createAnimationFixture` видалено (smoke лишив перевірки камери й пікселів); `resetClock` один; українські абзаци в `architecture.md` повернуто й доповнено; презентаційні числа записано в `client-decisions.md` (п. 54); `animation-results.md` позначає виміри як історичні. Вартість +0.3–0.4 мс на кадр прийнято. Залишено: дрібниці з розділу нижче (паралельні мапи в рендерері, назви, `updateCamera` щокадру).

## Вердикт

Ядро брати. Прибрати legacy-режим і бенч із smoke, повернути українські абзаци в
`architecture.md`, записати вигадані презентаційні числа в `client-decisions.md`.

## Що перевірено і тримається

- **Геймплей не змінено.** У `match.ts` колбек `clock.advance` і далі виконує
  `match.step([...commands.splice(0), ...aiCommands()])`; додані `takeEvents()` і
  `renderer.capture()` лише зчитують події й копіюють семпли рендеру. Запис replay,
  `FixedStepClock` і sim не торкнуті. `camera.ts`/`controls.ts` пишуть тільки
  `camera.position` і `ui.hover`, команд не створюють. `deltaMS` рухає лише камеру.
- **Тест replay справжній**: `presentation.test.ts` звіряє `world.hash()` на кожному тіку,
  список подій, кортежі пострілів, тік завершення і `playReplay(...).hash()` між legacy та
  improved і між розкладами 30/60/144 Гц.
- **Відкладене** (інерція, плавний зум, частинки, тряска) не лишило мертвого коду.
- Інструменти: lint, dprint, typecheck, `npm test` (156 sim + 47 client), build,
  `test:browser` проходять. Коміти за Conventional Commits.
- Заяв про оригінал без позначки нема; `animation-results.md` прямо каже, що таймінги не
  з оригіналу.

## Прибрати перед мерджем

- **`setImproved(false)` і legacy-шлях.** У `renderer.ts` ~25 гілок `if (improved)`:
  `entityRoot`, `displayedDepth`, два виклики `playEffects()`, подвійний
  `drawStream(…, graphics?)` (Graphics і mesh), `drawBar(…, graphics = bars)`, health bars
  двома способами, `PAN_STEP` у `controls.ts`, `scene.states !== undefined` як прапорець
  режиму в `animations.ts` (suncannon). Legacy потрібен лише як контроль для бенчу, а
  їде користувачам через `window.ns`. Причому контроль нечистий: мапа `placements`
  перебудовується щотіку, а snapping камери діє в обох режимах, тож дельта занижує
  вартість improved. Видалити legacy; якщо A/B ще потрібен, тримати його у бенч-гілці.
- **Бенч із `test:browser`.** `smoke-browser.mjs` виріс на 274 рядки: дефолтний шлях
  тестується першим, далі opt-in бенч `NS_ANIMATION_BENCH` і перевірки DPR/зуму. Бенч
  лізе в `world.tick++`, `unit.cooldown`, `world.spawnBuilding`; заради нього `match.ts`
  виставляє `createAnimationFixture`, `cameraTools`, `advanceCamera`. Винести в окремий
  скрипт `perf:*`, фікстуру з `window.ns` забрати.
- **`architecture.md`**: два українські абзаци (рядки ~48, 72) замінено англійськими, які
  описують лише improved-шлях; рядок рендерера в таблиці модулів не згадує
  `presentation.ts`/`stream-batch.ts`. Рядок `animation-results.md` у README теж
  англійський. Повернути українську.
- **`animation-analysis.md`** переписано цілком (A1–A11, нова структура), а не доповнено.
  План посилається на затверджений аналіз фази 1, тож заміна зсуває базу, проти якої план
  затверджували. Порівняти з версією на `main` і лишити одне.

## Записати в `client-decisions.md`

Презентаційні рішення без даних оригіналу зараз лише в `animation-results.md` і
`architecture.md`: пан клавішами 480 px/с (`PAN_SPEED`), тінт пошкодження 2 тіки, контур
встановлення 3 тіки, ліміт 64 клітинок, `HIT_TINT`/`PROGRESS_COLOR`, піксельний snapping.
Коментар у `renderer.ts` «presentation approximation, not original sprite timing» має
жити в документі рішень.

## Дрібниці

- `placementsAccent.push` + евікція `MAX_PLACE_CELLS` двічі (`placed()` і `syncEntities`).
- `renderer.resetTime(); clock.reset();` чотири рази в `match.ts` замість `resetClock`.
- ~15 паралельних `Map<number, …>` за id сутності в `renderer.ts`; `placementsAccent`
  дублює `glides`/`centres`/`widths`. `renderer.ts` ~1400 рядків і володіє тінтами,
  лініями будівництва, акцентами, діагностикою `inspect()`, перемикачем режиму і
  90-рядковим rebase. Health bars, акценти й стріми просяться в окремі модулі;
  `presentation.ts` (56) і `stream-batch.ts` (93) розміру правильного.
- Назви: `polishG`, `placements` поруч із `placementsAccent`, `rebasing`.
- `updateCamera` перераховує `ui.hover` і кличе `drawOverlay()` кожен кадр, поки курсор
  над канвасом, навіть якщо камера стоїть. Дешево, але поза бенчем не виміряно.
- Sun cannon в improved показує кадр пострілу незалежно від позиції кільця.
- `renderer.placed` на події `bridge`.

## Критерій плану не виконано

План §Validation 6 вимагав узгодити середовище вимірювань і поріг шуму до реалізації.
Не зроблено; результати визнають, що поріг «діагностичний, не узгоджений». PR каже
«zero-cost acceptance remains unmet»: +0.3–0.4 мс у construction-фікстурі на 1× відтворюване,
0.9–1.2 мс під 4× throttling. Гілка не вимкнула фічу і не отримала згоди, а
задокументувала і відправила. Рішення за нами: прийняти цю вартість свідомо або ні.

План §8 (reduced motion): перевірки `prefers-reduced-motion` у TS нема, лише старий CSS.
Нічого не осцилює, тому прийнятно, але спалах тінту й fade акценту — новий рух без
вимикача.

Числа в `animation-results.md` відтворювані за методом (`NS_ANIMATION_BENCH=1 npm run
test:browser`), але зняті на SwiftShader з 4 vCPU; локально не збіжаться. Там же
зазначено, що dprint не завантажився і хуки були вимкнені, тож «npm run check passed»
на гілці перевірити локально (у worktree при огляді все пройшло).
