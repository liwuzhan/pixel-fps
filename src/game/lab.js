(function attachPixelFPSLab(root) {
  "use strict";
  const FPS = root.PixelFPS || (typeof require === "function" ? require("./world.js") : null);
  const Character = root.BlockCharacter || (typeof require === "function" ? require("../character.js") : null);
  const Runtime = root.PixelSkillRuntime || (typeof require === "function" ? require("./skill-runtime.js") : null);
  const STEP = 1 / 120;
  const OWN = (object, key) => Object.hasOwn(object, key);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const PRESETS = Object.freeze({
    standard: { ...Character.DEFAULTS }, bighead: { ...Character.DEFAULTS, headScale: 2.5 },
    tiny: { ...Character.PRESETS.small }, longarm: { ...Character.DEFAULTS, armLength: 2.4 },
  });
  const CHEATS = Object.freeze({ mana: "infiniteMana", ammo: "infiniteAmmo", cooldown: "noCooldown",
    infiniteMana: "infiniteMana", infiniteAmmo: "infiniteAmmo", noCooldown: "noCooldown" });
  const STATUSES = Object.freeze(["weaken", "slow", "root", "stun", "silence", "disarmed", "invulnerable"]);
  const BUILTINS = Object.freeze({ shooting: "基础射击", merge: "技能连续合成", weakness: "虚弱与还击" });
  const TRAINING = Object.freeze({ behavior: "stationary", fire: false, autoRespawn: false, autoRecover: false, respawnDelay: 2 });
  const HELP = [
    "help · list [weapons|skills|dummies|scenarios|status]",
    "give weapon <id> [数量] · give skill <id> [数量] [等级] · give ammo <数量> · give mana <蓝瓶数>",
    "refill · cooldown clear · cheat mana|ammo|cooldown on|off",
    "dummy spawn [standard|bighead|tiny|longarm] [x y z] · dummy remove <id> · dummy clear",
    "dummy set <id> head|torso|arms|legs <数值> · dummy set <id> pos <x y z>",
    "dummy set <id> move stationary|strafe|inherit · dummy set <id> fire on|off|inherit",
    "dummy set <id> respawn|recover on|off · dummy set <id> delay <秒>",
    "status add <actorId> <类型> [秒] · status clear <actorId> [类型]",
    "time scale <0.05–4> · time pause|resume · step [帧数，120帧/秒]",
    "clear projectiles|log · reset",
    "scenario save|load|delete <名称> · scenario list",
    "内建实验：scenario load shooting|merge|weakness",
  ].join("\n");

  function record(value, label, allowed = null) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}必须是普通对象。`);
    if (allowed) for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}不支持字段 ${key}。`);
    return value;
  }
  function number(value, label, min, max, integer = false) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(`${label}必须是 ${min}–${max} 范围内的${integer ? "整数" : "数值"}。`);
    }
    return value;
  }
  function boolean(value, label) {
    if (typeof value !== "boolean") throw new Error(`${label}必须为 true 或 false。`);
    return value;
  }
  function vector(value, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label}需要三个坐标。`);
    return value.map((axis) => number(axis, label, -1000, 1000));
  }
  function parameters(value) {
    record(value, "体型", Object.keys(Character.DEFAULTS));
    for (const key of Object.keys(Character.DEFAULTS)) number(value[key], key, Character.LIMITS[key].min, Character.LIMITS[key].max);
    return { ...value };
  }
  function training(value) {
    record(value, "木桩行为", Object.keys(TRAINING));
    if (!["stationary", "strafe", null].includes(value.behavior)) throw new Error("木桩移动方式无效。");
    if (value.fire !== null) boolean(value.fire, "木桩还击");
    return { behavior: value.behavior, fire: value.fire,
      autoRespawn: boolean(value.autoRespawn, "自动复活"), autoRecover: boolean(value.autoRecover, "自动恢复"),
      respawnDelay: number(value.respawnDelay, "复活等待", 0, 3600) };
  }
  function name(value) {
    if (typeof value !== "string" || !/^[\p{L}\p{N}_-]{1,40}$/u.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) {
      throw new Error("场景名称使用 1–40 个文字、数字、下划线或连字符。");
    }
    return value;
  }
  function switchValue(value, inherit = false) {
    if (value === "on") return true;
    if (value === "off") return false;
    if (inherit && value === "inherit") return null;
    throw new Error(`开关值应为 on 或 off${inherit ? "，也可以使用 inherit" : ""}。`);
  }
  function arity(tokens, min, max = min) {
    if (tokens.length < min || tokens.length > max) throw new Error("参数数量不正确，输入 help 查看用法。");
  }

  /** The text console and direct automation share these methods. No command evaluates JavaScript. */
  class PixelFPSLab {
    constructor(world, options = {}) {
      this.scenarios = Object.create(null);
      this.paused = false;
      this.timeScale = 1;
      this._resetWorld = options.resetWorld || null;
      this.setWorld(world);
    }
    setWorld(world) {
      if (!world?.player || typeof world.update !== "function") throw new Error("实验环境需要有效的 World。");
      this.world = world;
      return this;
    }
    list() {
      return { weapons: Object.entries(FPS.WEAPONS).map(([id, item]) => ({ id, name: item.label })),
        skills: Object.entries(this.world.skills?.definitions || {}).map(([id, item]) => ({ id, name: item.name, kind: item.kind })),
        dummies: this.world.actors.filter((actor) => actor !== this.world.player).map((actor) => ({
          id: actor.id, label: actor.label, pos: [...actor.pos], alive: actor.alive, hp: actor.hp, maxHp: actor.maxHp,
          parameters: { ...actor.character.params }, training: { ...TRAINING, ...actor.training } })),
        scenarios: this.listScenarios(), status: [...STATUSES] };
    }
    give(type, idOrAmount, count = 1, level = 1) {
      const inventory = this.world.player.inventory;
      if (type === "weapon") {
        if (!OWN(FPS.WEAPONS, idOrAmount)) throw new Error("未知武器，输入 list weapons 查看。");
        number(count, "武器数量", 1, 1000, true);
        if (inventory.weapons.length + count > 1000) throw new Error("实验最多持有 1000 件武器。");
        const result = [];
        for (let index = 0; index < count; index++) {
          const item = { id: `weapon-${this.world._nextId++}`, type: idOrAmount };
          inventory.weapons.push(item); result.push(item);
        }
        return result;
      }
      if (type === "skill") {
        if (!OWN(this.world.skills?.definitions || {}, idOrAmount)) throw new Error("未知技能，输入 list skills 查看。");
        number(count, "技能数量", 1, 100000, true); number(level, "技能等级", 1, 99, true);
        const old = inventory.skills[idOrAmount];
        if ((old?.count || 0) + count > 100000) throw new Error("同名技能最多持有 100000 份。");
        const item = old || (inventory.skills[idOrAmount] = { level: 1, count: 0, levels: {} });
        item.levels[level] = (item.levels[level] || 0) + count;
        item.count += count; item.level = Math.max(item.level, level);
        return clone(item);
      }
      if (!["ammo", "mana"].includes(type)) throw new Error("物资类型应为 weapon、skill、ammo 或 mana。");
      number(idOrAmount, "物资数量", 1, 1000000, true);
      const key = type === "ammo" ? "ammo" : "manaPotions";
      number(inventory[key] + idOrAmount, "持有数量", 0, 1000000, true);
      inventory[key] += idOrAmount;
      return inventory[key];
    }
    refill() {
      const player = this.world.player;
      player.hp = player.maxHp; player.mana = player.maxMana; player.alive = true;
      return { hp: player.hp, mana: player.mana };
    }
    clearCooldowns() {
      this.world.player.nextFireAt = this.world.time;
      if (this.world.skills) this.world.skills.cooldowns = Object.create(null);
      return true;
    }
    setCheat(key, enabled) {
      if (!OWN(CHEATS, key)) throw new Error("作弊选项应为 mana、ammo 或 cooldown。");
      boolean(enabled, "作弊开关");
      this.world.cheats[CHEATS[key]] = enabled;
      return enabled;
    }
    spawnDummy(options = {}) { return this.world.spawnDummy(options); }
    configureDummy(id, patch) { return this.world.configureDummy(id, patch); }
    removeDummy(id) {
      if (!this.world.removeDummy(id)) throw new Error("没有这个木桩。");
      return true;
    }
    clearDummies() { return this.world.clearDummies(); }
    addStatus(actorId, type, seconds = 5) {
      const actor = this.world.findActor(actorId);
      if (!actor || !actor.alive) throw new Error("状态目标不存在或已倒下。");
      if (!STATUSES.includes(type)) throw new Error(`未知状态，可用：${STATUSES.join(", ")}。`);
      number(seconds, "持续秒数", 0.01, 3600);
      return this.world.applyStatus(actor, type, seconds, "lab", type === "weaken" ? { damageMultiplier: 0.45 } : {});
    }
    clearStatus(actorId, type) {
      const actor = this.world.findActor(actorId);
      if (!actor) throw new Error("没有这个角色。");
      if (type !== undefined && !STATUSES.includes(type)) throw new Error("未知状态类型。");
      return this.world.removeStatus(actor, type, "lab");
    }
    pause() { this.paused = true; return true; }
    resume() { this.paused = false; return true; }
    setTimeScale(value) { this.timeScale = number(value, "时间倍率", 0.05, 4); return this.timeScale; }
    step(frames = 1) {
      number(frames, "推进帧数", 1, 1200, true);
      if (!this.paused) throw new Error("请先执行 time pause，再逐帧推进。");
      for (let frame = 0; frame < frames; frame++) this.world.update(STEP, {});
      return this.world.time;
    }
    clearProjectiles() { const count = this.world.projectiles.length; this.world.projectiles = []; return count; }
    clearLog() { const count = this.world.combatLog.length; this.world.combatLog = []; return count; }
    reset() {
      const current = this.world;
      const options = { parameters: { ...current.player.character.params }, face: clone(current.player.face) };
      let world;
      if (this._resetWorld) world = this._resetWorld(options);
      else {
        current.skills?.dispose();
        world = new FPS.World(options);
        world.skills = new Runtime(world, current.skills?.definitions);
      }
      this.setWorld(world);
      this.paused = false; this.timeScale = 1;
      return world;
    }
    snapshot() {
      const world = this.world, player = world.player, inventory = player.inventory;
      return this._validateScenario({ version: 1,
        player: { parameters: { ...player.character.params }, face: clone(player.face), pos: [...player.pos], yaw: player.yaw, pitch: player.pitch,
          inventory: { weapons: inventory.weapons.map((item) => item.type), selected: inventory.selected,
            ammo: inventory.ammo, manaPotions: inventory.manaPotions,
            skills: Object.fromEntries(Object.entries(inventory.skills).filter(([id]) => OWN(world.skills?.definitions || {}, id))
              .map(([id, item]) => [id, { ...item.levels }])) } },
        dummies: world.actors.filter((actor) => actor !== player).map((actor) => ({ label: actor.label,
          parameters: { ...actor.character.params }, pos: [...actor.pos], training: { ...TRAINING, ...actor.training } })),
        world: { targetsMoving: world.targetsMoving, enemyFire: world.enemyFire, cheats: { ...world.cheats }, supplies: world.pickups.length > 0 },
        time: { scale: this.timeScale, paused: this.paused } });
    }
    _validateScenario(value) {
      record(value, "场景", ["version", "player", "dummies", "world", "time"]);
      if (value.version !== 1) throw new Error("场景版本应为 1。");
      const player = record(value.player, "玩家", ["parameters", "face", "pos", "yaw", "pitch", "inventory"]);
      const params = parameters(player.parameters), face = Character.exportData(params, player.face).face;
      const inv = record(player.inventory, "背包", ["weapons", "selected", "ammo", "manaPotions", "skills"]);
      if (!Array.isArray(inv.weapons) || inv.weapons.length > 1000 || inv.weapons.some((id) => typeof id !== "string" || !OWN(FPS.WEAPONS, id))) throw new Error("场景含有未知武器或武器数量过多。");
      record(inv.skills, "技能");
      const skills = Object.create(null);
      for (const [id, levels] of Object.entries(inv.skills)) {
        if (!OWN(this.world.skills?.definitions || {}, id)) throw new Error(`场景含有未载入技能 ${id}。`);
        record(levels, "技能等级");
        let total = 0;
        skills[id] = {};
        for (const [tier, count] of Object.entries(levels)) {
          if (!/^[1-9]\d?$/.test(tier)) throw new Error("技能等级应为 1–99。");
          total += number(count, "技能份数", 1, 100000, true);
          skills[id][tier] = count;
        }
        number(total, "技能总份数", 0, 100000, true);
      }
      if (!Array.isArray(value.dummies) || value.dummies.length > 64) throw new Error("场景最多包含 64 个木桩。");
      const dummies = value.dummies.map((item) => {
        record(item, "木桩", ["label", "parameters", "pos", "training"]);
        if (typeof item.label !== "string" || !item.label.trim() || item.label.length > 80) throw new Error("木桩名称需要 1–80 个字符。");
        return { label: item.label, parameters: parameters(item.parameters), pos: vector(item.pos, "木桩位置"), training: training(item.training) };
      });
      const validationWorld = new FPS.World({ parameters: params, face });
      const playerPos = vector(player.pos, "玩家位置"), bodyBounds = validationWorld.player.character.bounds;
      if (playerPos[1] < 0) throw new Error("玩家不能位于地面以下。");
      for (const axis of [0, 2]) {
        if (playerPos[axis] + bodyBounds.min[axis] < validationWorld.bounds.min[axis] ||
            playerPos[axis] + bodyBounds.max[axis] > validationWorld.bounds.max[axis]) {
          throw new Error("玩家完整体型必须位于训练场边界内。");
        }
      }
      validationWorld.clearDummies();
      for (const dummy of dummies) validationWorld.spawnDummy(dummy);
      const config = record(value.world, "世界配置", ["targetsMoving", "enemyFire", "cheats", "supplies"]);
      const cheats = record(config.cheats, "作弊配置", ["infiniteMana", "infiniteAmmo", "noCooldown"]);
      const time = record(value.time, "时间配置", ["scale", "paused"]);
      return { version: 1,
        player: { parameters: params, face, pos: playerPos, yaw: number(player.yaw, "水平朝向", -1000000, 1000000),
          pitch: number(player.pitch, "垂直朝向", -Math.PI / 2, Math.PI / 2), inventory: {
            weapons: [...inv.weapons], selected: number(inv.selected, "武器选择", 0, Math.max(0, inv.weapons.length - 1), true),
            ammo: number(inv.ammo, "弹药", 0, 1000000, true), manaPotions: number(inv.manaPotions, "蓝瓶", 0, 1000000, true), skills } },
        dummies, world: { targetsMoving: boolean(config.targetsMoving, "全局移动"), enemyFire: boolean(config.enemyFire, "全局还击"),
          supplies: boolean(config.supplies, "出生物资"), cheats: { infiniteMana: boolean(cheats.infiniteMana, "无限蓝量"),
            infiniteAmmo: boolean(cheats.infiniteAmmo, "无限弹药"), noCooldown: boolean(cheats.noCooldown, "无冷却") } },
        time: { scale: number(time.scale, "时间倍率", 0.05, 4), paused: boolean(time.paused, "暂停") } };
    }
    loadScenario(input) {
      // Complete validation happens before reset; malformed saves cannot erase a running experiment.
      const value = this._validateScenario(input), old = this.world;
      let world;
      const options = { parameters: value.player.parameters, face: value.player.face };
      if (this._resetWorld) world = this._resetWorld(options);
      else {
        old.skills?.dispose(); world = new FPS.World(options);
        world.skills = new Runtime(world, old.skills?.definitions);
      }
      this.setWorld(world);
      world.clearDummies();
      for (const dummy of value.dummies) world.spawnDummy(dummy);
      const player = world.player, inventory = player.inventory, saved = value.player.inventory;
      player.pos = [...value.player.pos]; player.spawnPos = [...value.player.pos]; player.yaw = value.player.yaw; player.pitch = value.player.pitch;
      inventory.weapons = saved.weapons.map((type) => ({ id: `weapon-${world._nextId++}`, type }));
      inventory.selected = saved.selected; inventory.ammo = saved.ammo; inventory.manaPotions = saved.manaPotions;
      inventory.skills = Object.create(null);
      for (const id of Object.keys(world.skills?.definitions || {})) {
        const levels = { ...(saved.skills[id] || {}) };
        inventory.skills[id] = { level: Math.max(1, ...Object.keys(levels).map(Number)),
          count: Object.values(levels).reduce((sum, count) => sum + count, 0), levels };
      }
      world.targetsMoving = value.world.targetsMoving; world.enemyFire = value.world.enemyFire; world.cheats = { ...value.world.cheats };
      if (!value.world.supplies) world.pickups = [];
      world.combatLog = []; world.events = [];
      this.timeScale = value.time.scale; this.paused = value.time.paused;
      return this.snapshot();
    }
    _builtin(id) {
      const value = this.snapshot();
      value.player.pos = [0, 0, 7]; value.player.yaw = 0; value.player.pitch = 0;
      value.player.inventory = { weapons: ["pistol", "rifle", "knife"], selected: 0, ammo: 999, manaPotions: 10, skills: {} };
      value.world = { targetsMoving: false, enemyFire: false, supplies: false,
        cheats: { infiniteMana: false, infiniteAmmo: false, noCooldown: false } };
      value.time = { scale: 1, paused: false };
      value.dummies = [{ label: "实验木桩", parameters: { ...PRESETS.standard }, pos: [0, 0, -5],
        training: { ...TRAINING, autoRespawn: true } }];
      if (id === "shooting") value.dummies.push({ label: "大头木桩", parameters: { ...PRESETS.bighead }, pos: [5, 0, -6], training: { ...TRAINING, autoRespawn: true } });
      if (id === "merge") value.player.inventory.skills = { jetpack: { 1: 9 }, weaken: { 1: 9 } };
      if (id === "weakness") {
        value.player.inventory.skills = { weaken: { 1: 1 } };
        value.world.cheats.infiniteMana = true; value.world.cheats.noCooldown = true;
        value.dummies[0].training.fire = true;
      }
      return value;
    }
    listScenarios() {
      return [...Object.entries(BUILTINS).map(([name, label]) => ({ name, label, builtin: true })),
        ...Object.keys(this.scenarios).map((name) => ({ name, label: name, builtin: false }))];
    }
    saveScenario(id) {
      name(id);
      if (OWN(BUILTINS, id)) throw new Error("内建实验名称不能覆盖，请换一个名称。");
      if (!OWN(this.scenarios, id) && Object.keys(this.scenarios).length >= 100) throw new Error("最多保存 100 个实验。");
      this.scenarios[id] = this.snapshot();
      return clone(this.scenarios[id]);
    }
    loadNamedScenario(id) {
      name(id);
      if (OWN(BUILTINS, id)) return this.loadScenario(this._builtin(id));
      if (!OWN(this.scenarios, id)) throw new Error("没有这个实验场景。");
      return this.loadScenario(this.scenarios[id]);
    }
    deleteScenario(id) {
      name(id);
      if (OWN(BUILTINS, id)) throw new Error("内建实验不能删除。");
      if (!OWN(this.scenarios, id)) throw new Error("没有这个实验场景。");
      delete this.scenarios[id]; return true;
    }
    importScenarios(value) {
      if (typeof value === "string") value = JSON.parse(value);
      record(value, "实验集合");
      if (Object.keys(value).length > 100) throw new Error("最多保存 100 个实验。");
      const checked = Object.create(null);
      for (const [id, scene] of Object.entries(value)) {
        name(id);
        if (OWN(BUILTINS, id)) throw new Error("自存实验不能覆盖内建实验。");
        checked[id] = this._validateScenario(scene);
      }
      this.scenarios = checked;
      return Object.keys(checked).length;
    }
    execute(text) {
      try {
        if (typeof text !== "string" || text.length > 1000) throw new Error("指令需要不超过 1000 字符的文本。");
        const tokens = text.trim().split(/\s+/);
        if (!tokens[0]) throw new Error("输入 help 查看指令。");
        const [command, sub, id, ...rest] = tokens;
        let data, message = "已执行。";
        if (command === "help") { arity(tokens, 1); return { ok: true, message: HELP }; }
        else if (command === "list") {
          arity(tokens, 1, 2); const all = this.list();
          if (sub !== undefined && !OWN(all, sub)) throw new Error("列表类型应为 weapons、skills、dummies、scenarios 或 status。");
          data = sub ? all[sub] : all;
        } else if (command === "give") {
          if (["ammo", "mana"].includes(sub)) { arity(tokens, 3); data = this.give(sub, Number(id)); }
          else if (sub === "weapon") { arity(tokens, 3, 4); data = this.give(sub, id, rest[0] === undefined ? 1 : Number(rest[0])); }
          else if (sub === "skill") { arity(tokens, 3, 5); data = this.give(sub, id, rest[0] === undefined ? 1 : Number(rest[0]), rest[1] === undefined ? 1 : Number(rest[1])); }
          else throw new Error("未知物资类型。");
          message = "物资已发放。";
        } else if (command === "refill") { arity(tokens, 1); data = this.refill(); message = "血量与蓝量已恢复。"; }
        else if (command === "cooldown") { arity(tokens, 2); if (sub !== "clear") throw new Error("用法：cooldown clear"); data = this.clearCooldowns(); message = "武器与技能冷却已清除。"; }
        else if (command === "cheat") { arity(tokens, 3); data = this.setCheat(sub, switchValue(id)); message = `${sub}：${id}`; }
        else if (command === "dummy") {
          if (sub === "spawn") {
            arity(tokens, 2, 6); const preset = id || "standard";
            if (![0, 3].includes(rest.length) || !OWN(PRESETS, preset)) throw new Error("用法：dummy spawn [standard|bighead|tiny|longarm] [x y z]");
            data = this.spawnDummy({ parameters: { ...PRESETS[preset] }, pos: rest.length ? rest.map(Number) : [0, 0, -5] });
            message = `已生成木桩 ${data.id}。`;
          } else if (sub === "clear") { arity(tokens, 2); data = this.clearDummies(); message = `已清除 ${data} 个木桩。`; }
          else if (sub === "remove") { arity(tokens, 3); data = this.removeDummy(id); message = "木桩已移除。"; }
          else if (sub === "set") {
            arity(tokens, 5, 7); const [property, value, ...more] = rest, patch = {};
            if (property === "pos") { arity(rest, 4); patch.pos = [value, ...more].map(Number); }
            else {
              arity(rest, 2);
              if (["head", "torso", "arms", "legs"].includes(property)) patch.parameters = { [{ head: "headScale", torso: "torsoScale", arms: "armLength", legs: "legLength" }[property]]: Number(value) };
              else if (property === "move") { if (!["stationary", "strafe", "inherit"].includes(value)) throw new Error("移动方式应为 stationary、strafe 或 inherit。"); patch.training = { behavior: value === "inherit" ? null : value }; }
              else if (property === "fire") patch.training = { fire: switchValue(value, true) };
              else if (["respawn", "recover"].includes(property)) patch.training = { [property === "respawn" ? "autoRespawn" : "autoRecover"]: switchValue(value) };
              else if (property === "delay") patch.training = { respawnDelay: Number(value) };
              else throw new Error("未知木桩属性，输入 help 查看。");
            }
            data = this.configureDummy(id, patch); message = `木桩 ${id} 已更新。`;
          } else throw new Error("未知 dummy 操作。");
        } else if (command === "status") {
          if (sub === "add") { arity(tokens, 4, 5); data = this.addStatus(id, rest[0], rest[1] === undefined ? 5 : Number(rest[1])); message = "状态已添加。"; }
          else if (sub === "clear") { arity(tokens, 3, 4); data = this.clearStatus(id, rest[0]); message = `移除 ${data} 个状态。`; }
          else throw new Error("用法：status add|clear ...");
        } else if (command === "time") {
          if (sub === "scale") { arity(tokens, 3); data = this.setTimeScale(Number(id)); message = `时间倍率：${data}`; }
          else { arity(tokens, 2); if (sub === "pause") { this.pause(); message = "世界时间已暂停。"; } else if (sub === "resume") { this.resume(); message = "世界时间已恢复。"; } else throw new Error("用法：time scale|pause|resume"); }
        } else if (command === "step") { arity(tokens, 1, 2); data = this.step(sub === undefined ? 1 : Number(sub)); message = `世界时间：${data.toFixed(3)} 秒。`; }
        else if (command === "clear") { arity(tokens, 2); if (sub === "projectiles") data = this.clearProjectiles(); else if (sub === "log") data = this.clearLog(); else throw new Error("用法：clear projectiles|log"); message = `已清除 ${data} 项。`; }
        else if (command === "reset") { arity(tokens, 1); this.reset(); message = "训练场已重置。"; }
        else if (command === "scenario") {
          if (sub === "list") { arity(tokens, 2); data = this.listScenarios(); }
          else { arity(tokens, 3); if (sub === "save") { this.saveScenario(id); message = `实验 ${id} 已保存。`; }
            else if (sub === "load") { this.loadNamedScenario(id); message = `实验 ${id} 已加载；时间、状态、血蓝及弹丸已重置。`; }
            else if (sub === "delete") { this.deleteScenario(id); message = `实验 ${id} 已删除。`; }
            else throw new Error("用法：scenario save|load|list|delete"); }
        } else throw new Error("未知指令，输入 help 查看用法。");
        return { ok: true, message, ...(data === undefined ? {} : { data }) };
      } catch (error) { return { ok: false, message: error.message || "指令执行失败。" }; }
    }
  }
  PixelFPSLab.PRESETS = PRESETS;
  PixelFPSLab.STATUSES = STATUSES;
  PixelFPSLab.STEP = STEP;
  root.PixelFPSLab = PixelFPSLab;
  if (typeof module !== "undefined" && module.exports) module.exports = PixelFPSLab;
})(globalThis);
