# NetStorm Web

Некомерційний фан-ремейк *NetStorm: Islands At War* (Titanic Entertainment / Activision, 1997) для браузера.

```
packages/sim      — ядро симуляції: чистий TypeScript, детерміноване, без залежностей (npm test -w @netstorm/sim)
packages/client   — PixiJS-клієнт (npm run dev -w @netstorm/client)
data/             — units.json, missions.json, forts.json — зняті з оригінального netstorm.tarc
scripts/          — smoke-browser.mjs: автоматичний browser smoke; check-size.mjs: бюджет збірки
```

Інструменти розпакування оригіналу (untarc / unshp / unfort / parse_*) і розпаковані асети — у `netstorm-extracted.zip` / у файлах проєкту.

## Стан (фаза 1 — spike)
- [x] правила: мости з випадкових сегментів, будівлі на своїй землі, лінія вогню гармат і блокери,
      радіус Disc Thrower, транспорти → кристали → Storm Power, жрець (нокаут при ≤50 % HP, захоплення, жертва → перемога)
- [x] детермінізм і хеш стану для майбутнього lockstep
- [x] клієнт: ізометрична сітка 16×11, оригінальні спрайти, HUD, камера
- [ ] енергія/рівні — наближення, звірити з оригіналом
- [ ] форми островів із `.fort`, повітряні юніти, бар'єри, заклинання, AI, мережа

## Розробка

Потрібні Node.js 24+ і npm. Встановлення залежностей: `npm ci`.

- `npm run dev` запускає клієнт.
- `npm run check` перевіряє типи, тести, збірку та її розмір.
- `npm run benchmark` порівнює час симуляції з попереднім пошуком цілей.
- `npm run test:browser` перевіряє production-сцену в Chromium. Потрібен браузер Playwright або Google Chrome.

Межі модулів, цикл симуляції, робота з даними та обмеження описані в [архітектурі](docs/architecture.md).
