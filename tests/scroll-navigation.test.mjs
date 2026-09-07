import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAtPosition, speedAtPosition } from '../src/scroll-navigation.ts';

test('page targets include both ends, every page and out-of-range pointers', () => {
  for (const pages of [1, 3, 60, 1000]) {
    assert.equal(pageAtPosition(-1, pages), 1);
    assert.equal(pageAtPosition(2, pages), pages);
    for (let page = 1; page <= pages; page++) {
      assert.equal(pageAtPosition((page - 0.5) / pages, pages), page);
    }
  }
});

test('speed has a broad stop zone, symmetric directions and gradual acceleration', () => {
  for (const t of [.42, .45, .5, .55, .58]) assert.equal(speedAtPosition(t), 0);
  assert.equal(speedAtPosition(0), -1600);
  assert.equal(speedAtPosition(1), 1600);
  assert.ok(speedAtPosition(.6) < 30);
  let previous = 0;
  for (let i = 59; i <= 100; i++) {
    const speed = speedAtPosition(i / 100);
    assert.ok(speed >= previous);
    assert.ok(Math.abs(speed + speedAtPosition(1 - i / 100)) < 0.0001);
    previous = speed;
  }
});
