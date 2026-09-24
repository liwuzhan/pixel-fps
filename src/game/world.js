(function attachPixelFPS(root) {
  "use strict";
  const Character = root.BlockCharacter || (typeof require === "function" ? require("../character.js") : null);
  if (!Character) throw new Error("PixelFPS needs BlockCharacter.");

  const Content = root.PixelFPSContent || (typeof require === "function" ? require("./content.js") : null);
  const Inventory = root.PixelFPSInventory || (typeof require === "function" ? require("./inventory.js") : null);
  if (!Content || !Inventory) throw new Error("PixelFPS needs content and inventory modules.");

  // These values make the rules visible in the prototype; they are not balance decisions.
  const CONFIG = Object.freeze({ gravity: 18, jumpSpeed: 6.5, baseHP: 100, baseMana: 100,
    baseSpeed: 4.5, pickupRange: 2.2, arena: { minX: -20, maxX: 20, minZ: -24, maxZ: 12 } });
  const WEAPONS = Content.WEAPONS;
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const mul = (a, n) => a.map((v) => v * n);
  const length = (a) => Math.hypot(...a);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const normalized = (a) => mul(a, 1 / (length(a) || 1));
  const bounds = (box, pad = 0) => ({ min: box.center.map((v, i) => v - box.size[i] / 2 - pad), max: box.center.map((v, i) => v + box.size[i] / 2 + pad) });

  /** Earliest segment contact with an AABB, including radius; returns t in [0,1] or null. */
  function segmentBox(from, to, box, radius = 0) {
    const { min, max } = bounds(box, radius);
    let enter = 0, leave = 1;
    for (let axis = 0; axis < 3; axis++) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-12) {
        if (from[axis] < min[axis] || from[axis] > max[axis]) return null;
      } else {
        let first = (min[axis] - from[axis]) / delta, last = (max[axis] - from[axis]) / delta;
        if (first > last) [first, last] = [last, first];
        enter = Math.max(enter, first); leave = Math.min(leave, last);
        if (enter > leave) return null;
      }
    }
    return enter;
  }

  function actorBoxes(actor) {
    return actor.character.parts.map((part) => ({ id: part.id, center: add(part.center, actor.pos), size: [...part.size] }));
  }
  function eye(actor) { return [actor.pos[0], actor.pos[1] + actor.eyeHeight, actor.pos[2]]; }
  function aimDirection(actor) {
    return [Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch)];
  }

  class World {
    constructor(options = {}) {
      this.options = { parameters: Character.normalizeParams(options.parameters || {}), face: options.face || null };
      this._nextId = 1;
      this._nextCombatId = 1;
      this.combatLog = [];
      this.cheats = { infiniteMana: false, infiniteAmmo: false, noCooldown: false };
      this.time = 0;
      this.kills = 0;
      this.targetsMoving = false;
      this.enemyFire = false;
      this.bounds = { min: [-20, 0, -24], max: [20, 12, 12] };
      this.projectiles = [];
      this.effects = [];
      this.events = [];
      this.skills = null;
      this.player = this._actor("player", 0, "玩家", [0, 0, 7], this.options.parameters, this.options.face);
      this.actors = [this.player,
        this._actor("target-1", 1, "标准靶", [-5, 0, -9], Character.DEFAULTS),
        this._actor("target-2", 1, "长腿靶", [0, 0, -15], { ...Character.DEFAULTS, legLength: 1.4 }),
        this._actor("target-3", 1, "大头靶", [5, 0, -10], { ...Character.DEFAULTS, headScale: 1.5 }),
      ];
      for (const actor of this.actors.slice(1)) actor.training = this._training({ behavior: null, fire: null });
      this.obstacles = [
        { id: "cover-left", center: [-7.5, 0.75, -3], size: [3, 1.5, 1], color: [0.27, 0.32, 0.36] },
        { id: "cover-right", center: [7.5, 1.4, -3], size: [3, 2.8, 1], color: [0.3, 0.34, 0.39] },
        { id: "pillar", center: [-2.5, 1.7, -11], size: [1.2, 3.4, 1.2], color: [0.37, 0.37, 0.42] },
        { id: "wall-west", center: [-20.25, 3, -6], size: [0.5, 6, 36], color: [0.2, 0.25, 0.28] },
        { id: "wall-east", center: [20.25, 3, -6], size: [0.5, 6, 36], color: [0.2, 0.25, 0.28] },
        { id: "wall-north", center: [0, 3, -24.25], size: [40.5, 6, 0.5], color: [0.2, 0.25, 0.28] },
        { id: "wall-south", center: [0, 3, 12.25], size: [40.5, 6, 0.5], color: [0.2, 0.25, 0.28] },
      ];
      this.pickups = [];
      this._spawnSupplies();
      this.message("靠近物资按 E 拾取；先拿枪和通用弹药。", "info");
    }

    _actor(id, team, label, pos, parameters, face = null) {
      const character = Character.createCharacter(parameters);
      const head = character.parts.find((part) => part.id === "head");
      const maxHp = CONFIG.baseHP * character.params.torsoScale ** 3;
      const maxMana = CONFIG.baseMana * character.params.headScale ** 3;
      const loadedSkills = Object.keys(root.PixelFPSSkills || {});
      const inventory = Inventory.create(loadedSkills.length ? loadedSkills : ["jetpack", "autoaim", "weaken"]);
      return { id, team, label, pos: [...pos], spawnPos: [...pos], vel: [0, 0, 0], yaw: 0, pitch: 0,
        character, face, maxHp, hp: maxHp, maxMana, mana: maxMana,
        eyeHeight: head.center[1] + head.size[1] * 0.2,
        speed: CONFIG.baseSpeed * character.params.legLength / Character.DEFAULTS.legLength,
        alive: true, grounded: true, statuses: [], nextFireAt: 0, nextEnemyFireAt: 1.5,
        inventory };
    }

    _training(patch = {}, current = {}) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("木桩行为必须是对象。");
      const result = { behavior: "stationary", fire: false, autoRespawn: false, autoRecover: false, respawnDelay: 1, ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(result, key)) throw new TypeError(`未知木桩行为：${key}`);
        if (key === "behavior") {
          if (value !== null && value !== "stationary" && value !== "strafe") throw new TypeError("木桩行为只能是 stationary 或 strafe。");
        } else if (key === "respawnDelay") {
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 3600) throw new TypeError("复活延迟必须是 0 至 3600 秒的有限数字。");
        } else if (typeof value !== "boolean" && !(key === "fire" && value === null)) throw new TypeError(`木桩参数 ${key} 必须是布尔值。`);
        result[key] = value;
      }
      return result;
    }
    _dummySpec(patch, current = null) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("木桩配置必须是对象。");
      const keys = ["label", "parameters", "pos", "training"];
      for (const key of Object.keys(patch)) if (!keys.includes(key)) throw new TypeError(`未知木桩配置：${key}`);
      const label = Object.hasOwn(patch, "label") ? patch.label : current?.label ?? "实验木桩";
      if (typeof label !== "string" || !label.trim() || label.length > 80) throw new TypeError("木桩名称需要 1 至 80 个字符。");
      if (patch.parameters !== undefined && (!patch.parameters || typeof patch.parameters !== "object" || Array.isArray(patch.parameters))) throw new TypeError("木桩体型必须是对象。");
      const character = Character.createCharacter({ ...(current?.character.params || Character.DEFAULTS), ...patch.parameters });
      const pos = Object.hasOwn(patch, "pos") ? patch.pos : current?.spawnPos ?? [0, 0, -8];
      if (!Array.isArray(pos) || pos.length !== 3 || pos.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError("木桩位置需要三个有限数字。");
      if (pos[1] < 0 || pos[1] > this.bounds.max[1]) throw new RangeError("木桩高度超出训练场范围。");
      for (const axis of [0, 2]) if (pos[axis] + character.bounds.min[axis] < this.bounds.min[axis] || pos[axis] + character.bounds.max[axis] > this.bounds.max[axis]) throw new RangeError("木桩完整体型必须位于训练场边界内。");
      const training = this._training(Object.hasOwn(patch, "training") ? patch.training : {}, current?.training);
      return { label: label.trim(), character, pos: [...pos], training };
    }
    spawnDummy(options = {}) {
      if (this.actors.filter((actor) => actor !== this.player).length >= 64) throw new RangeError("实验环境最多同时放置 64 个木桩。");
      const spec = this._dummySpec(options);
      const actor = this._actor(`dummy-${this._nextId++}`, 1, spec.label, spec.pos, spec.character.params);
      actor.training = spec.training;
      this.actors.push(actor);
      this.recordCombat("dummy-spawn", { targetId: actor.id, label: actor.label });
      return actor;
    }
    configureDummy(id, patch = {}) {
      const actor = this.findActor(id);
      if (!actor || actor === this.player) throw new Error("找不到这个木桩。");
      // Validate the complete proposal before mutating the existing actor.
      const spec = this._dummySpec(patch, actor);
      const rebuilt = this._actor(actor.id, actor.team, spec.label, spec.pos, spec.character.params, actor.face);
      actor.label = spec.label;
      actor.training = spec.training;
      if (patch.parameters !== undefined) {
        actor.hp = actor.alive ? rebuilt.maxHp * Math.max(0, Math.min(1, actor.hp / actor.maxHp)) : 0;
        actor.mana = rebuilt.maxMana * Math.max(0, Math.min(1, actor.mana / actor.maxMana));
        for (const key of ["character", "maxHp", "maxMana", "eyeHeight", "speed"]) actor[key] = rebuilt[key];
      }
      if (patch.pos !== undefined || patch.parameters !== undefined) {
        actor.pos = [...spec.pos]; actor.spawnPos = [...spec.pos]; actor.vel = [0, 0, 0];
      }
      if (!actor.alive) actor.respawnAt = spec.training.autoRespawn ? this.time + spec.training.respawnDelay : null;
      this.recordCombat("dummy-configure", { targetId: actor.id, label: actor.label });
      return actor;
    }
    removeDummy(id) {
      const actor = this.findActor(id);
      if (!actor || actor === this.player) return false;
      this.removeStatus(actor, undefined, "dummy-removed");
      this.actors.splice(this.actors.indexOf(actor), 1);
      this.projectiles = this.projectiles.filter((projectile) => projectile.ownerId !== id);
      this.recordCombat("dummy-remove", { targetId: id });
      return true;
    }
    clearDummies() {
      const ids = this.actors.filter((actor) => actor !== this.player).map((actor) => actor.id);
      for (const id of ids) this.removeDummy(id);
      return ids.length;
    }
    recordCombat(type, data = {}) {
      const entry = { ...data, id: this._nextCombatId++, time: this.time, type };
      this.combatLog.push(entry);
      if (this.combatLog.length > 500) this.combatLog.splice(0, this.combatLog.length - 500);
      return entry;
    }

    _spawnSupplies() {
      const supply = (type, label, pos, extra = {}) => {
        const item = { id: `pickup-${this._nextId++}`, type, label, pos, ...extra };
        if (type === "weapon") item.weapon = { id: `weapon-${this._nextId++}`, type: item.weaponType };
        this.pickups.push(item);
      };
      supply("weapon", "手枪", [-0.6, 0.35, 5.6], { weaponType: "pistol" });
      supply("ammo", "通用弹药 × 120", [0.6, 0.35, 5.6], { amount: 120 });
      supply("weapon", "小刀", [-3, 0.35, 5.2], { weaponType: "knife" });
      supply("weapon", "步枪", [3, 0.35, 5.2], { weaponType: "rifle" });
      supply("weapon", "火箭筒", [6.3, 0.35, 5.2], { weaponType: "rocket" });
      supply("mana", "蓝瓶 × 3", [4.6, 0.35, 5.2], { amount: 3 });
      supply("ammo", "通用弹药 × 240", [-4.6, 0.35, 5.2], { amount: 240 });
      for (const [index, skillId] of ["jetpack", "autoaim", "weaken"].entries()) {
        const label = { jetpack: "弹射背包", autoaim: "自瞄（消耗品）", weaken: "虚弱榴弹" }[skillId];
        supply("skill", `${label} × 3`, [(index - 1) * 2.5, 0.35, 2.7], { skillId, amount: 3, level: 1 });
      }
    }

    actorBoxes(actor) { return actorBoxes(actor); }
    eye(actor = this.player) { return eye(actor); }
    aimDirection(actor = this.player) { return aimDirection(actor); }
    findActor(id) { return this.actors.find((actor) => actor.id === id) || null; }
    enemiesOf(actor = this.player) { return this.actors.filter((other) => other.alive && other.team !== actor.team); }
    message(text, type = "info") {
      this.events.push({ time: this.time, text, type });
      if (this.events.length > 30) this.events.shift();
      return text;
    }
    addEffect(effect) {
      const value = { id: `effect-${this._nextId++}`, expiresAt: this.time + 0.25, ...effect };
      if (effect.duration !== undefined) value.expiresAt = this.time + effect.duration;
      this.effects.push(value);
      return value;
    }
    lineOfSight(from, to) { return !this.obstacles.some((box) => segmentBox(from, to, box) !== null); }

    _pickupOrigin() {
      // Ground reach, rather than eye height, keeps small items accessible to tall characters.
      return [this.player.pos[0], this.player.pos[1] + 0.35, this.player.pos[2]];
    }
    nearestPickup() {
      let nearest = null, distance = CONFIG.pickupRange;
      const from = this._pickupOrigin();
      for (const item of this.pickups) {
        if ([0, 2].some((axis) => item.pos[axis] < this.bounds.min[axis] || item.pos[axis] > this.bounds.max[axis])) continue;
        const current = Math.hypot(item.pos[0] - this.player.pos[0], item.pos[2] - this.player.pos[2]);
        if (current < distance && Math.abs(item.pos[1] - this.player.pos[1]) < 2 && this.lineOfSight(from, item.pos)) {
          nearest = item; distance = current;
        }
      }
      return nearest;
    }
    _recordTransfer(type, item) {
      const data = { sourceId: this.player.id, itemId: item.id, itemType: item.type, amount: item.type === "weapon" ? 1 : item.amount };
      if (item.type === "weapon") { data.weaponId = item.weapon?.type || item.weaponType; data.weaponInstanceId = item.weapon?.id ?? null; }
      if (item.type === "skill") { data.skillId = item.skillId; data.level = item.level; }
      this.recordCombat(type, data);
      this.events.push({ ...data, time: this.time, type, text: `${type === "pickup" ? "拾取" : "丢弃"}：${item.label}` });
      if (this.events.length > 30) this.events.shift();
      return this.events.at(-1).text;
    }
    interact() {
      if (!this.player.alive) return { ok: false, message: "倒下后需要先复位。" };
      const item = this.nearestPickup(), inventory = this.player.inventory;
      if (!item) return { ok: false, message: this.message("附近没有可拾取的物资。", "info") };
      try {
        if (item.type === "weapon") {
          const weapon = item.weapon || { id: `weapon-${this._nextId}`, type: item.weaponType };
          Inventory.grantWeapon(inventory, weapon);
          Inventory.selectWeapon(inventory, inventory.weapons.length - 1);
          if (!item.weapon) this._nextId++;
          item.weapon = weapon;
        } else if (item.type === "ammo" || item.type === "mana") {
          Inventory.grantResource(inventory, item.type, item.amount);
        } else if (item.type === "skill") {
          if (!this._skillDefinition(item.skillId) && !Object.hasOwn(inventory.skills, item.skillId)) throw new Error("未知技能。");
          Inventory.grantSkill(inventory, item.skillId, item.amount ?? 1, item.level ?? 1);
        } else throw new Error("未知物资。");
      } catch (error) { return { ok: false, message: this.message(error.message, "info") }; }
      this.pickups.splice(this.pickups.indexOf(item), 1);
      return { ok: true, message: this._recordTransfer("pickup", item), item };
    }
    _dropPosition() {
      const from = this._pickupOrigin(), radius = 0.18;
      const direction = [Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw)];
      // Shorter candidates remain on the player's side of a nearby wall. Never teleport through it.
      for (const distance of [1.2, 0.85, 0.45, 0]) {
        const pos = add(from, mul(direction, distance));
        if ([0, 2].some((axis) => pos[axis] - radius < this.bounds.min[axis] || pos[axis] + radius > this.bounds.max[axis])) continue;
        if (this.obstacles.some((box) => segmentBox(from, pos, box, radius) !== null)) continue;
        return pos;
      }
      return null;
    }
    dropItem(request) {
      const fail = (message) => ({ ok: false, message: this.message(message, "info") });
      if (!this.player.alive) return fail("倒下后需要先复位。");
      if (!request || typeof request !== "object" || Array.isArray(request)) return fail("丢弃参数必须是对象。");
      const allowed = { weapon: ["kind", "weaponId"], skill: ["kind", "skillId", "level", "amount"], ammo: ["kind", "amount"], mana: ["kind", "amount"] };
      if (typeof request.kind !== "string" || !Object.hasOwn(allowed, request.kind) || Object.keys(request).some((key) => !allowed[request.kind].includes(key))) return fail("丢弃参数无效。");
      const pos = this._dropPosition();
      if (!pos) return fail("脚边没有可以放置物资的位置。");
      const inventory = this.player.inventory;
      let item;
      try {
        if (request.kind === "weapon") {
          const existing = inventory.weapons.find((weapon) => weapon.id === request.weaponId);
          if (existing && !Object.hasOwn(WEAPONS, existing.type)) throw new Error("未知武器类型。");
          const weapon = Inventory.takeWeapon(inventory, request.weaponId);
          item = { type: "weapon", weapon, weaponType: weapon.type, label: WEAPONS[weapon.type].label };
        } else if (request.kind === "skill") {
          const taken = Inventory.takeSkill(inventory, request.skillId, request.amount === undefined ? 1 : request.amount, request.level);
          const definition = this._skillDefinition(request.skillId);
          item = { type: "skill", ...taken, label: `${definition?.name || request.skillId} · ${taken.level} 级 × ${taken.amount}` };
        } else {
          const amount = Inventory.takeResource(inventory, request.kind, request.amount);
          item = { type: request.kind, amount, label: `${request.kind === "ammo" ? "通用弹药" : "蓝瓶"} × ${amount}` };
        }
      } catch (error) { return fail(error.message); }
      item.id = `pickup-${this._nextId++}`;
      item.pos = pos;
      this.pickups.push(item);
      // Inventory transfer does not touch the skill runner's cooldowns or active instances.
      return { ok: true, message: this._recordTransfer("drop", item), item };
    }
    selectWeapon(index) {
      try { return Inventory.selectWeapon(this.player.inventory, index); }
      catch { return false; }
    }
    useManaPotion() {
      const player = this.player;
      if (!player.alive || player.mana >= player.maxMana) return false;
      try { Inventory.takeResource(player.inventory, "mana", 1); }
      catch { return false; }
      const restored = Content.RESOURCES.mana.restore;
      player.mana = Math.min(player.maxMana, player.mana + restored);
      this.message(`使用蓝瓶：恢复 ${restored} 蓝量。`, "heal");
      return true;
    }
    _skillDefinition(id) {
      const definitions = this.skills?.definitions || root.PixelFPSSkills;
      return definitions && Object.hasOwn(definitions, id) ? definitions[id] : null;
    }
    upgradeSkill(id) {
      const definition = this._skillDefinition(id);
      if ((definition?.kind || (id === "autoaim" ? "ultimate" : "normal")) === "ultimate") {
        this.message("本轮验证只合成普通技能。", "info"); return false;
      }
      try {
        const result = Inventory.mergeSkill(this.player.inventory, id);
        this.message(`技能合成：${definition?.name || id} → ${result.level} 级`, "upgrade");
        return true;
      } catch (error) { this.message(error.message, "info"); return false; }
    }
    consumeSkill(id, amount = 1) {
      try { return Inventory.consumeSkill(this.player.inventory, id, amount); }
      catch { return false; }
    }

    applyStatus(actor, type, duration, sourceId = null, data = {}) {
      if (!actor || !actor.alive || typeof type !== "string" || !type || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(this.time + duration)) return null;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      for (const key of ["multiplier", "damageMultiplier"]) if (Object.hasOwn(data, key) && (!Number.isFinite(data[key]) || data[key] < 0)) return null;
      const status = { id: `status-${this._nextId++}`, type, expiresAt: this.time + duration, sourceId, data: { ...data } };
      actor.statuses.push(status);
      this.recordCombat("status-add", { sourceId, targetId: actor.id, statusId: status.id, statusType: type, expiresAt: status.expiresAt, data: { ...status.data } });
      return status;
    }
    removeStatus(actor, idOrType, reason = "removed") {
      if (!actor) return 0;
      const removed = actor.statuses.filter((status) => idOrType === undefined || status.id === idOrType || status.type === idOrType);
      const ids = new Set(removed.map((status) => status.id));
      actor.statuses = actor.statuses.filter((status) => !ids.has(status.id));
      for (const status of removed) this.recordCombat(reason === "expired" ? "status-expire" : "status-remove", {
        sourceId: status.sourceId, targetId: actor.id, statusId: status.id, statusType: status.type, reason, expiresAt: status.expiresAt,
      });
      return removed.length;
    }
    hasStatus(actor, type) { return actor.statuses.some((status) => status.type === type && status.expiresAt > this.time); }
    damage(actor, amount, source = null) {
      if (!actor || !Number.isFinite(amount) || !(amount > 0)) return 0;
      const sourceId = (typeof source === "string" ? source : source?.ownerId || source?.sourceId || source?.id) ?? null;
      const attacker = this.findActor(sourceId);
      let multiplier = 1;
      const modifiers = [];
      if (attacker) for (const status of attacker.statuses) {
        if (status.type === "weaken" && status.expiresAt > this.time) {
          const factor = status.data.damageMultiplier ?? 0.45;
          if (Number.isFinite(factor) && factor >= 0) {
            multiplier = Math.min(multiplier, factor);
            modifiers.push({ statusId: status.id, statusType: status.type, sourceId: status.sourceId, multiplier: factor });
          }
        }
      }
      const hpBefore = actor.hp, modifiedDamage = amount * multiplier;
      const blockedReason = !actor.alive ? "dead" : this.hasStatus(actor, "invulnerable") ? "invulnerable" : null;
      const actual = blockedReason ? 0 : Math.min(actor.hp, modifiedDamage);
      actor.hp = Math.max(0, actor.hp - actual);
      const fatal = !blockedReason && hpBefore > 0 && actor.hp <= 0;
      this.recordCombat("damage", { sourceId, targetId: actor.id, weaponId: source?.weaponId ?? null, partId: source?.partId ?? null,
        baseDamage: amount, multiplier, modifiers, modifiedDamage, actualDamage: actual, hpBefore, hpAfter: actor.hp, blockedReason, fatal });
      if (fatal) {
        actor.alive = false;
        actor.vel = [0, 0, 0];
        actor.respawnAt = actor.training?.autoRespawn ? this.time + actor.training.respawnDelay : null;
        if (actor !== this.player && attacker?.team === this.player.team) this.kills++;
        this.message(actor === this.player ? "你已倒下。点击「重新开始」复位训练场。" : `${actor.label}已击倒。`, "death");
      } else if (actual > 0 && actor.training?.autoRecover) {
        const recovered = actor.maxHp - actor.hp;
        actor.hp = actor.maxHp;
        this.recordCombat("recover", { targetId: actor.id, amount: recovered, hpAfter: actor.hp });
      }
      return actual;
    }

    spawnProjectile(options) {
      if (!options || typeof options !== "object") throw new TypeError("投射物参数必须是对象。");
      for (const key of ["pos", "vel"]) if (!Array.isArray(options[key]) || options[key].length !== 3 || options[key].some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError(`投射物 ${key} 需要三个有限数字。`);
      for (const key of ["damage", "radius", "gravity", "lifetime"]) if (options[key] !== undefined && (typeof options[key] !== "number" || !Number.isFinite(options[key]) || ((key !== "gravity") && options[key] < 0))) throw new TypeError(`投射物 ${key} 数值无效。`);
      if (options.onHit != null && typeof options.onHit !== "function") throw new TypeError("投射物命中处理必须是函数。");
      const projectile = { id: `projectile-${this._nextId++}`, pos: [...options.pos], previousPos: [...options.pos],
        vel: [...options.vel], ownerId: options.ownerId, team: options.team ?? this.findActor(options.ownerId)?.team,
        weaponId: options.weaponId ?? null, damage: options.damage || 0, radius: options.radius ?? 0.045, gravity: options.gravity ?? 0,
        expiresAt: this.time + (options.lifetime ?? 4), color: options.color || [1, 0.8, 0.3], onHit: options.onHit || null };
      this.projectiles.push(projectile);
      return projectile;
    }
    fire() {
      const player = this.player;
      if (!player.alive || this.time < player.nextFireAt || this.hasStatus(player, "disarmed") || this.hasStatus(player, "stun")) return false;
      const item = player.inventory.weapons[player.inventory.selected], weapon = item && WEAPONS[item.type];
      if (!weapon) return false;
      if (!this.cheats.infiniteAmmo && weapon.ammoCost > 0) {
        try { Inventory.takeResource(player.inventory, "ammo", weapon.ammoCost); }
        catch (_) { return false; }
      }
      player.nextFireAt = this.time + weapon.interval;
      const from = eye(player), direction = aimDirection(player);
      if (weapon.melee) {
        const to = add(from, mul(direction, player.character.params.armLength + 0.45));
        const hit = this._firstHit(from, to, 0.11, player.id, player.team);
        if (hit) {
          if (hit.actor) this.damage(hit.actor, weapon.damage, { ownerId: player.id, weaponId: item.type, partId: hit.partId });
          this.addEffect({ type: "hit", pos: hit.pos, color: hit.actor ? [1, 0.25, 0.15] : [0.8, 0.8, 0.8] });
        }
        this.addEffect({ type: "melee", ownerId: player.id, weaponId: item.type, pos: add(from, mul(direction, 0.6)), duration: 0.12, color: weapon.color });
      } else {
        const explosive = Number.isFinite(weapon.blastRadius) && weapon.blastRadius > 0;
        this.spawnProjectile({ pos: from, vel: mul(direction, weapon.speed), ownerId: player.id, team: player.team,
          weaponId: item.type, damage: explosive ? 0 : weapon.damage, color: weapon.color,
          radius: weapon.projectileRadius, lifetime: weapon.lifetime,
          onHit: explosive ? (hit) => this.explode({ pos: hit.pos, radius: weapon.blastRadius, damage: weapon.damage,
            ownerId: player.id, team: player.team, weaponId: item.type, directHit: hit }) : null });
      }
      this.addEffect({ type: "shot", ownerId: player.id, weaponId: item.type, pos: add(from, mul(direction, 0.35)), duration: 0.06, color: weapon.color });
      return true;
    }

    explode({ pos, radius, damage, ownerId, team, weaponId = null, directHit = null }) {
      if (!Array.isArray(pos) || pos.length !== 3 || pos.some((value) => !Number.isFinite(value)) || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(damage) || damage < 0) throw new TypeError("爆炸参数无效。");
      const sourceTeam = team ?? this.findActor(ownerId)?.team;
      const hits = [];
      for (const actor of this.actors) {
        if (!actor.alive || actor.id === ownerId || actor.team === sourceTeam) continue;
        // The real six boxes determine blast reach too; the closest visible part is sufficient.
        const reachable = actorBoxes(actor).some((box) => {
          const range = bounds(box);
          const closest = pos.map((value, axis) => Math.max(range.min[axis], Math.min(range.max[axis], value)));
          return length(sub(closest, pos)) <= radius && this.lineOfSight(pos, closest);
        });
        if (actor !== directHit?.actor && !reachable) continue;
        const partId = actor === directHit?.actor ? directHit.partId : "blast";
        const actualDamage = this.damage(actor, damage, { ownerId, weaponId, partId });
        hits.push({ actorId: actor.id, partId, actualDamage });
      }
      this.addEffect({ type: "explosion", pos: [...pos], radius, duration: 0.55, color: [1, 0.45, 0.12] });
      this.recordCombat("explosion", { sourceId: ownerId, weaponId, pos: [...pos], radius, hits: hits.map((hit) => ({ ...hit })) });
      return hits;
    }

    _firstHit(from, to, radius, ownerId, team) {
      let best = null;
      const check = (box, actor = null, obstacle = null) => {
        const fraction = segmentBox(from, to, box, radius);
        if (fraction !== null && (!best || fraction < best.fraction)) {
          best = { fraction, actor, obstacle, partId: actor ? box.id : null, pos: add(from, mul(sub(to, from), fraction)) };
        }
      };
      // Obstacle wins ties so an actor touching a wall cannot be hit through it.
      for (const obstacle of this.obstacles) check(obstacle, null, obstacle);
      if (to[1] <= radius) {
        const fraction = from[1] <= radius ? 0 : (from[1] - radius) / (from[1] - to[1]);
        if (!best || fraction < best.fraction) best = { fraction, actor: null, obstacle: { id: "floor" }, partId: null,
          pos: add(from, mul(sub(to, from), fraction)) };
      }
      for (const actor of this.actors) {
        if (!actor.alive || actor.id === ownerId || actor.team === team) continue;
        for (const box of actorBoxes(actor)) check(box, actor, null);
      }
      return best;
    }
    _updateProjectiles(dt) {
      const active = this.projectiles;
      this.projectiles = [];
      for (const projectile of active) {
        if (projectile.expiresAt <= this.time) continue;
        projectile.previousPos = [...projectile.pos];
        projectile.vel[1] -= projectile.gravity * dt;
        const to = add(projectile.pos, mul(projectile.vel, dt));
        const hit = this._firstHit(projectile.pos, to, projectile.radius, projectile.ownerId, projectile.team);
        if (hit) {
          projectile.pos = hit.pos;
          if (hit.actor && projectile.damage > 0) this.damage(hit.actor, projectile.damage, { ownerId: projectile.ownerId, weaponId: projectile.weaponId, partId: hit.partId });
          this.addEffect({ type: "hit", pos: [...hit.pos], color: hit.actor ? [1, 0.3, 0.12] : [0.85, 0.85, 0.7], duration: 0.17 });
          if (projectile.onHit) projectile.onHit({ world: this, projectile, ...hit });
        } else {
          projectile.pos = to;
          this.projectiles.push(projectile);
        }
      }
    }

    _moveAxis(actor, axis, displacement) {
      if (!displacement) return;
      let permitted = displacement;
      const boxes = actorBoxes(actor), epsilon = 0.00001;
      for (const body of boxes) {
        const a = bounds(body);
        for (const obstacle of this.obstacles) {
          const b = bounds(obstacle);
          const otherAxes = [0, 1, 2].filter((value) => value !== axis);
          if (!otherAxes.every((other) => a.max[other] > b.min[other] + epsilon && a.min[other] < b.max[other] - epsilon)) continue;
          if (displacement > 0 && a.max[axis] <= b.min[axis] + epsilon) permitted = Math.min(permitted, Math.max(0, b.min[axis] - a.max[axis] - epsilon));
          if (displacement < 0 && a.min[axis] >= b.max[axis] - epsilon) permitted = Math.max(permitted, Math.min(0, b.max[axis] - a.min[axis] + epsilon));
        }
      }
      actor.pos[axis] += permitted;
      if (Math.abs(permitted - displacement) > 0.000001) {
        actor.vel[axis] = 0;
        if (axis === 1 && displacement < 0) actor.grounded = true;
      }
      if (axis === 1 && actor.pos[1] < 0) { actor.pos[1] = 0; actor.vel[1] = 0; actor.grounded = true; }
    }
    _movePlayer(dt, input) {
      const actor = this.player;
      if (!actor.alive) return;
      const immobile = this.hasStatus(actor, "stun") || this.hasStatus(actor, "root");
      let forward = immobile ? 0 : Number(input.forward || 0), right = immobile ? 0 : Number(input.right || 0);
      const inputSize = Math.hypot(forward, right);
      if (inputSize > 1) { forward /= inputSize; right /= inputSize; }
      let speed = actor.speed * (input.sprint ? 1.5 : 1);
      for (const status of actor.statuses) if (status.type === "slow") speed *= status.data.multiplier ?? 0.5;
      const targetX = (Math.sin(actor.yaw) * forward + Math.cos(actor.yaw) * right) * speed;
      const targetZ = (-Math.cos(actor.yaw) * forward + Math.sin(actor.yaw) * right) * speed;
      // Acceleration leaves script-applied horizontal impulses visible instead of replacing them.
      const blend = 1 - Math.exp(-(actor.grounded ? 12 : 3) * dt);
      actor.vel[0] += (targetX - actor.vel[0]) * blend;
      actor.vel[2] += (targetZ - actor.vel[2]) * blend;
      if (input.jump && actor.grounded && !immobile) { actor.vel[1] = CONFIG.jumpSpeed; actor.grounded = false; }
      actor.vel[1] -= CONFIG.gravity * dt;
      actor.grounded = false;
      // Substeps prevent diagonal corner clipping at large movement speeds.
      const steps = Math.max(1, Math.ceil(Math.hypot(...actor.vel) * dt / 0.2));
      for (let step = 0; step < steps; step++) {
        this._moveAxis(actor, 0, actor.vel[0] * dt / steps);
        this._moveAxis(actor, 2, actor.vel[2] * dt / steps);
        // Constrain the complete body even above the walls. Do this before gravity
        // so a temporarily out-of-bounds body cannot land on the wall's top.
        for (const axis of [0, 2]) {
          const minimum = this.bounds.min[axis] - actor.character.bounds.min[axis];
          const maximum = this.bounds.max[axis] - actor.character.bounds.max[axis];
          const clamped = Math.max(minimum, Math.min(maximum, actor.pos[axis]));
          if (clamped !== actor.pos[axis]) { actor.pos[axis] = clamped; actor.vel[axis] = 0; }
        }
        this._moveAxis(actor, 1, actor.vel[1] * dt / steps);
      }
    }
    _updateTargets(dt) {
      for (const [index, actor] of this.actors.slice(1).entries()) {
        if (!actor.alive) {
          if (actor.training?.autoRespawn && actor.respawnAt !== null && actor.respawnAt <= this.time) this._restoreDummy(actor, "respawn");
          else continue;
        }
        const moving = actor.training?.behavior == null ? this.targetsMoving : actor.training.behavior === "strafe";
        const firing = actor.training?.fire == null ? this.enemyFire : actor.training.fire;
        if (moving && !this.hasStatus(actor, "root") && !this.hasStatus(actor, "stun")) {
          const minimum = this.bounds.min[0] - actor.character.bounds.min[0], maximum = this.bounds.max[0] - actor.character.bounds.max[0];
          const destination = Math.max(minimum, Math.min(maximum, actor.spawnPos[0] + Math.sin(this.time * 0.8 + index) * 1.7));
          this._moveAxis(actor, 0, destination - actor.pos[0]);
        }
        if (!firing || !this.player.alive || this.time < actor.nextEnemyFireAt || this.hasStatus(actor, "stun") || this.hasStatus(actor, "disarmed")) continue;
        actor.nextEnemyFireAt = this.time + 1.4;
        const from = eye(actor), to = eye(this.player);
        if (!this.lineOfSight(from, to)) continue;
        const direction = normalized(sub(to, from));
        this.spawnProjectile({ pos: from, vel: mul(direction, 22), ownerId: actor.id, team: actor.team, weaponId: "training-gun", damage: 9,
          color: [1, 0.28, 0.2], radius: 0.065, lifetime: 4 });
      }
    }
    update(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.25);
      this.time += dt;
      for (const actor of this.actors) for (const status of [...actor.statuses]) if (status.expiresAt <= this.time) this.removeStatus(actor, status.id, "expired");
      if (this.skills?.update) this.skills.update(dt);
      this._movePlayer(dt, input);
      if (input.fire) this.fire();
      this._updateTargets(dt);
      this._updateProjectiles(dt);
      this.effects = this.effects.filter((effect) => effect.expiresAt > this.time);
    }
    _restoreDummy(actor, reason = "reset") {
      actor.pos = [...actor.spawnPos]; actor.vel = [0, 0, 0]; actor.alive = true; actor.hp = actor.maxHp; actor.mana = actor.maxMana;
      actor.grounded = true; actor.respawnAt = null; actor.nextEnemyFireAt = this.time + 1.5;
      this.removeStatus(actor, undefined, reason);
      this.recordCombat(reason === "respawn" ? "respawn" : "dummy-reset", { targetId: actor.id, hpAfter: actor.hp });
    }
    resetTargets() {
      this.kills = 0;
      this.projectiles = [];
      for (const actor of this.actors.slice(1)) {
        this._restoreDummy(actor);
      }
      this.message("训练靶已复位。", "info");
    }
    resetPlayer() {
      const player = this.player;
      player.pos = [...player.spawnPos]; player.vel = [0, 0, 0]; player.hp = player.maxHp; player.mana = player.maxMana;
      player.alive = true; player.grounded = true; this.removeStatus(player, undefined, "reset"); player.nextFireAt = this.time;
    }
    reset() {
      this.resetPlayer(); this.resetTargets();
      this.effects = [];
      this.skills?.dispose?.();
      this.cheats = { infiniteMana: false, infiniteAmmo: false, noCooldown: false };
      this.combatLog = [];
      this.message("训练场已复位，保留已拾取的物品。", "info");
    }
  }
  World.WEAPONS = WEAPONS;
  World.CONFIG = CONFIG;
  const api = Object.assign(root.PixelFPS || {}, { World, CONFIG, WEAPONS, actorBoxes, eye, aimDirection, segmentBox });
  root.PixelFPS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
