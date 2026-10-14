import {
  PIECES,
  rotateLinks,
  OUTPOST,
  PIECE_HARDEN,
  RUNES,
  TPS,
  blastDamage,
  shotInterval,
  rotatePiece,
  type DeepReadonly,
  type Entity,
  type UnitDef,
  type WorldView,
} from '@netstorm/sim';
import type { Atlas } from './assets.js';
import { TH, TW } from './projection.js';
import { bridgeSlot } from './texture-selection.js';
import { escapeHtml } from './menu.js';
import { hasFacing, placeable, type Tool, type UiState } from './ui-state.js';
import { unitIcon } from './icons.js';

const PLANK_DROP = 9; // from the top of a cell down to the hot spot of its Bridge frame
const PLANK_FACE = 7; // pixels of a frame's front face under its cell
const SECONDS_PER_MINUTE = 60;
const CARD_ICON = 40; // pixels of a unit's picture on its production card
const PORTRAIT = 48; // pixels of the selected unit's picture
const PER_CENT = 100;
/** Line icons of the top bar, drawn in the colour of their text. */
const GLYPHS = {
  storm:
    '<svg viewBox="0 0 16 16"><path d="M8 1 13 6 8 15 3 6Z" fill="currentColor" opacity=".35"/><path d="M8 1 13 6 8 15 3 6Z M3 6h10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  energy: '<svg viewBox="0 0 16 16"><path d="M9 1 3 9h4l-1 6 6-8H8Z" fill="currentColor"/></svg>',
  clock:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  pause:
    '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3v10l8-5Z" fill="currentColor"/></svg>',
  sound:
    '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2Z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  muted:
    '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2Z" fill="currentColor"/><path d="m11 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  menu:
    '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
} as const;
const FACING_NAMES = ['північ', 'схід', 'південь', 'захід'];
const GOALS: Record<string, string> = {
  idle: 'чекає',
  collect: 'іде до гейзера',
  pickup: 'іде по кристал',
  home: 'несе кристал до Храму',
  capture: 'іде по полоненого',
  altar: 'несе полоненого до Вівтаря',
  obelisk: 'іде до обеліска',
};
const PRIEST_STATES: Record<string, string> = {
  normal: 'на ногах',
  down: 'знерухомлений',
  carried: 'у полоні, його несуть',
  chained: 'прикутий до Вівтаря',
};

export interface HudActions {
  setTool(tool: Tool): void;
  togglePause(): void;
  toggleSound(): void;
  salvageSelected(): void;
  meltdownSelected(): void;
  castSelected(): void;
  /** A button of the page shown over the map was pressed: its place among the page's buttons. */
  page(button: number): void;
  dropSelected(): void;
  exit(): void;
}

/** DOM panels around the map. Each panel is rewritten only when its markup changes, so buttons
 * keep hover and focus between refreshes. */
