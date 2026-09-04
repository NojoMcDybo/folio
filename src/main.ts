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
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const EditorType = pdfjsLib.AnnotationEditorType;
const EditorParams = pdfjsLib.AnnotationEditorParamsType;

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
const toast = $<HTMLElement>("toast");

// ---------- Symbole ----------
// Strichzeichnungen, 24er-Raster, erben die Farbe vom Knopf.

const P = (d: string, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

const ICON: Record<string, string> = {
  "b-home": P('<path d="M4 6h6v12H4z"/><path d="M14 6h6v12h-6z"/>'),
  "t-none": P('<path d="M5 3l14 8-6 1.6L10 19z"/>'),
  "t-mark": P('<path d="M4 20h5"/><path d="m9 16 8.5-8.5a2.1 2.1 0 0 0-3-3L6 13v3h3z"/>'),
  "t-ink": P('<path d="M3 20c3-1 4-6 7-6s3 3 5 3 4-3 6-9"/>'),
  "t-text": P('<path d="M5 6h14"/><path d="M12 6v13"/>'),
  "b-find": P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  "b-invert": P('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>'),
  "b-save": P('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/>'),
  "find-prev": P('<path d="m7 14 5-5 5 5"/>'),
  "find-next": P('<path d="m7 10 5 5 5-5"/>'),
  "find-close": P('<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>'),
};

for (const [id, svg] of Object.entries(ICON)) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = svg;
}

const PLUS = P('<path d="M12 5v14"/><path d="M5 12h14"/>');

// ---------- Zuletzt geoeffnet ----------

type Recent = {
  path: string;
  name: string;
  thumb: string;
  page: number;
  pages: number;
  at: number;
};

const KEY = "folio.recents";
const MAX_RECENTS = 23;

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
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    // Speicher voll: aeltestes Deckelbild opfern und erneut versuchen.
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 10)));
    } catch { /* aufgeben, Liste ist nicht kritisch */ }
  }
}

function touchRecent(patch: Partial<Recent> & { path: string }) {
  const list = loadRecents();
  const i = list.findIndex((r) => r.path === patch.path);
  const base: Recent =
    i === -1
      ? { path: patch.path, name: "", thumb: "", page: 1, pages: 1, at: 0 }
      : list[i];
  const next = { ...base, ...patch, at: Date.now() };
  if (i !== -1) list.splice(i, 1);
  list.unshift(next);
  saveRecents(list);
}

// ---------- Startseite ----------

function renderHome() {
  grid.replaceChildren();

  const drop = document.createElement("button");
  drop.className = "tile drop";
  drop.title = "PDF öffnen oder hierher ziehen";
  drop.innerHTML = `<span class="cover">${PLUS}</span><span class="name"></span>`;
  drop.addEventListener("click", () => void pick());
  grid.appendChild(drop);

  const list = loadRecents();
  list.forEach((r, i) => {
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
}

// ---------- PDF.js-Komponenten ----------

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });

/** Wir liefern keine Sprachdateien aus. Der Stellvertreter antwortet auf
 *  jede Methode still, statt PDF.js beim ersten Aufruf krachen zu lassen. */
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

let chipTimer = 0;
function flashChip(text: string) {
  pagechip.textContent = text;
  pagechip.classList.add("show");
  window.clearTimeout(chipTimer);
  chipTimer = window.setTimeout(() => pagechip.classList.remove("show"), 1500);
}

let toastTimer = 0;
function say(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4000);
}

/** Passbreite mit schmalem schwarzem Rand ringsum. PDF.js kennt nur
 *  "ganze Breite", deshalb danach um genau den Rand herunterskalieren. */
const FRAME = 14;
function fitWidth() {
  if (!pdfViewer.pdfDocument) return;
  pdfViewer.currentScaleValue = "page-width";
  const w = container.clientWidth;
  if (w > FRAME * 2) pdfViewer.currentScale *= (w - FRAME * 2) / w;
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(fitWidth, 160);
});

eventBus.on("pagesinit", () => {
  fitWidth();
  if (pendingPage > 1 && pendingPage <= pdfViewer.pagesCount) {
    pdfViewer.currentPageNumber = pendingPage;
  }
  flashChip(pdfViewer.currentPageNumber + " / " + pdfViewer.pagesCount);
});

