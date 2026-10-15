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
  const PER_CENT = 100;

  // Each is replaced whole and never changed in place: no proxies for what is only read.
  let model: HudModel | null = $state.raw(null);
  let log: LogLine[] = $state.raw([]);
  let page: Page | null = $state.raw(null);

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

  function act(action: SelectedAction): void {
    switch (action.kind) {
      case 'cast':
        return actions.castSelected();
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
      <Glyph name="storm" /><b data-testid="storm">{model.storm}</b>
    </span>
    <span
      class="stat energy"
      title={m.hud_energy()}
    >
      <Glyph name="energy" /><b>{model.energy.own}</b><small>/ {model.energy.total}</small>
    </span>
    <span class="stat clock" title={m.hud_clock()}><Glyph name="clock" />{model.clock}</span>
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
            aria-label={card.name}
            title={card.title}
            onclick={() => actions.setTool({ kind: 'build', type: card.id })}
          >
            <UnitIcon {atlas} type={card.id} name={card.name} size={CARD_ICON} />
            <span class="name">{card.name}{card.facing ? ` · ${card.facing}` : ''}</span>
            <span class="cost">{card.cost}</span>
            {#if card.cooling}
              <span class="cooling" style:--left="{Math.round(card.cooling.left * PER_CENT)}%">
                {card.cooling.seconds}
              </span>
            {/if}
          </button>
        {:else}
          <span class="muted">{m.hud_no_units()}</span>
        {/each}
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
          onclick={() => actions.setTool({ kind: 'salvage' })}
        >
          {m.hud_salvage()}
        </button>
      </div>
    </section>

    <section class="card" id="info">
      {#if model.selected}
        {@const chosen = model.selected}
        <div class="who">
          <UnitIcon {atlas} type={chosen.type} name={chosen.name} size={PORTRAIT} />
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
