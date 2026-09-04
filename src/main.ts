import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css"; // muss nach pdf_viewer.css kommen
import { GlassLayer } from "./glass";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const EditorType = pdfjsLib.AnnotationEditorType;
const EditorParams = pdfjsLib.AnnotationEditorParamsType;

/** Anteil der Fensterbreite, den die Seite beim Oeffnen einnimmt.
 *  Eine Zahl - hier drehen, wenn es zu schmal oder zu breit wirkt. */
const OPEN_WIDTH = 0.3;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const home = $<HTMLElement>("home");
const grid = $<HTMLElement>("grid");
const reader = $<HTMLElement>("reader");
const container = $<HTMLDivElement>("container");
const pagechip = $<HTMLElement>("pagechip");
const findbar = $<HTMLElement>("findbar");
const findInput = $<HTMLInputElement>("find-q");
const findCount = $<HTMLElement>("find-count");
const colorInput = $<HTMLInputElement>("color");
const btnSave = $<HTMLButtonElement>("b-save");
const btnInvert = $<HTMLButtonElement>("b-invert");
const ann = $<HTMLElement>("ann");
const annMore = $<HTMLElement>("ann-more");
const toast = $<HTMLElement>("toast");

// ---------- Symbole ----------

const P = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICON: Record<string, string> = {
  "b-home": P('<path d="M14.5 5 8 12l6.5 7"/>'),
  "b-find": P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  "b-invert": P('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>'),
  "b-save": P('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/>'),
  "a-toggle": P('<path d="M4 20h5"/><path d="m9 16 8.5-8.5a2.1 2.1 0 0 0-3-3L6 13v3h3z"/>'),
  "t-mark": P('<path d="M4 20h16"/><path d="M6.5 16 15 7.5a2 2 0 0 1 3 3L9.5 19H6.5z" fill="currentColor" fill-opacity=".2"/>'),
  "t-ink": P('<path d="M3 20c3-1 4-6 7-6s3 3 5 3 4-3 6-9"/>'),
  "t-text": P('<path d="M5 6h14"/><path d="M12 6v13"/>'),
  "find-prev": P('<path d="m7 14 5-5 5 5"/>'),
  "find-next": P('<path d="m7 10 5 5 5-5"/>'),
  "find-close": P('<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>'),
  "w-min": P('<path d="M6 12h12"/>'),
  "w-max": P('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'),
  "w-close": P('<path d="M7 7l10 10"/><path d="M17 7L7 17"/>'),
};

for (const [id, svg] of Object.entries(ICON)) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = svg;
}

const PLUS = P('<path d="M12 5v14"/><path d="M5 12h14"/>');

// ---------- Fensterknoepfe ----------

const win = getCurrentWindow();
$<HTMLButtonElement>("w-min").addEventListener("click", () => void win.minimize());
$<HTMLButtonElement>("w-max").addEventListener("click", () => void win.toggleMaximize());
$<HTMLButtonElement>("w-close").addEventListener("click", () => void win.close());

// ---------- Zuletzt geoeffnet ----------

type Recent = { path: string; name: string; thumb: string; page: number; pages: number; at: number };

const KEY = "folio.recents";

function loadRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Recent[]) : [];
  } catch {
    return [];
  }
}

function saveRecents(list: Recent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 23)));
  } catch {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 10))); } catch { /* egal */ }
  }
}

function touchRecent(patch: Partial<Recent> & { path: string }) {
  const list = loadRecents();
  const i = list.findIndex((r) => r.path === patch.path);
  const base: Recent =
    i === -1 ? { path: patch.path, name: "", thumb: "", page: 1, pages: 1, at: 0 } : list[i];
  const next = { ...base, ...patch, at: Date.now() };
  if (i !== -1) list.splice(i, 1);
  list.unshift(next);
  saveRecents(list);
}

// ---------- Bibliothek ----------

function renderHome() {
  grid.replaceChildren();

  const drop = document.createElement("button");
  drop.className = "tile drop";
  drop.title = "PDF öffnen oder hierher ziehen";
  drop.innerHTML = `<span class="cover">${PLUS}</span><span class="name"></span>`;
  drop.addEventListener("click", () => void pick());
  grid.appendChild(drop);

  loadRecents().forEach((r, i) => {
    const t = document.createElement("button");
    t.className = "tile";
    t.title = r.path;
    t.style.animationDelay = Math.min(i * 22, 260) + "ms";

    const cover = document.createElement("span");
    cover.className = "cover";
    if (r.thumb) {
      const img = document.createElement("img");
      img.src = r.thumb;
      img.alt = "";
      img.addEventListener("load", () => glass?.invalidate());
      cover.appendChild(img);
    }
    if (r.pages > 1 && r.page > 1) {
      const bar = document.createElement("span");
      bar.className = "bar";
      bar.style.width = Math.round((r.page / r.pages) * 100) + "%";
      cover.appendChild(bar);
    }

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.name.replace(/\.pdf$/i, "");

    t.append(cover, name);
    t.addEventListener("click", () => void openPath(r.path));
    grid.appendChild(t);
  });
  glass?.invalidate();
}

