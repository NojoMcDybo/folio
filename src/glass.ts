/**
 * Glasschicht auf WebGL.
 *
 * Der Hintergrund hinter den Bedienelementen besteht aus Flaechen, die wir
 * selbst zeichnen - die Seiten-Canvas von PDF.js und der Grund der
 * Bibliothek. Deshalb koennen wir ihn in eine Textur kopieren und in einem
 * Shader brechen, statt wie die ueblichen Web-Bibliotheken das DOM
 * abzufotografieren.
 *
 * Die Knoepfe sind keine flachen Scheiben mit abgeschraegter Kante, sondern
 * Kuppeln: die Dicke waechst von der Kante bis zur Mitte, die Brechung
 * laeuft ueber die ganze Flaeche. Die Symbole liegen nicht darauf, sondern
 * darin - sie werden in eine Textur gezeichnet, mit der Kuppel verzerrt und
 * leuchten von innen, unter der Maus heller.
 *
 * Je Bild:
 *   1. Hintergrund in ein 2D-Canvas malen (nur wenn er sich geaendert hat)
 *   2. daraus eine unscharfe Fassung in halber Aufloesung rechnen
 *   3. je .glass-Element ein Rechteck: Kuppel, Brechung, Toenung, Symbol
 */

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** Ueberabtastung der Symboltexturen: doppelt so fein wie der Bildschirm,
 *  damit die Zeichen unter der Lupe nicht ausfransen. */
const ICON_SS = 2;

const VS = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;
uniform vec4 uRect;
void main() {
  vec2 px = uRect.xy + aPos * uRect.zw;
  vec2 c = (px / uRes) * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;
uniform float uFlip;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uFlip > 0.5) uv.y = 1.0 - uv.y;
  vec2 s = uDir / uRes;
  if (uFlip > 0.5) s.y = -s.y;
  vec4 sum = texture(uTex, uv) * 0.227;
  sum += (texture(uTex, uv + s * 1.385) + texture(uTex, uv - s * 1.385)) * 0.316;
  sum += (texture(uTex, uv + s * 3.231) + texture(uTex, uv - s * 3.231)) * 0.070;
  outColor = sum;
}`;

const FS_GLASS = `#version 300 es
precision highp float;

