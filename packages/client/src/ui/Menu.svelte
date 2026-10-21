<script lang="ts">
  import { untrack } from 'svelte';
  import {
    BRIDGE_SETS,
    BRIDGE_SLOTS,
    DIFFICULTIES,
    GENERATOR_RANGES,
    GEYSER_INTERVALS,
    GEYSER_PLACEMENTS,
    GEYSER_RESPAWNS,
    GEYSER_STOCKS,
    SPELL_OPTIONS,
    STARTING_GEYSERS,
    KILL_REWARDS,
    UNIT_RATES,
  } from '@netstorm/sim';
  import type { Mission } from '../game-data.js';
  import {
    BRIDGE_LABELS,
    CAMPAIGN_LEVELS,
    DIFFICULTY_LABELS,
    GEYSER_PLACEMENT_LABELS,
    GENERATOR_RANGE_LABELS,
    SPELL_LABELS,
    STARTING_GEYSER_LABELS,
    ISLAND_COUNTS,
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
  import { unitName } from '../messages.js';
  import { m } from '../paraglide/messages.js';
  import { setLocale } from '../paraglide/runtime.js';

  let { missions: english, translated, campaign, done, defs, atlas, initial, onstart }: MenuProps =
    $props();

  /** Each Fury on its card: its name and the units it is known by. */
  const FURIES: Record<PlayableTheme, { name: () => string; units: string[]; }> = {
    wind: { name: m.fury_wind, units: ['windarcher', 'windblocker', 'windflyer'] },
    rain: { name: m.fury_rain, units: ['raincannon', 'rainblocker', 'rainflyer'] },
    thunder: { name: m.fury_thunder, units: ['thundercannon', 'thunderarcher', 'thunderblocker'] },
  };

  /** The units a Fury is known by, named in the player's language. */
  function noteOf(theme: PlayableTheme): string {
    return FURIES[theme].units.map((id) => unitName(id, defs.get(id)?.name ?? id)).join(', ');
  }

  const TEMPLE_ICON = 64; // pixels of a Temple on a Fury's card
  const ENEMY_ICON = 32;
  /** Names a mission file gives where it names no one. */
  const GENERIC_ENEMIES: ReadonlySet<string> = new Set(['player', 'суперник']);

  let options: MatchOptions = $state(untrack(() => ({ ...initial })));
  // The same missions in the language chosen; a mission keeps its id in both.
  const missions = $derived(options.lang === 'en' ? english : translated);
  const mission = $derived(missions.find((entry) => entry.id === options.mission));
  /** The chapters at the difficulty chosen, in the language chosen. */
  const chapters = $derived((options.lang === 'en' ? campaign.en : campaign.uk)
    .filter((chapter) => chapter.difficulty === options.campaignLevel));
  const byId = $derived(new Map(missions.map((entry) => [entry.id, entry])));

  /** A mission can be played once the one before it is done, as the original's checklist has
   * it ($Checked=…,{DonePrevious}). */
  function open(entry: { after: string | null; }): boolean {
    return entry.after === null || done.has(entry.after);
  }

  /** At another difficulty, the first mission not yet done that can be played. */
  function chooseLevel(): void {
    const all = chapters.flatMap((chapter) => chapter.missions);
    const next = all.find((entry) => open(entry) && !done.has(entry.id)) ?? all[0];

    if (next && !all.some((entry) => entry.id === options.mission)) {
      options.mission = next.id;
      const found = byId.get(next.id);

      if (found) {
        chooseMission(found);
      }
    }
  }

  let list: HTMLElement | undefined = $state();
  /** The briefing, or the Knowledge the mission gives ("Review Knowledge"). */
  let view: 'briefing' | 'knowledge' = $state('briefing');
  /** The title screen with its three categories, or one of them opened. */
  let screen: 'main' | 'missions' | 'skirmish' | 'settings' = $state('main');

  /** Escape goes back from a category to the title screen. */
  function back(event: KeyboardEvent): void {
    if (event.key === 'Escape' && screen !== 'main') {
      screen = 'main';
    }
  }

  const known = $derived(knowledgeOf(defs, mission, options.theme));
  const KNOWN_ICON = 40;

  // The interface follows the language of the missions' texts, set before the menu is drawn anew.
  $effect.pre(() => {
    setLocale(options.lang, { reload: false });
  });

  // The chosen mission is kept in view, when the menu opens and whenever it changes. Only the
  // list scrolls: scrollIntoView would scroll the whole menu too where it is taller than the window.
  $effect(() => {
    const chosen = options.mission;
    const label = list?.querySelector(`input[value="${CSS.escape(chosen)}"]`)?.closest('label');
    // The first mission of a chapter is shown with the chapter's name, under the sticky tabs.
    const heading = label?.previousElementSibling;
    const row = heading?.matches('h4') ? heading as HTMLElement : label;

    if (!list || !row) {
      return;
    }

    // Measured in the list's own layout: while the menu comes in, it is scaled on the screen.
    const tabs = list.querySelector<HTMLElement>('.tabs')?.offsetHeight ?? 0;
    const top = row.offsetTop - tabs;

    // A hidden mission comes up to the top, so the list starts on a whole row.
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top;
    }
  });

  let form: HTMLFormElement | undefined = $state();

  // Each screen opens at its top, whatever the one before was scrolled to.
  $effect(() => {
    void screen;
    form?.parentElement?.scrollTo(0, 0);
  });

  function enemyOf(entry: Mission): string {
    const name = entry.enemy.trim();
    return name && !GENERIC_ENEMIES.has(name.toLowerCase()) ? name : '';
  }

  /** A mission starts the player with the Storm Power it gives. */
  function chooseMission(entry: Mission): void {
    if (entry.storm) {
      options.storm = entry.storm;
    }
  }

  function start(event: SubmitEvent): void {
    event.preventDefault();
    // The page the battle is started from says what it is.
    const mode = screen === 'skirmish' ? 'skirmish' : 'mission';
    onstart(normalizeOptions({ ...options, mode }, missions));
  }
