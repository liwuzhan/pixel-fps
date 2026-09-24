(function registerJetpack(root) {
  "use strict";

  // Prototype values: one impulse, scaled by collected skill level.
  const definition = {
    id: "jetpack",
    name: "弹射背包",
    kind: "normal",
    description: "向上弹射，并沿瞄准方向获得少量水平推力。",
    manaCost: 10,
    cooldown: 5,
    duration: 0,
    start({ world, caster, level }) {
      const direction = world.aimDirection(caster);
      const horizontal = Math.hypot(direction[0], direction[2]);
      const thrust = 2.5 + (level - 1) * 0.5;
      if (horizontal > 0.001) {
        caster.vel[0] += direction[0] / horizontal * thrust;
        caster.vel[2] += direction[2] / horizontal * thrust;
      }
      caster.vel[1] += 8 + (level - 1) * 1.8;
      caster.grounded = false;
      world.addEffect?.({ type: "burst", pos: [...caster.pos], radius: 0.55, color: [1, 0.73, 0.33], duration: 0.35 });
    },
  };

  (root.PixelFPSSkills ||= Object.create(null))[definition.id] = definition;
  if (typeof module !== "undefined" && module.exports) module.exports = definition;
})(globalThis);
