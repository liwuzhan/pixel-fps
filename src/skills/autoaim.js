(function registerAutoaim(root) {
  "use strict";

  function findVisibleTarget(instance) {
    const { world, caster } = instance;
    const origin = world.eye(caster);
    const direction = world.aimDirection(caster);
    const threshold = Math.cos(Math.PI / 6);
    let best = null;
    let bestDot = threshold;
    let bestDistance = Infinity;
    for (const actor of world.enemiesOf(caster)) {
      if (actor.alive === false || actor.hp <= 0) continue;
      const target = world.eye(actor);
      const offset = target.map((value, axis) => value - origin[axis]);
      const distance = Math.hypot(...offset);
      if (distance < 0.001) continue;
      const dot = offset.reduce((sum, value, axis) => sum + value * direction[axis], 0) / distance;
      if (dot < threshold || !world.lineOfSight(origin, target)) continue;
      if (dot > bestDot || (dot === bestDot && distance < bestDistance)) {
        best = { actor, offset };
        bestDot = dot;
        bestDistance = distance;
      }
    }
    return best;
  }

  // Prototype: consumes a collected ultimate copy; it aims, but never pulls the trigger.
  const definition = {
    id: "autoaim",
    name: "自动瞄准",
    kind: "ultimate",
    description: "持续锁定准心周围 30° 内、没有遮挡的敌人；仍需自己开火。",
    manaCost: 18,
    cooldown: 0,
    duration: (level) => 7 + (level - 1) * 2,
    start(instance) {
      instance.record.targetId = null;
    },
    update(instance) {
      const target = findVisibleTarget(instance);
      instance.record.targetId = target?.actor.id || null;
      if (!target) return;
      const [x, y, z] = target.offset;
      instance.caster.yaw = Math.atan2(x, -z);
      instance.caster.pitch = Math.atan2(y, Math.hypot(x, z));
    },
    end(instance) {
      // Only this cast's lock is cleared; concurrent autoaim casts keep their own records.
      instance.record.targetId = null;
    },
  };

  (root.PixelFPSSkills ||= Object.create(null))[definition.id] = definition;
  if (typeof module !== "undefined" && module.exports) module.exports = definition;
})(globalThis);
