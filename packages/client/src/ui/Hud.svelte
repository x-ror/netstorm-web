<script lang="ts">
  import {
    LOG_LINES,
    type HudModel,
    type LogLine,
    type Page,
    type SelectedAction,
  } from '../hud-model.js';
  import type { HudProps } from './contracts.js';
  import Glyph from './Glyph.svelte';
  import Planks from './Planks.svelte';
  import UnitIcon from './UnitIcon.svelte';
  import { m } from '../paraglide/messages.js';

  let { atlas, actions }: HudProps = $props();

  const CARD_ICON = 40; // pixels of a unit's picture on its production card
  const PORTRAIT = 48; // pixels of the selected unit's picture
  const MENU_ICON = 32; // pixels of the unit's picture at the head of its menu
  const PER_CENT = 100;
  const EDGE = 8; // pixels the menu keeps from the sides of the window
  /** Actions that destroy what they act on: kept apart at the foot of the menu. */
  const DESTRUCTIVE: ReadonlySet<SelectedAction['kind']> = new Set(['salvage', 'meltdown']);

  // Each is replaced whole and never changed in place: no proxies for what is only read.
  let model: HudModel | null = $state.raw(null);
  let log: LogLine[] = $state.raw([]);
  let page: Page | null = $state.raw(null);
  /** The menu of the selected unit, where it was opened; and whether it reads the unit's facts. */
  let menu: { x: number; y: number; } | null = $state.raw(null);
  let about = $state(false);
  let menuBox: HTMLElement | undefined = $state();

  /** Draw the panels anew from the world as it is now. */
  export function update(next: HudModel): void {
    model = next;
  }

  /** Put lines on top of the log, the newest first. */
  export function addLog(lines: LogLine[]): void {
    log = [...[...lines].reverse(), ...log].slice(0, LOG_LINES);
  }

  export function showPage(next: Page): void {
    page = next;
  }

  export function hidePage(): void {
    page = null;
  }

  export function openContext(x: number, y: number): void {
    menu = { x, y };
    about = false;
  }

  function closeMenu(): void {
    menu = null;
  }

  function outside(ev: PointerEvent): void {
    if (!menuBox?.contains(ev.target as Node)) {
      closeMenu();
    }
  }

  // Inside the window, and its first command under the keyboard, once it is drawn.
  $effect(() => {
    if (!menu || !menuBox) {
      return;
    }

    const box = menuBox;
    box.style.left = `${Math.max(EDGE, Math.min(menu.x, innerWidth - box.offsetWidth - EDGE))}px`;
    box.style.top = `${Math.max(EDGE, Math.min(menu.y, innerHeight - box.offsetHeight - EDGE))}px`;
    box.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true });
  });

  // A press anywhere else closes it; a right click on another unit opens that one's after.
  $effect(() => {
    if (!menu) {
      return;
    }

    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  });

  /** Keys inside the menu are its own: arrows walk it, Escape closes it. */
  function menuKey(ev: KeyboardEvent): void {
    ev.stopPropagation();
    const items = [...(menuBox?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[ev.key] ?? 0;

    if (ev.key === 'Escape') {
      closeMenu();
    } else if (step && items.length) {
      ev.preventDefault();
      items[(at + step + items.length) % items.length]?.focus();
    }
  }

  function choose(action: SelectedAction): void {
    closeMenu();
    act(action);
  }

  function act(action: SelectedAction): void {
    switch (action.kind) {
      case 'cast':
        return actions.castSelected();
      case 'pray':
        return actions.pray(action.spell);
      case 'build':
        return actions.setTool({ kind: 'build', type: action.type });
      case 'drop':
        return actions.dropSelected();
      case 'salvage':
        return actions.salvageSelected();
      case 'meltdown':
        return actions.meltdownSelected();
      case 'produce':
        return actions.produceSelected(action.type);
      case 'upgrade':
        return actions.upgradeSelected();
    }
  }
</script>

{#if model}
  <header id="topbar">
    <span class="stat storm" title={m.hud_storm()}>
      <Glyph name="storm" /><span class="label">{m.hud_storm()}</span><b data-testid="storm">{
        model.storm
      }</b>
    </span>
    <span
      class="stat energy"
      title={m.hud_energy()}
    >
      <Glyph name="energy" /><span class="label">{m.hud_energy_label()}</span><b>{
        model.energy.own
      }</b><small>/ {model.energy.total}</small>
      <span
        class="meter"
        style:--share="{model.energy.total ? Math.round(model.energy.own / model.energy.total * PER_CENT) : 0}%"
      ></span>
    </span>
    <span class="stat clock" title={m.hud_clock()}><Glyph name="clock" /><span class="label">{
        m.hud_clock_label()
      }</span>{model.clock}</span>
    {#if model.watching}
      <span class="sides" role="group" aria-label={m.hud_watching()}>
        <span class="label">{m.hud_watching()}</span>
        {#each model.sides as side (side.id)}
          <button
            class:on={side.on}
            aria-pressed={side.on}
            title="{side.name} (Tab)"
            onclick={() => actions.view(side.id)}
          >
            {side.name}
          </button>
        {/each}
      </span>
    {/if}
    {#if model.aiLog}
      <button class="ai-log" title={m.hud_ai_log_hint()} onclick={actions.copyAiLog}>
        {m.hud_ai_log()}
      </button>
    {/if}
    <span class="sep"></span>
    <button
      class="icon-button"
      class:on={model.paused}
      aria-label={model.paused ? m.hud_resume() : m.hud_pause()}
      title="{model.paused ? m.hud_resume() : m.hud_pause()} (Space)"
      onclick={actions.togglePause}
    >
      <Glyph name={model.paused ? 'play' : 'pause'} />
    </button>
    <button
      class="icon-button"
      aria-label={m.hud_sound()}
      title={model.muted ? m.hud_sound_on() : m.hud_sound_off()}
      onclick={actions.toggleSound}
    >
      <Glyph name={model.muted ? 'muted' : 'sound'} />
    </button>
    <button
      class="icon-button"
      aria-label={m.hud_menu()}
      title={m.hud_menu()}
      onclick={actions.exit}
    >
      <Glyph name="menu" />
    </button>
  </header>

  <aside id="panel">
    <section class="card">
      <h3 title={m.hud_bridges_hint()}>
        {m.hud_bridges()}
        <span class="keys"><kbd>1</kbd>–<kbd>{model.bridgeSlots}</kbd> <kbd>R</kbd>
          {m.hud_rotate()}</span>
      </h3>
      <div id="hand">
        {#each model.slots as slot (slot.index)}
          {#if slot.piece}
            <button
              class="piece"
              class:on={slot.active}
              class:cracked={slot.cracked}
              title={slot.title}
              disabled={model.watching}
              onclick={() => actions.setTool({ kind: 'piece', hand: slot.index })}
            >
              <kbd>{slot.index + 1}</kbd><Planks piece={slot.piece} />
            </button>
          {:else}
            <span class="piece empty"><kbd>{slot.index + 1}</kbd></span>
          {/if}
        {/each}
        {#if !model.hasTemple}
          <p class="muted note">{m.hud_no_temple()}</p>
        {/if}
      </div>
    </section>

    <section class="card">
      <h3>{m.hud_production()} <span class="keys"><kbd>R</kbd> {m.hud_facing()}</span></h3>
      <div id="units">
        {#each model.units as card (card.id)}
          <button
            class="unit theme-{card.theme}"
            class:on={card.active}
            class:poor={card.poor}
            class:short={card.short}
            aria-label={card.name}
            title={card.title}
            disabled={model.watching}
            onclick={() => actions.setTool({ kind: 'build', type: card.id })}
          >
            <span class="mark"></span>
            <UnitIcon {atlas} type={card.id} name={card.name} size={CARD_ICON} />
            <span class="name">{card.name}{card.facing ? ` · ${card.facing}` : ''}</span>
            <span class="cost">{card.cost}</span>
            {#if card.cooling}
              <span
                class="cooling"
                style:--left="{Math.round(card.cooling.left * PER_CENT)}%"
              ></span>
              <span class="stamp">{m.hud_stamp_cooling({ seconds: card.cooling.seconds })}</span>
            {:else if card.short}
              <span class="stamp">{m.hud_short()}</span>
            {/if}
          </button>
        {/each}
        {#if !model.hasWorkshop}
          <p class="muted note">{m.hud_no_units()}</p>
        {/if}
      </div>
      <div id="tools">
        <button
          class:on={model.tool === 'select'}
          onclick={() => actions.setTool({ kind: 'select' })}
        >
          {m.hud_select()} <kbd>Esc</kbd>
        </button>
        <button
          class:on={model.tool === 'salvage'}
          disabled={model.watching}
          onclick={() => actions.setTool({ kind: 'salvage' })}
        >
          {m.hud_salvage()}
        </button>
      </div>
    </section>

    <section class="card" id="info">
      {#if model.selected}
        {@const chosen = model.selected}
        <div class="who theme-{chosen.theme ?? 'none'}">
          <span class="station {chosen.owner?.side ?? ''}">
            <UnitIcon {atlas} type={chosen.type} name={chosen.name} size={PORTRAIT} />
          </span>
          <div>
            <b>{chosen.name}</b>
            {#if chosen.owner}
              <span class="owner {chosen.owner.side}">{chosen.owner.name}</span>
            {/if}
          </div>
        </div>
        {#if chosen.hp}
          <div class="hp {chosen.hp.band}" style:--hp="{Math.round(chosen.hp.share * PER_CENT)}%">
            <span>{chosen.hp.value} / {chosen.hp.max}</span>
          </div>
        {/if}
        {#each chosen.facts as fact, i (i)}
          <div class="fact" class:muted={fact.muted}>{fact.text}</div>
        {/each}
        {#if chosen.actions.length}
          <div class="actions">
            {#each chosen.actions as action, i (i)}
              <button onclick={() => act(action)}>
                {action.label}
                {#if 'cost' in action}<small>{action.cost}</small>{/if}
                {#if 'key' in action}<kbd>{action.key}</kbd>{/if}
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="hint">{model.hint}</p>
      {/if}
    </section>
  </aside>
{/if}

{#if log.length}
  <div id="log" aria-live="polite">
    {#each log as line (line.id)}
      <div class={line.tone}><time>{line.time}</time> {line.text}</div>
    {/each}
  </div>
{/if}

{#if menu && model?.selected}
  {@const chosen = model.selected}
  {@const plain = chosen.actions.filter((action) => !DESTRUCTIVE.has(action.kind))}
  {@const harsh = chosen.actions.filter((action) => DESTRUCTIVE.has(action.kind))}
  <div
    id="context"
    class="theme-{chosen.theme ?? 'none'}"
    role="menu"
    tabindex="-1"
    aria-label={m.ctx_menu({ name: chosen.name })}
    bind:this={menuBox}
    onkeydown={menuKey}
    oncontextmenu={(ev) => ev.preventDefault()}
  >
    <div class="head">
      <span class="station {chosen.owner?.side ?? ''}">
        <UnitIcon {atlas} type={chosen.type} name={chosen.name} size={MENU_ICON} />
      </span>
      <div>
        <b>{chosen.name}</b>
        {#if chosen.owner}
          <span class="owner {chosen.owner.side}">{chosen.owner.name}</span>
        {/if}
      </div>
      {#if chosen.hp}
        <span class="hp-figure">{chosen.hp.value}<small>/{chosen.hp.max}</small></span>
      {/if}
    </div>
    {#each plain as action, i (i)}
      <button role="menuitem" onclick={() => choose(action)}>
        <span>{action.label}</span>
        {#if 'cost' in action}<span class="cost">{action.cost}</span>{/if}
      </button>
    {/each}
    <button role="menuitem" aria-expanded={about} onclick={() => (about = !about)}>
      <span>{m.ctx_about()}</span>
    </button>
    {#if about}
      <div class="about">
        {#each chosen.facts as fact, i (i)}
          <p class:muted={fact.muted}>{fact.text}</p>
        {/each}
      </div>
    {/if}
    {#if harsh.length}
      <div class="harsh">
        {#each harsh as action, i (i)}
          <button role="menuitem" class="danger" onclick={() => choose(action)}>
            <span>{action.label}</span>
            {#if 'key' in action}<kbd>{action.key}</kbd>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if page}
  <div id="overlay">
    <div class="menu-card">
      {#if page.title}<h2>{page.title}</h2>{/if}
      <pre>{page.text}</pre>
      {#each page.buttons as label, i (i)}
        <button class:primary={i === 0} onclick={() => actions.page(i)}>{label}</button>
      {/each}
    </div>
  </div>
{/if}
