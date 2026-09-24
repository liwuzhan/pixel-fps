import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { World, WEAPONS, eye } = require("../src/game/world.js");
const Inventory = require("../src/game/inventory.js");
require("../src/game/skill-runtime.js");
require("../src/skills/jetpack.js");
require("../src/skills/autoaim.js");
require("../src/skills/weaken.js");

function arena(options) {
  const world = new World(options);
  world.obstacles = [];
  world.pickups = [];
  world.player.pos = [0, 0, 0];
  world.skills = new globalThis.PixelSkillRuntime(world);
  return world;
}
function advance(world, seconds) {
  for (let remaining = seconds; remaining > 1e-8; remaining -= 0.02) world.update(Math.min(remaining, 0.02));
}
function gun(world, type, id = `owned-${type}`) {
  const instance = { id, type };
  Inventory.grantWeapon(world.player.inventory, instance);
  world.selectWeapon(world.player.inventory.weapons.length - 1);
  return instance;
}

// These are integration checks of ownership transfer and combat, not copies of inventory arithmetic tests.
test("a dropped weapon returns as the same instance and leaves no duplicate on either side", () => {
  const world = arena(), weapon = gun(world, "rocket");
  weapon.experimentTag = "preserve future per-instance state";
  const dropped = world.dropItem({ kind: "weapon", weaponId: weapon.id });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.item.weapon, weapon);
  assert.equal(world.player.inventory.weapons.length, 0);
  assert.equal(world.pickups.length, 1);
  assert.equal(world.interact().ok, true);
  assert.equal(world.player.inventory.weapons[0], weapon);
  assert.equal(world.pickups.length, 0);
  const transfers = world.combatLog.filter((entry) => ["drop", "pickup"].includes(entry.type));
  assert.equal(transfers.length, 2);
  for (const record of transfers) {
    assert.equal(record.itemId, dropped.item.id);
    assert.equal(record.weaponId, "rocket");
    assert.equal(record.weaponInstanceId, weapon.id);
    assert.equal(record.amount, 1);
  }
  assert.equal(world.events.at(-1).itemId, dropped.item.id);
});

test("dropping another gun preserves the selected instance and dropping it selects a valid neighbor", () => {
  const world = arena(), pistol = gun(world, "pistol"), rifle = gun(world, "rifle"), rocket = gun(world, "rocket");
  const inv = world.player.inventory;
  assert.equal(world.dropItem({ kind: "weapon", weaponId: pistol.id }).ok, true);
  assert.equal(inv.weapons[inv.selected], rocket);
  assert.equal(world.dropItem({ kind: "weapon", weaponId: rocket.id }).ok, true);
  assert.equal(inv.weapons[inv.selected], rifle);
  assert.equal(world.dropItem({ kind: "weapon", weaponId: rifle.id }).ok, true);
  assert.equal(inv.selected, 0);
  assert.equal(world.fire(), false);
});

test("skill transfers preserve exact tiers and cannot clear ordinary cooldown or active ultimate instances", () => {
  const world = arena(), inv = world.player.inventory;
  Inventory.grantSkill(inv, "jetpack", 1, 3);
  Inventory.grantSkill(inv, "jetpack", 2, 1);
  assert.equal(world.skills.cast("jetpack").ok, true);
  const remaining = world.skills.getState("jetpack").remaining;
  assert.equal(world.dropItem({ kind: "skill", skillId: "jetpack", level: 3, amount: 1 }).ok, true);
  assert.deepEqual(inv.skills.jetpack, { level: 1, count: 2, levels: { 1: 2 } });
  assert.equal(world.skills.getState("jetpack").remaining, remaining);
  assert.equal(world.interact().ok, true);
  assert.equal(inv.skills.jetpack.level, 3);
  assert.equal(world.skills.cast("jetpack").ok, false);
  world.player.mana = world.player.maxMana;
  Inventory.grantSkill(inv, "autoaim", 2, 1);
  assert.equal(world.skills.cast("autoaim").ok, true);
  const instance = world.skills.instances[0];
  assert.equal(world.dropItem({ kind: "skill", skillId: "autoaim", level: 1, amount: 1 }).ok, true);
  assert.equal(inv.skills.autoaim.count, 0);
  assert.equal(world.skills.instances[0], instance);
  assert.equal(world.skills.getState("autoaim").active, 1);
  assert.equal(world.interact().ok, true);
  assert.equal(world.skills.instances[0], instance);
});

