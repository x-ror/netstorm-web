<script lang="ts">
  import { untrack } from 'svelte';
  import {
    BRIDGE_SETS,
    BRIDGE_SLOTS,
    GEYSER_STOCKS,
    KILL_REWARDS,
    UNIT_RATES,
  } from '@netstorm/sim';
  import type { Mission } from '../game-data.js';
  import {
    BRIDGE_LABELS,
    MAX_SEED,
    MAX_STORM,
    PLAYABLE_THEMES,
    UNIT_RATE_NAMES,
    normalizeOptions,
    type MatchOptions,
    type PlayableTheme,
  } from '../options.js';
  import type { MenuProps } from './contracts.js';
  import UnitIcon from './UnitIcon.svelte';
  import { knowledgeOf } from '../knowledge.js';

  let { missions: english, translated, defs, atlas, initial, onstart }: MenuProps = $props();

  /** Each Fury on its card: its name and the units it is known by. */
  const FURIES: Record<PlayableTheme, { name: string; note: string; }> = {
    wind: { name: 'Вітер', note: 'Crossbow, Wind Tower, Dust Devil' },
    rain: { name: 'Дощ', note: "Ice Cannon, Ice Tower, Man o' War" },
    thunder: { name: 'Грім', note: 'Thunder Cannon, Vander Tower, Bulwark' },
  };
  const TEMPLE_ICON = 64; // pixels of a Temple on a Fury's card
  const ENEMY_ICON = 32;
  /** Names a mission file gives where it names no one. */
  const GENERIC_ENEMIES: ReadonlySet<string> = new Set(['player', 'суперник']);

  let options: MatchOptions = $state(untrack(() => ({ ...initial })));
  // The same missions in the language chosen; a mission keeps its id in both.
  const missions = $derived(options.lang === 'en' ? english : translated);
  const mission = $derived(missions.find((m) => m.id === options.mission));
  let list: HTMLElement | undefined = $state();
  /** The briefing, or the Knowledge the mission gives ("Review Knowledge"). */
  let view: 'briefing' | 'knowledge' = $state('briefing');
  const known = $derived(knowledgeOf(defs, mission, options.theme));
  const KNOWN_ICON = 40;

  // The chosen mission is kept in view, when the menu opens and whenever it changes.
  $effect(() => {
    const chosen = options.mission;
    list?.querySelector(`input[value="${CSS.escape(chosen)}"]`)?.closest('label')
      ?.scrollIntoView({ block: 'nearest' });
  });

  function enemyOf(m: Mission): string {
    const name = m.enemy.trim();
    return name && !GENERIC_ENEMIES.has(name.toLowerCase()) ? name : '';
  }

  /** A mission starts the player with the Storm Power it gives. */
  function chooseMission(m: Mission): void {
    if (m.storm) {
      options.storm = m.storm;
    }
  }

  function start(event: SubmitEvent): void {
    event.preventDefault();
    onstart(normalizeOptions(options, missions));
  }
</script>

