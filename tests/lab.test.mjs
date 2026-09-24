import test from "node:test";
import assert from "node:assert/strict";
import "../src/game/world.js";
import "../src/game/skill-runtime.js";
import "../src/skills/jetpack.js";
import "../src/skills/autoaim.js";
import "../src/skills/weaken.js";
import "../src/game/lab.js";

function fixture(options) {
  const world = new globalThis.PixelFPS.World();
  world.skills = new globalThis.PixelSkillRuntime(world);
  const lab = new globalThis.PixelFPSLab(world, options);
  return { world, lab };
}

function command(lab, text) {
  const result = lab.execute(text);
  assert.equal(result.ok, true, `${text}: ${result.message}`);
  return result;
}

test("console validates entire command before granting materials and never evaluates code", () => {
  const { world, lab } = fixture();
  const original = structuredClone(world.player.inventory);
  for (const text of ["give skill jetpack 4 -1", "give skill autoaim NaN", "give weapon pistol -1", "give ammo Infinity",
    "give skill constructor 3", "give weapon __proto__", "give ammo 1 extra", "globalThis.__labInjected = true", "cheat mana yes"] ) {
    assert.equal(lab.execute(text).ok, false, text);
    assert.deepEqual(world.player.inventory, original);
  }
  assert.equal(globalThis.__labInjected, undefined);
  command(lab, "give weapon pistol 2"); command(lab, "give ammo 120"); command(lab, "give mana 3");
  assert.equal(world.player.inventory.weapons.length, 2);
  assert.equal(new Set(world.player.inventory.weapons.map((item) => item.id)).size, 2);
  assert.equal(world.player.inventory.ammo, 120);
  assert.equal(world.player.inventory.manaPotions, 3);
});

test("nine granted ordinary copies actually merge into one level-three copy", () => {
  const { world, lab } = fixture();
  command(lab, "give skill jetpack 9 1");
  for (let index = 0; index < 4; index++) assert.equal(world.upgradeSkill("jetpack"), true);
  assert.deepEqual(world.player.inventory.skills.jetpack, { level: 3, count: 1, levels: { 3: 1 } });
  assert.equal(world.upgradeSkill("jetpack"), false);
  assert.equal(lab.execute("give skill jetpack 2 0").ok, false);
  assert.equal(world.player.inventory.skills.jetpack.count, 1);
});

test("give discovers loaded skills instead of requiring a second hardcoded list", () => {
  const { world, lab } = fixture();
  world.skills.definitions.testskill = { id: "testskill", name: "实验扩展", kind: "normal", manaCost: 0, cooldown: 0 };
  command(lab, "give skill testskill 3 2");
  assert.deepEqual(world.player.inventory.skills.testskill, { level: 2, count: 3, levels: { 2: 3 } });
  assert.ok(lab.list().skills.some((skill) => skill.id === "testskill"));
});

test("dummy configuration delegates to the actual actor and rejects an invalid composite patch atomically", () => {
  const { world, lab } = fixture();
  const result = command(lab, "dummy spawn bighead 1 0 -6");
  const actor = result.data;
  assert.equal(actor.character.params.headScale, 2.5);
  command(lab, `dummy set ${actor.id} fire on`);
  command(lab, `dummy set ${actor.id} move strafe`);
  command(lab, `dummy set ${actor.id} recover on`);
  assert.equal(actor.training.fire, true);
  assert.equal(actor.training.behavior, "strafe");
  assert.equal(actor.training.autoRecover, true);
  const previous = structuredClone({ pos: actor.pos, params: actor.character.params, training: actor.training });
  assert.throws(() => lab.configureDummy(actor.id, { parameters: { torsoScale: 2 }, pos: [999, 0, 0] }));
  assert.deepEqual({ pos: actor.pos, params: actor.character.params, training: actor.training }, previous);
  command(lab, `dummy remove ${actor.id}`);
  assert.equal(world.findActor(actor.id), null);
});

