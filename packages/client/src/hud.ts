import {
  PIECES,
  pieceEnds,
  OUTPOST,
  PIECE_HARD,
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
import { escapeHtml } from './menu.js';
import { hasFacing, placeable, type Tool, type UiState } from './ui-state.js';

const PIECE_GRID = 4; // a piece fits in 4×4 cells
const SECONDS_PER_MINUTE = 60;
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
) {
  root.innerHTML = `
    <header id="topbar"></header>
    <aside id="panel">
      <h3 title="Сегмент приєднується лише кінцями, позначеними жовтим">Мости <span class="muted">1–${world.bridgeSlots}, R — поворот</span></h3>
      <div id="hand"></div>
      <h3>Виробництво <span class="muted">F — напрям юніта</span></h3>
      <div id="units"></div>
      <div id="tools"></div>
      <div id="info"></div>
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
      `<span title="Storm Power">⚡ <b data-testid="storm">${player.storm}</b></span>`
        + `<span title="Енергія від Храму й генераторів: своєї стихії / усього">енергія ${energy.own}/${energy.total}</span>`
        + `<span>${clock}</span>`
        + `<button data-action="pause" class="${ui.paused ? 'on' : ''}">${
          ui.paused ? 'Продовжити' : 'Пауза'
        } <kbd>Space</kbd></button>`
        + `<button data-action="exit">Меню</button>`);

    const handTool = ui.tool.kind === 'piece' ? ui.tool.hand : -1;
    set(panels.hand, player.hand.length
      ? player.hand.map((h, index) => {
        const rot = index === handTool ? ui.rot : 0;
        const cells = rotatePiece(PIECES[h.piece]!, rot);
        const cracked = h.age < PIECE_HARDEN;
        const hard = h.age >= PIECE_HARD;
        return `<button data-action="hand" data-value="${index}" class="piece${
          index === handTool ? ' on' : ''
        }${cracked ? ' cracked' : ''}${hard ? ' hard' : ''}" title="${pieceTitle(cracked, hard)} (${
          index + 1
        })">${pieceGrid(cells, pieceEnds(h.piece, rot))}</button>`;
      }).join('')
      : '<span class="muted">Храм ще не видав сегментів</span>');

    set(panels.units, unitButtons(world, me, ui));
    set(panels.tools, tool('select', 'Вибір', 'Esc', ui) + tool('salvage', 'Розібрати', '', ui));
    set(panels.info, info(world, me, ui));
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

function pieceTitle(cracked: boolean, hard: boolean): string {
  if (cracked) {
    return 'Свіжий сегмент: покладений зараз, стане тріснутим мостом';
  }

  return hard ? 'Твердий сегмент: вибухи поруч його не тріскають' : 'Звичайний сегмент';
}

const END_CLASSES = ['n', 'e', 's', 'w']; // by direction, as in DIRS

/** A piece in its 4×4 box; the edges it attaches by are marked. */
function pieceGrid(cells: [number, number][], ends: [number, number, number][]): string {
  const classes = new Map(cells.map(([x, y]) => [y * PIECE_GRID + x, 'f']));

  for (const [x, y, dir] of ends) {
    const cell = y * PIECE_GRID + x;
    classes.set(cell, `${classes.get(cell)} ${END_CLASSES[dir]}`);
  }

  return `<span class="grid">${
    Array.from({ length: PIECE_GRID * PIECE_GRID }, (_, i) =>
      `<i${classes.has(i) ? ` class="${classes.get(i)}"` : ''}></i>`)
      .join('')
  }</span>`;
}

function tool(kind: 'select' | 'salvage', label: string, key: string, ui: UiState): string {
  return `<button data-action="${kind}" class="${ui.tool.kind === kind ? 'on' : ''}">${label}${
    key ? ` <kbd>${key}</kbd>` : ''
  }</button>`;
}

function unitButtons(world: WorldView, me: number, ui: UiState): string {
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

    return `<button data-action="build" data-value="${def.id}" class="unit${active ? ' on' : ''}${
      poor ? ' poor' : ''
    }" aria-label="${escapeHtml(def.name)}" title="${
      escapeHtml(def.name)
    }: ${def.cls}, рівень ${def.level}, ${def.footX}×${def.footY}${warning}"><span>${
      escapeHtml(def.name)
    }${facing}</span><small>${
      cooling ? `${Math.ceil(cooling.ticks / TPS)} с` : def.cost
    }</small></button>`;
  }).join('');
}

function info(world: WorldView, me: number, ui: UiState): string {
  const entity = ui.selected === null ? undefined : world.entities.get(ui.selected);

  if (!entity) {
    return `<p class="muted">${hint(world, ui)}</p>`;
  }

  const lines = [`<b>${escapeHtml(entityName(world, entity))}</b>`];
  const ownerId = 'owner' in entity ? entity.owner : null;
  const owner = ownerId === null ? undefined : world.players.get(ownerId);

  if (owner) {
    lines.push(
      `<span class="${ownerId === me ? 'own' : 'enemy'}">${escapeHtml(owner.name)}</span>`,
    );
  }

  if ('hp' in entity) {
    lines.push(`HP ${Math.ceil(entity.hp)} / ${entity.hpMax}`);
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

  return lines.map((line) => `<div>${line}</div>`).join('');
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
        : 'ЛКМ — поставити на своєму острові або біля відкритого кінця свого мосту, поруч з енергією.';
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
