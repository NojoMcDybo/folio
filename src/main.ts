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
import { createGlassRenderer } from "./glass-renderer";
import { clampPosition, pageAtPosition, speedAtPosition } from "./scroll-navigation";
import { OutlinePanel } from "./outline";
import { PageSidebar } from "./sidebar";
import { Bookmarks } from "./bookmarks";
import { ContactSheet } from "./sheet";
import { ViewMenu } from "./view-menu";
import { VIEW_MODES, isPaged, loadViewMode, saveViewMode, type ViewMode } from "./view-modes";
import { ColorPalette } from "./color-palette";
import { LibraryActions } from "./library-actions";
import { notchClosed, notchOnSearch, notchReading, notchSearchState, notchShelf } from "./notch";
import { PageEditor, documentBytes, type BookmarkChange } from "./page-editor";
import { PageMenu, type MenuItem } from "./page-menu";
import { CropDialog, cropEdits } from "./crop";
import { describePages } from "./page-ops";
import { mergeBytes } from "./merge";
import { OcrLayer, embedPayload, frameEmbed } from "./ocr";
import { detectEntities, entityAt, type Entity } from "./detect";
import { cleanSelection, textMenuItems } from "./text-actions";
import { SignDialog } from "./signature";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { initUpdater } from "./updater";

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

/** Seitenweise Ansichten: etwas kleiner als "ganze Seite", damit ein Rand bleibt und nichts scrollt. */
const PAGED_FIT = 0.94;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const home = $<HTMLElement>("home");
const grid = $<HTMLElement>("grid");
const reader = $<HTMLElement>("reader");
const container = $<HTMLDivElement>("container");
const pagechip = $<HTMLElement>("pagechip");
const PDF_INVERT_FILTER = getComputedStyle(document.documentElement).getPropertyValue("--pdf-invert-filter").trim();
const findbar = $<HTMLElement>("findbar");
const findInput = $<HTMLInputElement>("find-q");
const findCount = $<HTMLElement>("find-count");
const btnSave = $<HTMLButtonElement>("b-save");
const btnInvert = $<HTMLButtonElement>("b-invert");
const anngroup = $<HTMLElement>("anngroup");
const btnTool = $<HTMLButtonElement>("a-toggle");
const toast = $<HTMLElement>("toast");
const ask = $<HTMLDialogElement>("ask");

// ---------- Symbole ----------

const P = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICON: Record<string, string> = {
  "b-home": P('<path d="M14.5 5 8 12l6.5 7"/>'),
  "b-outline": P('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v16M12 8h5M12 12h5M12 16h3"/>'),
  "outline-close": P('<path d="M7 7l10 10M17 7 7 17"/>'),
  "b-view": P('<rect x="4" y="5" width="7" height="14" rx="1.6"/><rect x="13" y="5" width="7" height="14" rx="1.6"/>'),
  "sheet-close": P('<path d="M7 7l10 10M17 7 7 17"/>'),
  "b-find": P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  "b-invert": P('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>'),
  "b-save": P('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/>'),
  // Marker: breite Keilspitze mit Farbspur. Stift: schmale Feder.
  "t-mark": P('<path d="M8 3h8v10l-3 4h-2l-3-4z"/><path d="M8 11h8M10 17v3h4v-3"/><path d="M6 21h12" stroke-width="2.5"/>'),
  "t-ink": P('<path d="m5 19 1-3.6 9.3-9.3a1.9 1.9 0 0 1 2.7 2.7L8.6 18z"/><path d="m14.2 7.6 2.2 2.2"/><path d="M5 19h-.5"/>'),
  "t-text": P('<path d="M5 6h14"/><path d="M12 6v13"/>'),
  "a-toggle": P('<rect x="4" y="6" width="16" height="14" rx="4"/><path d="M9 6V4h6v2M4 11h16M10 11v3h4v-3"/>'),
  "find-prev": P('<path d="m7 14 5-5 5 5"/>'),
  "find-next": P('<path d="m7 10 5 5 5-5"/>'),
  "find-close": P('<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>'),
  "w-min": P('<path d="M6 12h12"/>'),
  "w-max": P('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'),
  "w-close": P('<path d="M7 7l10 10"/><path d="M17 7L7 17"/>'),
};

for (const [id, svg] of Object.entries(ICON)) {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = svg;
    el.querySelector("svg")?.setAttribute("aria-hidden", "true");
    if (el.title) el.setAttribute("aria-label", el.title);
  }
}

const PLUS = P('<path d="M12 5v14"/><path d="M5 12h14"/>');

// ---------- Fensterknoepfe ----------

const win = getCurrentWindow();
$<HTMLButtonElement>("w-min").addEventListener("click", () => void win.minimize());
$<HTMLButtonElement>("w-max").addEventListener("click", () => void win.toggleMaximize());
$<HTMLButtonElement>("w-close").addEventListener("click", () => void requestClose());
void win.onCloseRequested(event => { event.preventDefault(); void requestClose(); });

// ---------- Zuletzt geoeffnet ----------

type Recent = { path: string; name: string; thumb: string; page: number; pages: number; at: number };

const KEY = "folio.recents";
const pathKey = (path: string) => path.replace(/\\/g, "/").toLowerCase();
const hiddenKey = (path: string) => "folio.hidden." + encodeURIComponent(pathKey(path));

function loadRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter((r): r is Recent =>
      r && typeof r.path === "string" && typeof r.name === "string" &&
      typeof r.thumb === "string" && Number.isFinite(r.page) && Number.isFinite(r.pages) &&
      localStorage.getItem(hiddenKey(r.path)) !== "1") : [];
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

function touchRecent(patch: Partial<Recent> & { path: string }, opened = false) {
  // Per-file tombstones also suppress stale writes from other open windows.
  try {
    if (opened) localStorage.removeItem(hiddenKey(patch.path));
    else if (localStorage.getItem(hiddenKey(patch.path)) === "1") return;
  } catch { /* The best-effort recents list must not affect PDF saving. */ }
  const list = loadRecents();
  const i = list.findIndex((r) => pathKey(r.path) === pathKey(patch.path));
  if (i === -1 && !opened) return;
  const base: Recent =
    i === -1 ? { path: patch.path, name: "", thumb: "", page: 1, pages: 1, at: 0 } : list[i];
  const next = { ...base, ...patch, at: Date.now() };
  if (i !== -1) list.splice(i, 1);
  list.unshift(next);
  saveRecents(list);
}

// ---------- Bibliothek ----------

function removeRecent(path: string) {
  try { localStorage.setItem(hiddenKey(path), "1"); }
  catch { say("Der Bibliothekseintrag konnte nicht entfernt werden."); return false; }
  saveRecents(loadRecents().filter(r => pathKey(r.path) !== pathKey(path)));
  return true;
}

const libraryActions = new LibraryActions(removeRecent,
  path => invoke<void>("recycle_pdf", { path }), revealItemInDir, renderHome, say);

function renderHome() {
  libraryActions.closeMenu();
  grid.replaceChildren();

  const drop = document.createElement("button");
  drop.className = "tile drop";
  drop.title = "PDF öffnen oder hierher ziehen";
  drop.innerHTML = `<span class="cover">${PLUS}</span><span class="name">PDF öffnen</span>`;
  drop.setAttribute("aria-label", "PDF öffnen");
  drop.addEventListener("click", () => void pick());
  grid.appendChild(drop);

  loadRecents().forEach((r, i) => {
    const item = document.createElement("article");
    item.className = "library-item";
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
    const actions = document.createElement("button");
    actions.className = "library-more";
    actions.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>';
    actions.title = "Weitere Aktionen";
    actions.setAttribute("aria-label", "Aktionen für " + r.name);
    actions.setAttribute("aria-haspopup", "menu");
    actions.setAttribute("aria-expanded", "false");
    actions.addEventListener("click", () => libraryActions.show(r, actions));
    item.addEventListener("contextmenu", event => {
      event.preventDefault(); libraryActions.show(r, actions, { x: event.clientX, y: event.clientY });
    });
    item.append(t, actions);
    grid.appendChild(item);
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
    ctx.fillStyle = getComputedStyle(container).backgroundColor;
    ctx.fillRect(0, 0, w, h);
    if (container.classList.contains("invert")) {
      ctx.filter = PDF_INVERT_FILTER;
    }
    for (const cv of container.querySelectorAll("canvas")) {
      const r = cv.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.width < 2) continue;
      try { ctx.drawImage(cv, r.x * k, r.y * k, r.width * k, r.height * k); } catch { /* leer */ }
    }
    ctx.filter = "none";
    return;
  }

  ctx.fillStyle = getComputedStyle(home).backgroundColor;
  ctx.fillRect(0, 0, w, h);
  // Bewusst ohne die Deckelbilder: im Glas soll sich nur Dokumentinhalt
  // spiegeln, nicht die Bibliothek.
}