export function createHud(
  root: HTMLElement,
  world: WorldView,
  me: number,
  ui: UiState,
  actions: HudActions,
  atlas: Atlas,
) {
  root.innerHTML = `
    <header id="topbar"></header>
    <aside id="panel">
      <section class="card">
        <h3 title="Сегмент приєднується лише відкритими кінцями — там, де немає стінки">Мости <span class="keys"><kbd>1</kbd>–<kbd>${world.bridgeSlots}</kbd> <kbd>R</kbd> поворот</span></h3>
        <div id="hand"></div>
      </section>
      <section class="card">
        <h3>Виробництво <span class="keys"><kbd>R</kbd> напрям</span></h3>
        <div id="units"></div>
        <div id="tools"></div>
      </section>
      <section class="card" id="info"></section>
    </aside>
    <div id="log" aria-live="polite"></div>
    <div id="overlay" hidden></div>`;
  const panels = {
    topbar: root.querySelector<HTMLElement>('#topbar')!,
    hand: root.querySelector<HTMLElement>('#hand')!,
    units: root.querySelector<HTMLElement>('#units')!,
    tools: root.querySelector<HTMLElement>('#tools')!,
    info: root.querySelector<HTMLElement>('#info')!,
  };
  const markup = new Map<HTMLElement, string>();
  const abort = new AbortController();

  function set(element: HTMLElement, html: string): void {
    if (markup.get(element) !== html) {
      markup.set(element, html);
      element.innerHTML = html;
    }
  }

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-action]')
      : null;

    if (!button || button.disabled) {
      return;
    }

    const { action, value } = button.dataset;

    if (action === 'hand') {
      actions.setTool({ kind: 'piece', hand: Number(value) });
    } else if (action === 'build' && value) {
      actions.setTool({ kind: 'build', type: value });
    } else if (action === 'select') {
      actions.setTool({ kind: 'select' });
    } else if (action === 'salvage') {
      actions.setTool({ kind: 'salvage' });
    } else if (action === 'salvage-selected') {
      actions.salvageSelected();
    } else if (action === 'meltdown-selected') {
      actions.meltdownSelected();
    } else if (action === 'cast-selected') {
      actions.castSelected();
    } else if (action === 'drop-selected') {
      actions.dropSelected();
    } else if (action === 'page') {
      actions.page(Number(value));
    } else if (action === 'mute') {
      actions.toggleSound();
    } else if (action === 'pause') {
      actions.togglePause();
    } else if (action === 'exit') {
      actions.exit();
    }
  }, { signal: abort.signal });

  function render(): void {
    const player = world.players.get(me)!;
    const energy = world.energy(me);
    const seconds = Math.floor(world.tick / TPS);
    const clock = `${Math.floor(seconds / SECONDS_PER_MINUTE)}:${
      String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')
    }`;
    set(panels.topbar,
      `<span class="stat storm" title="Storm Power">${GLYPHS.storm}<b data-testid="storm">${player.storm}</b></span>`
        + `<span class="stat energy" title="Енергія від Храму й генераторів: своєї стихії / усього">${GLYPHS.energy}<b>${energy.own}</b><small>/ ${energy.total}</small></span>`
        + `<span class="stat clock" title="Час бою">${GLYPHS.clock}${clock}</span>`
        + '<span class="sep"></span>'
        + `<button data-action="pause" class="icon-button${ui.paused ? ' on' : ''}" aria-label="${
          ui.paused ? 'Продовжити' : 'Пауза'
        }" title="${ui.paused ? 'Продовжити' : 'Пауза'} (Space)">${
          ui.paused ? GLYPHS.play : GLYPHS.pause
        }</button>`
        + `<button data-action="mute" class="icon-button" aria-label="Звук" title="${
          ui.muted ? 'Увімкнути звук' : 'Вимкнути звук'
        }">${ui.muted ? GLYPHS.muted : GLYPHS.sound}</button>`
        + `<button data-action="exit" class="icon-button" aria-label="Меню" title="Меню">${GLYPHS.menu}</button>`);

    const handTool = ui.tool.kind === 'piece' ? ui.tool.hand : -1;
    // Every slot of the window is shown; an empty one waits for the Temple's next piece.
    const slots = Array.from({ length: world.bridgeSlots }, (_, index) => {
      const h = player.hand[index];

      if (!h) {
        return `<span class="piece empty"><kbd>${index + 1}</kbd></span>`;
      }

      const rot = index === handTool ? ui.rot : 0;
      const cells = rotatePiece(PIECES[h.piece]!, rot);
      const cracked = h.age < PIECE_HARDEN;
      return `<button data-action="hand" data-value="${index}" class="piece${
        index === handTool ? ' on' : ''
      }${cracked ? ' cracked' : ''}" title="${pieceTitle(cracked)} (${index + 1})"><kbd>${
        index + 1
      }</kbd>${
        pieceArt(atlas, cells, rotateLinks(h.piece, rot), cracked ? 'cracked' : 'whole')
      }</button>`;
    });
    set(panels.hand, slots.join('') + (world.templeOf(me)
      ? ''
      : '<p class="muted note">Без Храму сегментів немає</p>'));

    set(panels.units, unitButtons(world, me, ui, atlas));
    set(panels.tools, tool('select', 'Вибір', 'Esc', ui) + tool('salvage', 'Розібрати', '', ui));
    set(panels.info, info(world, me, ui, atlas));
  }

  return {
    render,
    /** Show a page of the mission's script over the map, with its buttons; `actions.page` is
     * told which one is pressed. */
    showPage(title: string, text: string, buttons: readonly string[]): void {
      const overlay = root.querySelector<HTMLElement>('#overlay')!;
      overlay.hidden = false;
      overlay.innerHTML = `<div class="menu-card">${
        title ? `<h2>${escapeHtml(title)}</h2>` : ''
      }<pre>${escapeHtml(text)}</pre>${
        buttons.map((label, i) =>
          `<button data-action="page" data-value="${i}"${i === 0 ? ' class="primary"' : ''}>${
            escapeHtml(label)
          }</button>`
        ).join(' ')
      }</div>`;
    },
    hidePage(): void {
      root.querySelector<HTMLElement>('#overlay')!.hidden = true;
    },
    dispose(): void {
      abort.abort();
      root.replaceChildren();
    },
  };
}

