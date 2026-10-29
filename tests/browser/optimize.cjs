const { open, FX, OUT, EXAMPLES, HERE } = require("./harness.cjs");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const ok = (m) => console.log("ok  ", m);
const OPT = path.join(EXAMPLES, "optimize");

(async () => {
  const { browser, page, state, logs, calls } = await open("photo.pdf");
  state.handlers.pdf_optimize = ({ __bytes }, h) => {
    const i = path.join(os.tmpdir(), "opt-in.pdf"), o = path.join(os.tmpdir(), "opt-out.pdf");
    fs.writeFileSync(i, Buffer.from(__bytes, "base64"));
    const rep = execFileSync(OPT, [i, o, h["x-opts"]]).toString().trim();
    const pdf = fs.readFileSync(o), json = Buffer.from(rep);
    const head = Buffer.alloc(4); head.writeUInt32LE(json.length);
    return { __bytes: Buffer.concat([head, json, pdf]).toString("base64") };
  };
  const wait = (ms = 700) => page.waitForTimeout(ms);
  const toast = () => page.evaluate(() => document.getElementById("toast").textContent);
  const images = (buf) => { fs.writeFileSync(OUT + "o.pdf", buf); return JSON.parse(execFileSync("python3", ["-I", "-c", "import pypdf,sys,json; r=pypdf.PdfReader(sys.argv[1]); print(json.dumps([[im.image.width,im.image.mode] for p in r.pages for im in p.images]))", OUT + "o.pdf"]).toString()); };

  // ---- als Kopie: E-Mail
  await page.click("#b-view");
  await page.click("#view-optimize");
  await page.waitForSelector("#optimize[open]");
  await page.screenshot({ path: OUT + "shot-optimize.png" });
  state.dialogSave = "C:\\out\\Foto (komprimiert).pdf";
  await page.click(".opt-copy");
  await wait(2500);
  const copy = state.files["copy:C:\\out\\Foto (komprimiert).pdf"];
  assert(copy, "keine Kopie");
  console.log("     Toast:", await toast());
  assert(copy.length < fs.statSync(FX + "photo.pdf").size / 5); ok("Kopie ist deutlich kleiner: " + copy.length + " Bytes");
  assert.match(await toast(), /→.*−\d+ %/); ok("Meldung zeigt Größe vorher/nachher");
  assert.equal(images(copy)[0][0], 1031); ok("Bilder auf 150 dpi (1031 px)");
  assert.equal(await page.locator("#b-save").isVisible(), false); ok("Das offene Dokument blieb unverändert (nichts zu sichern)");

  // ---- auf dieses Dokument anwenden: Schwarzweiß + Bildschirm, rückgängig, wiederholen
  await page.click("#b-view");
  await page.click("#view-optimize");
  await page.waitForSelector("#optimize[open]");
  await page.check('input[name="opt-dpi"][value="screen"]');
  await page.check('input[name="opt-gray"]');
  await page.click(".opt-here");
  await wait(3000);
  assert.equal(await page.locator("#b-save").isVisible(), true); ok("Anwenden: Dokument ist ungesichert (Sichern-Knopf)");
  console.log("     Toast:", await toast());
  await page.keyboard.press("Control+s");
  await wait(1000);
  const saved = state.files[Object.keys(state.files).filter((k) => k.startsWith("save:")).pop()];
  const imgs = images(saved);
  console.log("     gesicherte Bilder:", JSON.stringify(imgs));
  assert(imgs.every(([w, m]) => m === "L" && w < 800)); ok("Gesichert: Bilder grau und klein");
  assert(saved.length < 120000); ok("Datei: " + saved.length + " Bytes");

  await page.keyboard.press("Control+z");
  await wait(2000);
  await page.keyboard.press("Control+y");
  await wait(2000);
  ok("Rückgängig/Wiederholen laufen durch");

  // ---- nichts weiter zu verkleinern
  await page.click("#b-view");
  await page.click("#view-optimize");
  await page.waitForSelector("#optimize[open]");
  await page.check('input[name="opt-dpi"][value="screen"]');
  await page.click(".opt-here");
  await wait(2500);
  console.log("     Toast:", await toast());

  console.log("\nLogs:", logs.length ? logs : "keine");
  await browser.close();
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
