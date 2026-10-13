# NetStorm Web

Некомерційний фан-ремейк *NetStorm: Islands At War* (Titanic Entertainment / Activision, 1997) для браузера.

```
packages/sim      — ядро симуляції: чистий TypeScript, детерміноване, без залежностей (npm test -w @netstorm/sim)
packages/client   — PixiJS-клієнт (npm run dev -w @netstorm/client)
data/             — units.json, missions.json, forts.json — зняті з оригінального netstorm.tarc
scripts/          — smoke-browser.mjs: автоматичний browser smoke; check-size.mjs: бюджет збірки; untarc.py: розпаковує netstorm.tarc оригінальної гри; unshp.py: дістає всі спрайти з _shapes.shp
```

Інструменти розпакування оригіналу (untarc / unshp / unfort / parse_*) і розпаковані асети — у `netstorm-extracted.zip` / у файлах проєкту.

## Стан (фаза 1 — spike)
- [x] правила: мости з випадкових сегментів, будівлі на своїй землі, лінія вогню гармат і блокери,
      радіус Disc Thrower, транспорти → кристали → Storm Power, жрець (нокаут при ≤50 % HP, захоплення транспортом, ритуал із п'яти рун → перемога)
- [x] детермінізм і хеш стану для майбутнього lockstep
- [x] модульні правила, read-only контракт клієнта, версійовані snapshot/replay
- [x] клієнт: меню сутички з брифінгом, сітка 16×11 з оригінальними тайлами й спрайтами, панель виробництва, вибір і накази, міні-карта, пауза, тач; рішення без даних оригіналу — у docs/client-decisions.md
- [ ] числа, яких немає в офіційній довідці (радіус енергії, інтервали пострілів, тривалість ритуалу), — непідтверджені, див. docs/game-rules.md
- [x] простий комп'ютерний суперник (`packages/sim/src/ai.ts`), поведінка вигадана
- [ ] форми островів із `.fort`, повітряні юніти, бар'єри, заклинання, AI за прапорцями місій, мережа

## Розробка

Потрібні Node.js 24+ і npm. Встановлення залежностей: `npm ci`.

- `npm run dev` запускає клієнт.
- `npm run check` перевіряє типи, тести, збірку та її розмір.
- `npm run benchmark` порівнює час симуляції з попереднім пошуком цілей.
- `npm run test:browser` перевіряє production-сцену в Chromium. Потрібен браузер Playwright або Google Chrome.

Межі модулів, цикл симуляції, робота з даними та обмеження описані в [архітектурі](docs/architecture.md). Правила оригінальної гри та стан їх реалізації — у [docs/game-rules.md](docs/game-rules.md); повна карта документів — у [docs/README.md](docs/README.md).

## Коміти

Використовуємо Conventional Commits: `type(scope): description`. Scope необов'язковий. Приклади: `feat(sim): add priest rescue`, `fix(client): update bridge preview`, `perf(sim): index transports`.

`npm ci` або `npm install` встановлює Husky hook через `prepare`. Hook `commit-msg` перевіряє повідомлення локальним commitlint з `@commitlint/config-conventional`. Налаштування відповідає [офіційному посібнику commitlint](https://commitlint.js.org/guides/local-setup).

- `printf '%s\n' 'feat(sim): add priest rescue' | npm run lint:commit` перевіряє повідомлення вручну.
- `npm run lint:commits -- --last` перевіряє останній коміт.
- `npm run lint:commits -- --from <base-sha> --to HEAD` перевіряє нові коміти після вказаного SHA.

CI перевіряє коміти pull request відносно базової гілки й останній коміт push. Історію до цих змін не потрібно переписувати.

## Лінтинг і форматування

[Oxlint](https://oxc.rs/docs/guide/usage/linter/quickstart) перевіряє JavaScript і TypeScript. [dprint](https://dprint.dev/) форматує все: JS/TS, JSON, YAML, HTML і CSS. Стиль: два пробіли, одинарні лапки в JS/TS, крапки з комою, ширина рядка 100.

- `npm run lint` перевіряє код; попередження теж завершують команду помилкою.
- `npm run lint:fix` застосовує безпечні автоматичні виправлення Oxlint.
- `npm run format` форматує файли.
- `npm run format:check` перевіряє форматування без змін.

Hook `pre-commit` через lint-staged запускає Oxlint і dprint для підготовлених JS/TS файлів, а для JSON, YAML, HTML і CSS лише dprint. `npm run check` і CI перевіряють весь код. Експортовані ігрові дані, public-асети, збірки, lockfile та Markdown не форматуються.

Правила `unicorn/no-array-sort` і `unicorn/no-array-reverse` вимкнені: симуляція сортує й розвертає власні тимчасові масиви на місці, щоб уникнути додаткового копіювання. TypeScript окремо перевіряє типи через `npm run typecheck`.

Правила читабельності у `.oxlintrc.json` вимагають фігурних дужок у всіх умовах і циклах, окремого оголошення кожної змінної та `const` для незмінних значень. Тернарні вирази можна вкладати лише на один рівень і в дужках; присвоєння параметрам функцій і повторні імпорти заборонені. Між методами класу, а також перед і після `if`, циклів, `switch`, `try`, функцій і класів потрібен порожній рядок; ці правила надає `@stylistic/eslint-plugin`, підключений через `jsPlugins`. Максимальна вкладеність блоків становить 4 рівні, callback-функцій 3. Імпорти, які потрібні лише для типів, явно позначаються `type`.

Правило `no-magic-numbers` вимагає іменованих констант для чисел, крім -1, 0, 1 і 2. Воно вимкнене для тестів, `scripts/`, алгоритмів `rng.ts` і `checksum.ts` та таблиці кадрів `texture-selection.ts`.

Ці правила не обмежують довжину функцій або кількість параметрів довільними лімітами. Форматування залишається відповідальністю форматерів, а продуктивність симуляції перевіряється окремо. Опис правил є в [довіднику Oxlint](https://oxc.rs/docs/guide/usage/linter/rules).

Для JS/TS у `dprint.json` діють глобальні правила `arguments.preferHanging: "always"` і `arguments.preferSingleLine: true`. Вони зберігають початок виклику й callback на одному рядку, якщо він вкладається в `lineWidth: 100`, наприклад `hud.addEventListener('click', (event) => {`. Локальні ігнори для цього не потрібні. Плагіни dprint зафіксовані версіями в конфігурації й завантажуються при першому запуску форматера.
