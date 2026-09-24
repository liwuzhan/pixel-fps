import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { World, actorBoxes, eye, aimDirection, segmentBox } = require("../src/game/world.js");

function emptyArena() {
  const world = new World();
  world.obstacles = [];
  world.player.pos = [0, 0, 0];
  world.actors = [world.player, world.actors[1]];
  world.actors[1].pos = [0, 0, -10];
  return world;
}
function advance(world, seconds, input = {}) {
  for (let remaining = seconds; remaining > 1e-8; remaining -= 0.02) world.update(Math.min(0.02, remaining), input);
}
function equip(world, type = "pistol", ammo = 10) {
  world.player.inventory.weapons.push({ id: "test-weapon", type });
  world.player.inventory.selected = world.player.inventory.weapons.length - 1;
  world.player.inventory.ammo = ammo;
}

test("actors use all six actual boxes and geometry-derived attributes", () => {
  const normal = new World(), large = new World({ parameters: { headScale: 2, torsoScale: 2, legLength: 1.6 } });
  assert.equal(actorBoxes(normal.player).length, 6);
  assert.equal(large.player.maxHp, normal.player.maxHp * 8);
  assert.equal(large.player.maxMana, normal.player.maxMana * 8);
  assert.equal(large.player.speed, normal.player.speed * 2);
  assert.deepEqual(aimDirection(normal.player), [0, 0, -1]);
  const head = actorBoxes(large.player).find((part) => part.id === "head");
  assert.ok(eye(large.player)[1] > head.center[1]);
  assert.ok(eye(large.player)[1] < head.center[1] + head.size[1] / 2);
});

test("all weapons and ammunition come from actual nearby pickups", () => {
  const world = new World();
  assert.equal(world.player.inventory.weapons.length, 0);
  assert.equal(world.player.inventory.ammo, 0);
  assert.equal(world.fire(), false);
  const first = world.interact();
  assert.equal(first.ok, true);
  assert.equal(world.player.inventory.weapons.length, 1);
  assert.ok(!world.pickups.some((item) => item.id === first.item.id));
  assert.equal(world.interact().ok, true);
  assert.equal(world.player.inventory.ammo, 120);
  world.player.pos = [18, 0, 10];
  assert.equal(world.nearestPickup(), null);
  assert.equal(world.interact().ok, false);
});

test("high-speed projectiles sweep through space and hit a head once", () => {
  const world = emptyArena(), target = world.actors[1];
  let hit = null, calls = 0;
  world.spawnProjectile({ pos: eye(world.player), vel: [0, 0, -1000], ownerId: world.player.id,
    damage: 25, onHit: (event) => { hit = event; calls++; } });
  world.update(0.05);
  assert.equal(target.hp, target.maxHp - 25);
  assert.equal(hit.actor, target);
  assert.equal(hit.partId, "head");
  assert.equal(world.projectiles.length, 0);
  world.update(0.05);
  assert.equal(calls, 1);
});

test("a wall blocks high-speed shots before an actor behind it", () => {
  const world = emptyArena(), target = world.actors[1];
  world.obstacles.push({ id: "wall", center: [0, 2, -5], size: [4, 4, 0.1] });
  let hit;
  world.spawnProjectile({ pos: eye(world.player), vel: [0, 0, -1000], ownerId: world.player.id,
    damage: 80, onHit: (event) => { hit = event; } });
  assert.equal(world.lineOfSight(eye(world.player), eye(target)), false);
  world.update(0.05);
  assert.equal(target.hp, target.maxHp);
  assert.equal(hit.obstacle.id, "wall");
  assert.equal(hit.actor, null);
});

test("six-box hit testing preserves empty space between the legs", () => {
  const world = emptyArena(), target = world.actors[1];
  world.spawnProjectile({ pos: [0, 0.4, 0], vel: [0, 0, -1000], ownerId: world.player.id, radius: 0.001, damage: 40 });
  world.update(0.03);
  assert.equal(target.hp, target.maxHp);
  const arm = actorBoxes(target).find((box) => box.id === "leftArm");
  let part;
  world.spawnProjectile({ pos: [arm.center[0], arm.center[1], 0], vel: [0, 0, -1000], ownerId: world.player.id,
    radius: 0.001, damage: 40, onHit: (event) => { part = event.partId; } });
  world.update(0.03);
  assert.equal(target.hp, target.maxHp - 40);
  assert.equal(part, "leftArm");
});

test("weapons share one ammunition pool and rejected shots consume nothing", () => {
  const world = emptyArena();
  equip(world, "pistol", 2);
  equip(world, "rifle", 2);
  world.selectWeapon(0);
  assert.equal(world.fire(), true);
  assert.equal(world.player.inventory.ammo, 1);
  assert.equal(world.fire(), false);
  assert.equal(world.player.inventory.ammo, 1);
  world.selectWeapon(1);
  assert.equal(world.fire(), false);
  advance(world, 0.3);
  assert.equal(world.fire(), true);
  assert.equal(world.player.inventory.ammo, 0);
  advance(world, 0.3);
  assert.equal(world.fire(), false);
  assert.equal(world.player.inventory.ammo, 0);
});

test("skill upgrades consume three equal-level copies and preserve nine-to-one cost", () => {
  const world = emptyArena(), skill = world.player.inventory.skills.jetpack;
  Object.assign(skill, { level: 1, count: 4, levels: { 1: 4 } });
  assert.equal(world.upgradeSkill("jetpack"), true);
  assert.deepEqual(skill.levels, { 1: 1, 2: 1 });
  assert.equal(skill.count, 2);
  assert.equal(world.upgradeSkill("jetpack"), false);
  Object.assign(skill, { level: 1, count: 9, levels: { 1: 9 } });
  let upgrades = 0;
  while (world.upgradeSkill("jetpack")) upgrades++;
  assert.equal(upgrades, 4);
  assert.deepEqual(skill.levels, { 3: 1 });
  assert.equal(skill.count, 1);
  assert.equal(skill.level, 3);
});

