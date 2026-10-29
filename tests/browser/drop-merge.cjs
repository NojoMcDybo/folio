const { open, FX, OUT, EXAMPLES, HERE } = require("./harness.cjs");
const path = require("path");
const assert = require("assert");
const fs = require("fs");
const { execFileSync } = require("child_process");
const info = (buf) => { fs.writeFileSync(OUT + "i2.pdf", buf); return JSON.parse(execFileSync("python3", ["-I", HERE + "/pdfinfo.py", OUT + "i2.pdf"]).toString()); };
const ok = (m) => console.log("ok  ", m);
(async () => {
  // ---- Leser: PDF auf die offene Seitenleiste fallen lassen
  {
    const { browser, page, state, emit, calls, logs } = await open("doc12.pdf");
    const wait = (ms = 700) => page.waitForTimeout(ms);
    // Seitenleiste zu: Drag am linken Rand fährt sie aus
    await emit("tauri://drag-over", { position: { x: 12, y: 400 } });
    await wait(900);
    assert.equal(await page.evaluate(() => document.getElementById("thumbs").inert), false); ok("Datei am linken Rand: Leiste fährt von selbst heraus");
    const t3 = await page.locator('.thumb[data-page="3"]').boundingBox();
    await emit("tauri://drag-over", { position: { x: 70, y: t3.y + t3.height + 6 } });
    await wait(200);
    assert.equal(await page.locator(".thumb-marker.on").count(), 1); ok("Einfügemarke zwischen den Seiten");
    await page.screenshot({ path: OUT + "shot-dropmarker.png" });
    await emit("tauri://drag-drop", { paths: ["C:\\x\\doc3.pdf"], position: { x: 70, y: t3.y + t3.height + 6 } });
    await wait(2000);
    assert.equal(await page.locator(".thumb").count(), 15); ok("3 Seiten eingefügt -> 15");
    const save = await (async () => { await page.keyboard.press("Control+s"); await wait(600); return state.files[Object.keys(state.files).filter((k) => k.startsWith("save:")).pop()]; })();
    const pages = info(save);
    console.log("     Reihenfolge:", pages.map((p) => p.n).join(","));
    assert.deepEqual(pages.slice(0, 7).map((p) => p.n), [1, 2, 3, 1, 2, 3, 4]); ok("hinter Seite 3 eingefügt");
    await emit("tauri://drag-leave", {});
    console.log("     Logs:", logs.length ? logs : "keine");
    await browser.close();
  }
  // ---- Bibliothek: Seiten-Datei aus der Ablage adoptieren; mehrere PDFs zusammenführen
  {
    const { browser, page, state, emit, calls, logs } = await open(null);
    const wait = (ms = 700) => page.waitForTimeout(ms);
    state.handlers.adopt_temp_pdf = ({ path }) => "C:\\Dokumente\\Folio\\" + path.split("\\").pop();
    state.handlers.startup_file = () => null;
    // Einzelne Datei aus der Ablage: übernehmen, dann öffnen
    await emit("tauri://drag-drop", { paths: ["C:\\Temp\\Folio-Ablage\\1\\Auszug.pdf"], position: { x: 300, y: 300 } });
    await wait(600);
    console.log("     Aufrufe:", calls.map((c) => c.cmd + (c.args && c.args.path ? ":" + c.args.path : "")).filter((c) => !/notch|listen|startup/.test(c)).join(" | "));
    assert(calls.some((c) => c.cmd === "adopt_temp_pdf")); ok("Seiten-Datei aus der Ablage wird in die Bibliothek übernommen");
    // Mehrere PDFs: Frage
    await emit("tauri://drag-drop", { paths: ["C:\\a\\doc3.pdf", "C:\\a\\doc12.pdf"], position: { x: 300, y: 300 } });
    await page.waitForSelector("#merge-ask[open]");
    await page.screenshot({ path: OUT + "shot-mergeask.png" });
    await page.click("#merge-ask-merge");
    await wait(2500);
    const lib = Object.keys(state.files).find((k) => k.startsWith("lib:"));
    assert(lib, "keine Bibliotheksdatei"); ok("zusammengeführt nach " + lib.slice(4));
    const merged = info(state.files[lib]);
    assert.equal(merged.length, 15); assert.deepEqual(merged.slice(0, 4).map((p) => p.n), [1, 2, 3, 1]); ok("15 Seiten: 3 + 12 in Reihenfolge");
    console.log("     Logs:", logs.length ? logs : "keine");
    await browser.close();
  }
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