test("invalid transfers reject atomically, including malformed amounts and missing tiers", () => {
  const world = arena(), inv = world.player.inventory;
  gun(world, "pistol");
  Inventory.grantResource(inv, "ammo", 20);
  Inventory.grantResource(inv, "mana", 2);
  Inventory.grantSkill(inv, "jetpack", 2, 3);
  const before = structuredClone(inv), nextId = world._nextId;
  for (const request of [null, [], {}, { kind: "constructor" }, { kind: "ammo", amount: 21 },
    { kind: "ammo", amount: 0 }, { kind: "ammo", amount: 0.5 }, { kind: "ammo", amount: NaN },
    { kind: "mana", amount: Infinity }, { kind: "mana", amount: -1 }, { kind: "weapon", weaponId: "missing" },
    { kind: "weapon", weaponId: "owned-pistol", amount: 2 },
    { kind: "skill", skillId: "jetpack", amount: 1, level: 2 },
    { kind: "skill", skillId: "jetpack", amount: 3, level: 3 },
    { kind: "skill", skillId: "jetpack", amount: null, level: 3 },
    { kind: "skill", skillId: "__proto__", amount: 1, level: 1 }]) {
    assert.equal(world.dropItem(request).ok, false, JSON.stringify(request));
    assert.deepEqual(inv, before);
    assert.equal(world.pickups.length, 0);
    assert.equal(world._nextId, nextId);
  }
});

test("resources move between ground and inventory without creating extra units", () => {
  const world = arena(), inv = world.player.inventory;
  Inventory.grantResource(inv, "ammo", 100);
  Inventory.grantResource(inv, "mana", 3);
  assert.equal(world.dropItem({ kind: "ammo", amount: 37 }).ok, true);
  assert.equal(inv.ammo, 63);
  assert.equal(world.interact().ok, true);
  assert.equal(inv.ammo, 100);
  assert.equal(world.dropItem({ kind: "mana", amount: 2 }).ok, true);
  assert.equal(inv.manaPotions, 1);
  assert.equal(world.interact().ok, true);
  assert.equal(inv.manaPotions, 3);
});

test("a thin wall blocks pickup reach and causes drops to stay on the near side", () => {
  const world = arena(), inv = world.player.inventory;
  world.obstacles.push({ id: "thin-wall", center: [0, 1, -0.6], size: [6, 2, 0.02] });
  world.pickups.push({ id: "far-ammo", type: "ammo", label: "behind wall", pos: [0, 0.35, -1], amount: 50 });
  assert.equal(world.nearestPickup(), null);
  assert.equal(world.interact().ok, false);
  Inventory.grantResource(inv, "ammo", 20);
  const result = world.dropItem({ kind: "ammo", amount: 5 });
  assert.equal(result.ok, true);
  assert.ok(result.item.pos[2] > -0.41);
  assert.equal(world.nearestPickup(), result.item);
  assert.equal(world.interact().ok, true);
  assert.equal(inv.ammo, 20);
  assert.equal(world.nearestPickup(), null);
});

test("drop placement respects arena bounds and refuses fully obstructed space before subtracting inventory", () => {
  const world = arena(), inv = world.player.inventory;
  Inventory.grantResource(inv, "ammo", 12);
  world.player.pos = [0, 0, world.bounds.min[2] + 0.3];
  const result = world.dropItem({ kind: "ammo", amount: 2 });
  assert.equal(result.ok, true);
  assert.ok(result.item.pos[2] - 0.18 >= world.bounds.min[2]);
  assert.equal(world.interact().ok, true);
  world.pickups.push({ id: "outside-ammo", type: "ammo", label: "outside", pos: [0, 0.35, world.bounds.min[2] - 0.2], amount: 3 });
  assert.equal(world.nearestPickup(), null, "out-of-bounds supplies cannot be picked through the boundary");
  world.player.pos = [0, 0, 0];
  world.obstacles.push({ id: "enclosed", center: [0, 0.35, -0.5], size: [3, 1, 3] });
  const before = structuredClone(inv), pickups = [...world.pickups];
  assert.equal(world.dropItem({ kind: "ammo", amount: 2 }).ok, false);
  assert.deepEqual(inv, before);
  assert.deepEqual(world.pickups, pickups);
});

test("a tall player can collect a ground item without reaching from the distant camera", () => {
  const world = arena({ parameters: { headScale: 3, torsoScale: 3, legLength: 3 } });
  assert.ok(eye(world.player)[1] > 5);
  world.pickups.push({ id: "low-ammo", type: "ammo", label: "ammo", pos: [0.4, 0.35, -0.4], amount: 5 });
  assert.equal(world.interact().ok, true);
  assert.equal(world.player.inventory.ammo, 5);
});