uniform vec2 uRes;      // Fenstergroesse in Geraetepixeln
uniform vec4 uRect;     // x, y, w, h
uniform float uRadius;
uniform vec4 uTint;
uniform float uDpr;     // Geraetepixel je CSS-Pixel
uniform float uGlow;    // 0 = ruhig, 1 = angefasst, darueber Blitz
uniform float uLumLod;  // Grobstufe, aus der die Grundhelligkeit kommt
uniform float uIconLod; // Stufenversatz durch die Ueberabtastung
uniform float uFill;    // Fuellstand von oben, 0 = aus
uniform float uHasIcon;
uniform vec3 uIconCol;
uniform sampler2D uBack;
uniform sampler2D uBlur;
uniform sampler2D uIcon;
out vec4 outColor;

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  // Bildpunkt in Fensterkoordinaten, Ursprung oben links
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 hs = uRect.zw * 0.5;              // "half" ist in GLSL reserviert
  vec2 p = frag - (uRect.xy + hs);
  float r = min(uRadius, min(hs.x, hs.y));

  float d = sdBox(p, hs, r);
  if (d > 0.5) discard;

  // Normale aus dem Gefaelle der Abstandsfunktion: zeigt nach aussen
  vec2 e = vec2(1.0, 0.0);
  vec2 n = normalize(vec2(
    sdBox(p + e.xy, hs, r) - sdBox(p - e.xy, hs, r),
    sdBox(p + e.yx, hs, r) - sdBox(p - e.yx, hs, r)
  ) + 1e-6);

  // Kuppel: u laeuft von 0 an der Kante bis 1 im Kern, die Hoehe folgt
  // einem Kreisquerschnitt.
  float R = min(hs.x, hs.y);
  float u = clamp(-d / R, 0.0, 1.0);
  float dome = sqrt(max(0.0, 1.0 - (1.0 - u) * (1.0 - u)));

  // Zwei Anteile: ein weicher ueber die ganze Flaeche und die echte
  // Kuppelneigung, die zur Kante hin steil wird - dort steht das Glas
  // fast senkrecht und bricht entsprechend hart.
  float soft = pow(1.0 - u, 1.35);
  float rim = min((1.0 - u) / max(dome, 0.16), 6.0);
  float bend = soft * 0.55 + rim * 0.75;

  // Nach innen abtasten: die Kuppel wirkt wie eine Lupe.
  float amp = clamp(R * 0.30, 5.0 * uDpr, 22.0 * uDpr);
  vec2 off = -n * bend * amp / uRes;

  vec2 uv = frag / uRes;
  vec3 refr;
  refr.r = texture(uBack, uv + off * 1.06).r;
  refr.g = texture(uBack, uv + off).g;
  refr.b = texture(uBack, uv + off * 0.94).b;

  // Koerper: unscharfe Fassung, wandert leicht mit
  vec2 buv = uv + off * 0.45;
  vec3 blurCol = texture(uBlur, vec2(buv.x, 1.0 - buv.y)).rgb;

  float mixw = clamp(0.30 + 0.55 * min(bend, 1.6), 0.0, 1.0);
  vec3 col = mix(blurCol, refr, mixw);

  // Licht des Symbols: Kern, enger Hof und ein breiter Schein. Der breite
  // kommt aus einer groben Stufe der Symboltextur - billiger als viele
  // Proben und weit genug, um den ganzen Knopf zu erreichen.
  float core = 0.0, halo = 0.0, wide = 0.0;
  if (uHasIcon > 0.5) {
    vec2 iuv = (frag - uRect.xy) / uRect.zw;
    vec2 ioff = off * uRes / uRect.zw * 0.55;
    core = texture(uIcon, iuv + ioff).a;
    halo = textureLod(uIcon, iuv + ioff, 2.5 + uIconLod).a;
    wide = clamp(textureLod(uIcon, iuv + ioff * 0.4, 4.6 + uIconLod).a * 7.0, 0.0, 1.0);
  }

  // Toenung nach dem Hintergrund: je heller der Grund, desto dunkler die
  // Scheibe. Ueber dunklem Grund bleibt fast nichts uebrig - dort traegt
  // das Licht des Symbols. Leuchtet es, wird die Scheibe klarer.
  vec2 cuv = (uRect.xy + hs) / uRes;
  vec3 amb = textureLod(uBlur, vec2(cuv.x, 1.0 - cuv.y), uLumLod).rgb;
  float lum = dot(amb, vec3(0.2126, 0.7152, 0.0722));
  float ta = uTint.a * mix(0.18, 1.0, smoothstep(0.02, 0.62, lum));
  ta *= 1.0 - 0.35 * clamp(wide * (0.5 + uGlow), 0.0, 1.0);
  col = mix(col, uTint.rgb, ta);

  // Kern und Hof leuchten, der breite Schein hebt den ganzen Koerper an
  // und tritt an der duennen Kante wieder aus.
  // Ueber hellem Grund traegt kein Leuchten: dort wird das Zeichen zur
  // dunklen Silhouette, ueber dunklem leuchtet es.
  float g = uGlow;
  float bright = smoothstep(0.22, 0.60, lum);
  float glowK = 1.0 - 0.8 * bright;
  vec3 ink = mix(uIconCol * (1.0 + 0.55 * g), vec3(0.07, 0.07, 0.10), bright);
  col = mix(col, ink, clamp(core * (0.88 + 0.12 * g), 0.0, 1.0));
  col += uIconCol * halo * (0.45 + 1.10 * g) * (0.30 + 0.70 * dome) * glowK;
  col += uIconCol * wide * (0.16 + 0.55 * g) * (0.35 + 0.65 * dome) * glowK;
  col += uIconCol * wide * (0.10 + 0.30 * g) * (1.0 - dome) * glowK;

  // Fuellstand: der obere Teil steht unter Licht. Die Front ist eine
  // schmale helle Linie, damit man den Stand genau ablesen kann.
  if (uFill > 0.0001) {
    float ly = (frag.y - uRect.y) / uRect.w;
    float f = 1.0 - smoothstep(uFill - 0.006, uFill + 0.006, ly);
    float front = exp(-pow((ly - uFill) / 0.035, 2.0));
    vec3 lightCol = vec3(0.66, 0.61, 1.0);
    // Der leere Teil glimmt schwach, sonst waere der Stab ueber dem
    // schwarzen Rand gar nicht zu finden.
    col += lightCol * (0.05 + 0.05 * g) * (0.4 + 0.6 * dome);
    col += lightCol * f * (0.20 + 0.34 * dome) * (0.85 + 0.5 * g);
    col += lightCol * front * (0.22 + 0.3 * g);
  }

  float a = 1.0 - smoothstep(-1.0, 0.5, d);
  outColor = vec4(col, a);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) ?? "Shader-Fehler");
    }
    return s;
  };
  const p = gl.createProgram() as WebGLProgram;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) ?? "Link-Fehler");
  }
  return p;
}

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number, mips = false) {
  const tex = gl.createTexture() as WebGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  // Die groben Stufen liefern die Grundhelligkeit hinter einem Element.
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer() as WebGLFramebuffer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

// ---------- Symbole in eine Textur zeichnen ----------

const num = (el: Element, name: string, fallback = 0) => {
  const v = el.getAttribute(name);
  return v === null ? fallback : parseFloat(v);
};

/** Ein SVG-Kind als Pfad. Unsere Symbole bestehen nur aus path, circle
 *  und rect - mehr muss der Zeichner nicht koennen. */
function pathOf(el: Element): Path2D | null {
  switch (el.tagName.toLowerCase()) {
    case "path": {
      const d = el.getAttribute("d");
      return d ? new Path2D(d) : null;
    }
    case "circle": {
      const p = new Path2D();
      p.arc(num(el, "cx"), num(el, "cy"), num(el, "r"), 0, Math.PI * 2);
      return p;
    }
    case "rect": {
      const p = new Path2D();
      p.roundRect(num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), num(el, "rx"));
      return p;
    }
    case "line": {
      const p = new Path2D();
      p.moveTo(num(el, "x1"), num(el, "y1"));
      p.lineTo(num(el, "x2"), num(el, "y2"));
      return p;
    }
    default:
      return null;
  }
}

