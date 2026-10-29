/**
 * Unterschrift einholen: am Handy (QR-Code, lokales Netz), direkt im Fenster mit Maus oder Stift,
 * oder eine gemerkte Unterschrift wiederverwenden. Ergebnis ist ein PNG mit transparentem Grund.
 */

import qrcode from "qrcode-generator";
import { invoke } from "@tauri-apps/api/core";

const STORE = "folio.signatures";
const MAX_SAVED = 3;

type Tab = "phone" | "draw" | "saved";

export function loadSaved(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && s.startsWith("data:image/png")).slice(0, MAX_SAVED) : [];
  } catch { return []; }
}

function saveSaved(list: string[]) {
  try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, MAX_SAVED))); } catch { /* Speicher voll: nicht merken */ }
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** Ein Zeichenfeld mit weichen Linien; liefert das auf die Tinte zugeschnittene PNG. */
class Pad {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private strokes: Array<Array<{ x: number; y: number; p: number }>> = [];
  private current: Array<{ x: number; y: number; p: number }> | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private dpr = Math.min(3, window.devicePixelRatio || 1);
  onInk: () => void = () => {};

  constructor() {
    this.canvas.className = "sign-canvas";
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const p = this.point(e);
      this.current = [p];
      this.strokes.push(this.current);
      this.grow(p);
      this.dot(p);
      this.onInk();
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.current) return;
      e.preventDefault();
      for (const ev of e.getCoalescedEvents?.() ?? [e]) {
        const p = this.point(ev);
        this.current.push(p);
        this.grow(p);
        const n = this.current.length;
        if (n > 1) this.segment(this.current[Math.max(0, n - 3)], this.current[n - 2], this.current[n - 1]);
      }
    });
    const up = () => { this.current = null; };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
  }

  /** Nach dem Einblenden: Pixelgroesse an die Anzeigegroesse anpassen. */
  fit() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.redraw();
  }

  get isEmpty() { return !this.box; }

  clear() {
    this.strokes = [];
    this.box = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private point(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr, p: e.pointerType === "pen" ? e.pressure : 0.5 };
  }
  private width(p: { p: number }) { return (2.4 + 2.4 * p.p) * this.dpr; }
  private style() {
    this.ctx.lineCap = "round"; this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = "#111"; this.ctx.fillStyle = "#111";
  }
  private dot(p: { x: number; y: number; p: number }) {
    this.style();
    this.ctx.beginPath(); this.ctx.arc(p.x, p.y, this.width(p) / 2, 0, Math.PI * 2); this.ctx.fill();
  }
  private segment(a: { x: number; y: number }, b: { x: number; y: number; p: number }, c: { x: number; y: number }) {
    this.style();
    this.ctx.beginPath(); this.ctx.moveTo(a.x, a.y);
    this.ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
    this.ctx.lineWidth = this.width(b); this.ctx.stroke();
  }
  private grow(p: { x: number; y: number; p: number }) {
    const w = this.width(p);
    const b = this.box;
    this.box = b
      ? { x0: Math.min(b.x0, p.x - w), y0: Math.min(b.y0, p.y - w), x1: Math.max(b.x1, p.x + w), y1: Math.max(b.y1, p.y + w) }
      : { x0: p.x - w, y0: p.y - w, x1: p.x + w, y1: p.y + w };
  }
  private redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes) {
      if (s.length === 1) { this.dot(s[0]); continue; }
      for (let i = 1; i < s.length; i++) this.segment(s[Math.max(0, i - 2)], s[i - 1], s[i]);
    }
  }

  async toPng(): Promise<string | null> {
    const b = this.box;
    if (!b) return null;
    const pad = 10 * this.dpr;
    const x = Math.max(0, b.x0 - pad), y = Math.max(0, b.y0 - pad);
    const w = Math.min(this.canvas.width, b.x1 + pad) - x, h = Math.min(this.canvas.height, b.y1 + pad) - y;
    const scale = Math.min(1, 900 / w);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    out.getContext("2d")!.drawImage(this.canvas, x, y, w, h, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    return blob ? blobToDataUrl(blob) : null;
  }
}

export class SignDialog {
  private tab: Tab = "phone";
  private poll = 0;
  private finish: ((png: string | null) => void) | null = null;
  private pad = new Pad();
  private body: HTMLElement;
  private remember: HTMLInputElement;
  private session = 0;

