import test from "node:test";
import assert from "node:assert/strict";
import "../src/game/world.js";
import "../src/game/skill-runtime.js";
import "../src/skills/jetpack.js";
import "../src/skills/autoaim.js";
import "../src/skills/weaken.js";
import "../src/game/player-actions.js";

function fixture() {
  const world = new globalThis.PixelFPS.World();
  world.skills = new globalThis.PixelSkillRuntime(world);
  return { world, actions: new globalThis.PixelFPSPlayerActions(world) };
}

test("binding replaces a slot and relocates a skill without changing ownership", () => {
  const { world, actions } = fixture();
  const original = structuredClone(world.player.inventory);
  assert.equal(actions.bindSkill("KeyQ", "autoaim").ok, true);
  assert.equal(actions.keyForSkill("jetpack"), null);
  assert.equal(actions.keyForSkill("autoaim"), "KeyQ");
  assert.equal(actions.getBindings().KeyF, null);
  assert.deepEqual(world.player.inventory, original);
  const before = actions.getBindings();
  assert.equal(actions.bindSkill("KeyE", "jetpack").ok, false);
  assert.equal(actions.bindSkill("KeyR", "constructor").ok, false);
  assert.deepEqual(actions.getBindings(), before);
  assert.equal(actions.bindSkill("KeyQ", null).ok, true);
  assert.equal(actions.dispatch("KeyQ"), null);
});

test("bindings survive empty inventory, consumption and a world replacement", () => {
  const { world, actions } = fixture();
  assert.equal(actions.dispatch("KeyQ").ok, false, "a preference is not a grant");
  actions.bindSkill("KeyT", "autoaim");
  world.player.inventory.skills.autoaim = { level: 1, count: 1, levels: { 1: 1 } };
  assert.equal(actions.dispatch("KeyT").ok, true);
  assert.equal(world.player.inventory.skills.autoaim.count, 0);
  assert.equal(actions.keyForSkill("autoaim"), "KeyT");
  const next = fixture().world;
  actions.setWorld(next);
  assert.equal(actions.keyForSkill("autoaim"), "KeyT");
  assert.equal(actions.dispatch("KeyT").ok, false);
  const restored = new globalThis.PixelFPSPlayerActions(next, { bindings: actions.getBindings() });
  assert.deepEqual(restored.getBindings(), actions.getBindings());
  const copy = restored.getBindings(); copy.KeyT = null;
  assert.equal(restored.keyForSkill("autoaim"), "KeyT", "callers cannot mutate binding state through the getter");
});

test("input dispatch only translates intent and forwards transfer identity to the world", () => {
  const { world, actions } = fixture();
  world.player.inventory.weapons = [{ id: "w1", type: "pistol" }, { id: "w2", type: "rifle" }];
  assert.equal(actions.dispatch("Digit2").ok, true);
  assert.equal(world.player.inventory.selected, 1);
  let request;
  world.dropItem = (value) => { request = value; return { ok: true, message: "dropped" }; };
  assert.deepEqual(actions.dispatch("KeyB"), { ok: true, message: "dropped" });
  assert.deepEqual(request, { kind: "weapon", weaponId: "w2" });
  assert.equal(actions.dispatch("Digit9").ok, false);
  assert.equal(world.player.inventory.selected, 1);
  assert.equal(actions.dispatch("KeyW"), null);
  assert.equal(actions.dispatch("KeyV").ok, false);
  assert.equal(actions.mergeSkill("jetpack").ok, false);
  assert.match(actions.mergeSkill("jetpack").message, /三份/);
});

test("unbound skills remain usable and skill ownership has no shortcut count limit", () => {
  const { world, actions } = fixture();
  for (let index = 0; index < 12; index++) {
    const id = `extra${index}`;
    world.skills.definitions[id] = { id, name: id, kind: "normal", manaCost: 0, cooldown: 0, start: () => ({}) };
    world.player.inventory.skills[id] = { level: 1, count: 1, levels: { 1: 1 } };
  }
  assert.equal(actions.keyForSkill("extra11"), null);
  assert.equal(actions.useSkill("extra11").ok, true);
  assert.equal(Object.keys(world.player.inventory.skills).length, 15);
  assert.equal(actions.bindSkill("KeyR", "extra11").ok, true);
  assert.equal(actions.dispatch("KeyR").ok, true);
});
