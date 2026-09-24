(function attachPixelFPS(root) {
  "use strict";
  const Character = root.BlockCharacter || (typeof require === "function" ? require("../character.js") : null);
  if (!Character) throw new Error("PixelFPS needs BlockCharacter.");

  // These values make the rules visible in the prototype; they are not balance decisions.
  const CONFIG = Object.freeze({ gravity: 18, jumpSpeed: 6.5, baseHP: 100, baseMana: 100,
    baseSpeed: 4.5, pickupRange: 2.2, arena: { minX: -20, maxX: 20, minZ: -24, maxZ: 12 } });
  const WEAPONS = Object.freeze({
    pistol: Object.freeze({ label: "手枪", damage: 26, speed: 95, interval: 0.28, ammoCost: 1, color: [1, 0.83, 0.3] }),
    rifle: Object.freeze({ label: "步枪", damage: 16, speed: 140, interval: 0.11, ammoCost: 1, color: [0.4, 0.95, 1] }),
    knife: Object.freeze({ label: "小刀", damage: 42, interval: 0.45, ammoCost: 0, melee: true, color: [0.95, 0.95, 1] }),
  });
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
      const skills = Object.fromEntries(["jetpack", "autoaim", "weaken"].map((name) => [name, { level: 1, count: 0, levels: {} }]));
      return { id, team, label, pos: [...pos], spawnPos: [...pos], vel: [0, 0, 0], yaw: 0, pitch: 0,
        character, face, maxHp, hp: maxHp, maxMana, mana: maxMana,
        eyeHeight: head.center[1] + head.size[1] * 0.2,
        speed: CONFIG.baseSpeed * character.params.legLength / Character.DEFAULTS.legLength,
        alive: true, grounded: true, statuses: [], nextFireAt: 0, nextEnemyFireAt: 1.5,
        inventory: { weapons: [], selected: 0, ammo: 0, manaPotions: 0, skills } };
    }

    _spawnSupplies() {
      const supply = (type, label, pos, extra = {}) => this.pickups.push({ id: `pickup-${this._nextId++}`, type, label, pos, ...extra });
      supply("weapon", "手枪", [-0.6, 0.35, 5.6], { weaponType: "pistol" });
      supply("ammo", "通用弹药 × 120", [0.6, 0.35, 5.6], { amount: 120 });
      supply("weapon", "小刀", [-3, 0.35, 5.2], { weaponType: "knife" });
      supply("weapon", "步枪", [3, 0.35, 5.2], { weaponType: "rifle" });
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

    nearestPickup() {
      let nearest = null, distance = CONFIG.pickupRange;
      for (const item of this.pickups) {
        const current = Math.hypot(item.pos[0] - this.player.pos[0], item.pos[2] - this.player.pos[2]);
        // Pickups are reached from the feet so very tall bodies can still collect ground supplies.
        if (current < distance && Math.abs(item.pos[1] - this.player.pos[1]) < 2) {
          nearest = item; distance = current;
        }
      }
      return nearest;
    }
    interact() {
      if (!this.player.alive) return { ok: false, message: "倒下后需要先复位。" };
      const item = this.nearestPickup(), inventory = this.player.inventory;
      if (!item) return { ok: false, message: this.message("附近没有可拾取的物资。", "info") };
      if (item.type === "weapon") {
        inventory.weapons.push({ id: `weapon-${this._nextId++}`, type: item.weaponType });
        inventory.selected = inventory.weapons.length - 1;
      } else if (item.type === "ammo") inventory.ammo += item.amount;
      else if (item.type === "mana") inventory.manaPotions += item.amount;
      else if (item.type === "skill") {
        const skill = inventory.skills[item.skillId];
        if (!skill) return { ok: false, message: "未知技能。" };
        const level = item.level || 1, amount = item.amount || 1;
        skill.levels[level] = (skill.levels[level] || 0) + amount;
        skill.count += amount;
        skill.level = Math.max(skill.level, level);
      } else return { ok: false, message: "未知物资。" };
      this.pickups.splice(this.pickups.indexOf(item), 1);
      return { ok: true, message: this.message(`拾取：${item.label}`, "pickup"), item };
    }
    selectWeapon(index) {
      if (!Number.isInteger(index) || !this.player.inventory.weapons[index]) return false;
      this.player.inventory.selected = index;
      return true;
    }
    useManaPotion() {
      const player = this.player;
      if (!player.alive || player.inventory.manaPotions <= 0 || player.mana >= player.maxMana) return false;
      player.inventory.manaPotions--;
      // Each bottle restores 60 units rather than enlarging the character's mana capacity.
      player.mana = Math.min(player.maxMana, player.mana + 60);
      this.message("使用蓝瓶：恢复 60 蓝量。", "heal");
      return true;
    }
    upgradeSkill(id) {
      const skill = this.player.inventory.skills[id];
      if (!skill || id === "autoaim") { this.message("本轮验证只合成普通技能。", "info"); return false; }
      const tiers = Object.entries(skill.levels).filter(([, amount]) => amount >= 3).map(([level]) => Number(level)).sort((a, b) => a - b);
      if (!tiers.length) { this.message("合成需要三份同名、同级普通技能。", "info"); return false; }
      const tier = tiers[0];
      skill.levels[tier] -= 3;
      if (!skill.levels[tier]) delete skill.levels[tier];
      skill.levels[tier + 1] = (skill.levels[tier + 1] || 0) + 1;
      skill.count -= 2;
      skill.level = Math.max(...Object.keys(skill.levels).map(Number));
      this.message(`技能合成：${id === "jetpack" ? "弹射背包" : "虚弱榴弹"} → ${tier + 1} 级`, "upgrade");
      return true;
    }
    consumeSkill(id, amount = 1) {
      const skill = this.player.inventory.skills[id];
      if (!skill || !Number.isInteger(amount) || amount <= 0 || skill.count < amount) return false;
      let remaining = amount;
      const tiers = Object.keys(skill.levels).map(Number).sort((a, b) => b - a);
      if (tiers.reduce((sum, tier) => sum + skill.levels[tier], 0) < amount) return false;
      for (const tier of tiers) {
        const used = Math.min(remaining, skill.levels[tier]);
        skill.levels[tier] -= used;
        remaining -= used;
        if (!skill.levels[tier]) delete skill.levels[tier];
        if (!remaining) break;
      }
      skill.count -= amount;
      skill.level = Math.max(1, ...Object.keys(skill.levels).map(Number));
      return true;
    }

    applyStatus(actor, type, duration, sourceId = null, data = {}) {
      if (!actor || !actor.alive || !Number.isFinite(duration) || duration <= 0) return null;
      const status = { id: `status-${this._nextId++}`, type, expiresAt: this.time + duration, sourceId, data: { ...data } };
      actor.statuses.push(status);
      return status;
    }
    hasStatus(actor, type) { return actor.statuses.some((status) => status.type === type && status.expiresAt > this.time); }
    damage(actor, amount, source = null) {
      if (!actor || !actor.alive || !(amount > 0) || this.hasStatus(actor, "invulnerable")) return 0;
      const sourceId = typeof source === "string" ? source : source?.ownerId || source?.id;
      const attacker = this.findActor(sourceId);
      let multiplier = 1;
      if (attacker) for (const status of attacker.statuses) {
        if (status.type === "weaken" && status.expiresAt > this.time) multiplier = Math.min(multiplier, status.data.damageMultiplier ?? 0.45);
      }
      const actual = Math.min(actor.hp, amount * multiplier);
      actor.hp = Math.max(0, actor.hp - actual);
      if (actor.hp <= 0) {
        actor.alive = false;
        actor.vel = [0, 0, 0];
        if (actor !== this.player && attacker?.team === this.player.team) this.kills++;
        this.message(actor === this.player ? "你已倒下。点击「重新开始」复位训练场。" : `${actor.label}已击倒。`, "death");
      }
      return actual;
    }

    spawnProjectile(options) {
      const projectile = { id: `projectile-${this._nextId++}`, pos: [...options.pos], previousPos: [...options.pos],
        vel: [...options.vel], ownerId: options.ownerId, team: options.team ?? this.findActor(options.ownerId)?.team,
        damage: options.damage || 0, radius: options.radius ?? 0.045, gravity: options.gravity ?? 0,
        expiresAt: this.time + (options.lifetime ?? 4), color: options.color || [1, 0.8, 0.3], onHit: options.onHit || null };
      this.projectiles.push(projectile);
      return projectile;
    }
    fire() {
      const player = this.player;
      if (!player.alive || this.time < player.nextFireAt || this.hasStatus(player, "disarmed") || this.hasStatus(player, "stun")) return false;
      const item = player.inventory.weapons[player.inventory.selected], weapon = item && WEAPONS[item.type];
      if (!weapon) return false;
      if (player.inventory.ammo < weapon.ammoCost) return false;
      player.nextFireAt = this.time + weapon.interval;
      player.inventory.ammo -= weapon.ammoCost;
      const from = eye(player), direction = aimDirection(player);
      if (weapon.melee) {
        const to = add(from, mul(direction, player.character.params.armLength + 0.45));
        const hit = this._firstHit(from, to, 0.11, player.id, player.team);
        if (hit) {
          if (hit.actor) this.damage(hit.actor, weapon.damage, player.id);
          this.addEffect({ type: "hit", pos: hit.pos, color: hit.actor ? [1, 0.25, 0.15] : [0.8, 0.8, 0.8] });
        }
        this.addEffect({ type: "melee", pos: add(from, mul(direction, 0.6)), duration: 0.12, color: weapon.color });
      } else {
        this.spawnProjectile({ pos: from, vel: mul(direction, weapon.speed), ownerId: player.id, team: player.team,
          damage: weapon.damage, color: weapon.color });
      }
      this.addEffect({ type: "shot", pos: add(from, mul(direction, 0.35)), duration: 0.06, color: weapon.color });
      return true;
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
          if (hit.actor && projectile.damage > 0) this.damage(hit.actor, projectile.damage, projectile.ownerId);
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
        if (!actor.alive) continue;
        if (this.targetsMoving && !this.hasStatus(actor, "root") && !this.hasStatus(actor, "stun")) {
          this._moveAxis(actor, 0, actor.spawnPos[0] + Math.sin(this.time * 0.8 + index) * 1.7 - actor.pos[0]);
        }
        if (!this.enemyFire || !this.player.alive || this.time < actor.nextEnemyFireAt || this.hasStatus(actor, "stun") || this.hasStatus(actor, "disarmed")) continue;
        actor.nextEnemyFireAt = this.time + 1.4;
        const from = eye(actor), to = eye(this.player);
        if (!this.lineOfSight(from, to)) continue;
        const direction = normalized(sub(to, from));
        this.spawnProjectile({ pos: from, vel: mul(direction, 22), ownerId: actor.id, team: actor.team, damage: 9,
          color: [1, 0.28, 0.2], radius: 0.065, lifetime: 4 });
      }
    }
    update(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.25);
      this.time += dt;
      for (const actor of this.actors) actor.statuses = actor.statuses.filter((status) => status.expiresAt > this.time);
      if (this.skills?.update) this.skills.update(dt);
      this._movePlayer(dt, input);
      if (input.fire) this.fire();
      this._updateTargets(dt);
      this._updateProjectiles(dt);
      this.effects = this.effects.filter((effect) => effect.expiresAt > this.time);
    }
    resetTargets() {
      this.kills = 0;
      this.projectiles = [];
      for (const actor of this.actors.slice(1)) {
        actor.pos = [...actor.spawnPos]; actor.vel = [0, 0, 0]; actor.alive = true; actor.hp = actor.maxHp;
        actor.statuses = []; actor.nextEnemyFireAt = this.time + 1.5;
      }
      this.message("训练靶已复位。", "info");
    }
    resetPlayer() {
      const player = this.player;
      player.pos = [...player.spawnPos]; player.vel = [0, 0, 0]; player.hp = player.maxHp; player.mana = player.maxMana;
      player.alive = true; player.grounded = true; player.statuses = []; player.nextFireAt = this.time;
    }
    reset() {
      this.resetPlayer(); this.resetTargets();
      this.effects = [];
      this.message("训练场已复位，保留已拾取的物品。", "info");
    }
  }
  World.WEAPONS = WEAPONS;
  World.CONFIG = CONFIG;
  const api = Object.assign(root.PixelFPS || {}, { World, CONFIG, WEAPONS, actorBoxes, eye, aimDirection, segmentBox });
  root.PixelFPS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
