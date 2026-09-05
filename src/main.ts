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
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";

/** Die Bibliothek laeuft im Hauptfenster, jedes Dokument in einem
 *  eigenen. Welche Rolle dieses Fenster hat, steht in der Adresse. */
const DOC = new URLSearchParams(location.search).get("doc");
const IS_READER = DOC !== null;

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
const anngroup = $<HTMLElement>("anngroup");
const btnTool = $<HTMLButtonElement>("a-toggle");
const toast = $<HTMLElement>("toast");
const ask = $<HTMLElement>("ask");

// ---------- Symbole ----------

const P = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICON: Record<string, string> = {
  "b-home": P('<path d="M14.5 5 8 12l6.5 7"/>'),
  "b-find": P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  "b-invert": P('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>'),
  "b-save": P('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/>'),
  // Marker: breite Keilspitze mit Farbspur. Stift: schmale Feder.
  "t-mark": P('<path d="M4.5 20.5h15"/><path d="M8 17.5h3.5l7-7.2a2.4 2.4 0 0 0-3.4-3.4l-7.1 7.1z" fill="currentColor" fill-opacity=".35"/><path d="M8 17.5v-3.5"/>'),
  "t-ink": P('<path d="m5 19 1-3.6 9.3-9.3a1.9 1.9 0 0 1 2.7 2.7L8.6 18z"/><path d="m14.2 7.6 2.2 2.2"/><path d="M5 19h-.5"/>'),
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
$<HTMLButtonElement>("w-close").addEventListener("click", async () => {
  if (IS_READER && dirty && !(await askSave())) return;
  await win.close();
});

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
    t.addEventListener("click", () => void openDoc(r.path));
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
  // Bewusst ohne die Deckelbilder: im Glas soll sich nur Dokumentinhalt
  // spiegeln, nicht die Bibliothek.
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
  // Ohne diese Liste bleibt PDF.js' interne Farbtabelle null - ihre eigene
  // Telemetrie beim Anlegen einer Markierung greift trotzdem darauf zu und
  // wirft einen TypeError (harmlos, aber jetzt behoben). Unsere eigene
  // Farbauswahl (colorInput) ist davon unabhaengig.
  annotationEditorHighlightColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F",
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

eventBus.on("pagerendered", () => { glass?.invalidate(); paintProgress(); });
eventBus.on("scalechanging", () => { glass?.invalidate(); paintProgress(); });
container.addEventListener(
  "scroll",
  () => { glass?.invalidate(); paintProgress(); },
  { passive: true }
);
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
    refreshDrag();
    glass?.invalidate();

    const thumb = known?.thumb || (await makeThumb(doc));
    touchRecent({ path, name, thumb, pages: doc.numPages, page: pendingPage });
  } catch (err) {
    say("Konnte nicht geöffnet werden: " + String(err));
  }
}

/** Ein Fenster je Dokument. Label aus dem Pfad, damit dasselbe Dokument
 *  nicht zweimal aufgeht - dann kommt das vorhandene nach vorn. */
function labelFor(path: string) {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return "doc-" + h.toString(36);
}

async function openDoc(path: string) {
  const label = labelFor(path);
  const open = await WebviewWindow.getByLabel(label);
  if (open) {
    await open.unminimize().catch(() => {});
    await open.setFocus();
    return;
  }
  // Mehrere Dokumente sollen nicht deckungsgleich uebereinander liegen:
  // jedes weitere Fenster rueckt eine Stufe nach unten rechts.
  const W = 1180;
  const H = 900;
  const others = (await getAllWebviewWindows()).filter((x) => x.label.startsWith("doc-")).length;
  const step = 34 * (others % 7);
  const w = new WebviewWindow(label, {
    url: "index.html?doc=" + encodeURIComponent(path),
    title: path.split(/[\\/]/).pop() ?? "Folio",
    width: W,
    height: H,
    minWidth: 520,
    minHeight: 400,
    x: Math.max(0, Math.round((screen.availWidth - W) / 2) + step),
    y: Math.max(0, Math.round((screen.availHeight - H) / 2) + step),
    decorations: false,
    shadow: true,
    dragDropEnabled: true,
  });
  w.once("tauri://error", (e) => say("Fenster ging nicht auf: " + String(e.payload)));
}

