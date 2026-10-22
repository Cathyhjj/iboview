import vertexSource from '../../../shader/vertex5.glsl?raw';
import commonSource from '../../../shader/pixel_common.glsl?raw';
import opaqueSource from '../../../shader/pixel5.glsl?raw';
import peelSource from '../../../shader/pixel5_orb_dp.glsl?raw';
import combineSource from '../../../shader/pixel5_combine_dp.glsl?raw';
import passSource from '../../../shader/vertex5_pass.glsl?raw';
import antialiasSource from '../../../shader/pixel5_fakeAA2.glsl?raw';
import type { MeshData } from './geometry';

type Vec3 = [number, number, number];
type Quaternion = [number, number, number, number];
export type MaterialPreset = 'shiny' | 'soft' | 'extra';
export type RendererTheme = 'light' | 'dark';
export interface Bounds { min: Vec3; max: Vec3 }
interface GpuMesh { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; count: number; colorBuffer?: WebGLBuffer; colorLength?: number }
interface Target { framebuffer: WebGLFramebuffer; color: WebGLTexture; depth?: WebGLTexture }
interface Program { handle: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }

const PRELUDE = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
const PEEL_LAYERS = 12;
const BACKGROUNDS: Record<RendererTheme, Vec3> = { light: [1, 1, 1], dark: [9 / 255, 9 / 255, 11 / 255] };
// The browser's theme supplies the fog target; desktop shader files stay intact.
const themedCommonSource = 'uniform vec3 BackgroundColor;\n' + commonSource.replace(
  'return mix(color.xyz, vec3(1.0,1.0,1.0), rz);',
  'return mix(color.xyz, BackgroundColor, rz);',
);
const MATERIALS: Record<MaterialPreset, { atom: number[]; orbital: number[] }> = {
  shiny: { atom: [0.04, 0.46, 0.34, 0.80], orbital: [0.04, 0.50, 0.34, 0.78] },
  soft: { atom: [0.28, 0.52, 0.20, -0.5], orbital: [0.26, 0.52, 0.40, -0.5] },
  extra: { atom: [0.8, 0.7, 0.7, -0.5], orbital: [0.8, 0.7, 1.22, -0.5] },
};

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [x, y, z, w] = a, [u, v, s, t] = b;
  const result: Quaternion = [w * u + x * t + y * s - z * v, w * v - x * s + y * t + z * u,
    w * s + x * v - y * u + z * t, w * t - x * u - y * v - z * s];
  const length = Math.hypot(...result);
  return result.map(value => value / length) as Quaternion;
}

function rotation(axis: Vec3, angle: number): Quaternion {
  const sine = Math.sin(angle / 2);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle / 2)];
}

function normalMatrix([x, y, z, w]: Quaternion): Float32Array {
  return new Float32Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ]);
}

