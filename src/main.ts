import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewer = $<HTMLElement>("viewer");
const drop = $<HTMLElement>("drop");
const fileLabel = $<HTMLElement>("file");
const pagesLabel = $<HTMLElement>("pages");
const btnOpen = $<HTMLButtonElement>("btn-open");
const btnFind = $<HTMLButtonElement>("btn-find");
const btnIn = $<HTMLButtonElement>("btn-zoom-in");
const btnOut = $<HTMLButtonElement>("btn-zoom-out");
const btnReset = $<HTMLButtonElement>("btn-zoom-reset");
const btnInvert = $<HTMLButtonElement>("btn-invert");
const findbar = $<HTMLElement>("findbar");
const findInput = $<HTMLInputElement>("find-q");
const findCount = $<HTMLElement>("find-count");
const findPrev = $<HTMLButtonElement>("find-prev");
const findNext = $<HTMLButtonElement>("find-next");
const findClose = $<HTMLButtonElement>("find-close");

let doc: PDFDocumentProxy | null = null;
let loadTask: PDFDocumentLoadingTask | null = null;

/** natuerliche Seitengroesse bei scale 1, einmal beim Laden ermittelt */
let sizes: { w: number; h: number }[] = [];
let pageEls: HTMLDivElement[] = [];

let baseScale = 1;
let zoom = 1;
let current = 1;

/** Zaehler der aktuellen Skala: alles was mit alter epoch fertig wird, faellt weg */
let epoch = 0;

const renderedAt = new Map<number, number>();
const inFlight = new Map<number, RenderTask>();
const queue: number[] = [];
let active = 0;

const MAX_PARALLEL = 2;
const PAD = 48;
const NEAR = 1600;
const KEEP = 5000;

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const clamp = (v: number) => Math.min(6, Math.max(0.25, v));

// ---------- Suche ----------

let query = "";
let pageText: string[] = [];
let indexed = 0;
let indexing = false;
let matches: { page: number; idx: number }[] = [];
let matchPos = -1;

/** CSS Custom Highlight API. In WebView2 vorhanden, aber je nach
 *  TypeScript-Version nicht typisiert - deshalb bewusst lose gegriffen. */
const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown })
  .Highlight;
const highlightRegistry = (
  CSS as unknown as { highlights?: { set(k: string, v: unknown): void; delete(k: string): void } }
).highlights;

// ---------- Anzeige ----------

function setZoomLabel() {
  btnReset.textContent = Math.round(zoom * 100) + "%";
}

function setPageLabel() {
  pagesLabel.textContent = doc ? current + " / " + doc.numPages : "";
}

function applySizes() {
  const s = baseScale * zoom;
  for (let i = 0; i < pageEls.length; i++) {
    pageEls[i].style.width = Math.floor(sizes[i].w * s) + "px";
    pageEls[i].style.height = Math.floor(sizes[i].h * s) + "px";
  }
}

function nearPages(margin: number): number[] {
  const top = viewer.scrollTop - margin;
  const bottom = viewer.scrollTop + viewer.clientHeight + margin;
  const res: number[] = [];
  for (let i = 0; i < pageEls.length; i++) {
    const el = pageEls[i];
    const t = el.offsetTop;
    if (t + el.offsetHeight >= top && t <= bottom) res.push(i + 1);
  }
  return res;
}

function prune() {
  const top = viewer.scrollTop - KEEP;
  const bottom = viewer.scrollTop + viewer.clientHeight + KEEP;
  for (const n of [...renderedAt.keys()]) {
    const el = pageEls[n - 1];
    if (!el) continue;
    if (el.offsetTop + el.offsetHeight < top || el.offsetTop > bottom) {
      el.replaceChildren();
      el.classList.remove("ready");
      renderedAt.delete(n);
    }
  }
}

// ---------- Rendern ----------

function want(n: number) {
  if (!doc) return;
  if (renderedAt.get(n) === epoch) return;
  if (inFlight.has(n)) return;
  if (queue.indexOf(n) !== -1) return;
  queue.push(n);
  pump();
}

function pump() {
  while (active < MAX_PARALLEL && queue.length > 0) {
    void renderPage(queue.shift() as number);
  }
}

async function renderPage(n: number) {
  if (!doc) return;
  const mine = epoch;
  active++;
  try {
    const page = await doc.getPage(n);
    if (mine !== epoch) return;

    const css = baseScale * zoom;
    const vp = page.getViewport({ scale: css * dpr() });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const task = page.render({ canvas, canvasContext: ctx, viewport: vp });
    inFlight.set(n, task);
    await task.promise;
    if (mine !== epoch) return;

    // Unsichtbare Textebene ueber dem Bild: macht Markieren, Kopieren
    // und Suchen moeglich, ohne dass man sie sieht.
    const layer = document.createElement("div");
    layer.className = "textLayer";
    layer.style.setProperty("--scale-factor", String(css));
    layer.style.setProperty("--total-scale-factor", String(css));
    const tl = new pdfjsLib.TextLayer({
      textContentSource: await page.getTextContent(),
      container: layer,
      viewport: page.getViewport({ scale: css }),
    });
    await tl.render();
    if (mine !== epoch) return;

    // Erst hier tauschen: die alte Zeichnung bleibt bis zuletzt stehen.
    const host = pageEls[n - 1];
    host.replaceChildren(canvas, layer);
    host.classList.add("ready");
    renderedAt.set(n, mine);
    if (query) schedulePaint();
  } catch {
    /* abgebrochen oder Skala veraltet */
  } finally {
    inFlight.delete(n);
    active--;
    pump();
  }
}