test("ultimate consumption updates both total copies and level inventory atomically", () => {
  const world = emptyArena(), skill = world.player.inventory.skills.autoaim;
  Object.assign(skill, { level: 1, count: 2, levels: { 1: 2 } });
  assert.equal(world.upgradeSkill("autoaim"), false);
  assert.equal(world.consumeSkill("autoaim", 3), false);
  assert.equal(skill.count, 2);
  assert.equal(world.consumeSkill("autoaim"), true);
  assert.equal(skill.count, 1);
  assert.deepEqual(skill.levels, { 1: 1 });
  assert.equal(world.consumeSkill("autoaim"), true);
  assert.deepEqual(skill.levels, {});
  assert.equal(world.consumeSkill("autoaim"), false);
});

test("weakness affects outgoing damage and expires independently by source", () => {
  const world = emptyArena(), target = world.actors[1];
  world.applyStatus(target, "weaken", 0.1, "first", { damageMultiplier: 0.5 });
  world.applyStatus(target, "weaken", 0.5, "second", { damageMultiplier: 0.75 });
  assert.equal(world.damage(world.player, 20, target.id), 10);
  advance(world, 0.2);
  assert.equal(target.statuses.length, 1);
  assert.equal(world.damage(world.player, 20, { ownerId: target.id }), 15);
  advance(world, 0.4);
  assert.equal(target.statuses.length, 0);
  assert.equal(world.damage(world.player, 20, target), 20);
});

test("a zero-damage projectile still calls its skill hit callback", () => {
  const world = emptyArena(), target = world.actors[1];
  world.spawnProjectile({ pos: eye(world.player), vel: [0, 0, -1000], ownerId: world.player.id, damage: 0,
    onHit: ({ actor }) => world.applyStatus(actor, "weaken", 3, "grenade", { damageMultiplier: 0.45 }) });
  world.update(0.02);
  assert.equal(target.hp, target.maxHp);
  assert.equal(world.hasStatus(target, "weaken"), true);
});

test("movement stops against thin obstacles, jump returns to the floor", () => {
  const world = emptyArena();
  world.obstacles.push({ id: "wall", center: [0, 2, -2], size: [10, 4, 0.2] });
  advance(world, 3, { forward: 1, sprint: true });
  assert.ok(world.player.pos[2] >= -1.701);
  assert.ok(world.player.pos[2] < -1.6);
  world.update(0.02, { jump: true });
  assert.ok(world.player.pos[1] > 0);
  advance(world, 2);
  assert.equal(world.player.pos[1], 0);
  assert.equal(world.player.grounded, true);
});

test("scripts can inject acceleration before movement and aiming before fire", () => {
  const world = emptyArena();
  equip(world);
  world.skills = { update() { world.player.vel[1] = 8; world.player.yaw = Math.PI / 2; } };
  world.update(0.02, { fire: true });
  assert.ok(world.player.pos[1] > 0);
  assert.ok(world.projectiles[0].vel[0] > 90);
});

test("jump plus upgraded jetpack cannot cross arena bounds above the walls", () => {
  const world = new World(), player = world.player;
  player.pos = [18, 0, 0];
  player.yaw = Math.PI / 2;
  // A jump (6.5 m/s) followed by a level-two jetpack impulse (9.8 m/s).
  player.vel[1] = 16.3;
  player.grounded = false;
  advance(world, 2, { forward: 1, sprint: true });
  assert.ok(player.pos[0] + player.character.bounds.max[0] <= world.bounds.max[0]);
  assert.equal(player.vel[0], 0);
  assert.equal(player.pos[1], 0);
});

test("horizontal arena limits contain every box of a large airborne body", () => {
  const world = new World({ parameters: { headScale: 5, torsoScale: 5, legLength: 4 } });
  const player = world.player;
  for (const axis of [0, 2]) for (const sign of [-1, 1]) {
    player.pos = [0, 9, 0];
    player.vel = [0, 0, 0];
    player.pos[axis] = sign > 0 ? world.bounds.max[axis] - 0.01 : world.bounds.min[axis] + 0.01;
    player.vel[axis] = sign * 40;
    player.grounded = false;
    world.update(0.02);
    for (const box of actorBoxes(player)) {
      assert.ok(box.center[axis] - box.size[axis] / 2 >= world.bounds.min[axis] - 1e-9);
      assert.ok(box.center[axis] + box.size[axis] / 2 <= world.bounds.max[axis] + 1e-9);
    }
    assert.equal(player.vel[axis], 0);
  }
});

test("death and reset keep player inventory while restoring combat state", () => {
  const world = emptyArena();
  equip(world, "pistol", 12);
  assert.equal(world.damage(world.player, 1000, world.actors[1]), 100);
  assert.equal(world.player.alive, false);
  assert.equal(world.fire(), false);
  world.reset();
  assert.equal(world.player.alive, true);
  assert.equal(world.player.hp, world.player.maxHp);
  assert.equal(world.player.inventory.ammo, 12);
});

test("segment-box detects starts inside and rejects parallel misses", () => {
  const box = { center: [0, 0, 0], size: [2, 2, 2] };
  assert.equal(segmentBox([0, 0, 0], [0, 0, 3], box), 0);
  assert.equal(segmentBox([3, 0, 0], [3, 0, 3], box), null);
  assert.equal(segmentBox([0, 0, 3], [0, 0, -3], box), 1 / 3);
});
