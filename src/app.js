(async function () {
  'use strict';
  const Model = globalThis.BlockCharacter;
  const STORAGE_KEY = 'fps.block-character.v1';
  const $ = id => document.getElementById(id);
  const controls = [
    { key:'headScale', part:'head', parts:['head'], label:'头部大小', group:'scale-controls', unit:'×' },
    { key:'torsoScale', part:'torso', parts:['torso'], label:'躯干大小', group:'scale-controls', unit:'×' },
    { key:'armLength', part:'leftArm', parts:['leftArm','rightArm'], label:'手臂长度', group:'arm-controls', unit:'m' },
    { key:'legLength', part:'leftLeg', parts:['leftLeg','rightLeg'], label:'腿部长度', group:'leg-controls', unit:'m' }
  ];
  let params = { ...Model.DEFAULTS };
  let character, selected = 'head', viewport = null, painter = null, announceTimer, statusTimer;
  let currentFace = null, editMode = 'body';
  let storageAvailable = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      const project = Model.parseProject(state.character);
      params = project.parameters;
      currentFace = project.face;
      if (project.migrationNotes.length) $('status').textContent = project.migrationNotes.join(' ');
    }
  } catch (error) {
    if (error.name === 'SecurityError') storageAvailable = false;
    else $('status').textContent = '已跳过无效的本机存档';
  }
  const cm = n => +(n * 100).toFixed(1);
  const dimensions = part => part.size.map(cm).join(' × ') + ' cm';
  const volume = part => +(part.size.reduce((v,n) => v*n, 1000)).toFixed(2);
  function status(message) {
    clearTimeout(statusTimer);
    $('status').textContent = message;
    statusTimer = setTimeout(() => { $('status').textContent = '就绪'; }, 4500);
  }
  function save() {
    if (window.parent !== window) {
      $('save-state').textContent = '点击「应用角色」保存到训练场';
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ character: Model.exportData(params, currentFace) }));
      storageAvailable = true;
    } catch (_) { storageAvailable = false; }
    $('save-state').textContent = storageAvailable ? '已保存于此浏览器' : '可导出角色文件保存';
  }
  function select(partId, focus = false) {
    if (!character.parts.some(p => p.id === partId)) return;
    selected = partId;
    viewport?.setSelected(editMode === 'face' ? null : partId);
    for (const c of controls) $(c.key + '-row').classList.toggle('selected', c.parts.includes(partId));
    const part = character.parts.find(p => p.id === partId);
    const label = part.id.endsWith('Arm') ? '双臂（每侧）' : part.id.endsWith('Leg') ? '双腿（每侧）' : part.name;
    $('selection-caption').textContent = `${label} · ${dimensions(part)}`;
    if (focus) controls.find(c => c.parts.includes(partId)) && $(controls.find(c => c.parts.includes(partId)).key + '-number').focus({preventScroll:true});
  }
  function render(persist = true) {
    character = Model.createCharacter(params);
    params = character.params;
    for (const c of controls) {
      const range = $(c.key + '-range'), number = $(c.key + '-number');
      range.value = params[c.key];
      number.value = params[c.key] === +params[c.key].toFixed(2) ? params[c.key].toFixed(2) : String(params[c.key]);
      range.style.setProperty('--fill', ((params[c.key] - Model.LIMITS[c.key].min) / (Model.LIMITS[c.key].max - Model.LIMITS[c.key].min) * 100) + '%');
      const part = character.parts.find(p => p.id === c.part);
      $(c.key + '-dimension').textContent = dimensions(part) + (c.unit === '×' ? ` · ${volume(part)} L` : '');
    }
    $('height-value').value = character.standingHeight.toFixed(2);
    for (const button of document.querySelectorAll('[data-preset]')) {
      const preset = Model.PRESETS[button.dataset.preset];
      button.setAttribute('aria-pressed', String(Object.keys(Model.DEFAULTS).every(k => Math.abs(params[k] - preset[k]) < 1e-8)));
    }
    const notes = [];
    if (character.height - character.standingHeight > 1e-8) notes.push(`手臂低于脚底，模型总高 ${character.height.toFixed(2)} m；预览以最低点落地。`);
    $('geometry-notice').textContent = notes.join(' ');
    viewport?.setCharacter(character);
    select(selected);
    if (persist) save();
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { $('announcer').textContent = `身高 ${character.standingHeight.toFixed(2)} 米，六个部件已更新。`; }, 250);
  }
  function update(c, raw) {
    const value = Number(raw), bounds = Model.LIMITS[c.key];
    if (!Number.isFinite(value) || raw === '') { render(false); status('请输入有效数字'); return; }
    const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
    params[c.key] = +clamped.toFixed(2);
    selected = c.part;
    render();
    if (clamped !== value) status(`已限制到 ${bounds.min}–${bounds.max} ${c.unit}`);
  }
  for (const c of controls) {
    const limit = Model.LIMITS[c.key];
    const row = document.createElement('div');
    row.className = 'param-row'; row.id = c.key + '-row';
    row.innerHTML = `<div class="param-top"><label class="part-label" for="${c.key}-range">${c.label}</label><label class="number-wrap"><span class="sr-only">${c.label}数值</span><input id="${c.key}-number" type="number" min="${limit.min}" max="${limit.max}" step="0.01" inputmode="decimal" aria-describedby="${c.key}-dimension"><span>${c.unit}</span></label></div><input id="${c.key}-range" type="range" min="${limit.min}" max="${limit.max}" step="0.01" aria-describedby="${c.key}-dimension"><div class="dimension" id="${c.key}-dimension"></div>`;
    $(c.group).appendChild(row);
    $(c.key + '-range').addEventListener('input', e => update(c, e.target.value));
    $(c.key + '-number').addEventListener('change', e => update(c, e.target.value));
    $(c.key + '-number').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    row.addEventListener('focusin', () => select(c.part));
    row.querySelector('.part-label').addEventListener('click', () => select(c.part));
  }
  const scaleNote = document.createElement('p');
  scaleNote.className = 'group-note';
  scaleNote.textContent = '头部、躯干保持各自比例，宽、高、深一起缩放。';
  $('scale-controls').appendChild(scaleNote);
  function applyPreset(name) {
    params = { ...Model.PRESETS[name] };
    render(); viewport?.fit();
    status('已应用起始体型');
  }
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $('reset-button').addEventListener('click', () => { applyPreset('default'); selected = 'head'; select('head'); });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    viewport?.setView(button.dataset.view);
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  $('fit-button').addEventListener('click', () => viewport?.fit());
  $('viewport').addEventListener('pointermove', e => {
    if (e.buttons) document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  });
  function setMode(mode) {
    painter?.finishStroke();
    editMode = mode;
    const isFace = mode === 'face';
    document.querySelector('.app').classList.toggle('face-mode', isFace);
    $('body-panel').hidden = isFace;
    $('face-panel').hidden = !isFace;
    $('body-metric').hidden = isFace;
    $('face-metric').hidden = !isFace;
    $('studio-badge').textContent = isFace ? '只绘制正面' : '6 个方块 · 实时预览';
    $('module-state').textContent = isFace ? '正面画脸' : '体型编辑';
    for (const name of ['body', 'face']) {
      $(name + '-tab').setAttribute('aria-selected', String(name === mode));
      $(name + '-tab').tabIndex = name === mode ? 0 : -1;
    }
    const view = isFace ? 'front' : 'perspective';
    viewport?.setView(view);
    viewport?.setFocusPart(isFace ? 'head' : null);
    select('head');
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  }
  $('body-tab').addEventListener('click', () => setMode('body'));
  $('face-tab').addEventListener('click', () => setMode('face'));
  $('start-face-button').addEventListener('click', () => setMode('face'));
  $('face-tab').tabIndex = -1;
  document.querySelector('.module-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault();
    const mode = e.key === 'Home' ? 'body' : e.key === 'End' ? 'face' : editMode === 'face' ? 'body' : 'face';
    setMode(mode); $(mode + '-tab').focus();
  });
  $('export-button').addEventListener('click', () => {
    painter?.finishStroke();
    const content = JSON.stringify(Model.exportData(params, currentFace), null, 2) + '\n';
    const url = URL.createObjectURL(new Blob([content], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'block-character.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    status('已导出体型与画好的脸');
  });
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    painter.finishStroke();
    document.querySelector('.app').inert = true;
    try {
      if (file.size > 1024 * 1024) throw new Error('角色文件不能超过 1 MB');
      const imported = Model.parseProject(await file.text());
      const decoded = await painter.decodeFace(imported.face);
      painter.replaceFace(decoded, {notify:false, resetHistory:true});
      params = imported.parameters;
      currentFace = imported.face;
      viewport?.setFaceTexture($('face-canvas'));
      $('undo-button').disabled = true; $('redo-button').disabled = true;
      render(); viewport?.fit();
      status(imported.migrationNotes.length ? imported.migrationNotes.join(' ') : '角色导入成功');
    } catch (error) { status('导入失败：' + error.message); }
    finally { e.target.value = ''; document.querySelector('.app').inert = false; }
  });
  try { viewport = new globalThis.BlockViewport($('viewport'), { onSelect: id => select(editMode === 'face' ? 'head' : id) }); }
  catch (error) {
    $('viewport-error').hidden = false;
    $('viewport-error').textContent = '三维预览未能启动。请在支持 WebGL 的浏览器中打开，并启用硬件加速。尺寸调整与导出仍可使用。';
    console.error(error);
  }
  painter = new globalThis.FacePainter($('face-canvas'), {
    onChange: canvas => viewport?.setFaceTexture(canvas),
    onCommit: () => { currentFace = painter.getFaceData(); save(); },
    onHistoryChange: ({canUndo, canRedo}) => {
      $('undo-button').disabled = !canUndo; $('redo-button').disabled = !canRedo;
    }
  });
  function setTool(tool) {
    painter.setTool(tool);
    $('brush-button').setAttribute('aria-pressed', String(tool === 'brush'));
    $('eraser-button').setAttribute('aria-pressed', String(tool === 'eraser'));
    $('paint-tool-hint').textContent = tool === 'brush' ? '按住拖动绘制' : '擦除后恢复底色';
  }
  const colors = [
    ['#20242b','黑色'],['#ffffff','白色'],['#868d96','灰色'],['#70452e','棕色'],
    ['#e85a4f','红色'],['#ed9661','橙色'],['#f1cf60','黄色'],['#d9af8a','肤色'],
    ['#4e9665','绿色'],['#66bfc3','青色'],['#3974c3','蓝色'],['#5752a1','靛色'],
    ['#aa6aba','紫色'],['#e58aa7','粉色'],['#c7d4a6','浅绿'],['#b9d8ed','浅蓝']
  ];
  function setColor(color) {
    painter.setColor(color); $('paint-color').value = color;
    document.querySelectorAll('[data-paint-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.paintColor === color.toLowerCase())));
    setTool('brush');
  }
  for (const [color,name] of colors) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.paintColor = color;
    button.setAttribute('aria-label', name); button.setAttribute('aria-pressed', String(color === '#20242b'));
    button.style.setProperty('--swatch',color);
    button.innerHTML = '<span aria-hidden="true"></span>';
    button.addEventListener('click', () => setColor(color));
    $('paint-palette').appendChild(button);
  }
  setColor('#20242b');
  $('paint-color').addEventListener('input', e => setColor(e.target.value));
  $('brush-button').addEventListener('click', () => setTool('brush'));
  $('eraser-button').addEventListener('click', () => setTool('eraser'));
  $('brush-size').addEventListener('input', e => {
    painter.setSize(+e.target.value); $('brush-size-value').value = e.target.value;
  });
  $('undo-button').addEventListener('click', () => { painter.undo(); status('已撤销'); });
  $('redo-button').addEventListener('click', () => { painter.redo(); status('已重做'); });
  $('clear-face-button').addEventListener('click', () => { painter.clear(); status('画板已清空，可撤销'); });
  document.addEventListener('keydown', e => {
    if (editMode !== 'face' || !(e.ctrlKey || e.metaKey) || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) painter.redo(); else painter.undo();
    }
  });
  if (currentFace) {
    try { painter.replaceFace(await painter.decodeFace(currentFace), {notify:false,resetHistory:true}); }
    catch (_) { currentFace = null; status('已恢复体型，无法读取的面部图片已跳过'); }
  }
  viewport?.setFaceTexture($('face-canvas'));
  render(false);
  if (!storageAvailable) $('save-state').textContent = '可导出角色文件保存';
  globalThis.BlockCharacterApp = Object.freeze({ getParameters: () => ({...params}), getCharacter: () => Model.createCharacter(params), getFaceData: () => currentFace ? {...currentFace} : null });
  document.querySelector('.app').inert = false;
  document.querySelector('.app').setAttribute('aria-busy','false');
  // The combat demo embeds this editor. Exchange only with its own parent/opener.
  window.addEventListener('message', async event => {
    const trusted = (window.parent !== window && event.source === window.parent) || (window.opener && event.source === window.opener);
    if (!trusted || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'pixel-fps:request-character') {
      event.source.postMessage({type:'pixel-fps:character',token:event.data.token,character:Model.exportData(params,currentFace)}, '*');
    } else if (event.data.type === 'pixel-fps:set-character') {
      try {
        const parsed = Model.parseProject(event.data.character);
        const decoded = parsed.face ? await painter.decodeFace(parsed.face) : null;
        params = {...parsed.parameters}; currentFace = parsed.face;
        painter.replaceFace(decoded, {notify:false,resetHistory:true});
        viewport?.setFaceTexture($('face-canvas')); render();
      } catch (error) { status('无法载入训练场角色：' + error.message); }
    }
  });
  if (window.parent !== window) window.parent.postMessage({type:'pixel-fps:editor-ready'}, '*');
})();
