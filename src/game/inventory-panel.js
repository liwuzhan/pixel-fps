(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const element = (tag,className,text) => { const node=document.createElement(tag); if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; };
  function icon(key) { const node=element('span','item-icon');node.setAttribute('aria-hidden','true');node.innerHTML=root.PixelFPSItemVisuals.icon(key);return node; }
  function button(label,run,disabled=false) { const node=element('button','',label);node.type='button';node.disabled=disabled;node.onclick=run;return node; }

  /** Inventory view only. All changes go through the player's action interface. */
  class PixelFPSInventoryPanel {
    constructor({getWorld,getActions,onResult,onUseSkill,onBindingsChanged,onResetBindings}) {
      this.getWorld=getWorld;this.getActions=getActions;this.onResult=onResult;this.onUseSkill=onUseSkill;this.onBindingsChanged=onBindingsChanged;
      $('reset-bindings').onclick=()=>{onResetBindings();this.render();};
    }
    perform(action) { const result=action(this.getActions());this.onResult(result);this.render();return result; }
    row(key,title,detail) {
      const row=element('div','inventory-row');
      const info=element('div','inventory-item');const text=element('div','item-copy');
      text.append(element('strong','',title),element('small','',detail));info.append(icon(key),text);
      const actions=element('div','actions');row.append(info,actions);return {row,actions};
    }
    amountControl(max,run,label='丢弃数量') {
      const wrap=element('div','drop-amount');const input=element('input');input.type='number';input.min='1';input.max=String(Math.max(1,max));input.step='1';input.value='1';input.disabled=max<1;input.setAttribute('aria-label',label);
      wrap.append(input,button('丢到地上',()=>{if(input.reportValidity())this.perform(a=>run(a,Number(input.value)));},max<1));return wrap;
    }
    render() {
      const world=this.getWorld(),inventory=world.player.inventory,controls=this.getActions();
      $('inventory-resources').textContent=`通用弹药 ${inventory.ammo}　蓝瓶 ${inventory.manaPotions}　武器 ${inventory.weapons.length} 件　击倒 ${world.kills}`;
      const supplyRows=[['ammo','通用弹药',inventory.ammo,'所有枪械共用；不同武器每次消耗量可以不同。'],['mana','蓝瓶',inventory.manaPotions,`每瓶恢复 ${root.PixelFPSContent.RESOURCES.mana.restore} 蓝量，不改变头部决定的蓝量容量。`]].map(([key,name,count,description])=>{
        const {row,actions}=this.row(key,`${name} × ${count}`,description);row.dataset.supply=key;
        if(key==='mana')actions.append(button('使用一瓶',()=>this.perform(a=>a.useManaPotion()),!world.player.alive||!count||world.player.mana>=world.player.maxMana));
        actions.append(this.amountControl(count,(a,amount)=>a.drop({kind:key,amount}),name+'丢弃数量'));return row;
      });
      $('inventory-supplies').replaceChildren(...supplyRows);
      const weaponRows=inventory.weapons.map((weapon,index)=>{
        const definition=root.PixelFPSContent.WEAPONS[weapon.type];
        const detail=`${index===inventory.selected?'当前手持 · ':''}${definition?.description||''} · ${definition?.ammoCost?`每次 ${definition.ammoCost} 通用弹药`:'不消耗弹药'}`;
        const {row,actions}=this.row(weapon.type,`${index+1}. ${definition?.label||weapon.type}`,detail);
        row.dataset.weaponId=weapon.id;row.dataset.weaponType=weapon.type;row.classList.toggle('selected',index===inventory.selected);
        actions.append(button('手持',()=>this.perform(a=>a.selectWeapon(index)),index===inventory.selected),button('丢到地上',()=>this.perform(a=>a.drop({kind:'weapon',weaponId:weapon.id}))));return row;
      });
      $('inventory-weapons').replaceChildren(...(weaponRows.length?weaponRows:[element('p','empty','尚未持有武器。靠近地面物资按 E 拾取，也可到实验台发放。')]));
      const skillRows=Object.entries(world.skills.definitions).map(([id,definition])=>{
        const state=world.skills.getState(id),stored=inventory.skills[id],tiers=Object.entries(stored?.levels||{}).filter(([,count])=>count>0).sort((a,b)=>Number(b[0])-Number(a[0]));
        const card=element('div','inventory-skill');card.dataset.skillId=id;
        const kind=definition.kind==='ultimate'?'消耗型终极':'普通技能';
        const condition=state.remaining>0?`冷却 ${state.remaining.toFixed(1)} 秒`:state.count?'就绪':'尚未持有';
        const {row,actions}=this.row(id,`${definition.name||id} · Lv.${state.level}`,`${kind} · ${state.manaCost} 蓝量 · ${condition}${state.active?' · 生效中':''}`);
        actions.append(button('使用',()=>this.onUseSkill(id),!state.count||state.remaining>0||!world.player.alive));
        if(definition.kind!=='ultimate')actions.append(button('三合一升级',()=>this.perform(a=>a.mergeSkill(id)),!tiers.some(([,n])=>n>=3)));
        const bindLabel=element('label','binding-label','快捷键 '),select=element('select');select.setAttribute('aria-label',(definition.name||id)+'快捷键');select.dataset.bindSkill=id;
        select.append(new Option('未绑定',''));
        root.PixelFPSPlayerActions.CODES.forEach(code=>select.add(new Option(code.slice(3),code)));
        select.value=controls.keyForSkill(id)||'';
        select.onchange=()=>{
          const old=controls.keyForSkill(id);
          const result=select.value?controls.bindSkill(select.value,id):old?controls.bindSkill(old,null):{ok:true,message:'保持未绑定。'};
          this.onResult(result);if(result.ok)this.onBindingsChanged();this.render();
        };
        bindLabel.append(select);actions.append(bindLabel);card.append(row);
        if(definition.description)card.append(element('p','skill-description',definition.description));
        for(const [level,count] of tiers){
          const tier=element('div','inventory-tier');tier.dataset.level=level;
          tier.append(element('span','',`${level} 级 × ${count}`),this.amountControl(count,(a,amount)=>a.drop({kind:'skill',skillId:id,level:Number(level),amount}),`${definition.name||id} ${level}级丢弃数量`));card.append(tier);
        }
        return card;
      });
      $('inventory-skills').replaceChildren(...skillRows);
    }
  }
  root.PixelFPSInventoryPanel=PixelFPSInventoryPanel;
})(globalThis);