/** Drehwinkel aus dem berechneten Stil - so bleiben CSS-Animationen
 *  (etwa der kippende Halbmond) auch im Glas erhalten. */
function rotOf(cs: CSSStyleDeclaration) {
  const t = cs.transform;
  if (!t || t === "none") return 0;
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (!m) return 0;
  const v = m[1].split(",").map(Number);
  return Math.atan2(v[1], v[0]);
}

type IconItem = { svg: SVGSVGElement; r: DOMRect; rot: number; alpha: number };

export class GlassLayer {
  private gl: WebGL2RenderingContext;
  private pBlur: WebGLProgram;
  private pGlass: WebGLProgram;
  private back = document.createElement("canvas");
  private bctx: CanvasRenderingContext2D;
  private backTex: WebGLTexture;
  private blank: WebGLTexture;
  private a!: ReturnType<typeof makeTarget>;
  private b!: ReturnType<typeof makeTarget>;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private dirty = true;
  private painter: Painter = () => {};
  private icons = new WeakMap<Element, { tex: WebGLTexture; key: string; cv: HTMLCanvasElement }>();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 nicht verfügbar");
    this.gl = gl;
    this.bctx = this.back.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;

    this.pBlur = compile(gl, VS, FS_BLUR);
    this.pGlass = compile(gl, VS, FS_GLASS);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.backTex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, this.backTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Platzhalter fuer Flaechen ohne Symbol
    this.blank = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame(this.frame);
  }

  setPainter(fn: Painter) {
    this.painter = fn;
    this.dirty = true;
  }

  /** Hintergrund hat sich geaendert - beim naechsten Bild neu abziehen. */
  invalidate() {
    this.dirty = true;
  }


  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";

    // Der Abzug liegt in Geraetepixeln, nicht in CSS-Pixeln: sonst wird
    // das Gebrochene beim Zeichnen wieder hochskaliert und wirkt weich.
    this.back.width = Math.max(2, Math.round(this.w * dpr));
    this.back.height = Math.max(2, Math.round(this.h * dpr));

    const bw = Math.max(2, Math.round(this.back.width / 2));
    const bh = Math.max(2, Math.round(this.back.height / 2));
    this.a = makeTarget(this.gl, bw, bh);
    this.b = makeTarget(this.gl, bw, bh, true);
    this.dirty = true;
  }

  private uni(p: WebGLProgram, name: string) {
    return this.gl.getUniformLocation(p, name);
  }

  private quad(p: WebGLProgram, res: [number, number], rect: [number, number, number, number]) {
    const gl = this.gl;
    gl.uniform2f(this.uni(p, "uRes"), res[0], res[1]);
    gl.uniform4f(this.uni(p, "uRect"), rect[0], rect[1], rect[2], rect[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Helligkeit eines Symbols: Grundwert, heller unter der Maus, heller
   *  wenn das Werkzeug an ist. */
  private glowOf(owner: HTMLElement, cs: CSSStyleDeclaration) {
    const hover = owner.matches(":hover") ? 1 : 0;
    const on = owner.classList.contains("on") ? 1 : 0;
    const dim = parseFloat(cs.opacity) || 1;
    return {
      alpha: Math.min(1, 0.62 + 0.24 * hover + 0.16 * on) * dim,
      glow: (0.34 * hover + 0.34 * on) * dim,
      on,
    };
  }

  /** Alle Symbole eines Glaselements in eine Textur in dessen Groesse.
   *  Wird nur neu gezeichnet, wenn sich wirklich etwas geaendert hat. */
  private iconFor(el: HTMLElement, host: DOMRect, k: number) {
    const svgs = Array.from(el.querySelectorAll("svg")) as SVGSVGElement[];
    if (!svgs.length) return null;

    const items: IconItem[] = [];
    let glow = 0;
    let col: [number, number, number] = [1, 1, 1];
    for (const svg of svgs) {
      const r = svg.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const owner = (svg.parentElement ?? el) as HTMLElement;
      const cs = getComputedStyle(owner);
      if (cs.visibility === "hidden") continue;
      const g = this.glowOf(owner, cs);
      if (g.alpha < 0.02) continue;
      items.push({ svg, r, rot: rotOf(getComputedStyle(svg)), alpha: g.alpha });
      glow = Math.max(glow, g.glow);
      // Eingeschaltet leuchtet violett, der Schliessen-Knopf unter der
      // Maus rot - sonst weiss.
      if (g.on) col = [0.72, 0.65, 1];
      if (owner.classList.contains("danger") && owner.matches(":hover")) col = [1, 0.42, 0.38];
    }
    if (!items.length) return null;

    // Ueberabtastet zeichnen: die Lupe vergroessert das Zeichen, da soll
    // keine Treppe sichtbar werden.
    const ks = k * ICON_SS;
    const W = Math.max(2, Math.round(host.width * ks));
    const H = Math.max(2, Math.round(host.height * ks));
    const key =
      W + "x" + H + "|" +
      items
        .map((i) =>
          [
            i.svg.innerHTML,
            Math.round((i.r.x - host.x) * 8),
            Math.round((i.r.y - host.y) * 8),
            Math.round(i.r.width * 8),
            i.rot.toFixed(2),
            i.alpha.toFixed(2),
          ].join(",")
        )
        .join(";");

    const gl = this.gl;
    const cached = this.icons.get(el);
    if (cached && cached.key === key) return { tex: cached.tex, glow, col };

    const cv = cached?.cv ?? document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const c = cv.getContext("2d") as CanvasRenderingContext2D;
    c.clearRect(0, 0, W, H);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#fff";
    c.fillStyle = "#fff";

    for (const it of items) {
      const vb = (it.svg.getAttribute("viewBox") ?? "0 0 24 24").split(/[\s,]+/).map(Number);
      const [vx, vy, vw, vh] = vb.length === 4 ? vb : [0, 0, 24, 24];
      c.save();
      c.translate((it.r.x - host.x + it.r.width / 2) * ks, (it.r.y - host.y + it.r.height / 2) * ks);
      if (it.rot) c.rotate(it.rot);
      c.scale((it.r.width * ks) / vw, (it.r.height * ks) / vh);
      c.translate(-vx - vw / 2, -vy - vh / 2);
      c.lineWidth = parseFloat(it.svg.getAttribute("stroke-width") ?? "1.6");
      for (const child of Array.from(it.svg.children)) {
        const p = pathOf(child);
        if (!p) continue;
        const fill = child.getAttribute("fill");
        const stroke = child.getAttribute("stroke");
        if (fill && fill !== "none") {
          c.globalAlpha = it.alpha * parseFloat(child.getAttribute("fill-opacity") ?? "1");
          c.fill(p);
        }
        if (stroke !== "none") {
          c.globalAlpha = it.alpha;
          c.stroke(p);
        }
      }
      c.restore();
    }

    const tex = cached?.tex ?? (gl.createTexture() as WebGLTexture);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    // Grobstufen: aus ihnen holt sich der Shader den breiten Schein.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.icons.set(el, { tex, key, cv });
    return { tex, glow, col };
  }

  private frame = () => {
    const gl = this.gl;
    // Achtung: offsetParent ist bei position:fixed immer null - taugt hier
    // nicht als Sichtbarkeitspruefung. Deshalb ueber den berechneten Stil.
    const els = Array.from(document.querySelectorAll<HTMLElement>(".glass")).filter((el) => {
      if (el.hasAttribute("hidden")) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (parseFloat(cs.opacity) < 0.03) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });

    if (this.dirty) {
      this.painter(this.bctx, this.back.width, this.back.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.backTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.back);

      // zwei Durchgaenge Weichzeichnen in halber Aufloesung
      gl.useProgram(this.pBlur);
      gl.uniform1i(this.uni(this.pBlur, "uTex"), 0);
      for (const [src, dst, dir, flip] of [
        [this.backTex, this.a, [1, 0], 1],
        [this.a.tex, this.b, [0, 1], 0],
      ] as [WebGLTexture, ReturnType<typeof makeTarget>, number[], number][]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.uniform2f(this.uni(this.pBlur, "uDir"), dir[0] * 7, dir[1] * 7);
        gl.uniform1f(this.uni(this.pBlur, "uFlip"), flip);
        this.quad(this.pBlur, [dst.w, dst.h], [0, 0, dst.w, dst.h]);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // Grobstufen der unscharfen Fassung neu bilden - daraus kommt die
      // Grundhelligkeit, nach der sich die Toenung richtet.
      gl.bindTexture(gl.TEXTURE_2D, this.b.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.enable(gl.BLEND);
      this.dirty = false;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (els.length) {
      gl.useProgram(this.pGlass);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.backTex);
      gl.uniform1i(this.uni(this.pGlass, "uBack"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.b.tex);
      gl.uniform1i(this.uni(this.pGlass, "uBlur"), 1);
      gl.uniform1i(this.uni(this.pGlass, "uIcon"), 2);

      const k = this.dpr;
      for (const el of els) {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const rad = parseFloat(cs.borderTopLeftRadius) || 18;
        const tint = el.dataset.tint;
        // Der vierte Wert ist die staerkste Toenung - erreicht wird sie
        // nur ueber hellem Grund.
        const [tr, tg, tb, ta] = tint
          ? tint.split(",").map(Number)
          : [0.05, 0.05, 0.07, 0.4];

        // Symboltextur zuerst, sie belegt Einheit 2.
        gl.activeTexture(gl.TEXTURE2);
        const ico = this.iconFor(el, b, k);
        gl.bindTexture(gl.TEXTURE_2D, ico ? ico.tex : this.blank);

        // Alles in Geraetepixeln, damit gl_FragCoord im Shader passt.
        gl.uniform1f(this.uni(this.pGlass, "uRadius"), rad * k);
        gl.uniform1f(this.uni(this.pGlass, "uDpr"), k);
        // Grobstufe, die ungefaehr der Flaeche des Elements entspricht:
        // die unscharfe Fassung liegt in halber Geraeteaufloesung.
        const span = (Math.max(4, Math.min(b.width, b.height)) * k) / 2;
        gl.uniform1f(
          this.uni(this.pGlass, "uLumLod"),
          Math.min(8, Math.max(1, Math.log2(span)))
        );
        gl.uniform1f(this.uni(this.pGlass, "uIconLod"), Math.log2(ICON_SS));
        gl.uniform1f(this.uni(this.pGlass, "uFill"), parseFloat(el.dataset.fill ?? "0") || 0);
        gl.uniform4f(this.uni(this.pGlass, "uTint"), tr, tg, tb, ta);
        gl.uniform1f(this.uni(this.pGlass, "uHasIcon"), ico ? 1 : 0);
        // Auch Flaechen ohne Symbol reagieren auf die Maus.
        const bare = el.matches(":hover") ? 0.34 : 0;
        gl.uniform1f(this.uni(this.pGlass, "uGlow"), Math.min(1.4, ico?.glow ?? bare));
        const c = ico?.col ?? [1, 1, 1];
        gl.uniform3f(this.uni(this.pGlass, "uIconCol"), c[0], c[1], c[2]);
        this.quad(
          this.pGlass,
          [this.w * k, this.h * k],
          [b.x * k, b.y * k, b.width * k, b.height * k]
        );
      }
    }

    requestAnimationFrame(this.frame);
  };
}
