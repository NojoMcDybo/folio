// Gemeinsamer Browser-Test-Rahmen: Folio im Chromium mit simuliertem Tauri.
// Der native Teil wird in Node nachgestellt - pdf_edit ruft die echte Rust-Bibliothek auf.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "../..");
const FX = path.join(__dirname, "fixtures") + "/";
const OUT = path.join(ROOT, "work", "browser") + "/";
const EXAMPLES = path.join(ROOT, "src-tauri", "target", "debug", "examples");
const EDIT_BIN = path.join(EXAMPLES, "edit");
const URL = process.env.FOLIO_URL || "http://localhost:1420/";
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(FX + "doc12.pdf")) throw new Error("Testdateien fehlen: python3 tests/browser/make-fixtures.py");

async function open(name, opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: opts.w || 1100, height: opts.h || 760 }, deviceScaleFactor: opts.dpr || 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => { if (["error"].includes(m.type()) || (m.type() === "warning" && !/GL Driver|WebGL/.test(m.text()))) logs.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  const calls = [];
  const state = { dialogOpen: [], dialogSave: null, files: {}, handlers: {}, listeners: {} };
  let tmpN = 0;

  const builtin = {
    read_pdf: ({ path: p }) => ({ __bytes: fs.readFileSync(FX + String(p).split(/[\\/]/).pop()).toString("base64") }),
    pdf_edit: ({ __bytes }, h) => {
      const i = path.join(os.tmpdir(), `in-${process.pid}-${tmpN}.pdf`), o = path.join(os.tmpdir(), `out-${process.pid}-${tmpN++}.pdf`);
      fs.writeFileSync(i, Buffer.from(__bytes, "base64"));
      execFileSync(EDIT_BIN, [i, o, h["x-edits"]]);
      return { __bytes: fs.readFileSync(o).toString("base64") };
    },
    save_pdf: ({ __bytes }, h) => { state.files["save:" + h["x-path"]] = Buffer.from(__bytes, "base64"); return null; },
    write_pdf_copy: ({ __bytes }, h) => { state.files["copy:" + Buffer.from(h["x-path"], "hex").toString()] = Buffer.from(__bytes, "base64"); return null; },
    temp_file: ({ __bytes }, h) => { const n = Buffer.from(h["x-name"], "hex").toString(); const p = `C:\\Temp\\Folio-Ablage\\${tmpN++}\\${n}`; state.files["temp:" + p] = Buffer.from(__bytes, "base64"); return p; },
    library_pdf: ({ __bytes }, h) => { const n = Buffer.from(h["x-name"], "hex").toString(); const p = `C:\\Dokumente\\Folio\\${n}`; state.files["lib:" + p] = Buffer.from(__bytes, "base64"); fs.writeFileSync(FX + n, Buffer.from(__bytes, "base64")); return p; },
    read_pdf_plain: ({ path: p }) => ({ __bytes: fs.readFileSync(FX + String(p).split(/[\\/]/).pop()).toString("base64") }),
    "plugin:event|listen": (a) => { state.listeners[a.event] = a.handler; return 1; },
    "plugin:dialog|open": () => state.dialogOpen.shift() ?? null,
    "plugin:dialog|save": () => state.dialogSave,
  };

  await page.exposeFunction("__rpc", async (cmd, payload, headers) => {
    const rec = { cmd, args: payload && payload.__bytes ? "[" + Buffer.from(payload.__bytes, "base64").length + " bytes]" : payload, headers };
    calls.push(rec);
    const fn = state.handlers[cmd] || builtin[cmd];
    return fn ? fn(payload, headers) : null;
  });
  await page.addInitScript(() => {
    const cb = new Map();
    const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" }, windows: [{ label: "main" }], webviews: [{ windowLabel: "main", label: "main" }] },
      transformCallback(fn) { const id = Math.floor(Math.random() * 1e9); cb.set(id, fn); window["_" + id] = fn; return id; },
      convertFileSrc: (p) => p,
      async invoke(cmd, args, options) {
        let payload = args;
        if (args instanceof ArrayBuffer) payload = { __bytes: b64(new Uint8Array(args)) };
        else if (ArrayBuffer.isView(args)) payload = { __bytes: b64(new Uint8Array(args.buffer, args.byteOffset, args.byteLength)) };
        const res = await window.__rpc(cmd, payload, (options && options.headers) || null);
        if (res && res.__bytes) { const bin = atob(res.__bytes); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
        return res === undefined ? null : res;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
  await page.goto(URL + (name ? "?doc=" + encodeURIComponent("C:\\docs\\" + name) : ""));
  if (name) await page.waitForSelector("#viewer .page canvas", { timeout: 15000 });
  else await page.waitForSelector("#grid", { timeout: 15000 });
  await page.waitForTimeout(400);
  const emit = (event, payload) => page.evaluate(([id, ev, p]) => window["_" + id]({ event: ev, id: 1, payload: p }), [state.listeners[event], event, payload]);
  return { browser, page, logs, calls, state, FX, OUT, emit };
}
module.exports = { open, FX, OUT, ROOT, EXAMPLES, HERE: __dirname };
