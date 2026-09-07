/** Clear glass above PDF canvases. Symbols stay sharp DOM vectors. */
export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const VERTEX = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;
uniform vec4 uQuad;
void main() {
  vec2 p = (uQuad.xy + aPos * uQuad.zw) / uRes * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBack;
uniform vec2 uRes, uTexel;
uniform vec4 uRect;
uniform float uRadius, uScale, uOpacity, uHover, uPanel, uFill;
out vec4 outColor;
float sdf(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 halfSize = uRect.zw * 0.5;
  vec2 p = frag - uRect.xy - halfSize;
  float radius = min(uRadius, min(halfSize.x, halfSize.y));
  float d = sdf(p, halfSize, radius);
  // Extend the quad beyond the shape, preserving the entire antialiased edge.
  float aa = max(fwidth(d), 0.65 * uScale);
  float coverage = 1.0 - smoothstep(-aa, aa, d);
  if (coverage < 0.002) discard;
  vec2 e = vec2(0.5 * uScale, 0.0);
  vec2 normal = normalize(vec2(
    sdf(p + e.xy, halfSize, radius) - sdf(p - e.xy, halfSize, radius),
    sdf(p + e.yx, halfSize, radius) - sdf(p - e.yx, halfSize, radius)
  ) + vec2(0.00001));
  float depth = max(-d / uScale, 0.0);
  float edgeWidth = min(12.0, min(halfSize.x, halfSize.y) / uScale * 0.65);
  float edge = 1.0 - smoothstep(0.0, max(1.0, edgeWidth), depth);
  // Bounded refraction without the old rainbow fringe.
  vec2 uv = frag / uRes;
  vec2 offset = -normal * edge * edge * (3.5 + 0.6 * uHover) * uScale / uRes;
  vec2 sampleUV = uv + offset;
  vec3 clear = texture(uBack, sampleUV).rgb;
  vec2 stepUV = uTexel * mix(1.6, 9.0, uPanel);
  vec3 soft = clear * 0.28;
  soft += texture(uBack, sampleUV + vec2(stepUV.x, 0.0)).rgb * 0.12;
  soft += texture(uBack, sampleUV - vec2(stepUV.x, 0.0)).rgb * 0.12;
  soft += texture(uBack, sampleUV + vec2(0.0, stepUV.y)).rgb * 0.12;
  soft += texture(uBack, sampleUV - vec2(0.0, stepUV.y)).rgb * 0.12;
  soft += texture(uBack, sampleUV + stepUV).rgb * 0.11;
  soft += texture(uBack, sampleUV - stepUV).rgb * 0.11;
  vec3 col = mix(clear, soft, mix(0.18, 0.85, uPanel));
  // Thin neutral sheen; no adaptive dark tint.
  col = mix(col, vec3(1.0), 0.035 + 0.025 * uHover + 0.025 * uPanel);
  float facing = pow(max(dot(normal, normalize(vec2(-0.45, -0.9))), 0.0), 3.0);
  float rim = exp(-pow((depth - 0.7) / 0.65, 2.0));
  col += vec3(rim * (0.10 + 0.32 * facing + 0.06 * uHover));
  col += vec3(0.025 * edge * facing);
  if (uFill >= 0.0) {
    float y = (frag.y - uRect.y) / uRect.w;
    float fill = 1.0 - smoothstep(uFill - 0.01, uFill + 0.01, y);
    col = mix(col, vec3(0.70, 0.84, 1.0), 0.24 * fill);
  }
  outColor = vec4(col, coverage * uOpacity);
}`;

function createProgram(gl: WebGL2RenderingContext) {
  const p = gl.createProgram();
  if (!p) throw new Error("WebGL program unavailable");
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("WebGL shader unavailable");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader); gl.deleteProgram(p);
      throw new Error(message ?? "Glass shader failed");
    }
    gl.attachShader(p, shader);
    gl.deleteShader(shader);
  }
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(message ?? "Glass program failed");
  }
  return p;
}

function opacityOf(el: HTMLElement) {
  let opacity = 1;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.display === "none" || cs.visibility === "hidden") return 0;
    opacity *= Number(cs.opacity);
  }
  return opacity;
}

export class GlassLayer {
  private gl: WebGL2RenderingContext;
  private p!: WebGLProgram;
  private texture!: WebGLTexture;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private backdrop = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private sample = document.createElement("canvas");
  private sampleCtx: CanvasRenderingContext2D;
  private pixels: Uint8ClampedArray = new Uint8ClampedArray();
  private scale = 1;
  private dpr = 1;
  private dirty = true;
  private lost = false;
  private painter: Painter = () => {};
  private contrast = new WeakMap<HTMLElement, boolean>();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error("WebGL2 nicht verfügbar");
    this.gl = gl;
    this.ctx = this.backdrop.getContext("2d", { alpha: false })!;
    this.sample.width = this.sample.height = 80;
    this.sampleCtx = this.sample.getContext("2d", { willReadFrequently: true })!;
    this.init();
    window.addEventListener("resize", () => this.resize());
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault(); this.lost = true;
      document.body.classList.add("no-gl");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false; this.init();
      document.body.classList.remove("no-gl");
    });
    requestAnimationFrame(this.frame);
  }

  private init() {
    const gl = this.gl;
    this.p = createProgram(gl);
    this.uniforms.clear();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.resize();
  }

  setPainter(painter: Painter) { this.painter = painter; this.invalidate(); }
  invalidate() { this.dirty = true; }
  private uniform(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.p, name));
    return this.uniforms.get(name)!;
  }
  private resize() {
    if (this.lost) return;
    this.dpr = devicePixelRatio || 1;
    const max = Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE), this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE));
    this.scale = Math.min(Math.max(1.5, this.dpr), 3, max / innerWidth, max / innerHeight);
    this.canvas.width = Math.max(1, Math.round(innerWidth * this.scale));
    this.canvas.height = Math.max(1, Math.round(innerHeight * this.scale));
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    const backScale = Math.min(this.scale, 2);
    this.backdrop.width = Math.max(1, Math.round(innerWidth * backScale));
    this.backdrop.height = Math.max(1, Math.round(innerHeight * backScale));
    this.invalidate();
  }
  private updateContrast(el: HTMLElement, rect: DOMRect) {
    if (!this.pixels.length) return;
    let luminance = 0;
    for (const dx of [-0.22, 0, 0.22]) for (const dy of [-0.22, 0, 0.22]) {
      const x = Math.max(0, Math.min(79, Math.floor((rect.x + rect.width * (0.5 + dx)) / innerWidth * 80)));
      const y = Math.max(0, Math.min(79, Math.floor((rect.y + rect.height * (0.5 + dy)) / innerHeight * 80)));
      const i = (y * 80 + x) * 4;
      luminance += (this.pixels[i] * 0.2126 + this.pixels[i + 1] * 0.7152 + this.pixels[i + 2] * 0.0722) / 255;
    }
    const wasLight = this.contrast.get(el) ?? false;
    const light = luminance / 9 > (wasLight ? 0.45 : 0.59);
    if (light !== wasLight || !this.contrast.has(el)) {
      el.classList.toggle("glass--light", light);
      this.contrast.set(el, light);
    }
  }
  private frame = () => {
    requestAnimationFrame(this.frame);
    if (this.lost || document.hidden) return;
    if (this.dpr !== (devicePixelRatio || 1)) this.resize();
    const gl = this.gl;
    if (this.dirty) {
      this.painter(this.ctx, this.backdrop.width, this.backdrop.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.backdrop);
      this.sampleCtx.drawImage(this.backdrop, 0, 0, 80, 80);
      this.pixels = this.sampleCtx.getImageData(0, 0, 80, 80).data;
      this.dirty = false;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.p);
    gl.uniform1i(this.uniform("uBack"), 0);
    gl.uniform2f(this.uniform("uRes"), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniform("uTexel"), 1 / this.backdrop.width, 1 / this.backdrop.height);
    gl.uniform1f(this.uniform("uScale"), this.scale);
    for (const el of document.querySelectorAll<HTMLElement>(".glass")) {
      const opacity = opacityOf(el);
      if (opacity < 0.01) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      this.updateContrast(el, r);
      const radiusText = getComputedStyle(el).borderTopLeftRadius.split(" ")[0];
      const radius = radiusText.endsWith("%") ? parseFloat(radiusText) / 100 * Math.min(r.width, r.height) : parseFloat(radiusText);
      const k = this.scale;
      gl.uniform4f(this.uniform("uRect"), r.x * k, r.y * k, r.width * k, r.height * k);
      gl.uniform4f(this.uniform("uQuad"), (r.x - 2) * k, (r.y - 2) * k, (r.width + 4) * k, (r.height + 4) * k);
      gl.uniform1f(this.uniform("uRadius"), radius * k);
      gl.uniform1f(this.uniform("uOpacity"), opacity);
      gl.uniform1f(this.uniform("uHover"), el.matches(":hover") ? 1 : 0);
      gl.uniform1f(this.uniform("uPanel"), el.dataset.glass === "panel" ? 1 : 0);
      gl.uniform1f(this.uniform("uFill"), el.dataset.fill === undefined ? -1 : Number(el.dataset.fill));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
}