const glass = createGlassRenderer($<HTMLCanvasElement>("glasslayer"), paintBackdrop);

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
  // Farbauswahl ist davon unabhaengig.
  annotationEditorHighlightColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F",
});
linkService.setViewer(pdfViewer);

let currentPath: string | null = null;
let pendingPage = 1;
let dirty = false;
const outlinePanel = new OutlinePanel(
  $<HTMLElement>("outline-panel"), $<HTMLButtonElement>("b-outline"),
  $<HTMLElement>("outline-list"), $<HTMLElement>("outline-status"), $<HTMLButtonElement>("outline-close"),
  ({ pageNumber, destination }) => {
    suspendScrolling();
    pdfViewer.scrollPageIntoView({ pageNumber, destArray: destination, ignoreDestinationZoom: true });
  },
  () => suspendScrolling(),
);
let zoomBeforeFit: number | null = null;
/** Nach einer Seitenoperation bleibt der Zoom, statt auf die Ausgangsbreite zurueckzuspringen. */
let keepScale: number | null = null;
let annotationEdited = false;
let viewMode: ViewMode = loadViewMode();

const bookmarks = new Bookmarks(() => { sidebar?.refreshBookmarks(); refreshViewMenu(); });
const goToPage = (page: number) => { suspendScrolling(); pdfViewer.currentPageNumber = page; };
const sidebar = new PageSidebar({
  root: $<HTMLElement>("thumbs"),
  list: $<HTMLElement>("thumb-list"),
  grip: $<HTMLElement>("thumbs-grip"),
  edge: $<HTMLElement>("thumbs-edge"),
  wheelHost: container,
  go: goToPage,
  isBookmarked: (page) => bookmarks.has(page),
  onMove: (pages, to) => void editor.movePages(pages, to),
  onContextMenu: (_pages, x, y) => openPageMenu(x, y),
  onNearEdge: (pages) => prepareDrag(pages),
  onDragOut: (pages) => void dragOut(pages),
});
const sheet = new ContactSheet(
  $<HTMLElement>("sheet"), $<HTMLElement>("sheet-grid"), $<HTMLElement>("sheet-close"),
  goToPage, (page) => bookmarks.has(page),
);
const viewMenu = new ViewMenu(
  $<HTMLButtonElement>("b-view"), $<HTMLElement>("view-menu"),
  $<HTMLButtonElement>("view-bookmark"), $<HTMLElement>("view-bookmarks"),
  {
    setMode: (mode) => applyViewMode(mode, true),
    sheet: () => sheet.toggle(pdfViewer.pdfDocument, pdfViewer.currentPageNumber),
    sidebar: () => sidebar.toggle(),
    toggleBookmark,
    goTo: goToPage,
    pages: (x, y) => openPageMenu(x, y),
    sign: () => void startSigning(),
    toggleOcr: () => ocr.setEnabled(!ocr.isEnabled),
    ocrNow: () => { viewMenu.close(); void ocr.recognizeNow(pdfViewer.currentPageNumber); say("Text wird erkannt …"); },
    embedOcr: () => void embedRecognizedText(),
  },
);
viewMenu.setMode(viewMode);

function refreshViewMenu() {
  viewMenu.setBookmarks(bookmarks.list(), bookmarks.has(pdfViewer.currentPageNumber));
  viewMenu.setOcr(ocr.isEnabled, ocr.recognized().size);
}

function toggleBookmark() {
  if (!pdfViewer.pdfDocument) return;
  const page = pdfViewer.currentPageNumber;
  say(bookmarks.toggle(page) ? `Lesezeichen auf Seite ${page}` : `Lesezeichen von Seite ${page} entfernt`);
}

function fitOpen() {
  if (!pdfViewer.pdfDocument) return;
  zoomBeforeFit = null;
  // Seitenweise Ansichten fuellen das Fenster, sonst gaebe es nur eine kleine Seite im Leeren.
  if (isPaged(viewMode)) {
    pdfViewer.currentScaleValue = "page-fit";
    pdfViewer.currentScale *= PAGED_FIT;
    return;
  }
  pdfViewer.currentScaleValue = "page-width";
  pdfViewer.currentScale *= OPEN_WIDTH;
}

/** Seitenanordnung wechseln, ohne die Leseposition zu verlieren. */
function applyViewMode(mode: ViewMode, refit: boolean) {
  const page = pdfViewer.currentPageNumber;
  viewMode = mode;
  saveViewMode(mode);
  document.body.classList.toggle("paged", isPaged(mode));
  viewMenu.setMode(mode);
  if (!pdfViewer.pdfDocument) return;
  const { scroll, spread } = VIEW_MODES[mode];
  pdfViewer.scrollMode = scroll;
  pdfViewer.spreadMode = spread;
  if (refit) fitOpen();
  pdfViewer.currentPageNumber = page;
  suspendScrolling();
  paintProgress();
  glass?.invalidate();
}

let chipTimer = 0;
function flashChip(text: string) {
  pagechip.textContent = pagechip.matches(":hover") ? currentPageText() : text;
  pagechip.classList.add("show");
  window.clearTimeout(chipTimer);
  chipTimer = window.setTimeout(() => pagechip.classList.remove("show"), 1600);
}

function currentPageText() { return pdfViewer.currentPageNumber + " / " + pdfViewer.pagesCount; }
pagechip.addEventListener("pointerenter", () => {
  if (pdfViewer.pdfDocument) pagechip.textContent = currentPageText();
});

// Blank paper toggles reading width; text, links and editing keep their gestures.
container.addEventListener("dblclick", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const page = target?.closest<HTMLElement>(".page");
  if (!page || !pdfViewer.pdfDocument || tool !== "none" || e.button !== 0 ||
      e.ctrlKey || e.metaKey || e.altKey || e.shiftKey ||
      target?.closest(".textLayer span, .ocr-word, .annotationLayer, .annotationEditorLayer, a, input, textarea, [contenteditable=true]")) return;
  e.preventDefault();
  const pageNumber = Number(page.dataset.pageNumber);
  if (pageNumber > 0) pdfViewer.currentPageNumber = pageNumber;
  if (zoomBeforeFit === null) {
    zoomBeforeFit = pdfViewer.currentScale;
    pdfViewer.currentScaleValue = "page-width";
  } else {
    const previous = zoomBeforeFit;
    zoomBeforeFit = null;
    pdfViewer.currentScale = previous;
  }
  flashChip(currentPageText());
});

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


// ---------- Texterkennung ----------

const ocrChip = $<HTMLElement>("ocr-chip");
let ocrChipTimer = 0;

const ocr = new OcrLayer({
  pageDiv: (page) => pdfViewer.getPageView(page - 1)?.div ?? null,
  say,
  busy: (waiting, page) => {
    window.clearTimeout(ocrChipTimer);
    if (waiting > 0) {
      ocrChip.textContent = page ? `Text wird erkannt … Seite ${page}${waiting > 1 ? ` (+${waiting - 1})` : ""}` : "Text wird erkannt …";
      ocrChip.hidden = false;
      glass?.invalidate();
    } else if (!ocrChip.hidden) {
      const n = ocr.recognized().size;
      ocrChip.textContent = n ? "Text erkannt – markieren, kopieren, Links öffnen" : "Kein Text gefunden";
      ocrChipTimer = window.setTimeout(() => { ocrChip.hidden = true; }, 2600);
    }
  },
  changed: () => refreshViewMenu(),
});

