(function attachPixelSkillRuntime(root) {
  "use strict";

  root.PixelFPSSkills = root.PixelFPSSkills || Object.create(null);

  const valueAt = (value, level) => Number(typeof value === "function" ? value(level) : value || 0);
  const copy = (value) => JSON.parse(JSON.stringify(value));

  /** Skill numbers are prototype values. Definitions own behavior; this runner owns activation. */
  class PixelSkillRuntime {
    constructor(world, definitions = root.PixelFPSSkills) {
      this.world = world;
      this.definitions = Array.isArray(definitions)
        ? Object.fromEntries(definitions.map((definition) => [definition.id, definition]))
        : { ...definitions };
      this.cooldowns = Object.create(null);
      this.instances = [];
      this.nextInstanceId = 1;
    }

    getState(id) {
      const definition = this.definitions[id];
      const owned = this.world.player?.inventory?.skills?.[id];
      const level = Math.max(1, Number(owned?.level) || 1);
      return {
        id,
        name: definition?.name || id,
        kind: definition?.kind || "normal",
        level,
        count: Math.max(0, Number(owned?.count) || 0),
        cooldown: definition ? valueAt(definition.cooldown, level) : 0,
        remaining: Math.max(0, this.cooldowns[id] || 0),
        active: this.instances.filter((instance) => instance.skillId === id).length,
        manaCost: definition ? valueAt(definition.manaCost, level) : 0,
        duration: definition ? valueAt(definition.duration, level) : 0,
      };
    }

    cast(id) {
      const definition = this.definitions[id];
      const world = this.world;
      const caster = world.player;
      const fail = (message) => ({ ok: false, message });
      if (!definition) return fail("技能脚本尚未载入。");
      if (!caster || caster.alive === false || caster.hp <= 0) return fail("当前无法使用技能。");
      const owned = caster.inventory?.skills?.[id];
      if (!owned || !Number.isFinite(owned.count) || owned.count < 1) return fail("还没有拾取这个技能。");
      const blocked = (caster.statuses || []).some((status) =>
        (status.type === "silence" || status.type === "stun") &&
        (status.expiresAt === undefined || status.expiresAt > world.time));
      if (blocked) return fail("当前状态不允许释放技能。");
      const state = this.getState(id);
      if (state.remaining > 0) return fail(`技能冷却中，还需 ${state.remaining.toFixed(1)} 秒。`);
      if (!Number.isFinite(state.manaCost) || state.manaCost < 0 ||
          !Number.isFinite(state.duration) || state.duration < 0 ||
          !Number.isFinite(state.cooldown) || state.cooldown < 0) return fail("技能参数无效。");
      if (!Number.isFinite(caster.mana) || caster.mana < state.manaCost) return fail("蓝量不足。");

      const instance = {
        id: `${caster.id || "player"}:${id}:${this.nextInstanceId++}`,
        skillId: id,
        world,
        caster,
        definition,
        level: state.level,
        age: 0,
        duration: state.duration,
        remaining: state.duration,
        record: Object.create(null),
      };
      if (definition.canCast) {
        const checked = definition.canCast(instance);
        if (checked === false) return fail("当前无法发动这个技能。");
        if (typeof checked === "string") return fail(checked);
        if (checked?.ok === false) return fail(checked.message || "当前无法发动这个技能。");
      }

      // Preflight above is side-effect free. Roll back resource payment if a script cannot start.
      const previousMana = caster.mana;
      const previousSkill = copy(owned);
      const previousCooldown = this.cooldowns[id] || 0;
      if (definition.kind === "ultimate") {
        if (typeof world.consumeSkill === "function") {
          if (world.consumeSkill(id, 1) === false) return fail("技能份数不足。");
        } else {
          // Small isolated worlds (including tests) can omit the inventory facade.
          const levels = owned.levels;
          if (levels) {
            const highest = Object.keys(levels).map(Number).filter((level) => levels[level] > 0).sort((a, b) => b - a)[0];
            if (highest === undefined) return fail("技能份数不足。");
            if (--levels[highest] <= 0) delete levels[highest];
            owned.level = Math.max(1, ...Object.keys(levels).map(Number));
          }
          owned.count -= 1;
        }
      }
      caster.mana -= state.manaCost;
      this.cooldowns[id] = state.cooldown;
      try {
        if (definition.start && definition.start(instance) === false) throw new Error("技能未能启动。");
      } catch (error) {
        caster.mana = previousMana;
        caster.inventory.skills[id] = previousSkill;
        this.cooldowns[id] = previousCooldown;
        if (definition.end) definition.end(instance, "failed");
        return fail(error.message || "技能未能启动。");
      }

      if (state.duration > 0) this.instances.push(instance);
      else if (definition.end) definition.end(instance, "complete");
      const message = `${definition.name || id} · ${state.level} 级`;
      if (world.message) world.message(message, "skill");
      return { ok: true, message };
    }

    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      for (const id of Object.keys(this.cooldowns)) {
        this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
      }
      for (const instance of [...this.instances]) {
        if (instance.caster.alive === false || instance.caster.hp <= 0) {
          this.finish(instance, "death");
          continue;
        }
        const elapsed = Math.min(dt, instance.remaining);
        const keep = instance.definition.update?.(instance, elapsed);
        instance.age += elapsed;
        instance.remaining = Math.max(0, instance.remaining - elapsed);
        if (keep === false || instance.remaining <= 0) this.finish(instance, "complete");
      }
    }

    finish(instance, reason) {
      const index = this.instances.indexOf(instance);
      if (index === -1) return;
      this.instances.splice(index, 1);
      instance.definition.end?.(instance, reason);
    }

    dispose() {
      for (const instance of [...this.instances]) this.finish(instance, "dispose");
      this.cooldowns = Object.create(null);
    }
  }

  root.PixelSkillRuntime = PixelSkillRuntime;
  if (typeof module !== "undefined" && module.exports) module.exports = PixelSkillRuntime;
})(globalThis);
