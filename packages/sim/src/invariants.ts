import type { DeepReadonly, WorldView } from './view.js';
import { W, H, Terrain, MAX_ID, MAX_PLAYERS, type Priest, type Transport } from './state.js';

function fail(message: string): never {
  throw new Error(`World invariant: ${message}`);
}

/** Expensive boundary/debug check, never run on every simulation tick. */
export function assertWorldInvariants(world: WorldView): void {
  if (
    world.terrain.length !== W * H
    || world.owner.length !== W * H
    || world.links.length !== W * H
    || world.wear.length !== W * H
    || world.occupant.length !== W * H
  ) {
    fail('invalid grid dimensions');
  }

  for (const [id, definition] of world.defs) {
    if (id !== definition.id) {
      fail(`definition key mismatch for ${id}`);
    }
  }

  const priests = new Set<number>();

  for (const [id, entity] of world.entities) {
    if (id !== entity.id || !Number.isInteger(id) || id <= 0 || id > MAX_ID) {
      fail('invalid entity id');
    }

    if (!world.inside(entity.x, entity.y)) {
      fail(`entity ${id} outside map`);
    }

    if ('owner' in entity && entity.owner !== 0 && !world.players.has(entity.owner)) {
      fail(`entity ${id} has unknown owner`);
    }

    if ('type' in entity && !world.defs.has(entity.type)) {
      fail(`entity ${id} has unknown unit type`);
    }

    if (
      'hp' in entity
      && (!Number.isFinite(entity.hp) || entity.hp < 0 || entity.hp > entity.hpMax)
    ) {
      fail(`invalid HP for ${id}`);
    }

    if (entity.kind === 'building') {
      if (
        !Number.isInteger(entity.fx)
        || !Number.isInteger(entity.fy)
        || entity.fx < 0
        || entity.fy < 0
        || entity.x + entity.fx > W
        || entity.y + entity.fy > H
      ) {
        fail(`building ${id} outside map`);
      }
    } else if (entity.kind === 'priest') {
      if (priests.has(entity.owner)) {
        fail(`multiple priests for player ${entity.owner}`);
      }

      priests.add(entity.owner);

      const held = entity.state === 'carried' || entity.state === 'chained';

      if (entity.state === 'carried') {
        const carrier = entity.carriedBy === null
          ? undefined
          : world.entities.get(entity.carriedBy);

        if (
          !carrier
          || carrier.kind !== 'transport'
          || carrier.carrying !== id
          || carrier.owner === entity.owner
        ) {
          fail(`invalid priest carrier for ${id}`);
        }
      } else if (entity.carriedBy !== null) {
        fail(`uncarried priest ${id} has carrier`);
      }

      // The altar may have been destroyed earlier in the same tick; the priest goes free on his turn.
      if (entity.state === 'chained') {
        const altar = entity.chainedAt === null
          ? fail(`unchained priest ${id}`)
          : world.entities.get(entity.chainedAt);

        if (altar && (altar.kind !== 'building' || altar.owner === entity.owner)) {
          fail(`invalid altar for priest ${id}`);
        }
      } else if (entity.chainedAt !== null || entity.runes !== 0 || entity.runeTimer !== 0) {
        fail(`ritual state on free priest ${id}`);
      }

      if (!Number.isInteger(entity.runes) || entity.runes < 0 || entity.runeTimer < 0) {
        fail(`invalid ritual progress for priest ${id}`);
      }

      if (entity.carrying !== null) {
        const cargo = world.entities.get(entity.carrying);

        if (cargo?.kind !== 'crystal' || cargo.carriedBy !== id || entity.state !== 'normal') {
          fail(`invalid priest cargo for ${id}`);
        }
      }

      if (!validTransportTarget(world, entity)) {
        fail(`invalid priest target for ${id}`);
      }

      if (!held && world.occupant[world.at(entity.x, entity.y)] !== id) {
        fail(`priest ${id} missing from its cell`);
      }
    } else if (entity.kind === 'geyser') {
      if (world.occupant[world.at(entity.x, entity.y)] !== id) {
        fail(`geyser ${id} missing from its cell`);
      }

      if (!Number.isInteger(entity.stock) || entity.stock < 0) {
        fail(`invalid geyser stock for ${id}`);
      }
    } else if (entity.kind === 'transport') {
      if (entity.carrying !== null) {
        const cargo = world.entities.get(entity.carrying);
        const valid = (cargo?.kind === 'crystal' || cargo?.kind === 'priest')
          && cargo.carriedBy === id;

        if (!valid) {
          fail(`invalid transport cargo for ${id}`);
        }
      }

      if (!validTransportTarget(world, entity)) {
        fail(`invalid transport target for ${id}`);
      }
    } else if (entity.kind === 'crystal') {
      if (!Number.isInteger(entity.value) || entity.value <= 0) {
        fail(`invalid crystal value for ${id}`);
      }

      if (entity.carriedBy !== null) {
        const carrier = world.entities.get(entity.carriedBy);

        const carries = (carrier?.kind === 'transport' || carrier?.kind === 'priest')
          && carrier.carrying === id;

        if (!carries) {
          fail(`invalid crystal carrier for ${id}`);
        }
      }
    }
  }

  for (let cell = 0; cell < W * H; cell++) {
    const terrain = world.terrain[cell];
    const owner = world.owner[cell];

    if (terrain === undefined || terrain > Terrain.HardBridge) {
      fail(`invalid terrain at ${cell}`);
    }

    if (owner !== 0 && !world.players.has(owner!)) {
      fail(`unknown ground owner at ${cell}`);
    }

    if (terrain === Terrain.Sky && owner !== 0) {
      fail(`owned sky at ${cell}`);
    }

    const occupantId = world.occupant[cell];

    if (occupantId !== 0) {
      const occupant = world.entities.get(occupantId!) ?? fail(`missing occupant at ${cell}`);
      const x = cell % W;
      const y = Math.floor(cell / W);

      if (occupant.kind === 'building') {
        if (
          x < occupant.x
          || y < occupant.y
          || x >= occupant.x + occupant.fx
          || y >= occupant.y + occupant.fy
        ) {
          fail(`building occupancy mismatch at ${cell}`);
        }
      } else if (occupant.kind === 'geyser' || occupant.kind === 'priest') {
        if (
          x !== occupant.x
          || y !== occupant.y
          || (occupant.kind === 'priest'
            && (occupant.state === 'carried' || occupant.state === 'chained'))
        ) {
          fail(`occupancy mismatch at ${cell}`);
        }
      } else {
        fail(`non-blocking occupant at ${cell}`);
      }
    }
  }

  for (const [id, player] of world.players) {
    if (id !== player.id || !Number.isInteger(id) || id < 1 || id > MAX_PLAYERS) {
      fail('invalid player id');
    }
  }

  if (world.winner !== null && !world.players.get(world.winner)?.alive) {
    fail('invalid winner');
  }
}

function validTransportTarget(world: WorldView, t: DeepReadonly<Transport | Priest>): boolean {
  const kind = t.target === null ? undefined : world.entities.get(t.target)?.kind;

  switch (t.goal) {
    case 'idle':
      return t.target === null;
    case 'collect':
      return kind === 'geyser';
    case 'home':
      return t.target === null || kind === 'geyser';
    // These targets may already be gone: a crystal delivered by someone else, a destroyed altar.
    case 'pickup':
    case 'capture':
    case 'altar':
    case 'build':
      return t.target !== null;
  }
}