eventBus.on("pagerendered", (e: { pageNumber: number }) => {
  const div = pdfViewer.getPageView(e.pageNumber - 1)?.div;
  if (div) ocr.onPageRendered(e.pageNumber, div);
});

/** Erkannten Text unsichtbar in die PDF schreiben - als Schritt, den man zuruecknehmen kann. */
async function embedRecognizedText() {
  const recognized = ocr.recognized();
  const doc = pdfViewer.pdfDocument;
  if (!doc || !recognized.size) return;
  const pages = await embedPayload(doc, recognized);
  const ok = await editor.transform("Erkannten Text einbetten", async (_doc, before) =>
    new Uint8Array(await invoke<ArrayBuffer>("pdf_embed_text", frameEmbed(pages, before))));
  if (ok) say(`Text auf ${recognized.size === 1 ? "1 Seite" : `${recognized.size} Seiten`} eingebettet – beim Sichern wird er Teil der PDF`);
}

// ---------- Unterschreiben ----------

const signDialog = new SignDialog($<HTMLDialogElement>("sign"));

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Bild nicht lesbar"));
    img.src = src;
  });
}

async function startSigning() {
  if (!pdfViewer.pdfDocument) return;
  const png = await signDialog.open();
  if (png) await placeSignature(png);
}

/** Setzt die Unterschrift als Bild-Stempel in die Mitte des sichtbaren Teils der aktuellen Seite.
 *  Danach laesst sie sich verschieben und in der Groesse aendern wie jede Anmerkung. */
