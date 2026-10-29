const { open, FX, OUT, EXAMPLES, HERE } = require("./harness.cjs");
const path = require("path");
const assert = require("assert");
(async () => {
  const { browser, page, logs } = await open("doc12.pdf");
  const out = (n) => OUT + "shot-" + n + ".png";
  const ok = (m) => console.log("ok  ", m);

  // --- Seitenleiste zu Beginn zu
  let open0 = await page.evaluate(() => getComputedStyle(document.getElementById("thumbs")).visibility);
  assert.equal(open0, "hidden"); ok("Seitenleiste anfangs unsichtbar");
  assert.equal(await page.locator(".thumb").count(), 0); ok("keine Miniaturen gebaut, solange zu");

  // --- Strg+B öffnet, Miniaturen rendern lazy
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(1200);
  assert.equal(await page.locator(".thumb").count(), 12); ok("12 Miniaturen");
  const ready = await page.locator(".thumb.ready").count();
  assert(ready >= 5, "ready " + ready); ok("Miniaturen gezeichnet: " + ready);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("thumbs")).visibility), "visible");
  await page.screenshot({ path: out("sidebar-open") });

  // aktuelle Seite markiert
  assert.equal(await page.locator(".thumb.cur").getAttribute("data-page"), "1"); ok("aktuelle Seite markiert");

  // Klick auf Miniatur 5 springt
  await page.locator('.thumb[data-page="5"]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.querySelector(".thumb.cur").dataset.page), "5"); ok("Klick springt zu Seite 5");

  // --- Wegwischen: von Miniatur nach links ziehen
  const box = await page.locator('.thumb[data-page="6"]').boundingBox();
  await page.mouse.move(box.x + 50, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 50 - i * 14, box.y + 62, { steps: 1 });
  const mid = await page.evaluate(() => Number(document.getElementById("thumbs").style.getPropertyValue("--open")));
  assert(mid > 0 && mid < 1, "mid " + mid); ok("folgt dem Zeiger stufenlos (" + mid.toFixed(2) + ")");
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("thumbs")).visibility), "hidden"); ok("weggewischt -> unsichtbar");
  assert.equal(await page.evaluate(() => document.querySelector(".thumb.cur").dataset.page), "5"); ok("Wegwischen hat keine Seite geöffnet");

  // --- Hineinziehen per Griff
  const grip = await page.locator("#thumbs-grip").boundingBox();
  await page.mouse.move(grip.x + 6, grip.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(grip.x + 6 + i * 14, grip.y + 40);
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("thumbs")).visibility), "visible"); ok("per Griff herausgezogen");

  // Griff-Klick schließt
  await page.locator("#thumbs-grip").click();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.getElementById("thumbs").inert), true); ok("Griff-Klick schließt");

  // Touchpad-Wischen (wheel deltaX negativ) öffnet
  await page.mouse.move(600, 400);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(-30, 0);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.getElementById("thumbs").inert), false); ok("Touchpad-Wischen öffnet");

  // Esc schließt
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.getElementById("thumbs").inert), true); ok("Esc schließt");

  // --- Ansichtsmenü
  await page.click("#b-view");
  await page.waitForTimeout(200);
  await page.screenshot({ path: out("viewmenu") });
  await page.click('[data-mode="single"]');
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#viewer .page:not([hidden])").length), 1) ;
  ok("Einzelseite: eine sichtbare Seite");
  await page.keyboard.press("Escape");
  const chip = () => page.evaluate(() => { const v = window.__v; return document.getElementById("pagechip").textContent; });
  console.log("     vor PageDown:", await chip());
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(400);
  console.log("     nach PageDown:", await chip());
  await page.screenshot({ path: out("single") });
  // Wheel-Blättern
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(700);
  const pg = await page.evaluate(() => document.getElementById("pagechip").textContent);
  console.log("     pagechip nach 2x Rad + PageDown:", pg);

  const menu = async () => { if (await page.locator("#view-menu").isHidden()) await page.click("#b-view"); };
  await menu();
  await page.click('[data-mode="double"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: out("double") });
  await menu();
  await page.click('[data-mode="continuous"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // --- Kontaktbogen
  await page.keyboard.press("k");
  await page.waitForTimeout(1200);
  assert.equal(await page.locator("#sheet .cell").count(), 12); ok("Kontaktbogen: 12 Zellen");
  const sheetReady = await page.locator("#sheet .cell.ready").count();
  assert(sheetReady >= 6, "sheet ready " + sheetReady); ok("Kontaktbogen gezeichnet: " + sheetReady);
  await page.screenshot({ path: out("sheet") });
  await page.locator('#sheet .cell[data-page="9"]').click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#sheet").isHidden(), true);
  assert.equal(await page.evaluate(() => document.querySelector(".thumb.cur")?.dataset.page ?? "x"), "9"); ok("Kontaktbogen springt zu Seite 9");

  // --- Lesezeichen
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => localStorage.length > 0));
  const bm = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("folio.bookmarks.")));
  assert.equal(bm.length, 1); assert.equal(bm[0][1], "[9]"); ok("Lesezeichen gespeichert " + bm[0][1]);
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(800);
  assert.equal(await page.locator(".thumb.bm").count(), 1); ok("Lesezeichen in Leiste markiert");
  await page.screenshot({ path: out("bookmark") });

  // Invertieren
  await page.keyboard.press("Control+i");
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.getElementById("thumbs").classList.contains("invert"))); ok("Invertierung auf Leiste");

  console.log("\nLogs:", logs.length ? logs : "keine");
  await browser.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
