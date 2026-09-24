import test from "node:test";
import assert from "node:assert/strict";
import "../src/character.js";

const { DEFAULTS, LIMITS, PRESETS, createCharacter, normalizeParams, exportData, parseData, parseProject } = globalThis.BlockCharacter;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);
const byId = (character, id) => character.parts.find((part) => part.id === id);
const bottom = (part) => part.center[1] - part.size[1] / 2;
const top = (part) => part.center[1] + part.size[1] / 2;
const PARAM_KEYS = ["headScale", "torsoScale", "armLength", "legLength"];
const LEGACY_DEFAULTS = { headScale: 1, torsoScale: 1, leftArmLength: 0.65, rightArmLength: 0.65, leftLegLength: 0.8, rightLegLength: 0.8 };

test("defaults generate exactly six connected boxes and derived 1.8 m height", () => {
  const c = createCharacter();
  assert.deepEqual(Object.keys(c.params), PARAM_KEYS);
  assert.deepEqual(c.parts.map((p) => p.id), ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"]);
  close(c.height, 1.8);
  close(c.standingHeight, 1.8);
  close(bottom(byId(c, "head")), top(byId(c, "torso")));
  for (const id of ["leftArm", "rightArm"]) close(top(byId(c, id)), top(byId(c, "torso")));
  for (const id of ["leftLeg", "rightLeg"]) close(top(byId(c, id)), bottom(byId(c, "torso")));
  assert.equal(c.bounds.min[1], 0);
});

test("small and tall presets meet exact requested overall heights", () => {
  assert.equal(createCharacter(PRESETS.small).height, 0.5);
  assert.equal(createCharacter(PRESETS.tall).height, 5);
});

test("head and torso scale uniformly while limb cross sections stay fixed", () => {
  const c = createCharacter({ headScale: 3, torsoScale: 2, armLength: 4, legLength: 0.04 });
  byId(c, "head").size.forEach((length) => close(length, 1.2));
  assert.deepEqual(byId(c, "torso").size, [0.96, 1.2, 0.56]);
  assert.deepEqual(byId(c, "leftArm").size, [0.16, 4, 0.22]);
  assert.deepEqual(byId(c, "rightLeg").size, [0.2, 0.04, 0.24]);
});

test("both arms always share a length and both legs always share a length", () => {
  const c = createCharacter({ armLength: 0.2, legLength: 1.5 });
  assert.deepEqual(byId(c, "leftArm").size, byId(c, "rightArm").size);
  assert.deepEqual(byId(c, "leftLeg").size, byId(c, "rightLeg").size);
  close(top(byId(c, "leftArm")), top(byId(c, "rightArm")));
  close(top(byId(c, "leftLeg")), top(byId(c, "rightLeg")));
  close(bottom(byId(c, "leftLeg")), 0);
  close(bottom(byId(c, "rightLeg")), 0);
  close(c.standingHeight, 2.5);
  assert.throws(() => createCharacter({ leftLegLength: 0.2, rightLegLength: 1.5 }), /未知角色参数/);
});

test("long arms set the floor, enlarge the full bounds, and preserve anatomical height", () => {
  const c = createCharacter(PRESETS.longArms);
  close(c.height, 2.8);
  close(c.standingHeight, 1.8);
  close(c.metadata.floorOffset, 1);
  close(bottom(byId(c, "leftArm")), 0);
  close(bottom(byId(c, "leftLeg")), 1);
});

test("all 16 range corner combinations remain symmetric, finite, attached, and above the floor", () => {
  const keys = Object.keys(DEFAULTS);
  assert.deepEqual(keys, PARAM_KEYS);
  assert.deepEqual(Object.keys(LIMITS), PARAM_KEYS);
  for (const preset of Object.values(PRESETS)) assert.deepEqual(Object.keys(preset), PARAM_KEYS);
  for (let mask = 0; mask < 16; mask += 1) {
    const params = Object.fromEntries(keys.map((key, i) => [key, LIMITS[key][mask & (1 << i) ? "max" : "min"]]));
    const c = createCharacter(params);
    const torso = byId(c, "torso");
    assert.equal(c.parts.length, 6);
    assert.deepEqual(Object.keys(c.params), PARAM_KEYS);
    assert.deepEqual(byId(c, "leftArm").size, byId(c, "rightArm").size);
    assert.deepEqual(byId(c, "leftLeg").size, byId(c, "rightLeg").size);
    assert.equal(c.bounds.min[1], 0);
    assert.ok(Number.isFinite(c.totalVolume) && c.totalVolume > 0);
    for (const p of c.parts) {
      assert.ok(p.size.every((n) => Number.isFinite(n) && n > 0));
      assert.ok(p.center.every(Number.isFinite));
      assert.ok(bottom(p) > -1e-10);
    }
    for (const id of ["leftLeg", "rightLeg"]) {
      const leg = byId(c, id);
      close(top(leg), bottom(torso));
      assert.ok(leg.center[0] - leg.size[0] / 2 < torso.size[0] / 2);
      assert.ok(leg.center[0] + leg.size[0] / 2 > -torso.size[0] / 2);
    }
  }
});

test("interactive normalization clamps finite edits but rejects bad types and unknown keys", () => {
  assert.equal(normalizeParams({ headScale: 100 }).headScale, 5);
  assert.equal(normalizeParams({ legLength: -1 }).legLength, 0.04);
  for (const value of [NaN, Infinity, "1", null]) assert.throws(() => normalizeParams({ headScale: value }));
  assert.throws(() => normalizeParams({ height: 3 }));
  assert.throws(() => normalizeParams(LEGACY_DEFAULTS), /未知角色参数/);
  assert.ok(Object.isFrozen(DEFAULTS) && Object.isFrozen(LIMITS) && Object.isFrozen(PRESETS));
});

test("exports round-trip and imports reject corrupt or unsupported files without clamping", () => {
  assert.deepEqual(parseData(JSON.stringify(exportData(PRESETS.tall))), PRESETS.tall);
  const withoutComputed = exportData();
  delete withoutComputed.computed;
  assert.deepEqual(parseData(withoutComputed), DEFAULTS);
  const invalid = [
    "not json", null, [], {},
    { ...exportData(), format: "unknown" },
    { ...exportData(), version: 4 },
    { ...exportData(), version: "1" },
    { ...exportData(), extra: true },
    { ...exportData(), computed: [] },
    { ...exportData(), parameters: { ...DEFAULTS, headScale: 6 } },
    { ...exportData(), parameters: { ...DEFAULTS, headScale: "1" } },
    { ...exportData(), parameters: { ...DEFAULTS, headScale: NaN } },
    { ...exportData(), parameters: { ...DEFAULTS, height: 4 } },
    { ...exportData(), parameters: LEGACY_DEFAULTS },
    { ...exportData(), parameters: { ...DEFAULTS, leftArmLength: 0.65 } },
    { ...exportData(), parameters: { headScale: 1 } },
  ];
  for (const data of invalid) assert.throws(() => parseData(data));
});

// A complete 128 × 128 RGBA PNG, with IDAT and valid checksums.
const FACE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABL0lEQVR4nO3SIQEAIBDAwI9CFKLRHGIgduL8xObsdema3wEYAANgAAyAATAABsAAGAADYAAMgAEwAAbAABgAA2AADIABMAAGwAAYAANgAAyAATAABsAAGAADYAAMgAEwAAbAABgAA2CAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxD3PHxvrudgKsAAAAAElFTkSuQmCC";
const FACE = { width: 128, height: 128, png: FACE_PNG };

test("versions 1 and 2 migrate matching limbs without notices; face stays optional", () => {
  const oldProject = { format: "fps-block-character", version: 1, parameters: { ...LEGACY_DEFAULTS } };
  assert.deepEqual(parseProject(JSON.stringify(oldProject)), { parameters: DEFAULTS, face: null, migrationNotes: [] });
  assert.deepEqual(parseData(oldProject), DEFAULTS);
  assert.throws(() => parseProject({ ...oldProject, face: null }), /未知字段/);
  assert.deepEqual(parseProject({ ...oldProject, version: 2, face: FACE }), { parameters: DEFAULTS, face: FACE, migrationNotes: [] });
  assert.equal(parseProject({ ...oldProject, version: 2 }).face, null);
  const project = exportData();
  assert.equal(project.version, 3);
  assert.equal(project.face, null);
  delete project.face;
  assert.equal(parseProject(project).face, null);
});

test("version 3 face projects round-trip with four parameters and no shared mutable metadata", () => {
  const data = exportData(PRESETS.tall, FACE);
  assert.equal(data.version, 3);
  assert.deepEqual(Object.keys(data.parameters), PARAM_KEYS);
  const imported = parseProject(JSON.stringify(data));
  assert.deepEqual(imported, { parameters: PRESETS.tall, face: FACE, migrationNotes: [] });
  assert.deepEqual(parseData(data), PRESETS.tall);
  assert.notEqual(data.face, FACE);
  assert.notEqual(parseProject(data).face, data.face);
  assert.equal(createCharacter(imported.parameters).parts.length, 6);
});

test("old unequal limbs migrate to exact arithmetic means while retaining face and summed limb volume", () => {
  const oldParameters = { ...LEGACY_DEFAULTS, leftArmLength: 0.2, rightArmLength: 1.8, leftLegLength: 0.5, rightLegLength: 1.5 };
  for (const version of [1, 2]) {
    const oldProject = { format: "fps-block-character", version, parameters: oldParameters };
    if (version === 2) oldProject.face = FACE;
    const imported = parseProject(oldProject);
    assert.deepEqual(imported.parameters, { headScale: 1, torsoScale: 1, armLength: 1, legLength: 1 });
    assert.equal(imported.migrationNotes.length, 2);
    assert.ok(imported.migrationNotes.every((note) => typeof note === "string"));
    assert.deepEqual(imported.face, version === 2 ? FACE : null);
    const character = createCharacter(imported.parameters);
    const oldLimbVolume = 0.16 * 0.22 * (oldParameters.leftArmLength + oldParameters.rightArmLength)
      + 0.2 * 0.24 * (oldParameters.leftLegLength + oldParameters.rightLegLength);
    const newLimbVolume = character.parts.filter((part) => /Arm|Leg/.test(part.id))
      .reduce((sum, part) => sum + part.size.reduce((volume, length) => volume * length, 1), 0);
    close(newLimbVolume, oldLimbVolume);
  }
  const onePair = parseProject({ format: "fps-block-character", version: 1, parameters: { ...LEGACY_DEFAULTS, leftArmLength: 0.1 } });
  assert.equal(onePair.migrationNotes.length, 1);
  assert.equal(onePair.parameters.armLength, (0.1 + 0.65) / 2);
});

test("legacy values are validated before averaging and each file version requires its exact schema", () => {
  const invalidParameters = [
    { ...LEGACY_DEFAULTS, leftArmLength: -1, rightArmLength: 3 },
    { ...LEGACY_DEFAULTS, leftLegLength: 0.1, rightLegLength: 5 },
    { ...LEGACY_DEFAULTS, leftArmLength: "0.65" },
    { ...LEGACY_DEFAULTS, rightLegLength: NaN },
    { ...LEGACY_DEFAULTS, armLength: 0.65 },
    { ...DEFAULTS },
  ];
  const missing = { ...LEGACY_DEFAULTS };
  delete missing.rightArmLength;
  invalidParameters.push(missing);
  for (const version of [1, 2]) {
    for (const parameters of invalidParameters) {
      assert.throws(() => parseProject({ format: "fps-block-character", version, parameters }));
    }
  }
  assert.throws(() => parseProject({ ...exportData(), parameters: LEGACY_DEFAULTS }));
});

test("face envelopes reject wrong shape, dimensions, encodings, and oversized payloads", () => {
  const invalidFaces = [
    undefined, false, [], "png", {},
    { ...FACE, extra: true }, { width: 128, png: FACE_PNG },
    { ...FACE, width: 64 }, { ...FACE, height: "128" },
    { ...FACE, png: FACE_PNG.replace("image/png", "image/jpeg") },
    { ...FACE, png: FACE_PNG.replace("data:", "DATA:") },
    { ...FACE, png: "data:image/png;base64,%%%%" },
    { ...FACE, png: "data:image/png;base64," + "A".repeat(200 * 1024) },
    { ...FACE, png: FACE_PNG + "\n" },
  ];
  for (const face of invalidFaces) {
    assert.throws(() => parseProject({ ...exportData(), face }));
    if (face !== undefined) assert.throws(() => exportData(DEFAULTS, face));
  }
});

test("PNG bytes determine actual dimensions and truncated PNG envelopes are rejected", () => {
  const original = Buffer.from(FACE_PNG.split(",")[1], "base64");
  const invalidPngs = [];
  const wrongSize = Buffer.from(original);
  wrongSize.writeUInt32BE(4096, 16);
  invalidPngs.push(wrongSize);
  const wrongSignature = Buffer.from(original);
  wrongSignature[0] = 0;
  invalidPngs.push(wrongSignature);
  const wrongHeaderLength = Buffer.from(original);
  wrongHeaderLength.writeUInt32BE(12, 8);
  invalidPngs.push(wrongHeaderLength);
  const wrongColorType = Buffer.from(original);
  wrongColorType[25] = 5;
  invalidPngs.push(wrongColorType);
  invalidPngs.push(original.subarray(0, 33));
  invalidPngs.push(original.subarray(0, original.length - 1));
  invalidPngs.push(Buffer.concat([original, Buffer.from([0])]));
  const noPixels = Buffer.concat([original.subarray(0, 33), original.subarray(original.length - 12)]);
  invalidPngs.push(noPixels);
  for (const png of invalidPngs) {
    assert.throws(() => parseProject({ ...exportData(), face: { ...FACE, png: "data:image/png;base64," + png.toString("base64") } }));
  }
});

test("PNG parsing supports the Node Buffer fallback when atob is unavailable", () => {
  const atob = globalThis.atob;
  try {
    globalThis.atob = undefined;
    assert.deepEqual(parseProject(exportData(DEFAULTS, FACE)).face, FACE);
  } finally {
    globalThis.atob = atob;
  }
});
