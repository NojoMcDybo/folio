/**
 * Glasschicht auf WebGL.
 *
 * Der Hintergrund hinter den Bedienelementen besteht aus Flaechen, die wir
 * selbst zeichnen - die Seiten-Canvas von PDF.js und der Grund der
 * Bibliothek. Deshalb koennen wir ihn in eine Textur kopieren und in einem
 * Shader brechen, statt wie die ueblichen Web-Bibliotheken das DOM
 * abzufotografieren.
 *
 * Je Bild:
 *   1. Hintergrund in ein 2D-Canvas malen (nur wenn er sich geaendert hat)
 *   2. daraus eine unscharfe Fassung in halber Aufloesung rechnen
 *   3. fuer jedes .glass-Element ein Rechteck zeichnen: Mitte unscharf,
 *      Rand gebrochen, mit Farbsaum, Glanzkante und Schattenkante
 */

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** Aufloesung des Hintergrundabzugs. Unter 1, weil Glas ohnehin streut. */
const SCALE = 0.6;

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

uniform vec2 uRes;      // Fenstergroesse in CSS-Pixeln
uniform vec4 uRect;     // x, y, w, h
uniform float uRadius;
uniform vec4 uTint;
uniform float uPress;   // 0 = ruhig, 1 = gedrueckt
uniform float uDpr;     // Geraetepixel je CSS-Pixel
uniform sampler2D uBack;
uniform sampler2D uBlur;
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
  ));

  // Dickenprofil: am Rand voll, nach innen abfallend - das ist die Fase,
  // die die Brechung erzeugt.
  float bevel = clamp(min(hs.x, hs.y) * 0.9, 9.0 * uDpr, 26.0 * uDpr);
  float t = 1.0 - smoothstep(0.0, bevel, -d);
  float t2 = t * t;

  // Brechung: am Rand wird der Hintergrund nach aussen abgetastet.
  float amp = (22.0 + 10.0 * uPress) * uDpr;
  vec2 off = n * t2 * amp / uRes;

  vec2 uv = frag / uRes;
  vec3 refr;
  refr.r = texture(uBack, uv + off * 1.10).r;
  refr.g = texture(uBack, uv + off * 1.00).g;
  refr.b = texture(uBack, uv + off * 0.90).b;

  // Koerper: unscharfe Fassung, ohne Versatz
  vec3 body = texture(uBlur, vec2(uv.x, 1.0 - uv.y)).rgb;

  vec3 col = mix(body, refr, t2);
  col = mix(col, uTint.rgb, uTint.a);

  // Glanz von oben links, Schatten gegenueber
  vec2 L = normalize(vec2(-0.55, -0.83));
  float sp = pow(max(dot(n, L), 0.0), 7.0) * smoothstep(0.0, 0.35, t);
  col += vec3(1.0) * sp * 0.5;
  float sh = pow(max(dot(n, -L), 0.0), 7.0) * t;
  col -= vec3(0.09) * sh;

  // Haarfeine helle Kante direkt am Rand
  float rim = smoothstep(2.0, 0.0, abs(d + 1.0));
  col += vec3(1.0) * rim * (0.14 + 0.10 * max(dot(n, L), 0.0));

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

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number) {
  const tex = gl.createTexture() as WebGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer() as WebGLFramebuffer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export class GlassLayer {
  private gl: WebGL2RenderingContext;
  private pBlur: WebGLProgram;
  private pGlass: WebGLProgram;
  private back = document.createElement("canvas");
  private bctx: CanvasRenderingContext2D;
  private backTex: WebGLTexture;
  private a!: ReturnType<typeof makeTarget>;
  private b!: ReturnType<typeof makeTarget>;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private dirty = true;
  private press = new WeakMap<Element, number>();
  private painter: Painter = () => {};

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

  setPress(el: Element, v: number) {
    this.press.set(el, v);
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

    this.back.width = Math.max(2, Math.round(this.w * SCALE));
    this.back.height = Math.max(2, Math.round(this.h * SCALE));

    const bw = Math.max(2, Math.round(this.back.width / 2));
    const bh = Math.max(2, Math.round(this.back.height / 2));
    this.a = makeTarget(this.gl, bw, bh);
    this.b = makeTarget(this.gl, bw, bh);
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

      for (const el of els) {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const rad = parseFloat(cs.borderTopLeftRadius) || 18;
        const tint = el.dataset.tint;
        const [tr, tg, tb, ta] = tint
          ? tint.split(",").map(Number)
          : [0.06, 0.06, 0.08, 0.34];
        // Alles in Geraetepixeln, damit gl_FragCoord im Shader passt.
        const k = this.dpr;
        gl.uniform1f(this.uni(this.pGlass, "uRadius"), rad * k);
        gl.uniform1f(this.uni(this.pGlass, "uDpr"), k);
        gl.uniform4f(this.uni(this.pGlass, "uTint"), tr, tg, tb, ta);
        gl.uniform1f(this.uni(this.pGlass, "uPress"), this.press.get(el) ?? 0);
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