async function pick() {
  const sel = await openDialog({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (typeof sel === "string") await openDoc(sel);
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

/** Werkzeug, das zuletzt gewaehlt war - der Hauptknopf zeigt es an und
 *  schaltet es an und aus, ohne dass die Maus wandern muss. */
let armed = "mark";
let tool = "none";

const TOOL_ICON: Record<string, string> = {
  mark: ICON["t-mark"],
  ink: ICON["t-ink"],
  text: ICON["t-text"],
};

function paintTool(key: string) {
  for (const [k, b] of Object.entries(toolBtn)) b.classList.toggle("on", k === key);
  btnTool.classList.toggle("on", key !== "none");
  btnTool.innerHTML = TOOL_ICON[key === "none" ? armed : key];
}

function setTool(next: string) {
  tool = next;
  if (next !== "none") armed = next;
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

function openAnn() { anngroup.classList.add("open"); }

function closeAnn() {
  anngroup.classList.remove("open");
  if (tool !== "none") setTool("none");
}

/** Hauptknopf: erster Klick oeffnet und schaltet das zuletzt benutzte
 *  Werkzeug scharf, zweiter Klick an derselben Stelle schaltet es aus. */
btnTool.addEventListener("click", () => {
  if (tool !== "none") closeAnn();
  else { openAnn(); setTool(armed); }
});

for (const [key, btn] of Object.entries(toolBtn)) {
  btn.addEventListener("click", () => setTool(tool === key ? "none" : key));
}
colorInput.addEventListener("input", applyColor);

btnSave.addEventListener("click", () => void save());

/** Rueckfrage vor dem Verlassen. Liefert true, wenn weitergegangen
 *  werden darf. */
function askSave(): Promise<boolean> {
  return new Promise((resolve) => {
    ask.hidden = false;
    const done = (v: boolean) => {
      ask.hidden = true;
      $<HTMLButtonElement>("ask-save").onclick = null;
      $<HTMLButtonElement>("ask-drop").onclick = null;
      $<HTMLButtonElement>("ask-cancel").onclick = null;
      resolve(v);
    };
    $<HTMLButtonElement>("ask-save").onclick = () => void save().then(() => done(true));
    $<HTMLButtonElement>("ask-drop").onclick = () => { markDirty(false); done(true); };
    $<HTMLButtonElement>("ask-cancel").onclick = () => done(false);
  });
}

/** Zurueck heisst hier: dieses Dokumentfenster zu, Bibliothek nach vorn. */
async function leaveReader() {
  if (dirty && !(await askSave())) return;
  const lib = await WebviewWindow.getByLabel("main");
  if (lib) {
    await lib.unminimize().catch(() => {});
    await lib.setFocus().catch(() => {});
  }
  await getCurrentWindow().close();
}

$<HTMLButtonElement>("b-home").addEventListener("click", () => void leaveReader());

btnInvert.addEventListener("click", () => {
  container.classList.toggle("invert");
  btnInvert.classList.toggle("on");
  btnInvert.classList.remove("pulse");
  void btnInvert.offsetWidth; // Neustart der Animation erzwingen
  btnInvert.classList.add("pulse");
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

const btnFind = $<HTMLButtonElement>("b-find");

// Die Suchleiste steht fuer sich: sie taucht immer oben in der Mitte auf,
// egal wohin der Suchknopf geschoben wurde. Ihre Stelle steht im CSS.
function openFind() {
  findbar.hidden = false;
  // Ausgangsstelle laesst sich erst messen, wenn die Leiste steht.
  refreshDrag();
  btnFind.classList.add("on");
  findInput.select();
  findInput.focus();
}

function closeFind() {
  findbar.hidden = true;
  btnFind.classList.remove("on");
  findInput.value = "";
  findCount.textContent = "";
  dispatchFind(false);
}

btnFind.addEventListener("click", () => (findbar.hidden ? openFind() : closeFind()));
$<HTMLButtonElement>("find-next").addEventListener("click", () => dispatchFind(true));
$<HTMLButtonElement>("find-prev").addEventListener("click", () => dispatchFind(true, true));

// ---------- Lupe ----------
// Der Suchknopf ist frei verschiebbar (makeDraggable weiter unten). Zieht
// man ihn, wird er unterwegs zu einer echten Lupe: die Mitte zeigt den
// tatsaechlich vergroesserten Seitenausschnitt, direkt aus der Seiten-
// Canvas abgetastet statt per CSS-Zoom, am Rand bleibt gewoehnliches Glas -
// dort malt GlassLayer die Kuppel wie bei jedem anderen Knopf.

const lens = $<HTMLElement>("lens");
const lensCv = $<HTMLCanvasElement>("lens-cv");
const lensCtx = lensCv.getContext("2d") as CanvasRenderingContext2D;
const LENS_ZOOM = 2.5;
const LENS_SIZE = 96; // CSS-Px der scharfen Mitte, siehe #lens-cv im CSS

function overContainer(x: number, y: number) {
  const r = container.getBoundingClientRect();
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function paintLens(x: number, y: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(LENS_SIZE * dpr);
  if (lensCv.width !== size) { lensCv.width = size; lensCv.height = size; }
  lensCtx.clearRect(0, 0, size, size);

  const pages = container.querySelectorAll<HTMLCanvasElement>(".pdfViewer .canvasWrapper canvas");
  for (const cv of pages) {
    const r = cv.getBoundingClientRect();
    if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
    const sx = ((x - r.x) / r.width) * cv.width;
    const sy = ((y - r.y) / r.height) * cv.height;
    const sw = (LENS_SIZE / LENS_ZOOM) * (cv.width / r.width);
    const sh = (LENS_SIZE / LENS_ZOOM) * (cv.height / r.height);
    lensCtx.drawImage(cv, sx - sw / 2, sy - sh / 2, sw, sh, 0, 0, size, size);
    break;
  }

  // Invertiert-Modus faerbt die Seiten-Canvas per CSS-Filter um - sonst
  // zeigt die Lupe die falschen Farben.
  lensCv.style.filter = container.classList.contains("invert")
    ? "contrast(0.8) invert(1) hue-rotate(180deg)"
    : "";
}

btnFind.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  let lensing = false;

  const onMove = (ev: PointerEvent) => {
    if (overContainer(ev.clientX, ev.clientY)) {
      lensing = true;
      lens.style.left = ev.clientX + "px";
      lens.style.top = ev.clientY + "px";
      lens.hidden = false;
      btnFind.classList.add("lens-hidden");
      paintLens(ev.clientX, ev.clientY);
    } else if (lensing) {
      lensing = false;
      lens.hidden = true;
      btnFind.classList.remove("lens-hidden");
    }
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    lens.hidden = true;
    btnFind.classList.remove("lens-hidden");
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
});

// ---------- Bildlaufleiste ----------

const scroller = $<HTMLElement>("scroller");

/** Fuellstand ist der Lesefortschritt, das macht der Shader zu Licht.
 *  Zusaetzlich wandert der Griff selbst am rechten Rand entlang wie bei
 *  einer normalen Bildlaufleiste, statt fest in der Bildschirmmitte zu
 *  kleben - die Ruheposition ist also nicht feststehend, sondern haengt
 *  direkt vom Scrollfortschritt ab. */
function paintProgress() {
  const max = container.scrollHeight - container.clientHeight;
  const p = max > 4 ? container.scrollTop / max : 0;
  scroller.dataset.fill = String(Math.min(1, Math.max(0.004, p)));
  scroller.style.setProperty("--scroller-p", String(Math.min(1, Math.max(0, p))));
}

/** Fuenf unsichtbare Felder von oben nach unten: schnell hoch, langsam
 *  hoch (Lesetempo), Ruhe, langsam runter (Lesetempo), schnell runter
 *  (Ueberfliegen). Nur per Hover erreichbar. */
const SPEED = [-1600, -150, 0, 150, 1600];
let zone = 2;
let autoId = 0;
let lastTick = 0;
let dragging = false;

function tick(t: number) {
  const dt = lastTick ? Math.min(0.05, (t - lastTick) / 1000) : 0;
  lastTick = t;
  if (SPEED[zone]) container.scrollTop += SPEED[zone] * dt;
  autoId = requestAnimationFrame(tick);
}

function startAuto() {
  lastTick = 0;
  if (!autoId) autoId = requestAnimationFrame(tick);
}

function stopAuto() {
  if (autoId) cancelAnimationFrame(autoId);
  autoId = 0;
  zone = 2;
}

let wideTimer = 0;
let leaveTimer = 0;

scroller.addEventListener("pointerenter", () => {
  window.clearTimeout(wideTimer);
  window.clearTimeout(leaveTimer);
  // Erst nach einer Sekunde Verweilen - sonst schnappt der Stab zu, wenn
  // die Maus nur vorbeizieht.
  wideTimer = window.setTimeout(() => {
    scroller.classList.add("wide");
    startAuto();
  }, 1000);
});

scroller.addEventListener("pointerleave", () => {
  if (dragging) return;
  window.clearTimeout(wideTimer);
  window.clearTimeout(leaveTimer);
  // Noch eine Sekunde stehen lassen - wer nur kurz danebengreift, soll
  // nicht sofort aus dem Scrollfeld fallen.
  leaveTimer = window.setTimeout(() => {
    scroller.classList.remove("wide");
    stopAuto();
  }, 1000);
});

scroller.addEventListener("pointermove", (e) => {
  if (!scroller.classList.contains("wide") || dragging) return;
  const r = scroller.getBoundingClientRect();
  const t = (e.clientY - r.y) / Math.max(1, r.height);
  zone = Math.min(4, Math.max(0, Math.floor(t * 5)));
});

// Deckt sich mit dem Rand in styles.css (#scroller top: calc(...)).
const TRACK_MARGIN = 64;

/** Ziehen setzt die Leseposition direkt, wie bei einer echten
 *  Bildlaufleiste: die Stelle im Fenster ist die Stelle im Dokument. */
function scrubTo(e: PointerEvent) {
  const usable = Math.max(1, window.innerHeight - TRACK_MARGIN * 2);
  const t = Math.min(1, Math.max(0, (e.clientY - TRACK_MARGIN) / usable));
  const max = container.scrollHeight - container.clientHeight;
  container.scrollTop = t * max;
}

scroller.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  window.clearTimeout(wideTimer);
  scroller.classList.remove("wide");
  stopAuto();
  scroller.classList.add("dragging");
  scroller.setPointerCapture(e.pointerId);
  scrubTo(e);
});

window.addEventListener("pointermove", (e) => {
  if (dragging) scrubTo(e);
});

function endDrag(e: PointerEvent) {
  if (!dragging) return;
  dragging = false;
  scroller.classList.remove("dragging");
  try { scroller.releasePointerCapture(e.pointerId); } catch { /* schon los */ }
}

window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

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
    else if (anngroup.classList.contains("open")) { e.preventDefault(); closeAnn(); }
  }
  else if (!ctrl && !typing) {
    if (k === "m") { openAnn(); setTool("mark"); }
    else if (k === "z") { openAnn(); setTool("ink"); }
    else if (k === "t") { openAnn(); setTool("text"); }
    else if (k === "v") setTool("none");
  }
});

window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

// ---------- Verschiebbare Knoepfe ----------

const POSKEY = "folio.pos";
const SNAP = 90; // Umkreis, in dem der Knopf auf die Ausgangsstelle zurueckspringt
const refreshers: (() => void)[] = [];

function loadPos(): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(POSKEY) ?? "{}"); } catch { return {}; }
}

