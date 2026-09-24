(function attachPixelFPSRenderer(root) {
  'use strict';

  // A deliberately small WebGL renderer: the simulation owns every position,
  // collision box and gameplay rule. Visual projectile size is independent of
  // the collision radius and is enlarged slightly so flight is easy to inspect.
  const VERTEX = `
    attribute vec3 a_position;
    attribute vec3 a_normal;
    attribute vec2 a_uv;
    uniform mat4 u_matrix;
    uniform vec3 u_center;
    uniform vec3 u_size;
    varying vec3 v_normal;
    varying vec3 v_world;
    varying vec2 v_uv;
    void main() {
      v_world = a_position * u_size + u_center;
      v_normal = a_normal;
      v_uv = a_uv;
      gl_Position = u_matrix * vec4(v_world, 1.0);
    }
  `;
  const FRAGMENT = `
    precision mediump float;
    uniform vec4 u_color;
    uniform vec3 u_eye;
    uniform float u_unlit;
    uniform sampler2D u_face;
    uniform float u_faceEnabled;
    varying vec3 v_normal;
    varying vec3 v_world;
    varying vec2 v_uv;
    void main() {
      float light = 0.63 + max(dot(v_normal, normalize(vec3(-0.5, 1.0, 0.7))), 0.0) * 0.37;
      vec3 color = u_color.rgb * mix(light, 1.0, u_unlit);
      if (u_faceEnabled > 0.5 && v_normal.z > 0.5) {
        vec4 paint = texture2D(u_face, v_uv);
        color = mix(color, paint.rgb, paint.a);
      }
      float fog = smoothstep(35.0, 95.0, length(v_world - u_eye)) * 0.55;
      gl_FragColor = vec4(mix(color, vec3(0.10, 0.15, 0.19), fog), u_color.a);
    }
  `;
  const SKY = [0.10, 0.15, 0.19, 1];
  const ITEM_COLORS = {
    weapon: [0.97, 0.74, 0.29, 1], pistol: [0.97, 0.74, 0.29, 1],
    ammo: [0.25, 0.79, 0.92, 1], battery: [0.25, 0.79, 0.92, 1], energy: [0.25, 0.79, 0.92, 1],
    health: [0.35, 0.90, 0.59, 1], medkit: [0.35, 0.90, 0.59, 1],
    mana: [0.40, 0.58, 1.0, 1], skill: [0.78, 0.49, 1.0, 1],
  };
  const asVec = value => Array.isArray(value) || ArrayBuffer.isView(value)
    ? value : [value?.x || 0, value?.y || 0, value?.z || 0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function colorValue(value, fallback) {
    if (Array.isArray(value) && value.length >= 3) return [value[0], value[1], value[2], value[3] ?? 1];
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) {
      return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255).concat(1);
    }
    return fallback;
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
    return out;
  }

  function meshData() {
    const positions = [], normals = [], uvs = [], indices = [];
    const faces = [
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
      [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
      [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    ];
    faces.forEach(([normal, vertices], faceIndex) => {
      vertices.forEach((vertex, index) => {
        positions.push(...vertex.map(value => value * 0.5));
        normals.push(...normal);
        // Imported canvas PNGs use top-left image coordinates, as in the editor.
        uvs.push(...(faceIndex === 0 ? [[0, 1], [1, 1], [1, 0], [0, 0]][index] : [0, 0]));
      });
      const offset = faceIndex * 4;
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    });
    const corners = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    return { positions, normals, uvs, indices, edges: edges.flatMap(edge => edge.flatMap(index => corners[index])) };
  }

  class PixelFPSRenderer {
    constructor(canvas) {
      if (!canvas?.getContext) throw new Error('训练场需要一个有效的 canvas。');
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: true });
      if (!this.gl) throw new Error('无法开启 WebGL，请检查浏览器硬件加速设置。');
      this.width = 1;
      this.height = 1;
      this.fov = 75 * Math.PI / 180;
      this._faces = new Map();
      this._buffers = [];
      this._lost = false;
      this._disposed = false;
      this._gridKey = '';
      this._onLost = event => { event.preventDefault(); this._lost = true; };
      this._onRestored = () => {
        if (this._disposed) return;
        this._lost = false;
        this._buffers = [];
        this._gridKey = '';
        this._faces.forEach(record => { record.texture = null; });
        this._initGL();
        if (this._world) this.render(this._world);
      };
      canvas.addEventListener('webglcontextlost', this._onLost);
      canvas.addEventListener('webglcontextrestored', this._onRestored);
      this._initGL();
      this._resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
      this._resizeObserver?.observe(canvas);
      this.resize();
    }

    _initGL() {
      const gl = this.gl;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const detail = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error('训练场着色器初始化失败：' + detail);
        }
        return shader;
      };
      const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('训练场渲染程序链接失败。');
      this.loc = {};
      ['matrix', 'center', 'size', 'color', 'eye', 'unlit', 'face', 'faceEnabled'].forEach(name => {
        this.loc[name] = gl.getUniformLocation(this.program, 'u_' + name);
      });
      ['position', 'normal', 'uv'].forEach(name => { this.loc[name] = gl.getAttribLocation(this.program, 'a_' + name); });
      const mesh = meshData();
      this.box = this._geometry(mesh.positions, mesh.normals, mesh.uvs, mesh.indices);
      this.edges = this._geometry(mesh.edges);
      this.grid = this._geometry([]);
      this.lines = this._geometry([]);
      this._emptyTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._emptyTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(...SKY);
    }

    _geometry(positions, normals, uvs, indices) {
      const gl = this.gl;
      const buffer = (target, data) => {
        const result = gl.createBuffer();
        this._buffers.push(result);
        gl.bindBuffer(target, result);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return result;
      };
      return {
        position: buffer(gl.ARRAY_BUFFER, new Float32Array(positions)),
        normal: normals ? buffer(gl.ARRAY_BUFFER, new Float32Array(normals)) : null,
        uv: uvs ? buffer(gl.ARRAY_BUFFER, new Float32Array(uvs)) : null,
        indices: indices ? buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)) : null,
        count: indices ? indices.length : positions.length / 3,
      };
    }

    resize() {
      if (this._disposed) return;
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width || this.canvas.clientWidth || 1);
      this.height = Math.max(1, rect.height || this.canvas.clientHeight || 1);
      const ratio = Math.min(root.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(this.width * ratio)), height = Math.max(1, Math.round(this.height * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      if (!this._lost) this.gl.viewport(0, 0, width, height);
    }

    _camera(player, world = this._world) {
      const eye = asVec(world?.eye ? world.eye(player) : root.PixelFPS?.eye ? root.PixelFPS.eye(player)
        : [asVec(player.pos)[0], asVec(player.pos)[1] + (player.eyeHeight || 1.6), asVec(player.pos)[2]]);
      const yaw = player.yaw || 0, pitch = player.pitch || 0;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const right = [cy, 0, sy], up = [-sy * sp, cp, cy * sp], backward = [-sy * cp, -sp, cy * cp];
      const view = new Float32Array([
        right[0], up[0], backward[0], 0,
        right[1], up[1], backward[1], 0,
        right[2], up[2], backward[2], 0,
        -dot(right, eye), -dot(up, eye), -dot(backward, eye), 1,
      ]);
      const f = 1 / Math.tan(this.fov / 2), near = 0.025, far = 160;
      const projection = new Float32Array([
        f / (this.width / this.height), 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0,
      ]);
      return { eye, right, up, backward, matrix: multiply(projection, view) };
    }

    // CSS pixels relative to the canvas; visible also rejects points behind the eye.
    project(worldPoint, player = this._world?.player) {
      if (!player) return null;
      const camera = this._camera(player), point = asVec(worldPoint), m = camera.matrix;
      const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
      const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
      const z = m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14];
      const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
      if (w <= 0.025) return { x: -1, y: -1, depth: w, visible: false };
      return { x: (x / w + 1) * this.width / 2, y: (1 - y / w) * this.height / 2, depth: w,
        visible: Math.abs(x) <= w && Math.abs(y) <= w && z >= -w && z <= w };
    }

    _faceTexture(face) {
      const source = typeof face === 'string' ? face : face?.png;
      if (!source || !source.startsWith('data:image/png;base64,')) return null;
      let record = this._faces.get(source);
      if (!record) {
        record = { image: new Image(), texture: null, ready: false, failed: false };
        this._faces.set(source, record);
        record.image.onload = () => { if (!this._disposed) record.ready = true; };
        record.image.onerror = () => { record.failed = true; };
        record.image.src = source;
      }
      if (!record.ready || record.failed) return null;
      if (!record.texture) {
        const gl = this.gl;
        record.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, record.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, record.image);
      }
      return record.texture;
    }

    _draw(mesh, mode, center, size, color, unlit = false, texture = null) {
      const gl = this.gl, loc = this.loc;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
      gl.enableVertexAttribArray(loc.position);
      gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 0, 0);
      if (mesh.normal) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
        gl.enableVertexAttribArray(loc.normal);
        gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
      } else { gl.disableVertexAttribArray(loc.normal); gl.vertexAttrib3f(loc.normal, 0, 1, 0); }
      if (mesh.uv) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
        gl.enableVertexAttribArray(loc.uv);
        gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);
      } else { gl.disableVertexAttribArray(loc.uv); gl.vertexAttrib2f(loc.uv, 0, 0); }
      gl.uniform3fv(loc.center, center);
      gl.uniform3fv(loc.size, size);
      gl.uniform4fv(loc.color, color);
      gl.uniform1f(loc.unlit, unlit ? 1 : 0);
      gl.uniform1f(loc.faceEnabled, texture ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, texture || this._emptyTexture);
      if (mesh.indices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
        gl.drawElements(mode, mesh.count, gl.UNSIGNED_SHORT, 0);
      } else gl.drawArrays(mode, 0, mesh.count);
    }

    _box(center, size, color, texture = null, outline = false, unlit = false) {
      this._draw(this.box, this.gl.TRIANGLES, center, size, color, unlit, texture);
      if (outline) this._draw(this.edges, this.gl.LINES, center, size, [0.06, 0.09, 0.12, 0.7], true);
    }

    _line(from, to, color) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lines.position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...from, ...to]), gl.DYNAMIC_DRAW);
      this.lines.count = 2;
      this._draw(this.lines, gl.LINES, [0, 0, 0], [1, 1, 1], color, true);
    }

    _floor(world) {
      const bounds = world.bounds;
      let minX = -24, maxX = 24, minZ = -24, maxZ = 24;
      if (bounds?.min && bounds?.max) {
        const min = asVec(bounds.min), max = asVec(bounds.max);
        minX = min[0]; maxX = max[0]; minZ = min[2]; maxZ = max[2];
      } else if (typeof bounds === 'number') minX = minZ = -(maxX = maxZ = bounds);
      const width = maxX - minX, depth = maxZ - minZ;
      this._box([(minX + maxX) / 2, -0.12, (minZ + maxZ) / 2], [width, 0.24, depth], [0.19, 0.245, 0.27, 1]);
      const key = [minX, maxX, minZ, maxZ].join(',');
      if (this._gridKey !== key) {
        const lines = [];
        for (let x = Math.ceil(minX / 2) * 2; x <= maxX; x += 2) lines.push(x, 0.004, minZ, x, 0.004, maxZ);
        for (let z = Math.ceil(minZ / 2) * 2; z <= maxZ; z += 2) lines.push(minX, 0.004, z, maxX, 0.004, z);
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.grid.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
        this.grid.count = lines.length / 3;
        this._gridKey = key;
      }
      this._draw(this.grid, this.gl.LINES, [0, 0, 0], [1, 1, 1], [0.36, 0.47, 0.50, 0.30], true);
    }

    render(world) {
      if (this._disposed || this._lost || !world?.player) return;
      this._world = world;
      this.resize();
      const gl = this.gl, camera = this._camera(world.player, world), now = world.time || 0;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.loc.matrix, false, camera.matrix);
      gl.uniform3fv(this.loc.eye, camera.eye);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.loc.face, 0);
      this._floor(world);

      for (const obstacle of world.obstacles || []) {
        this._box(asVec(obstacle.center), asVec(obstacle.size), colorValue(obstacle.color, [0.38, 0.45, 0.49, 1]), null, true);
      }
      for (const actor of world.actors || []) {
        if (actor === world.player || actor.id === world.player.id || actor.alive === false || actor.hp <= 0) continue;
        const boxes = world.actorBoxes ? world.actorBoxes(actor) : root.PixelFPS.actorBoxes(actor);
        const weakened = (actor.statuses || []).some(status => status.type === 'weakness' || status.type === 'weaken');
        const body = colorValue(actor.color, weakened ? [0.65, 0.42, 0.85, 1] : actor.team === world.player.team ? [0.27, 0.71, 0.78, 1] : [0.92, 0.39, 0.27, 1]);
        const texture = this._faceTexture(actor.face);
        for (const part of boxes) {
          const head = part.id === 'head';
          const color = head ? [0.97, 0.72, 0.49, 1] : /Leg/.test(part.id) ? body.map((value, index) => index < 3 ? value * 0.68 : value) : body;
          this._box(asVec(part.center), asVec(part.size), color, head ? texture : null, true);
        }
      }
      for (const pickup of world.pickups || []) {
        if (pickup.active === false || pickup.collected) continue;
        const pos = asVec(pickup.pos), color = colorValue(pickup.color, ITEM_COLORS[pickup.type] || [0.97, 0.74, 0.29, 1]);
        const bob = 0.06 * Math.sin(now * 2.5 + pos[0]);
        const center = [pos[0], Math.max(0.26, pos[1]) + bob, pos[2]];
        const weapon = pickup.type === 'weapon';
        this._box([pos[0], 0.012, pos[2]], [0.76, 0.024, 0.76], [...color.slice(0, 3).map(value => value * 0.48), 1]);
        this._box(center, weapon ? [0.52, 0.20, 0.20] : [0.28, 0.38, 0.28], color, null, true, true);
        if (weapon) this._box([center[0] + 0.12, center[1] - 0.14, center[2]], [0.12, 0.20, 0.18], color, null, true);
        else this._box([center[0], center[1] + 0.20, center[2]], [0.14, 0.04, 0.14], [0.89, 0.94, 0.96, 1]);
      }
      for (const projectile of world.projectiles || []) {
        const pos = asVec(projectile.pos), radius = Math.max(projectile.radius || 0.025, 0.055);
        const color = colorValue(projectile.color, projectile.type === 'weakness' ? [0.77, 0.49, 1, 1] : [1, 0.89, 0.39, 1]);
        this._box(pos, [radius * 2, radius * 2, radius * 2], color, null, false, true);
        if (projectile.previousPos) this._line(asVec(projectile.previousPos), pos, color);
      }
      // Effects are disposable visuals. Their sizes never participate in hits.
      gl.depthMask(false);
      for (const effect of world.effects || []) {
        if (!effect.pos || (Number.isFinite(effect.expiresAt) && effect.expiresAt < now)) continue;
        const color = colorValue(effect.color, effect.type === 'explosion' ? [0.77, 0.40, 1, 0.65] : [1, 0.92, 0.61, 0.8]);
        const radius = Math.max(0.08, Math.min(effect.radius || 0.12, 5));
        if (effect.type === 'explosion' || radius > 0.4) {
          this._draw(this.edges, gl.LINES, asVec(effect.pos), [radius * 2, radius * 2, radius * 2], color, true);
        } else this._box(asVec(effect.pos), [radius, radius, radius], color, null, false, true);
      }
      gl.depthMask(true);
    }

    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      this._resizeObserver?.disconnect();
      this.canvas.removeEventListener('webglcontextlost', this._onLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
      const gl = this.gl;
      this._buffers.forEach(buffer => gl.deleteBuffer(buffer));
      this._faces.forEach(record => { if (record.texture) gl.deleteTexture(record.texture); record.image.onload = null; record.image.onerror = null; });
      this._faces.clear();
      gl.deleteTexture(this._emptyTexture);
      gl.deleteProgram(this.program);
      this._world = null;
    }
  }

  root.PixelFPSRenderer = PixelFPSRenderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = PixelFPSRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