function invalidate() {
  epoch++;
  for (const t of inFlight.values()) t.cancel();
  queue.length = 0;
}

// ---------- Textindex und Treffer ----------

async function buildIndex() {
  if (!doc || indexing) return;
  if (indexed === doc.numPages) return;
  indexing = true;
  const total = doc.numPages;
  try {
    for (let n = indexed + 1; n <= total; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      pageText[n - 1] = tc.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .toLowerCase();
      indexed = n;
      // Alle 20 Seiten den Faden abgeben, damit Scrollen nicht einfriert.
      if (n % 20 === 0) {
        findCount.textContent = "indexiere " + n + "/" + total;
        await new Promise((r) => setTimeout(r, 0));
        if (!doc) return;
      }
    }
  } finally {
    indexing = false;
  }
}

function computeMatches() {
  matches = [];
  const q = query.toLowerCase();
  if (!q) return;
  for (let i = 0; i < pageText.length; i++) {
    const t = pageText[i];
    if (!t) continue;
    let from = 0;
    for (;;) {
      const at = t.indexOf(q, from);
      if (at === -1) break;
      matches.push({ page: i + 1, idx: at });
      from = at + q.length;
    }
  }
}

function setFindLabel() {
  if (!query) { findCount.textContent = ""; return; }
  if (matches.length === 0) {
    findCount.textContent = indexing ? "sucht …" : "kein Treffer";
    return;
  }
  findCount.textContent = matchPos + 1 + " / " + matches.length;
}

let paintTimer = 0;
function schedulePaint() {
  window.clearTimeout(paintTimer);
  paintTimer = window.setTimeout(paintHighlights, 40);
}

function paintHighlights() {
  if (!HighlightCtor || !highlightRegistry) return;
  highlightRegistry.delete("folio-find");
  const q = query.toLowerCase();
  if (!q) return;
  const ranges: Range[] = [];
  for (const n of nearPages(400)) {
    const layer = pageEls[n - 1]?.querySelector(".textLayer");
    if (!layer) continue;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const t = (node.textContent ?? "").toLowerCase();
      let from = 0;
      for (;;) {
        const at = t.indexOf(q, from);
        if (at === -1) break;
        const r = document.createRange();
        r.setStart(node, at);
        r.setEnd(node, at + q.length);
        ranges.push(r);
        from = at + q.length;
      }
      node = walker.nextNode();
    }
  }
  highlightRegistry.set("folio-find", new HighlightCtor(...ranges));
}

function gotoMatch(delta: number) {
  if (matches.length === 0) { setFindLabel(); return; }
  matchPos = (matchPos + delta + matches.length) % matches.length;
  const m = matches[matchPos];
  const el = pageEls[m.page - 1];
  if (el) viewer.scrollTop = el.offsetTop - 24;
  setFindLabel();
  for (const n of nearPages(NEAR)) want(n);
  schedulePaint();
}

let findTimer = 0;
function onFindInput() {
  window.clearTimeout(findTimer);
  findTimer = window.setTimeout(async () => {
    query = findInput.value.trim();
    if (!query) {
      matches = [];
      matchPos = -1;
      setFindLabel();
      paintHighlights();
      return;
    }
    setFindLabel();
    await buildIndex();
    query = findInput.value.trim(); // kann sich waehrend des Indexierens geaendert haben
    computeMatches();
    matchPos = -1;
    // beim naechsten Treffer ab der aktuellen Seite einsteigen
    const start = matches.findIndex((m) => m.page >= current);
    matchPos = start === -1 ? -1 : start - 1;
    gotoMatch(1);
  }, 220);
}

function openFind() {
  findbar.hidden = false;
  findInput.select();
  findInput.focus();
}

function closeFind() {
  findbar.hidden = true;
  query = "";
  matches = [];
  matchPos = -1;
  findCount.textContent = "";
  paintHighlights();
}

btnFind.addEventListener("click", openFind);
findClose.addEventListener("click", closeFind);
findNext.addEventListener("click", () => gotoMatch(1));
findPrev.addEventListener("click", () => gotoMatch(-1));
findInput.addEventListener("input", onFindInput);
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});

// ---------- Scrollen ----------

