import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WORKERS, planWorkers } from '../lib/ocr/pool.ts';

const strong = { cores: 8, memory: 8 };

test('a short page stays on one worker', () => {
  assert.equal(planWorkers({ tiles: 1, ...strong }), 1);
  assert.equal(planWorkers({ tiles: 2, ...strong }), 1);
});

test('a long page on a small machine stays on one worker', () => {
  assert.equal(planWorkers({ tiles: 5, cores: 2, memory: 8 }), 1);
  assert.equal(planWorkers({ tiles: 5, cores: 8, memory: 2 }), 1);
});

test('a long page on a normal machine uses two workers', () => {
  assert.equal(planWorkers({ tiles: 5, ...strong }), 2);
  assert.equal(planWorkers({ tiles: 5, cores: 4, memory: undefined }), 2);
});

test('the pool never exceeds the cap', () => {
  assert.equal(planWorkers({ tiles: 5, ...strong, max: 1 }), 1);
  assert.equal(planWorkers({ tiles: 5, ...strong, max: 99 }), MAX_WORKERS);
  assert.equal(planWorkers({ tiles: 1, ...strong, max: 0 }), 1);
  // A page with only two tiles cannot fill two workers either.
  assert.equal(planWorkers({ tiles: 2, ...strong, max: 2 }), 1);
});

test('a fractional cap still yields a usable worker', () => {
  assert.equal(planWorkers({ tiles: 4, ...strong, max: 0.4 }), 1);
});
