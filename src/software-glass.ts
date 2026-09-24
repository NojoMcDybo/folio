import type { Painter } from "./glass";

type ChapterSurface = {
  owner: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

const SAMPLE_SIZE = 64;
const EDGE_WIDTH = 11;
const MIN_FRAME_MS = 1000 / 30;
const SLOW_FRAME_MS = 1000 / 24;

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function elementOpacity(element: HTMLElement) {
  let opacity = 1;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return 0;
    const part = Number(style.opacity);
    if (Number.isFinite(part)) opacity *= part;
  }
  return opacity;
}

function cornerRadius(element: HTMLElement, rect: DOMRect) {
  const value = getComputedStyle(element).borderTopLeftRadius.split(/[ /]/)[0];
  const radius = value.endsWith("%")
    ? parseFloat(value) / 100 * Math.min(rect.width, rect.height)
    : parseFloat(value);
  return clamp(Number.isFinite(radius) ? radius : 0, 0, Math.min(rect.width, rect.height) / 2);
}

function roundedRect(rect: DOMRect, radius: number, scale: number) {
  const path = new Path2D();
  path.roundRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale, radius * scale);
  return path;
}

/**
 * Canvas2D implementation of the optical glass layer. The document backdrop is
 * cached until invalidate(), while the inexpensive control composition follows
 * moving and fading DOM elements at a throttled animation-frame rate.
 */