// ---------- Glasschicht ----------

/** Malt, was hinter dem Glas liegt. Im Leser sind das die Seiten-Canvas,
 *  in der Bibliothek der Grund samt Deckelbildern. */
function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const k = w / Math.max(1, window.innerWidth);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";

  if (!reader.hidden) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (container.classList.contains("invert")) {
      ctx.filter = "contrast(0.8) invert(1) hue-rotate(180deg)";
    }
    for (const cv of container.querySelectorAll("canvas")) {
      const r = cv.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.width < 2) continue;
      try { ctx.drawImage(cv, r.x * k, r.y * k, r.width * k, r.height * k); } catch { /* leer */ }
    }
    ctx.filter = "none";
    return;
  }

  ctx.fillStyle = "#08080a";
  ctx.fillRect(0, 0, w, h);
  const g1 = ctx.createRadialGradient(w * 0.22, -h * 0.12, 0, w * 0.22, -h * 0.12, w * 0.75);
  g1.addColorStop(0, "#1c1c22");
  g1.addColorStop(1, "rgba(28,28,34,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);
  for (const img of grid.querySelectorAll("img")) {
    const r = img.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    try { ctx.drawImage(img, r.x * k, r.y * k, r.width * k, r.height * k); } catch { /* leer */ }
  }
}

let glass: GlassLayer | null = null;
try {
  glass = new GlassLayer($<HTMLCanvasElement>("glasslayer"));
  glass.setPainter(paintBackdrop);
} catch {
  document.body.classList.add("no-gl");
}

// ---------- PDF.js ----------

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });

/** Wir liefern keine Sprachdateien aus; der Stellvertreter antwortet still. */
const l10n = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "getLanguage") return () => "de";
      if (prop === "getDirection") return () => "ltr";
      if (prop === "get" || prop === "formatMessages") {
        return async (ids: unknown, _a?: unknown, fb?: string) =>
          Array.isArray(ids) ? ids.map(() => "") : (fb ?? "");
      }
      return () => undefined;
    },
  }
);

const pdfViewer = new PDFViewer({
  container,
  viewer: $<HTMLDivElement>("viewer"),
  eventBus,
  linkService,
  findController,
  l10n,
  annotationEditorMode: EditorType.NONE,
  removePageBorders: true,
  enableHighlightFloatingButton: true,
});
linkService.setViewer(pdfViewer);

let currentPath: string | null = null;
let pendingPage = 1;
let dirty = false;

function fitOpen() {
  if (!pdfViewer.pdfDocument) return;
  pdfViewer.currentScaleValue = "page-width";
  pdfViewer.currentScale *= OPEN_WIDTH;
}

let chipTimer = 0;
function flashChip(text: string) {
  pagechip.textContent = text;
  pagechip.classList.add("show");
  window.clearTimeout(chipTimer);
  chipTimer = window.setTimeout(() => pagechip.classList.remove("show"), 1600);
}

let toastTimer = 0;
function say(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4000);
}

function markDirty(state: boolean) {
  dirty = state;
  btnSave.hidden = !state;
}

eventBus.on("pagesinit", () => {
  fitOpen();
  if (pendingPage > 1 && pendingPage <= pdfViewer.pagesCount) {
    pdfViewer.currentPageNumber = pendingPage;
  } else {
    // PDF.js scrollt beim Aufbau auf Seite 1 und frisst damit die Luecke
    // oben. Wieder ganz nach oben, damit sie beim Oeffnen zu sehen ist.
    requestAnimationFrame(() => { container.scrollTop = 0; glass?.invalidate(); });
  }
  flashChip(pdfViewer.currentPageNumber + " / " + pdfViewer.pagesCount);
  glass?.invalidate();
});

eventBus.on("pagechanging", (e: { pageNumber: number }) => {
  flashChip(e.pageNumber + " / " + pdfViewer.pagesCount);
  if (currentPath) {
    touchRecent({ path: currentPath, page: e.pageNumber, pages: pdfViewer.pagesCount });
  }
});

