import test from "node:test";
import assert from "node:assert/strict";
import { detectOutline, linesFromItems, parseTocLine, parseTocPage } from "../src/toc-detect.ts";

const line = (text, size = 11, x = 72, y = 700) => ({ text, size, x, y });

/** Ein Buch: Titelseite, Verzeichnis (Seite 2), Vorwort, dann Kapitel auf PDF-Seite = gedruckt + 3. */
function book({ labels = null, leaders = true, numPages = 40 } = {}) {
  const chapters = [
    ["1 Einleitung", 1, 1], ["1.1 Hintergrund", 2, 2], ["1.2 Fragestellung", 4, 2],
    ["2 Methoden", 9, 1], ["2.1 Stichprobe", 10, 2], ["3 Ergebnisse", 15, 1], ["4 Diskussion", 22, 1],
  ];
  const offset = 3;
  const pages = Array.from({ length: numPages }, (_, i) => [line(`Kopfzeile Buch`, 9, 72, 800), line(`Absatz Text ${i} lorem ipsum dolor sit amet`, 11, 72, 600), line(String(i + 1), 9, 300, 40)]);
  pages[0] = [line("Titel des Buches", 28)];
  pages[1] = [
    line("Inhaltsverzeichnis", 18, 72, 760),
    ...chapters.map(([t, p, lvl], k) => line(leaders ? `${t} ${".".repeat(30)} ${p}` : `${t}\t${p}`, 11, 72 + (lvl - 1) * 14, 700 - k * 18)),
  ];
  for (const [t, p] of chapters) pages[p + offset - 1] = [line(t, 20, 72, 760), line("Text darunter lorem ipsum", 11, 72, 700)];
  return {
    numPages,
    pageLines: async (i) => pages[i] ?? [],
    labels,
    chapters,
    offset,
  };
}

test("parseTocLine: leaders, tab gap, numbered without leaders, noise", () => {
  assert.deepEqual(parseTocLine("1.2 Fragestellung ........ 14"), { title: "1.2 Fragestellung", printed: "14", strict: true });
  assert.deepEqual(parseTocLine("Literatur . . . . . . 201"), { title: "Literatur", printed: "201", strict: true });
  assert.deepEqual(parseTocLine("Vorwort\tvii"), { title: "Vorwort", printed: "vii", strict: true });
  assert.deepEqual(parseTocLine("3.4 Auswertung der Daten 77"), { title: "3.4 Auswertung der Daten", printed: "77", strict: false });
  assert.equal(parseTocLine("Er wurde 1998 geboren"), null);
  assert.equal(parseTocLine("12 ........ 3"), null);
});

test("parseTocPage needs enough toc-like lines and derives levels", () => {
  const few = [line("Inhalt"), line("A ........ 1"), line("B ........ 2")];
  assert.deepEqual(parseTocPage(few), []);
  const page = ["1 Eins ...... 1", "1.1 Eins eins ...... 2", "1.2 Eins zwei ...... 3", "2 Zwei ...... 5", "2.1 Zwei eins ...... 6"].map((t) => line(t));
  assert.deepEqual(parseTocPage(page).map((e) => e.level), [1, 2, 2, 1, 2]);
});

test("printed toc without labels: offset is derived from the headings", async () => {
  const b = book();
  const res = await detectOutline(b);
  assert.equal(res.source, "printed");
  assert.deepEqual(res.items.slice(0, 3).map((i) => [i.title, i.page, i.level]), [
    ["1 Einleitung", 1 + b.offset, 1], ["1.1 Hintergrund", 2 + b.offset, 2], ["1.2 Fragestellung", 4 + b.offset, 2],
  ]);
  assert.equal(res.items.length, 7);
});

test("printed toc with tab gaps instead of leaders", async () => {
  const res = await detectOutline(book({ leaders: false }));
  assert.equal(res.source, "printed");
  assert.equal(res.items.length, 7);
});

test("printed toc uses page labels when the pdf has them", async () => {
  const labels = Array.from({ length: 40 }, (_, i) => (i < 3 ? ["i", "ii", "iii"][i] : String(i - 2)));
  const b = book({ labels });
  const res = await detectOutline(b);
  assert.equal(res.source, "printed");
  assert.equal(res.items[0].page, 1 + 3);
});

test("a wrong printed number does not shift the others", async () => {
  const b = book();
  const lines = b.pageLines;
  b.pageLines = async (i) => (i === 1 ? (await lines(1)).map((l) => (l.text.startsWith("4 Diskussion") ? { ...l, text: "4 Diskussion ........ 99" } : l)) : lines(i));
  const res = await detectOutline(b);
  assert.equal(res.source, "printed");
  assert.equal(res.items.find((i) => i.title === "4 Diskussion"), undefined); // Seite 99 gibt es nicht
  assert.equal(res.items.length, 6);
});

test("headings by font size, without running headers and page numbers", async () => {
  const pages = Array.from({ length: 30 }, (_, i) => {
    const l = [line("Zeitschrift fuer Test", 9, 72, 800), line("Fliesstext " + i + " lorem ipsum dolor sit amet consetetur", 11, 72, 600), line("Weiterer Fliesstext lorem ipsum dolor sit amet", 11, 72, 580), line(String(i + 1), 9, 300, 40)];
    if (i % 10 === 0) l.unshift(line(`Kapitel ${i / 10 + 1}`, 24, 72, 700));
    if (i % 5 === 2) l.push(line(`Abschnitt ${i}`, 15, 72, 500));
    return l;
  });
  const res = await detectOutline({ numPages: 30, pageLines: async (i) => pages[i], labels: null });
  assert.equal(res.source, "headings");
  const titles = res.items.map((i) => i.title);
  assert.ok(titles.includes("Kapitel 1") && titles.includes("Abschnitt 2"), titles.join("|"));
  assert.ok(!titles.some((t) => /Zeitschrift|^\d+$/.test(t)), titles.join("|"));
  assert.equal(res.items.find((i) => i.title === "Kapitel 1").level, 1);
  assert.equal(res.items.find((i) => i.title === "Abschnitt 2").level, 2);
});

test("a plain document without structure yields nothing", async () => {
  const pages = Array.from({ length: 12 }, (_, i) => [line("Nur Fliesstext " + i + " lorem ipsum", 11, 72, 600)]);
  assert.equal(await detectOutline({ numPages: 12, pageLines: async (i) => pages[i], labels: null }), null);
});

test("linesFromItems groups by baseline and marks large gaps", () => {
  const items = [
    { str: "Titel", x: 72, y: 700, size: 11, width: 30 },
    { str: "14", x: 500, y: 700.4, size: 11, width: 12 },
    { str: "Zweite", x: 72, y: 680, size: 11, width: 36 },
    { str: "Zeile", x: 112, y: 680, size: 11, width: 28 },
  ];
  const lines = linesFromItems(items);
  assert.deepEqual(lines.map((l) => l.text), ["Titel\t14", "Zweite Zeile"]);
});