async function placeSignature(png: string) {
  try {
    const view = pdfViewer.getPageView(pdfViewer.currentPageNumber - 1);
    openAnn();
    setTool("stamp");
    // Die Editor-Ebene der Seite entsteht erst mit dem Moduswechsel.
    for (let i = 0; i < 20 && !view?.annotationEditorLayer?.annotationEditorLayer; i++) await new Promise((r) => setTimeout(r, 50));
    const layer = view?.annotationEditorLayer?.annotationEditorLayer;
    if (!layer?.createAndAddNewEditor) throw new Error("Editor-Ebene nicht bereit");
    const { w, h } = await imageSize(png);
    const box = (layer.div as HTMLElement).getBoundingClientRect();
    const cx = (Math.max(0, box.left) + Math.min(innerWidth, box.right)) / 2 - box.left;
    const cy = (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2 - box.top;
    const editor = layer.createAndAddNewEditor({ offsetX: cx, offsetY: cy }, true, { bitmapUrl: png });
    if (editor) {
      // Etwa ein Viertel der Seitenbreite, Seitenverhaeltnis der Unterschrift bleibt.
      const widthFraction = 0.26;
      editor.width = widthFraction;
      editor.height = widthFraction * (box.width / box.height) * (h / w);
    }
    say("Unterschrift eingefügt – verschieben, Größe ziehen, dann Strg+S");
  } catch (error) {
    // Rueckfall: ins Zwischenablage-Bild legen; im Stempel-Modus fuegt PDF.js es mit Strg+V ein.
    try {
      const blob = await (await fetch(png)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      say("Unterschrift liegt in der Zwischenablage – mit Strg+V einfügen");
    } catch {
      say("Unterschrift konnte nicht eingefügt werden: " + String(error));
    }
  }
}

// ---------- Text: Rechtsklick und Links ----------

const textMenu = new PageMenu($<HTMLElement>("text-menu"));
const copyText = (text: string) => void navigator.clipboard.writeText(text).catch(() => say("Kopieren nicht möglich"));
const openExternal = (url: string) => void openUrl(url).catch((error) => say("Konnte nicht geöffnet werden: " + String(error)));

/** Zeichenstelle unter dem Mauszeiger innerhalb eines Textknotens. */
function caretOffset(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

container.addEventListener("contextmenu", (e) => {
  if (tool !== "none" || !pdfViewer.pdfDocument) return;
  const target = e.target instanceof Element ? e.target : null;
  const word = target?.closest<HTMLElement>(".textLayer span, .ocr-word");
  const selected = cleanSelection(window.getSelection()?.toString() ?? "");
  if (!word && !selected) return;
  e.preventDefault();
  let text = selected;
  let entity: Entity | null = null;
  if (selected) {
    entity = detectEntities(selected).find((x) => x.start === 0 && x.end >= selected.length - 1) ?? null;
  } else if (word) {
    if (word.classList.contains("ocr-link")) {
      // Erkannte Adresse: alle Woerter derselben Adresse gehoeren zusammen.
      const href = word.dataset.href!;
      const parts = [...word.parentElement!.querySelectorAll<HTMLElement>(".ocr-link")].filter((w) => w.dataset.href === href);
      text = parts.map((w) => w.textContent).join(" ");
      entity = detectEntities(text).find((x) => x.href === href) ?? { type: word.dataset.kind as Entity["type"], text, start: 0, end: text.length, href };
    } else {
      text = cleanSelection(word.textContent ?? "");
      const at = caretOffset(e.clientX, e.clientY);
      const inSpan = at && word.contains(at.node) ? at.offset : -1;
      entity = inSpan >= 0 ? entityAt(word.textContent ?? "", inSpan) : null;
      // Bei einer Adresse zaehlt nur sie, sonst das Wort unter dem Zeiger.
      if (entity) text = entity.text;
      else if (at && at.node.nodeType === Node.TEXT_NODE) {
        const full = at.node.textContent ?? "";
        const left = full.slice(0, at.offset).search(/[\p{L}\p{N}-]*$/u);
        const right = full.slice(at.offset).search(/[^\p{L}\p{N}-]/u);
        text = full.slice(left < 0 ? 0 : left, right < 0 ? full.length : at.offset + right) || text;
      }
    }
  }
  const items = textMenuItems(text, entity, { open: openExternal, copy: copyText });
  if (items.length) textMenu.open(items, e.clientX, e.clientY);
});

// Ein Klick auf erkannte Adresse in einer Textebene der Erkennung oeffnet sie - ausser man
// markiert gerade Text.
container.addEventListener("click", (e) => {
  const link = e.target instanceof Element ? e.target.closest<HTMLElement>(".ocr-link") : null;
  if (!link || tool !== "none" || !(window.getSelection()?.isCollapsed ?? true)) return;
  e.preventDefault();
  openExternal(link.dataset.href!);
});

// ---------- Seiten bearbeiten ----------

const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];
const pageMenu = new PageMenu($<HTMLElement>("page-menu"));
const cropDialog = new CropDialog($<HTMLDialogElement>("crop"));

const editor = new PageEditor({
  doc: () => pdfViewer.pdfDocument,
  currentPage: () => pdfViewer.currentPageNumber,
  bookmarks: () => bookmarks.list(),
  replace: replaceDocument,
  edit: async (bytes, edits) =>
    new Uint8Array(await invoke<ArrayBuffer>("pdf_edit", bytes, { headers: { "x-edits": JSON.stringify(edits) } })),
  busy: (on) => {
    reader.inert = on;
    document.body.classList.toggle("working", on);
    if (on) suspendScrolling();
  },
  say,
  isDirty: () => dirty,
  setDirty: (state) => markDirty(state),
  changed: () => {},
});

/** Das offene Dokument durch neue Bytes ersetzen (Seitenoperation, Rueckgaengig, Wiederholen). */
async function replaceDocument(bytes: Uint8Array, page: number, change: BookmarkChange) {
  // PDF.js darf den Puffer uebernehmen; die Momentaufnahme des Verlaufs bleibt unberuehrt.
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const kept = "map" in change ? sidebar.selection().map(change.map).filter((p): p is number => p !== null) : [];
  keepScale = pdfViewer.currentScale;
  pendingPage = Math.min(Math.max(1, page), doc.numPages);
  attachDocument(doc);
  bookmarks.rekey(doc.fingerprints[0] ?? null, change, doc.numPages);
  sidebar.setSelection(kept);
  glass?.invalidate();
  if (currentPath) {
    touchRecent({ path: currentPath, pages: doc.numPages, page: pendingPage });
    void notchReading(currentPath, pendingPage, doc.numPages);
  }
}

/** Ausdruecklich markierte Seiten, sonst die gerade angezeigte. */
function targetPages(): number[] {
  const marked = sidebar.selection();
  return marked.length ? marked : [pdfViewer.currentPageNumber];
}

const rotatePages = (degrees: number) => void editor.rotate(targetPages(), degrees);

function deletePages() {
  void editor.deletePages(targetPages());
}

async function cropPages() {
  const doc = pdfViewer.pdfDocument;
  if (!doc || editor.busy) return;
  try {
    const request = await cropDialog.open(doc, targetPages()[0], sidebar.selection());
    if (!request) return;
    await editor.crop(await cropEdits(doc, request));
  } catch (error) {
    say("Zuschneiden fehlgeschlagen: " + String(error));
  }
}

async function insertPaths(paths: string[], after: number) {
  const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
  if (!pdfs.length || !pdfViewer.pdfDocument) return;
  try {
    const parts: Uint8Array[] = [];
    let pages = 0;
    for (const path of pdfs) {
      const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_pdf_plain", { path }));
      const probe = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      pages += probe.numPages;
      void probe.loadingTask.destroy();
      parts.push(bytes);
    }
    if (await editor.insert(parts, after, pages)) say(pages === 1 ? "Seite eingefügt" : `${pages} Seiten eingefügt`);
  } catch (error) {
    say("Einfügen fehlgeschlagen: " + String(error));
  }
}

async function insertFromDialog(after: number) {
  const chosen = await openDialog({ multiple: true, filters: PDF_FILTER });
  await insertPaths(Array.isArray(chosen) ? chosen : typeof chosen === "string" ? [chosen] : [], after);
}

function pageFileName(pages: number[]) {
  const stem = (currentPath ?? "Dokument").split(/[\\/]/).pop()!.replace(/\.pdf$/i, "");
  return `${stem} – Seite ${describePages(pages)}.pdf`;
}

async function tempFile(name: string, bytes: Uint8Array) {
  return invoke<string>("temp_file", bytes, { headers: { "x-name": hex(name) } });
}

async function extractToFile() {
  const pages = targetPages();
  const bytes = await editor.extract(pages);
  if (!bytes) return;
  const target = await saveDialog({ defaultPath: pageFileName(pages), filters: PDF_FILTER });
  if (!target) return;
  try {
    await invoke("write_pdf_copy", bytes, { headers: { "x-path": hex(target) } });
    say("Gesichert: " + (target.split(/[\\/]/).pop() ?? target));
  } catch (error) {
    say("Sichern fehlgeschlagen: " + String(error));
  }
}

async function extractToShelf() {
  const pages = targetPages();
  const bytes = await editor.extract(pages);
  if (!bytes) return;
  try {
    notchShelf([await tempFile(pageFileName(pages), bytes)]);
    say("In der Notch-Ablage");
  } catch (error) {
    say("Ablegen fehlgeschlagen: " + String(error));
  }
}

/** Kleines PNG der Miniatur als Zeigerbild fuer den nativen Drag. */
async function previewPng(source: HTMLCanvasElement | null): Promise<string> {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = source?.width ? Math.round((96 * source.height) / source.width) : 136;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  if (source?.width) ctx.drawImage(source, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  return tempFile("Vorschau.png", new Uint8Array(await blob!.arrayBuffer()));
}

/** Datei und Zeigerbild fuers Herausziehen. Wird schon vorbereitet, wenn der Zeiger sich dem
 *  Fensterrand naehert: der native Drag muss losgehen, solange die Maustaste noch gedrueckt ist. */
let dragPrep: { key: string; ready: Promise<{ file: string; icon: string } | null> } | null = null;

function prepareDrag(pages: number[]) {
  const key = pages.join(",");
  if (dragPrep?.key === key) return;
  const preview = sidebar.previewOf(pages[0]);
  dragPrep = {
    key,
    ready: (async () => {
      const bytes = await editor.extract(pages);
      if (!bytes) return null;
      return { file: await tempFile(pageFileName(pages), bytes), icon: await previewPng(preview) };
    })().catch((error) => { say("Herausziehen fehlgeschlagen: " + String(error)); return null; }),
  };
}

/** Seiten ueber den Fensterrand gezogen: als Datei an Explorer oder Bibliotheksfenster uebergeben. */
async function dragOut(pages: number[]) {
  prepareDrag(pages);
  const prepared = await dragPrep!.ready;
  dragPrep = null;
  if (!prepared) return;
  try {
    await startDrag({ item: [prepared.file], icon: prepared.icon, mode: "copy" });
  } catch (error) {
    say("Herausziehen fehlgeschlagen: " + String(error));
  }
}

function openPageMenu(x: number, y: number) {
  if (!pdfViewer.pdfDocument) return;
  const pages = targetPages();
  const many = pages.length > 1;
  const last = pages[pages.length - 1];
  const items: MenuItem[] = [
    { label: "Nach links drehen", kbd: "Strg+,", action: () => rotatePages(-90) },
    { label: "Nach rechts drehen", kbd: "Strg+.", action: () => rotatePages(90) },
    { label: "Zuschneiden …", action: () => void cropPages() },
    { label: many ? `${pages.length} Seiten löschen` : `Seite ${pages[0]} löschen`, kbd: "Entf", danger: true, action: deletePages },
    { separator: true },
    { label: "PDF dahinter einfügen …", action: () => void insertFromDialog(last) },
    { label: many ? "Seiten als PDF sichern …" : "Seite als PDF sichern …", action: () => void extractToFile() },
    { label: "In die Notch-Ablage legen", action: () => void extractToShelf() },
    { separator: true },
    { label: editor.canUndo ? `Rückgängig: ${editor.undoLabel}` : "Rückgängig", kbd: "Strg+Z", disabled: !editor.canUndo, action: () => void editor.undo() },
    { label: editor.canRedo ? `Wiederholen: ${editor.redoLabel}` : "Wiederholen", kbd: "Strg+Umschalt+Z", disabled: !editor.canRedo, action: () => void editor.redo() },
  ];
  pageMenu.open(items, x, y);
}

eventBus.on("pagesinit", () => {
  applyViewMode(viewMode, false);
  if (keepScale !== null) { pdfViewer.currentScale = keepScale; keepScale = null; }
  else fitOpen();
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
  outlinePanel.setCurrentPage(e.pageNumber);
  sidebar.setCurrent(e.pageNumber);
  refreshViewMenu();
  paintProgress();
  flashChip(e.pageNumber + " / " + pdfViewer.pagesCount);
  if (currentPath) {
    touchRecent({ path: currentPath, page: e.pageNumber, pages: pdfViewer.pagesCount });
    void notchReading(currentPath, e.pageNumber, pdfViewer.pagesCount);
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
  resizeTimer = window.setTimeout(() => {
    if (zoomBeforeFit !== null) pdfViewer.currentScaleValue = "page-width";
    else fitOpen();
    glass?.invalidate();
  }, 160);
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

/** Hängt ein geladenes Dokument an alle Ansichten (Seiten, Kapitel, Leiste). */
function attachDocument(doc: pdfjsLib.PDFDocumentProxy) {
  const old = pdfViewer.pdfDocument;
  pdfViewer.setDocument(doc);
  linkService.setDocument(doc, null);
  outlinePanel.setDocument(doc);
  sidebar.setDocument(doc);
  sheet.close(false);
  ocr.setDocument(doc);
  annotationEdited = false;

  const storage = doc.annotationStorage as unknown as {
    onSetModified: (() => void) | null;
    onResetModified: (() => void) | null;
  };
  storage.onSetModified = () => { annotationEdited = true; markDirty(true); };
  // PDF.js resets this while serializing, before native disk writing succeeds.
  // Only our successful save (or explicit discard) may clear Folio's dirty flag.
  storage.onResetModified = () => {};
  // Das vorige Dokument gibt seinen Speicher im Worker frei.
  if (old && old !== doc) void old.loadingTask.destroy().catch(() => {});
}

async function openPath(path: string) {
  try {
    const buf = await invoke<ArrayBuffer>("read_pdf", { path });
    const name = path.split(/[\\/]/).pop() ?? path;
    const known = loadRecents().find((r) => r.path === path);
    pendingPage = known?.page ?? 1;

    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    attachDocument(doc);
    bookmarks.setDocument(doc.fingerprints[0] ?? null, doc.numPages);
    editor.reset();

    currentPath = path;
    markDirty(false);
    setTool("none");
    closeAnn();
    home.hidden = true;
    reader.hidden = false;
    refreshDrag();
    glass?.invalidate();

    touchRecent({ path, name, thumb: known?.thumb ?? "", pages: doc.numPages, page: pendingPage }, true);
    const thumb = known?.thumb || (await makeThumb(doc));
    if (thumb) touchRecent({ path, thumb });
    void notchReading(path, pendingPage, doc.numPages, { name, thumb });
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
    touchRecent({ path, name: path.split(/[\\/]/).pop() ?? path }, true);
    if (!IS_READER) renderHome();
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

let activeSave: Promise<boolean> | null = null;

function save(): Promise<boolean> {
  if (activeSave) return activeSave;
  const job = performSave();
  activeSave = job;
  void job.finally(() => { if (activeSave === job) activeSave = null; });
  return job;
}

async function performSave(): Promise<boolean> {
  if (!currentPath || !pdfViewer.pdfDocument) return !dirty;
  // Commit active text/ink before taking the serialization snapshot.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (tool !== "none") setTool("none");
  if (!dirty) return true;
  const doc = pdfViewer.pdfDocument;
  const path = currentPath;
  btnSave.disabled = true;
  reader.inert = true;
  suspendScrolling();
  $<HTMLElement>("ask-error").textContent = "";
  try {
    const bytes: Uint8Array = await documentBytes(doc);
    await invoke("save_pdf", bytes, { headers: { "x-path": hex(path) } });
    doc.annotationStorage.resetModified();
    annotationEdited = false;
    editor.markSaved();
    markDirty(false);
    // Thumbnail failure must not turn a completed disk write into a save error.
    void makeThumb(doc).then(thumb => { if (thumb) touchRecent({ path, thumb }); });
    return true;
  } catch (err) {
    markDirty(true);
    const message = "Sichern fehlgeschlagen: " + String(err);
    $<HTMLElement>("ask-error").textContent = message + " Die Änderungen bleiben geöffnet.";
    say(message);
    return false;
  } finally {
    btnSave.disabled = false;
    reader.inert = false;
  }
}

// ---------- Werkzeuge ----------

const TOOL_MODE: Record<string, number> = {
  none: EditorType.NONE,
  mark: EditorType.HIGHLIGHT,
  ink: EditorType.INK,
  text: EditorType.FREETEXT,
  // Unterschriften sind Bild-Stempel; kein eigener Knopf, sie werden ueber "Unterschreiben" gesetzt.
  stamp: EditorType.STAMP,
};

const toolBtn: Record<string, HTMLButtonElement> = {
  mark: $<HTMLButtonElement>("t-mark"),
  ink: $<HTMLButtonElement>("t-ink"),
  text: $<HTMLButtonElement>("t-text"),
};

/** Das zuletzt gewaehlte Werkzeug bleibt fuer den naechsten Klick erhalten. */
let armed = "mark";
let tool = "none";

function paintTool(key: string) {
  for (const [k, b] of Object.entries(toolBtn)) {
    b.classList.toggle("on", k === key);
    b.setAttribute("aria-pressed", String(k === key));
  }
  btnTool.classList.toggle("on", key !== "none");
  btnTool.setAttribute("aria-pressed", String(key !== "none"));
}

function setTool(next: string) {
  tool = next;
  document.body.dataset.tool = next;
  if (next !== "none" && next !== "stamp") armed = next;
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
  eventBus.dispatch("switchannotationeditorparams", { source: window, type, value: colorPalette.color });
}

const colorPalette = new ColorPalette($<HTMLButtonElement>("swatch"), $<HTMLElement>("color-panel"), applyColor, say);

function openAnn() { anngroup.classList.add("open"); btnTool.setAttribute("aria-expanded", "true"); }

function closeAnn() {
  colorPalette.close();
  anngroup.classList.remove("open");
  btnTool.setAttribute("aria-expanded", "false");
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

btnSave.addEventListener("click", () => void save());

/** Rueckfrage vor dem Verlassen. Liefert true, wenn weitergegangen
 *  werden darf. */
let pendingAsk: Promise<boolean> | null = null;
function askSave(): Promise<boolean> {
  if (pendingAsk) return pendingAsk;
  pendingAsk = new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const buttons = [...ask.querySelectorAll<HTMLButtonElement>("button")];
    let busy = false;
    ask.hidden = false;
    $<HTMLElement>("ask-error").textContent = "";
    ask.showModal();
    $<HTMLButtonElement>("ask-cancel").focus();
    const done = (v: boolean) => {
      ask.close();
      ask.hidden = true;
      $<HTMLButtonElement>("ask-save").onclick = null;
      $<HTMLButtonElement>("ask-drop").onclick = null;
      $<HTMLButtonElement>("ask-cancel").onclick = null;
      ask.oncancel = null;
      pendingAsk = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(v);
    };
    $<HTMLButtonElement>("ask-save").onclick = async () => {
      if (busy) return;
      busy = true;
      buttons.forEach(button => { button.disabled = true; });
      const ok = await save();
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
      if (ok) done(true);
    };
    $<HTMLButtonElement>("ask-drop").onclick = () => { markDirty(false); done(true); };
    $<HTMLButtonElement>("ask-cancel").onclick = () => done(false);
    ask.oncancel = event => { event.preventDefault(); if (!busy) done(false); };
  });
  return pendingAsk;
}

/** Zurueck heisst hier: dieses Dokumentfenster zu, Bibliothek nach vorn. */
let closing: Promise<void> | null = null;
function requestClose(showLibrary = false): Promise<void> {
  if (closing) return closing;
  closing = (async () => {
    if (IS_READER) {
      if (activeSave && !(await activeSave)) return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (tool !== "none") setTool("none");
      if (dirty && !(await askSave())) return;
    }
    if (showLibrary) {
      const lib = await WebviewWindow.getByLabel("main");
      if (lib) { await lib.unminimize().catch(() => {}); await lib.setFocus().catch(() => {}); }
    }
    if (IS_READER) notchClosed();
    await win.destroy();
  })().catch(error => say("Fenster konnte nicht geschlossen werden: " + String(error)))
    .finally(() => { closing = null; });
  return closing;
}

$<HTMLButtonElement>("b-home").addEventListener("click", () => void requestClose(true));

btnInvert.addEventListener("click", () => {
  container.classList.toggle("invert");
  const inverted = container.classList.contains("invert");
  $<HTMLElement>("thumbs").classList.toggle("invert", inverted);
  $<HTMLElement>("sheet").classList.toggle("invert", inverted);
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
    zoomBeforeFit = null;
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
  if (IS_READER) notchSearchState(findInput.value, m ?? null);
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
  if (IS_READER) notchSearchState("", null);
  dispatchFind(false);
}

// Suchfeld in der Notch: steuert dieselbe Suche wie die eigene Leiste.
// Tippen sucht im Hintergrund, Enter springt weiter und holt das Fenster nach vorn.
if (IS_READER) {
  notchOnSearch((q, submit) => {
    if (!q) { if (!findbar.hidden || findInput.value) closeFind(); return; }
    if (findbar.hidden) {
      findbar.hidden = false;
      refreshDrag();
      btnFind.classList.add("on");
    }
    const changed = findInput.value !== q;
    findInput.value = q;
    if (submit) {
      dispatchFind(!changed, submit === "prev");
      const w = getCurrentWindow();
      void w.unminimize().then(() => w.setFocus()).catch(() => {});
    } else if (changed) {
      dispatchFind(false);
    }
  });
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
const LENS_SIZE = 160; // CSS-Px der scharfen Mitte; auch Quelle fuer das Layout
lens.style.setProperty("--lens-size", `${LENS_SIZE}px`);

function pageCanvasAt(x: number, y: number) {
  const r = container.getBoundingClientRect();
  if (reader.hidden || document.body.classList.contains("bare") || x < r.left || x >= r.right || y < r.top || y >= r.bottom) return null;
  return [...container.querySelectorAll<HTMLCanvasElement>(".pdfViewer .canvasWrapper canvas")].find(cv => {
    const page = cv.getBoundingClientRect();
    return cv.width > 0 && cv.height > 0 && x >= page.left && x < page.right && y >= page.top && y < page.bottom;
  }) ?? null;
}

function paintLens(x: number, y: number, cv: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(LENS_SIZE * dpr);
  if (lensCv.width !== size) { lensCv.width = size; lensCv.height = size; }
  lensCtx.clearRect(0, 0, size, size);

  const r = cv.getBoundingClientRect();
  const sx = ((x - r.x) / r.width) * cv.width;
  const sy = ((y - r.y) / r.height) * cv.height;
  const sw = (LENS_SIZE / LENS_ZOOM) * (cv.width / r.width);
  const sh = (LENS_SIZE / LENS_ZOOM) * (cv.height / r.height);
  lensCtx.drawImage(cv, sx - sw / 2, sy - sh / 2, sw, sh, 0, 0, size, size);

  // Invertiert-Modus faerbt die Seiten-Canvas per CSS-Filter um - sonst
  // zeigt die Lupe die falschen Farben.
  lensCv.style.filter = container.classList.contains("invert")
    ? PDF_INVERT_FILTER
    : "";
}

btnFind.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  let lensing = false;
  let moved = false;
  let x = e.clientX, y = e.clientY;

  const update = () => {
    if (!moved) return;
    const cv = pageCanvasAt(x, y);
    if (cv) {
      lensing = true;
      lens.style.left = x + "px";
      lens.style.top = y + "px";
      lens.hidden = false;
      btnFind.classList.add("lens-hidden");
      paintLens(x, y, cv);
    } else if (lensing) {
      lensing = false;
      lens.hidden = true;
      btnFind.classList.remove("lens-hidden");
    }
  };

  const onMove = (ev: PointerEvent) => {
    x = ev.clientX; y = ev.clientY;
    moved ||= Math.hypot(x - e.clientX, y - e.clientY) >= 5;
    update();
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("blur", onUp);
    container.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    lens.hidden = true;
    btnFind.classList.remove("lens-hidden");
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("blur", onUp);
  container.addEventListener("scroll", update);
  window.addEventListener("resize", update);
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
  // Seitenweise zeigt der Stab die Seite, nicht die Scrollstrecke innerhalb einer Seite.
  const paged = isPaged(viewMode) && pdfViewer.pagesCount > 1;
  const p = paged ? (pdfViewer.currentPageNumber - 1) / (pdfViewer.pagesCount - 1)
    : max > 4 ? container.scrollTop / max : 0;
  scroller.dataset.fill = String(Math.min(1, Math.max(0.004, p)));
  scroller.style.setProperty("--scroller-p", String(Math.min(1, Math.max(0, p))));
}

const scrollTarget = $<HTMLElement>("scroll-target");
let targetSpeed = 0;
let currentSpeed = 0;
let autoId = 0;
let lastTick = 0;
let dragging = false;
let press: { x: number; y: number; wide: boolean; moved: boolean; pointerId: number } | null = null;

function tick(t: number) {
  const dt = lastTick ? Math.min(0.05, (t - lastTick) / 1000) : 0;
  lastTick = t;
  currentSpeed += (targetSpeed - currentSpeed) * (1 - Math.exp(-dt / 0.14));
  container.scrollTop += currentSpeed * dt;
  autoId = requestAnimationFrame(tick);
}

function startAuto() {
  if (!autoId) { lastTick = 0; autoId = requestAnimationFrame(tick); }
}

function stopAuto() {
  if (autoId) cancelAnimationFrame(autoId);
  autoId = 0;
  targetSpeed = currentSpeed = lastTick = 0;
}

let wideTimer = 0;
let leaveTimer = 0;
let lastPointer: { x: number; y: number } | null = null;

function widePosition(y: number) {
  // Stable final bounds avoid changing the target during the opening animation.
  return clampPosition((y - innerHeight * 0.13) / (innerHeight * 0.74));
}

function showTarget(x: number, y: number) {
  if (!pdfViewer.pdfDocument) return;
  const destination = pageAtPosition(widePosition(y), pdfViewer.pagesCount);
  scrollTarget.textContent = `Seite ${destination}`;
  scrollTarget.hidden = false;
  const r = scroller.getBoundingClientRect();
  scrollTarget.style.left = Math.max(8, Math.min(x - 14, r.left - 12) - scrollTarget.offsetWidth) + "px";
  scrollTarget.style.top = Math.max(8, Math.min(innerHeight - scrollTarget.offsetHeight - 8, y - scrollTarget.offsetHeight / 2)) + "px";
}

function collapseScroller() {
  window.clearTimeout(wideTimer);
  window.clearTimeout(leaveTimer);
  scroller.classList.remove("wide");
  scrollTarget.hidden = true;
  stopAuto();
}

scroller.addEventListener("pointerenter", (e) => {
  if (dragging || document.body.classList.contains("bare")) return;
  lastPointer = { x: e.clientX, y: e.clientY };
  window.clearTimeout(wideTimer);
  window.clearTimeout(leaveTimer);
  if (scroller.classList.contains("wide")) { showTarget(e.clientX, e.clientY); return; }
  // Erst nach einer Sekunde Verweilen - sonst schnappt der Stab zu, wenn
  // die Maus nur vorbeizieht.
  wideTimer = window.setTimeout(() => {
    scroller.classList.add("wide");
    if (lastPointer) showTarget(lastPointer.x, lastPointer.y);
  }, 1000);
});

scroller.addEventListener("pointerleave", () => {
  if (dragging) return;
  window.clearTimeout(wideTimer);
  window.clearTimeout(leaveTimer);
  stopAuto();
  scrollTarget.hidden = true;
  // Noch eine Sekunde stehen lassen - wer nur kurz danebengreift, soll
  // nicht sofort aus dem Scrollfeld fallen.
  leaveTimer = window.setTimeout(() => {
    collapseScroller();
  }, 1000);
});

scroller.addEventListener("pointermove", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (!scroller.classList.contains("wide") || dragging) return;
  showTarget(e.clientX, e.clientY);
  const nextSpeed = isPaged(viewMode) ? 0 : speedAtPosition(widePosition(e.clientY));
  if (!nextSpeed) { stopAuto(); return; }
  // Direction changes must not briefly continue in the old direction.
  if (Math.sign(nextSpeed) !== Math.sign(currentSpeed)) currentSpeed = 0;
  targetSpeed = nextSpeed;
  startAuto();
});

// Deckt sich mit dem Rand in styles.css (#scroller top: calc(...)).
const TRACK_MARGIN = 84;

/** Ziehen setzt die Leseposition direkt, wie bei einer echten
 *  Bildlaufleiste: die Stelle im Fenster ist die Stelle im Dokument. */
function scrubTo(e: PointerEvent) {
  if (isPaged(viewMode)) {
    const position = press?.wide
      ? widePosition(e.clientY)
      : clampPosition((e.clientY - TRACK_MARGIN) / Math.max(1, window.innerHeight - TRACK_MARGIN * 2));
    const target = press?.wide
      ? pageAtPosition(position, pdfViewer.pagesCount)
      : Math.round(position * (pdfViewer.pagesCount - 1)) + 1;
    if (target !== pdfViewer.currentPageNumber) pdfViewer.currentPageNumber = target;
    if (press?.wide) showTarget(e.clientX, e.clientY);
    return;
  }
  if (press?.wide) {
    const position = widePosition(e.clientY);
    const pageNumber = pageAtPosition(position, pdfViewer.pagesCount);
    const view = pdfViewer.getPageView(pageNumber - 1);
    if (view) {
      const fraction = position === 1 ? 1 : position * pdfViewer.pagesCount - (pageNumber - 1);
      container.scrollTop = view.div.offsetTop + view.div.clientHeight * fraction;
    }
    showTarget(e.clientX, e.clientY);
    return;
  }
  const usable = Math.max(1, window.innerHeight - TRACK_MARGIN * 2);
  const t = Math.min(1, Math.max(0, (e.clientY - TRACK_MARGIN) / usable));
  const max = container.scrollHeight - container.clientHeight;
  container.scrollTop = t * max;
}

scroller.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  press = { x: e.clientX, y: e.clientY, wide: scroller.classList.contains("wide"), moved: false, pointerId: e.pointerId };
  window.clearTimeout(wideTimer);
  window.clearTimeout(leaveTimer);
  stopAuto();
  if (!press.wide) scroller.classList.add("dragging");
  scroller.setPointerCapture(e.pointerId);
  if (!press.wide) scrubTo(e);
});

window.addEventListener("pointermove", (e) => {
  if (!dragging || !press || e.pointerId !== press.pointerId) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press.moved = true;
  if (press.moved) scrubTo(e);
});

function endDrag(e: PointerEvent) {
  if (!dragging) return;
  if (press && e.pointerId !== press.pointerId) return;
  if (press?.wide && !press.moved && e.type === "pointerup") {
    pdfViewer.currentPageNumber = pageAtPosition(widePosition(press.y), pdfViewer.pagesCount);
  }
  dragging = false;
  press = null;
  scroller.classList.remove("dragging");
  try { scroller.releasePointerCapture(e.pointerId); } catch { /* schon los */ }
  if (!scroller.matches(":hover")) collapseScroller();
}

window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

function suspendScrolling() {
  const pointerId = press?.pointerId;
  dragging = false; press = null;
  scroller.classList.remove("dragging");
  if (pointerId !== undefined && scroller.hasPointerCapture(pointerId)) scroller.releasePointerCapture(pointerId);
  collapseScroller();
}
window.addEventListener("blur", suspendScrolling);
scroller.addEventListener("lostpointercapture", () => { if (dragging) suspendScrolling(); });
window.addEventListener("resize", suspendScrolling);
document.addEventListener("visibilitychange", () => { if (document.hidden) suspendScrolling(); });

// ---------- Tastatur ----------

window.addEventListener("keydown", (e) => {
  if (ask.open || $<HTMLDialogElement>("library-delete").open) return;
  if (activeSave) { e.preventDefault(); return; }
  const typing =
    e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (e.key === "F11") { e.preventDefault(); suspendScrolling(); outlinePanel.close(); colorPalette.close(); viewMenu.close(); document.body.classList.toggle("bare"); return; }
  if (reader.hidden) {
    if (ctrl && k === "o") { e.preventDefault(); void pick(); }
    return;
  }

  // Der Kontaktbogen deckt alles ab: nur Esc/K (und seine eigenen Pfeiltasten) gelten.
  if (sheet.isOpen) {
    if (e.key === "Escape" || (!ctrl && !typing && k === "k")) { e.preventDefault(); sheet.close(); }
    return;
  }

  if (ctrl && k === "o") { e.preventDefault(); void pick(); }
  else if (ctrl && k === "b") { e.preventDefault(); sidebar.toggle(); }
  else if (ctrl && e.shiftKey && k === "u") { e.preventDefault(); void startSigning(); }
  else if (ctrl && k === "d") { e.preventDefault(); toggleBookmark(); }
  // Seiten-Rueckgaengig gilt, solange nach der letzten Seitenoperation nichts markiert/gezeichnet
  // wurde - sonst gehoert Strg+Z dem Stift und den Textfeldern (PDF.js' eigener Verlauf).
  else if (ctrl && (k === "z" || k === "y") && !typing && tool === "none" && !annotationEdited && (editor.canUndo || editor.canRedo)) {
    e.preventDefault();
    e.stopPropagation();
    void (k === "y" || e.shiftKey ? editor.redo() : editor.undo());
  }
  else if (ctrl && e.key === ".") { e.preventDefault(); rotatePages(90); }
  else if (ctrl && e.key === ",") { e.preventDefault(); rotatePages(-90); }
  else if (e.key === "Delete" && !ctrl && !typing && ($<HTMLElement>("thumbs").contains(document.activeElement) || sidebar.selection().length)) {
    e.preventDefault();
    deletePages();
  }
  else if (ctrl && k === "f") { e.preventDefault(); openFind(); }
  else if (ctrl && k === "s") { e.preventDefault(); void save(); }
  else if (ctrl && k === "i") { e.preventDefault(); btnInvert.click(); }
  else if (ctrl && e.key === "0") { e.preventDefault(); fitOpen(); }
  else if (e.key === "F3") { e.preventDefault(); dispatchFind(true, e.shiftKey); }
  else if (e.key === "Escape") {
    if (viewMenu.isOpen) { e.preventDefault(); viewMenu.close(true); }
    else if (!findbar.hidden) { e.preventDefault(); closeFind(); }
    else if (!$<HTMLElement>("outline-panel").hidden) { e.preventDefault(); outlinePanel.close(true); }
    else if (anngroup.classList.contains("open")) { e.preventDefault(); closeAnn(); }
    else if (sidebar.selection().length) { e.preventDefault(); sidebar.clearSelection(); }
    else if (sidebar.isOpen) { e.preventDefault(); sidebar.setOpen(false); }
  }
  else if (!ctrl && !typing) {
    if (k === "m") { openAnn(); setTool("mark"); }
    else if (k === "z") { openAnn(); setTool("ink"); }
    else if (k === "t") { openAnn(); setTool("text"); }
    else if (k === "v") setTool("none");
    else if (k === "k") sheet.toggle(pdfViewer.pdfDocument, pdfViewer.currentPageNumber);
    else if (isPaged(viewMode) && pdfViewer.pdfDocument) turnPageByKey(e);
  }
});

/** In den seitenweisen Ansichten blaettern die Tasten, solange die Seite nicht seitlich
 *  scrollbar ist (vergroessert): dann gehoeren Links/Rechts dem Scrollen. */
function turnPageByKey(e: KeyboardEvent) {
  const wide = container.scrollWidth > container.clientWidth + 1;
  const next = e.key === "PageDown" || (!wide && e.key === "ArrowRight");
  const prev = e.key === "PageUp" || (!wide && e.key === "ArrowLeft");
  if (next) { e.preventDefault(); pdfViewer.nextPage(); }
  else if (prev) { e.preventDefault(); pdfViewer.previousPage(); }
  else if (e.key === "Home") { e.preventDefault(); pdfViewer.currentPageNumber = 1; }
  else if (e.key === "End") { e.preventDefault(); pdfViewer.currentPageNumber = pdfViewer.pagesCount; }
}

// Mausrad/Touchpad blaettert in den seitenweisen Ansichten, sobald die Seite am Ende
// (oder Anfang) angekommen ist - wie in Vorschau. Gesperrt nach jedem Umblaettern, damit
// Trägheit des Touchpads nicht gleich mehrere Seiten weiterschiebt.
let pageWheel = 0;
let pageWheelLock = 0;
let pageWheelReset = 0;
container.addEventListener("wheel", (e) => {
  if (!isPaged(viewMode) || e.ctrlKey || !pdfViewer.pdfDocument) return;
  if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
  const atTop = container.scrollTop <= 6;
  const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 6;
  if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) { pageWheel = 0; return; }
  const now = performance.now();
  if (now < pageWheelLock) return;
  pageWheel += e.deltaY;
  window.clearTimeout(pageWheelReset);
  pageWheelReset = window.setTimeout(() => { pageWheel = 0; }, 250);
  if (Math.abs(pageWheel) < 80) return;
  const forward = pageWheel > 0;
  pageWheel = 0;
  pageWheelLock = now + 500;
  if (forward ? pdfViewer.nextPage() : pdfViewer.previousPage()) {
    requestAnimationFrame(() => { container.scrollTop = forward ? 0 : container.scrollHeight; });
  }
}, { passive: true });

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

function makeDraggable(el: HTMLElement, key: string, options: { handle?: string; home?: () => { x: number; y: number } } = {}) {
  let home: { x: number; y: number } | null = null;
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;

  const applyFixed = (x: number, y: number) => {
    const bounds = el.getBoundingClientRect();
    // Keep movable controls reachable after switching to a smaller window.
    const left = Math.min(Math.max(10, x), Math.max(10, innerWidth - bounds.width - 10));
    const top = Math.min(Math.max(10, y), Math.max(10, innerHeight - bounds.height - 10));
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.translate = "0 0";
  };

  /** Ausgangsstelle messen: dafuer die eigenen Angaben kurz abraeumen,
   *  damit wieder die Regel aus dem Stylesheet greift. */
  const measureHome = () => {
    if (options.home) return options.home();
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
    if (!el.getClientRects().length) return;
    home = measureHome();
    const s = loadPos()[key];
    if (s) applyFixed(s.x, s.y);
    else if (options.home) applyFixed(home.x, home.y);
  });

  let active = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (options.handle && (!(e.target as HTMLElement).closest(options.handle) || (e.target as HTMLElement).closest("button"))) return;
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
    // Store layout coordinates, excluding the temporary pressed-button scale.
    const r = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
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
makeDraggable($<HTMLElement>("b-outline"), "outline");
makeDraggable($<HTMLElement>("b-view"), "view");
makeDraggable($<HTMLElement>("outline-panel"), "outlinePanel", {
  handle: ".outline-header",
  home: () => {
    const r = $<HTMLElement>("b-outline").getBoundingClientRect();
    return { x: r.left - 50, y: r.bottom + 12 };
  },
});
$<HTMLElement>("outline-panel").addEventListener("outlineopen", refreshDrag);
new ResizeObserver(refreshDrag).observe($<HTMLElement>("outline-panel"));
makeDraggable($<HTMLElement>("anngroup"), "ann");
makeDraggable(findbar, "findbar");

/** Nach dem Sichtbarwerden des Lesers Ausgangsstellen neu vermessen. */
function refreshDrag() {
  requestAnimationFrame(() => { for (const f of refreshers) f(); });
}
window.addEventListener("resize", refreshDrag);

// ---------- Dateien von aussen ----------

let springOpened = false;

function endSpringOpen() {
  sidebar.showMarker(null);
  if (springOpened) { sidebar.setOpen(false, false); springOpened = false; }
}

/** Pixelposition des Ablegens in CSS-Pixeln des Fensters. */
const dropPoint = (position: { x: number; y: number }) => ({ x: position.x / devicePixelRatio, y: position.y / devicePixelRatio });

void getCurrentWebview().onDragDropEvent((e) => {
  const payload = e.payload;
  if (payload.type === "leave") {
    document.body.classList.remove("dragging");
    endSpringOpen();
    return;
  }
  const at = dropPoint(payload.position);
  if (payload.type === "over") {
    document.body.classList.add("dragging");
    if (IS_READER && pdfViewer.pdfDocument) {
      // Dateien am linken Rand: die Leiste faehrt von selbst heraus, damit man die
      // Einfuegestelle zwischen den Seiten sieht.
      if (at.x < 40 && !sidebar.isOpen) { sidebar.setOpen(true, false); springOpened = true; }
      sidebar.showMarker(sidebar.insertionAt(at.x, at.y));
    }
    return;
  }
  document.body.classList.remove("dragging");
  const pdfs = payload.paths.filter((x) => x.toLowerCase().endsWith(".pdf"));
  const insertAt = IS_READER && pdfViewer.pdfDocument ? sidebar.insertionAt(at.x, at.y) : null;
  // Wurde in die Leiste fallengelassen, bleibt sie offen: man will das Ergebnis sehen.
  if (insertAt !== null) { springOpened = false; sidebar.showMarker(null); } else endSpringOpen();
  if (!pdfs.length) return;
  if (insertAt !== null) void insertPaths(pdfs, insertAt);
  else if (IS_READER) void openDoc(pdfs[0]);
  else void dropInLibrary(pdfs);
});

/** Eine aus Seiten erzeugte Datei liegt zunaechst im Ablageordner; faellt sie ins Bibliotheksfenster,
 *  wird sie ein richtiges Dokument im Bibliotheksordner. */
async function adoptDropped(path: string): Promise<string> {
  if (!/[\\/]Folio-Ablage[\\/]/i.test(path)) return path;
  try { return await invoke<string>("adopt_temp_pdf", { path }); } catch { return path; }
}

async function dropInLibrary(paths: string[]) {
  const files = await Promise.all(paths.map(adoptDropped));
  if (files.length === 1) { await openDoc(files[0]); return; }
  const choice = await askMerge(files);
  if (choice === "single") for (const f of files) await openDoc(f);
  else if (choice === "merge") await mergeFiles(files);
}

function askMerge(files: string[]): Promise<"merge" | "single" | null> {
  const dlg = $<HTMLDialogElement>("merge-ask");
  const names = files.map((f) => f.split(/[\\/]/).pop() ?? f);
  $<HTMLElement>("merge-ask-text").textContent =
    `${files.length} PDFs: ${names.slice(0, 4).join(", ")}${names.length > 4 ? " …" : ""}. ` +
    "Beim Zusammenführen entsteht ein neues Dokument im Ordner Dokumente\\Folio; die Originale bleiben unverändert.";
  $<HTMLElement>("merge-ask-error").textContent = "";
  return new Promise((resolve) => {
    const done = (value: "merge" | "single" | null) => {
      dlg.close();
      for (const [id, fn] of handlers) $<HTMLButtonElement>(id).removeEventListener("click", fn);
      dlg.removeEventListener("cancel", onCancel);
      resolve(value);
    };
    const onCancel = (ev: Event) => { ev.preventDefault(); done(null); };
    const handlers: Array<[string, () => void]> = [
      ["merge-ask-merge", () => done("merge")],
      ["merge-ask-single", () => done("single")],
      ["merge-ask-cancel", () => done(null)],
    ];
    for (const [id, fn] of handlers) $<HTMLButtonElement>(id).addEventListener("click", fn);
    dlg.addEventListener("cancel", onCancel);
    dlg.showModal();
  });
}

async function mergeFiles(files: string[]) {
  try {
    const parts = await Promise.all(files.map(async (path) => new Uint8Array(await invoke<ArrayBuffer>("read_pdf_plain", { path }))));
    const merged = await mergeBytes(parts);
    const first = (files[0].split(/[\\/]/).pop() ?? "Dokument").replace(/\.pdf$/i, "");
    const target = await invoke<string>("library_pdf", merged, {
      headers: { "x-name": hex(`${first} + ${files.length - 1} weitere.pdf`) },
    });
    await openDoc(target);
  } catch (error) {
    say("Zusammenführen fehlgeschlagen: " + String(error));
  }
}

// ---------- Start ----------

if (IS_READER) {
  home.remove();
  void openPath(DOC as string);
} else {
  reader.remove();
  renderHome();
  initUpdater($<HTMLElement>("update-banner"));
  // Die Bibliothek verteilt eintreffende Dateien an Dokumentfenster.
  void listen<string>("folio://open", (e) => { if (e.payload) void openDoc(e.payload); });
  void invoke<string | null>("startup_file").then((p) => { if (p) void openDoc(p); });
  // Nach dem Schliessen eines Dokumentfensters kann sich die Seitenzahl
  // geaendert haben - beim Zurueckkommen neu aufbauen.
  window.addEventListener("focus", renderHome);
  window.addEventListener("storage", event => {
    if (event.key === KEY || event.key?.startsWith("folio.hidden.")) renderHome();
  });
}