/** WebGL2 port of IvView3D::RenderScene, with browser adapters around the desktop GLSL. */
export class NativeIboRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly opaqueProgram: Program;
  private readonly peelProgram: Program;
  private readonly combineProgram: Program;
  private readonly antialiasProgram: Program;
  private readonly quad: GpuMesh;
  private opaque?: GpuMesh;
  private transparent?: GpuMesh;
  private bounds: Bounds = { min: [-3, -3, -3], max: [3, 3, 3] };
  private targets: Target[] = [];
  private center: Vec3 = [0, 0, 0];
  private quaternion: Quaternion = [0, 0, 0, 1];
  private pan: [number, number] = [0, 0];
  private halfHeight = 5;
  private fittedHalfHeight = 5;
  private cameraDistance = 100 * 0.529177;
  private preset: MaterialPreset = 'shiny';
  private opacity = 0.55;
  private background: Vec3 = BACKGROUNDS.light;
  private frame = 0;
  private spinning = false;
  private destroyed = false;
  private contextLost = false;
  private lastTime = 0;
  private pointer?: { id: number; x: number; y: number; pan: boolean };
  private readonly listeners: Array<[string, EventListener]> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: true,
      premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This viewer requires WebGL 2. Enable graphics acceleration in your browser.');
    this.gl = gl;
    this.opaqueProgram = this.makeProgram(vertexSource, themedCommonSource + '\n' + opaqueSource);
    this.peelProgram = this.makeProgram(vertexSource, themedCommonSource + '\n' + peelSource);
    this.combineProgram = this.makeProgram(passSource, combineSource);
    // GLSL ES omits the desktop float-literal suffix; the FXAA math is unchanged.
    this.antialiasProgram = this.makeProgram(passSource, antialiasSource.replace(/\b(\d+\.\d*)f\b/g, '$1'));
    this.quad = this.makeQuad();
    this.listen('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.setSpinning(false);
    });
    this.listen('pointerdown', (event) => {
      const pointer = event as PointerEvent;
      if (this.pointer || pointer.button > 2) return;
      this.pointer = { id: pointer.pointerId, x: pointer.clientX, y: pointer.clientY,
        pan: pointer.button === 2 || pointer.button === 1 || pointer.shiftKey };
      canvas.setPointerCapture(pointer.pointerId);
      pointer.preventDefault();
    });
    this.listen('pointermove', (event) => {
      const pointer = event as PointerEvent;
      if (!this.pointer || this.pointer.id !== pointer.pointerId) return;
      const dx = pointer.clientX - this.pointer.x, dy = pointer.clientY - this.pointer.y;
      this.pointer.x = pointer.clientX;
      this.pointer.y = pointer.clientY;
      if (this.pointer.pan) {
        const scale = 2 * this.halfHeight / Math.max(1, canvas.clientHeight);
        this.pan[0] += dx * scale;
        this.pan[1] -= dy * scale;
      } else {
        this.quaternion = multiply(rotation([0, 1, 0], dx * 0.008), this.quaternion);
        this.quaternion = multiply(rotation([1, 0, 0], dy * 0.008), this.quaternion);
      }
      this.render();
    });
    const release = (event: Event) => {
      const pointer = event as PointerEvent;
      if (this.pointer?.id === pointer.pointerId) this.pointer = undefined;
    };
    this.listen('pointerup', release);
    this.listen('pointercancel', release);
    this.listen('lostpointercapture', release);
    this.listen('contextmenu', (event) => event.preventDefault());
    this.listen('wheel', (event) => {
      const wheel = event as WheelEvent;
      wheel.preventDefault();
      const pixels = wheel.deltaY * (wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? canvas.clientHeight : 1);
      this.zoom(Math.exp(-Math.max(-250, Math.min(250, pixels)) * 0.0015));
    });
    this.orient('default');
  }

  private listen(type: string, listener: EventListener) {
    this.canvas.addEventListener(type, listener, { passive: false });
    this.listeners.push([type, listener]);
  }

  private makeProgram(vertex: string, fragment: string): Program {
    const gl = this.gl;
    const shaders: WebGLShader[] = [];
    const handle = gl.createProgram();
    if (!handle) throw new Error('Unable to allocate a shader program.');
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Unable to allocate a shader.');
        shaders.push(shader);
        gl.shaderSource(shader, PRELUDE + source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Native IboView shader compilation failed.');
        gl.attachShader(handle, shader);
      }
      gl.bindAttribLocation(handle, 0, 'in_Position');
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle) ?? 'Native IboView shader linking failed.');
    } catch (error) {
      gl.deleteProgram(handle);
      throw error;
    } finally {
      shaders.forEach(shader => gl.deleteShader(shader));
    }
    return { handle, uniforms: new Map() };
  }

  private uniform(program: Program, name: string) {
    if (!program.uniforms.has(name)) program.uniforms.set(name, this.gl.getUniformLocation(program.handle, name));
    return program.uniforms.get(name)!;
  }

  private makeMesh(data: MeshData): GpuMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to allocate mesh geometry.');
    const buffers: WebGLBuffer[] = [];
    gl.bindVertexArray(vao);
    for (const [location, size, values] of [[0, 3, data.positions], [2, 3, data.normals], [3, 4, data.colors]] as const) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to allocate vertex data.');
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, values, location === 3 ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    const indexBuffer = gl.createBuffer();
    if (!indexBuffer) throw new Error('Unable to allocate mesh indices.');
    buffers.push(indexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, buffers, count: data.indices.length, colorBuffer: buffers[2], colorLength: data.colors.length };
  }

  private makeQuad(): GpuMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray(), buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('Unable to allocate the depth-peeling compositor.');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 1, 1, -1, 0, 1, 1, 1, 0, 1,
      -1, -1, 0, 1, 1, 1, 0, 1, -1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, buffers: [buffer], count: 6 };
  }

  private deleteMesh(mesh?: GpuMesh) {
    if (!mesh) return;
    mesh.buffers.forEach(buffer => this.gl.deleteBuffer(buffer));
    this.gl.deleteVertexArray(mesh.vao);
  }

  setMeshes(opaque: MeshData, transparent: MeshData) {
    this.assertAvailable();
    this.deleteMesh(this.opaque);
    this.deleteMesh(this.transparent);
    this.opaque = this.makeMesh(opaque);
    this.transparent = this.makeMesh(transparent);
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const mesh of [opaque, transparent]) {
      for (let index = 0; index < mesh.positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], mesh.positions[index + axis]);
          max[axis] = Math.max(max[axis], mesh.positions[index + axis]);
        }
      }
    }
    if (Number.isFinite(min[0])) this.bounds = { min, max };
  }

  setMaterial(preset: MaterialPreset, opacity: number) {
    this.preset = preset;
    this.opacity = Math.max(0, Math.min(1, opacity));
  }

  setOrbitalColors(colors: Float32Array) {
    this.assertAvailable();
    const mesh = this.transparent;
    if (!mesh?.colorBuffer) return;
    if (colors.length !== mesh.colorLength) throw new Error('Orbital colors must match the existing geometry.');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, mesh.colorBuffer);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, colors);
  }

  setTheme(theme: RendererTheme) {
    this.background = BACKGROUNDS[theme];
  }

  fit(bounds: Bounds = this.bounds) {
    this.center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) as Vec3;
    const radius = Math.max(0.5, Math.hypot(...bounds.min.map((value, axis) => (bounds.max[axis] - value) / 2)));
    const aspect = Math.max(0.1, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.fittedHalfHeight = radius * 1.15 / Math.min(1, aspect);
    this.halfHeight = this.fittedHalfHeight;
    this.cameraDistance = Math.max(100 * 0.529177, radius * 6);
    this.pan = [0, 0];
  }

  orient(direction: 'default' | 'top' | 'side') {
    this.quaternion = direction === 'default'
      ? multiply(rotation([0, 0, 1], -25 * Math.PI / 180), rotation([1, 0, 0], 58 * Math.PI / 180))
      : direction === 'side' ? rotation([1, 0, 0], Math.PI / 2) : [0, 0, 0, 1];
    this.pan = [0, 0];
    this.halfHeight = this.fittedHalfHeight;
    this.render();
  }

  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.halfHeight = Math.max(this.fittedHalfHeight / 30, Math.min(this.fittedHalfHeight * 20, this.halfHeight / factor));
    this.render();
  }

  setSpinning(spinning: boolean) {
    this.spinning = spinning;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
    if (!spinning || this.destroyed || this.contextLost) return;
    const advance = (time: number) => {
      if (!this.spinning || this.destroyed || this.contextLost) return;
      if (this.lastTime && !this.pointer) {
        const delta = Math.min(50, time - this.lastTime) / 1000;
        this.quaternion = multiply(rotation([0, 1, 0], delta * 0.24), this.quaternion);
      }
      this.lastTime = time;
      this.render();
      this.frame = requestAnimationFrame(advance);
    };
    this.frame = requestAnimationFrame(advance);
  }

  private deleteTargets() {
    for (const target of this.targets) {
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.color);
      if (target.depth) this.gl.deleteTexture(target.depth);
    }
    this.targets = [];
  }

  private makeTarget(depth: boolean): Target {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer(), color = gl.createTexture();
    if (!framebuffer || !color) throw new Error('Unable to allocate depth-peeling framebuffers.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.canvas.width, this.canvas.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    const target: Target = { framebuffer, color };
    if (depth) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Unable to allocate depth textures.');
      target.depth = texture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, this.canvas.width, this.canvas.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    }
    this.targets.push(target);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('This graphics device cannot allocate the native depth-peeling buffers.');
    return target;
  }

  resize() {
    this.assertAvailable();
    const gl = this.gl;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const limit = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const width = Math.max(1, Math.min(limit, Math.round(this.canvas.clientWidth * ratio)));
    const height = Math.max(1, Math.min(limit, Math.round(this.canvas.clientHeight * ratio)));
    if (width === this.canvas.width && height === this.canvas.height && this.targets.length) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.deleteTargets();
    this.makeTarget(true);
    this.makeTarget(true);
    this.makeTarget(false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private matrices() {
    const normal = normalMatrix(this.quaternion);
    const translation = [0, 1, 2].map(row => -normal[row] * this.center[0] - normal[3 + row] * this.center[1] - normal[6 + row] * this.center[2]);
    const view = new Float32Array([normal[0], normal[1], normal[2], 0, normal[3], normal[4], normal[5], 0,
      normal[6], normal[7], normal[8], 0, translation[0] + this.pan[0], translation[1] + this.pan[1], translation[2] - this.cameraDistance, 1]);
    const halfWidth = this.halfHeight * this.canvas.width / this.canvas.height;
    const near = 0.02 * this.cameraDistance, far = 2 * this.cameraDistance;
    const projection = new Float32Array([1 / halfWidth, 0, 0, 0, 0, 1 / this.halfHeight, 0, 0,
      0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
    return { normal, view, projection };
  }

  private draw(mesh: GpuMesh | undefined, program: Program, transparent: boolean) {
    if (!mesh?.count) return;
    const gl = this.gl;
    gl.useProgram(program.handle);
    const { normal, view, projection } = this.matrices();
    gl.uniformMatrix4fv(this.uniform(program, 'mView'), false, view);
    gl.uniformMatrix4fv(this.uniform(program, 'mProj'), false, projection);
    gl.uniformMatrix3fv(this.uniform(program, 'mNorm'), false, normal);
    const registers = MATERIALS[this.preset][transparent ? 'orbital' : 'atom'];
    registers.forEach((value, index) => gl.uniform1f(this.uniform(program, `ShaderReg${index}`), value));
    gl.uniform1f(this.uniform(program, 'FadeWidth'), 9);
    gl.uniform1f(this.uniform(program, 'FadeBias'), 0);
    gl.uniform3f(this.uniform(program, 'BackgroundColor'), ...this.background);
    gl.uniform4f(this.uniform(program, 'DiffuseColor'), 1, 1, 1, transparent ? this.opacity : 1);
    if (transparent) gl.uniform1i(this.uniform(program, 'Depth1'), 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  }

  render() {
    if (this.destroyed || this.contextLost) return;
    this.resize();
    const gl = this.gl, [first, second, accumulation] = this.targets;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, first.framebuffer);
    gl.clearColor(...this.background, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.draw(this.opaque, this.opaqueProgram, false);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, first.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, accumulation.framebuffer);
    gl.blitFramebuffer(0, 0, this.canvas.width, this.canvas.height, 0, 0, this.canvas.width, this.canvas.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    if (this.transparent?.count && this.opacity > 0) {
      let previous = first, next = second;
      for (let layer = 0; layer < PEEL_LAYERS; layer++) {
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.depthFunc(gl.GEQUAL);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.bindTexture(gl.TEXTURE_2D, previous.depth!);
        this.draw(this.transparent, this.peelProgram, true);

        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, accumulation.framebuffer);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
        gl.useProgram(this.combineProgram.handle);
        gl.bindTexture(gl.TEXTURE_2D, next.color);
        gl.uniform1i(this.uniform(this.combineProgram, 'LayerColor'), 0);
        gl.bindVertexArray(this.quad.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.quad.count);
        [previous, next] = [next, previous];
      }
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.clearDepth(1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.antialiasProgram.handle);
    gl.bindTexture(gl.TEXTURE_2D, accumulation.color);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(this.uniform(this.antialiasProgram, 'SourceImage'), 0);
    gl.uniform1f(this.uniform(this.antialiasProgram, 'FilterStepH'), 1 / this.canvas.width);
    gl.uniform1f(this.uniform(this.antialiasProgram, 'FilterStepV'), 1 / this.canvas.height);
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.quad.count);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  }

  project(point: { x: number; y: number; z: number }): [number, number] {
    const normal = normalMatrix(this.quaternion);
    const delta = [point.x - this.center[0], point.y - this.center[1], point.z - this.center[2]];
    const x = normal[0] * delta[0] + normal[3] * delta[1] + normal[6] * delta[2] + this.pan[0];
    const y = normal[1] * delta[0] + normal[4] * delta[1] + normal[7] * delta[2] + this.pan[1];
    const halfWidth = this.halfHeight * this.canvas.width / this.canvas.height;
    return [(x / halfWidth + 1) * this.canvas.clientWidth / 2, (1 - y / this.halfHeight) * this.canvas.clientHeight / 2];
  }

  exportPNG(): string {
    this.assertAvailable();
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  private assertAvailable() {
    if (this.destroyed) throw new Error('The molecular viewer has been disposed.');
    if (this.contextLost || this.gl.isContextLost()) throw new Error('The graphics context was interrupted. Reload the page to restore the viewer.');
  }

  destroy() {
    if (this.destroyed) return;
    this.setSpinning(false);
    this.listeners.forEach(([type, listener]) => this.canvas.removeEventListener(type, listener));
    this.deleteMesh(this.opaque);
    this.deleteMesh(this.transparent);
    this.deleteMesh(this.quad);
    this.deleteTargets();
    for (const program of [this.opaqueProgram, this.peelProgram, this.combineProgram, this.antialiasProgram]) this.gl.deleteProgram(program.handle);
    this.destroyed = true;
  }
}