  constructor(private dlg: HTMLDialogElement) {
    dlg.innerHTML = `
      <div class="sign-box">
        <header><h2>Unterschreiben</h2>
          <div class="sign-tabs" role="tablist">
            <button type="button" role="tab" data-tab="phone">Am Handy</button>
            <button type="button" role="tab" data-tab="draw">Hier zeichnen</button>
            <button type="button" role="tab" data-tab="saved">Gespeichert</button>
          </div>
        </header>
        <div class="sign-body"></div>
        <footer>
          <label class="sign-remember"><input type="checkbox" checked> Unterschrift auf diesem Computer merken</label>
          <button type="button" class="sign-cancel">Abbrechen</button>
        </footer>
      </div>`;
    this.body = dlg.querySelector(".sign-body")!;
    this.remember = dlg.querySelector(".sign-remember input")!;
    dlg.querySelector(".sign-cancel")!.addEventListener("click", () => this.close(null));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); this.close(null); });
    for (const b of dlg.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      b.addEventListener("click", () => this.show(b.dataset.tab as Tab));
    }
  }

  /** Liefert die Unterschrift als PNG-Daten-URL, oder null bei Abbruch. */
  open(): Promise<string | null> {
    this.dlg.showModal();
    this.show(loadSaved().length ? "saved" : "phone");
    return new Promise((resolve) => { this.finish = resolve; });
  }

  private close(png: string | null) {
    this.session++;
    window.clearInterval(this.poll);
    void invoke("sign_stop").catch(() => {});
    if (png && this.remember.checked && this.tab !== "saved") {
      saveSaved([png, ...loadSaved().filter((s) => s !== png)]);
    }
    this.dlg.close();
    const done = this.finish;
    this.finish = null;
    done?.(png);
  }

  private show(tab: Tab) {
    this.tab = tab;
    this.session++;
    window.clearInterval(this.poll);
    void invoke("sign_stop").catch(() => {});
    for (const b of this.dlg.querySelectorAll<HTMLButtonElement>("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    this.dlg.querySelector<HTMLElement>(".sign-remember")!.hidden = tab === "saved";
    this.body.replaceChildren();
    if (tab === "phone") void this.showPhone();
    else if (tab === "draw") this.showDraw();
    else this.showSaved();
  }

  // ---------- Handy ----------

  private async showPhone() {
    const session = this.session;
    const status = document.createElement("p");
    status.className = "sign-status";
    status.textContent = "QR-Code wird vorbereitet …";
    this.body.replaceChildren(status);
    try {
      const info = await invoke<{ url: string; ip: string; port: number }>("sign_start");
      if (session !== this.session) return;
      const qr = qrcode(0, "M");
      qr.addData(info.url);
      qr.make();
      const code = document.createElement("div");
      code.className = "sign-qr";
      code.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
      code.querySelector("svg")?.setAttribute("aria-label", "QR-Code zum Öffnen der Unterschrifts-Seite am Handy");
      const hint = document.createElement("p");
      hint.className = "sign-hint";
      hint.textContent = "Mit der Handy-Kamera scannen und im Browser unterschreiben. Handy und Computer müssen im selben WLAN sein.";
      const url = document.createElement("code");
      url.className = "sign-url";
      url.textContent = info.url.replace(/\/s\/[0-9a-f]+$/, "/s/…");
      const fw = document.createElement("p");
      fw.className = "sign-fine";
      fw.textContent = "Beim ersten Mal fragt Windows nach der Firewall: „Private Netzwerke“ zulassen. Funktioniert es im Gast-WLAN nicht, hilft „Hier zeichnen“.";
      this.body.replaceChildren(code, status, hint, url, fw);
      status.textContent = "Warte auf das Handy …";
      this.poll = window.setInterval(() => void this.check(session, status), 700);
    } catch (error) {
      if (session !== this.session) return;
      status.className = "sign-status err";
      status.textContent = String(error);
    }
  }

  private async check(session: number, status: HTMLElement) {
    try {
      const s = await invoke<string>("sign_status");
      if (session !== this.session) return;
      if (s === "connected") status.textContent = "Handy verbunden – bitte unterschreiben …";
      else if (s === "expired") {
        window.clearInterval(this.poll);
        status.className = "sign-status err";
        status.textContent = "Die Anfrage ist abgelaufen. Bitte den Reiter neu öffnen.";
      } else if (s === "done") {
        window.clearInterval(this.poll);
        status.textContent = "Unterschrift empfangen ✓";
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("sign_take"));
        this.close(await blobToDataUrl(new Blob([bytes], { type: "image/png" })));
      }
    } catch { /* naechster Versuch */ }
  }

  // ---------- Zeichnen ----------

  private showDraw() {
    const wrap = document.createElement("div");
    wrap.className = "sign-pad";
    const line = document.createElement("div");
    line.className = "sign-line";
    wrap.append(line, this.pad.canvas);
    const row = document.createElement("div");
    row.className = "sign-row";
    const clear = document.createElement("button");
    clear.type = "button"; clear.textContent = "Neu";
    const use = document.createElement("button");
    use.type = "button"; use.textContent = "Übernehmen"; use.className = "primary"; use.disabled = true;
    row.append(clear, use);
    this.body.replaceChildren(wrap, row);
    this.pad.clear();
    this.pad.fit();
    this.pad.onInk = () => { use.disabled = false; };
    clear.addEventListener("click", () => { this.pad.clear(); use.disabled = true; });
    use.addEventListener("click", async () => { const png = await this.pad.toPng(); if (png) this.close(png); });
  }

  // ---------- Gespeichert ----------

  private showSaved() {
    const list = loadSaved();
    const grid = document.createElement("div");
    grid.className = "sign-saved";
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "sign-hint";
      empty.textContent = "Noch keine gemerkte Unterschrift. Unterschreibe einmal am Handy oder hier im Fenster.";
      this.body.replaceChildren(empty);
      return;
    }
    for (const png of list) {
      const item = document.createElement("div");
      item.className = "sign-item";
      const use = document.createElement("button");
      use.type = "button"; use.className = "sign-use"; use.title = "Diese Unterschrift einfügen";
      const img = document.createElement("img");
      img.src = png; img.alt = "Gemerkte Unterschrift";
      use.appendChild(img);
      use.addEventListener("click", () => this.close(png));
      const del = document.createElement("button");
      del.type = "button"; del.className = "sign-del"; del.textContent = "Löschen";
      del.addEventListener("click", () => { saveSaved(loadSaved().filter((s) => s !== png)); this.showSaved(); });
      item.append(use, del);
      grid.appendChild(item);
    }
    const note = document.createElement("p");
    note.className = "sign-fine";
    note.textContent = "Gemerkte Unterschriften liegen nur auf diesem Computer (im Profil von Folio).";
    this.body.replaceChildren(grid, note);
  }
}