test("world discovers registered skills and checks definition kind rather than a fixed ultimate name", () => {
  globalThis.PixelFPSSkills.futureUltimate = { id: "futureUltimate", name: "未来终极", kind: "ultimate" };
  globalThis.PixelFPSSkills.futureNormal = { id: "futureNormal", name: "未来普通", kind: "normal" };
  try {
    const world = arena(), inv = world.player.inventory;
    assert.ok(Object.hasOwn(inv.skills, "futureUltimate"));
    Inventory.grantSkill(inv, "futureUltimate", 3, 1);
    Inventory.grantSkill(inv, "futureNormal", 3, 1);
    assert.equal(world.upgradeSkill("futureUltimate"), false);
    assert.equal(inv.skills.futureUltimate.count, 3);
    assert.equal(world.upgradeSkill("futureNormal"), true);
    assert.deepEqual(inv.skills.futureNormal.levels, { 2: 1 });
  } finally {
    delete globalThis.PixelFPSSkills.futureUltimate;
    delete globalThis.PixelFPSSkills.futureNormal;
  }
});

test("rocket firing uses the shared ammo pool and real travel before a single multi-target blast", () => {
  const world = arena(), inv = world.player.inventory;
  gun(world, "rocket");
  Inventory.grantResource(inv, "ammo", 12);
  const [direct, nearby, covered] = world.actors.slice(1);
  direct.pos = [0, 0, -5]; nearby.pos = [1.8, 0, -5]; covered.pos = [-2, 0, -5];
  world.obstacles.push({ id: "side-wall", center: [-1, 2, -5], size: [0.1, 4, 5] });
  const friendly = world.spawnDummy({ label: "友方", pos: [1, 0, -5.5] });
  friendly.team = world.player.team;
  assert.equal(world.fire(), true);
  assert.equal(inv.ammo, 6);
  assert.equal(world.fire(), false);
  assert.equal(inv.ammo, 6);
  assert.equal(world.projectiles.length, 1);
  assert.equal(world.projectiles[0].weaponId, "rocket");
  assert.equal(world.projectiles[0].radius, WEAPONS.rocket.projectileRadius);
  assert.equal(direct.hp, direct.maxHp);
  advance(world, 0.1);
  assert.equal(direct.hp, direct.maxHp, "the rocket has not arrived yet");
  advance(world, 0.2);
  assert.equal(direct.hp, direct.maxHp - WEAPONS.rocket.damage);
  assert.equal(nearby.hp, nearby.maxHp - WEAPONS.rocket.damage);
  assert.equal(covered.hp, covered.maxHp, "wall protects from the area blast");
  assert.equal(friendly.hp, friendly.maxHp);
  assert.equal(world.player.hp, world.player.maxHp);
  assert.equal(world.projectiles.length, 0);
  const damage = world.combatLog.filter((entry) => entry.type === "damage");
  assert.equal(damage.length, 2, "each target is damaged exactly once, including the direct hit");
  assert.equal(damage.find((entry) => entry.targetId === direct.id).partId, "head");
  assert.equal(damage.find((entry) => entry.targetId === nearby.id).partId, "blast");
  assert.ok(damage.every((entry) => entry.weaponId === "rocket"));
  assert.equal(world.effects.filter((effect) => effect.type === "explosion").length, 1);
  assert.equal(world.effects.find((effect) => effect.type === "explosion").radius, WEAPONS.rocket.blastRadius);
  advance(world, 0.2);
  assert.equal(world.combatLog.filter((entry) => entry.type === "damage").length, 2);
});

test("a rocket detonates on a wall and cannot damage a target behind that wall", () => {
  const world = arena();
  gun(world, "rocket");
  Inventory.grantResource(world.player.inventory, "ammo", 6);
  world.actors = [world.player, world.actors[1]];
  world.actors[1].pos = [0, 0, -5];
  world.obstacles.push({ id: "wall", center: [0, 2, -4], size: [5, 4, 0.05] });
  assert.equal(world.fire(), true);
  advance(world, 0.3);
  assert.equal(world.player.inventory.ammo, 0);
  assert.equal(world.actors[1].hp, world.actors[1].maxHp);
  assert.equal(world.combatLog.filter((entry) => entry.type === "explosion").length, 1);
  assert.equal(world.combatLog.filter((entry) => entry.type === "damage").length, 0);
  advance(world, 1);
  assert.equal(world.fire(), false);
});
