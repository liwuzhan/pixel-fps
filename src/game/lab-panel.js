(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
  const parts = { head:'头部',torso:'躯干',leftArm:'左臂',rightArm:'右臂',leftLeg:'左腿',rightLeg:'右腿' };
  const statusNames = { weaken:'虚弱',silence:'沉默',stun:'眩晕',root:'定身',slow:'减速',disarmed:'缴械',invulnerable:'无敌' };
  const scenarioNames = { shooting:'基础射击',merge:'连续三合一',weakness:'虚弱与还击' };
  function download(name, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  class PixelFPSLabPanel {
    constructor({getLab,onChange,onClose,onPlay}) {
      this.getLab = getLab; this.onChange = onChange; this.history = []; this.historyIndex = 0;
      this.lastLogKey = ''; this.logWorld = null;
      $('lab-close').onclick = onClose;
      $('lab-play').onclick = () => { this.getLab().resume(); onPlay(); };
      $('lab-dialog').querySelectorAll('[data-command]').forEach(button => button.onclick = () => this.run(button.dataset.command));
      $('console-form').onsubmit = event => { event.preventDefault(); const text = $('console-input').value.trim(); if (text) this.run(text); $('console-input').value = ''; $('console-input').focus(); };
      $('console-input').addEventListener('keydown', event => {
        if (!['ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        this.historyIndex = Math.max(0,Math.min(this.history.length,this.historyIndex+(event.key==='ArrowUp'?-1:1)));
        $('console-input').value = this.history[this.historyIndex] || '';
      });
      $('lab-speed').onchange = () => this.run('time scale '+$('lab-speed').value);
      for (const key of ['mana','ammo','cooldown']) $('cheat-'+key).onchange = () => this.run(`cheat ${key} ${$('cheat-'+key).checked?'on':'off'}`);
      $('lab-step').onclick = () => this.step(1);
      $('lab-step-second').onclick = () => this.step(120);
      $('lab-dummy-spawn').onclick = () => this.run('dummy spawn '+$('lab-dummy-preset').value);
      $('lab-dummy-select').onchange = () => this.fillDummy();
      $('lab-dummy-remove').onclick = () => this.mutate(() => this.getLab().removeDummy($('lab-dummy-select').value),'木桩已移除');
      $('lab-dummy-form').onsubmit = event => {
        event.preventDefault();
        const read = key => Number($('dummy-'+key).value);
        this.mutate(() => this.getLab().configureDummy($('lab-dummy-select').value,{
          parameters:{headScale:read('head'),torsoScale:read('torso'),armLength:read('arms'),legLength:read('legs')},
          pos:[read('x'),read('y'),read('z')],
          training:{behavior:$('dummy-move').value==='inherit'?null:$('dummy-move').value,fire:$('dummy-fire').value==='inherit'?null:$('dummy-fire').value==='on',autoRecover:$('dummy-recover').checked,autoRespawn:$('dummy-respawn').checked,respawnDelay:read('delay')}
        }),'木桩配置已应用');
      };
      $('lab-scenario-save').onclick = () => this.mutate(() => this.getLab().saveScenario($('lab-scenario-name').value.trim()),'实验配置已保存');
      $('lab-scenario-load').onclick = () => this.mutate(() => this.getLab().loadNamedScenario($('lab-scenario-select').value),'实验已重新布置');
      $('lab-scenario-delete').onclick = () => this.mutate(() => this.getLab().deleteScenario($('lab-scenario-select').value),'自存场景已删除');
      $('lab-scenario-export').onclick = () => download('pixel-fps-experiment.json',this.getLab().snapshot());
      $('lab-scenario-import').onclick = () => $('lab-scenario-file').click();
      $('lab-scenario-file').onchange = async event => {
        const file = event.target.files[0]; if (!file) return;
        try {
          if (file.size > 1024*1024) throw Error('实验配置文件不能超过 1 MB');
          const data = JSON.parse(await file.text());
          this.mutate(() => this.getLab().loadScenario(data),'实验配置已导入；可命名保存到场景列表');
        } catch (error) { this.write(error.message,false); }
        event.target.value='';
      };
      $('lab-log-filter').onchange = () => this.renderLog();
      $('lab-log-export').onclick = () => download('pixel-fps-combat-log.json',this.getLab().world.combatLog);
      this.write('输入 help 查看指令。左侧快捷操作也调用同一套实验接口。');
    }
    write(message,ok=true) {
      const line = document.createElement('div'); line.className = ok?'console-result':'console-error'; line.textContent = String(message);
      $('console-output').append(line);
      while ($('console-output').childElementCount > 100) $('console-output').firstElementChild.remove();
      $('console-output').scrollTop = $('console-output').scrollHeight;
    }
    run(text) {
      this.write('> '+text);
      this.history.push(text); if (this.history.length>80) this.history.shift(); this.historyIndex=this.history.length;
      const result = this.getLab().execute(text);
      this.write(result.message,result.ok);
      if (result.ok && result.data !== undefined && /^(list(?:\s|$)|scenario\s+list(?:\s|$))/.test(text)) this.write(JSON.stringify(result.data,null,2));
      this.onChange(); this.refresh(); return result;
    }
    mutate(action,message) {
      try { action(); this.write(message); this.onChange(); this.refresh(); }
      catch(error) { this.write(error.message,false); }
    }
    step(frames) { this.mutate(() => { this.getLab().pause(); this.getLab().step(frames); },`已推进 ${frames} 帧（${number(frames/120)} 秒）`); }
    refresh() {
      const lab=this.getLab(), world=lab.world;
      for (const [key,field] of [['mana','infiniteMana'],['ammo','infiniteAmmo'],['cooldown','noCooldown']]) $('cheat-'+key).checked=!!world.cheats[field];
      const speed=$('lab-speed');
      if (![...speed.options].some(o=>Number(o.value)===lab.timeScale)) speed.add(new Option(number(lab.timeScale)+'×',String(lab.timeScale)));
      speed.value=String(lab.timeScale);
      const previous=$('lab-dummy-select').value;
      $('lab-dummy-select').replaceChildren(...world.actors.filter(a=>a!==world.player).map(a=>new Option(`${a.label} · ${a.id}`,a.id)));
      if (world.actors.some(a=>a!==world.player && a.id===previous)) $('lab-dummy-select').value=previous;
      this.fillDummy();
      const selected=$('lab-scenario-select').value;
      const scenarios=lab.listScenarios();
      $('lab-scenario-select').replaceChildren(...scenarios.map(s=>new Option(s.builtin?`预设 · ${scenarioNames[s.name]||s.name}`:`自存 · ${s.name}`,s.name)));
      if (scenarios.some(s=>s.name===selected)) $('lab-scenario-select').value=selected;
      this.update();
    }
    fillDummy() {
      const actor=this.getLab().world.findActor($('lab-dummy-select').value);
      $('lab-dummy-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=!actor);
      if (!actor) { $('lab-dummy-info').textContent='场上没有木桩，可在上方新增。'; return; }
      const p=actor.character.params,t=actor.training||{};
      for(const [key,value] of Object.entries({head:p.headScale,torso:p.torsoScale,arms:p.armLength,legs:p.legLength,x:actor.pos[0],y:actor.pos[1],z:actor.pos[2],delay:t.respawnDelay??1})) $('dummy-'+key).value=Number(value.toFixed(3));
      $('dummy-move').value=t.behavior??'inherit'; $('dummy-fire').value=t.fire==null?'inherit':t.fire?'on':'off';
      $('dummy-recover').checked=!!t.autoRecover; $('dummy-respawn').checked=!!t.autoRespawn;
      $('lab-dummy-info').textContent=`生命 ${number(actor.hp)} / ${number(actor.maxHp)} · 蓝量容量 ${number(actor.maxMana)} · 自然身高 ${number(actor.character.standingHeight)} m · ${actor.alive?'存活':'已倒下'}${actor.statuses.length?' · 状态：'+actor.statuses.map(s=>statusNames[s.type]||s.type).join('、'):''}`;
    }
    update() {
      const lab=this.getLab();
      $('lab-clock').textContent=`世界时间 ${number(lab.world.time)} s · ${number(lab.timeScale)}×${lab.paused?' · 时间已暂停':''}`;
      this.renderLog();
    }
    renderLog() {
      const world=this.getLab().world, filter=$('lab-log-filter').value;
      const log=world.combatLog||[],key=`${log.length}:${log.at(-1)?.id}:${filter}`;
      if(this.logWorld===world&&this.lastLogKey===key)return;
      this.logWorld=world;this.lastLogKey=key;
      const rows=log.filter(e=>filter==='all'||filter==='damage'&&e.type==='damage'||filter==='status'&&e.type.startsWith('status-')).slice(-80).reverse();
      if (!rows.length) { $('lab-log').textContent='还没有记录。向木桩开火，或用 status add 指令施加状态。'; return; }
      const table=document.createElement('table'),head=document.createElement('thead');
      const hr=document.createElement('tr');
      ['时间','对象 / 事件','结算详情'].forEach(text=>{const th=document.createElement('th');th.textContent=text;hr.append(th);});head.append(hr);table.append(head);
      const body=document.createElement('tbody');
      const name=id=>world.findActor(id)?.label||id||'—';
      for(const event of rows){
        const tr=document.createElement('tr');
        let subject=event.type,details='';
        if(event.type==='damage'){
          subject=`${name(event.sourceId)} → ${name(event.targetId)}\n${root.PixelFPS.WEAPONS[event.weaponId]?.label||event.weaponId||'攻击'} · ${parts[event.partId]||event.partId||'未指定部位'}`;
          details=`${number(event.baseDamage)} × ${number(event.multiplier)} = ${number(event.modifiedDamage)}\n实际扣血 ${number(event.actualDamage)}；生命 ${number(event.hpBefore)} → ${number(event.hpAfter)}`;
          if(event.blockedReason)details+=`\n阻止原因：${({invulnerable:'无敌',dead:'目标已倒下'})[event.blockedReason]||event.blockedReason}`;
          if(event.fatal)details+=' · 致命';
          if(event.modifiers?.length)details+='\n来源：'+event.modifiers.map(m=>`${statusNames[m.statusType]||m.statusType} (${m.sourceId||m.statusId})`).join('，');
        }else if(event.type.startsWith('status-')){
          subject=`${name(event.targetId)} · ${({'status-add':'添加状态','status-remove':'移除状态','status-expire':'状态到期'})[event.type]}`;
          details=`${statusNames[event.statusType]||event.statusType||event.status?.type||''} · 来源 ${event.sourceId||'—'}`;
          if(event.expiresAt!=null)details+=` · 到期 ${number(event.expiresAt)} s`;
        }else if(event.type==='skill-cast'){
          subject=`${name(event.sourceId)} · 发动技能`;
          details=`${world.skills.definitions[event.skillId]?.name||event.skillId} · ${event.level} 级\n消耗 ${number(event.manaSpent)} 蓝量、${number(event.copiesSpent)} 份材料`;
        }else{subject=`${name(event.targetId||event.actorId)} · ${({'recover':'自动回血','respawn':'木桩复活','dummy-spawn':'新增木桩','dummy-configure':'配置木桩','dummy-remove':'移除木桩','dummy-reset':'木桩复位'})[event.type]||event.type}`;details=event.amount!=null?`恢复 ${number(event.amount)}，生命 ${number(event.hpAfter)}`:event.label||event.reason||'';}
        for(const text of [number(event.time)+' s',subject,details]){const td=document.createElement('td');td.textContent=text;tr.append(td);}body.append(tr);
      }
      table.append(body);$('lab-log').replaceChildren(table);
    }
  }
  root.PixelFPSLabPanel=PixelFPSLabPanel;
})(globalThis);
