import test from "node:test";
import assert from "node:assert/strict";
import "../src/game/skill-runtime.js";
import "../src/skills/jetpack.js";
import "../src/skills/autoaim.js";
import "../src/skills/weaken.js";
import "../src/game/world.js";

function fixture(skills = {}) {
  const player = {
    id: "player", team: "blue", alive: true, hp: 100, mana: 100, maxMana: 100,
    pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true,
    inventory: { skills: structuredClone(skills) }, statuses: [],
  };
  const world = {
    player, time: 0, actors: [player], projectiles: [], effects: [], messages: [], consumed: [],
    eye: (actor) => [actor.pos[0], actor.pos[1] + 1.6, actor.pos[2]],
    aimDirection: (actor) => [Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch)],
    enemiesOf(actor) { return this.actors.filter((other) => other.team !== actor.team); },
    lineOfSight: () => true,
    spawnProjectile(projectile) {
      const result = { id: `projectile-${this.projectiles.length}`, ...projectile };
      this.projectiles.push(result);
      return result;
    },
    applyStatus(actor, type, duration, sourceId, data) {
      const status = { id: `status-${actor.statuses.length}`, type, expiresAt: this.time + duration, sourceId, data };
      actor.statuses.push(status);
      return status;
    },
    consumeSkill(id, amount = 1) {
      const skill = player.inventory.skills[id];
      if (!skill || skill.count < amount) return false;
      this.consumed.push({ id, amount });
      while (amount-- > 0) {
        if (skill.levels) {
          if (--skill.levels[skill.level] === 0) delete skill.levels[skill.level];
          skill.level = Math.max(1, ...Object.keys(skill.levels).map(Number));
        }
        skill.count -= 1;
      }
      return true;
    },
    addEffect(effect) { this.effects.push(effect); },
    message(text, type) { this.messages.push({ text, type }); },
    findActor(id) { return this.actors.find((actor) => actor.id === id); },
  };
  world.skills = new globalThis.PixelSkillRuntime(world);
  return world;
}

function enemy(world, id, pos) {
  const actor = { id, team: "red", alive: true, hp: 100, pos, statuses: [] };
  world.actors.push(actor);
  return actor;
}

test("uncollected skills cannot activate or create world effects", () => {
  const world = fixture();
  for (const id of ["jetpack", "autoaim", "weaken", "missing-script"]) {
    assert.equal(world.skills.cast(id).ok, false);
  }
  assert.equal(world.player.mana, 100);
  assert.deepEqual(world.player.vel, [0, 0, 0]);
  assert.equal(world.projectiles.length, 0);
  assert.equal(world.skills.instances.length, 0);
});

test("failed resource and status checks do not spend mana, ultimate copies, or cooldown", () => {
  const world = fixture({ autoaim: { level: 1, count: 2 }, jetpack: { level: 1, count: 1 } });
  world.player.mana = 1;
  assert.equal(world.skills.cast("autoaim").ok, false);
  assert.equal(world.player.inventory.skills.autoaim.count, 2);
  assert.equal(world.player.mana, 1);
  assert.equal(world.skills.getState("autoaim").remaining, 0);
  world.player.mana = 100;
  world.applyStatus(world.player, "silence", 2, "opponent");
  assert.equal(world.skills.cast("jetpack").ok, false);
  assert.equal(world.player.mana, 100);
  assert.equal(world.skills.getState("jetpack").remaining, 0);
  world.time = 2;
  assert.equal(world.skills.cast("jetpack").ok, true, "expired silence cannot block a cast");
});

test("jetpack applies an impulse and spends mana while preserving the ordinary skill", () => {
  const world = fixture({ jetpack: { level: 2, count: 1 } });
  assert.equal(world.skills.cast("jetpack").ok, true);
  assert.equal(world.player.inventory.skills.jetpack.count, 1);
  assert.equal(world.player.mana, 90);
  assert.ok(world.player.vel[1] > 0);
  assert.ok(world.player.vel[2] < 0);
  assert.equal(world.player.grounded, false);
  const velocity = [...world.player.vel];
  assert.equal(world.skills.cast("jetpack").ok, false);
  assert.deepEqual(world.player.vel, velocity);
  assert.equal(world.player.mana, 90);
  world.skills.update(5);
  assert.equal(world.skills.cast("jetpack").ok, true);
  assert.equal(world.player.mana, 80);
});

test("ultimate consumes exactly one highest-level copy through the inventory facade", () => {
  const world = fixture({ autoaim: { level: 2, count: 3, levels: { 1: 2, 2: 1 } } });
  assert.equal(world.skills.cast("autoaim").ok, true);
  assert.deepEqual(world.consumed, [{ id: "autoaim", amount: 1 }]);
  assert.deepEqual(world.player.inventory.skills.autoaim, { level: 1, count: 2, levels: { 1: 2 } });
  assert.equal(world.player.mana, 82);
  assert.equal(world.skills.instances[0].level, 2, "the consumed level belongs to this cast");
  assert.equal(world.skills.instances[0].duration, 9);
});

test("autoaim updates the actual shooting direction without firing", () => {
  const world = fixture({ autoaim: { level: 1, count: 1 } });
  const target = enemy(world, "visible", [2, 1, -10]);
  assert.equal(world.skills.cast("autoaim").ok, true);
  world.skills.update(0.016);
  const direction = world.aimDirection(world.player);
  const source = world.eye(world.player);
  const destination = world.eye(target);
  const expected = destination.map((value, axis) => value - source[axis]);
  const length = Math.hypot(...expected);
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(direction[axis] - expected[axis] / length) < 1e-10);
  assert.equal(world.projectiles.length, 0);
  assert.equal(world.skills.instances[0].record.targetId, target.id);
});

