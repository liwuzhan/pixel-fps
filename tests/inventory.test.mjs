import test from "node:test";
import assert from "node:assert/strict";
import Inventory from "../src/game/inventory.js";
import Content from "../src/game/content.js";

function gun(id, type = "pistol", extra = {}) { return { id, type, ...extra }; }

test("weapon definitions share one ammunition resource including the rocket launcher", () => {
  assert.deepEqual(Object.keys(Content.WEAPONS), ["pistol", "rifle", "knife", "rocket"]);
  assert.equal(Content.WEAPONS.rocket.explosive, true);
  assert.ok(Content.WEAPONS.rocket.speed > 0 && Content.WEAPONS.rocket.blastRadius > 0);
  assert.equal(Content.RESOURCES.ammo.inventoryKey, "ammo");
  assert.equal(Content.RESOURCES.mana.inventoryKey, "manaPotions");
  assert.equal(Content.WEAPONS.knife.ammoCost, 0);
});

test("weapon transfers preserve identity and custom instance fields, while copies stay separate", () => {
  const inv = Inventory.create();
  const first = gun("pistol-1", "pistol", { annotation: "我的手枪", state: { shots: 3 } });
  const second = gun("pistol-2");
  assert.equal(Inventory.grantWeapon(inv, first), first);
  Inventory.grantWeapon(inv, second);
  assert.equal(inv.weapons.length, 2);
  const original = structuredClone(inv);
  assert.throws(() => Inventory.grantWeapon(inv, gun("pistol-1")));
  assert.deepEqual(inv, original);
  const dropped = Inventory.takeWeapon(inv, "pistol-1");
  assert.equal(dropped, first);
  assert.deepEqual(dropped.state, { shots: 3 });
  Inventory.grantWeapon(inv, dropped);
  assert.equal(inv.weapons[1], first);
  assert.equal(new Set(inv.weapons.map((item) => item.id)).size, 2);
});

test("dropping a nonselected weapon keeps the same held instance and selection remains valid", () => {
  const inv = Inventory.create();
  for (const id of ["left", "held", "right"]) Inventory.grantWeapon(inv, gun(id));
  Inventory.selectWeapon(inv, 1);
  Inventory.takeWeapon(inv, "left");
  assert.equal(inv.weapons[inv.selected].id, "held");
  Inventory.takeWeapon(inv, "right");
  assert.equal(inv.weapons[inv.selected].id, "held");
  Inventory.grantWeapon(inv, gun("next", "rocket"));
  Inventory.takeWeapon(inv, "held");
  assert.equal(inv.weapons[inv.selected].id, "next");
  Inventory.takeWeapon(inv, "next");
  assert.equal(inv.selected, 0);
  assert.deepEqual(inv.weapons, []);
  assert.throws(() => Inventory.selectWeapon(inv, 0));
});

test("resource transfers conserve quantities and aliases refer to the same blue-bottle stack", () => {
  const inv = Inventory.create();
  assert.equal(Inventory.grantResource(inv, "ammo", 120), 120);
  assert.equal(Inventory.takeResource(inv, "ammo", 30), 30);
  assert.equal(inv.ammo, 90);
  Inventory.grantResource(inv, "mana", 3);
  Inventory.takeResource(inv, "manaPotions", 1);
  assert.equal(inv.manaPotions, 2);
  Inventory.takeResource(inv, "mana", 2);
  assert.equal(inv.manaPotions, 0);
  assert.deepEqual(Object.keys(inv).sort(), ["ammo", "manaPotions", "selected", "skills", "weapons"]);
});

test("nine level-one skills become one level-three skill through four exact three-to-one merges", () => {
  const inv = Inventory.create(["jetpack"]);
  Inventory.grantSkill(inv, "jetpack", 9, 1);
  for (let i = 0; i < 3; i++) assert.deepEqual(Inventory.mergeSkill(inv, "jetpack"), { skillId: "jetpack", fromLevel: 1, level: 2 });
  assert.deepEqual(inv.skills.jetpack, { level: 2, count: 3, levels: { 2: 3 } });
  assert.deepEqual(Inventory.mergeSkill(inv, "jetpack"), { skillId: "jetpack", fromLevel: 2, level: 3 });
  assert.deepEqual(inv.skills.jetpack, { level: 3, count: 1, levels: { 3: 1 } });
  assert.throws(() => Inventory.mergeSkill(inv, "jetpack"));
});

