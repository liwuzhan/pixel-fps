(function attachPixelFPSPlayerActions(root) {
  "use strict";
  const CODES = Object.freeze(["KeyQ", "KeyF", "KeyG", "KeyR", "KeyC", "KeyX", "KeyZ", "KeyT"]);
  const DEFAULTS = Object.freeze({ KeyQ: "jetpack", KeyF: "autoaim", KeyG: "weaken" });
  const own = (object, key) => Object.hasOwn(object, key);

  /** Input intent only: inventory, skill gates and transfers remain in their owning systems. */
  class PixelFPSPlayerActions {
    constructor(world, options = {}) {
      this.setWorld(world);
      this.bindings = Object.fromEntries(CODES.map((code) => [code, null]));
      const supplied = options.bindings === undefined ? DEFAULTS : options.bindings;
      if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("技能键位需要一个对象。");
      for (const [code, id] of Object.entries(supplied)) {
        const result = this.bindSkill(code, id);
        if (!result.ok) throw new Error(result.message);
      }
    }
    setWorld(world) {
      if (!world?.player || typeof world.selectWeapon !== "function") throw new Error("操作入口需要有效的 World。");
      this.world = world;
      return this;
    }
    getBindings() { return { ...this.bindings }; }
    bindSkill(code, id) {
      if (!CODES.includes(code)) return { ok: false, message: "该按键不属于可分配技能键。" };
      if (id !== null && (typeof id !== "string" || !own(this.world.skills?.definitions || {}, id))) {
        return { ok: false, message: "未知技能，不能绑定。" };
      }
      if (id !== null) for (const key of CODES) if (this.bindings[key] === id) this.bindings[key] = null;
      this.bindings[code] = id;
      return { ok: true, message: id === null ? "已清除快捷键。" : `已绑定 ${code.slice(3)}。` };
    }
    keyForSkill(id) { return CODES.find((code) => this.bindings[code] === id) || null; }
    useSkill(id) {
      if (typeof id !== "string" || !own(this.world.skills?.definitions || {}, id)) return { ok: false, message: "未知技能。" };
      return this.world.skills.cast(id);
    }
    selectWeapon(index) {
      const ok = this.world.selectWeapon(index);
      return { ok, message: ok ? "已切换武器。" : "该位置没有武器。" };
    }
    drop(request) { return this.world.dropItem(request); }
    useManaPotion() {
      const ok = this.world.useManaPotion();
      return { ok, message: ok ? "已使用蓝瓶。" : "当前无法使用蓝瓶：需要存活、持有蓝瓶且蓝量未满。" };
    }
    mergeSkill(id) {
      const count = this.world.events?.length || 0;
      const previous = this.world.events?.at(-1);
      const ok = this.world.upgradeSkill(id);
      const latest = this.world.events?.at(-1);
      return { ok, message: latest && (latest !== previous || this.world.events.length !== count)
        ? latest.text : ok ? "技能已合成。" : "合成需要三份同名、同级普通技能。" };
    }
    dispatch(code) {
      if (CODES.includes(code)) return this.bindings[code] ? this.useSkill(this.bindings[code]) : null;
      if (/^Digit[1-9]$/.test(code)) return this.selectWeapon(Number(code.slice(5)) - 1);
      if (code === "KeyE") return this.world.interact();
      if (code === "KeyV") return this.useManaPotion();
      if (code === "KeyB") {
        const inventory = this.world.player.inventory;
        const weapon = inventory.weapons[inventory.selected];
        return weapon ? this.drop({ kind: "weapon", weaponId: weapon.id }) : { ok: false, message: "当前没有可丢弃的武器。" };
      }
      return null;
    }
  }
  PixelFPSPlayerActions.CODES = CODES;
  PixelFPSPlayerActions.DEFAULTS = DEFAULTS;
  root.PixelFPSPlayerActions = PixelFPSPlayerActions;
  if (typeof module !== "undefined" && module.exports) module.exports = PixelFPSPlayerActions;
})(globalThis);
