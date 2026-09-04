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

const container = $<HTMLDivElement>("container");
const drop = $<HTMLElement>("drop");
const fileLabel = $<HTMLElement>("file");
const pagesLabel = $<HTMLElement>("pages");
const colorInput = $<HTMLInputElement>("color");
const btnSave = $<HTMLButtonElement>("btn-save");
const btnInvert = $<HTMLButtonElement>("btn-invert");
const btnReset = $<HTMLButtonElement>("btn-zoom-reset");
const findbar = $<HTMLElement>("findbar");
const findInput = $<HTMLInputElement>("find-q");
const findCount = $<HTMLElement>("find-count");

const toolButtons: Record<string, HTMLButtonElement> = {
  none: $<HTMLButtonElement>("t-none"),
  mark: $<HTMLButtonElement>("t-mark"),
  ink: $<HTMLButtonElement>("t-ink"),
  text: $<HTMLButtonElement>("t-text"),
};

const TOOL_MODE: Record<string, number> = {
  none: EditorType.NONE,
  mark: EditorType.HIGHLIGHT,
  ink: EditorType.INK,
  text: EditorType.FREETEXT,
};

let currentPath: string | null = null;
let dirty = false;

/** PDF.js erwartet ein Lokalisierungsobjekt. Wir liefern keine
 *  Sprachdateien aus, deshalb ein Stellvertreter, der auf jede
 *  Methode still mit undefined antwortet statt zu krachen. */
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

// ---------- PDF.js-Komponenten ----------

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });

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

eventBus.on("pagesinit", () => {
  pdfViewer.currentScaleValue = "page-width";
  updateZoomLabel();
});

eventBus.on("pagechanging", (e: { pageNumber: number }) => {
  pagesLabel.textContent = e.pageNumber + " / " + pdfViewer.pagesCount;
});

eventBus.on("scalechanging", () => updateZoomLabel());

// Fehler sichtbar machen: in der App ist keine Konsole offen.
let lastError = "";
window.addEventListener("error", (e) => {
  lastError = "JS: " + e.message;
  fileLabel.textContent = lastError;
});
window.addEventListener("unhandledrejection", (e) => {
  lastError = "Promise: " + String((e as PromiseRejectionEvent).reason);
  fileLabel.textContent = lastError;
});
eventBus.on("textlayerrendered", (e: { pageNumber: number }) => {
  const n = document.querySelectorAll(".textLayer span").length;
  if (n === 0) fileLabel.textContent = `Textebene S.${e.pageNumber} leer. ${lastError}`;
});

/** Diese Version von PDF.js sendet kein Ereignis fuer "es gibt
 *  ungespeicherte Aenderungen". Der AnnotationStorage bietet dafuer zwei
 *  Rueckrufe an - die werden in loadBytes gesetzt. */
function markDirty(state: boolean) {
  dirty = state;
  btnSave.disabled = !state;
  btnSave.textContent = "Speichern";
}

function updateZoomLabel() {
  btnReset.textContent = Math.round((pdfViewer.currentScale || 1) * 100) + "%";
}

// ---------- Laden ----------

async function loadBytes(bytes: Uint8Array, name: string, path: string | null) {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  pdfViewer.setDocument(doc);
  linkService.setDocument(doc, null);
  // Die Typdefinition deklariert die Rueckrufe als `null`, zur Laufzeit
  // sind es Steckplaetze fuer Funktionen. Deshalb hier umtypisiert.
  const storage = doc.annotationStorage as unknown as {
    onSetModified: (() => void) | null;
    onResetModified: (() => void) | null;
  };
  storage.onSetModified = () => markDirty(true);
  storage.onResetModified = () => markDirty(false);
  currentPath = path;
  markDirty(false);
  drop.classList.add("gone");
  fileLabel.textContent = name;
  pagesLabel.textContent = "1 / " + doc.numPages;
}