function pieceTitle(cracked: boolean): string {
  return cracked ? 'Свіжий сегмент: покладений зараз, стане тріснутим мостом' : 'Звичайний сегмент';
}

/**
 * A piece drawn as the bridge it will be: for each cell the Bridge frame of the sides it joins on,
 * cut out of the atlas. The walls show which ends are open, as in the original's window.
 */
function pieceArt(
  atlas: Atlas,
  cells: [number, number][],
  links: number[],
  strength: 'whole' | 'cracked' | 'hard',
): string {
  const order = cells.map((cell, i) => [cell, links[i]!] as const)
    // A frame hangs a little over the cell under it: rows are laid top to bottom.
    .sort(([a], [b]) => a[1] - b[1] || a[0] - b[0]);
  const wide = Math.max(...cells.map(([x]) => x)) + 1;
  const tall = Math.max(...cells.map(([, y]) => y)) + 1;
  const planks = order.map(([[x, y], joins]) => {
    const frame = atlas.frames[`slot:bridge:${bridgeSlot(joins, strength, 1)}`];

    if (!frame) {
      return '';
    }

    const [sheet, ax, ay, w, h, left = 0, top = 0] = frame as [
      number,
      number,
      number,
      number,
      number,
      number?,
      number?,
    ];
    return `<i style="left:${x * TW + TW - 1 + left}px;top:${
      y * TH + PLANK_DROP + top
    }px;width:${w}px;height:${h}px;background:url(${atlas.atlases[sheet]}) -${ax}px -${ay}px"></i>`;
  }).join('');
  return `<span class="planks" style="width:${wide * TW}px;height:${
    tall * TH + PLANK_FACE
  }px">${planks}</span>`;
}

function tool(kind: 'select' | 'salvage', label: string, key: string, ui: UiState): string {
  return `<button data-action="${kind}" class="${ui.tool.kind === kind ? 'on' : ''}">${label}${
    key ? ` <kbd>${key}</kbd>` : ''
  }</button>`;
}

function unitButtons(world: WorldView, me: number, ui: UiState, atlas: Atlas): string {
  const player = world.players.get(me)!;
  const defs = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def !== undefined && placeable(def))
    .sort((a, b) => a.level - b.level || a.cost - b.cost);

  if (!defs.length) {
    return '<span class="muted">Немає відомих споруд</span>';
  }

  return defs.map((def) => {
    const active = ui.tool.kind === 'build' && ui.tool.type === def.id;
    const cooling = player.refresh.find((entry) => entry.type === def.id);
    const poor = player.storm < def.cost || cooling !== undefined;
    const facing = active && hasFacing(def) ? ` · ${FACING_NAMES[ui.facing]}` : '';
    let warning = '';

    if (cooling) {
      warning = ' — щойно встановлено, ще недоступний';
    } else if (player.storm < def.cost) {
      warning = ' — бракує Storm Power';
    }

    // How much of the Unit Rate is left, drawn as a ring that empties.
    const left = cooling ? cooling.ticks / (world.unitRate * TPS) : 0;
    return `<button data-action="build" data-value="${def.id}" class="unit theme-${def.theme}${
      active ? ' on' : ''
    }${poor ? ' poor' : ''}" aria-label="${escapeHtml(def.name)}" title="${
      escapeHtml(def.name)
    }: ${def.cls}, рівень ${def.level}, ${def.footX}×${def.footY}${warning}">${
      unitIcon(atlas, def.id, def.name, CARD_ICON)
    }<span class="name">${
      escapeHtml(def.name)
    }${facing}</span><span class="cost">${def.cost}</span>${
      cooling
        ? `<span class="cooling" style="--left:${Math.round(left * PER_CENT)}%">${
          Math.ceil(cooling.ticks / TPS)
        }</span>`
        : ''
    }</button>`;
  }).join('');
}