eventBus.on("pagerendered", () => glass?.invalidate());
eventBus.on("scalechanging", () => glass?.invalidate());
container.addEventListener("scroll", () => glass?.invalidate(), { passive: true });
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { fitOpen(); glass?.invalidate(); }, 160);
});
let resizeTimer = 0;

// ---------- Laden ----------

async function makeThumb(doc: pdfjsLib.PDFDocumentProxy): Promise<string> {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 340 / base.width });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) return "";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}

function showHome() {
  reader.hidden = true;
  home.hidden = false;
  renderHome();
}

async function openPath(path: string) {
  try {
    const buf = await invoke<ArrayBuffer>("read_pdf", { path });
    const name = path.split(/[\\/]/).pop() ?? path;
    const known = loadRecents().find((r) => r.path === path);
    pendingPage = known?.page ?? 1;

    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    pdfViewer.setDocument(doc);
    linkService.setDocument(doc, null);

    const storage = doc.annotationStorage as unknown as {
      onSetModified: (() => void) | null;
      onResetModified: (() => void) | null;
    };
    storage.onSetModified = () => markDirty(true);
    storage.onResetModified = () => markDirty(false);

    currentPath = path;
    markDirty(false);
    setTool("none");
    closeAnn();
    home.hidden = true;
    reader.hidden = false;
    glass?.invalidate();

    const thumb = known?.thumb || (await makeThumb(doc));
    touchRecent({ path, name, thumb, pages: doc.numPages, page: pendingPage });
  } catch (err) {
    say("Konnte nicht geöffnet werden: " + String(err));
  }
}

async function pick() {
  const sel = await openDialog({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (typeof sel === "string") await openPath(sel);
}

// ---------- Sichern ----------

const hex = (s: string) =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function save() {
  if (!currentPath || !pdfViewer.pdfDocument || !dirty) return;
  btnSave.disabled = true;
  try {
    const bytes: Uint8Array = await pdfViewer.pdfDocument.saveDocument();
    await invoke("save_pdf", bytes, { headers: { "x-path": hex(currentPath) } });
    pdfViewer.pdfDocument.annotationStorage.resetModified();
    markDirty(false);
    const thumb = await makeThumb(pdfViewer.pdfDocument);
    if (thumb) touchRecent({ path: currentPath, thumb });
  } catch (err) {
    say("Sichern fehlgeschlagen: " + String(err));
  } finally {
    btnSave.disabled = false;
  }
}

// ---------- Werkzeuge ----------

const TOOL_MODE: Record<string, number> = {
  none: EditorType.NONE,
  mark: EditorType.HIGHLIGHT,
  ink: EditorType.INK,
  text: EditorType.FREETEXT,
};

const toolBtn: Record<string, HTMLButtonElement> = {
  mark: $<HTMLButtonElement>("t-mark"),
  ink: $<HTMLButtonElement>("t-ink"),
  text: $<HTMLButtonElement>("t-text"),
};

let tool = "none";

function paintTool(key: string) {
  for (const [k, b] of Object.entries(toolBtn)) b.classList.toggle("on", k === key);
}

function setTool(next: string) {
  tool = next;
  paintTool(next);
  if (!pdfViewer.pdfDocument) return;
  // "switchannotationeditormode" wird von PDF.js nur gesendet, nicht
  // empfangen - das Umschalten laeuft ueber diesen Setter.
  try { pdfViewer.annotationEditorMode = { mode: TOOL_MODE[next] }; } catch { /* noch nicht bereit */ }
  if (next !== "none") applyColor();
}

eventBus.on("switchannotationeditormode", (e: { mode: number }) => {
  const key = Object.keys(TOOL_MODE).find((k) => TOOL_MODE[k] === e.mode);
  if (key && key !== tool) { tool = key; paintTool(key); }
});

function applyColor() {
  const type =
    tool === "mark" ? EditorParams.HIGHLIGHT_COLOR
    : tool === "ink" ? EditorParams.INK_COLOR
    : tool === "text" ? EditorParams.FREETEXT_COLOR
    : null;
  if (type === null) return;
  eventBus.dispatch("switchannotationeditorparams", { source: window, type, value: colorInput.value });
}

/** Die Palette faehrt aus dem einen Knopf heraus. Breite wird gemessen,
 *  damit die Federbewegung stimmt, egal wie viele Werkzeuge drin sind. */
function openAnn() {
  ann.classList.add("open");
  annMore.style.width = annMore.scrollWidth + "px";
}

function closeAnn() {
  ann.classList.remove("open");
  annMore.style.width = "0px";
  if (tool !== "none") setTool("none");
}

$<HTMLButtonElement>("a-toggle").addEventListener("click", () => {
  if (ann.classList.contains("open")) closeAnn();
  else { openAnn(); setTool("mark"); }
});

for (const [key, btn] of Object.entries(toolBtn)) {
  btn.addEventListener("click", () => setTool(tool === key ? "none" : key));
}
colorInput.addEventListener("input", applyColor);

btnSave.addEventListener("click", () => void save());

$<HTMLButtonElement>("b-home").addEventListener("click", () => {
  if (dirty) { say("Ungesicherte Markierungen — Strg+S"); return; }
  showHome();
});

btnInvert.addEventListener("click", () => {
  container.classList.toggle("invert");
  btnInvert.classList.toggle("on");
  glass?.invalidate();
});

container.addEventListener(
  "wheel",
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || !pdfViewer.pdfDocument) return;
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    pdfViewer.currentScale = Math.min(6, Math.max(0.1, pdfViewer.currentScale * f));
    flashChip(Math.round(pdfViewer.currentScale * 100) + " %");
  },
  { passive: false }
);

