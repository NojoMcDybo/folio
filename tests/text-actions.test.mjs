import test from "node:test";
import assert from "node:assert/strict";
import { cleanSelection, lookupWord, textMenuItems } from "../src/text-actions.ts";
import { detectEntities } from "../src/detect.ts";

const labels = (items) => items.filter((i) => !i.separator).map((i) => i.label);

test("lookupWord accepts a single word only", () => {
  assert.equal(lookupWord("Hochschule,"), "Hochschule");
  assert.equal(lookupWord("zwei Wörter"), null);
  assert.equal(lookupWord("12345"), null);
  assert.equal(lookupWord("«Übung»"), "Übung");
});

test("menu for a plain word", () => {
  const items = textMenuItems("Übung", null, { open() {}, copy() {} });
  assert.deepEqual(labels(items), ["Kopieren", "Nachschlagen „Übung“", "Übersetzen …", "Im Web suchen …"]);
});

test("menu for a phrase has no lookup, entities come first", () => {
  assert.deepEqual(labels(textMenuItems("ein ganzer Satz", null, { open() {}, copy() {} })), ["Kopieren", "Übersetzen …", "Im Web suchen …"]);
  const [phone] = detectEntities("Tel. 0251 123456");
  const items = textMenuItems("0251 123456", phone, { open() {}, copy() {} });
  assert.deepEqual(labels(items).slice(0, 2), ["Anrufen: 0251 123456", "Nummer kopieren"]);
});

test("actions open encoded urls and copy cleaned text", () => {
  const opened = [], copied = [];
  const items = textMenuItems(" Straße\n und mehr ", null, { open: (u) => opened.push(u), copy: (t) => copied.push(t) });
  items.find((i) => i.label === "Im Web suchen …").action();
  items.find((i) => i.label === "Kopieren").action();
  assert.equal(opened[0], "https://duckduckgo.com/?q=Stra%C3%9Fe%20und%20mehr");
  assert.equal(copied[0], "Straße und mehr");
  assert.equal(cleanSelection("a\n\n b"), "a b");
});

test("email entity", () => {
  const [mail] = detectEntities("an x@y.de senden");
  const opened = [];
  textMenuItems("x@y.de", mail, { open: (u) => opened.push(u), copy() {} })[0].action();
  assert.deepEqual(opened, ["mailto:x@y.de"]);
});
