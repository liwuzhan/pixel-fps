(function registerWeaken(root) {
  "use strict";

  // Prototype: a physical grenade carrying a debuff, with no direct damage of its own.
  const definition = {
    id: "weaken",
    name: "虚弱榴弹",
    kind: "normal",
    description: "发射实体榴弹，撞击后让附近敌人的伤害输出降低。",
    manaCost: 16,
    cooldown: 9,
    duration: 0,
    start(instance) {
      const { world, caster, level } = instance;
      const direction = world.aimDirection(caster);
      const origin = world.eye(caster);
      const radius = 3.5 + (level - 1) * 0.5;
      instance.record.exploded = false;
      const projectile = world.spawnProjectile({
        pos: [...origin],
        vel: direction.map((value, axis) => value * 17 + (axis === 1 ? 2 : 0)),
        ownerId: caster.id,
        team: caster.team,
        damage: 0,
        radius: 0.14,
        gravity: 9.8,
        lifetime: 5,
        color: [0.81, 0.51, 1],
        onHit({ pos, actor: directHit }) {
          if (instance.record.exploded) return;
          instance.record.exploded = true;
          for (const enemy of world.enemiesOf(caster)) {
            if (enemy.alive === false || enemy.hp <= 0) continue;
            const torso = world.actorBoxes?.(enemy).find((part) => part.id === "torso");
            const eye = world.eye(enemy);
            const center = torso?.center || [enemy.pos[0], (enemy.pos[1] + eye[1]) / 2, enemy.pos[2]];
            const inRange = Math.hypot(...center.map((value, axis) => value - pos[axis])) <= radius;
            // A direct collision already proves contact. Splash needs an unobstructed route.
            if (enemy.id === directHit?.id || (inRange && world.lineOfSight(pos, center))) {
              world.applyStatus(enemy, "weaken", 6 + (level - 1) * 2, instance.id, { damageMultiplier: 0.45 });
            }
          }
          world.addEffect?.({ type: "burst", pos: [...pos], radius, color: [0.81, 0.51, 1], duration: 0.7 });
          world.message?.("虚弱榴弹爆开", "skill");
        },
      });
      if (!projectile) return false;
      instance.record.projectileId = projectile.id;
    },
  };

  (root.PixelFPSSkills ||= Object.create(null))[definition.id] = definition;
  if (typeof module !== "undefined" && module.exports) module.exports = definition;
})(globalThis);
