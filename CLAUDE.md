# NetStorm Web

Фан-ремейк NetStorm: Islands At War для браузера. `packages/sim` — детерміноване ядро на TypeScript, `packages/client` — клієнт на PixiJS.

## Документи

Карта документації — у [docs/README.md](docs/README.md). Коротко:

- Правила гри й те, що з них реалізовано: [docs/game-rules.md](docs/game-rules.md). Читати перед зміною правил і оновлювати в тому ж коміті.
- Будова коду: [docs/architecture.md](docs/architecture.md).
- Черга робіт: [docs/TODO.md](docs/TODO.md).
- Єдине джерело істини про правила гри — `docs/reference/*.txt` (офіційні тексти оригіналу, не редагувати). Фан-вікі, DevLog і власні здогадки правилами не вважаються. Файли великі: шукайте в них, а не читайте цілком.

Не подавайте вигадане для прототипу число чи правило як факт про оригінал: позначайте `?` або «вигадано».

## Команди

- `npm run check` — lint, формат, typecheck, тести, збірка, бюджет розміру. Запускати перед комітом.
- `npm run test:browser` — smoke у Chromium, включно з replay.
- `npm test` — лише тести симуляції.
- `npm run lint:fix`, `npm run format` — автовиправлення oxlint і dprint.

## Правила роботи з кодом

- Симуляція детермінована: без `Math.random()`, `Date.now()` і часу кадру; випадковість лише через `World.rng`.
- Зміна поведінки правил або полів стану потребує підняття `RULES_VERSION` / `SNAPSHOT_VERSION` у `packages/sim/src/snapshot.ts` і оновлення зафіксованих хешів у `packages/sim/test/architecture.test.ts`.
- Стиль тримають oxlint і dprint: дужки в усіх блоках, порожні рядки навколо блоків, без магічних чисел у `src`.
- Коміти — Conventional Commits, перевіряються хуком.