<form class="start" onsubmit={start}>
  <header class="title">
    <h1>NetStorm</h1>
    <p>Islands At War · фан-ремейк для браузера</p>
  </header>

  <section class="pane side">
    <h2>Ваша Фурія</h2>
    <div class="furies">
      {#each PLAYABLE_THEMES as id (id)}
        <label class="fury theme-{id}">
          <input type="radio" name="theme" value={id} bind:group={options.theme} />
          <UnitIcon {atlas} type="{id}vortex" name={FURIES[id].name} size={TEMPLE_ICON} />
          <b>{FURIES[id].name}</b>
          <small>{FURIES[id].note}</small>
        </label>
      {/each}
    </div>

    <h2>Суперник</h2>
    <div class="furies small">
      {#each PLAYABLE_THEMES as id (id)}
        <label class="fury theme-{id}">
          <input type="radio" name="enemyTheme" value={id} bind:group={options.enemyTheme} />
          <UnitIcon {atlas} type="{id}vortex" name={FURIES[id].name} size={ENEMY_ICON} />
          <b>{FURIES[id].name}</b>
        </label>
      {/each}
    </div>
    <div class="segmented">
      <label>
        <input type="radio" name="opponent" value="ai" bind:group={options.opponent} />
        <span>Комп'ютер</span>
      </label>
      <label>
        <input type="radio" name="opponent" value="idle" bind:group={options.opponent} />
        <span>Без дій</span>
      </label>
    </div>

    <details class="options">
      <summary>Параметри бою</summary>
      <div class="menu-form">
        <label>
          Набір мостів
          <select name="bridges" bind:value={options.bridges}>
            {#each BRIDGE_SETS as id (id)}<option value={id}>{BRIDGE_LABELS[id]}</option>{/each}
          </select>
        </label>
        <label>
          Слотів для сегментів
          <select name="slots" bind:value={options.slots}>
            {#each BRIDGE_SLOTS as slots (slots)}<option value={slots}>{slots}</option>{/each}
          </select>
        </label>
        <label>
          Пауза між однаковими юнітами
          <select name="unitRate" bind:value={options.unitRate}>
            {#each UNIT_RATES as seconds, i (seconds)}
              <option value={seconds}>{UNIT_RATE_NAMES[i]} — {seconds} с</option>
            {/each}
          </select>
        </label>
        <label>
          Нагорода за знищення
          <select name="killReward" bind:value={options.killReward}>
            {#each KILL_REWARDS as share (share)}<option value={share}>
                {share} % вартості
              </option>{/each}
          </select>
        </label>
        <label>
          Запас гейзера
          <select name="geyserStock" bind:value={options.geyserStock}>
            {#each GEYSER_STOCKS as stock (stock)}<option value={stock}>{stock}</option>{/each}
          </select>
        </label>
        <label>
          Буресила на старті
          <input
            name="storm"
            type="number"
            min="0"
            max={MAX_STORM}
            step="100"
            bind:value={options.storm}
          />
        </label>
        <label>
          Зерно випадковості
          <input name="seed" type="number" min="0" max={MAX_SEED} bind:value={options.seed} />
        </label>
      </div>
    </details>
  </section>

  <section class="pane missions">
    <h2>Місія</h2>
    <div class="mission-list" bind:this={list}>
      {#each missions as m (m.id)}
        {@const enemy = enemyOf(m)}
        <label class="mission">
          <input
            type="radio"
            name="mission"
            value={m.id}
            bind:group={options.mission}
            onchange={() => chooseMission(m)}
          />
          <b>{m.title}</b>
          {#if enemy}<small>{enemy}</small>{/if}
        </label>
      {/each}
    </div>
  </section>

  <section class="pane briefing">
    <h2>{mission?.title ?? ''}</h2>
    <div class="segmented tabs">
      <label>
        <input type="radio" name="lang" value="uk" bind:group={options.lang} />
        <span>Українською</span>
      </label>
      <label>
        <input type="radio" name="lang" value="en" bind:group={options.lang} />
        <span>Оригінал</span>
      </label>
    </div>
    <div class="segmented tabs">
      <label>
        <input type="radio" name="view" value="briefing" bind:group={view} />
        <span>Брифінг</span>
      </label>
      <label>
        <input type="radio" name="view" value="knowledge" bind:group={view} />
        <span>База знань</span>
      </label>
    </div>
    {#if view === 'briefing'}
      <pre>{mission?.briefing ?? ''}</pre>
    {:else}
      <ul class="knowledge">
        {#each known as { def, kind } (def.id)}
          <li>
            <UnitIcon {atlas} type={def.id} name={def.name} size={KNOWN_ICON} />
            <b>{def.name}</b>
            <small>{kind}{def.level ? ` · рівень ${def.level}` : ''}</small>
            <span class="cost">{def.cost}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <button type="submit" class="primary start-button">Почати бій</button>
  </section>
</form>