test("paused single-step uses exact fixed world steps and expires real status and cooldown timers", () => {
  const { world, lab } = fixture();
  world.targetsMoving = false; world.enemyFire = false;
  command(lab, "give skill jetpack");
  assert.equal(world.skills.cast("jetpack").ok, true);
  command(lab, "status add player silence 1");
  const before = world.time;
  assert.equal(lab.execute("step").ok, false);
  assert.equal(world.time, before);
  command(lab, "time pause"); command(lab, "time scale 0.25");
  command(lab, "step 60");
  assert.ok(Math.abs(world.time - 0.5) < 1e-10);
  assert.ok(world.hasStatus(world.player, "silence"));
  assert.ok(Math.abs(world.skills.getState("jetpack").remaining - 4.5) < 1e-10);
  command(lab, "step 61");
  assert.equal(world.hasStatus(world.player, "silence"), false);
  assert.equal(lab.paused, true);
  assert.equal(lab.timeScale, 0.25, "manual stepping always uses unscaled world frames");
});

test("cheat toggles use real runtime gates and still consume ultimate copies", () => {
  const { world, lab } = fixture();
  command(lab, "give skill autoaim 2"); command(lab, "give skill jetpack"); command(lab, "give weapon pistol");
  command(lab, "cheat mana on"); command(lab, "cheat ammo on"); command(lab, "cheat cooldown on");
  world.player.mana = 0;
  assert.equal(world.skills.cast("jetpack").ok, true);
  assert.equal(world.skills.cast("jetpack").ok, true);
  assert.equal(world.skills.cast("autoaim").ok, true);
  assert.equal(world.player.inventory.skills.autoaim.count, 1);
  assert.equal(world.player.inventory.ammo, 0);
  assert.equal(world.fire(), true);
  assert.equal(world.fire(), false, "the skill cooldown cheat preserves weapon cadence");
  world.time = world.player.nextFireAt;
  assert.equal(world.fire(), true);
  command(lab, "cheat mana off");
  assert.equal(world.skills.cast("jetpack").ok, false);
});

test("snapshots are JSON configuration and round-trip body, inventory, dummies, cheats and timing", () => {
  const { lab } = fixture();
  command(lab, "scenario load merge"); command(lab, "give skill jetpack 2 2");
  command(lab, "time pause"); command(lab, "time scale 0.5");
  const actor = lab.world.actors[1];
  lab.configureDummy(actor.id, { parameters: { headScale: 2 }, training: { autoRecover: true, autoRespawn: true } });
  const snapshot = JSON.parse(JSON.stringify(lab.snapshot()));
  command(lab, "scenario save 我的实验");
  const saved = JSON.stringify(lab.scenarios);
  lab.world.player.hp = 4;
  lab.world.player.mana = 1;
  lab.addStatus("player", "silence", 5);
  lab.world.spawnProjectile({ pos: [0, 3, 0], vel: [0, 0, -5], ownerId: "player", damage: 10 });
  lab.step(5);
  command(lab, "scenario load 我的实验");
  assert.deepEqual(JSON.parse(JSON.stringify(lab.snapshot())), snapshot);
  assert.equal(lab.world.time, 0);
  assert.equal(lab.world.player.hp, lab.world.player.maxHp);
  assert.equal(lab.world.player.mana, lab.world.player.maxMana);
  assert.equal(lab.world.player.statuses.length, 0);
  assert.equal(lab.world.projectiles.length, 0);
  assert.equal(lab.world.skills.instances.length, 0);
  assert.equal(lab.importScenarios(saved), 1);
});

