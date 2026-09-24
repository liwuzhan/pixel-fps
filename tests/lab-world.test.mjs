import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { World, actorBoxes, eye } = require('../src/game/world.js');
const SkillRuntime = require('../src/game/skill-runtime.js');
const advance = (world, seconds) => {
  for (let left = seconds; left > 1e-8; left -= 0.02) world.update(Math.min(left, 0.02));
};
const owned = (world, id, count = 1) => Object.assign(world.player.inventory.skills[id], { level: 1, count, levels: { 1: count } });
const damageEvents = (world) => world.combatLog.filter((entry) => entry.type === 'damage');

function arena() {
  const world = new World();
  world.clearDummies();
  world.obstacles = [];
  world.player.pos = [0, 0, 0];
  return world;
}

test('mana and cooldown cheats bypass resources but retain skill ownership, control states and ultimate copies', () => {
  const world = arena();
  world.skills = new SkillRuntime(world, {
    jetpack: { id: 'jetpack', kind: 'normal', manaCost: 25, cooldown: 10, start() {} },
    autoaim: { id: 'autoaim', kind: 'ultimate', manaCost: 25, cooldown: 10, duration: 1, start() {} },
  });
  assert.deepEqual(world.cheats, { infiniteMana: false, infiniteAmmo: false, noCooldown: false });
  world.player.mana = 0;
  world.cheats.infiniteMana = true;
  world.cheats.noCooldown = true;
  assert.equal(world.skills.cast('jetpack').ok, false);
  owned(world, 'jetpack');
  assert.equal(world.skills.cast('jetpack').ok, true);
  assert.equal(world.skills.cast('jetpack').ok, true);
  assert.equal(world.player.mana, 0);
  assert.equal(world.skills.getState('jetpack').remaining, 0);
  world.applyStatus(world.player, 'silence', 5, 'test');
  assert.equal(world.skills.cast('jetpack').ok, false);
  world.removeStatus(world.player, 'silence');
  owned(world, 'autoaim', 2);
  assert.equal(world.skills.cast('autoaim').ok, true);
  assert.equal(world.skills.cast('autoaim').ok, true);
  assert.equal(world.player.inventory.skills.autoaim.count, 0);
  assert.equal(world.skills.cast('autoaim').ok, false);
  world.cheats.infiniteMana = false;
  assert.equal(world.skills.cast('jetpack').ok, false);
});

test('enabling no cooldown bypasses an already-running cooldown without changing ordinary gun cadence', () => {
  const world = arena();
  world.skills = new SkillRuntime(world, { jetpack: { id: 'jetpack', manaCost: 1, cooldown: 10 } });
  owned(world, 'jetpack');
  assert.equal(world.skills.cast('jetpack').ok, true);
  assert.equal(world.skills.cast('jetpack').ok, false);
  world.cheats.noCooldown = true;
  assert.equal(world.skills.cast('jetpack').ok, true);
  world.player.inventory.weapons.push({ id: 'gun-1', type: 'pistol' });
  world.cheats.infiniteAmmo = true;
  assert.equal(world.fire(), true);
  assert.equal(world.fire(), false);
  assert.equal(world.player.inventory.ammo, 0);
  advance(world, 0.3);
  assert.equal(world.fire(), true);
  world.cheats.infiniteAmmo = false;
  advance(world, 0.3);
  assert.equal(world.fire(), false);
});

test('damage traces describe original damage, all weakening sources, capped health loss and invulnerability', () => {
  const world = arena(), target = world.spawnDummy({});
  const weak = world.applyStatus(world.player, 'weaken', 6, 'grenade-a', { damageMultiplier: 0.45 });
  world.applyStatus(world.player, 'weaken', 6, 'grenade-b', { damageMultiplier: 0.7 });
  target.hp = 5;
  assert.equal(world.damage(target, 20, { ownerId: 'player', weaponId: 'pistol', partId: 'head' }), 5);
  const entry = damageEvents(world).at(-1);
  assert.deepEqual({ base: entry.baseDamage, multiplier: entry.multiplier, modified: entry.modifiedDamage, actual: entry.actualDamage, before: entry.hpBefore, after: entry.hpAfter },
    { base: 20, multiplier: 0.45, modified: 9, actual: 5, before: 5, after: 0 });
  assert.equal(entry.fatal, true);
  assert.equal(entry.partId, 'head');
  assert.equal(entry.weaponId, 'pistol');
  assert.equal(entry.modifiers[0].statusId, weak.id);
  assert.deepEqual(entry.modifiers.map((modifier) => modifier.sourceId), ['grenade-a', 'grenade-b']);
  world.resetTargets();
  world.applyStatus(target, 'invulnerable', 2, 'shield');
  assert.equal(world.damage(target, 20, 'player'), 0);
  assert.equal(damageEvents(world).at(-1).blockedReason, 'invulnerable');
  assert.equal(target.hp, target.maxHp);
  assert.equal(world.damage(target, Infinity), 0);
  assert.equal(world.damage(target, NaN), 0);
});

