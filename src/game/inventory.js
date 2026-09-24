(function attachPixelFPSInventory(root) {
  "use strict";
  const Content = root.PixelFPSContent || (typeof require === "function" ? require("./content.js") : null);
  if (!Content) throw new Error("PixelFPSInventory needs PixelFPSContent.");
  const own = (object, key) => Object.hasOwn(object, key);
  const reserved = new Set(["__proto__", "prototype", "constructor"]);

  function identifier(value, label) {
    if (typeof value !== "string" || !value.trim() || reserved.has(value)) throw new TypeError(`${label}无效。`);
    return value;
  }
  function integer(value, label, min = 1) {
    if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`${label}必须是${min ? "正" : "非负"}安全整数。`);
    return value;
  }
  function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}必须是对象。`);
    return value;
  }
  function skillMap(inv) { return record(record(inv, "背包").skills, "技能集合"); }
  function weapons(inv) {
    if (!Array.isArray(record(inv, "背包").weapons)) throw new TypeError("武器集合必须是数组。");
    return inv.weapons;
  }
  function resourceKey(key) {
    if (key === "manaPotions") return key;
    if (!own(Content.RESOURCES, key)) throw new TypeError("未知物资类型。");
    return Content.RESOURCES[key].inventoryKey;
  }
  function skillState(inv, id, optional = false) {
    identifier(id, "技能编号");
    const map = skillMap(inv);
    if (!own(map, id)) {
      if (optional) return { level: 1, count: 0, levels: {} };
      throw new Error("未持有这个技能。");
    }
    const entry = record(map[id], "技能"), levels = record(entry.levels, "技能等级");
    let total = 0, highest = 1;
    const tiers = {};
    for (const [key, amount] of Object.entries(levels)) {
      if (!/^[1-9]\d*$/.test(key)) throw new TypeError("技能等级无效。");
      const level = integer(Number(key), "技能等级");
      integer(amount, "技能份数");
      total = integer(total + amount, "技能总份数");
      highest = Math.max(highest, level);
      tiers[level] = amount;
    }
    if (entry.count !== total || entry.level !== highest) throw new Error("技能份数或等级与各级存量不一致。");
    return { level: highest, count: total, levels: tiers };
  }
  function commitSkill(inv, id, levels) {
    const entries = Object.entries(levels).filter(([, count]) => count > 0);
    const next = { level: Math.max(1, ...entries.map(([tier]) => Number(tier))),
      count: entries.reduce((sum, [, count]) => sum + count, 0), levels: Object.fromEntries(entries) };
    if (own(inv.skills, id)) Object.assign(inv.skills[id], next);
    else inv.skills[id] = next;
    return inv.skills[id];
  }

  function create(skillIds = []) {
    if (!Array.isArray(skillIds)) throw new TypeError("技能编号需要数组。");
    for (const id of skillIds) identifier(id, "技能编号");
    return { weapons: [], selected: 0, ammo: 0, manaPotions: 0,
      skills: Object.fromEntries(skillIds.map((id) => [id, { level: 1, count: 0, levels: {} }])) };
  }
  function grantWeapon(inv, instance) {
    const list = weapons(inv);
    record(instance, "武器实例"); identifier(instance.id, "武器实例编号");
    identifier(instance.type, "武器类型");
    if (!own(Content.WEAPONS, instance.type)) throw new TypeError("未知武器类型。");
    if (list.some((item) => item.id === instance.id)) throw new Error("已持有这个武器实例。");
    list.push(instance);
    return instance;
  }
  function takeWeapon(inv, id) {
    identifier(id, "武器实例编号");
    const list = weapons(inv), index = list.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("未持有这个武器实例。");
    const selected = list[inv.selected];
    const [instance] = list.splice(index, 1);
    // Removing another item cannot silently switch the held weapon.
    inv.selected = selected && selected !== instance ? list.indexOf(selected) : Math.min(index, Math.max(0, list.length - 1));
    return instance;
  }
  function selectWeapon(inv, index) {
    const list = weapons(inv);
    integer(index, "武器序号", 0);
    if (index >= list.length) throw new RangeError("武器序号超出背包范围。");
    inv.selected = index;
    return true;
  }
  function grantResource(inv, key, amount) {
    record(inv, "背包"); integer(amount, "物资数量");
    const field = resourceKey(key), total = integer(integer(inv[field], "物资存量", 0) + amount, "物资总量");
    inv[field] = total;
    return total;
  }
  function takeResource(inv, key, amount) {
    record(inv, "背包"); integer(amount, "物资数量");
    const field = resourceKey(key), balance = integer(inv[field], "物资存量", 0);
    if (balance < amount) throw new Error("物资数量不足。");
    inv[field] -= amount;
    return amount;
  }
  function grantSkill(inv, id, count = 1, level = 1) {
    integer(count, "技能份数"); integer(level, "技能等级");
    const state = skillState(inv, id, true);
    integer(state.count + count, "技能总份数");
    state.levels[level] = (state.levels[level] || 0) + count;
    return commitSkill(inv, id, state.levels);
  }
  function takeSkill(inv, id, count = 1, level) {
    integer(count, "技能份数");
    if (level !== undefined) integer(level, "技能等级");
    const state = skillState(inv, id), tier = level ?? state.level;
    if ((state.levels[tier] || 0) < count) throw new Error("这个等级的技能份数不足。");
    state.levels[tier] -= count;
    commitSkill(inv, id, state.levels);
    return { skillId: id, amount: count, level: tier };
  }
  function mergeSkill(inv, id) {
    const state = skillState(inv, id);
    const tier = Object.keys(state.levels).map(Number).sort((a, b) => a - b).find((level) => state.levels[level] >= 3);
    if (tier === undefined) throw new Error("合成需要三份同名、同级技能。");
    integer(tier + 1, "合成后等级");
    state.levels[tier] -= 3;
    state.levels[tier + 1] = (state.levels[tier + 1] || 0) + 1;
    commitSkill(inv, id, state.levels);
    return { skillId: id, fromLevel: tier, level: tier + 1 };
  }
  function consumeSkill(inv, id, amount = 1) {
    integer(amount, "消耗份数");
    const state = skillState(inv, id);
    if (state.count < amount) throw new Error("技能份数不足。");
    let remaining = amount;
    for (const tier of Object.keys(state.levels).map(Number).sort((a, b) => b - a)) {
      const used = Math.min(remaining, state.levels[tier]);
      state.levels[tier] -= used;
      remaining -= used;
      if (remaining === 0) break;
    }
    commitSkill(inv, id, state.levels);
    return true;
  }

  // No positions, world clocks, key bindings, runtime hooks, or UI side effects live here.
  const api = Object.freeze({ create, grantWeapon, takeWeapon, selectWeapon, grantResource, takeResource,
    grantSkill, takeSkill, mergeSkill, consumeSkill });
  root.PixelFPSInventory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
