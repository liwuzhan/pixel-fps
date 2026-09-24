(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'fps.block-character.v1';
  const LAB_STORAGE_KEY = 'fps.lab.scenarios.v1';
  const CONTROLS_STORAGE_KEY = 'fps.controls.v1';
  const keys = new Set();
  let world, renderer, lab, labPanel, controls, inventoryPanel, running = false, started = false, mouseDown = false;
  let sensitivity = 0.002, lastTime = 0, accumulator = 0, hudTime = 0, toastUntil = 0, hitUntil = 0, damageUntil = 0;
  let previousHp = 0, lastDamageId = null, lastEvent = null, waitingCharacter = null, ignoreMouseUntil = 0;
  let project = { parameters: { ...BlockCharacter.DEFAULTS }, face: null };
  const dialogs = ['inventory-dialog', 'settings-dialog', 'character-dialog', 'lab-dialog'];
  const isDialogOpen = () => dialogs.some(id => $(id).open);
  let savedBindings;
  try { const saved=localStorage.getItem(CONTROLS_STORAGE_KEY); if(saved) savedBindings=JSON.parse(saved); } catch (_) {}
  function itemIcon(key) { const span=document.createElement('span');span.className='item-icon';span.setAttribute('aria-hidden','true');span.innerHTML=PixelFPSItemVisuals.icon(key);return span; }
  function saveBindings() {
    try { localStorage.setItem(CONTROLS_STORAGE_KEY,JSON.stringify(controls.getBindings())); }
    catch (_) { showToast('键位已生效；浏览器暂时无法保存设置。'); }
    refreshHud();
  }


  function showToast(message) {
    if (!message) return;
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastUntil = performance.now() + 3200;
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) project = BlockCharacter.parseProject(JSON.parse(saved).character);
  } catch (_) { /* An invalid or unavailable local save falls back to the default body. */ }

  function describeCharacter() {
    const c = world?.player.character || BlockCharacter.createCharacter(project.parameters);
    return `当前角色 ${c.standingHeight.toFixed(2)} m · 头部 ×${c.params.headScale.toFixed(2)} · 躯干 ×${c.params.torsoScale.toFixed(2)}${(world?.player.face || (!world && project.face)) ? ' · 已绘制面部' : ''}`;
  }

  function createWorld(options = {}) {
    world?.skills?.dispose();
    world = new PixelFPS.World({ parameters: options.parameters || project.parameters, face: Object.hasOwn(options,'face') ? options.face : project.face });
    world.skills = new PixelSkillRuntime(world);
    if (controls) controls.setWorld(world);
    else {
      try { controls = new PixelFPSPlayerActions(world,{bindings:savedBindings}); }
      catch (_) { controls = new PixelFPSPlayerActions(world); showToast('已恢复默认技能键位'); }
    }
    world.targetsMoving = $('moving-targets').checked;
    world.enemyFire = $('enemy-fire').checked;
    if (lab) { lab.setWorld(world); lab.paused = false; lab.timeScale = 1; }
    else lab = new PixelFPSLab(world,{resetWorld:createWorld});
    previousHp = world.player.hp;
    $('resume-game').textContent = '继续训练';
    lastEvent = null; lastDamageId = null;
    accumulator = 0;
    $('character-summary').textContent = describeCharacter();
    $('settings-character').textContent = describeCharacter();
    refreshHud();
    return world;
  }

  function pause(showPanel = true) {
    running = false;
    accumulator = 0;
    mouseDown = false;
    keys.clear();
    if (document.pointerLockElement === $('arena')) document.exitPointerLock();
    if (started && showPanel && !isDialogOpen()) $('pause-screen').hidden = false;
  }

  async function resume() {
    if (!world || !renderer) return;
    if (!world.player.alive || world.player.hp <= 0) createWorld();
    dialogs.forEach(id => { if ($(id).open) $(id).close(); });
    ignoreMouseUntil = Infinity;
    try {
      const result = $('arena').requestPointerLock();
      if (result && typeof result.then === 'function') await result;
      // Browsers with the legacy API confirm entry through pointerlockchange.
      if (document.pointerLockElement === $('arena')) enterPlay();
    } catch (_) {
      ignoreMouseUntil = 0;
      showToast('未能锁定鼠标，请再次点击继续；也可拖动鼠标瞄准。');
      enterPlay();
    }
  }

  function enterPlay() {
    started = true;
    running = true;
    $('start-screen').hidden = true;
    $('pause-screen').hidden = true;
    $('pause-title').textContent = '继续你的实验';
    $('pause-copy').textContent = '鼠标已释放。点击继续回到第一人称。';
    lastTime = performance.now();
  }

  function openDialog(id) {
    pause(false);
    $('pause-screen').hidden = true;
    if (id === 'inventory-dialog') inventoryPanel?.render();
    if (id === 'lab-dialog') labPanel?.refresh();
    if (!$(id).open) $(id).showModal();
    if (id === 'lab-dialog') $('console-input').focus();
  }

  function closeDialog(id) {
    $(id).close();
    if (started) $('pause-screen').hidden = false;
  }

  function doResult(result) {
    if (typeof result === 'string') showToast(result);
    else if (result && result.message) showToast(result.message);
    refreshHud();
  }

  function cast(id) {
    doResult(controls.useSkill(id));
    if ($('inventory-dialog').open) inventoryPanel?.render();
  }

  function weaponName(weapon) {
    const definition = PixelFPS.WEAPONS?.[weapon?.type] || {};
    return definition.name || definition.label || weapon?.type || '未持有武器';
  }

  function refreshHud() {
    if (!world) return;
    const p = world.player, inventory = p.inventory;
    $('health').textContent = `${Math.ceil(Math.max(0, p.hp))} / ${Math.ceil(p.maxHp)}`;
    $('mana').textContent = `${Math.floor(p.mana)} / ${Math.ceil(p.maxMana)}`;
    $('health-bar').max = p.maxHp; $('health-bar').value = Math.max(0, p.hp);
    $('mana-bar').max = p.maxMana; $('mana-bar').value = p.mana;
    const held = inventory.weapons[inventory.selected];
    $('weapon-label').textContent = weaponName(held);
    $('ammo').textContent = `通用弹药 ${inventory.ammo}`;
    $('weapon-icon').innerHTML = held ? PixelFPSItemVisuals.icon(held.type) : '';
    $('weapon-icon').hidden = !held;
    $('weapon-hint').textContent = held ? `滚轮 / 1–${Math.min(9,inventory.weapons.length)} 切换 · B 丢枪` : '靠近物资按 E 拾取';
    const slots = Object.entries(controls.getBindings()).filter(([,id]) => id && world.skills.definitions[id]);
    $('skill-hud').replaceChildren(...slots.map(([code,id]) => {
      const state = world.skills.getState(id), item = document.createElement('div');
      item.className = `skill-card${state.count || state.active ? '' : ' unowned'}${state.active ? ' active' : ''}`;
      const key = document.createElement('kbd'); key.textContent = code.slice(3);
      const name = document.createElement('div'); name.className = 'name'; name.textContent = `${state.name || id} Lv.${state.level || 1}`;
      const detail = document.createElement('div'); detail.className = 'detail';
      detail.textContent = state.count || state.active ? `${state.manaCost ?? 0} 蓝 · ${state.kind === 'ultimate' ? `剩余 ${state.count} 份` : '可重复'}` : '尚未拾取';
      const cooldown = document.createElement('div'); cooldown.className = 'cooldown';
      cooldown.textContent = state.active ? '生效中' : state.remaining > 0 ? `${state.remaining.toFixed(1)} s` : state.count ? '就绪' : '—';
      item.append(key, itemIcon(id), name, detail, cooldown);
      return item;
    }));
    const pickup = world.nearestPickup();
    $('pickup-prompt').hidden = !pickup || !running;
    if (pickup) {
      const key=pickup.weapon?.type||pickup.weaponType||pickup.skillId||pickup.type;
      const copy=document.createElement('span');copy.textContent=`E 拾取 · ${pickup.label||pickup.type}`;
      const hint=document.createElement('small');
      hint.textContent=pickup.type==='weapon' ? PixelFPSContent.WEAPONS[key]?.description||'武器' : pickup.type==='skill'?`技能材料 · ${pickup.level||1} 级` : pickup.type==='ammo'?'所有枪械共用':'恢复当前蓝量';
      copy.append(hint);$('pickup-prompt').replaceChildren(itemIcon(key),copy);
    } else $('pickup-prompt').replaceChildren();
    const statusNames={weaken:'虚弱',slow:'减速',root:'定身',stun:'眩晕',silence:'沉默',disarmed:'缴械',invulnerable:'无敌'};
    $('status-hud').replaceChildren(...p.statuses.filter(s=>s.expiresAt>world.time).map(s=>{
      const chip=document.createElement('span');chip.textContent=`${statusNames[s.type]||s.type} ${(s.expiresAt-world.time).toFixed(1)} s`;return chip;
    }));
    const auto = world.skills.getState('autoaim');
    $('crosshair').classList.toggle('locked', auto.active > 0);
    const event = world.events?.at(-1);
    if (event && event !== lastEvent) {
      lastEvent = event;
      showToast(event.text);
      if (event.type === 'hit' || event.type === 'kill') hitUntil = performance.now() + 160;
    }
    if (p.hp < previousHp) damageUntil = performance.now() + 240;
    previousHp = p.hp;
    const damage = world.combatLog?.findLast(e => e.type === 'damage' && e.sourceId === p.id && e.actualDamage > 0);
    if (damage && damage.id !== lastDamageId) { lastDamageId = damage.id; hitUntil = performance.now() + 160; }
    const flags = [];
    if (world.cheats?.infiniteMana) flags.push('无限蓝量');
    if (world.cheats?.infiniteAmmo) flags.push('无限弹药');
    if (world.cheats?.noCooldown) flags.push('无技能冷却');
    if (lab?.paused) flags.push('时间暂停');
    if (lab && lab.timeScale !== 1) flags.push('时间 '+lab.timeScale+'×');
    $('lab-badge').hidden = !flags.length;
    $('lab-badge').textContent = flags.join(' · ');
    if ($('lab-dialog').open) labPanel?.update();
    const target = world.actors.filter(a => a !== p && a.alive).map(a => {
      const head = world.actorBoxes(a).find(b => b.id === 'head');
      return { actor: a, point: head && world.lineOfSight(world.eye(p),head.center) && renderer?.project(head.center, p) };
    }).filter(a => a.point?.visible && Math.hypot(a.point.x - $('arena').clientWidth / 2, a.point.y - $('arena').clientHeight / 2) < 80).sort((a,b) => a.point.depth-b.point.depth)[0];
    $('target-label').textContent = target ? `${target.actor.label || '训练靶'} · ${Math.ceil(target.actor.hp)} / ${Math.ceil(target.actor.maxHp)}${target.actor.statuses.some(s => s.type === 'weakness' || s.type === 'weaken') ? ' · 虚弱' : ''}` : '';
  }

  async function applyProject(next) {
    const parsed = BlockCharacter.parseProject(BlockCharacter.exportData(next.parameters, next.face || null));
    if (parsed.face) await new Promise((resolve,reject) => {
      const img = new Image(); img.onload = () => img.width === 128 && img.height === 128 ? resolve() : reject(new Error('面部贴图必须为 128 × 128'));
      img.onerror = () => reject(new Error('面部 PNG 无法解码')); img.src = parsed.face.png;
    });
    project = parsed;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({character:BlockCharacter.exportData(project.parameters,project.face)})); } catch (_) {}
    pause(false); createWorld(); started = false;
    $('start-screen').hidden = false; $('pause-screen').hidden = true;
    showToast('角色已应用，场地与物资已重置');
  }

  function openCharacter() {
    openDialog('character-dialog');
    $('character-frame').srcdoc = JSON.parse($('studio-document').textContent);
  }

  $('start-game').onclick = resume; $('resume-game').onclick = resume;
  $('edit-character').onclick = openCharacter; $('start-edit').onclick = openCharacter;
  $('pause-character').onclick = openCharacter;
  $('open-inventory').onclick = () => openDialog('inventory-dialog'); $('pause-inventory').onclick = () => openDialog('inventory-dialog');
  $('close-inventory').onclick = () => closeDialog('inventory-dialog');
  $('open-settings').onclick = () => openDialog('settings-dialog'); $('close-settings').onclick = () => closeDialog('settings-dialog');
  $('pause-settings').onclick = () => openDialog('settings-dialog');
  ['open-lab','start-lab','pause-lab'].forEach(id => $(id).onclick = () => openDialog('lab-dialog'));
  $('cancel-character').onclick = () => closeDialog('character-dialog');
  $('reset-game').onclick = () => { createWorld(); resume(); };
  $('reset-all').onclick = () => { createWorld(); closeDialog('settings-dialog'); showToast('训练场与物资已重置'); };
  $('reset-targets').onclick = () => { world.resetTargets(); showToast('训练靶已恢复'); };
  $('moving-targets').onchange = event => { world.targetsMoving = event.target.checked; };
  $('enemy-fire').onchange = event => { world.enemyFire = event.target.checked; };
  $('sensitivity').oninput = event => { sensitivity = Number(event.target.value); $('sensitivity-value').textContent = (sensitivity / .002).toFixed(1) + '×'; };
  $('import-character').onclick = () => $('character-file').click();
  $('default-character').onclick = async () => { try { await applyProject({parameters:BlockCharacter.DEFAULTS,face:null}); closeDialog('settings-dialog'); } catch (error) { showToast(error.message); } };
  $('character-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 300 * 1024) throw new Error('角色文件过大'); await applyProject(BlockCharacter.parseProject(JSON.parse(await file.text()))); closeDialog('settings-dialog'); }
    catch (error) { showToast('导入失败：' + error.message); }
    event.target.value = '';
  };
  $('apply-character').onclick = () => {
    if (waitingCharacter) return;
    const token = `${Date.now()}-${Math.random()}`;
    waitingCharacter = { token, timeout: setTimeout(() => { waitingCharacter = null; showToast('编辑器尚未就绪，请稍后再试'); }, 2500) };
    $('character-frame').contentWindow.postMessage({type:'pixel-fps:request-character',token}, '*');
  };
  window.addEventListener('message', async event => {
    if (event.source === $('character-frame').contentWindow && event.data?.type === 'pixel-fps:editor-ready') {
      event.source.postMessage({type:'pixel-fps:set-character',character:BlockCharacter.exportData(world.player.character.params,world.player.face)}, '*');
      return;
    }
    if (event.source !== $('character-frame').contentWindow || event.data?.type !== 'pixel-fps:character' || event.data.token !== waitingCharacter?.token) return;
    clearTimeout(waitingCharacter.timeout); waitingCharacter = null;
    try { await applyProject(BlockCharacter.parseProject(event.data.character)); closeDialog('character-dialog'); $('pause-screen').hidden = true; }
    catch (error) { showToast('角色未应用：' + error.message); }
  });
  dialogs.forEach(id => $(id).addEventListener('cancel', () => { if (started) $('pause-screen').hidden = false; }));
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === $('arena')) {
      // Discard pointer recentering events generated while entering pointer lock.
      ignoreMouseUntil = performance.now() + 100;
      enterPlay();
    }
    else if (running) pause(true);
  });
  document.addEventListener('pointerlockerror', () => { ignoreMouseUntil = 0; if (!isDialogOpen()) { enterPlay(); showToast('拖动鼠标瞄准，或再次点击画面锁定鼠标'); } });
  window.addEventListener('keydown', event => {
    if ((event.code === 'F2' || event.code === 'Backquote') && !event.repeat && !$('character-dialog').open) {
      event.preventDefault();
      if ($('lab-dialog').open) closeDialog('lab-dialog');
      else if (!isDialogOpen()) openDialog('lab-dialog');
      return;
    }
    if ($('lab-dialog').open || event.target.closest?.('input,textarea,select,[contenteditable=true]')) return;
    if (isDialogOpen() && !$('inventory-dialog').open) return;
    if (event.code === 'Tab' && !isDialogOpen()) { event.preventDefault(); if (started) openDialog('inventory-dialog'); return; }
    if (!running || isDialogOpen()) return;
    if (['Space','KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;
    const result = controls.dispatch(event.code);
    if (result) doResult(result);
    if (event.code === 'Escape') pause(true);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => pause(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
  $('arena').addEventListener('mousedown', event => { if (event.button === 0 && running) mouseDown = true; });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  document.addEventListener('mousemove', event => {
    if (!running || isDialogOpen() || (document.pointerLockElement !== $('arena') && !mouseDown)) return;
    if (performance.now() < ignoreMouseUntil) return;
    world.player.yaw += event.movementX * sensitivity;
    world.player.pitch = Math.max(-1.48, Math.min(1.48, world.player.pitch - event.movementY * sensitivity));
  });
  $('arena').addEventListener('contextmenu', event => event.preventDefault());
  $('arena').addEventListener('wheel', event => {
    if (!running || isDialogOpen() || !world.player.inventory.weapons.length) return;
    event.preventDefault();const inventory=world.player.inventory;
    doResult(controls.selectWeapon((inventory.selected+(event.deltaY>0?1:-1)+inventory.weapons.length)%inventory.weapons.length));
  },{passive:false});

  function frame(now) {
    const elapsed = Math.min(.1, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    if (running && !lab.paused) {
      accumulator += elapsed * lab.timeScale;
      while (accumulator >= 1 / 120) {
        world.update(1 / 120, {forward:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),right:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),jump:keys.has('Space'),fire:mouseDown,sprint:keys.has('ShiftLeft')||keys.has('ShiftRight')});
        accumulator -= 1 / 120;
      }
      if (!world.player.alive || world.player.hp <= 0) {
        pause(true); $('pause-title').textContent = '本轮训练结束'; $('pause-copy').textContent = '可以重新开始，或调整体型再试一次。'; $('resume-game').textContent = '重新开始训练';
      }
    }
    if (lab?.paused) accumulator = 0;
    if (now - hudTime > 90) { refreshHud(); hudTime = now; }
    $('hit-marker').style.opacity = now < hitUntil ? '1' : '0';
    document.body.classList.toggle('damage', now < damageUntil);
    if (now > toastUntil) $('toast').classList.remove('show');
    renderer.render(world);
    requestAnimationFrame(frame);
  }

  try {
    renderer = new PixelFPSRenderer($('arena'));
    createWorld();
    try {
      const saved = localStorage.getItem(LAB_STORAGE_KEY);
      if (saved) lab.importScenarios(JSON.parse(saved));
    } catch (_) { showToast('已跳过不可读取的实验配置，可重新导入 JSON'); }
    labPanel = new PixelFPSLabPanel({
      getLab:() => lab,
      onChange:() => {
        accumulator = 0;
        $('moving-targets').checked = world.targetsMoving;
        $('enemy-fire').checked = world.enemyFire;
        $('character-summary').textContent = describeCharacter();
        $('settings-character').textContent = describeCharacter();
        try { localStorage.setItem(LAB_STORAGE_KEY,JSON.stringify(lab.scenarios)); }
        catch (_) { showToast('当前实验仍可使用；浏览器无法保存，请导出配置 JSON'); }
        refreshHud();
      },
      onClose:() => closeDialog('lab-dialog'),
      onPlay:() => { if (!world.player.alive) lab.refill(); resume(); }
    });
    inventoryPanel = new PixelFPSInventoryPanel({
      getWorld:()=>world,getActions:()=>controls,onResult:doResult,
      onUseSkill:id=>{closeDialog('inventory-dialog');resume().then(()=>cast(id));},
      onBindingsChanged:saveBindings,
      onResetBindings:()=>{controls=new PixelFPSPlayerActions(world);saveBindings();showToast('已恢复 Q / F / G 默认技能键位');}
    });
    window.PixelFPSApp = Object.freeze({ get world(){return world;}, get renderer(){return renderer;}, get lab(){return lab;}, get actions(){return controls;}, applyProject, pause, resume, reset:createWorld, cast });
    requestAnimationFrame(frame);
  } catch (error) {
    $('boot-error').hidden = false; $('boot-error').textContent = '训练场启动失败：' + error.message;
    $('start-game').disabled = true;
    console.error(error);
  }
})();