test("skill drops remove only the requested tier and preserve all lower-level copies", () => {
  const inv = Inventory.create();
  Inventory.grantSkill(inv, "weaken", 4, 1);
  Inventory.grantSkill(inv, "weaken", 2, 3);
  assert.deepEqual(Inventory.takeSkill(inv, "weaken", 1), { skillId: "weaken", amount: 1, level: 3 });
  assert.deepEqual(inv.skills.weaken.levels, { 1: 4, 3: 1 });
  const previous = structuredClone(inv);
  assert.throws(() => Inventory.takeSkill(inv, "weaken", 2));
  assert.deepEqual(inv, previous, "default drop cannot silently consume lower levels to satisfy quantity");
  Inventory.takeSkill(inv, "weaken", 3, 1);
  assert.deepEqual(inv.skills.weaken, { level: 3, count: 2, levels: { 1: 1, 3: 1 } });
  Inventory.takeSkill(inv, "weaken", 1, 3);
  assert.deepEqual(inv.skills.weaken, { level: 1, count: 1, levels: { 1: 1 } });
  Inventory.takeSkill(inv, "weaken", 1, 1);
  assert.deepEqual(inv.skills.weaken, { level: 1, count: 0, levels: {} });
});

test("consumable skill usage may cross tiers from highest to lowest but never partly consumes on failure", () => {
  const inv = Inventory.create();
  Inventory.grantSkill(inv, "autoaim", 3, 1);
  Inventory.grantSkill(inv, "autoaim", 1, 2);
  Inventory.grantSkill(inv, "autoaim", 2, 3);
  assert.equal(Inventory.consumeSkill(inv, "autoaim", 4), true);
  assert.deepEqual(inv.skills.autoaim, { level: 1, count: 2, levels: { 1: 2 } });
  const previous = structuredClone(inv);
  assert.throws(() => Inventory.consumeSkill(inv, "autoaim", 3));
  assert.deepEqual(inv, previous);
  Inventory.consumeSkill(inv, "autoaim", 2);
  assert.deepEqual(inv.skills.autoaim, { level: 1, count: 0, levels: {} });
});

test("invalid quantities, unknown resources, duplicate identities and missing stock leave inventory unchanged", () => {
  const inv = Inventory.create(["jetpack"]);
  Inventory.grantWeapon(inv, gun("owned"));
  Inventory.grantSkill(inv, "jetpack", 4);
  Inventory.grantResource(inv, "ammo", 5);
  const invalid = [
    () => Inventory.takeWeapon(inv, "missing"),
    () => Inventory.selectWeapon(inv, -1),
    () => Inventory.selectWeapon(inv, 1),
    () => Inventory.grantWeapon(inv, gun("new", "unknown")),
    () => Inventory.grantWeapon(inv, gun("new", { toString: () => "pistol" })),
    () => Inventory.takeResource(inv, "ammo", 6),
    () => Inventory.takeResource(inv, "mana", 1),
    () => Inventory.grantResource(inv, "other", 2),
    () => Inventory.grantSkill(inv, "__proto__", 1),
    () => Inventory.takeSkill(inv, "jetpack", 1, 2),
    () => Inventory.consumeSkill(inv, "absent", 1),
    ...[0, -1, 0.5, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [
      () => Inventory.grantResource(inv, "ammo", value),
      () => Inventory.takeResource(inv, "ammo", value),
      () => Inventory.grantSkill(inv, "jetpack", value),
      () => Inventory.grantSkill(inv, "new", 1, value),
      () => Inventory.consumeSkill(inv, "jetpack", value),
      () => Inventory.takeSkill(inv, "jetpack", value),
    ]),
  ];
  for (const mutate of invalid) {
    const before = structuredClone(inv);
    assert.throws(mutate);
    assert.deepEqual(inv, before);
  }
});

test("safe-integer overflow is rejected without corrupting resources or skill levels", () => {
  const inv = Inventory.create();
  Inventory.grantResource(inv, "ammo", Number.MAX_SAFE_INTEGER);
  Inventory.grantSkill(inv, "many", Number.MAX_SAFE_INTEGER, 1);
  Inventory.grantSkill(inv, "highest", 3, Number.MAX_SAFE_INTEGER);
  const before = structuredClone(inv);
  assert.throws(() => Inventory.grantResource(inv, "ammo", 1));
  assert.throws(() => Inventory.grantSkill(inv, "many", 1, 2));
  assert.throws(() => Inventory.mergeSkill(inv, "highest"));
  assert.deepEqual(inv, before);
});

test("skill ownership has no shortcut-slot cap or dependency on a world runtime", () => {
  const inv = Inventory.create();
  for (let i = 0; i < 30; i++) Inventory.grantSkill(inv, `future-skill-${i}`, 1);
  assert.equal(Object.keys(inv.skills).length, 30);
  assert.equal(inv.skills["future-skill-29"].count, 1);
  assert.equal("bindings" in inv, false);
  assert.equal("cooldowns" in inv, false);
});
