# 实验木桩与控制台

当前仍是单机玩法验证。编辑技能、物品直接修改源码；实验台负责布置对象、准备资源、控制时间和查看结算。控制台指令与程序调用使用同一套操作。

## 最快试用

桌面浏览器打开 `index.html`，点开始页的“实验台”，或进入训练后按 **F2 / 反引号**。暂停菜单也有入口。

1. 选择一项内建实验，点击加载。
2. 点击“继续训练”，操作角色完成一次攻击、施法或合成。
3. 按 F2 回到实验台，检查战斗记录；根据需要调整木桩或资源，再次训练。

| 内建名称 | 界面名称 | 布置内容 |
| --- | --- | --- |
| `shooting` | 基础射击 | 三种武器、弹药与蓝瓶；标准体型和大头木桩，死亡后自动复活 |
| `merge` | 连续三合一 | 三种武器、弹药与蓝瓶；弹射背包和虚弱榴弹各九份一级材料，供背包连续合成；一个可复活木桩 |
| `weakness` | 虚弱与还击 | 一个主动还击的可复活木桩、一级虚弱榴弹；开启无限蓝量与无技能冷却，用于比较施加虚弱前后的伤害 |

内建实验沿用当前玩家的体型与画脸，重置玩家位置和朝向。加载任一场景都会重新布置训练场。

## 木桩

每个木桩使用与角色相同的体型、六部件受击盒、血蓝、伤害和状态逻辑。修改头部会改变蓝量容量，修改躯干会改变生命容量。界面可以选择已有木桩，也可以新增标准、大头、小体型或长臂木桩。

| 配置 | 行为 |
| --- | --- |
| 四项体型参数 | 头部大小、躯干大小、两臂共用长度、两腿共用长度 |
| X / Y / Z | 木桩位置，同时作为来回移动的中心和复活位置 |
| 移动 | 静止、左右移动，或跟随训练设置的移动开关 |
| 攻击 | 不还击、向玩家还击，或跟随训练设置的还击开关 |
| 非致命受伤后补满生命 | 先结算并记录实际扣血，再立即补满；致命伤害仍会击倒木桩 |
| 死亡后自动复活 | 按设置的游戏秒数等待，然后在配置位置满血满蓝复活，清除状态 |

木桩最多 64 个，需在训练场边界内。修改体型保留生命、蓝量比例，不会自动补满或复活；可通过自动复活或训练设置中的恢复训练靶重新开始。

## 时间与资源

打开实验台会暂停训练，释放鼠标。窗口关闭后先回到开始页或暂停页；点击实验台里的“继续训练”会解除实验时间暂停并回到操作中。`time resume` 只解除实验时间暂停，实验台仍开着时不会自动开始战斗。

- 时间倍率支持 `0.05` 至 `4`；`0.25` 表示四分之一速度。
- 界面的“前进 1 帧”和“前进 1 秒”会自动进入时间暂停，再推进结算。
- 控制台 `step` 需要先执行 `time pause`。每帧固定为 1/120 游戏秒，`step 120` 推进一游戏秒，不受慢放倍率影响；每次可推进 1 至 1200 帧。
- 移动、弹丸、技能、状态、冷却和木桩复活使用同一游戏时间。逐帧推进时木桩仍可移动和还击，玩家没有持续的移动或开火输入。

| 实验操作 | 实际作用 |
| --- | --- |
| 补满血蓝 | 玩家恢复满血满蓝；玩家已倒下时也恢复存活 |
| 无限蓝量 | 技能不因蓝量不足而失败，发动不扣蓝 |
| 无限弹药 | 武器不因弹药不足而失败，开火不扣共享弹药；保留射速 |
| 无技能冷却 | 技能可以重复发动，不受已有冷却阻止，也不产生新技能冷却；保留武器射速 |
| 清除冷却 | 一次性清除玩家当前的武器开火等待及技能冷却 |

作弊开关不补发技能。技能依旧需要持有，终极成功发动仍消耗一份，存活、沉默、眩晕和脚本自身条件仍然检查。无限蓝量不是增大头部决定的蓝量容量。

## 控制台指令

每次输入一条指令；↑ / ↓ 找回历史。先用 `help` 查看帮助，用 `list` 查看可用武器、技能、木桩编号、场景和状态。指令不会执行任意 JavaScript。

