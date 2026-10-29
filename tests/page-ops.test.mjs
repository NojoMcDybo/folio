import test from "node:test";
import assert from "node:assert/strict";
import {
  describePages, deleteInfos, insertInfos, isIdentity, mapAfterDelete, mapAfterInsert, mapAfterMove,
  moveOrder, normalize, pageAfterDelete, reorderInfos, trimStack,
} from "../src/page-ops.ts";

test("normalize sorts, dedupes and clamps", () => {
  assert.deepEqual(normalize([5, 2, 2, 0, 9, 1.5], 6), [2, 5]);
});

test("moveOrder moves a block before the insertion point of the original list", () => {
  assert.deepEqual(moveOrder(6, [2], 5), [0, 2, 3, 4, 1, 5]);  // Seite 2 vor die alte Seite 6
  assert.deepEqual(moveOrder(6, [5, 6], 0), [4, 5, 0, 1, 2, 3]); // ans Ende nach vorn
  assert.deepEqual(moveOrder(4, [1], 4), [1, 2, 3, 0]);          // ganz nach hinten
  assert.deepEqual(moveOrder(4, [2, 3], 3), [0, 1, 2, 3]);       // vor sich selbst: unveraendert
  assert.ok(isIdentity(moveOrder(4, [2, 3], 3)));
  assert.deepEqual(moveOrder(5, [2, 4], 3), [0, 2, 1, 3, 4]);   // Block aus Luecke in die Mitte
});

test("moveOrder is always a permutation", () => {
  for (let count = 1; count <= 7; count++) for (let to = -1; to <= count + 1; to++) {
    const order = moveOrder(count, [1, count], to);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
  }
});

test("page maps follow the operation", () => {
  const del = mapAfterDelete([2, 5]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(del), [1, null, 2, 3, null, 4]);
  const mv = mapAfterMove(moveOrder(5, [2], 5));
  assert.deepEqual([1, 2, 3, 4, 5].map(mv), [1, 5, 2, 3, 4]);
  const ins = mapAfterInsert(2, 3);
  assert.deepEqual([1, 2, 3, 4].map(ins), [1, 2, 6, 7]);
});

test("extractPages instructions", () => {
  assert.deepEqual(deleteInfos([2, 4]), [{ document: null, excludePages: [1, 3] }]);
  assert.deepEqual(reorderInfos([1, 0]), [
    { document: null, includePages: [1], pageIndices: [0] },
    { document: null, includePages: [0], pageIndices: [1] },
  ]);
  const doc = new Uint8Array(1);
  assert.deepEqual(insertInfos([doc], 0, 3), [{ document: null }, { document: doc, insertAfter: -1 }]);
  assert.deepEqual(insertInfos([doc, doc], 3, 3)[2].insertAfter, 2);
  assert.equal(insertInfos([doc], 99, 3)[1].insertAfter, 2);
});

test("page shown after a delete", () => {
  assert.equal(pageAfterDelete([4, 5], 3), 3);
  assert.equal(pageAfterDelete([1], 5), 1);
  assert.equal(pageAfterDelete([2], 5), 2);
});

test("describePages collapses runs", () => {
  assert.equal(describePages([1, 2, 3, 7]), "1–3, 7");
  assert.equal(describePages([4]), "4");
  assert.equal(describePages([2, 3]), "2, 3");
});

test("trimStack respects budget but keeps one", () => {
  const mk = (n) => ({ bytes: new Uint8Array(n) });
  assert.equal(trimStack([mk(10), mk(10), mk(10)], 25, 99).length, 2);
  assert.equal(trimStack([mk(100)], 10, 99).length, 1);
  assert.equal(trimStack([mk(1), mk(1), mk(1)], 99, 2).length, 2);
});