test('physical gun and knife hits record the weapon and actual intersected body part', () => {
  const world = arena();
  const target = world.spawnDummy({ pos: [0, 0, -5] });
  world.player.inventory.weapons = [{ id: 'gun', type: 'pistol' }, { id: 'blade', type: 'knife' }];
  world.player.inventory.ammo = 10;
  world.fire(); advance(world, 0.1);
  assert.equal(damageEvents(world).at(-1).weaponId, 'pistol');
  assert.equal(damageEvents(world).at(-1).partId, 'head');
  world.configureDummy(target.id, { pos: [0, 0, -0.8] });
  advance(world, 0.3);
  world.selectWeapon(1);
  world.fire();
  assert.equal(damageEvents(world).at(-1).weaponId, 'knife');
  assert.equal(damageEvents(world).at(-1).partId, 'head');
});

test('status lifecycle keeps source identity and rejects non-finite effect factors', () => {
  const world = arena(), target = world.spawnDummy({});
  const first = world.applyStatus(target, 'weaken', 0.1, 'source-a');
  const second = world.applyStatus(target, 'weaken', 5, 'source-b');
  assert.equal(world.applyStatus(target, 'slow', 1, null, { multiplier: NaN }), null);
  advance(world, 0.12);
  assert.equal(target.statuses.length, 1);
  assert.equal(world.removeStatus(target, second.id), 1);
  const expiry = world.combatLog.find((entry) => entry.type === 'status-expire');
  assert.equal(expiry.statusId, first.id);
  assert.equal(expiry.sourceId, 'source-a');
  assert.equal(world.combatLog.at(-1).sourceId, 'source-b');
  assert.equal(world.combatLog.at(-1).type, 'status-remove');
});

test('combat log has a bounded history and monotonically increasing identifiers across reset', () => {
  const world = arena();
  for (let index = 0; index < 520; index++) world.recordCombat('test', { index });
  assert.equal(world.combatLog.length, 500);
  assert.equal(world.combatLog[0].index, 20);
  const id = world.combatLog.at(-1).id;
  world.reset();
  assert.equal(world.combatLog.length, 0);
  assert.ok(world.recordCombat('next').id > id);
});

test('custom dummies use true six-part bodies and atomic configuration validation', () => {
  const world = arena();
  const target = world.spawnDummy({ label: 'big', pos: [0, 0, -5], parameters: { headScale: 2, torsoScale: 2, legLength: 1.6 } });
  assert.equal(target.maxHp, 800);
  assert.equal(target.maxMana, 800);
  assert.equal(target.speed, 9);
  assert.equal(actorBoxes(target).length, 6);
  world.configureDummy(target.id, { parameters: { armLength: 2 }, training: { fire: true } });
  assert.equal(target.character.params.headScale, 2);
  assert.equal(target.character.params.armLength, 2);
  assert.equal(target.training.fire, true);
  const before = JSON.stringify(target);
  assert.throws(() => world.configureDummy(target.id, { label: 'should not persist', pos: [NaN, 0, 0] }));
  assert.equal(JSON.stringify(target), before);
  assert.throws(() => world.configureDummy(target.id, { parameters: { torsoScale: Infinity } }));
  assert.throws(() => world.configureDummy(target.id, { training: { fire: 1 } }));
  assert.throws(() => world.configureDummy(target.id, { pos: null }));
  assert.throws(() => world.configureDummy(target.id, { training: null }));
  assert.throws(() => world.configureDummy(target.id, { pos: [0, -1, 0] }));
});

