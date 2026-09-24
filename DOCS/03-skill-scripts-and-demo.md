# 技能脚本与玩法验证 demo

更新日期：2026-09-24

状态：单机训练场、实验木桩、作弊控制台及物资拾取—背包—使用—丢弃链路已实现。每个技能一份脚本，现用弹射背包、自瞄和虚弱榴弹验证即时运动、持续瞄准和投射物附加状态三种行为。技能界面从已注册定义生成；新增技能前可以直接布置实验、发放材料并查看结算。

## 项目目标与当前入口

当前基于网页的 3D 项目用于验证玩法。角色可以移动、攻击、拾取、合成和使用技能；方块模型、颜色、文字和简单状态提示用于观察规则。视觉效果不作为当前推进目标。

- `index.html`：可离线打开的完整训练场，包含嵌入的捏人、画脸编辑器。
- `block-character.html`：独立的捏人、正面画脸编辑器。
- [GitHub 仓库](https://github.com/liwuzhan/pixel-fps)：源码、构建后的入口页面、设计文档和测试。

捏人结果可以在训练场直接应用，也可以导出、导入角色 JSON。应用角色会重新开始训练场：头部体积影响蓝量容量，躯干体积影响血量容量，腿长影响速度，臂长影响小刀触及距离，六部件尺寸用于移动碰撞和受击判定。负重及临时整体巨大化尚未实现。

这是单机训练场，尚无联机、胜负、撤离或死亡掉落规则。场上提供手枪、步枪、小刀、火箭筒、通用弹药、蓝瓶和三个技能，正常训练中均需拾取，实验台可直接发放；枪械直接扣除共享弹药，无弹匣与换弹。靶子可移动、还击、复位。当前伤害、耗蓝、冷却、范围与升级公式都是验证数值。

## 当前文件如何分工

| 文件 | 已承担的职责 |
| --- | --- |
| `src/character.js` | 四个捏人参数、六方块几何、角色导入导出 |
| `src/app.js`、`src/face-painter.js`、`src/viewport.js` | 独立编辑器操作、画脸、编辑器预览，以及向训练场传递角色 |
| `src/game/content.js` | 武器与资源定义；技能定义仍由各自脚本注册 |
| `src/game/inventory.js` | 武器实例、资源数量与分级技能份数的校验和增减，不访问世界位置、计时或 DOM |
| `src/game/world.js` | 角色状态、地面与背包转移、移动碰撞、武器、小刀、投射物命中、爆炸、伤害、状态、训练场对象 |
| `src/game/player-actions.js` | 玩家操作请求与技能键位映射，将操作交给世界或技能运行入口，不依赖 DOM |
| `src/game/inventory-panel.js` | 背包显示、数量选择、合成和技能绑定，通过操作入口请求修改 |
| `src/game/skill-runtime.js` | 技能发动检查、资源消耗、冷却、每次发动的运行记录与结束；支持实验开关并记录成功施法 |
| `src/game/lab.js` | 发放物资、配置木桩、状态与时间控制、场景保存加载，以及共用这些方法的文本指令 |
| `src/game/lab-panel.js` | 实验台表单与控制台、结构化战斗记录、场景和日志 JSON 导出 |
| `src/skills/jetpack.js` | 弹射背包脚本 |
| `src/skills/autoaim.js` | 自动瞄准脚本 |
| `src/skills/weaken.js` | 虚弱榴弹脚本 |
| `src/game/item-visuals.js` | 用同一编号查找 SVG 图标与方块粗模，不定义武器效果 |
| `src/game/renderer.js` | 读取世界状态绘制角色、场景、物资、手持武器、投射物及简单效果，不修改结算状态 |
| `src/game/app.js` | 浏览器输入接入、HUD、窗口、设置保存、暂停、固定步长更新、角色编辑器接入 |
| `build.py` | 自动收集 `src/skills/*.js`，将源码内联为两个可离线运行的 HTML 入口 |
| `tests/` | 角色模型、战斗逻辑和技能脚本的自动验证 |

`world.js` 目前保留移动、碰撞与战斗结算的协作，背包记账、输入映射、内容参数和示意表现已独立。需要物资从地面进入背包时，由世界检查距离与遮挡，再调用背包；面板不能自行增加数量，渲染不能决定命中。更详细的边界见 [物资、背包与示意表现](05-items-and-presentation.md)。

## 一个技能对应自己的脚本

每份脚本导出一个技能定义，同时注册到 `globalThis.PixelFPSSkills`。构建自动收集 `src/skills/` 下的 JavaScript 文件，先加载 `skill-runtime.js`，再加载各技能脚本；页面创建 `World` 后，将 `new PixelSkillRuntime(world)` 挂到 `world.skills`。技能脚本应独立注册，不依赖另一个技能脚本先执行。

脚本描述由谁发动、作用于谁、何时做什么。当前发动者固定为 `world.player`；脚本可以访问自己、查询敌人、选择位置或方向。多玩家施法和切换控制到虚影还没有接入，不能仅通过指定另一个对象就获得完整的控制切换能力。

| 定义字段 | 当前含义 |
| --- | --- |
| `id`、`name`、`description` | 技能标识、名称和说明 |
| `kind` | `normal` 为可复用普通技能；`ultimate` 在成功发动时消耗一份 |
| `manaCost`、`cooldown`、`duration` | 数值或接收等级的函数；分别表示发动耗蓝、冷却秒数、持续秒数 |
| `canCast(instance)` | 可选的额外检查；应只检查条件，不产生副作用；可返回 `false`、失败文字或 `{ ok: false, message }` |
| `start(instance)` | 可选的开始行为；返回 `false` 或抛出错误表示启动失败 |
| `update(instance, dt)` | 持续技能每步执行；返回 `false` 可提前结束 |
| `end(instance, reason)` | 可选的结束清理；原因包括 `complete`、`death`、`dispose`、`failed` |

`manaCost`、`cooldown`、`duration` 均以本次发动等级求值。`duration: 0` 的即时技能只执行开始和可选的结束，不加入持续实例列表。它创建的弹丸仍可由世界继续更新，不会因技能的即时阶段结束而消失。

每次发动拥有独立记录：

| 实例字段 | 用途 |
| --- | --- |
| `id`、`skillId` | 本次发动的唯一编号及技能种类 |
| `world`、`caster` | 场景接口与施法者 |
| `definition`、`level` | 对应脚本定义及本次发动时的等级 |
| `age`、`duration`、`remaining` | 已持续时间、初始持续时间、剩余时间 |
| `record` | 该次发动自己的对象，例如锁定目标、弹丸编号、是否已经爆开 |

同一技能多次发动不会共用 `record`。例如连续使用两份自瞄会扣除两份物品与两次蓝量，建立两个分别结束的实例；它们当前作用于同一玩家瞄准，不代表会生成额外枪口或提高枪械射速。

## 共用运行入口负责什么

`PixelSkillRuntime` 的主要入口如下：

| 入口 | 行为 |
| --- | --- |
| `cast(id)` | 检查脚本、角色存活、持有份数、沉默/眩晕、冷却、参数和蓝量，再执行脚本额外检查；成功后消耗资源、启动冷却与脚本，返回 `{ ok, message }` |
| `getState(id)` | 返回等级、持有份数、耗蓝、总冷却与剩余冷却、持续时间和当前实例数量，供界面显示 |
| `update(dt)` | 推进冷却和持续技能；施法者死亡或持续结束时调用结束逻辑 |
| `dispose()` | 结束当前持续实例并清空冷却；页面重建训练场时调用 |

发动普通技能不减少持有份数，发动终极调用世界的 `consumeSkill(id, 1)`。检查和扣除按请求顺序进行，后一个请求看到的是已更新的余额。技能实例数量没有额外槽位限制。

实验台的无限蓝量使发动跳过蓝量不足检查并且不扣蓝；无技能冷却使剩余冷却显示为零、允许发动并且不写入新的技能冷却。它们仍通过同一个 `cast` 入口，仍检查持有、存活、沉默/眩晕及脚本自身条件，终极仍消耗一份。无限弹药由武器开火结算处理，不改变射速。`cooldown clear` 则一次性清除玩家武器与技能的现有冷却。成功施法写入 `world.combatLog`，记录技能、等级、实际耗蓝和消耗份数。

若 `start` 失败，运行入口恢复本次扣除的蓝量、技能份数和冷却，并调用 `end(instance, "failed")`。脚本此前已经创建的对象或写入的其他状态，需要该脚本自行清理；运行入口不是任意脚本副作用的自动回滚器。因此能提前判断的条件应放在 `canCast`。

世界每次更新先清理到期状态、推进技能，再处理玩家移动与开火。自瞄写入的方向因此能被这一轮开火使用。暂停训练场时，世界更新和技能计时一起暂停。

## 脚本现在能使用哪些能力

| 需求 | 当前接口或数据 |
| --- | --- |
| 找对象 | `world.findActor(id)`、`world.enemiesOf(caster)` |
| 读取几何 | `world.eye(actor)`、`world.actorBoxes(actor)`；后者返回六部件的中心与尺寸 |
| 读取瞄准与遮挡 | `world.aimDirection(actor)`、`world.lineOfSight(from, to)` |
| 改变运动 | 修改 `caster.vel`；弹射后将 `caster.grounded` 设为 `false`，后续由世界统一移动和碰撞 |
| 改变实际瞄准 | 写入 `caster.yaw`、`caster.pitch`；武器与视角使用同一份值 |
| 创建投射物 | `world.spawnProjectile(options)`，支持位置、速度、来源、队伍、伤害、半径、重力、寿命及 `onHit` 回调 |
| 添加状态 | `world.applyStatus(actor, type, duration, sourceId, data)`；返回带独立编号与到期时间的状态 |
| 查询状态、造成伤害 | `world.hasStatus(actor, type)`、`world.damage(actor, amount, source)` |
| 移除状态 | `world.removeStatus(actor, idOrType, reason)`；省略状态编号或类型则清除全部 |
| 结算记录 | `world.recordCombat(type, data)`、`world.combatLog`；保留最近 500 条 |
| 简单反馈 | `world.addEffect(effect)`、`world.message(text, type)` |

这些接口只覆盖当前需要。投射物暂停与反射、区域进出、任意武器实例从指定位置开火、创建无敌虚影并切换控制、信息可见权限，都还需要扩展。

命中回调通过 `spawnProjectile` 的 `onHit` 传入，收到包含 `world`、`projectile`、命中位置 `pos`、`actor`、`partId`、`obstacle` 和本步命中比例 `fraction` 的对象。命中场景时 `actor` 为空；命中身体时可以识别部件，目前没有爆头伤害倍率。高速弹丸沿飞行段检查碰撞，发射瞬间不会提前扣目标血量。

## 三个已实现的例子

| 脚本 | 当前行为 | 生命周期 |
| --- | --- | --- |
| `jetpack.js` | 对自身速度叠加向上及少量沿瞄准方向的水平推力；等级提高推力 | 普通技能，`start` 完成即时变化 |
| `autoaim.js` | 在准心方向周围 30° 内搜索无遮挡敌人，优先最接近瞄准方向者，持续写入真实角度；不自动开火，也不预判移动 | 消耗型终极，`start` 初始化目标记录，`update` 索敌与瞄准，`end` 清理该次目标记录 |
| `weaken.js` | 发射受重力影响、无直接伤害的榴弹；撞击后使直接命中或范围内无遮挡的敌人伤害输出降低；等级影响范围与状态时长 | 普通技能，`start` 生成弹丸，弹丸 `onHit` 附加状态，世界在状态到期时移除 |

弹射背包的注册方式如下，节选自实际脚本；具体推力与耗蓝仍在脚本中调整：

```js
(function registerJetpack(root) {
  const definition = {
    id: "jetpack",
    name: "弹射背包",
    kind: "normal",
    manaCost: 10,
    cooldown: 5,
    duration: 0,
    start({ world, caster, level }) {
      // 此处只展示向上分量，完整脚本还包括水平推力与反馈。
      caster.vel[1] += 8 + (level - 1) * 1.8;
      caster.grounded = false;
    },
  };
  (root.PixelFPSSkills ||= Object.create(null))[definition.id] = definition;
  if (typeof module !== "undefined" && module.exports) module.exports = definition;
})(globalThis);
```

虚弱榴弹的 `onHit` 使用本次实例编号作为状态来源，防止来源信息丢失。状态只降低受影响角色造成的伤害，不替换其武器，也不移走其背包物品。多个虚弱状态分别到期；当前伤害结算取其中最低的伤害倍率，不相乘叠加。这只是当前示例的规则。

## 背包、等级与脚本的关系

背包在 `player.inventory` 中分别保存 `weapons`、当前武器下标 `selected`、通用弹药 `ammo`、蓝瓶 `manaPotions` 和 `skills`。技能条目保存总份数 `count`、最高持有等级 `level` 及各等级份数 `levels`。冷却归运行入口管理，不放进每份材料里。

当前 `world.upgradeSkill(id)` 仅合成普通技能：寻找材料足够的最低等级，三份变成高一级一份，总份数减少二。发动使用最高持有等级，剩余低级份数保留；同名普通技能共用冷却，合成不会刷新冷却。终极升级及最终合成操作方式仍待讨论。

终极发动后物品份数与持续实例分别存在：最后一份自瞄用掉后，背包中份数为零，但已启动的自瞄仍持续至结束。蓝瓶恢复当前蓝量，不改变头部决定的容量。枪械弹药与技能蓝量分别记账。

背包增减由 `PixelFPSInventory` 处理，拾取、丢弃由世界组织。按等级丢弃技能不会重置该技能冷却，也不会取消已经启动的持续实例；重新捡起同名技能依然面对原有冷却。普通技能材料全部丢掉后不能再发动，已经生效的行为按自身生命周期结束。

快捷键通过 `PixelFPSPlayerActions` 绑定技能编号。背包与实验台读取 `world.skills.definitions`，无需为每个新增脚本再写一套显示入口。当前八个可绑定按键不限制持有技能种类，未绑定技能仍可从背包使用；键位与材料等级、份数分别保存。

## 用实验台验证脚本

开始页、暂停菜单或 F2 / 反引号可以打开实验台。打开窗口时训练冻结；界面提供发放物资、木桩配置、无限资源、时间倍率和逐帧推进。木桩使用真实角色的六部件几何和伤害逻辑，可独立设置移动、还击、非致命受伤后补满生命、死亡后自动复活。

自动化从 `PixelFPSApp.lab` 调用同一套能力，例如：

```js
const lab = PixelFPSApp.lab;
lab.loadNamedScenario("weakness");
lab.give("skill", "weaken", 9, 1);
lab.pause();
lab.world.skills.cast("weaken");
lab.step(120); // 推进 1 游戏秒，含榴弹、状态、冷却及木桩还击
const hits = lab.world.combatLog.filter(entry => entry.type === "damage");
```

实验场景保存的是重新布置所需的配置。加载场景会创建新的 `World`；调用者应重新取 `lab.world`，不要继续使用加载前的角色或世界引用。浏览器界面可命名保存配置和导出 JSON。完整指令、场景语义和 API 见 [实验木桩与控制台](04-laboratory.md)。

## 如何加入下一份技能

1. 在 `src/skills/` 新建独立脚本，注册定义；按行为需要添加 `start`、`update`、`end`，或在创建投射物时传入 `onHit`。
2. 执行构建后，注册定义会进入背包、快捷键绑定和实验台技能列表；可用 `lab.give("skill", id, 数量, 等级)` 发放材料。不需要手动修改页面脚本占位或三份固定技能列表。
3. 如果要在正常训练场捡到它，再在世界的物资布置中安排技能掉落；自动注册不等于自动决定它的出现位置、数量或频率。
4. 按需在 `item-visuals.js` 添加示意图标和地面粗模；没有专用外观时使用通用示意。选择一个快捷键可以在背包完成，无需修改技能脚本。
5. 针对新增行为验证资源消耗、实际结果与结束清理。需要新能力时扩展相应基础接口；用实验台布置木桩、观察日志，保存可重复的实验配置。普通技能还需检查等级公式是否符合本技能行为。

构建与现有逻辑验证：

```sh
python3 build.py
node --test tests/*.test.mjs
```

独立技能脚本可以组合已有能力；遇到新需求再补相应基础接口。武器库展开需要按原有武器实例执行攻击，无敌虚影需要把资源归属与控制对象分开，反弹镜需要拦截与重新发射，运动封存需要定义对象及其计时如何暂停。这些点子继续保留，尚未纳入本轮实现。