</script>

<svelte:window onkeydown={back} />

<form class="start screen-{screen}" onsubmit={start} bind:this={form}>
  {#key options.lang}
    <h1 class="visually-hidden">NetStorm: Islands At War</h1>

    {#if screen === 'main'}
      <nav class="plate categories" aria-label={m.menu_title()}>
        <button type="button" class="category" onclick={() => (screen = 'missions')}>
          {m.menu_missions()}<small>{m.menu_missions_note()}</small>
        </button>
        <button
          type="button"
          class="category"
          onclick={() => {
            screen = 'skirmish';
            // A fresh map each visit; the seed stays in the field to be kept or shared.
            options.seed = Math.floor(Math.random() * MAX_SEED) + 1;
          }}
        >
          {m.menu_skirmish()}<small>{m.menu_skirmish_note()}</small>
        </button>
        <button type="button" class="category" onclick={() => (screen = 'settings')}>
          {m.menu_settings()}<small>{m.menu_settings_note()}</small>
        </button>
      </nav>
    {:else}
      <section class="plate page page-{screen}">
        <header class="page-bar">
          <button type="button" class="back" onclick={() => (screen = 'main')}>
            ← {m.menu_back()} <kbd>Esc</kbd>
          </button>
          <h2>
            {
              screen === 'missions'
              ? m.menu_missions()
              : (screen === 'skirmish' ? m.menu_skirmish() : m.menu_settings())
            }
          </h2>
        </header>

        {#if screen === 'missions'}
          <div class="mission-list" bind:this={list}>
            <div class="segmented tabs levels">
              {#each CAMPAIGN_LEVELS as level (level)}
                <label>
                  <input
                    type="radio"
                    name="campaignLevel"
                    value={level}
                    bind:group={options.campaignLevel}
                    onchange={chooseLevel}
                  />
                  <span>{DIFFICULTY_LABELS[level === 'normal' ? 'normal' : level]()}</span>
                </label>
              {/each}
            </div>
            {#each chapters as chapter (chapter.id)}
              <h4 class="chapter" title={chapter.text}>{chapter.name}</h4>
              {#each chapter.missions as step, i (step.id)}
                {@const entry = byId.get(step.id)}
                {#if entry}
                  {@const enemy = enemyOf(entry)}
                  <label class="mission" class:locked={!open(step)}>
                    <input
                      type="radio"
                      name="mission"
                      value={entry.id}
                      disabled={!open(step)}
                      bind:group={options.mission}
                      onchange={() => chooseMission(entry)}
                    />
                    <b>{i + 1}. {entry.title}{#if done.has(entry.id)}<span
                          class="done"
                          title={m.menu_mission_done()}
                        >
                          ✓</span>{/if}</b>
                    {#if enemy}<small>{enemy}</small>{/if}
                  </label>
                {/if}
              {/each}
            {/each}
          </div>
          <div class="briefing">
            <div class="segmented tabs">
              <label>
                <input type="radio" name="view" value="briefing" bind:group={view} />
                <span>{m.menu_briefing()}</span>
              </label>
              <label>
                <input type="radio" name="view" value="knowledge" bind:group={view} />
                <span>{m.menu_knowledge()}</span>
              </label>
            </div>
            <h3>{mission?.title ?? ''}</h3>
            {#if view === 'briefing'}
              <pre>{mission?.briefing ?? ''}</pre>
            {:else}
              <ul class="knowledge">
                {#each known as { def, name, kind } (def.id)}
                  <li>
                    <UnitIcon {atlas} type={def.id} name={name} size={KNOWN_ICON} />
                    <b>{name}</b>
                    <small>{kind}{
                      def.level ? ` · ${m.menu_level({ level: def.level })}` : ''
                    }</small>
                    <span class="cost">{def.cost}</span>
                  </li>
                {/each}
              </ul>
            {/if}
            <button type="submit" class="primary start-button">{m.menu_start()}</button>
          </div>
        {:else if screen === 'skirmish'}
          <div class="skirmish">
            <div class="column">
              <h3>{m.menu_your_fury()}</h3>
              <div class="furies">
                {#each PLAYABLE_THEMES as id (id)}
                  <label class="fury theme-{id}">
                    <input type="radio" name="theme" value={id} bind:group={options.theme} />
                    <UnitIcon
                      {atlas}
                      type="{id}vortex"
                      name={FURIES[id].name()}
                      size={TEMPLE_ICON}
                    />
                    <b>{FURIES[id].name()}</b>
                    <small>{noteOf(id)}</small>
                  </label>
                {/each}
              </div>
              <h3>{m.menu_opponent()}</h3>
              <div class="furies small">
                {#each PLAYABLE_THEMES as id (id)}
                  <label class="fury theme-{id}">
                    <input
                      type="radio"
                      name="enemyTheme"
                      value={id}
                      bind:group={options.enemyTheme}
                    />
                    <UnitIcon
                      {atlas}
                      type="{id}vortex"
                      name={FURIES[id].name()}
                      size={ENEMY_ICON}
                    />
                    <b>{FURIES[id].name()}</b>
                  </label>
                {/each}
              </div>
              <div class="segmented">
                <label>
                  <input type="radio" name="opponent" value="ai" bind:group={options.opponent} />
                  <span>{m.menu_computer()}</span>
                </label>
                <label>
                  <input type="radio" name="opponent" value="idle" bind:group={options.opponent} />
                  <span>{m.menu_idle()}</span>
                </label>
                <label>
                  <input type="radio" name="opponent" value="watch" bind:group={options.opponent} />
                  <span>{m.menu_watch()}</span>
                </label>
              </div>
              {#if options.opponent !== 'idle'}
                <div class="segmented">
                  {#each DIFFICULTIES as id (id)}
                    <label>
                      <input
                        type="radio"
                        name="difficulty"
                        value={id}
                        bind:group={options.difficulty}
                      />
                      <span>{DIFFICULTY_LABELS[id]()}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="column">
              <h3>{m.menu_battle_options()}</h3>
              <div class="menu-form">
                <label>
                  {m.menu_islands()}
                  <select name="islands" bind:value={options.islands}>
                    {#each ISLAND_COUNTS as count (count)}<option value={count}>
                        {count}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_generator_range()}
                  <select name="generatorRange" bind:value={options.generatorRange}>
                    {#each GENERATOR_RANGES as cells, i (cells)}<option value={cells}>
                        {m.menu_range_option({ name: GENERATOR_RANGE_LABELS[i]?.() ?? '', cells })}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_spells()}
                  <select name="spells" bind:value={options.spells}>
                    {#each SPELL_OPTIONS as id (id)}<option value={id}>
                        {SPELL_LABELS[id]()}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_geysers()}
                  <select name="startGeysers" bind:value={options.startGeysers}>
                    {#each STARTING_GEYSERS as share, i (share)}<option value={share}>
                        {STARTING_GEYSER_LABELS[i]?.()}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_geyser_placement()}
                  <select name="geyserPlacement" bind:value={options.geyserPlacement}>
                    {#each GEYSER_PLACEMENTS as id (id)}<option value={id}>
                        {GEYSER_PLACEMENT_LABELS[id]()}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_geyser_interval()}
                  <select name="geyserInterval" bind:value={options.geyserInterval}>
                    {#each GEYSER_INTERVALS as seconds (seconds)}<option value={seconds}>
                        {seconds ? m.menu_geyser_interval_option({ seconds }) : m.menu_none()}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_geyser_respawn()}
                  <select name="geyserRespawn" bind:value={options.geyserRespawn}>
                    {#each GEYSER_RESPAWNS as share (share)}<option value={share}>
                        {m.menu_geyser_respawn_option({ share: Math.round(share * 100) })}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_bridges()}
                  <select name="bridges" bind:value={options.bridges}>
                    {#each BRIDGE_SETS as id (id)}<option value={id}>
                        {BRIDGE_LABELS[id]()}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_bridge_slots()}
                  <select name="slots" bind:value={options.slots}>
                    {#each BRIDGE_SLOTS as slots (slots)}<option value={slots}>
                        {slots}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_unit_rate()}
                  <select name="unitRate" bind:value={options.unitRate}>
                    {#each UNIT_RATES as seconds, i (seconds)}
                      <option value={seconds}>
                        {m.menu_unit_rate_option({ name: UNIT_RATE_NAMES[i] ?? '', seconds })}
                      </option>
                    {/each}
                  </select>
                </label>
                <label>
                  {m.menu_kill_reward()}
                  <select name="killReward" bind:value={options.killReward}>
                    {#each KILL_REWARDS as share (share)}<option value={share}>
                        {m.menu_kill_reward_option({ share })}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_geyser_stock()}
                  <select name="geyserStock" bind:value={options.geyserStock}>
                    {#each GEYSER_STOCKS as stock (stock)}<option value={stock}>
                        {stock}
                      </option>{/each}
                  </select>
                </label>
                <label>
                  {m.menu_storm()}
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
                  {m.menu_seed()}
                  <input
                    name="seed"
                    type="number"
                    min="0"
                    max={MAX_SEED}
                    bind:value={options.seed}
                  />
                </label>
              </div>
              <button type="submit" class="primary start-button">{m.menu_start()}</button>
            </div>
          </div>
        {:else}
          <div class="settings">
            <h3>{m.menu_language()}</h3>
            <div class="segmented">
              <label>
                <input type="radio" name="lang" value="uk" bind:group={options.lang} />
                <span>Українська</span>
              </label>
              <label>
                <input type="radio" name="lang" value="en" bind:group={options.lang} />
                <span>English</span>
              </label>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <p class="credit">{m.menu_credit()}</p>
  {/key}
</form>