function savePos(p: Record<string, { x: number; y: number }>) {
  try { localStorage.setItem(POSKEY, JSON.stringify(p)); } catch { /* egal */ }
}

function makeDraggable(el: HTMLElement, key: string) {
  let home: { x: number; y: number } | null = null;
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;

  const applyFixed = (x: number, y: number) => {
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.translate = "0 0";
  };

  /** Ausgangsstelle messen: dafuer die eigenen Angaben kurz abraeumen,
   *  damit wieder die Regel aus dem Stylesheet greift. */
  const measureHome = () => {
    const keep = {
      left: el.style.left, top: el.style.top,
      right: el.style.right, bottom: el.style.bottom,
      translate: el.style.translate,
    };
    el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.translate = "";
    const r = el.getBoundingClientRect();
    Object.assign(el.style, keep);
    return { x: r.x, y: r.y };
  };

  // Erst messen, wenn das Element sichtbar ist - versteckt liefert es Null.
  refreshers.push(() => {
    home = measureHome();
    const s = loadPos()[key];
    if (s) applyFixed(s.x, s.y);
  });

  let active = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("input")) return;
    const r = el.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.x; oy = r.y;
    moved = false;
    active = true;
    el.classList.remove("settling");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });

  const move = (e: PointerEvent) => {
    if (!active) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!moved) {
      if (Math.hypot(dx, dy) < 5) return;
      // Erst jetzt den Zeiger einfangen. Frueher wuerde das den Klick auf
      // die Knoepfe in der Gruppe auf die Gruppe umleiten.
      moved = true;
      el.classList.add("grabbing");
      el.setPointerCapture(e.pointerId);
    }
    applyFixed(ox + dx, oy + dy);
  };

  const end = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove("grabbing");
    if (!moved) return;
    const r = el.getBoundingClientRect();
    const p = loadPos();
    if (home && Math.hypot(r.x - home.x, r.y - home.y) < SNAP) {
      // Nah genug an der Ausgangsstelle: dorthin zurueckfedern.
      el.classList.add("settling");
      applyFixed(home.x, home.y);
      delete p[key];
      window.setTimeout(() => el.classList.remove("settling"), 460);
    } else {
      p[key] = { x: r.x, y: r.y };
    }
    savePos(p);
    // Klick nach dem Ziehen unterdruecken
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener("click", swallow, { capture: true, once: true });
  };
}