let ticking = false;
viewer.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!doc) return;
      const top = viewer.scrollTop + 40;
      for (let i = 0; i < pageEls.length; i++) {
        const el = pageEls[i];
        if (el.offsetTop + el.offsetHeight > top) {
          if (current !== i + 1) { current = i + 1; setPageLabel(); }
          break;
        }
      }
      for (const n of nearPages(NEAR)) want(n);
      prune();
      if (query) schedulePaint();
    });
  },
  { passive: true }
);

// ---------- Laden ----------

async function loadBytes(bytes: Uint8Array, name: string) {
  if (loadTask) {
    invalidate();
    await loadTask.destroy();
  }
  loadTask = pdfjsLib.getDocument({ data: bytes });
  doc = await loadTask.promise;

  drop.style.display = "none";
  fileLabel.textContent = name;
  renderedAt.clear();
  queue.length = 0;

  pageText = new Array(doc.numPages).fill("");
  indexed = 0;
  matches = [];
  matchPos = -1;
  if (query) { findInput.value = ""; query = ""; }
  paintHighlights();

  sizes = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height });
  }

  pageEls = [];
  const frag = document.createDocumentFragment();
  for (let n = 1; n <= doc.numPages; n++) {
    const el = document.createElement("div");
    el.className = "page";
    el.dataset.page = String(n);
    pageEls.push(el);
    frag.appendChild(el);
  }
  viewer.replaceChildren(frag);

  baseScale = (viewer.clientWidth - PAD) / sizes[0].w;
  zoom = 1;
  epoch++;
  current = 1;
  setZoomLabel();
  setPageLabel();
  applySizes();
  viewer.scrollTop = 0;
  for (const n of nearPages(NEAR)) want(n);
}

// ---------- Zoom ----------

let zoomTimer = 0;
function setZoom(next: number) {
  if (!doc) return;
  const z = clamp(next);
  if (Math.abs(z - zoom) < 0.001) return;

  const anchor =
    (viewer.scrollTop + viewer.clientHeight / 2) / Math.max(1, viewer.scrollHeight);

  zoom = z;
  setZoomLabel();
  applySizes(); // alte Zeichnung wird per CSS mitskaliert: kurz unscharf, nie leer
  viewer.scrollTop = anchor * viewer.scrollHeight - viewer.clientHeight / 2;

  invalidate();
  window.clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => {
    for (const n of nearPages(NEAR)) want(n);
  }, 90);
}

// ---------- Datei oeffnen ----------

async function openPath(path: string) {
  try {
    const buf = await invoke<ArrayBuffer>("read_pdf", { path });
    const name = path.split(/[\\/]/).pop() ?? path;
    await loadBytes(new Uint8Array(buf), name);
  } catch (err) {
    fileLabel.textContent = "Konnte nicht geöffnet werden: " + String(err);
  }
}

async function pick() {
  const sel = await openDialog({
    multiple: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (typeof sel === "string") await openPath(sel);
}

btnOpen.addEventListener("click", () => void pick());
btnIn.addEventListener("click", () => setZoom(zoom * 1.25));
btnOut.addEventListener("click", () => setZoom(zoom / 1.25));
btnReset.addEventListener("click", () => setZoom(1));
btnInvert.addEventListener("click", () => {
  viewer.classList.toggle("invert");
  btnInvert.classList.toggle("on");
});

// ---------- Tastatur ----------

window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === "o") { e.preventDefault(); void pick(); }
  else if (ctrl && k === "f") { e.preventDefault(); openFind(); }
  else if (ctrl && k === "i") { e.preventDefault(); btnInvert.click(); }
  else if (ctrl && (e.key === "+" || e.key === "=")) { e.preventDefault(); setZoom(zoom * 1.25); }
  else if (ctrl && e.key === "-") { e.preventDefault(); setZoom(zoom / 1.25); }
  else if (ctrl && e.key === "0") { e.preventDefault(); setZoom(1); }
  else if (e.key === "F3") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
  else if (e.key === "Escape" && !findbar.hidden) { e.preventDefault(); closeFind(); }
});

viewer.addEventListener(
  "wheel",
  (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  },
  { passive: false }
);

let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (!doc || sizes.length === 0) return;
    baseScale = (viewer.clientWidth - PAD) / sizes[0].w;
    applySizes();
    invalidate();
    for (const n of nearPages(NEAR)) want(n);
  }, 150);
});

// ---------- Dateien von aussen ----------

void getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type === "over") viewer.classList.add("dragover");
  else if (e.payload.type === "leave") viewer.classList.remove("dragover");
  else if (e.payload.type === "drop") {
    viewer.classList.remove("dragover");
    const p = e.payload.paths.find((x) => x.toLowerCase().endsWith(".pdf"));
    if (p) void openPath(p);
  }
});

// Zweiter Programmstart reicht seinen Pfad an diese Instanz weiter.
void listen<string>("folio://open", (e) => {
  if (e.payload) void openPath(e.payload);
});

void invoke<string | null>("startup_file").then((p) => {
  if (p) void openPath(p);
});
