import { type Theme } from '@netstorm/sim';
import { type Mission } from './game-data.js';

export type PlayableTheme = Exclude<Theme, 'sun'>;

export interface MatchOptions {
  theme: PlayableTheme;
  enemyTheme: PlayableTheme;
  /** Mission whose geysers and texts the match uses. */
  mission: string;
  storm: number;
  seed: number;
}

const THEMES: Record<PlayableTheme, string> = {
  wind: 'Вітер (Wind)',
  rain: 'Дощ (Rain)',
  thunder: 'Грім (Thunder)',
};
const STORAGE_KEY = 'netstorm.menu';
const DEFAULT_SEED = 42;
const DEFAULT_STORM = 2000;
const MAX_STORM = 100_000;
const MAX_SEED = 0x7fffffff;

export const DEFAULT_OPTIONS: MatchOptions = {
  theme: 'wind',
  enemyTheme: 'rain',
  mission: 'thewarbegins',
  storm: DEFAULT_STORM,
  seed: DEFAULT_SEED,
};

/** Show the skirmish setup and resolve with the chosen options when the player starts. */
export function showMenu(root: HTMLElement, missions: Mission[]): Promise<MatchOptions> {
  const saved = loadOptions(missions);
  root.hidden = false;
  root.innerHTML = `
    <div class="menu-card">
      <h1>NetStorm Web</h1>
      <p class="muted">Фан-ремейк NetStorm: Islands At War. Сутичка проти пасивного суперника.</p>
      <div class="menu-grid">
        <form class="menu-form">
          <label>Ваша стихія <select name="theme">${themeOptions()}</select></label>
          <label>Стихія суперника <select name="enemyTheme">${themeOptions()}</select></label>
          <label>Карта гейзерів <select name="mission">${
    missions.map((m) => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('')
  }</select></label>
          <label>Storm Power на старті
            <input name="storm" type="number" min="0" max="${MAX_STORM}" step="100"></label>
          <label>Зерно випадковості <input name="seed" type="number" min="0" max="${MAX_SEED}"></label>
          <button type="submit" class="primary">Почати</button>
        </form>
        <article class="briefing"><h2></h2><pre></pre><p class="muted note">
          Острови поки прямокутні: з карти беруться лише гейзери, а з місії — текст брифінгу.
        </p></article>
      </div>
    </div>`;
  const form = root.querySelector('form')!;
  const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
    form.elements.namedItem(name) as T;
  field<HTMLSelectElement>('theme').value = saved.theme;
  field<HTMLSelectElement>('enemyTheme').value = saved.enemyTheme;
  field<HTMLSelectElement>('mission').value = saved.mission;
  field<HTMLInputElement>('storm').value = String(saved.storm);
  field<HTMLInputElement>('seed').value = String(saved.seed);

  const showBriefing = () => {
    const mission = missions.find((m) => m.id === field<HTMLSelectElement>('mission').value);
    root.querySelector('.briefing h2')!.textContent = mission?.title ?? '';
    root.querySelector('.briefing pre')!.textContent = mission?.briefing ?? '';
  };

  form.addEventListener('change', (event) => {
    showBriefing();

    if (event.target === field('mission')) {
      const mission = missions.find((m) => m.id === field<HTMLSelectElement>('mission').value);

      if (mission?.storm) {
        field<HTMLInputElement>('storm').value = String(mission.storm);
      }
    }
  });
  showBriefing();

  return new Promise((resolve) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const options: MatchOptions = {
        theme: field<HTMLSelectElement>('theme').value as PlayableTheme,
        enemyTheme: field<HTMLSelectElement>('enemyTheme').value as PlayableTheme,
        mission: field<HTMLSelectElement>('mission').value,
        storm: clamp(Number(field<HTMLInputElement>('storm').value), MAX_STORM, DEFAULT_STORM),
        seed: clamp(Number(field<HTMLInputElement>('seed').value), MAX_SEED, DEFAULT_SEED),
      };
      saveOptions(options);
      root.hidden = true;
      root.replaceChildren();
      resolve(options);
    }, { once: true });
  });
}

function themeOptions(): string {
  return Object.entries(THEMES).map(([id, label]) => `<option value="${id}">${label}</option>`)
    .join('');
}

function clamp(value: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : fallback;
}

function isTheme(value: unknown): value is PlayableTheme {
  return typeof value === 'string' && value in THEMES;
}

/** The last options, remembered per browser; storage may be unavailable. */
function loadOptions(missions: Mission[]): MatchOptions {
  const options = { ...DEFAULT_OPTIONS };

  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

    if (saved && typeof saved === 'object') {
      const value = saved as Partial<Record<keyof MatchOptions, unknown>>;
      options.theme = isTheme(value.theme) ? value.theme : options.theme;
      options.enemyTheme = isTheme(value.enemyTheme) ? value.enemyTheme : options.enemyTheme;
      options.mission = missions.some((m) => m.id === value.mission)
        ? value.mission as string
        : options.mission;
      options.storm = clamp(Number(value.storm), MAX_STORM, options.storm);
      options.seed = clamp(Number(value.seed), MAX_SEED, options.seed);
    }
  } catch {
    // Private windows and blocked storage fall back to the defaults.
  }

  if (!missions.some((m) => m.id === options.mission) && missions[0]) {
    options.mission = missions[0].id;
  }

  return options;
}

function saveOptions(options: MatchOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Not remembering the choice is harmless.
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
