const { open, FX, OUT, EXAMPLES, HERE } = require("./harness.cjs");
const path = require("path");
const assert = require("assert");
const fs = require("fs");
const { execFileSync } = require("child_process");

const inspect = (buf) => { const f = OUT + "insp.pdf"; fs.writeFileSync(f, buf); return JSON.parse(execFileSync("python3", ["-I", HERE + "/pdfinfo.py", f]).toString()); };
const ok = (m) => console.log("ok  ", m);

(async () => {
  const { browser, page, logs, calls, state } = await open("doc12.pdf");
  const wait = (ms = 700) => page.waitForTimeout(ms);
  const chip = () => page.evaluate(() => document.getElementById("pagechip").textContent);
  const thumbs = () => page.locator(".thumb").count();
  const saveNow = async () => { calls.length = 0; await page.keyboard.press("Control+s"); await wait(500); const k = Object.keys(state.files).filter((x) => x.startsWith("save:")).pop(); return state.files[k]; };

  await page.keyboard.press("Control+b");
  await wait(1200);
  assert.equal(await thumbs(), 12); ok("12 Miniaturen");

  // ---- Auswahl: Seite 2, dann Strg+Klick auf 3 -> drehen
  await page.locator('.thumb[data-page="2"]').click();
  await wait(300);
  await page.locator('.thumb[data-page="3"]').click({ modifiers: ["Control"] });
  assert.deepEqual(await page.locator(".thumb.sel").evaluateAll((els) => els.map((e) => e.dataset.page)), ["2", "3"]); ok("Auswahl 2 + 3");
  await page.keyboard.press("Control+.");
  await wait(1500);
  const edit = calls.find((c) => c.cmd === "pdf_edit");
  assert.equal(edit.headers["x-edits"], '[{"op":"rotate","pages":[1,2],"degrees":90}]'); ok("pdf_edit rotate 2+3: " + edit.headers["x-edits"]);
  assert.equal(await thumbs(), 12);
  assert.deepEqual(await page.locator(".thumb.sel").evaluateAll((els) => els.map((e) => e.dataset.page)), ["2", "3"]); ok("Auswahl nach Drehen erhalten");
  assert.equal(await page.locator("#b-save").isVisible(), true); ok("Sichern-Knopf sichtbar (ungesichert)");
  await page.screenshot({ path: OUT + "shot-rotate.png" });

  // ---- Löschen: Seite 5 anklicken, Entf
  await page.locator('.thumb[data-page="9"]').click();
  await wait(300);
  await page.keyboard.press("Control+d"); // Lesezeichen auf 9
  await page.locator('.thumb[data-page="5"]').click();
  await wait(300);
  await page.locator('.thumb[data-page="5"]').focus();
  await page.keyboard.press("Delete");
  await wait(1500);
  assert.equal(await thumbs(), 11); ok("Seite 5 gelöscht -> 11 Seiten");
  const bm1 = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("folio.bookmarks.")).map(([, v]) => v));
  assert(bm1.includes("[8]"), JSON.stringify(bm1)); ok("Lesezeichen 9 -> 8 verschoben");

  // ---- Rückgängig / Wiederholen
  await page.keyboard.press("Control+z");
  await wait(1500);
  assert.equal(await thumbs(), 12); ok("Strg+Z: 12 Seiten");
  await page.keyboard.press("Control+y");
  await wait(1500);
  assert.equal(await thumbs(), 11); ok("Strg+Y: 11 Seiten");
  await page.keyboard.press("Control+Shift+z");
  await wait(300);

  // ---- Umsortieren per Ziehen: Seite 1 hinter Seite 3 (vor 4)
  await wait(800);
  await page.evaluate(() => document.getElementById("thumb-list").scrollTo({ top: 0 }));
  await wait(400);
  const t1 = await page.locator('.thumb[data-page="1"]').boundingBox();
  const t4 = await page.locator('.thumb[data-page="4"]').boundingBox();
  await page.mouse.move(t1.x + 50, t1.y + 60);
  await page.mouse.down();
  await page.mouse.move(t1.x + 52, t1.y + 80, { steps: 4 });
  await page.mouse.move(t4.x + 50, t4.y + 8, { steps: 12 });
  assert.equal(await page.locator(".thumb-ghost").count(), 1); ok("Geisterbild beim Ziehen");
  assert.equal(await page.locator(".thumb-marker.on").count(), 1); ok("Einfügemarke sichtbar");
  await page.screenshot({ path: OUT + "shot-dragging.png" });
  await page.mouse.up();
  await wait(1500);
  let bytes = await saveNow();
  let pages = inspect(bytes);
  assert.equal(pages.length, 11);
  console.log("     Reihenfolge nach Ziehen:", pages.map((p) => p.n).join(","));
  assert.deepEqual(pages.slice(0, 4).map((p) => p.n), [2, 3, 1, 4]); ok("Seite 1 liegt jetzt vor Seite 4: 2,3,1,4");
  assert.deepEqual(pages.slice(0, 3).map((p) => p.rot), [90, 90, 0]); ok("Drehung von 2+3 überlebt Umsortieren: " + JSON.stringify(pages.slice(0, 4).map((p) => p.rot)));
  assert(!pages.some((p) => p.n === 5)); ok("gelöschte Seite 5 fehlt");

  // ---- Einfügen über Kontextmenü
  state.dialogOpen.push(["C:\\x\\doc3.pdf"]);
  await page.locator('.thumb[data-page="2"]').click({ button: "right" });
  await wait(200);
  await page.screenshot({ path: OUT + "shot-menu.png" });
  await page.getByRole("menuitem", { name: /PDF dahinter einfügen/ }).click();
  await wait(2000);
  assert.equal(await thumbs(), 14); ok("3 Seiten eingefügt -> 14");
  bytes = await saveNow();
  pages = inspect(bytes);
  console.log("     Reihenfolge nach Einfügen:", pages.map((p) => p.n).join(","));
  assert.deepEqual(pages.slice(0, 6).map((p) => p.n), [2, 3, 1, 2, 3, 1].slice(0,2).concat([1,2,3,1].slice(0,4))); ok("Seiten 1-3 stehen hinter der zweiten Seite");

  // ---- Zuschneiden
  await page.locator('.thumb[data-page="1"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: /Zuschneiden/ }).click();
  await page.waitForSelector("#crop[open] canvas");
  await wait(400);
  const nw = await page.locator('#crop i[data-h="nw"]').boundingBox();
  await page.mouse.move(nw.x + 7, nw.y + 7);
  await page.mouse.down();
  await page.mouse.move(nw.x + 7 + 60, nw.y + 7 + 40, { steps: 6 });
  await page.mouse.up();
  await page.screenshot({ path: OUT + "shot-crop.png" });
  calls.length = 0;
  await page.click(".crop-apply");
  await wait(1800);
  const crop = calls.find((c) => c.cmd === "pdf_edit");
  assert(crop && JSON.parse(crop.headers["x-edits"])[0].op === "crop"); ok("pdf_edit crop: " + crop.headers["x-edits"]);
  bytes = await saveNow();
  pages = inspect(bytes);
  console.log("     CropBox Seite 1:", JSON.stringify(pages[0].crop), "Media:", JSON.stringify(pages[0].media));
  assert(pages[0].crop[0] > 0 && pages[0].crop[3] === pages[0].media[3] - 0 || pages[0].crop[3] < pages[0].media[3]); ok("Seite 1 beschnitten");
  assert.deepEqual(pages[5].crop, pages[5].media.map((v, i) => v)); ok("andere Seiten unberührt");

  // ---- Extrahieren
  state.dialogSave = "C:\\out\\Auszug.pdf";
  await page.locator('.thumb[data-page="3"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: /als PDF sichern/ }).click();
  await wait(1500);
  const copyKey = Object.keys(state.files).find((k) => k.startsWith("copy:"));
  assert(copyKey, "keine Kopie geschrieben");
  const part = inspect(state.files[copyKey]);
  assert.equal(part.length, 1); ok("Auszug: 1 Seite (" + JSON.stringify(part[0]) + ")");

  // ---- Herausziehen über den Fensterrand
  const dragCalls = () => calls.filter((c) => c.cmd === "plugin:drag|start_drag");
  calls.length = 0;
  await page.locator('.thumb[data-page="4"]').scrollIntoViewIfNeeded();
  await wait(300);
  const t3 = await page.locator('.thumb[data-page="4"]').boundingBox();
  await page.mouse.move(t3.x + 50, t3.y + 60);
  await page.mouse.down();
  await page.mouse.move(t3.x + 20, t3.y + 80, { steps: 3 });
  await page.mouse.move(-30, 300, { steps: 6 });
  await wait(1500);
  await page.mouse.up();
  await wait(500);
  console.log('     Toast:', await page.evaluate(() => document.getElementById('toast').textContent));
  console.log('     Aufrufe:', calls.map((c) => c.cmd).filter((c) => c !== 'notch_events').join(','), '| Logs:', JSON.stringify(logs));
  const dc = dragCalls();
  console.log("     Drag-Aufrufe:", JSON.stringify(dc.map((c) => c.args)));
  assert(dc.length === 1 && /Seite 4\.pdf/.test(JSON.stringify(dc[0].args))); ok("nativer Drag mit temporärer Datei gestartet");
  const tempFiles = Object.keys(state.files).filter((k) => k.startsWith("temp:"));
  assert(tempFiles.some((k) => k.endsWith("Vorschau.png")) && tempFiles.some((k) => /Seite 4\.pdf$/.test(k))); ok("PDF + Vorschaubild in der Ablage");

  console.log("\nLogs:", logs.length ? logs : "keine");
  await browser.close();
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
