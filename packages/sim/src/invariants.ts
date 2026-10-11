import type { WorldView } from './view.js';
import { W, H, Terrain, MAX_ID, MAX_PLAYERS } from './state.js';

function fail(message: string): never {
  throw new Error(`World invariant: ${message}`);
}

/** Expensive boundary/debug check, never run on every simulation tick. */
export function assertWorldInvariants(world: WorldView): void {
  if (
    world.terrain.length !== W * H
    || world.owner.length !== W * H
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

      if (entity.state === 'carried') {
        const carrier = entity.carriedBy === null
          ? undefined
          : world.entities.get(entity.carriedBy);

        if (
          !carrier
          || carrier.kind !== 'priest'
          || carrier.carrying !== id
          || carrier.state === 'carried'
          || carrier.owner === entity.owner
        ) {
          fail(`invalid priest carrier for ${id}`);
        }

        if (entity.carrying !== null) {
          fail(`carried priest ${id} carries another priest`);
        }
      } else if (entity.carriedBy !== null) {
        fail(`uncarried priest ${id} has carrier`);
      } else if (world.occupant[world.at(entity.x, entity.y)] !== id) {
        fail(`priest ${id} missing from its cell`);
      }

      if (entity.carrying !== null) {
        const victim = world.entities.get(entity.carrying);

        if (
          !victim
          || victim.kind !== 'priest'
          || victim.state !== 'carried'
          || victim.carriedBy !== id
        ) {
          fail(`invalid priest cargo for ${id}`);
        }
      }
    } else if (entity.kind === 'geyser') {
      if (world.occupant[world.at(entity.x, entity.y)] !== id) {
        fail(`geyser ${id} missing from its cell`);
      }

      if (entity.crystal !== null) {
        const crystal = world.entities.get(entity.crystal);

        if (
          !crystal
          || crystal.kind !== 'crystal'
          || crystal.geyser !== id
          || crystal.carriedBy !== null
        ) {
          fail(`invalid geyser crystal for ${id}`);
        }
      }
    } else if (entity.kind === 'transport') {
      if (entity.carrying !== null) {
        const crystal = world.entities.get(entity.carrying);

        if (!crystal || crystal.kind !== 'crystal' || crystal.carriedBy !== id) {
          fail(`invalid transport cargo for ${id}`);
        }
      }

      if ((entity.goal === 'collect') !== (entity.target !== null)) {
        fail(`invalid transport target for ${id}`);
      }

      if (entity.target !== null && world.entities.get(entity.target)?.kind !== 'geyser') {
        fail(`invalid transport target for ${id}`);
      }
    } else if (entity.kind === 'crystal') {
      const geyser = world.entities.get(entity.geyser);

      if (!geyser || geyser.kind !== 'geyser') {
        fail(`invalid crystal origin for ${id}`);
      }

      if (entity.carriedBy !== null) {
        const carrier = world.entities.get(entity.carriedBy);

        if (!carrier || carrier.kind !== 'transport' || carrier.carrying !== id) {
          fail(`invalid crystal carrier for ${id}`);
        }
      }
    }
  }

  for (let cell = 0; cell < W * H; cell++) {
    const terrain = world.terrain[cell];
    const owner = world.owner[cell];

    if (terrain !== Terrain.Sky && terrain !== Terrain.Island && terrain !== Terrain.Bridge) {
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
          || (occupant.kind === 'priest' && occupant.state === 'carried')
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
