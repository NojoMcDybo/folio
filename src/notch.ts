/**
 * Notch-Anbindung: meldet das offene Dokument als Live Activity an die Notch
 * (http://127.0.0.1:47800, siehe D:\Dev\notch\README.md).
 * Laeuft keine Notch, passiert nichts — alle Fehler werden geschluckt.
 *
 * Klick auf den Eintrag in der Notch oeffnet den Pfad; weil Folio der
 * Standard-PDF-Reader ist, holt das genau dieses Dokumentfenster nach vorn.
 */

import { invoke } from "@tauri-apps/api/core";
// Jede Minute auffrischen: startet die Notch neu, ist Folio nach spaetestens 60 s wieder drin.
// Stuerzt Folio ab, verschwindet der Eintrag nach der ttl von selbst.
const REFRESH_MS = 60_000;

let id = "";
let name = "";
let icon = "";
let last: Record<string, unknown> | null = null;
let debounce = 0;
let refresh = 0;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/** Ueber Rust senden (src-tauri/src/notch.rs): fetch() an localhost sperrt WebView2 inzwischen. */
function send(method: "POST" | "DELETE", path: string, data?: unknown) {
  return invoke("notch_send", { method, path, body: data ? JSON.stringify(data) : null }).catch(() => {});
}

/** Deckelbild auf Symbolgroesse verkleinern (die Notch zeigt es 30 px gross). */
function shrink(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = 72;
      const h = Math.round((img.height / img.width) * w) || w;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return resolve("");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

/** Bei Oeffnen und Seitenwechsel aufrufen. Wird entprellt, die Notch bekommt hoechstens alle 0,6 s etwas. */
export async function notchReading(path: string, page: number, pages: number, opts: { name?: string; thumb?: string } = {}) {
  id = "folio-" + hash(path);
  if (opts.name) name = opts.name.replace(/\.pdf$/i, "");
  if (opts.thumb) icon = await shrink(opts.thumb);
  last = {
    id,
    app: "Folio",
    title: name || "PDF",
    subtitle: `Seite ${page} von ${pages}`,
    value: String(page),
    unit: `/ ${pages}`,
    icon: icon || undefined,
    color: "#ffffff",
    progress: pages > 0 ? page / pages : 0,
    open: path,
    ttl: 180,
    priority: 0,
  };
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => last && send("POST", "/activity", last), 600);
  if (!refresh) refresh = window.setInterval(() => last && send("POST", "/activity", last), REFRESH_MS);
}

/** Beim Schliessen des Dokumentfensters. */
export function notchClosed() {
  window.clearTimeout(debounce);
  window.clearInterval(refresh);
  refresh = 0;
  last = null;
  if (id) void send("DELETE", `/activity/${id}`);
}

/** Eine Datei in die Ablage der Notch legen (z. B. nach dem Speichern einer Kopie). */
export function notchShelf(paths: string[]) {
  void send("POST", "/shelf", { paths });
}