eventBus.on("pagechanging", (e: { pageNumber: number }) => {
  flashChip(e.pageNumber + " / " + pdfViewer.pagesCount);
  if (currentPath) {
    touchRecent({ path: currentPath, page: e.pageNumber, pages: pdfViewer.pagesCount });
  }
});

function markDirty(state: boolean) {
  dirty = state;
  btnSave.disabled = !state;
}

// ---------- Laden ----------

/** Deckelbild aus der ersten Seite. Klein genug, dass zwanzig davon
 *  bequem in den lokalen Speicher passen. */
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

function showReader() {
  home.hidden = true;
  reader.hidden = false;
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
    showReader();

    const thumb = known?.thumb || (await makeThumb(doc));
    touchRecent({ path, name, thumb, pages: doc.numPages, page: pendingPage });
  } catch (err) {
    say("Konnte nicht geöffnet werden: " + String(err));
  }
}

async function pick() {
  const sel = await openDialog({
    multiple: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
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
    // saveDocument schreibt die Annotationen als echte PDF-Objekte zurueck.
    const bytes: Uint8Array = await pdfViewer.pdfDocument.saveDocument();
    // Rohbytes im Koerper, Pfad hex-kodiert im Kopf: Kopfzeilen
    // vertragen keine Umlaute.
    await invoke("save_pdf", bytes, { headers: { "x-path": hex(currentPath) } });
    pdfViewer.pdfDocument.annotationStorage.resetModified();
    markDirty(false);
    // Deckelbild auffrischen, damit die Markierung auf der Kachel sichtbar wird.
    const thumb = await makeThumb(pdfViewer.pdfDocument);
    if (thumb) touchRecent({ path: currentPath, thumb });
  } catch (err) {
    markDirty(true);
    say("Sichern fehlgeschlagen: " + String(err));
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
  none: $<HTMLButtonElement>("t-none"),
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
  try {
    pdfViewer.annotationEditorMode = { mode: TOOL_MODE[next] };
  } catch { /* Editor noch nicht bereit */ }
  if (next !== "none") applyColor();
}

/** PDF.js schaltet den Modus manchmal selbst um, etwa nach Escape. */
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
  eventBus.dispatch("switchannotationeditorparams", {
    source: window,
    type,
    value: colorInput.value,
  });
}

for (const [key, btn] of Object.entries(toolBtn)) {
  btn.addEventListener("click", () => setTool(key));
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
});

container.addEventListener(
  "wheel",
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || !pdfViewer.pdfDocument) return;
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    pdfViewer.currentScale = Math.min(6, Math.max(0.25, pdfViewer.currentScale * f));
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
    e.target instanceof HTMLElement &&
    (e.target.tagName === "INPUT" || e.target.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (e.key === "F11") {
    e.preventDefault();
    document.body.classList.toggle("bare");
    return;
  }
  if (reader.hidden) {
    if (ctrl && k === "o") { e.preventDefault(); void pick(); }
    return;
  }

  if (ctrl && k === "o") { e.preventDefault(); void pick(); }
  else if (ctrl && k === "f") { e.preventDefault(); openFind(); }
  else if (ctrl && k === "s") { e.preventDefault(); void save(); }
  else if (ctrl && k === "i") { e.preventDefault(); btnInvert.click(); }
  else if (ctrl && e.key === "0") { e.preventDefault(); fitWidth(); }
  else if (e.key === "F3") { e.preventDefault(); dispatchFind(true, e.shiftKey); }
  else if (e.key === "Escape") {
    if (!findbar.hidden) { e.preventDefault(); closeFind(); }
    else if (!document.body.classList.contains("bare")) { e.preventDefault(); setTool("none"); }
  }
  else if (!ctrl && !typing) {
    if (k === "v") setTool("none");
    else if (k === "m") setTool("mark");
    else if (k === "z") setTool("ink");
    else if (k === "t") setTool("text");
  }
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

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

void listen<string>("folio://open", (e) => {
  if (e.payload) void openPath(e.payload);
});

// ---------- Start ----------

renderHome();

void invoke<string | null>("startup_file").then((p) => {
  if (p) void openPath(p);
});