async function openPath(path: string) {
  try {
    const buf = await invoke<ArrayBuffer>("read_pdf", { path });
    const name = path.split(/[\\/]/).pop() ?? path;
    await loadBytes(new Uint8Array(buf), name, path);
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

// ---------- Speichern ----------

const hex = (s: string) =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function save() {
  if (!currentPath || !pdfViewer.pdfDocument) return;
  btnSave.disabled = true;
  btnSave.textContent = "…";
  try {
    // saveDocument schreibt die Annotationen als echte PDF-Objekte
    // zurueck in die Datei - nicht als Bild eingebrannt.
    const bytes: Uint8Array = await pdfViewer.pdfDocument.saveDocument();
    // Rohbytes ueber den Request-Body, Pfad hex-kodiert im Kopf:
    // HTTP-Kopfzeilen vertragen keine Umlaute.
    await invoke("save_pdf", bytes, { headers: { "x-path": hex(currentPath) } });
    pdfViewer.pdfDocument.annotationStorage.resetModified();
    dirty = false;
    btnSave.disabled = true;
    btnSave.textContent = "Gespeichert";
    window.setTimeout(() => {
      if (!dirty) btnSave.textContent = "Speichern";
    }, 1400);
  } catch (err) {
    btnSave.textContent = "Speichern";
    btnSave.disabled = false;
    fileLabel.textContent = "Speichern fehlgeschlagen: " + String(err);
  }
}

// ---------- Werkzeuge ----------

let tool = "none";

function setTool(next: string) {
  tool = next;
  for (const [k, b] of Object.entries(toolButtons)) b.classList.toggle("on", k === next);
  if (!pdfViewer.pdfDocument) return;
  // Achtung: "switchannotationeditormode" wird von PDF.js nur GESENDET,
  // nicht empfangen - das Umschalten laeuft ueber diesen Setter.
  try {
    pdfViewer.annotationEditorMode = { mode: TOOL_MODE[next] };
  } catch (err) {
    fileLabel.textContent = "Werkzeug nicht verfügbar: " + String(err);
    return;
  }
  if (next !== "none") applyColor();
}

/** PDF.js schaltet den Modus manchmal selbst um, etwa nach Escape oder
 *  ueber den schwebenden Marker-Knopf. Dann zieht unsere Leiste nach. */
eventBus.on("switchannotationeditormode", (e: { mode: number }) => {
  const key = Object.keys(TOOL_MODE).find((k) => TOOL_MODE[k] === e.mode);
  if (!key || key === tool) return;
  tool = key;
  for (const [k, b] of Object.entries(toolButtons)) b.classList.toggle("on", k === key);
});

function applyColor() {
  const value = colorInput.value;
  const type =
    tool === "mark"
      ? EditorParams.HIGHLIGHT_COLOR
      : tool === "ink"
        ? EditorParams.INK_COLOR
        : tool === "text"
          ? EditorParams.FREETEXT_COLOR
          : null;
  if (type === null) return;
  eventBus.dispatch("switchannotationeditorparams", { source: window, type, value });
}

for (const [key, btn] of Object.entries(toolButtons)) {
  btn.addEventListener("click", () => setTool(key));
}
colorInput.addEventListener("input", applyColor);
btnSave.addEventListener("click", () => void save());

// ---------- Suche ----------
// PDF.js bringt einen eigenen Suchdienst mit: findet auch Treffer, die
// ueber mehrere Textfragmente laufen, und zaehlt sauber.

let findQuery = "";

function dispatchFind(again: boolean, previous = false) {
  eventBus.dispatch("find", {
    source: window,
    type: again ? "again" : "",
    query: findQuery,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: previous,
    matchDiacritics: false,
  });
}

eventBus.on(
  "updatefindmatchescount",
  (e: { matchesCount: { current: number; total: number } }) => {
    const { current, total } = e.matchesCount;
    findCount.textContent = total ? current + " / " + total : "kein Treffer";
  }
);

eventBus.on(
  "updatefindcontrolstate",
  (e: { matchesCount: { current: number; total: number } }) => {
    const { current, total } = e.matchesCount ?? { current: 0, total: 0 };
    if (!findQuery) findCount.textContent = "";
    else findCount.textContent = total ? current + " / " + total : "kein Treffer";
  }
);

let findTimer = 0;
findInput.addEventListener("input", () => {
  window.clearTimeout(findTimer);
  findTimer = window.setTimeout(() => {
    findQuery = findInput.value;
    if (!findQuery) { findCount.textContent = ""; }
    dispatchFind(false);
  }, 200);
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
  findQuery = "";
  findInput.value = "";
  findCount.textContent = "";
  dispatchFind(false);
}

$<HTMLButtonElement>("find-next").addEventListener("click", () => dispatchFind(true));
$<HTMLButtonElement>("find-prev").addEventListener("click", () => dispatchFind(true, true));
$<HTMLButtonElement>("find-close").addEventListener("click", closeFind);
$<HTMLButtonElement>("btn-find").addEventListener("click", openFind);

// ---------- Zoom, Invert, Tastatur ----------

function zoomBy(f: number) {
  if (!pdfViewer.pdfDocument) return;
  pdfViewer.currentScale = Math.min(6, Math.max(0.25, pdfViewer.currentScale * f));
}

$<HTMLButtonElement>("btn-zoom-in").addEventListener("click", () => zoomBy(1.25));
$<HTMLButtonElement>("btn-zoom-out").addEventListener("click", () => zoomBy(1 / 1.25));
btnReset.addEventListener("click", () => {
  if (pdfViewer.pdfDocument) pdfViewer.currentScaleValue = "page-width";
});

$<HTMLButtonElement>("btn-open").addEventListener("click", () => void pick());

btnInvert.addEventListener("click", () => {
  container.classList.toggle("invert");
  btnInvert.classList.toggle("on");
});

container.addEventListener(
  "wheel",
  (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  const typing =
    e.target instanceof HTMLElement &&
    (e.target.tagName === "INPUT" || e.target.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (ctrl && k === "o") { e.preventDefault(); void pick(); }
  else if (ctrl && k === "f") { e.preventDefault(); openFind(); }
  else if (ctrl && k === "s") { e.preventDefault(); void save(); }
  else if (ctrl && k === "i") { e.preventDefault(); btnInvert.click(); }
  else if (ctrl && (e.key === "+" || e.key === "=")) { e.preventDefault(); zoomBy(1.25); }
  else if (ctrl && e.key === "-") { e.preventDefault(); zoomBy(1 / 1.25); }
  else if (ctrl && e.key === "0") { e.preventDefault(); btnReset.click(); }
  else if (e.key === "F9") {
    // Diagnose: Zustand in die Leiste schreiben, weil in der App keine
    // Entwicklerkonsole offen ist.
    e.preventDefault();
    const layers = document.querySelectorAll(".textLayer").length;
    const spans = document.querySelectorAll(".textLayer span").length;
    const ed = document.querySelectorAll(".annotationEditorLayer").length;
    const edDisabled = document.querySelectorAll(".annotationEditorLayer.disabled").length;
    const sel = String(window.getSelection()?.toString().length ?? -1);
    let mode = "?";
    try { mode = String(pdfViewer.annotationEditorMode); } catch { mode = "Fehler"; }
    fileLabel.textContent =
      `Ebenen ${layers} | Spans ${spans} | Editor ${ed} (aus: ${edDisabled}) | Modus ${mode} | Auswahl ${sel}`;
  }
  else if (e.key === "F3") { e.preventDefault(); dispatchFind(true, e.shiftKey); }
  else if (e.key === "Escape" && !findbar.hidden) { e.preventDefault(); closeFind(); }
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
  if (e.payload.type === "over") document.body.classList.add("dragover");
  else if (e.payload.type === "leave") document.body.classList.remove("dragover");
  else if (e.payload.type === "drop") {
    document.body.classList.remove("dragover");
    const p = e.payload.paths.find((x) => x.toLowerCase().endsWith(".pdf"));
    if (p) void openPath(p);
  }
});

void listen<string>("folio://open", (e) => {
  if (e.payload) void openPath(e.payload);
});

void invoke<string | null>("startup_file").then((p) => {
  if (p) void openPath(p);
});