export class SoftwareGlassLayer {
  private ctx: CanvasRenderingContext2D | null;
  private backdrop = document.createElement("canvas");
  private backdropCtx: CanvasRenderingContext2D | null;
  private sample = document.createElement("canvas");
  private sampleCtx: CanvasRenderingContext2D | null;
  private pixels = new Uint8ClampedArray();
  private painter: Painter = () => {};
  private dirty = true;
  private failed = false;
  private disposed = false;
  private suspended = false;
  private scale = 1;
  private dpr = 1;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private detailed = false;
  private raf = 0;
  private lastFrame = -Infinity;
  private frameInterval = MIN_FRAME_MS;
  private contrast = new WeakMap<HTMLElement, boolean>();
  private lightLevels = new WeakMap<HTMLElement, number>();
  private chapterSurfaces = new Set<ChapterSurface>();
  private reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
  private forcedColors = matchMedia("(forced-colors: active)");

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.backdropCtx = this.backdrop.getContext("2d", { alpha: false, willReadFrequently: false });
    this.sample.width = this.sample.height = SAMPLE_SIZE;
    this.sampleCtx = this.sample.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!this.ctx || !this.backdropCtx || !this.sampleCtx) {
      this.fail();
      return;
    }
    this.resize();
    window.addEventListener("resize", this.handleResize, { passive: true });
    this.reducedTransparency.addEventListener("change", this.handlePreferenceChange);
    this.forcedColors.addEventListener("change", this.handlePreferenceChange);
    this.raf = requestAnimationFrame(this.frame);
  }

  setPainter(painter: Painter) {
    this.painter = painter;
    this.invalidate();
  }

  invalidate() {
    if (!this.failed && !this.disposed) this.dirty = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.handleResize);
    this.reducedTransparency.removeEventListener("change", this.handlePreferenceChange);
    this.forcedColors.removeEventListener("change", this.handlePreferenceChange);
    try { this.clearOutput(); } catch { /* A failed context may no longer clear. */ }
    for (const surface of this.chapterSurfaces) surface.canvas.remove();
    this.chapterSurfaces.clear();
  }

  private handleResize = () => { try { this.resize(); } catch { this.fail(); } };

  private handlePreferenceChange = () => {
    try {
      if (this.accessibilityFallback()) this.clearOutput();
      else this.resize();
    } catch { this.fail(); }
  };

  private accessibilityFallback() {
    return this.reducedTransparency.matches || this.forcedColors.matches;
  }

  private fail() {
    if (this.failed) return;
    this.failed = true;
    document.body.classList.add("no-gl");
    document.body.dataset.glassRenderer = "css";
    this.dispose();
  }

  private clearOutput() {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const surface of this.chapterSurfaces) {
      surface.ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    }
  }

  private resize() {
    if (this.failed || this.disposed || !this.ctx || !this.backdropCtx) return;
    this.viewportWidth = Math.max(1, innerWidth);
    this.viewportHeight = Math.max(1, innerHeight);
    this.dpr = devicePixelRatio || 1;

    // Keep memory and fill-rate bounded on 4K screens and older integrated GPUs.
    const pixelBudget = this.detailed ? 2_400_000 : 1_800_000;
    const budgetScale = Math.sqrt(pixelBudget / (this.viewportWidth * this.viewportHeight));
    this.scale = Math.max(1 / Math.max(this.viewportWidth, this.viewportHeight),
      Math.min(this.dpr, this.detailed ? 1.5 : 1.25, budgetScale));
    const width = Math.max(1, Math.round(this.viewportWidth * this.scale));
    const height = Math.max(1, Math.round(this.viewportHeight * this.scale));
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${this.viewportWidth}px`;
    this.canvas.style.height = `${this.viewportHeight}px`;
    this.backdrop.width = width;
    this.backdrop.height = height;
    this.frameInterval = (navigator.hardwareConcurrency || 4) <= 4 || width * height > 2_000_000
      ? SLOW_FRAME_MS
      : MIN_FRAME_MS;
    this.dirty = true;
  }

  private refreshBackdrop() {
    if (!this.backdropCtx || !this.sampleCtx) return false;
    this.painter(this.backdropCtx, this.backdrop.width, this.backdrop.height);
    this.sampleCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.sampleCtx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    this.sampleCtx.drawImage(this.backdrop, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    try {
      this.pixels = this.sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    } catch {
      // A readable material can still be drawn when contrast sampling is blocked.
      this.pixels = new Uint8ClampedArray();
    }
    this.dirty = false;
    return true;
  }

  private updateContrast(element: HTMLElement, rect: DOMRect) {
    if (!this.pixels.length) return;
    let luminance = 0;
    for (const dx of [-0.22, 0, 0.22]) for (const dy of [-0.22, 0, 0.22]) {
      const x = clamp(Math.floor((rect.x + rect.width * (0.5 + dx)) / this.viewportWidth * SAMPLE_SIZE), 0, SAMPLE_SIZE - 1);
      const y = clamp(Math.floor((rect.y + rect.height * (0.5 + dy)) / this.viewportHeight * SAMPLE_SIZE), 0, SAMPLE_SIZE - 1);
      const index = (y * SAMPLE_SIZE + x) * 4;
      luminance += (this.pixels[index] * 0.2126 + this.pixels[index + 1] * 0.7152 + this.pixels[index + 2] * 0.0722) / 255;
    }
    const wasLight = this.contrast.get(element) ?? false;
    const light = luminance / 9 > (wasLight ? 0.45 : 0.59);
    if (light !== wasLight || !this.contrast.has(element)) {
      element.classList.toggle("glass--light", light);
      this.contrast.set(element, light);
    }
  }

  private blit(rect: DOMRect, offsetX = 0, offsetY = 0, padding = 0) {
    if (!this.ctx) return;
    const scale = this.scale;
    const left = (rect.x - padding) * scale;
    const top = (rect.y - padding) * scale;
    const right = (rect.right + padding) * scale;
    const bottom = (rect.bottom + padding) * scale;
    const sourceLeft = clamp(left + offsetX * scale, 0, this.backdrop.width);
    const sourceTop = clamp(top + offsetY * scale, 0, this.backdrop.height);
    const sourceRight = clamp(right + offsetX * scale, 0, this.backdrop.width);
    const sourceBottom = clamp(bottom + offsetY * scale, 0, this.backdrop.height);
    const width = sourceRight - sourceLeft;
    const height = sourceBottom - sourceTop;
    if (width <= 0 || height <= 0) return;
    const destinationLeft = left + (sourceLeft - left - offsetX * scale);
    const destinationTop = top + (sourceTop - top - offsetY * scale);
    this.ctx.drawImage(this.backdrop, sourceLeft, sourceTop, width, height, destinationLeft, destinationTop, width, height);
  }

  private drawRefraction(rect: DOMRect, radius: number, amount: number) {
    if (!this.ctx) return;
    const band = Math.min(EDGE_WIDTH, rect.width / 2, rect.height / 2);
    const step = 1 / this.scale;
    // Concentric rounded bands make distortion taper smoothly towards the
    // centre. Unlike rectangular strips, they have no visible corner seams.
    for (let depth = 0; depth < band; depth += step) {
      const next = Math.min(band, depth + step);
      const outer = new DOMRect(rect.x + depth, rect.y + depth, rect.width - 2 * depth, rect.height - 2 * depth);
      const ring = roundedRect(outer, Math.max(0, radius - depth), this.scale);
      if (rect.width > 2 * next && rect.height > 2 * next) {
        ring.addPath(roundedRect(new DOMRect(rect.x + next, rect.y + next,
          rect.width - 2 * next, rect.height - 2 * next), Math.max(0, radius - next), this.scale));
      }
      const offset = Math.min(amount, rect.width * 0.35, rect.height * 0.35) * Math.pow(1 - depth / band, 1.7);
      this.ctx.save();
      this.ctx.clip(ring, "evenodd");
      this.ctx.drawImage(this.backdrop,
        (rect.x + offset) * this.scale, (rect.y + offset) * this.scale,
        (rect.width - 2 * offset) * this.scale, (rect.height - 2 * offset) * this.scale,
        rect.x * this.scale, rect.y * this.scale, rect.width * this.scale, rect.height * this.scale);
      this.ctx.restore();
    }
  }

  private drawElement(element: HTMLElement, rect: DOMRect, opacity: number, light: number) {
    if (!this.ctx) return;
    const radius = cornerRadius(element, rect);
    const shape = roundedRect(rect, radius, this.scale);
    const panel = element.dataset.glass === "panel" || element.dataset.glass === "chapter";
    const chapter = element.dataset.glass === "chapter";
    const wide = element.id === "scroller" ? clamp((rect.width - 9) / 19, 0, 1) : 0;
    const hover = element.matches(":hover") ? 1 : 0;

    this.ctx.save();
    this.ctx.globalAlpha = opacity;
    this.ctx.clip(shape);
    if (panel) this.ctx.filter = `blur(${Math.max(2, 3 * this.scale)}px)`;
    this.blit(rect, 0, 0, panel ? 7 : 1);
    this.ctx.filter = "none";

    // Bounded optical refraction, with a stronger lens on the wide scrollbar.
    const refraction = 3.5 + 7.5 * wide + 0.6 * hover;
    this.drawRefraction(rect, radius, refraction);

    this.ctx.fillStyle = `rgba(255,255,255,${0.035 + 0.025 * hover + 0.025 * (panel ? 1 : 0)})`;
    this.ctx.fillRect(rect.x * this.scale, rect.y * this.scale, rect.width * this.scale, rect.height * this.scale);
    if (chapter) {
      this.ctx.fillStyle = `rgba(15,15,17,${0.3 + 0.42 * light})`;
      this.ctx.fillRect(rect.x * this.scale, rect.y * this.scale, rect.width * this.scale, rect.height * this.scale);
    }

    if (element.dataset.fill !== undefined) {
      const fill = clamp(Number(element.dataset.fill) || 0, 0, 1);
      this.ctx.fillStyle = `rgba(105,105,108,${0.58 * light})`;
      this.ctx.fillRect(rect.x * this.scale, rect.y * this.scale, rect.width * this.scale, rect.height * this.scale);
      this.ctx.fillStyle = `rgba(255,255,255,${0.37 + 0.11 * hover})`;
      this.ctx.fillRect(rect.x * this.scale, rect.y * this.scale, rect.width * this.scale, rect.height * this.scale);
      const core = this.ctx.createLinearGradient(rect.x * this.scale, 0, rect.right * this.scale, 0);
      core.addColorStop(0, `rgba(255,255,255,${0.96 - 0.36 * wide})`);
      core.addColorStop(0.4, "rgba(255,255,255,0.96)");
      core.addColorStop(0.6, "rgba(255,255,255,0.96)");
      core.addColorStop(1, `rgba(255,255,255,${0.96 - 0.36 * wide})`);
      this.ctx.fillStyle = core;
      this.ctx.fillRect(rect.x * this.scale, rect.y * this.scale, rect.width * this.scale, rect.height * fill * this.scale);
    }
    this.ctx.restore();

    this.ctx.save();
    this.ctx.globalAlpha = opacity;
    this.ctx.lineWidth = Math.max(1, this.scale);
    const rim = this.ctx.createLinearGradient(rect.x * this.scale, rect.y * this.scale, rect.right * this.scale, rect.bottom * this.scale);
    rim.addColorStop(0, `rgba(255,255,255,${0.43 + 0.06 * hover})`);
    rim.addColorStop(0.48, "rgba(255,255,255,0.10)");
    rim.addColorStop(1, "rgba(255,255,255,0.04)");
    this.ctx.strokeStyle = rim;
    this.ctx.stroke(shape);
    this.ctx.restore();
  }

  private chapterSurfaceFor(owner: HTMLElement) {
    for (const surface of this.chapterSurfaces) if (surface.owner === owner) return surface;
    const canvas = document.createElement("canvas");
    canvas.className = "chapter-surface";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    owner.prepend(canvas);
    const surface = { owner, canvas, ctx };
    this.chapterSurfaces.add(surface);
    return surface;
  }

  private copyChapter(owner: HTMLElement, rect: DOMRect) {
    const surface = this.chapterSurfaceFor(owner);
    if (!surface) return;
    const width = Math.max(1, Math.round(rect.width * this.scale));
    const height = Math.max(1, Math.round(rect.height * this.scale));
    if (surface.canvas.width !== width) surface.canvas.width = width;
    if (surface.canvas.height !== height) surface.canvas.height = height;
    surface.ctx.clearRect(0, 0, width, height);
    const sx = clamp(Math.round(rect.x * this.scale), 0, this.canvas.width);
    const sy = clamp(Math.round(rect.y * this.scale), 0, this.canvas.height);
    const dx = Math.max(0, sx - Math.round(rect.x * this.scale));
    const dy = Math.max(0, sy - Math.round(rect.y * this.scale));
    const sw = Math.min(width - dx, this.canvas.width - sx);
    const sh = Math.min(height - dy, this.canvas.height - sy);
    if (sw > 0 && sh > 0) surface.ctx.drawImage(this.canvas, sx, sy, sw, sh, dx, dy, sw, sh);
  }

  private removeUnusedChapterSurfaces(seen: Set<HTMLElement>) {
    for (const surface of this.chapterSurfaces) {
      if (!surface.owner.isConnected || !seen.has(surface.owner)) {
        surface.canvas.remove();
        this.chapterSurfaces.delete(surface);
      }
    }
  }

  private render() {
    if (!this.ctx) return;
    const seenChapters = new Set<HTMLElement>();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const element of document.querySelectorAll<HTMLElement>(".glass")) {
      const opacity = elementOpacity(element);
      if (opacity < 0.01) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.right < 0 || rect.left > this.viewportWidth || rect.bottom < 0 || rect.top > this.viewportHeight) continue;
      this.updateContrast(element, rect);
      const targetLight = this.contrast.get(element) ? 1 : 0;
      const priorLight = this.lightLevels.get(element) ?? targetLight;
      const light = priorLight + (targetLight - priorLight) * 0.18;
      this.lightLevels.set(element, light);
      this.drawElement(element, rect, opacity, light);
      if (element.dataset.glass === "chapter") {
        seenChapters.add(element);
        this.copyChapter(element, rect);
      }
    }
    this.removeUnusedChapterSurfaces(seenChapters);
  }

  private frame = (timestamp: number) => {
    if (this.disposed || this.failed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden || this.accessibilityFallback()) {
      try { if (!this.suspended) this.clearOutput(); } catch { this.fail(); }
      this.suspended = true;
      return;
    }
    this.suspended = false;
    if (timestamp - this.lastFrame < this.frameInterval) return;
    this.lastFrame = timestamp;
    try {
      const detailed = !document.body.classList.contains("bare") &&
        [...document.querySelectorAll<HTMLElement>("#outline-panel, #findbar")].some(element => elementOpacity(element) >= 0.01);
      if (detailed !== this.detailed || this.dpr !== (devicePixelRatio || 1) ||
          this.viewportWidth !== innerWidth || this.viewportHeight !== innerHeight) {
        this.detailed = detailed;
        this.resize();
      }
      if (this.dirty && !this.refreshBackdrop()) return;
      this.render();
    } catch {
      // Canvas failures are terminal for this instance; retain the CSS material.
      this.fail();
    }
  };
}