function info(world: WorldView, me: number, ui: UiState, atlas: Atlas): string {
  const entity = ui.selected === null ? undefined : world.entities.get(ui.selected);

  if (!entity) {
    return `<p class="hint">${hint(world, ui)}</p>`;
  }

  const name = entityName(world, entity);
  const ownerId = 'owner' in entity ? entity.owner : null;
  const owner = ownerId === null ? undefined : world.players.get(ownerId);
  const side = ownerId === me || (ownerId && !world.hostile(me, ownerId)) ? 'own' : 'enemy';
  const type = 'type' in entity ? entity.type : entity.kind;
  const head = `<div class="who">${unitIcon(atlas, type, name, PORTRAIT)}<div><b>${
    escapeHtml(name)
  }</b>${owner ? `<span class="owner ${side}">${escapeHtml(owner.name)}</span>` : ''}</div></div>`;
  const lines: string[] = [];

  if ('hp' in entity) {
    const share = entity.hpMax > 0 ? entity.hp / entity.hpMax : 0;
    lines.push(
      `<div class="hp ${healthBand(share)}" style="--hp:${Math.round(share * PER_CENT)}%"><span>${
        Math.ceil(entity.hp)
      } / ${entity.hpMax}</span></div>`,
    );
  }

  if (entity.kind === 'building') {
    lines.push(...combatLines(world.defs.get(entity.type), entity.hpMax));

    if (entity.regrow > 0) {
      lines.push(`відростає: ще ${Math.ceil(entity.regrow / TPS)} с`);
    }

    if (entity.builder !== null) {
      lines.push('чекає на жерця');
    } else if (entity.rising > 0) {
      lines.push(`будується: ще ${Math.ceil(entity.rising / TPS)} с`);
    }
  }

  if (entity.kind === 'transport') {
    lines.push(
      `${GOALS[entity.goal] ?? entity.goal}${entity.carrying === null ? '' : ', з вантажем'}`,
    );

    const spell = entity.spell === null ? undefined : world.defs.get(entity.spell);

    if (spell) {
      lines.push(
        `заклинання: ${escapeHtml(spell.name)}, радіус ${spell.range}${
          entity.casting > 0 ? ` — творить, ще ${Math.ceil(entity.casting / TPS)} с` : ''
        }`,
      );
    }

    if (entity.owner === me) {
      if (spell) {
        lines.push(
          `<button data-action="cast-selected">Застосувати ${
            escapeHtml(spell.name)
          } <small>${spell.cost}</small></button>`,
        );
      }

      lines.push(
        '<span class="muted">Клацніть гейзер, кристал, обеліск або знерухомленого ворожого жерця</span>',
      );
    }
  } else if (entity.kind === 'priest') {
    lines.push(
      `${PRIEST_STATES[entity.state] ?? entity.state}${
        entity.carrying === null ? '' : ', з кристалом'
      }`,
    );

    if (entity.state === 'chained') {
      lines.push(`руни: ${entity.runes} з ${RUNES}`);
    }

    if (entity.owner === me && entity.state === 'normal') {
      lines.push(
        '<span class="muted">Клацніть землю, щоб жрець пішов туди, або гейзер чи кристал</span>',
      );
      // "Use your High Priest to build Temples, Workshops, and Altars."
      const player = world.players.get(me);
      const theme = player?.theme;

      // The Outpost is offered to a side that has it: in the original, in multiplayer only.
      for (const id of [`${theme}vortex`, `${theme}factory`, 'altar', OUTPOST]) {
        const def = world.defs.get(id);

        if (def && (id !== OUTPOST || player?.tech.has(OUTPOST))) {
          lines.push(
            `<button data-action="build" data-value="${def.id}">Збудувати ${
              escapeHtml(def.name)
            } <small>${def.cost}</small></button>`,
          );
        }
      }
    }
  } else if (entity.kind === 'flyer') {
    lines.push(
      entity.returning ? 'летить на заправку' : `у повітрі ще ${Math.ceil(entity.life / TPS)} с`,
    );
  } else if (entity.kind === 'geyser') {
    lines.push(entity.stock > 0 ? `запас ${entity.stock} Storm Power` : 'вичерпаний');
  } else if (entity.kind === 'obelisk') {
    const spell = world.defs.get(entity.spell);
    lines.push(`${spell?.cls ?? ''}: радіус ${spell?.range}, ${spell?.cost} Storm Power за раз`);
    lines.push('<span class="muted">Виберіть транспорт і клацніть обеліск, щоб здобути</span>');
  }

  if ('hp' in entity && entity.paralyzed > 0) {
    lines.push(`паралізований: ще ${Math.ceil(entity.paralyzed / TPS)} с`);
  }

  if ('hp' in entity && entity.invisible > 0) {
    lines.push(`невидимий: ще ${Math.ceil(entity.invisible / TPS)} с`);
  }

  // "Right-click a cargo-carrying Transport, and choose 'Drop ...'."
  if (
    (entity.kind === 'transport' || entity.kind === 'priest') && entity.owner === me
    && entity.carrying !== null
  ) {
    lines.push('<button data-action="drop-selected">Скинути вантаж</button>');
  }

  if ((entity.kind === 'building' || entity.kind === 'transport') && entity.owner === me) {
    lines.push('<button data-action="salvage-selected">Розібрати <kbd>Del</kbd></button>');

    // Offered as in the original: a Generator of a Fury, with more than half of its hit points.
    const def = entity.kind === 'building' ? world.defs.get(entity.type) : undefined;

    if (
      entity.kind === 'building' && def?.group === 'battery' && def.theme !== 'sun'
      && entity.rising === 0 && entity.hp * 2 > entity.hpMax
    ) {
      lines.push('<button data-action="meltdown-selected">Meltdown!</button>');
    }
  }

  const actions = lines.filter((line) => line.startsWith('<button'));
  const facts = lines.filter((line) => !line.startsWith('<button'));
  return head + facts.map((line) => `<div class="fact">${line}</div>`).join('')
    + (actions.length ? `<div class="actions">${actions.join('')}</div>` : '');
}

