const { open, FX, OUT, EXAMPLES, HERE } = require("./harness.cjs");
const path = require("path");
const assert = require("assert");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");
const ok = (m) => console.log("ok  ", m);
const SIGNSERVER = path.join(EXAMPLES, "signserver");

function startServer() {
  const child = spawn(SIGNSERVER, [], { stdio: ["pipe", "pipe", "inherit"] });
  let buf = ""; const waiters = [];
  child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const w = waiters.shift(); if (w) w(line); } });
  const next = () => new Promise((r) => waiters.push(r));
  const ask = async (cmd) => { child.stdin.write(cmd + "\n"); return next(); };
  return next().then((line) => { const [, port, token] = line.split(" "); return { child, ask, port, token }; });
}

(async () => {
  const srv = await startServer();
  const { browser, page, state, logs, calls } = await open("doc12.pdf");
  const ctx = page.context();
  state.handlers.sign_start = () => ({ url: `http://127.0.0.1:${srv.port}/s/${srv.token}`, ip: "192.168.1.20", port: Number(srv.port) });
  state.handlers.sign_status = async () => srv.ask("status");
  state.handlers.sign_take = async () => { const l = await srv.ask("take"); return { __bytes: Buffer.from(l.slice(4), "hex").toString("base64") }; };
  const wait = (ms = 700) => page.waitForTimeout(ms);

  await page.keyboard.press("Control+Shift+u");
  await page.waitForSelector("#sign[open] .sign-qr svg");
  ok("Dialog mit QR-Code");
  assert.match(await page.textContent(".sign-status"), /Warte auf das Handy/); ok("Status: Warte auf das Handy");
  await page.screenshot({ path: OUT + "shot-sign-qr.png" });

  // ---- das "Handy": echte Seite vom Rust-Server, kleiner Bildschirm
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 780 });
  await phone.goto(`http://127.0.0.1:${srv.port}/s/${srv.token}`);
  await phone.waitForSelector("#c");
  await wait(1500);
  assert.match(await page.textContent(".sign-status"), /Handy verbunden/); ok("Status wechselt zu 'Handy verbunden'");
  const pad = await phone.locator("#pad").boundingBox();
  await phone.mouse.move(pad.x + 40, pad.y + 120);
  await phone.mouse.down();
  for (let i = 0; i <= 40; i++) await phone.mouse.move(pad.x + 40 + i * 7, pad.y + 120 + Math.sin(i / 3) * 40 + (i % 5) * 2);
  await phone.mouse.up();
  await phone.screenshot({ path: OUT + "shot-phone.png" });
  assert.equal(await phone.locator("#send").isEnabled(), true);
  await phone.click("#send");
  await phone.waitForFunction(() => /Gesendet/.test(document.getElementById("msg").textContent), null, { timeout: 5000 });
  ok("Handy-Seite: 'Gesendet ✓'");
  await wait(1800);
  assert.equal(await page.locator("#sign[open]").count(), 0); ok("Dialog schließt, sobald die Unterschrift da ist");

  // ---- Stempel im Dokument
  await page.waitForSelector(".stampEditor, .annotationEditorLayer .stampEditor", { timeout: 8000 });
  const stamp = await page.locator(".stampEditor").first().boundingBox();
  const pg = await page.locator(".page").first().boundingBox();
  console.log("     Stempel:", JSON.stringify(stamp), "Seite:", JSON.stringify(pg));
  assert(stamp.width > pg.width * 0.15 && stamp.width < pg.width * 0.4); ok("Stempel hat etwa ein Viertel der Seitenbreite");
  await page.screenshot({ path: OUT + "shot-sign-placed.png" });

  // verschieben per Ziehen
  await page.mouse.move(stamp.x + stamp.width / 2, stamp.y + stamp.height / 2);
  await page.mouse.down();
  await page.mouse.move(stamp.x + stamp.width / 2 + 30, stamp.y + stamp.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const moved = await page.locator(".stampEditor").first().boundingBox();
  assert(Math.abs(moved.y - stamp.y) > 40); ok("Stempel lässt sich verschieben");

  // ---- Speichern
  await page.keyboard.press("Escape");
  await wait(400);
  assert.equal(await page.locator("#b-save").isVisible(), true); ok("Sichern-Knopf sichtbar");
  await page.keyboard.press("Control+s");
  await wait(1200);
  const saved = state.files[Object.keys(state.files).filter((k) => k.startsWith("save:")).pop()];
  fs.writeFileSync(OUT + "signed.pdf", saved);
  const info = JSON.parse(execFileSync("python3", ["-I", "-c", `
import pypdf, json, sys
r = pypdf.PdfReader(sys.argv[1]); p = r.pages[0]
an = [a.get_object() for a in (p.get('/Annots') or [])]
print(json.dumps([{ 'sub': str(a.get('/Subtype')), 'rect': [round(float(x)) for x in a.get('/Rect')], 'ap': '/AP' in a } for a in an]))
`, OUT + "signed.pdf"]).toString());
  console.log("     Anmerkungen Seite 1:", JSON.stringify(info));
  assert(info.some((a) => a.sub === "/Stamp" && a.ap)); ok("PDF enthält Stempel-Anmerkung mit Aussehen");

  // ---- gemerkt: zweiter Aufruf zeigt 'Gespeichert'
  await page.keyboard.press("Control+Shift+u");
  await page.waitForSelector("#sign[open] .sign-saved .sign-use img");
  ok("Unterschrift wurde gemerkt und steht unter 'Gespeichert'");
  await page.screenshot({ path: OUT + "shot-sign-saved.png" });
  await page.click(".sign-del");
  await wait(300);
  assert.equal(await page.locator(".sign-use").count(), 0); ok("Löschen entfernt die gemerkte Unterschrift");
  await page.click(".sign-cancel");

  // ---- Hier zeichnen
  await page.keyboard.press("Control+Shift+u");
  await page.waitForSelector("#sign[open]");
  await page.click('[data-tab="draw"]');
  await wait(300);
  const cv = await page.locator(".sign-canvas").boundingBox();
  await page.mouse.move(cv.x + 40, cv.y + 100);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) await page.mouse.move(cv.x + 40 + i * 9, cv.y + 100 + Math.cos(i / 2) * 30);
  await page.mouse.up();
  assert.equal(await page.locator(".sign-row .primary").isEnabled(), true);
  await page.click(".sign-row .primary");
  await wait(1500);
  assert.equal(await page.locator(".stampEditor").count() >= 2, true); ok("'Hier zeichnen' setzt eine zweite Unterschrift");

  console.log("\nLogs:", logs.length ? logs : "keine");
  srv.child.stdin.write("stop\n");
  await browser.close();
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
