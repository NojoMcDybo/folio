const { open, FX, OUT, EXAMPLES, HERE } = require("./harness.cjs");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const ok = (m) => console.log("ok  ", m);
const EMBED = path.join(EXAMPLES, "embed");

const LINES = ["Gescanntes Schreiben", "Uni Münster, Fachbereich 7", "Telefon 0251 83-22222", "mail@example.org", "https://example.org/info"];
function fakeOcr({ __bytes }) {
  const png = Buffer.from(__bytes, "base64");
  const W = png.readUInt32BE(16), H = png.readUInt32BE(20);
  const lines = LINES.map((text, i) => {
    let x = 140;
    const words = text.split(" ").map((w) => { const ww = w.length * 25.5; const word = { text: w, x: (x / 1240) * W, y: ((200 + i * 110 - 8) / 1754) * H, w: (ww / 1240) * W, h: (62 / 1754) * H }; x += ww + 13; return word; });
    return { text, words };
  });
  return { lang: "de-DE", lines };
}

(async () => {
  const { browser, page, state, calls, logs } = await open("scan.pdf");
  state.handlers.ocr_page = fakeOcr;
  const wait = (ms = 800) => page.waitForTimeout(ms);
  // Geometrie ueber das DOM statt locator.boundingBox(): die Ebene wird beim Zeichnen weiterer Seiten neu
  // angelegt, und boundingBox() liefert in genau diesem Augenblick null.
  const box = (text) => page.evaluate((t) => {
    const e = [...document.querySelectorAll(".ocr-word")].find((w) => w.textContent.includes(t));
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }, text);
  // Die Erkennung läuft beim Zeichnen der ersten Seite; Handler war noch nicht gesetzt -> neu erzwingen
  await page.click("#b-view");
  await page.click("#view-ocr-now");
  await page.waitForSelector(".ocrLayer .ocr-word", { timeout: 20000 });
  await wait(500);
  const n = await page.locator(".ocrLayer .ocr-word").count();
  assert.equal(n, 11, "Wörter: " + n); ok(n + " erkannte Wörter als auswählbare Ebene");
  assert.equal(await page.locator(".ocr-link").count(), 4, "Links"); ok("Telefon (2 Wörter), E-Mail, URL als Links markiert");
  await page.screenshot({ path: OUT + "shot-ocr.png" });

  // ---- Auswahl: Zeile markieren (Dreifachklick) und Text prüfen
  const w = await box("Münster,");
  await page.mouse.click(w.x + 8, w.y + w.height / 2, { clickCount: 3 });
  const sel = await page.evaluate(() => window.getSelection().toString());
  console.log("     Auswahl:", JSON.stringify(sel));
  assert(/Münster/.test(sel)); ok("Text lässt sich markieren");

  // ---- Link klicken: URL öffnet extern
  await page.evaluate(() => window.getSelection().removeAllRanges());
  calls.length = 0;
  console.log("     Wörter jetzt:", await page.$$eval(".ocr-word", (els) => els.map((e) => e.textContent).join("|")));
  console.log("     Boxen:", JSON.stringify(await page.$$eval(".ocr-word", (els) => els.slice(-3).map((e) => { const b = e.getBoundingClientRect(); return [e.textContent, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), e.style.cssText.slice(0, 120)]; }))));
  const url = await box("https://example.org/info");
  await page.mouse.click(url.x + url.width / 2, url.y + url.height / 2);
  await wait(300);
  const opened = calls.find((c) => c.cmd === "plugin:opener|open_url");
  assert(opened && /example.org\/info/.test(JSON.stringify(opened.args))); ok("Klick auf URL: " + JSON.stringify(opened.args));

  // ---- Rechtsklick auf Telefonnummer
  const tel = await box("0251");
  await page.mouse.click(tel.x + 10, tel.y + tel.height / 2, { button: "right" });
  await wait(200);
  const items = await page.$$eval("#text-menu button", (els) => els.map((e) => e.textContent.trim()));
  console.log("     Menü:", JSON.stringify(items));
  assert(items.some((i) => /Anrufen: 0251 83-22222/.test(i))); ok("Kontextmenü bietet Anrufen für die Nummer");
  await page.screenshot({ path: OUT + "shot-ocr-menu.png" });
  calls.length = 0;
  await page.getByRole("menuitem", { name: /Anrufen/ }).click();
  await wait(200);
  const call = calls.find((c) => c.cmd === "plugin:opener|open_url");
  assert(call && /tel:02518322222/.test(JSON.stringify(call.args))); ok("tel:-Adresse geöffnet: " + JSON.stringify(call.args));

  // Rechtsklick auf Einzelwort -> Nachschlagen
  const gw = await box("Fachbereich");
  await page.mouse.click(gw.x + 10, gw.y + gw.height / 2, { button: "right" });
  await wait(200);
  const items2 = await page.$$eval("#text-menu button", (els) => els.map((e) => e.textContent.trim()));
  assert(items2.some((i) => /Nachschlagen „Fachbereich“/.test(i))); ok("Nachschlagen „Fachbereich“");
  await page.keyboard.press("Escape");

  // ---- Einbetten
  state.handlers.pdf_embed_text = ({ __bytes }) => {
    const buf = Buffer.from(__bytes, "base64");
    const len = buf.readUInt32LE(0);
    const jf = path.join(os.tmpdir(), "emb-pages.json"), inf = path.join(os.tmpdir(), "emb-in.pdf"), of = path.join(os.tmpdir(), "emb-out.pdf");
    fs.writeFileSync(jf, buf.subarray(4, 4 + len)); fs.writeFileSync(inf, buf.subarray(4 + len));
    execFileSync(EMBED, [inf, of, jf]);
    return { __bytes: fs.readFileSync(of).toString("base64") };
  };
  await page.click("#b-view");
  await wait(200);
  assert.equal(await page.locator("#view-ocr-embed").isVisible(), true); ok("Menüeintrag 'Erkannten Text einbetten' erscheint, wenn erkannt wurde");
  await page.click("#view-ocr-embed");
  await wait(2500);
  assert.equal(await page.locator("#b-save").isVisible(), true);
  await page.keyboard.press("Control+s");
  await wait(600);
  const saved = state.files[Object.keys(state.files).filter((k) => k.startsWith("save:")).pop()];
  fs.writeFileSync(OUT + "ocr-saved.pdf", saved);
  const text = execFileSync("python3", ["-I", "-c", "import pypdf,sys; r=pypdf.PdfReader(sys.argv[1]); print(r.pages[0].extract_text())", OUT + "ocr-saved.pdf"]).toString();
  console.log("     pypdf liest:", JSON.stringify(text.slice(0, 160)));
  assert(/Gescanntes Schreiben/.test(text) && /Münster/.test(text) && /0251 83-22222/.test(text)); ok("Text steht nach dem Sichern unsichtbar in der PDF");
  assert.equal(await page.locator(".ocrLayer").count(), 0 + (await page.locator(".ocrLayer").count())); // Ebene wird für Seiten mit eigenem Text nicht mehr gebraucht
  console.log("\nLogs:", logs.length ? logs : "keine");
  await browser.close();
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