| 指令 | 含义 |
| --- | --- |
| `list weapons` / `list skills` | 查看当前已接入的武器或技能编号 |
| `give weapon pistol` | 发放一把手枪；武器可选 `pistol`、`rifle`、`knife`，末尾可加数量 |
| `give skill weaken 9 1` | 发放九份一级虚弱榴弹，参数顺序为编号、数量、等级 |
| `give ammo 999` | 增加 999 发共享弹药 |
| `give mana 5` | 增加五瓶蓝瓶；立即补蓝使用 `refill` |
| `refill` | 补满玩家生命和蓝量 |
| `cooldown clear` | 清除玩家武器和技能的现有冷却 |
| `cheat mana on` | 开启无限蓝量；`ammo` 为无限弹药，`cooldown` 为无技能冷却；`off` 关闭 |

当前技能编号为 `jetpack`、`autoaim`、`weaken`。发放时省略等级为一级，省略数量为一份；普通技能在背包中执行三合一。

### 木桩与状态

下表的 `<id>` 替换为 `list dummies` 返回的编号，不输入尖括号。玩家编号为 `player`。

| 指令 | 含义 |
| --- | --- |
| `dummy spawn bighead 0 0 -6` | 在指定位置生成大头木桩；还可选 `standard`、`tiny`、`longarm` |
| `dummy set <id> head 2.5` | 修改头部大小；也支持 `torso`、`arms`、`legs` |
| `dummy set <id> pos 2 0 -5` | 修改位置与移动中心 |
| `dummy set <id> move strafe` | 左右移动；也支持 `stationary`、`inherit` |
| `dummy set <id> fire on` | 主动还击；也支持 `off`、`inherit` |
| `dummy set <id> recover on` | 非致命受伤后补满生命；`off` 关闭 |
| `dummy set <id> respawn on` | 开启死亡后自动复活；`off` 关闭 |
| `dummy set <id> delay 2` | 复活等待两游戏秒 |
| `dummy remove <id>` / `dummy clear` | 移除指定木桩 / 清除所有木桩 |
| `status add player invulnerable 10` | 给玩家添加十游戏秒无敌状态 |
| `status clear player` | 清除玩家所有状态 |

`list status` 列出支持的状态：`weaken` 虚弱、`slow` 减速、`root` 定身、`stun` 眩晕、`silence` 沉默、`disarmed` 缴械、`invulnerable` 无敌。状态作用取决于对象实际行为，例如木桩没有主动技能可被沉默阻止。

### 时间、清理和场景

| 指令 | 含义 |
| --- | --- |
| `time scale 0.25` | 使用四分之一时间倍率 |
| `time pause` / `time resume` | 暂停 / 恢复实验时间 |
| `step` / `step 120` | 暂停后推进一帧 / 一游戏秒 |
| `clear projectiles` | 清除场上投射物 |
| `clear log` | 清空战斗记录 |
| `reset` | 重建初始训练场，保留当前角色体型与画脸，恢复初始物资与默认时间、作弊开关 |
| `scenario list` | 查看内建及自存场景 |
| `scenario load weakness` | 加载内建“虚弱与还击”实验 |
| `scenario save 我的实验` | 保存当前配置，以便重新布置 |
| `scenario load 我的实验` | 从保存的配置重新开始实验 |
| `scenario delete 我的实验` | 删除自存配置，不改变当前场地 |

场景名称支持 1–40 个文字、数字、下划线和连字符，不含空格。自存场景最多 100 个；三个内建名称不能被覆盖或删除。

## 战斗记录

`world.combatLog` 保留最近 500 条结构化事件。实验台显示筛选结果中最新 80 条，最新记录在前；导出按钮将保留的全部事件写入 JSON，不限于面板当前筛选。

伤害记录包含来源、目标、武器、命中部位、原始伤害、倍率、状态来源、修正后伤害、实际扣血、结算前后生命及无敌等阻止原因。比如 `20 × 0.45 = 9`，目标只剩 `4` 点生命时实际扣血为 `4`。自动回血另记恢复事件，不覆盖原始伤害记录。

状态记录包含添加、移除、到期、来源和到期时间；另外记录成功施法、木桩配置和复活。

记录时间为游戏内秒数。状态的剩余时间可以用 `expiresAt - world.time` 得到。场景重新加载后日志清空，需保留结果时先导出日志。

## 保存的是实验配置

配置包含玩家体型与画脸、位置和朝向、武器与技能材料、弹药与蓝瓶、每个木桩的体型与行为、全局训练开关、作弊开关、时间倍率与实验暂停状态。

加载时重新生成角色和木桩，恢复满血满蓝，时间从零开始，清除弹丸、状态、技能持续实例、冷却和旧日志。木桩编号重新生成；场景记录当时的木桩坐标，载入后该坐标成为新的移动中心。配置不记录战斗进行到某一瞬间的完整状态。