// ---------- Suche ----------

function dispatchFind(again: boolean, previous = false) {
  eventBus.dispatch("find", {
    source: window,
    type: again ? "again" : "",
    query: findInput.value,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: previous,
    matchDiacritics: false,
  });
}

function showCount(m?: { current: number; total: number }) {
  if (!findInput.value) { findCount.textContent = ""; return; }
  const { current, total } = m ?? { current: 0, total: 0 };
  findCount.textContent = total ? current + " / " + total : "0";
}

eventBus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) =>
  showCount(e.matchesCount)
);
eventBus.on("updatefindcontrolstate", (e: { matchesCount: { current: number; total: number } }) =>
  showCount(e.matchesCount)
);

let findTimer = 0;
findInput.addEventListener("input", () => {
  window.clearTimeout(findTimer);
  findTimer = window.setTimeout(() => dispatchFind(false), 200);
});

findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); dispatchFind(true, e.shiftKey); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});

function openFind() {
  findbar.hidden = false;
  findInput.select();
  findInput.focus();
}

function closeFind() {
  findbar.hidden = true;
  findInput.value = "";
  findCount.textContent = "";
  dispatchFind(false);
}

$<HTMLButtonElement>("b-find").addEventListener("click", openFind);
$<HTMLButtonElement>("find-close").addEventListener("click", closeFind);
$<HTMLButtonElement>("find-next").addEventListener("click", () => dispatchFind(true));
$<HTMLButtonElement>("find-prev").addEventListener("click", () => dispatchFind(true, true));

// ---------- Tastatur ----------

window.addEventListener("keydown", (e) => {
  const typing =
    e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (e.key === "F11") { e.preventDefault(); document.body.classList.toggle("bare"); return; }
  if (reader.hidden) {
    if (ctrl && k === "o") { e.preventDefault(); void pick(); }
    return;
  }

  if (ctrl && k === "o") { e.preventDefault(); void pick(); }
  else if (ctrl && k === "f") { e.preventDefault(); openFind(); }
  else if (ctrl && k === "s") { e.preventDefault(); void save(); }
  else if (ctrl && k === "i") { e.preventDefault(); btnInvert.click(); }
  else if (ctrl && e.key === "0") { e.preventDefault(); fitOpen(); }
  else if (e.key === "F3") { e.preventDefault(); dispatchFind(true, e.shiftKey); }
  else if (e.key === "Escape") {
    if (!findbar.hidden) { e.preventDefault(); closeFind(); }
    else if (ann.classList.contains("open")) { e.preventDefault(); closeAnn(); }
  }
  else if (!ctrl && !typing) {
    if (k === "m") { openAnn(); setTool("mark"); }
    else if (k === "z") { openAnn(); setTool("ink"); }
    else if (k === "t") { openAnn(); setTool("text"); }
    else if (k === "v") setTool("none");
  }
});

window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

// ---------- Dateien von aussen ----------

void getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type === "over") document.body.classList.add("dragging");
  else if (e.payload.type === "leave") document.body.classList.remove("dragging");
  else if (e.payload.type === "drop") {
    document.body.classList.remove("dragging");
    const p = e.payload.paths.find((x) => x.toLowerCase().endsWith(".pdf"));
    if (p) void openPath(p);
  }
});

void listen<string>("folio://open", (e) => { if (e.payload) void openPath(e.payload); });

// ---------- Start ----------

renderHome();

void invoke<string | null>("startup_file").then((p) => { if (p) void openPath(p); });
