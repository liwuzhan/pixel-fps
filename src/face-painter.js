(function attachFacePainter(root) {
  'use strict';

  const SIZE = 128;
  const HISTORY_LIMIT = 31;
  const PNG_PREFIX = 'data:image/png;base64,';
  const noop = () => {};
  const copyImage = image => new ImageData(new Uint8ClampedArray(image.data), SIZE, SIZE);
  const sameImage = (a, b) => {
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
    return true;
  };

  // Clip a stroke segment, rather than clamping pointer coordinates to an edge.
  // This preserves natural lines when a captured pointer leaves the canvas.
  function clipSegment(a, b, margin) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let start = 0, end = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x + margin, SIZE + margin - a.x, a.y + margin, SIZE + margin - a.y];
    for (let i = 0; i < 4; i++) {
      if (!p[i]) { if (q[i] < 0) return null; continue; }
      const ratio = q[i] / p[i];
      if (p[i] < 0) start = Math.max(start, ratio);
      else end = Math.min(end, ratio);
      if (start > end) return null;
    }
    return [a.x + start * dx, a.y + start * dy, a.x + end * dx, a.y + end * dy];
  }

  class FacePainter {
    constructor(canvas, { onChange = noop, onCommit = noop, onHistoryChange = noop } = {}) {
      if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('需要一个画布。');
      this.canvas = canvas;
      canvas.width = canvas.height = SIZE;
      this.context = canvas.getContext('2d', { willReadFrequently: true });
      if (!this.context) throw new Error('浏览器无法创建面部画布。');
      canvas.style.touchAction = 'none';
      canvas.style.imageRendering = 'pixelated';
      this.context.imageSmoothingEnabled = false;
      this.imageData = this.context.createImageData(SIZE, SIZE);
      this.tool = 'brush';
      this.color = '#161616';
      this.size = 4;
      this._rgba = [22, 22, 22, 255];
      this._onChange = onChange;
      this._onCommit = onCommit;
      this._onHistoryChange = onHistoryChange;
      this._history = [copyImage(this.imageData)];
      this._historyIndex = 0;
      this._stroke = null;
      this._handlers = {
        down: event => this._pointerDown(event),
        move: event => this._pointerMove(event),
        up: event => this._pointerUp(event),
        cancel: event => { if (this._stroke?.pointerId === event.pointerId) this._cancelStroke(); },
        lost: event => { if (this._stroke?.pointerId === event.pointerId) this.finishStroke(); },
        blur: () => this.finishStroke(),
      };
      canvas.addEventListener('pointerdown', this._handlers.down);
      canvas.addEventListener('lostpointercapture', this._handlers.lost);
      // Window listeners also cover browsers where pointer capture is unavailable.
      root.addEventListener('pointermove', this._handlers.move, { passive: false });
      root.addEventListener('pointerup', this._handlers.up);
      root.addEventListener('pointercancel', this._handlers.cancel);
      root.addEventListener('blur', this._handlers.blur);
      root.addEventListener('pagehide', this._handlers.blur);
      this._emitHistory();
    }

    setTool(tool) {
      if (!['brush', 'eraser'].includes(tool)) throw new TypeError('未知画笔工具。');
      this.tool = tool;
    }

    setColor(color) {
      if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw new TypeError('颜色应为六位十六进制值。');
      this.color = color.toLowerCase();
      this._rgba = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)).concat(255);
    }

    setSize(size) {
      if (!Number.isInteger(size) || size < 1 || size > 24) throw new RangeError('笔宽应为 1–24 像素的整数。');
      this.size = size;
    }

    _point(event) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = rect.width / (this.canvas.offsetWidth || rect.width || 1);
      const scaleY = rect.height / (this.canvas.offsetHeight || rect.height || 1);
      const width = (this.canvas.clientWidth || rect.width) * scaleX;
      const height = (this.canvas.clientHeight || rect.height) * scaleY;
      if (!width || !height) return null;
      return {
        x: (event.clientX - rect.left - this.canvas.clientLeft * scaleX) * SIZE / width,
        y: (event.clientY - rect.top - this.canvas.clientTop * scaleY) * SIZE / height,
      };
    }

    _pointerDown(event) {
      if (this._stroke || event.button !== 0 || event.isPrimary === false) return;
      const point = this._point(event);
      if (!point) return;
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this._stroke = {
        pointerId: event.pointerId, last: point,
        size: this.size, rgba: this.tool === 'eraser' ? [0, 0, 0, 0] : this._rgba.slice(),
      };
      try { this.canvas.setPointerCapture(event.pointerId); } catch (_) { /* Window listeners remain active. */ }
      if (this._line(point, point)) this._publish();
    }

    _pointerMove(event) {
      if (!this._stroke || this._stroke.pointerId !== event.pointerId) return;
      event.preventDefault();
      let events = [];
      try { events = event.getCoalescedEvents?.() || []; } catch (_) { /* A normal event is sufficient. */ }
      if (!events.length) events = [event];
      let changed = false;
      for (const sample of events) {
        const point = this._point(sample);
        if (!point) continue;
        changed = this._line(this._stroke.last, point) || changed;
        this._stroke.last = point;
      }
      if (changed) this._publish();
    }

    _pointerUp(event) {
      if (!this._stroke || this._stroke.pointerId !== event.pointerId) return;
      this._pointerMove(event);
      this.finishStroke();
    }

    _line(a, b) {
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return false;
      const clipped = clipSegment(a, b, this._stroke.size);
      if (!clipped) return false;
      let [x, y, endX, endY] = clipped.map(Math.floor);
      const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
      const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
      let error = dx + dy, changed = false;
      while (true) {
        changed = this._stamp(x, y) || changed;
        if (x === endX && y === endY) break;
        const twice = error * 2;
        if (twice >= dy) { error += dy; x += sx; }
        if (twice <= dx) { error += dx; y += sy; }
      }
      return changed;
    }

    _stamp(x, y) {
      const { size, rgba } = this._stroke;
      const originX = x - Math.floor(size / 2), originY = y - Math.floor(size / 2);
      const center = (size - 1) / 2, radiusSquared = size * size / 4;
      const pixels = this.imageData.data;
      let changed = false;
      for (let row = 0; row < size; row++) {
        const py = originY + row;
        if (py < 0 || py >= SIZE) continue;
        for (let column = 0; column < size; column++) {
          const px = originX + column;
          if (px < 0 || px >= SIZE || (column - center) ** 2 + (row - center) ** 2 > radiusSquared) continue;
          const offset = (py * SIZE + px) * 4;
          for (let channel = 0; channel < 4; channel++) {
            if (pixels[offset + channel] !== rgba[channel]) {
              pixels[offset + channel] = rgba[channel];
              changed = true;
            }
          }
        }
      }
      return changed;
    }

    _publish() {
      this.context.putImageData(this.imageData, 0, 0);
      this._onChange(this.canvas);
    }

    _emitHistory() {
      this._onHistoryChange({ canUndo: this._historyIndex > 0, canRedo: this._historyIndex < this._history.length - 1 });
    }

    _record() {
      if (sameImage(this.imageData, this._history[this._historyIndex])) return false;
      this._history.splice(this._historyIndex + 1);
      this._history.push(copyImage(this.imageData));
      if (this._history.length > HISTORY_LIMIT) this._history.shift();
      this._historyIndex = this._history.length - 1;
      this._emitHistory();
      this._onCommit();
      return true;
    }

    _releasePointer() {
      const pointerId = this._stroke?.pointerId;
      this._stroke = null;
      if (pointerId !== undefined) {
        try { this.canvas.releasePointerCapture(pointerId); } catch (_) { /* Capture can already be released. */ }
      }
    }

    finishStroke() {
      if (!this._stroke) return false;
      this._releasePointer();
      return this._record();
    }

    _cancelStroke(notify = true) {
      if (!this._stroke) return;
      this._releasePointer();
      const original = this._history[this._historyIndex];
      const changed = !sameImage(this.imageData, original);
      this.imageData = copyImage(original);
      if (changed && notify) this._publish();
    }

    undo() {
      this.finishStroke();
      if (this._historyIndex === 0) return false;
      this.imageData = copyImage(this._history[--this._historyIndex]);
      this._publish(); this._emitHistory(); this._onCommit();
      return true;
    }

    redo() {
      this.finishStroke();
      if (this._historyIndex === this._history.length - 1) return false;
      this.imageData = copyImage(this._history[++this._historyIndex]);
      this._publish(); this._emitHistory(); this._onCommit();
      return true;
    }

    clear() {
      this.finishStroke();
      const empty = this.context.createImageData(SIZE, SIZE);
      if (sameImage(this.imageData, empty)) return false;
      this.imageData = empty;
      this._publish();
      return this._record();
    }

    getFaceData() {
      this.finishStroke();
      for (let i = 3; i < this.imageData.data.length; i += 4) {
        if (this.imageData.data[i]) return { width: SIZE, height: SIZE, png: this.canvas.toDataURL('image/png') };
      }
      return null;
    }

    /** Decode before applying the rest of an imported character: failure changes nothing. */
    async decodeFace(face) {
      if (face == null) return null;
      if (typeof face !== 'object' || Array.isArray(face) || face.width !== SIZE || face.height !== SIZE ||
          typeof face.png !== 'string' || face.png.length > 512 * 1024 ||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(face.png)) {
        throw new TypeError('面部贴图必须是 128 × 128 的 PNG。');
      }
      let header;
      try { header = atob(face.png.slice(PNG_PREFIX.length, PNG_PREFIX.length + 44)); }
      catch (_) { throw new TypeError('面部 PNG 编码无效。'); }
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (header.length < 24 || signature.some((value, index) => header.charCodeAt(index) !== value) ||
          header.slice(12, 16) !== 'IHDR') throw new TypeError('面部 PNG 文件头无效。');
      const dimension = offset => [0, 1, 2, 3].reduce((value, index) => value * 256 + header.charCodeAt(offset + index), 0);
      if (dimension(16) !== SIZE || dimension(20) !== SIZE) throw new TypeError('面部 PNG 尺寸必须是 128 × 128。');
      const image = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new TypeError('面部 PNG 无法读取。'));
        candidate.src = face.png;
      });
      return this._stageImage(image);
    }

    _stageImage(image) {
      if (image == null) return this.context.createImageData(SIZE, SIZE);
      const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
      if (width !== SIZE || height !== SIZE) throw new TypeError('面部贴图尺寸必须是 128 × 128。');
      if (image instanceof ImageData) return copyImage(image);
      const stage = document.createElement('canvas');
      stage.width = stage.height = SIZE;
      const context = stage.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, SIZE, SIZE);
    }

    /** Replace only after staging succeeds; silent imports still update the visible canvas. */
    replaceFace(decodedOrNull, { notify = true, resetHistory = true } = {}) {
      const image = this._stageImage(decodedOrNull);
      this._cancelStroke(false);
      const changed = !sameImage(this.imageData, image);
      this.imageData = image;
      this.context.putImageData(this.imageData, 0, 0);
      if (resetHistory) {
        this._history = [copyImage(image)];
        this._historyIndex = 0;
      } else if (changed) {
        this._history.splice(this._historyIndex + 1);
        this._history.push(copyImage(image));
        if (this._history.length > HISTORY_LIMIT) this._history.shift();
        this._historyIndex = this._history.length - 1;
      }
      this._emitHistory();
      if (notify) { this._onChange(this.canvas); this._onCommit(); }
      return changed;
    }

    async loadFace(face, options) {
      const decoded = await this.decodeFace(face);
      return this.replaceFace(decoded, options);
    }

    destroy() {
      this.finishStroke();
      this.canvas.removeEventListener('pointerdown', this._handlers.down);
      this.canvas.removeEventListener('lostpointercapture', this._handlers.lost);
      root.removeEventListener('pointermove', this._handlers.move);
      root.removeEventListener('pointerup', this._handlers.up);
      root.removeEventListener('pointercancel', this._handlers.cancel);
      root.removeEventListener('blur', this._handlers.blur);
      root.removeEventListener('pagehide', this._handlers.blur);
    }
  }

  FacePainter.SIZE = SIZE;
  root.FacePainter = FacePainter;
})(globalThis);