makeDraggable($<HTMLElement>("b-find"), "find");
makeDraggable($<HTMLElement>("b-invert"), "invert");
makeDraggable($<HTMLElement>("anngroup"), "ann");
makeDraggable(findbar, "findbar");

/** Nach dem Sichtbarwerden des Lesers Ausgangsstellen neu vermessen. */
function refreshDrag() {
  requestAnimationFrame(() => { for (const f of refreshers) f(); });
}
window.addEventListener("resize", refreshDrag);

// ---------- Dateien von aussen ----------

void getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type === "over") document.body.classList.add("dragging");
  else if (e.payload.type === "leave") document.body.classList.remove("dragging");
  else if (e.payload.type === "drop") {
    document.body.classList.remove("dragging");
    const p = e.payload.paths.find((x) => x.toLowerCase().endsWith(".pdf"));
    if (p) void openDoc(p);
  }
});

// ---------- Start ----------

if (IS_READER) {
  home.remove();
  void openPath(DOC as string);
} else {
  reader.remove();
  renderHome();
  // Die Bibliothek verteilt eintreffende Dateien an Dokumentfenster.
  void listen<string>("folio://open", (e) => { if (e.payload) void openDoc(e.payload); });
  void invoke<string | null>("startup_file").then((p) => { if (p) void openDoc(p); });
  // Nach dem Schliessen eines Dokumentfensters kann sich die Seitenzahl
  // geaendert haben - beim Zurueckkommen neu aufbauen.
  window.addEventListener("focus", renderHome);
}
