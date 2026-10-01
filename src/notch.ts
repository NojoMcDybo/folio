/**
 * Notch-Anbindung (http://127.0.0.1:47800, siehe D:\Dev\notch\README.md).
 * Laeuft keine Notch, passiert nichts — alle Fehler werden geschluckt.
 *
 * - Das offene Dokument steht als Eintrag in der Notch: Deckel, Name, aktuelle Seite.
 *   Die Seite wird beim Blaettern sofort nachgefuehrt (hoechstens alle 80 ms).
 * - In der aufgeklappten Notch steht dauerhaft Folios Suchfeld. Tippen sucht im
 *   Dokument, Enter springt zum Treffer und holt das Fenster nach vorn.
 * - Klick auf den Eintrag oeffnet den Pfad; weil Folio der Standard-PDF-Reader ist,
 *   kommt genau dieses Dokumentfenster nach vorn.
 */

import { invoke } from "@tauri-apps/api/core";

// Jede Minute auffrischen: startet die Notch neu, ist Folio nach spaetestens 60 s wieder drin.
// Stuerzt Folio ab, verschwindet der Eintrag nach der ttl von selbst.
const REFRESH_MS = 60_000;
/** Mindestabstand zwischen zwei Seitenmeldungen beim schnellen Scrollen */
const PAGE_MS = 80;
const POLL_MS = 200;

let id = "";
let name = "";
let icon = "";
let path = "";
let page = 0;
let pages = 0;
let query = "";
let hits: { current: number; total: number } | null = null;

let lastSent = 0;
let trailing = 0;
let refresh = 0;
let poll = 0;
let after = -1;

export type NotchSearch = (q: string, submit: "" | "next" | "prev") => void;
let onSearch: NotchSearch | null = null;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/** Ueber Rust senden (src-tauri/src/notch.rs): fetch() an localhost sperrt WebView2 inzwischen. */
function send(method: "POST" | "DELETE", p: string, data?: unknown) {
  return invoke("notch_send", { method, path: p, body: data ? JSON.stringify(data) : null }).catch(() => {});
}

/** Deckelbild auf Symbolgroesse verkleinern (die Notch zeigt es ~36 px hoch). */
function shrink(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const h = 96;
      const w = Math.round((img.width / img.height) * h) || h;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return resolve("");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

function subtitle() {
  if (query && hits) return hits.total ? `„${query}“ · Treffer ${hits.current} von ${hits.total}` : `„${query}“ · keine Treffer`;
  return `Seite ${page} von ${pages}`;
}

function activity() {
  return {
    id,
    app: "Folio",
    title: name || "PDF",
    subtitle: subtitle(),
    value: String(page),
    unit: `/ ${pages}`,
    icon: icon || undefined,
    color: "#ffffff",
    open: path,
    input: { placeholder: "In Folio suchen", value: query },
    ttl: 180,
    priority: 0,
  };
}

/** Sofort senden, beim schnellen Scrollen aber hoechstens alle PAGE_MS (die letzte Seite kommt immer an). */
function push() {
  if (!id) return;
  window.clearTimeout(trailing);
  const wait = PAGE_MS - (Date.now() - lastSent);
  if (wait <= 0) {
    lastSent = Date.now();
    void send("POST", "/activity", activity());
  } else {
    trailing = window.setTimeout(push, wait);
  }
}

// ---------- Ereignisse aus der Notch (Suchfeld) ----------

type NotchEvent = { seq: number; activity: string; action: string; value?: string };

async function pollEvents() {
  const raw = await invoke<string | null>("notch_events", { after: Math.max(0, after) }).catch(() => null);
  if (!raw) return;
  let list: NotchEvent[];
  try { list = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(list)) return;
  const fresh = after >= 0; // beim ersten Abholen nur den Stand merken, alte Eingaben nicht nachspielen
  for (const e of list) {
    after = Math.max(after, e.seq);
    if (!fresh || e.activity !== id || !onSearch) continue;
    if (e.action === "input") onSearch(e.value ?? "", "");
    else if (e.action === "submit") onSearch(e.value ?? "", "next");
    else if (e.action === "submit-prev") onSearch(e.value ?? "", "prev");
  }
  if (after < 0) after = 0;
}

/** Folio reagiert auf das Suchfeld in der Notch. */
export function notchOnSearch(fn: NotchSearch) {
  onSearch = fn;
}

/** Bei Oeffnen und bei jedem Seitenwechsel aufrufen. */
export async function notchReading(p: string, pg: number, pgs: number, opts: { name?: string; thumb?: string } = {}) {
  id = "folio-" + hash(p);
  path = p;
  page = pg;
  pages = pgs;
  if (opts.name) name = opts.name.replace(/\.pdf$/i, "");
  if (opts.thumb) icon = await shrink(opts.thumb);
  push();
  if (!refresh) refresh = window.setInterval(() => id && send("POST", "/activity", activity()), REFRESH_MS);
  if (!poll) {
    void pollEvents();
    poll = window.setInterval(() => void pollEvents(), POLL_MS);
  }
}

/** Suchbegriff und Trefferstand an die Notch melden (Folios eigene Suchleiste ruft das auf). */
export function notchSearchState(q: string, m: { current: number; total: number } | null) {
  if (q === query && m?.current === hits?.current && m?.total === hits?.total) return;
  query = q;
  hits = q ? m : null;
  push();
}

/** Beim Schliessen des Dokumentfensters. */
export function notchClosed() {
  window.clearTimeout(trailing);
  window.clearInterval(refresh);
  window.clearInterval(poll);
  refresh = poll = 0;
  if (id) void send("DELETE", `/activity/${id}`);
  id = "";
}

/** Eine Datei in die Ablage der Notch legen (z. B. nach dem Speichern einer Kopie). */
export function notchShelf(paths: string[]) {
  void send("POST", "/shelf", { paths });
}