test('boundary validation accounts for the whole body and strafe stays inside the arena', () => {
  const world = arena();
  const target = world.spawnDummy({ pos: [19.5, 0, -5], training: { behavior: 'strafe' } });
  const original = target.character;
  assert.throws(() => world.configureDummy(target.id, { parameters: { headScale: 5 } }));
  assert.equal(target.character, original);
  assert.throws(() => world.spawnDummy({ pos: [20, 0, -5] }));
  advance(world, 3);
  assert.ok(target.pos[0] + target.character.bounds.max[0] <= 20);
  assert.ok(target.pos[0] + target.character.bounds.min[0] >= -20);
});

test('explicit dummy behavior overrides global controls while original targets inherit them', () => {
  const world = new World();
  world.obstacles = [];
  world.targetsMoving = true;
  world.enemyFire = true;
  const still = world.spawnDummy({ pos: [10, 0, -10] });
  const moving = world.spawnDummy({ pos: [-10, 0, -10], training: { behavior: 'strafe', fire: true } });
  world.update(0.1);
  assert.equal(still.pos[0], 10);
  assert.notEqual(moving.pos[0], -10);
  assert.notEqual(world.actors[1].pos[0], -5);
  world.time = 2;
  world._updateTargets(0.1);
  assert.ok(world.projectiles.some((projectile) => projectile.ownerId === moving.id));
  assert.ok(!world.projectiles.some((projectile) => projectile.ownerId === still.id));
  assert.ok(world.projectiles.some((projectile) => projectile.ownerId === 'target-1'));
});

test('automatic recovery preserves real hit results and fatal hits wait for timed respawn', () => {
  const world = arena();
  const target = world.spawnDummy({ parameters: { torsoScale: 2 }, training: { autoRecover: true, autoRespawn: true, respawnDelay: 0.2 } });
  assert.equal(world.damage(target, 50, 'player'), 50);
  assert.equal(target.hp, 800);
  assert.equal(damageEvents(world).at(-1).hpAfter, 750);
  assert.equal(world.combatLog.at(-1).type, 'recover');
  assert.equal(world.damage(target, 900, 'player'), 800);
  assert.equal(target.alive, false);
  assert.equal(damageEvents(world).at(-1).fatal, true);
  advance(world, 0.1);
  assert.equal(target.alive, false);
  advance(world, 0.12);
  assert.equal(target.alive, true);
  assert.equal(target.hp, 800);
  assert.ok(world.combatLog.some((entry) => entry.type === 'respawn' && entry.targetId === target.id));
  world.resetTargets();
  assert.equal(target.character.params.torsoScale, 2);
  assert.equal(target.training.autoRecover, true);
});

test('dummy deletion clears owned projectiles and the development population cap is enforceable', () => {
  const world = arena();
  const target = world.spawnDummy({});
  world.spawnProjectile({ pos: eye(target), vel: [0, 0, 1], ownerId: target.id });
  assert.equal(world.removeDummy('player'), false);
  assert.equal(world.removeDummy(target.id), true);
  assert.equal(world.projectiles.length, 0);
  for (let index = 0; index < 64; index++) world.spawnDummy({});
  assert.throws(() => world.spawnDummy({}), /64/);
  assert.equal(world.clearDummies(), 64);
  assert.deepEqual(world.actors, [world.player]);
});

test('reset clears cheats and runtime effects without losing inventory or custom dummy configuration', () => {
  const world = arena();
  const target = world.spawnDummy({ label: 'saved', training: { autoRespawn: true } });
  world.skills = new SkillRuntime(world, { autoaim: { id: 'autoaim', kind: 'ultimate', duration: 7 } });
  owned(world, 'autoaim', 2);
  world.skills.cast('autoaim');
  world.cheats = { infiniteMana: true, infiniteAmmo: true, noCooldown: true };
  world.player.inventory.ammo = 17;
  world.applyStatus(world.player, 'invulnerable', 5, 'test');
  world.damage(target, 1000, 'player');
  world.reset();
  assert.deepEqual(world.cheats, { infiniteMana: false, infiniteAmmo: false, noCooldown: false });
  assert.equal(world.skills.instances.length, 0);
  assert.equal(world.player.inventory.ammo, 17);
  assert.equal(world.player.inventory.skills.autoaim.count, 1);
  assert.equal(world.player.statuses.length, 0);
  assert.equal(target.alive, true);
  assert.equal(target.label, 'saved');
  assert.equal(target.training.autoRespawn, true);
});