test("autoaim excludes wall-occluded, outside-cone, behind, and dead enemies", () => {
  const world = fixture({ autoaim: { level: 1, count: 1 } });
  enemy(world, "behind-wall", [0, 0, -10]);
  enemy(world, "outside-cone", [10, 0, -10]);
  enemy(world, "behind", [0, 0, 10]);
  enemy(world, "dead", [1, 0, -10]).alive = false;
  world.lineOfSight = (_from, to) => to[0] !== 0;
  world.skills.cast("autoaim");
  world.skills.update(0.016);
  assert.equal(world.player.yaw, 0);
  assert.equal(world.player.pitch, 0);
  assert.equal(world.skills.instances[0].record.targetId, null);
  const visible = enemy(world, "visible", [3, 0, -10]);
  world.skills.update(0.016);
  assert.equal(world.skills.instances[0].record.targetId, visible.id);
});

test("ending one ultimate instance leaves later concurrent instances running", () => {
  const world = fixture({ autoaim: { level: 1, count: 2 } });
  world.skills.cast("autoaim");
  world.skills.update(2);
  world.skills.cast("autoaim");
  const [first, second] = world.skills.instances;
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.record, second.record);
  world.skills.update(5);
  assert.deepEqual(world.skills.instances, [second]);
  assert.equal(world.skills.getState("autoaim").active, 1);
  world.skills.update(2);
  assert.equal(world.skills.getState("autoaim").active, 0);
  assert.equal(world.skills.cast("autoaim").ok, false, "no copies remain after two successful casts");
});

test("weaken creates a physical grenade and only applies the area debuff after collision", () => {
  const world = fixture({ weaken: { level: 1, count: 1 } });
  const near = enemy(world, "near", [0, 0, -8]);
  const far = enemy(world, "far", [20, 0, -8]);
  const blocked = enemy(world, "blocked", [1, 0, -8]);
  world.lineOfSight = () => false;
  assert.equal(world.skills.cast("weaken").ok, true);
  assert.equal(near.statuses.length, 0);
  assert.equal(world.projectiles.length, 1);
  const grenade = world.projectiles[0];
  assert.equal(grenade.ownerId, world.player.id);
  assert.equal(grenade.damage, 0);
  assert.ok(grenade.vel[2] < 0);
  assert.ok(grenade.gravity > 0);
  grenade.onHit({ world, projectile: grenade, actor: near, partId: "torso", pos: [0, 0.8, -8], obstacle: null });
  assert.equal(near.statuses.length, 1);
  assert.equal(near.statuses[0].type, "weaken");
  assert.equal(near.statuses[0].data.damageMultiplier, 0.45);
  assert.equal(far.statuses.length, 0);
  assert.equal(blocked.statuses.length, 0, "nearby splash is blocked while the directly struck target is affected");
  assert.equal(world.player.statuses.length, 0);
  grenade.onHit({ pos: [0, 0.8, -8] });
  assert.equal(near.statuses.length, 1, "one projectile can only detonate once");
  assert.equal(world.player.inventory.skills.weaken.count, 1);
});

test("a rejected projectile spawn restores paid resources and cooldown", () => {
  const world = fixture({ weaken: { level: 1, count: 1 } });
  world.spawnProjectile = () => null;
  assert.equal(world.skills.cast("weaken").ok, false);
  assert.equal(world.player.mana, 100);
  assert.equal(world.player.inventory.skills.weaken.count, 1);
  assert.equal(world.skills.getState("weaken").remaining, 0);
});

test("real world projectile collision applies weakness and reduces the target's outgoing damage", () => {
  const world = new globalThis.PixelFPS.World();
  world.skills = new globalThis.PixelSkillRuntime(world);
  world.obstacles = [];
  const target = world.actors[1];
  world.actors = [world.player, target];
  world.player.pos = [0, 0, 0];
  target.pos = [0, 0, -8];
  world.player.inventory.skills.weaken = { level: 1, count: 1, levels: { 1: 1 } };
  assert.equal(world.skills.cast("weaken").ok, true);
  for (let frame = 0; frame < 120; frame++) world.update(1 / 60);
  assert.equal(world.projectiles.length, 0);
  assert.ok(target.statuses.some((status) => status.type === "weaken"));
  const before = world.player.hp;
  world.damage(world.player, 20, target);
  assert.equal(before - world.player.hp, 9);
});

test("real wall collision blocks weakness behind cover while visible nearby targets are affected", () => {
  const world = new globalThis.PixelFPS.World();
  world.skills = new globalThis.PixelSkillRuntime(world);
  const hidden = world.actors[1];
  const exposed = world.actors[2];
  world.actors = [world.player, hidden, exposed];
  world.player.pos = [0, 0, 0];
  hidden.pos = [0, 0, -3];
  exposed.pos = [1.5, 0, -0.5];
  world.obstacles = [{ id: "blast-cover", center: [0, 2, -1.5], size: [6, 4, 0.3] }];
  world.player.inventory.skills.weaken = { level: 1, count: 1, levels: { 1: 1 } };
  assert.equal(world.lineOfSight(world.eye(world.player), world.eye(hidden)), false);
  assert.equal(world.skills.cast("weaken").ok, true);
  for (let frame = 0; frame < 30; frame++) world.update(1 / 60);
  assert.equal(world.projectiles.length, 0, "the grenade struck the wall");
  assert.equal(hidden.statuses.length, 0, "the wall shields a target inside the blast radius");
  assert.ok(exposed.statuses.some((status) => status.type === "weaken"), "unobstructed splash still reaches the torso");
});
