const { open, FX, OUT, EXAMPLES, HERE } = require("./harness.cjs");
const path = require("path");
const assert = require("assert");
const ok = (m) => console.log("ok  ", m);
(async () => {
  for (const [file, expect] of [["toc.pdf", /gedruckten Inhaltsverzeichnis/], ["heads.pdf", /Überschriften/]]) {
    const { browser, page, logs } = await open(file);
    await page.click("#b-outline");
    await page.waitForFunction(() => document.querySelectorAll("#outline-list .outline-link").length > 0, null, { timeout: 20000 });
    const status = await page.textContent("#outline-status");
    const rows = await page.$$eval("#outline-list .outline-link", (els) => els.map((e) => [e.querySelector(".outline-title").textContent, e.querySelector(".outline-page").textContent]));
    console.log("    ", file, "->", JSON.stringify(rows.slice(0, 8)));
    assert(expect.test(status), status); ok(file + ": Hinweis '" + status + "'");
    if (file === "toc.pdf") {
      assert.deepEqual(rows[0], ["1 Einleitung", "4"]); ok("Einleitung -> PDF-Seite 4 (Versatz 3 erkannt)");
      await page.locator("#outline-list .outline-link", { hasText: "3 Ergebnisse" }).click();
      await page.waitForTimeout(600);
      const chip = await page.textContent("#pagechip");
      assert.match(chip, /^18 /); ok("Klick springt auf Seite 18: " + chip);
    } else {
      assert(rows.some((r) => r[0] === "Teil 1") && rows.some((r) => r[0] === "Abschnitt 3")); ok("Überschriften nach Größe erkannt");
    }
    await page.screenshot({ path: OUT + "shot-toc-" + file + ".png" });
    console.log("     Logs:", logs.length ? logs : "keine");
    await browser.close();
  }
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
