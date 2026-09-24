(function attachItemVisuals(root) {
  'use strict';

  // Presentation data only. Models face local -Z; parts never define hit boxes.
  // SVG markup is selected from this closed catalogue, never built from user text.
  const COLORS = {
    pistol: '#e8ba55', rifle: '#73c4a2', knife: '#b6d8ee', rocket: '#f38d48',
    ammo: '#56cfe3', mana: '#698bff', jetpack: '#f8cf63', autoaim: '#fa7fbd', weaken: '#af81ef',
  };
  const rgba = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1);
  const steel = [0.38, 0.46, 0.51, 1], dark = [0.10, 0.15, 0.20, 1], light = [0.84, 0.91, 0.95, 1];
  const part = (center, size, color) => ({ center, size, color });
  const catalogue = {
    pistol: {
      name: '手枪', category: 'weapon', muzzle: [0, 0.045, -0.32],
      shape: '<path d="M10 21h41v11H30v19H18V32h-8z"/><path d="M31 33h9v8H29" fill="none" stroke-width="3"/><path d="M12 19h34" fill="none"/>',
      parts: [part([0,.04,-.07],[.16,.15,.49],steel), part([0,-.13,.075],[.13,.27,.15],dark), part([0,.105,-.035],[.17,.055,.38],rgba(COLORS.pistol)), part([0,.045,-.323],[.085,.07,.015],dark), part([0,.155,.105],[.05,.045,.045],light)],
    },
    rifle: {
      name: '步枪', category: 'weapon', muzzle: [0, 0.045, -0.57],
      shape: '<path d="M7 27h10l5-7h22v6h14v6H43v7H28l-4 14h-8l3-17H7z"/><path d="M27 17h9v5" fill="none" stroke-width="3"/>',
      parts: [part([0,.04,-.045],[.17,.17,.53],rgba(COLORS.rifle)),part([0,.045,-.42],[.075,.075,.29],steel),part([0,-.01,.365],[.13,.23,.30],dark),part([0,-.18,.12],[.11,.25,.13],steel),part([0,-.17,-.085],[.11,.27,.16],dark),part([0,.165,.015],[.08,.075,.16],dark)],
    },
    knife: {
      name: '小刀', category: 'weapon', muzzle: [0, 0.035, -0.47],
      shape: '<path d="m13 50 12-13 6 6-12 13z"/><path d="m23 32 10 11m-4-8 23-24-5 22-12 8" fill="none" stroke-width="5"/>',
      parts: [part([0,-.025,.215],[.095,.13,.26],dark),part([0,.025,.065],[.28,.06,.065],rgba(COLORS.knife)),part([0,.035,-.205],[.08,.055,.47],light),part([0,.035,-.453],[.045,.045,.045],light)],
    },
    rocket: {
      name: '火箭筒', category: 'weapon', muzzle: [0, 0.055, -0.57],
      shape: '<path d="M9 22h43v20H9z"/><path d="M5 18h8v28H5zm44-2h10v32H49zM22 42h9v13h-9z"/><path d="M23 17h12v5" fill="none" stroke-width="3"/>',
      parts: [part([0,.055,-.015],[.29,.29,1.01],rgba(COLORS.rocket)),part([0,.055,.49],[.36,.36,.13],steel),part([0,.055,-.52],[.37,.37,.1],steel),part([0,.055,-.573],[.255,.255,.012],dark),part([0,-.20,.11],[.13,.27,.17],dark),part([0,.26,-.08],[.095,.13,.15],dark)],
    },
    ammo: {
      name: '通用弹药', category: 'resource',
      shape: '<rect x="9" y="20" width="46" height="33" rx="3"/><path d="M15 11h8v9h-8zm13 0h8v9h-8zm13 0h8v9h-8z"/><path d="M20 32h24m-24 9h24" stroke="#102331" fill="none" stroke-width="3"/>',
      parts: [part([0,0,0],[.40,.27,.27],rgba(COLORS.ammo)),part([0,.17,0],[.43,.07,.30],steel),part([-.12,.24,0],[.055,.10,.095],light),part([0,.24,0],[.055,.10,.095],light),part([.12,.24,0],[.055,.10,.095],light)],
    },
    mana: {
      name: '蓝瓶', category: 'consumable',
      shape: '<path d="M25 8h14v13l11 12v21H14V33l11-12z"/><path d="M23 7h18v8H23z" fill="#d6e3f5"/><path d="M20 37h24" fill="none" stroke="#e1ecff" stroke-width="4"/>',
      parts: [part([0,-.015,0],[.28,.33,.25],rgba(COLORS.mana)),part([0,.20,0],[.12,.14,.12],rgba(COLORS.mana)),part([0,.30,0],[.17,.08,.17],light),part([0,-.01,-.133],[.16,.065,.018],light)],
    },
    jetpack: {
      name: '弹射背包', category: 'skill',
      shape: '<path d="M14 13h13v31H14zm23 0h13v31H37zM27 22h10v13H27z"/><path d="m16 48 4 10 5-10m14 0 5 10 4-10" fill="none" stroke-width="4"/>',
      parts: [part([-.13,0,0],[.16,.39,.22],rgba(COLORS.jetpack)),part([.13,0,0],[.16,.39,.22],rgba(COLORS.jetpack)),part([0,.025,0],[.15,.12,.14],steel),part([-.13,-.245,0],[.11,.10,.15],[1,.45,.18,1]),part([.13,-.245,0],[.11,.10,.15],[1,.45,.18,1])],
    },
    autoaim: {
      name: '自瞄', category: 'skill',
      shape: '<circle cx="32" cy="32" r="18" fill="none" stroke-width="5"/><path d="M32 4v17m0 22v17M4 32h17m22 0h17" fill="none" stroke-width="4"/><circle cx="32" cy="32" r="4"/>',
      parts: [part([-.17,0,0],[.06,.40,.08],rgba(COLORS.autoaim)),part([.17,0,0],[.06,.40,.08],rgba(COLORS.autoaim)),part([0,.17,0],[.28,.06,.08],rgba(COLORS.autoaim)),part([0,-.17,0],[.28,.06,.08],rgba(COLORS.autoaim)),part([0,0,0],[.10,.10,.10],light)],
    },
    weaken: {
      name: '虚弱榴弹', category: 'skill',
      shape: '<path d="M25 19h14l10 13v20H15V32zM26 10h12v9H26z"/><path d="M34 10h12v12" fill="none" stroke-width="4"/><path d="m25 30 14 15m0-15L25 45" fill="none" stroke="#f3e9ff" stroke-width="4"/>',
      parts: [part([0,-.035,0],[.32,.32,.27],rgba(COLORS.weaken)),part([0,.18,0],[.13,.11,.13],steel),part([.11,.24,0],[.21,.055,.07],light),part([.19,.17,0],[.05,.13,.07],light),part([0,-.03,-.142],[.15,.05,.017],light)],
    },
    unknown: {
      name: '物资', category: 'item', color: '#b5c1ce',
      shape: '<path d="M12 16h40v38H12z"/><path d="M12 25h40M32 16v38" fill="none" stroke="#263848" stroke-width="3"/>',
      parts: [part([0,0,0],[.32,.32,.32],steel)],
    },
  };
  function deepFreeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  }
  for (const [key, value] of Object.entries(catalogue)) {
    value.color = value.color || COLORS[key];
    value.rgba = rgba(value.color);
    value.icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g fill="' + value.color + '" stroke="' + value.color + '" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">' + value.shape + '</g></svg>';
  }
  deepFreeze(catalogue);
  const lookup = key => Object.prototype.hasOwnProperty.call(catalogue, key) ? catalogue[key] : catalogue.unknown;
  const api = Object.freeze({
    keys: Object.freeze(Object.keys(COLORS)),
    icon: key => lookup(key).icon,
    parts: key => lookup(key).parts,
    metadata: key => lookup(key),
    keyForPickup: pickup => pickup?.type === 'weapon' ? pickup.weaponType || pickup.weapon?.type || 'unknown'
      : pickup?.type === 'skill' ? pickup.skillId || 'unknown' : pickup?.type || 'unknown',
  });
  root.PixelFPSItemVisuals = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
