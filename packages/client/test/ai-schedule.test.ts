import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiSchedule } from '../src/ai-schedule.js';

test('moves are owed a lead later, in the order of the sides, and a tick waits for them', () => {
  const schedule = new AiSchedule(30);
  assert.equal(schedule.request(5, 2), 35);
  assert.equal(schedule.request(5, 1), 35);
  assert.deepEqual(schedule.take(5), []);
  assert.equal(schedule.take(35), null);
  schedule.deliver(35, 2, [{ t: 'movePriest', player: 2, x: 1, y: 1 }]);
  assert.equal(schedule.take(35), null);
  schedule.deliver(35, 1, []);
  assert.deepEqual(schedule.take(35), [{ t: 'movePriest', player: 2, x: 1, y: 1 }]);
  assert.deepEqual(schedule.take(35), []);
});