地面物资目前只保存“有 / 无”开关：保存时还有任何掉落物，则载入时重新生成整套初始物资；不会逐件恢复已拾取和未拾取状态。

通过实验台按钮或文本指令命名保存的场景，在浏览器允许时存入 `localStorage` 的 `fps.lab.scenarios.v1`。这里保存自定义场景集合；加载场景本身不会改写角色编辑器的独立存档。

界面“导出配置”下载当前场景的单份 JSON；“导入配置”校验并加载一份场景，之后可命名保存到列表。导入文件上限 1 MB。浏览器不能写入本地存储时，当前实验仍可操作，用导出文件保留配置。

## 模型与自动化接口

页面启动后可直接调用与文本控制台相同的实验对象：

`execute(text)` 返回 `{ ok, message, data? }`，把无效指令或参数作为失败结果返回。直接方法接收结构化参数，参数错误会抛出异常。

| 方法 | 参数与结果 |
| --- | --- |
| `list()` | 返回武器、技能、木桩、场景和支持状态 |
| `give(type, idOrAmount, count = 1, level = 1)` | 武器 / 技能传编号，弹药 / 蓝瓶传增加数量 |
| `refill()` / `clearCooldowns()` | 补满血蓝 / 清除当前冷却 |
| `setCheat(key, enabled)` | `key` 为 `mana`、`ammo`、`cooldown`；开关为布尔值 |
| `spawnDummy(options)` | 传 `{ label?, parameters?, pos?, training? }`，返回木桩对象 |
| `configureDummy(id, patch)` | 修改木桩部分字段，返回木桩对象 |
| `removeDummy(id)` / `clearDummies()` | 移除指定木桩 / 清除全部 |
| `addStatus(actorId, type, seconds = 5)` / `clearStatus(actorId, type?)` | 添加状态 / 清除指定类型或全部状态 |
| `pause()` / `resume()` / `setTimeScale(value)` | 控制实验时间；不会替代页面的继续训练操作 |
| `step(frames = 1)` | 实验暂停时以 1/120 秒固定步长推进 |
| `clearProjectiles()` / `clearLog()` / `reset()` | 清理弹丸 / 日志 / 重建训练场 |
| `snapshot()` / `loadScenario(config)` | 取得当前场景配置 / 校验并加载配置 |
| `saveScenario(name)` / `loadNamedScenario(name)` | 命名保存 / 加载内建或自存配置；另有 `listScenarios()`、`deleteScenario(name)` |
| `importScenarios(collection)` | 校验并替换自存场景集合，集合格式为 `{ 名称: 场景配置 }` |

`training` 支持 `{ behavior, fire, autoRecover, autoRespawn, respawnDelay }`；`behavior` 为 `"stationary"`、`"strafe"` 或 `null`，`fire` 为布尔值或 `null`。其中 `null` 表示跟随全局训练设置。`parameters` 使用角色已有的四个参数名称，可仅修改部分字段。

```js
const lab = PixelFPSApp.lab;
const result = lab.execute("give skill weaken 9 1"); // { ok, message, data? }
lab.loadNamedScenario("shooting");
lab.clearDummies();
const dummy = lab.spawnDummy({
  label: "虚弱实验木桩",
  parameters: { headScale: 2.5, torsoScale: 1 },
  pos: [0, 0, -5],
  training: {
    behavior: "stationary", fire: true,
    autoRecover: true, autoRespawn: true, respawnDelay: 2,
  },
});
lab.addStatus(dummy.id, "weaken", 6);
lab.addStatus("player", "invulnerable", 10);
lab.pause();
lab.step(360); // 推进 3 秒，等待木桩首次还击及弹丸飞行
const damage = lab.world.combatLog.filter(event => event.type === "damage");
```

实验对象中的 `world` 始终指向当前世界。加载场景或重置训练场后应重新获取 `lab.world` 及对象编号，不要保留旧角色引用继续操作。

直接调用 `lab.saveScenario` 只更新 `lab.scenarios` 内存集合；页面按钮和控制台提交后才由界面写入浏览器存储。自动化可将 `lab.snapshot()` 输出为单份场景文件，或用 `localStorage.setItem("fps.lab.scenarios.v1", JSON.stringify(lab.scenarios))` 保存集合。

技能施放继续使用 `lab.world.skills.cast(id)`，普通技能合成继续使用 `lab.world.upgradeSkill(id)`。这保证实验验证的是实际玩法使用的入口。当前仍是单机验证数值；完成实验环境后，再逐项实现创意清单中的技能和物品。
