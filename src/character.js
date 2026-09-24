(function attachBlockCharacter(root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    headScale: 1,
    torsoScale: 1,
    armLength: 0.65,
    legLength: 0.8,
  });
  const KEYS = Object.freeze(Object.keys(DEFAULTS));
  const LEGACY_KEYS = Object.freeze([
    "headScale", "torsoScale", "leftArmLength", "rightArmLength", "leftLegLength", "rightLegLength",
  ]);
  const LIMITS = Object.freeze(Object.fromEntries(KEYS.map((key) => [
    key,
    Object.freeze(key.endsWith("Scale")
      ? { min: 0.15, max: 5, step: 0.01 }
      : { min: 0.04, max: 4, step: 0.01 }),
  ])));
  const PRESETS = Object.freeze({
    default: DEFAULTS,
    small: Object.freeze({
      headScale: 0.25,
      torsoScale: 0.25,
      armLength: 0.18,
      legLength: 0.25,
    }),
    tall: Object.freeze({
      headScale: 2.5,
      torsoScale: 2.5,
      armLength: 1.8,
      legLength: 2.5,
    }),
    longArms: Object.freeze({ ...DEFAULTS, armLength: 2.4 }),
  });

  function assertRecord(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${label}必须是对象。`);
    }
  }

  /** Fill omitted values and clamp valid numeric edits. Imports use strict validation below. */
  function normalizeParams(params = {}) {
    assertRecord(params, "角色参数");
    for (const key of Object.keys(params)) {
      if (!KEYS.includes(key)) throw new TypeError(`未知角色参数：${key}`);
    }
    return Object.fromEntries(KEYS.map((key) => {
      const value = Object.hasOwn(params, key) ? params[key] : DEFAULTS[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`参数 ${key} 必须是有限数字。`);
      }
      return [key, Math.min(LIMITS[key].max, Math.max(LIMITS[key].min, value))];
    }));
  }

  /** Meter units; character left is +X, up is +Y, and front is +Z. */
  function createCharacter(input = {}) {
    const params = normalizeParams(input);
    const head = [0.4, 0.4, 0.4].map((length) => length * params.headScale);
    const torso = [0.48, 0.6, 0.28].map((length) => length * params.torsoScale);
    const hipY = params.legLength;
    const shoulderY = hipY + torso[1];
    // When arms extend below the feet, the lowest arm endpoint defines the floor.
    const floorOffset = Math.max(0, params.armLength - shoulderY);
    const legX = Math.max(0.1, torso[0] / 4);
    const armX = torso[0] / 2 + 0.08;
    const part = (id, name, size, center) => ({
      id, name, size, center: [center[0], center[1] + floorOffset, center[2]],
    });
    const parts = [
      part("head", "头部", head, [0, shoulderY + head[1] / 2, 0]),
      part("torso", "躯干", torso, [0, hipY + torso[1] / 2, 0]),
      part("leftArm", "左臂", [0.16, params.armLength, 0.22], [armX, shoulderY - params.armLength / 2, 0]),
      part("rightArm", "右臂", [0.16, params.armLength, 0.22], [-armX, shoulderY - params.armLength / 2, 0]),
      part("leftLeg", "左腿", [0.2, params.legLength, 0.24], [legX, hipY - params.legLength / 2, 0]),
      part("rightLeg", "右腿", [0.2, params.legLength, 0.24], [-legX, hipY - params.legLength / 2, 0]),
    ];
    const min = [0, 1, 2].map((axis) => Math.min(...parts.map((box) => box.center[axis] - box.size[axis] / 2)));
    const max = [0, 1, 2].map((axis) => Math.max(...parts.map((box) => box.center[axis] + box.size[axis] / 2)));
    // Avoid displaying negative zero or roundoff below the floor.
    if (Math.abs(min[1]) < 1e-12) min[1] = 0;
    const bounds = { min, max, size: max.map((value, axis) => value - min[axis]) };
    const notes = [
      "头部和躯干保持各自比例，缩放参数作用于三条边；体积随缩放倍数的三次方变化。",
      "手臂截面固定为 0.16 × 0.22 米，腿部截面固定为 0.20 × 0.24 米。",
      "左右手臂共用臂长，左右腿共用腿长。",
      "总高度按全部六个方块的最高点和最低点计算；身高由头部高度、躯干高度及腿长自然得出。",
    ];
    if (floorOffset > 0) {
      notes.push("手臂低于脚底，模型以最低手臂端点落地；显示总高度包含这段长度。");
    }
    return {
      params,
      parts,
      bounds,
      height: bounds.size[1],
      standingHeight: hipY + torso[1] + head[1],
      totalVolume: parts.reduce((sum, box) => sum + box.size[0] * box.size[1] * box.size[2], 0),
      metadata: {
        unit: "m",
        axes: { x: "角色左侧", y: "上方", z: "正面" },
        floorOffset,
        notes,
      },
    };
  }

  /** Check the bounded PNG envelope; pixel decoding remains the browser's responsibility. */
  function validateFace(face) {
    if (face === null) return null;
    assertRecord(face, "面部贴图");
    const keys = Object.keys(face);
    if (keys.length !== 3 || !["width", "height", "png"].every((key) => Object.hasOwn(face, key))) {
      throw new TypeError("面部贴图必须只包含 width、height 和 png。");
    }
    if (face.width !== 128 || face.height !== 128) throw new RangeError("面部贴图必须为 128 × 128 像素。");
    const prefix = "data:image/png;base64,";
    if (typeof face.png !== "string" || !face.png.startsWith(prefix)) {
      throw new TypeError("面部贴图必须是 PNG 的 Base64 数据地址。");
    }
    if (face.png.length >= 200 * 1024) throw new RangeError("面部贴图数据地址必须小于 200 KiB。");
    const encoded = face.png.slice(prefix.length);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new TypeError("面部贴图包含无效的 Base64 数据。");
    }
    let bytes;
    try {
      if (typeof root.atob === "function") {
        bytes = Uint8Array.from(root.atob(encoded), (character) => character.charCodeAt(0));
      } else if (typeof Buffer !== "undefined") {
        bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
      } else {
        throw new Error("Base64 decoding unavailable");
      }
    } catch {
      throw new TypeError("无法解码面部贴图的 Base64 数据。");
    }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte)) {
      throw new TypeError("面部贴图不是有效的 PNG 文件。");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunkType = (offset) => String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (view.getUint32(8) !== 13 || chunkType(8) !== "IHDR") {
      throw new TypeError("面部贴图缺少有效的 PNG 图像头。");
    }
    if (view.getUint32(16) !== 128 || view.getUint32(20) !== 128) {
      throw new RangeError("面部 PNG 的实际尺寸必须为 128 × 128 像素。");
    }
    const bitDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!bitDepths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) {
      throw new TypeError("面部贴图的 PNG 图像头无效。");
    }
    let offset = 8, hasPixels = false, hasEnd = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) throw new TypeError("面部 PNG 数据不完整。");
      const length = view.getUint32(offset), type = chunkType(offset);
      if (offset + length + 12 > bytes.length) throw new TypeError("面部 PNG 数据块不完整。");
      if (type === "IHDR" && offset !== 8) throw new TypeError("面部 PNG 包含重复的图像头。");
      if (type === "IDAT" && length > 0) hasPixels = true;
      offset += length + 12;
      if (type === "IEND") {
        if (length !== 0 || offset !== bytes.length) throw new TypeError("面部 PNG 的结束数据块无效。");
        hasEnd = true;
        break;
      }
    }
    if (!hasPixels || !hasEnd) throw new TypeError("面部 PNG 缺少像素数据或结束数据块。");
    return { width: 128, height: 128, png: face.png };
  }

  function exportData(params = {}, face = null) {
    const character = createCharacter(params);
    return {
      format: "fps-block-character",
      version: 3,
      parameters: character.params,
      face: validateFace(face),
      computed: {
        unit: "m",
        height: character.height,
        standingHeight: character.standingHeight,
        totalVolume: character.totalVolume,
      },
    };
  }

  /** Validate old schemas before migration. Computed fields are never trusted as input. */
  function parseProject(data) {
    let parsed = data;
    if (typeof data === "string") {
      try { parsed = JSON.parse(data); }
      catch { throw new TypeError("文件不是有效的 JSON。"); }
    }
    assertRecord(parsed, "导入文件");
    if (parsed.format !== "fps-block-character") throw new TypeError("文件不是方块角色格式（fps-block-character）。");
    if (![1, 2, 3].includes(parsed.version)) throw new TypeError("不支持此角色文件版本；当前支持版本 1、2 和 3。");
    const allowed = ["format", "version", "parameters", "computed", ...(parsed.version >= 2 ? ["face"] : [])];
    for (const key of Object.keys(parsed)) {
      if (!allowed.includes(key)) throw new TypeError(`导入文件包含未知字段：${key}`);
    }
    assertRecord(parsed.parameters, "文件中的 parameters");
    if (Object.hasOwn(parsed, "computed")) assertRecord(parsed.computed, "文件中的 computed");
    const sourceKeys = parsed.version === 3 ? KEYS : LEGACY_KEYS;
    for (const key of Object.keys(parsed.parameters)) {
      if (!sourceKeys.includes(key)) throw new TypeError(`未知角色参数：${key}`);
    }
    for (const key of sourceKeys) {
      if (!Object.hasOwn(parsed.parameters, key)) throw new TypeError(`导入文件缺少参数：${key}`);
      const value = parsed.parameters[key];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`参数 ${key} 必须是有限数字。`);
      const limit = LIMITS[key] || (key.includes("Arm") ? LIMITS.armLength : LIMITS.legLength);
      if (value < limit.min || value > limit.max) {
        throw new RangeError(`参数 ${key} 超出范围 ${limit.min}–${limit.max}；文件未导入。`);
      }
    }
    const migrationNotes = [];
    let parameters = parsed.parameters;
    if (parsed.version < 3) {
      // Averaging each pair preserves the combined limb volume with fixed cross sections.
      parameters = {
        headScale: parsed.parameters.headScale,
        torsoScale: parsed.parameters.torsoScale,
        armLength: (parsed.parameters.leftArmLength + parsed.parameters.rightArmLength) / 2,
        legLength: (parsed.parameters.leftLegLength + parsed.parameters.rightLegLength) / 2,
      };
      if (parsed.parameters.leftArmLength !== parsed.parameters.rightArmLength) {
        migrationNotes.push("旧版左右手臂长度不同，已取两者平均值作为统一臂长。");
      }
      if (parsed.parameters.leftLegLength !== parsed.parameters.rightLegLength) {
        migrationNotes.push("旧版左右腿长度不同，已取两者平均值作为统一腿长。");
      }
    }
    return {
      parameters: normalizeParams(parameters),
      face: parsed.version >= 2 && Object.hasOwn(parsed, "face") ? validateFace(parsed.face) : null,
      migrationNotes,
    };
  }

  /** Preserve the original parameters-only API for existing geometry consumers. */
  function parseData(data) {
    return parseProject(data).parameters;
  }

  const api = Object.freeze({ DEFAULTS, LIMITS, PRESETS, createCharacter, normalizeParams, exportData, parseData, parseProject });
  root.BlockCharacter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
