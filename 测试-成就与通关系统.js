/**
 * 成就 / 通关目标系统自动化测试（Node 端，无需浏览器）
 *
 * 运行：node 测试-成就与通关系统.js
 *
 * 原理：把 index.html 里的 <script> 抽出来丢进 vm 沙箱 + 极简 DOM 桩执行，
 * 再驱动全局状态做断言。注意 index.html 顶层用的是 let/const（词法绑定），
 * 不会挂到 context 对象上，所以统一用 R('表达式') 在沙箱内求值/赋值。
 *
 * 覆盖：定义完整性 / 解锁与奖励幂等 / 建筑类成就 / 隐藏成就 /
 *       通关五项判定与边界 / 评级 / 存档往返 / 旧存档静默迁移 / 重置
 */
const fs = require('fs'), vm = require('vm');

// 多文件架构：CSS 在 css/styles.css，JS 在内联 <script>（已被嵌入到 index.html）
const base = 'E:/WorkBuddy/Claw/村长日记';
const html = fs.readFileSync(base + '/index.html', 'utf8');
let code = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
// 移除末尾自动启动段（initGrid()开始的初始化逻辑），避免 vm 内 DOM 依赖崩溃
const startupIdx = code.lastIndexOf('// ===================== 启动 =====================');
if (startupIdx > 0) code = code.substring(0, startupIdx).trimEnd();

function mkEl() {
  return {
    style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    dataset: {}, children: [], textContent: '', innerHTML: '', value: '',
    appendChild() {}, remove() {}, insertBefore() {}, removeChild() {},
    firstChild: null, lastChild: null, parentNode: null, closest() { return null; },
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    addEventListener() {}, setAttribute() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; },
    onclick: null
  };
}
const store = {};
const ctx = {
  console,
  document: {
    getElementById() { return mkEl(); }, createElement() { return mkEl(); },
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    body: mkEl(), addEventListener() {}
  },
  window: { addEventListener() {}, innerWidth: 1200 },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  Math, Date, JSON, alert() {}, confirm() { return true; }, requestAnimationFrame: () => 0
};
ctx.globalThis = ctx; ctx.window.document = ctx.document;
// 把 DOM 函数设为 no-op，避免自动初始化段崩溃
ctx.document.getElementById = () => mkEl();
ctx.initGrid = () => {};
ctx.updateUI = () => {};
ctx.renderBuildPanel = () => {};
ctx.addLog = () => {};
ctx.renderAllBuildings = () => {};
ctx.updateAchievementBtn = () => {};
ctx.renderGoalInfo = () => {};
ctx.renderUpgradeInfo = () => {};
ctx.showSaveModal = () => {};
ctx.closeSaveModal = () => {};
ctx.getSlotInfo = () => null;
ctx.saveGame = () => true;
ctx.loadGame = () => true;
ctx.togglePause = () => {};
ctx.setSpeed = () => {};
ctx.setInterval = () => 0;
ctx.clearInterval = () => {};
// resetGame 在被切除的启动段里——注入桩
vm.createContext(ctx);
vm.runInContext('resetGame = () => { RESOURCES.gold=500; RESOURCES.food=50; RESOURCES.wood=30; RESOURCES.stone=0; RESOURCES.water=20; population=3; popMax=5; satisfaction=65; health=80; research=0; officials=0; villageLevel=1; day=1; gameTime=0; buildings=[]; GRID_COLS=8; GRID_ROWS=5; gridData.length=0; stats={...DEFAULT_STATS}; unlockedAchievements=[]; gameWon=false; }', ctx);

// 屏蔽原有城墙自测的控制台噪音
const origLog = console.log; console.log = () => {};
vm.runInContext(code, ctx, { filename: 'game.js' });
console.log = origLog;

// top-level let/const 是词法绑定，必须在上下文里求值才能访问
const R = expr => vm.runInContext(expr, ctx);

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n); } };

console.log('--- 1. 定义完整性 ---');
ok('初始成就为空', R('unlockedAchievements.length') === 0);
ok('初始未通关', R('gameWon') === false);
ok('成就总数 21', R('ACHIEVEMENTS.length') === 21);
ok('成就 id 唯一', R('new Set(ACHIEVEMENTS.map(a=>a.id)).size') === R('ACHIEVEMENTS.length'));
ok('每条成就都有 ck 函数', R('ACHIEVEMENTS.every(a=>typeof a.ck==="function")'));
ok('每条成就都有 nm/ds/ic', R('ACHIEVEMENTS.every(a=>a.nm&&a.ds&&a.ic)'));
ok('分组均在白名单内', R('ACHIEVEMENTS.every(a=>ACHV_GROUPS.includes(a.g))'));
ok('通关目标 5 项', R('WIN_GOALS.length') === 5);
ok('空局面下所有 ck 不抛错', R('(()=>{try{ACHIEVEMENTS.forEach(a=>a.ck());return true}catch(e){return false}})()'));
ok('空局面下所有目标不抛错', R('(()=>{try{WIN_GOALS.forEach(g=>{g.ok();g.cur();});return true}catch(e){return false}})()'));
R('checkAchievements()');
ok('空局面不误解锁', R('unlockedAchievements.length') === 0);

console.log('--- 2. 解锁与奖励 ---');
const goldBefore = R('RESOURCES.gold');
R('stats.buildingsBuilt = 1');
R('checkAchievements()');
ok('建造 1 座解锁「破土动工」', R('unlockedAchievements.includes("first_build")'));
ok('奖励发放 金币+50', R('RESOURCES.gold') === goldBefore + 50);
const n1 = R('unlockedAchievements.length');
R('checkAchievements()');
ok('重复检测不重复解锁', R('unlockedAchievements.length') === n1);
ok('奖励不重复发放', R('RESOURCES.gold') === goldBefore + 50);

