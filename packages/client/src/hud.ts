import {
  PIECES,
  PIECE_HARDEN,
  RUNES,
  TPS,
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
      <h3>Мости <span class="muted">1–6, R — поворот</span></h3>
      <div id="hand"></div>
      <h3>Виробництво <span class="muted">F — напрям гармати</span></h3>
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
        const cells = rotatePiece(PIECES[h.piece]!, index === handTool ? ui.rot : 0);
        const cracked = h.age < PIECE_HARDEN;
        return `<button data-action="hand" data-value="${index}" class="piece${
          index === handTool ? ' on' : ''
        }${cracked ? ' cracked' : ''}" title="${
          cracked
            ? 'Свіжий сегмент: покладений зараз, стане тріснутим мостом'
            : 'Міцний сегмент'
        } (${index + 1})">${pieceGrid(cells)}</button>`;
      }).join('')
      : '<span class="muted">Храм ще не видав сегментів</span>');

    set(panels.units, unitButtons(world, me, ui));
    set(panels.tools, tool('select', 'Вибір', 'Esc', ui) + tool('salvage', 'Розібрати', '', ui));
    set(panels.info, info(world, me, ui));
  }

  return {
    render,
    /** Show the end of the match with the mission text and the way back. */
    showEnd(title: string, text: string): void {
      const overlay = root.querySelector<HTMLElement>('#overlay')!;
      overlay.hidden = false;
      overlay.innerHTML = `<div class="menu-card"><h2>${escapeHtml(title)}</h2><pre>${
        escapeHtml(text)
      }</pre><button data-action="exit" class="primary">До меню</button></div>`;
    },
    dispose(): void {
      abort.abort();
      root.replaceChildren();
    },
  };
}

function pieceGrid(cells: [number, number][]): string {
  const filled = new Set(cells.map(([x, y]) => y * PIECE_GRID + x));
  return `<span class="grid">${
    Array.from({ length: PIECE_GRID * PIECE_GRID }, (_, i) =>
      `<i${filled.has(i) ? ' class="f"' : ''}></i>`)
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
    const poor = player.storm < def.cost;
    const facing = active && hasFacing(def) ? ` · ${FACING_NAMES[ui.facing]}` : '';
    return `<button data-action="build" data-value="${def.id}" class="unit${active ? ' on' : ''}${
      poor ? ' poor' : ''
    }" aria-label="${escapeHtml(def.name)}" title="${
      escapeHtml(def.name)
    }: ${def.cls}, рівень ${def.level}, ${def.footX}×${def.footY}${
      poor ? ' — бракує Storm Power' : ''
    }"><span>${escapeHtml(def.name)}${facing}</span><small>${def.cost}</small></button>`;
  }).join('');
}

function info(world: WorldView, me: number, ui: UiState): string {
  const entity = ui.selected === null ? undefined : world.entities.get(ui.selected);

  if (!entity) {
    return `<p class="muted">${hint(ui)}</p>`;
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

  if (entity.kind === 'transport') {
    lines.push(
      `${GOALS[entity.goal] ?? entity.goal}${entity.carrying === null ? '' : ', з вантажем'}`,
    );

    if (entity.owner === me) {
      lines.push(
        '<span class="muted">Клацніть гейзер, кристал або знерухомленого ворожого жерця</span>',
      );
    }
  } else if (entity.kind === 'priest') {
    lines.push(PRIEST_STATES[entity.state] ?? entity.state);

    if (entity.state === 'chained') {
      lines.push(`руни: ${entity.runes} з ${RUNES}`);
    }

    if (entity.owner === me && entity.state === 'normal') {
      lines.push('<span class="muted">Клацніть землю, щоб жрець пішов туди</span>');
    }
  } else if (entity.kind === 'geyser') {
    lines.push(entity.stock > 0 ? `запас ${entity.stock} Storm Power` : 'вичерпаний');
  }

  if ((entity.kind === 'building' || entity.kind === 'transport') && entity.owner === me) {
    lines.push('<button data-action="salvage-selected">Розібрати <kbd>Del</kbd></button>');
  }

  return lines.map((line) => `<div>${line}</div>`).join('');
}

function hint(ui: UiState): string {
  switch (ui.tool.kind) {
    case 'piece':
      return 'ЛКМ — покласти сегмент поруч зі своєю землею. Права кнопка — скасувати.';
    case 'build':
      return 'ЛКМ — поставити на своєму острові або впритул до свого мосту, поруч з енергією.';
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
      return world.defs.get(entity.type)?.name ?? entity.type;
    case 'priest':
      return 'High Priest';
    case 'geyser':
      return 'Storm Geyser';
    case 'crystal':
      return `Кристал (${entity.value})`;
  }
}
