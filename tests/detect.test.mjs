import test from "node:test";
import assert from "node:assert/strict";
import { detectEntities, entityAt, phoneDigits } from "../src/detect.ts";

const kinds = (s) => detectEntities(s).map((e) => [e.type, e.text, e.href]);

test("urls: scheme, www, trailing punctuation, parentheses", () => {
  assert.deepEqual(kinds("Siehe https://example.org/a?b=1."), [["url", "https://example.org/a?b=1", "https://example.org/a?b=1"]]);
  assert.deepEqual(kinds("(www.uni-muenster.de)"), [["url", "www.uni-muenster.de", "https://www.uni-muenster.de"]]);
  assert.deepEqual(kinds("https://de.wikipedia.org/wiki/Test_(Begriff), weiter"), [["url", "https://de.wikipedia.org/wiki/Test_(Begriff)", "https://de.wikipedia.org/wiki/Test_(Begriff)"]]);
});

test("emails", () => {
  assert.deepEqual(kinds("Mail an max.muster+x@uni-muenster.de oder info@example.org!"), [
    ["email", "max.muster+x@uni-muenster.de", "mailto:max.muster+x@uni-muenster.de"],
    ["email", "info@example.org", "mailto:info@example.org"],
  ]);
});

test("phone numbers in german and international notation", () => {
  assert.deepEqual(kinds("Tel. 0251 83-22222"), [["phone", "0251 83-22222", "tel:02518322222"]]);
  assert.deepEqual(kinds("Telefon +49 (0) 251 123456"), [["phone", "+49 (0) 251 123456", "tel:+490251123456"]]);
  assert.deepEqual(kinds("0049 251 123456"), [["phone", "0049 251 123456", "tel:+49251123456"]]);
  assert.deepEqual(kinds("(0251) 123 456"), [["phone", "(0251) 123 456", "tel:0251123456"]]);
  assert.equal(phoneDigits("00 49 251"), "+49251");
});

test("things that look like numbers but are not phone numbers", () => {
  for (const s of ["am 12.03.2024 um", "Preis 1.234,56 EUR", "ISBN 978-3-16-148410-0", "Version 2.14.3", "Seite 1234567", "2024", "3,14159"]) {
    assert.deepEqual(kinds(s), [], s);
  }
});

test("a phone-like number inside a url or email is not reported twice", () => {
  assert.deepEqual(kinds("https://example.org/0251-123456/x").map((k) => k[0]), ["url"]);
  assert.deepEqual(kinds("mail 0251123456@example.org").map((k) => k[0]), ["email"]);
});

test("entityAt finds the entity under a character index", () => {
  const s = "Ruf 0251 123456 an";
  assert.equal(entityAt(s, 8)?.type, "phone");
  assert.equal(entityAt(s, 0), null);
});