console.log('--- 3. 建筑类成就 ---');
ok('建筑种类共 13', R('Object.keys(BUILDING_TYPES).length') === 13);
R('buildings.length=0; Object.keys(BUILDING_TYPES).forEach((t,i)=>buildings.push({type:t,level:1,workers:0,index:i}))');
ok('builtTypeCount() = 13', R('builtTypeCount()') === 13);
R('checkAchievements()');
ok('解锁「百业俱兴」', R('unlockedAchievements.includes("all_types")'));
ok('顺带解锁「初具规模」(≥10座)', R('unlockedAchievements.includes("build10")'));
ok('未达 25 座不解锁「阡陌纵横」', R('unlockedAchievements.includes("build25")') === false);
ok('城墙 Lv1 未解锁「固若金汤」', R('unlockedAchievements.includes("wall3")') === false);
R('buildings.find(b=>b.type==="wall").level=3');
R('checkAchievements()');
ok('城墙升 Lv3 解锁「固若金汤」', R('unlockedAchievements.includes("wall3")'));
ok('同时解锁「精益求精」', R('unlockedAchievements.includes("upgrade_max")'));

console.log('--- 4. 隐藏成就 ---');
ok('隐藏成就前置未满足时不解锁', R('unlockedAchievements.includes("ghost")') === false);
R('stats.maxPop=20; population=1');
R('checkAchievements()');
ok('人口跌至 1 解锁隐藏「人去楼空」', R('unlockedAchievements.includes("ghost")'));
ok('隐藏成就带 hidden 标记', R('ACHIEVEMENTS.filter(a=>a.hidden).length') === 2);

console.log('--- 5. 通关判定 ---');
R('villageLevel=4; population=50; satisfaction=85; day=100');
ok('五项目标全部满足', R('WIN_GOALS.every(g=>g.ok())'));
R('checkWinCondition()');
ok('触发通关', R('gameWon') === true);
R('gameWon=false; population=49');
R('checkWinCondition()');
ok('人口差 1 不通关', R('gameWon') === false);
R('population=50; satisfaction=84');
R('checkWinCondition()');
ok('满意度差 1 不通关', R('gameWon') === false);
R('satisfaction=85; day=99');
R('checkWinCondition()');
ok('天数差 1 不通关', R('gameWon') === false);
R('day=100; checkWinCondition()');
ok('全部补齐后通关', R('gameWon') === true);
R('checkWinCondition()');
ok('通关只结算一次（幂等）', R('gameWon') === true);

console.log('--- 6. 评级 ---');
ok('评级落在 S/A/B/C', ['S', 'A', 'B', 'C'].includes(R('computeWinRank().rank')));
ok('评分区间 0-100', R('computeWinRank().total') >= 0 && R('computeWinRank().total') <= 100);
R('day=100'); const rFast = R('computeWinRank().total');
R('day=300'); const rSlow = R('computeWinRank().total');
ok(`用时越久评分越低 (100天=${rFast} > 300天=${rSlow})`, rSlow < rFast);
R('day=100');

console.log('--- 7. 存档往返 ---');
const snap = R('JSON.parse(JSON.stringify(getSaveData()))');
ok('存档含 stats', !!snap.stats);
ok('存档含成就列表', Array.isArray(snap.unlockedAchievements));
ok('存档含 gameWon=true', snap.gameWon === true);
ok('存档成就数与内存一致', snap.unlockedAchievements.length === R('unlockedAchievements.length'));
R(`localStorage.setItem('t_new', ${JSON.stringify(JSON.stringify(snap))})`);
const savedCount = R('unlockedAchievements.length');
R('unlockedAchievements=[]; gameWon=false; stats={...DEFAULT_STATS}');
R('loadGame("t_new")');
ok('读档恢复成就数', R('unlockedAchievements.length') === savedCount);
ok('读档恢复 gameWon', R('gameWon') === true);
ok('读档恢复 stats', R('stats.buildingsBuilt') === snap.stats.buildingsBuilt);

console.log('--- 8. 旧存档迁移（静默补记，不白送奖励）---');
const legacy = JSON.parse(JSON.stringify(snap));
delete legacy.stats; delete legacy.unlockedAchievements; delete legacy.gameWon;
R(`localStorage.setItem('t_old', ${JSON.stringify(JSON.stringify(legacy))})`);
R('unlockedAchievements=[]; gameWon=false; stats={...DEFAULT_STATS}');
R('loadGame("t_old")');
ok('旧存档静默补记了成就', R('unlockedAchievements.length') > 0);
ok('旧存档不白送奖励（金币等于存档值）', R('RESOURCES.gold') === legacy.resources.gold);
ok('旧存档也识别出已通关', R('gameWon') === true);

console.log('--- 9. 重置 ---');
R('resetGame()');
ok('重置清空成就', R('unlockedAchievements.length') === 0);
ok('重置清空 gameWon', R('gameWon') === false);
ok('重置清空 stats', R('stats.buildingsBuilt') === 0 && R('stats.goldEarned') === 0);
ok('重置后目标进度归零', R('WIN_GOALS.filter(g=>g.ok()).length') === 0);
ok('重置后成就检测不误触发', (() => { R('checkAchievements()'); return R('unlockedAchievements.length') === 0; })());

console.log('\n' + (fail === 0 ? `ALL_PASS  共 ${pass} 项` : `FAIL=${fail}  PASS=${pass}`));