test("invalid nested scene fields are rejected before reset and bulk saved-scene imports are atomic", () => {
  let resetCount = 0;
  const { world, lab } = fixture({ resetWorld() { resetCount++; throw new Error("must not reset"); } });
  command(lab, "scenario save keep");
  const original = JSON.stringify(lab.scenarios), originalInventory = JSON.stringify(world.player.inventory);
  const mutations = [
    (scene) => { scene.player.inventory.skills.notloaded = { 1: 1 }; },
    (scene) => { scene.dummies[0].training.respawnDelay = -1; },
    (scene) => { scene.dummies[0].pos = [999, 0, 0]; },
    (scene) => { scene.dummies[0].parameters.headScale = 999; },
    (scene) => { scene.player.inventory.selected = 3; },
    (scene) => { scene.time.scale = Infinity; },
    (scene) => { scene.world.cheats.infiniteMana = "yes"; },
    (scene) => { scene.script = "world.player.hp=0"; },
  ];
  for (const mutate of mutations) {
    const invalid = lab.snapshot(); mutate(invalid);
    assert.throws(() => lab.loadScenario(invalid));
    assert.throws(() => lab.importScenarios({ valid: lab.snapshot(), invalid }));
    assert.equal(resetCount, 0);
    assert.equal(lab.world, world);
    assert.equal(JSON.stringify(lab.scenarios), original);
    assert.equal(JSON.stringify(world.player.inventory), originalInventory);
  }
  assert.equal(lab.execute("scenario save __proto__").ok, false);
  assert.equal(lab.execute("scenario delete shooting").ok, false);
});

test("reset callback receives character and loading a scenario rebuilds runtime on the new world", () => {
  const { world } = fixture();
  const received = [];
  const lab = new globalThis.PixelFPSLab(world, { resetWorld(options) {
    received.push(options);
    const next = new globalThis.PixelFPS.World(options);
    next.skills = new globalThis.PixelSkillRuntime(next);
    lab.setWorld(next);
    return next;
  } });
  const scene = lab.snapshot();
  scene.player.parameters.headScale = 2;
  lab.loadScenario(scene);
  assert.equal(received.length, 1);
  assert.equal(received[0].parameters.headScale, 2);
  assert.equal(lab.world.player.maxMana, 800);
  assert.equal(lab.world.skills.world, lab.world);
  lab.reset();
  assert.equal(received.length, 2);
  assert.equal(received[1].parameters.headScale, 2);
});

test("three built-in experiments load usable supplies and behavior", () => {
  const { lab } = fixture();
  for (const id of ["shooting", "merge", "weakness"]) {
    command(lab, `scenario load ${id}`);
    assert.equal(lab.world.player.inventory.weapons.length, 3);
    assert.ok(lab.world.player.inventory.ammo > 0);
    assert.equal(lab.world.projectiles.length, 0);
    assert.equal(lab.world.time, 0);
  }
  assert.equal(lab.world.actors[1].training.fire, true);
  assert.equal(lab.world.player.inventory.skills.weaken.count, 1);
  assert.equal(lab.world.cheats.noCooldown, true);
  assert.equal(lab.world.skills.cast("weaken").ok, true);
  assert.equal(lab.world.projectiles.length, 1);
  command(lab, "clear projectiles");
  assert.equal(lab.world.projectiles.length, 0);
});


test("scene player placement rejects underground and partly outside bodies before reset while allowing altitude", () => {
  let resetCount = 0;
  const { world, lab } = fixture({ resetWorld() { resetCount++; throw new Error("must not reset"); } });
  for (const pos of [[0, -0.01, 0], [20, 0, 0], [-20, 0, 0], [0, 0, -24], [0, 0, 12], [999, 0, 0]]) {
    const scene = lab.snapshot(); scene.player.pos = pos;
    assert.throws(() => lab.loadScenario(scene), undefined, JSON.stringify(pos));
    assert.equal(resetCount, 0);
    assert.equal(lab.world, world);
  }
  const enlarged = lab.snapshot();
  enlarged.player.parameters.headScale = 5;
  enlarged.player.pos = [19.5, 0, 0];
  assert.throws(() => lab.loadScenario(enlarged));
  assert.equal(resetCount, 0, "body extents are checked using the imported character dimensions");
  const { lab: independent } = fixture();
  const elevated = independent.snapshot(); elevated.player.pos = [0, 1000, 0];
  independent.loadScenario(elevated);
  assert.deepEqual(independent.world.player.pos, [0, 1000, 0]);
});