const HALF = 0.5;
const QUARTER = 0.25;

/** The colour of a health bar: green, then amber below a half, red below a quarter. */
function healthBand(share: number): 'high' | 'mid' | 'low' {
  if (share > HALF) {
    return 'high';
  }

  return share > QUARTER ? 'mid' : 'low';
}

/** How a building fights, in the numbers the simulation uses. */
function combatLines(def: Readonly<UnitDef> | undefined, hpMax: number): string[] {
  if (!def) {
    return [];
  }

  const lines: string[] = [];

  if (def.dps && def.range) {
    lines.push(
      `шкода ${def.dps}/с, постріл раз на ${shotInterval(def) / TPS} с, дальність ${def.range}`,
    );
  }

  const blast = blastDamage(def, hpMax);

  if (blast) {
    lines.push(`<span class="muted">Знищений вибухає: ${blast} шкоди всім поруч</span>`);
  }

  return lines;
}

function hint(world: WorldView, ui: UiState): string {
  switch (ui.tool.kind) {
    case 'piece':
      return "ЛКМ — покласти сегмент кінцем до своєї землі або до кінця свого мосту. Боком сегменти не з'єднуються. R — поворот, права кнопка — скасувати.";
    case 'build':
      return world.defs.get(ui.tool.type)?.cls.endsWith('Transport')
        ? 'ЛКМ — поставити на вільну клітинку свого острова, поруч з енергією. Golem робить Храм, інші транспорти — Майстерня їхньої стихії.'
        : `ЛКМ — поставити на своєму острові або біля відкритого кінця свого мосту, поруч з енергією.${
          hasFacing(world.def(ui.tool.type)) ? ' R — повернути.' : ''
        }`;
    case 'salvage':
      return 'ЛКМ по своїй споруді чи транспорту — розібрати за частину вартості.';
    case 'select':
      return 'ЛКМ — вибрати. Права кнопка/перетягування — камера, колесо — масштаб, стрілки — прокрутка.';
  }
}

export function entityName(world: WorldView, entity: DeepReadonly<Entity>): string {
  switch (entity.kind) {
    case 'building':
    case 'transport':
    case 'flyer':
      return world.defs.get(entity.type)?.name ?? entity.type;
    case 'priest':
      return 'High Priest';
    case 'geyser':
      return 'Storm Geyser';
    case 'crystal':
      return `Кристал (${entity.value})`;
    case 'obelisk':
      return `Обеліск: ${world.defs.get(entity.spell)?.name ?? entity.spell}`;
  }
}
