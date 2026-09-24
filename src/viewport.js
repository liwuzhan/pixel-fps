(function (global) {
  'use strict';

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
    uniform float u_unlit;
    uniform float u_gridFade;
    uniform vec3 u_target;
    uniform sampler2D u_faceTexture;
    uniform float u_faceEnabled;
    varying vec3 v_normal;
    varying vec3 v_world;
    varying vec2 v_uv;
    void main() {
      float key = max(dot(v_normal, normalize(vec3(-0.65, 0.9, 0.8))), 0.0);
      float fill = max(dot(v_normal, normalize(vec3(0.8, 0.2, -0.6))), 0.0);
      float lighting = mix(0.61 + key * 0.39 + fill * 0.13, 1.0, u_unlit);
      float fade = 1.0;
      if (u_gridFade > 0.0) {
        float distance = length(v_world.xz - u_target.xz);
        fade = 1.0 - smoothstep(u_gridFade * 0.35, u_gridFade, distance);
      }
      vec3 color = u_color.rgb * lighting;
      if (u_faceEnabled > 0.5 && v_normal.z > 0.5) {
        vec4 paint = texture2D(u_faceTexture, v_uv);
        // Paint retains its chosen color; transparent pixels reveal the material.
        color = mix(color, paint.rgb, paint.a);
      }
      gl_FragColor = vec4(color, u_color.a * fade);
    }
  `;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const addScaled = (a, b, scale) => a.map((v, i) => v + b[i] * scale);
  const subtract = (a, b) => a.map((v, i) => v - b[i]);

  function multiply(a, b) {
    const result = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
        result[column * 4 + row] = sum;
      }
    }
    return result;
  }

  function boxGeometry() {
    const positions = [], normals = [], indices = [], uvs = [];
    const faces = [
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
      [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
      [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    ];
    faces.forEach(([normal, vertices], index) => {
      vertices.forEach((vertex, vertexIndex) => {
        positions.push(...vertex.map(v => v * 0.5));
        normals.push(...normal);
        // With UNPACK_FLIP_Y=false, image row zero maps to UV v=0.
        // +Z vertices run bottom-left, bottom-right, top-right, top-left.
        uvs.push(...(index === 0 ? [[0,1], [1,1], [1,0], [0,0]][vertexIndex] : [0,0]));
      });
      const first = index * 4;
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    });
    const corners = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ];
    const edges = [[0,1], [1,2], [2,3], [3,0], [4,5], [5,6], [6,7], [7,4], [0,4], [1,5], [2,6], [3,7]];
    return { positions, normals, indices, uvs, edges: edges.flatMap(edge => edge.flatMap(i => corners[i])) };
  }

  class BlockViewport {
    constructor(canvas, options = {}) {
      if (!canvas || !canvas.parentElement) throw new Error('三维画布需要放在容器中。');
      this.canvas = canvas;
      this.parent = canvas.parentElement;
      this.onSelect = typeof options.onSelect === 'function' ? options.onSelect : () => {};
      this.gl = canvas.getContext('webgl', { antialias: true, alpha: true, depth: true, premultipliedAlpha: true });
      if (!this.gl) throw new Error('当前浏览器未能开启 WebGL。请开启硬件加速后重新打开。');
      this.character = null;
      this.selected = null;
      this.focusPartId = null;
      this._faceSource = null;
      this._faceTexture = null;
      this._faceReady = false;
      this.yaw = 0.58;
      this.pitch = 0.19;
      this.view = 'perspective';
      this.zoom = 1;
      this.width = 1;
      this.height = 1;
      this._frame = null;
      this._disposed = false;
      this._pointers = new Map();
      this._dragged = false;
      this._buffers = [];
      this._gridKey = '';
      if (getComputedStyle(this.parent).position === 'static') this.parent.style.position = 'relative';
      Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' });
      this.overlay = document.createElement('canvas');
      this.overlay.setAttribute('aria-hidden', 'true');
      Object.assign(this.overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      this.parent.appendChild(this.overlay);
      this.ctx = this.overlay.getContext('2d');
      this._initGL();
      this._bindEvents();
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(this.parent);
      this._resize();
    }

    _initGL() {
      const gl = this.gl;
      const shaders = [];
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error('三维着色器初始化失败：' + message);
        }
        shaders.push(shader);
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('三维渲染程序初始化失败。');
      this.program = program;
      this.loc = {};
      ['matrix', 'center', 'size', 'color', 'unlit', 'gridFade', 'target', 'faceTexture', 'faceEnabled'].forEach(name => {
        this.loc[name] = gl.getUniformLocation(program, 'u_' + name);
      });
      this.loc.position = gl.getAttribLocation(program, 'a_position');
      this.loc.normal = gl.getAttribLocation(program, 'a_normal');
      this.loc.uv = gl.getAttribLocation(program, 'a_uv');
      const mesh = boxGeometry();
      this.box = this._makeGeometry(mesh.positions, mesh.normals, mesh.indices, mesh.uvs);
      this.edges = this._makeGeometry(mesh.edges);
      this.gridMinor = this._makeGeometry([]);
      this.gridMajor = this._makeGeometry([]);
      this._faceTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._faceTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._uploadFaceTexture();
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clearColor(0, 0, 0, 0);
    }

    _makeGeometry(positions, normals, indices, uvs) {
      const gl = this.gl;
      const make = (type, data) => {
        const buffer = gl.createBuffer();
        this._buffers.push(buffer);
        gl.bindBuffer(type, buffer);
        gl.bufferData(type, data, gl.STATIC_DRAW);
        return buffer;
      };
      return {
        position: make(gl.ARRAY_BUFFER, new Float32Array(positions)),
        normal: normals ? make(gl.ARRAY_BUFFER, new Float32Array(normals)) : null,
        uv: uvs ? make(gl.ARRAY_BUFFER, new Float32Array(uvs)) : null,
        indices: indices ? make(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)) : null,
        count: indices ? indices.length : positions.length / 3,
      };
    }

    _bindEvents() {
      this._handlers = {
        pointerdown: event => {
          if (event.button !== 0 && event.pointerType !== 'touch') return;
          this.canvas.setPointerCapture(event.pointerId);
          this._pointers.set(event.pointerId, [event.clientX, event.clientY]);
          if (this._pointers.size === 1) {
            this._start = [event.clientX, event.clientY];
            this._dragged = false;
          } else {
            this._dragged = true;
            this._pinch = this._pinchDistance();
          }
          this.canvas.style.cursor = 'grabbing';
        },
        pointermove: event => {
          const previous = this._pointers.get(event.pointerId);
          if (!previous) return;
          const dx = event.clientX - previous[0], dy = event.clientY - previous[1];
          this._pointers.set(event.pointerId, [event.clientX, event.clientY]);
          if (this._pointers.size > 1) {
            const distance = this._pinchDistance();
            if (this._pinch > 0 && distance > 0) this.zoomBy(distance / this._pinch);
            this._pinch = distance;
          } else {
            if (Math.hypot(event.clientX - this._start[0], event.clientY - this._start[1]) > 4) this._dragged = true;
            if (this._dragged) {
              this.yaw -= dx * 0.008;
              this.pitch = clamp(this.pitch + dy * 0.006, -0.2, 1.25);
              this.view = 'perspective';
              this._invalidate();
            }
          }
        },
        pointerup: event => {
          if (!this._pointers.has(event.pointerId)) return;
          if (!this._dragged && this._pointers.size === 1) {
            const rect = this.canvas.getBoundingClientRect();
            this.onSelect(this._pick(event.clientX - rect.left, event.clientY - rect.top));
          }
          this._pointers.delete(event.pointerId);
          if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
          this.canvas.style.cursor = this._pointers.size ? 'grabbing' : 'grab';
        },
        pointercancel: event => {
          this._pointers.delete(event.pointerId);
          this._dragged = true;
          this.canvas.style.cursor = this._pointers.size ? 'grabbing' : 'grab';
        },
        wheel: event => {
          event.preventDefault();
          const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
          this.zoomBy(Math.exp(-clamp(delta, -200, 200) * 0.0015));
        },
        webglcontextlost: event => { event.preventDefault(); this._contextLost = true; },
        webglcontextrestored: () => {
          this._contextLost = false;
          this._buffers = [];
          this._gridKey = '';
          this._initGL();
          this._invalidate();
        },
      };
      Object.entries(this._handlers).forEach(([name, handler]) => this.canvas.addEventListener(name, handler, name === 'wheel' ? { passive: false } : undefined));
    }

    _pinchDistance() {
      const points = [...this._pointers.values()];
      return points.length > 1 ? Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) : 0;
    }

    _resize() {
      if (this._disposed) return;
      const rect = this.parent.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      this.dpr = dpr;
      [this.canvas, this.overlay].forEach(canvas => {
        canvas.width = Math.round(this.width * dpr);
        canvas.height = Math.round(this.height * dpr);
      });
      this._invalidate();
    }

    setCharacter(character) {
      this.character = character;
      this.zoom = 1;
      this._invalidate();
    }

    setSelected(partId) {
      this.selected = partId || null;
      this._invalidate();
    }

    /** Upload the current pixels; call again after drawing on the same canvas. */
    setFaceTexture(source) {
      if (this._disposed) return;
      if (source != null) {
        const width = source.naturalWidth === undefined ? source.width : source.naturalWidth;
        const height = source.naturalHeight === undefined ? source.height : source.naturalHeight;
        if (!(width > 0 && height > 0)) throw new Error('面部画布不能为空，图片需要先完成加载。');
      }
      this._faceSource = source || null;
      if (!this._contextLost) this._uploadFaceTexture();
      this._invalidate();
    }

    _uploadFaceTexture() {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._faceTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      this._faceReady = false;
      if (this._faceSource) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._faceSource);
        this._faceReady = true;
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      }
    }

    /** Isolate a part in this preview; the six-box character data stays intact. */
    setFocusPart(partId) {
      this.focusPartId = typeof partId === 'string' && partId ? partId : null;
      this.zoom = 1;
      this._invalidate();
    }

    setView(view) {
      if (view === 'front') { this.yaw = 0; this.pitch = 0; }
      else if (view === 'side') { this.yaw = Math.PI / 2; this.pitch = 0; }
      else { view = 'perspective'; this.yaw = 0.58; this.pitch = 0.19; }
      this.view = view;
      this.zoom = 1;
      this._invalidate();
    }

    fit() { this.zoom = 1; this._invalidate(); }

    zoomBy(factor) {
      if (Number.isFinite(factor) && factor > 0) this.zoom = clamp(this.zoom / factor, 0.35, 3.5);
      this._invalidate();
    }

    _invalidate() {
      if (this._disposed || this._frame !== null) return;
      this._frame = requestAnimationFrame(() => { this._frame = null; this._render(); });
    }

    _camera() {
      const focusPart = this.character.parts.find(part => part.id === this.focusPartId) || null;
      const bounds = focusPart ? {
        min: focusPart.center.map((value, axis) => value - focusPart.size[axis] / 2),
        max: focusPart.center.map((value, axis) => value + focusPart.size[axis] / 2),
        size: focusPart.size,
      } : this.character.bounds;
      const target = bounds.min.map((v, i) => (v + bounds.max[i]) / 2);
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
      const right = [cy, 0, -sy], up = [-sy * sp, cp, -cy * sp], forward = [sy * cp, sp, cy * cp];
      let extentX = 0, extentY = 0;
      for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
        const corner = [x ? bounds.max[0] : bounds.min[0], y ? bounds.max[1] : bounds.min[1], z ? bounds.max[2] : bounds.min[2]];
        const offset = subtract(corner, target);
        extentX = Math.max(extentX, Math.abs(dot(right, offset)));
        extentY = Math.max(extentY, Math.abs(dot(up, offset)));
      }
      const aspect = this.width / this.height;
      const compact = this.height < 600;
      const topReserve = focusPart ? 96 : 64;
      const centerY = compact ? (topReserve + this.height - 120) / 2 : this.height / 2;
      const availableX = this.width > 500 ? 0.73 : 0.67;
      const availableY = compact ? Math.max(0.15, (this.height - topReserve - 120) / this.height) : focusPart ? 0.68 : 0.76;
      const halfHeight = Math.max(0.08, extentY / availableY, extentX / aspect / availableX) * this.zoom;
      const halfWidth = halfHeight * aspect;
      const span = Math.max(...bounds.size, 0.2);
      const sceneSpan = Math.max(...this.character.bounds.size, span);
      const distance = Math.max(20, sceneSpan * 5);
      const eye = addScaled(target, forward, distance);
      const near = 0.01, far = distance * 2 + sceneSpan * 10;
      const view = new Float32Array([
        right[0], up[0], forward[0], 0,
        right[1], up[1], forward[1], 0,
        right[2], up[2], forward[2], 0,
        -dot(right, eye), -dot(up, eye), -dot(forward, eye), 1,
      ]);
      const projection = new Float32Array([
        1 / halfWidth, 0, 0, 0, 0, 1 / halfHeight, 0, 0, 0, 0, -2 / (far - near), 0,
        0, 2 * (this.height / 2 - centerY) / this.height, -(far + near) / (far - near), 1,
      ]);
      return { target, right, up, forward, halfHeight, halfWidth, centerY, compact, distance, span, bounds, focusPart, matrix: multiply(projection, view) };
    }

    _updateGrid(camera) {
      const gl = this.gl;
      const step = camera.span < 1.5 ? 0.1 : camera.span < 3 ? 0.25 : camera.span < 6 ? 0.5 : 1;
      const radius = Math.max(camera.span * 2.8, camera.halfWidth * 1.8, camera.halfHeight * 2.4);
      const count = Math.min(180, Math.ceil(radius / step));
      const extent = count * step;
      const originX = Math.round(camera.target[0] / step) * step;
      const originZ = Math.round(camera.target[2] / step) * step;
      const key = [step, count, originX, originZ].join(':');
      this.gridStep = step;
      this.gridExtent = extent;
      if (key === this._gridKey) return;
      this._gridKey = key;
      const minor = [], major = [];
      for (let i = -count; i <= count; i++) {
        const array = i % 4 === 0 ? major : minor;
        const offset = i * step;
        array.push(originX + offset, 0, originZ - extent, originX + offset, 0, originZ + extent);
        array.push(originX - extent, 0, originZ + offset, originX + extent, 0, originZ + offset);
      }
      [[this.gridMinor, minor], [this.gridMajor, major]].forEach(([geometry, data]) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
        geometry.count = data.length / 3;
      });
    }

    _draw(geometry, mode, center, size, color, unlit, gridFade = 0, faceEnabled = false) {
      const gl = this.gl, loc = this.loc;
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.position);
      gl.enableVertexAttribArray(loc.position);
      gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 0, 0);
      if (geometry.normal) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normal);
        gl.enableVertexAttribArray(loc.normal);
        gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(loc.normal);
        gl.vertexAttrib3f(loc.normal, 0, 1, 0);
      }
      if (geometry.uv) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.uv);
        gl.enableVertexAttribArray(loc.uv);
        gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(loc.uv);
        gl.vertexAttrib2f(loc.uv, 0, 0);
      }
      gl.uniform3fv(loc.center, center);
      gl.uniform3fv(loc.size, size);
      gl.uniform4fv(loc.color, color);
      gl.uniform1f(loc.unlit, unlit);
      gl.uniform1f(loc.gridFade, gridFade);
      gl.uniform1f(loc.faceEnabled, faceEnabled ? 1 : 0);
      if (geometry.indices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indices);
        gl.drawElements(mode, geometry.count, gl.UNSIGNED_SHORT, 0);
      } else gl.drawArrays(mode, 0, geometry.count);
    }

    _render() {
      if (this._disposed || this._contextLost) return;
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      if (!this.character || !this.character.parts.length) return;
      const camera = this._camera();
      const visibleParts = camera.focusPart ? [camera.focusPart] : this.character.parts;
      this._currentCamera = camera;
      this._updateGrid(camera);
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.loc.matrix, false, camera.matrix);
      gl.uniform3fv(this.loc.target, camera.target);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._faceTexture);
      gl.uniform1i(this.loc.faceTexture, 0);
      if (!camera.focusPart) {
        gl.depthMask(false);
        this._draw(this.gridMinor, gl.LINES, [0,0,0], [1,1,1], [0.48, 0.59, 0.63, 0.11], 1, this.gridExtent);
        this._draw(this.gridMajor, gl.LINES, [0,0,0], [1,1,1], [0.56, 0.65, 0.69, 0.17], 1, this.gridExtent);
        gl.depthMask(true);
      }
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      const isSelected = part => part.id === this.selected ||
        (this.selected?.endsWith('Arm') && part.id.endsWith('Arm')) ||
        (this.selected?.endsWith('Leg') && part.id.endsWith('Leg'));
      visibleParts.forEach(part => {
        const color = isSelected(part) ? [0.863, 0.647, 0.424, 1] : [0.784, 0.773, 0.725, 1];
        this._draw(this.box, gl.TRIANGLES, part.center, part.size, color, 0, 0, part.id === 'head' && this._faceReady);
      });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      visibleParts.forEach(part => {
        const color = isSelected(part) ? [0.98, 0.77, 0.54, 0.70] : [0.88, 0.88, 0.81, 0.21];
        this._draw(this.edges, gl.LINES, part.center, part.size, color, 1);
      });
      this._drawOverlay(camera);
    }

    _project(point, camera) {
      const offset = subtract(point, camera.target);
      return [
        this.width * 0.5 + dot(offset, camera.right) / camera.halfWidth * this.width * 0.5,
        camera.centerY - dot(offset, camera.up) / camera.halfHeight * this.height * 0.5,
      ];
    }

    _drawOverlay(camera) {
      const ctx = this.ctx, width = this.width, height = this.height;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'middle';
      const bounds = camera.bounds;
      const top = this._project([camera.target[0], bounds.max[1], camera.target[2]], camera)[1];
      const bottom = this._project([camera.target[0], bounds.min[1], camera.target[2]], camera)[1];
      const rulerX = width - (width < 500 ? 27 : 38);
      if (bottom - top > 45 && bottom > 50 && top < height - 50) {
        const safeTop = Math.max(44, top), safeBottom = Math.min(height - (camera.compact ? 115 : 56), bottom);
        ctx.strokeStyle = 'rgba(157, 175, 183, 0.36)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rulerX + 0.5, safeTop); ctx.lineTo(rulerX + 0.5, safeBottom);
        ctx.stroke();
        const total = bounds.max[1] - bounds.min[1];
        const tickStep = total < 0.9 ? 0.1 : total < 2 ? 0.25 : total < 4 ? 0.5 : total < 8 ? 1 : 2;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(176, 189, 195, 0.70)';
        for (let value = 0; value < total - tickStep * 0.18; value += tickStep) {
          const y = bottom - value / total * (bottom - top);
          if (y < safeTop + 5 || y > safeBottom + 1) continue;
          ctx.beginPath(); ctx.moveTo(rulerX - 5, y + 0.5); ctx.lineTo(rulerX + 5, y + 0.5); ctx.stroke();
          ctx.fillText(Number(value.toFixed(2)).toString(), rulerX - 10, y);
        }
        if (top >= 44 && top <= height - 70) {
          ctx.strokeStyle = 'rgba(220, 165, 108, 0.72)';
          ctx.beginPath(); ctx.moveTo(rulerX - 6, top + 0.5); ctx.lineTo(rulerX + 6, top + 0.5); ctx.stroke();
          ctx.fillStyle = 'rgba(175, 187, 193, 0.85)';
          ctx.font = '10px system-ui, -apple-system, sans-serif';
          ctx.fillText(camera.focusPart ? camera.focusPart.name + '高' : '总高', rulerX + 6, top - 37);
          ctx.fillStyle = '#e0c6a4';
          ctx.font = '500 13px system-ui, -apple-system, sans-serif';
          ctx.fillText(total.toFixed(2) + ' m', rulerX + 6, top - 19);
        }
      }
      const scale = this.gridStep;
      const scaleWidth = scale / camera.halfHeight * height * 0.5;
      // Reserve the stage footer (view toolbar and two-line mobile caption).
      const sx = width < 500 ? 20 : 28, sy = height - 126;
      if (scaleWidth >= 12 && scaleWidth < width * 0.45) {
        ctx.strokeStyle = 'rgba(164, 182, 190, 0.50)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 1); ctx.lineTo(sx + scaleWidth, sy + 1); ctx.lineTo(sx + scaleWidth, sy - 4);
        ctx.stroke();
        ctx.fillStyle = 'rgba(167, 181, 189, 0.72)';
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText((camera.focusPart ? '刻度 ' : '网格 ') + scale + ' m', sx, sy - 13);
      }
      this._drawAxes(camera);
    }

    _drawAxes(camera) {
      const ctx = this.ctx;
      const origin = [this.width - 76, this.height - 126];
      const axes = [
        { vector: [1,0,0], color: '#a57670', label: 'X' },
        { vector: [0,1,0], color: '#8ba18c', label: 'Y' },
        { vector: [0,0,1], color: '#7292a8', label: 'Z' },
      ].sort((a, b) => dot(a.vector, camera.forward) - dot(b.vector, camera.forward));
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      axes.forEach(axis => {
        const dx = dot(axis.vector, camera.right) * 18;
        const dy = -dot(axis.vector, camera.up) * 18;
        if (Math.hypot(dx, dy) < 3) return;
        ctx.strokeStyle = axis.color; ctx.fillStyle = axis.color; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(...origin); ctx.lineTo(origin[0] + dx, origin[1] + dy); ctx.stroke();
        ctx.fillText(axis.label, origin[0] + dx * 1.32, origin[1] + dy * 1.32);
      });
    }

    _pick(x, y) {
      if (!this.character) return null;
      const camera = this._camera();
      const visibleParts = camera.focusPart ? [camera.focusPart] : this.character.parts;
      let origin = addScaled(camera.target, camera.right, (x / this.width * 2 - 1) * camera.halfWidth);
      origin = addScaled(origin, camera.up, (camera.centerY - y) / this.height * 2 * camera.halfHeight);
      origin = addScaled(origin, camera.forward, camera.distance);
      const direction = camera.forward.map(v => -v);
      let nearest = Infinity, selected = null;
      visibleParts.forEach(part => {
        let near = 0, far = Infinity;
        for (let axis = 0; axis < 3; axis++) {
          const low = part.center[axis] - part.size[axis] / 2;
          const high = part.center[axis] + part.size[axis] / 2;
          if (Math.abs(direction[axis]) < 1e-9) {
            if (origin[axis] < low || origin[axis] > high) return;
          } else {
            const first = (low - origin[axis]) / direction[axis], second = (high - origin[axis]) / direction[axis];
            near = Math.max(near, Math.min(first, second));
            far = Math.min(far, Math.max(first, second));
            if (near > far) return;
          }
        }
        if (near < nearest) { nearest = near; selected = part.id; }
      });
      return selected;
    }

    dispose() {
      this._disposed = true;
      if (this._frame !== null) cancelAnimationFrame(this._frame);
      this.resizeObserver.disconnect();
      Object.entries(this._handlers).forEach(([name, handler]) => this.canvas.removeEventListener(name, handler));
      this._buffers.forEach(buffer => this.gl.deleteBuffer(buffer));
      this.gl.deleteTexture(this._faceTexture);
      this._faceTexture = null;
      this._faceSource = null;
      this.gl.deleteProgram(this.program);
      this.overlay.remove();
      this._pointers.clear();
    }
  }

  global.BlockViewport = BlockViewport;
})(globalThis);
