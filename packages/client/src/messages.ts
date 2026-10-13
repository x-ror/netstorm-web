import { RUNES, type Event as SimEvent, type WorldView } from '@netstorm/sim';

/** Ukrainian text for a command the simulation refused. */
export const REJECTIONS: Record<string, string> = {
  'no player': 'гравця немає',
  'game over': 'гру закінчено',
  'bad coordinates': 'поза картою',
  'bad facing': 'неправильний напрям',
  'bad piece': 'такого сегмента немає',
  'no piece': 'немає сегмента мосту',
  blocked: 'місце зайняте або не ваше',
  'not connected': 'не з’єднано з вашою землею (сегмент приєднується лише кінцями)',
  'unknown unit': 'невідомий юніт',
  'unknown tech': 'ви ще не знаєте цього юніта',
  'no storm power': 'бракує Storm Power',
  'no energy': 'бракує енергії поруч',
  'bad target': 'невідповідна ціль',
  'no temple': 'немає Храму',
  'no altar': 'немає Вівтаря',
  'no workshop': 'немає Майстерні цієї стихії',
  'cannot build': 'цей юніт ще не можна будувати',
  'not ready': 'юніт щойно встановлено, зачекайте',
  'no path': 'туди не дійти',
  'priest unavailable': 'жрець недоступний або не може туди дійти',
  'target not incapacitated': 'жрець ще не знерухомлений',
};

const COMMANDS: Record<string, string> = {
  dropPiece: 'Міст',
  build: 'Будівництво',
  collect: 'Збір',
  pickupCrystal: 'Кристал',
  movePriest: 'Жрець',
  capturePriest: 'Захоплення',
  salvage: 'Розбирання',
};

export type Tone = 'good' | 'bad' | 'info';

/**
 * A log line for an event the local player should hear about, or null for noise such as the
 * enemy's routine actions. Unit names come from the definitions, so they stay in English as in
 * the original.
 */
export function describeEvent(
  world: WorldView,
  me: number,
  event: SimEvent,
): { text: string; tone: Tone; } | null {
  const mine = event.who === me;
  const name = (type: string) => world.defs.get(type)?.name ?? type;
  const player = (id: number) => world.players.get(id)?.name ?? `гравець ${id}`;

  switch (event.what) {
    case 'rejected':
      return mine
        ? {
          text: `${COMMANDS[event.data.cmd] ?? event.data.cmd}: ${
            REJECTIONS[event.data.err] ?? event.data.err
          }`,
          tone: 'bad',
        }
        : null;
    case 'bridge':
      return null;
    case 'build':
      return mine ? { text: `Збудовано: ${name(event.data.type)}`, tone: 'info' } : null;
    case 'destroyed':
      return {
        text: mine
          ? `Втрачено: ${name(event.data.type)}`
          : `Знищено ворожий ${name(event.data.type)}`,
        tone: mine ? 'bad' : 'good',
      };
    case 'reward':
      return mine ? { text: `+${event.data.amount} Storm Power за знищення`, tone: 'good' } : null;
    case 'salvaged':
      return mine
        ? { text: `Розібрано ${name(event.data.type)}: +${event.data.refund}`, tone: 'info' }
        : null;
    case 'delivered':
      return mine ? { text: 'Кристал доставлено до Храму', tone: 'good' } : null;
    case 'captured':
      return {
        text: mine ? 'Ворожого жерця захоплено' : 'Вашого жерця захоплено!',
        tone: mine ? 'good' : 'bad',
      };
    case 'chained':
      return {
        text: mine ? 'Полоненого прикуто до Вівтаря' : 'Вашого жерця прикуто до ворожого Вівтаря!',
        tone: mine ? 'good' : 'bad',
      };
    case 'rune':
      return {
        text: `Руна ${event.data.runes} з ${RUNES}${mine ? '' : ' — ворог жертвує вашого жерця!'}`,
        tone: mine ? 'good' : 'bad',
      };
    case 'released':
      return {
        text: mine ? 'Вашого жерця звільнено' : 'Полонений звільнився',
        tone: mine ? 'good' : 'bad',
      };
    case 'sacrifice':
      return {
        text: `${player(event.who)} приносить у жертву жерця гравця ${player(event.data.victim)}`,
        tone: mine ? 'good' : 'bad',
      };
    case 'victory':
      return { text: `Перемога: ${player(event.who)}`, tone: mine ? 'good' : 'bad' };
    case 'priest down':
      return mine ? { text: 'Ваш жрець знерухомлений!', tone: 'bad' } : null;
    case 'priest up':
      return mine ? { text: 'Ваш жрець знову на ногах', tone: 'good' } : null;
  }
}
