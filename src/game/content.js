(function attachPixelFPSContent(root) {
  "use strict";

  // Shared gameplay definitions. Presentation resolves visualKey to its own icons and meshes.
  // Values expose behavior in the prototype; they are not balance decisions.
  const WEAPONS = Object.freeze({
    pistol: Object.freeze({ label: "手枪", description: "单发通用弹药武器。", visualKey: "pistol",
      damage: 26, speed: 95, interval: 0.28, ammoCost: 1, color: Object.freeze([1, 0.83, 0.3]) }),
    rifle: Object.freeze({ label: "步枪", description: "连续发射通用弹药。", visualKey: "rifle",
      damage: 16, speed: 140, interval: 0.11, ammoCost: 1, color: Object.freeze([0.4, 0.95, 1]) }),
    knife: Object.freeze({ label: "小刀", description: "近战距离随手臂长度变化。", visualKey: "knife",
      damage: 42, interval: 0.45, ammoCost: 0, melee: true, color: Object.freeze([0.95, 0.95, 1]) }),
    rocket: Object.freeze({ label: "火箭筒", description: "发射可见火箭，碰撞后造成范围伤害；使用通用弹药。", visualKey: "rocket",
      damage: 80, speed: 22, interval: 0.9, ammoCost: 6, blastRadius: 3.5, projectileRadius: 0.12,
      explosive: true, color: Object.freeze([1, 0.47, 0.16]) }),
  });
  const RESOURCES = Object.freeze({
    ammo: Object.freeze({ label: "通用弹药", description: "所有枪械共享的弹药储备。", inventoryKey: "ammo", visualKey: "ammo" }),
    mana: Object.freeze({ label: "蓝瓶", description: "使用后恢复蓝量。", inventoryKey: "manaPotions", visualKey: "mana", restore: 60 }),
  });

  // Skill behavior and costs belong to the loaded PixelFPSSkills scripts, not this catalog.
  const api = Object.freeze({ WEAPONS, RESOURCES });
  root.PixelFPSContent = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
