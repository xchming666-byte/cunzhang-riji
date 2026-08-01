// ===================== 游戏数据 =====================
const RESOURCES={gold:500,food:50,wood:30,stone:0,water:20};
let population=3,popMax=5,satisfaction=65,health=80;
let villageLevel=1,research=0,researchSpent=0,officials=0,day=1,gameTime=0;
let gameSpeed=1,gamePaused=false,tickInterval=null,selectedBuilding=null,demolishMode=false;
let buildings=[],GRID_COLS=8,GRID_ROWS=5,gridData=[];
let injuries=[]; // 受伤村民：{sev:'light'|'heavy', days:剩余天数}
let techUnlocked=[]; // 已研究的科技 id 列表

const DEFAULT_STATS={goldEarned:0,foodProduced:0,buildingsBuilt:0,upgradesDone:0,banditsFought:0,banditsPerfect:0,eventsHandled:0,maxPop:3};
let stats={...DEFAULT_STATS},unlockedAchievements=[],gameWon=false;

// 建筑定义
const BT={
  farm:{n:'农田',c:'🌾',cost:{wood:5},maxW:3,prod:{food:2},cons:{water:1},minLv:1,unlocked:true},
  lumber:{n:'伐木场',c:'🪵',cost:{wood:3},maxW:2,prod:{wood:0.5},cons:{water:1},minLv:1,unlocked:true},
  well:{n:'水井',c:'💧',cost:{wood:5,gold:20},maxW:3,prod:{water:2},minLv:1,unlocked:true},
  house:{n:'民居',c:'🏠',cost:{wood:8,gold:30},maxW:0,popB:3,minLv:1,unlocked:true},
  quarry:{n:'采石场',c:'⛏️',cost:{wood:10,gold:50},maxW:2,prod:{stone:1},minLv:2,unlocked:false},
  market:{n:'集市',c:'🏪',cost:{wood:15,stone:5},maxW:2,prod:{gold:5},minLv:2,unlocked:false},
  clinic:{n:'医馆',c:'🏥',cost:{stone:10,gold:80},maxW:1,satB:10,minLv:2,unlocked:false},
  school:{n:'学堂',c:'📚',cost:{stone:15,gold:120},maxW:3,minLv:2,unlocked:false},
  teahouse:{n:'茶馆',c:'🍵',cost:{stone:15,gold:150},maxW:1,satB:15,minLv:3,unlocked:false},
  wall:{n:'城墙',c:'🏰',cost:{stone:50},maxW:0,minLv:3,unlocked:false},
  temple:{n:'祠堂',c:'⛩️',cost:{stone:30,gold:200},maxW:1,satB:20,minLv:3,unlocked:false},
  paifang:{n:'牌坊',c:'🏛️',cost:{stone:40,gold:300},maxW:0,satB:15,minLv:3,unlocked:false}
};
const BT_KEYS=Object.keys(BT);
// 村民离开时撤人优先级：数值越大越先撤人（越不致命越先撤），数值越小越保（生存/防御建筑最后撤）
const PULL={well:0,farm:0,clinic:1,wall:1,temple:2,teahouse:2,school:2,quarry:3,lumber:3,market:4};
// 村民受伤机制参数
const INJURE_CHANCE=0.06;   // 每天新增轻伤的概率
const CLINIC_HEAL_PER_DAY=1; // 有医馆时每天治愈人数（优先重伤）
const LIGHT_DAYS=14;        // 轻伤若无医治持续天数→转重伤
const HEAVY_DAYS=7;         // 重伤若无医治持续天数→死亡

// ===================== 科技树 =====================
// 用「研究点」一次性消耗解锁；同一分支内存在前置链。
const TECH={
  // 农业
  agri_intensive:{n:'精耕细作',c:'🌾',branch:'农业',cost:30,pre:[],ds:'农田产出 +20%'},
  agri_irrigation:{n:'水利灌溉',c:'💧',branch:'农业',cost:60,pre:['agri_intensive'],ds:'水井产出 +30%'},
  // 工业
  ind_efficient:{n:'高效伐木',c:'🪵',branch:'工业',cost:30,pre:[],ds:'伐木场产出 +25%'},
  ind_deepmine:{n:'深采技术',c:'⛏️',branch:'工业',cost:60,pre:['ind_efficient'],ds:'采石场产出 +25%'},
  // 商业
  com_market:{n:'集市贸易',c:'🏪',branch:'商业',cost:40,pre:[],ds:'市场产出 +30%'},
  com_bank:{n:'钱庄',c:'💰',branch:'商业',cost:80,pre:['com_market'],ds:'每日被动 +8 金币'},
  // 治理
  gov_ethos:{n:'乡约民规',c:'📜',branch:'治理',cost:50,pre:[],ds:'文官加成 +5%→+8%'},
  gov_merit:{n:'科举取士',c:'🎓',branch:'治理',cost:70,pre:['gov_ethos'],ds:'文官上限 3→5'},
  // 民生
  med_herb:{n:'草药学',c:'🌿',branch:'民生',cost:40,pre:[],ds:'医馆每日多治 1 人'},
  med_prevent:{n:'防疫卫生',c:'🛡️',branch:'民生',cost:70,pre:['med_herb'],ds:'村民受伤概率 -50%'}
};
const TECH_BRANCHES=['农业','工业','商业','治理','民生'];
function hasTech(id){return techUnlocked.includes(id)}
function officialBonus(){return hasTech('gov_ethos')?.08:.05}
function officialCap(){return hasTech('gov_merit')?5:3}
function clinicHealPerDay(){return hasTech('med_herb')?2:1}
function getInjureChance(){return hasTech('med_prevent')?INJURE_CHANCE/2:INJURE_CHANCE}

// 事件定义
const EVENTS=[
  {type:'refugee',w:20,minLv:1,t:'🏘️ 流民投靠',txt:'一群流民来到村口，请求加入你的村庄。',ch:[
    {t:'接纳 (+1人口)',a:()=>{population=Math.min(population+1,popMax+5);addLog('流民加入了村庄，人口+1','good')}},
    {t:'拒绝',a:()=>{addLog('你拒绝了流民','event')}}]},
  {type:'merchant',w:15,minLv:1,t:'🐪 商队路过',txt:'商队愿意用金币交换你的食物。',ch:[
    {t:'买食物 (-50💰,+40🌾)',a:()=>{if(RESOURCES.gold>=50){RESOURCES.gold-=50;RESOURCES.food+=40;addLog('从商队买了40食物','good')}else addLog('金币不够','bad')}},
    {t:'卖食物 (+40💰,-30🌾)',a:()=>{if(RESOURCES.food>=30){RESOURCES.food-=30;RESOURCES.gold+=40;addLog('卖给商队30食物','good')}else addLog('食物不够','bad')}},
    {t:'不用了',a:()=>{addLog('商队离开了','event')}}]},
  {type:'harvest',w:10,minLv:1,t:'🎉 丰收！',txt:'今年风调雨顺，农田大丰收！',ch:[{t:'太好了！(+50🌾)',a:()=>{RESOURCES.food+=50;addLog('丰收！食物+50','good')}}]},
  {type:'drought',w:12,minLv:1,t:'☀️ 旱灾',txt:'连续干旱，农田减产。',ch:[{t:'熬过去',a:()=>{RESOURCES.food=Math.max(0,RESOURCES.food-30);RESOURCES.water=Math.max(0,RESOURCES.water-10);health=Math.max(0,health-10);satisfaction=Math.max(0,satisfaction-5);addLog('旱灾导致食物-30，水-10，健康-10，满意度-5','bad')}}]},
  {type:'bandit',w:8,minLv:1,t:'🗡️ 盗匪来袭！',txt:'一伙盗匪袭击了村庄！',ch:[{t:'防御',a:()=>{}}]},
  {type:'plague',w:6,minLv:1,t:'🦠 瘟疫蔓延',txt:'村庄爆发瘟疫，村民们生病了。',ch:[
    {t:'全力救治 (-100💰, -20😊)',a:()=>{if(RESOURCES.gold>=100){RESOURCES.gold-=100;satisfaction=Math.max(0,satisfaction-20);addLog('全力救治村民，金币-100','bad')}else{population=Math.max(1,population-2);reconcilePop();satisfaction=Math.max(0,satisfaction-15);addLog('无力救治，2位村民病逝','bad')}}},
    {t:'隔离 (+10😊)',a:()=>{if(hasClinic()){addLog('医馆控制住了疫情','good')}else{health=Math.max(0,health-20);satisfaction=Math.max(0,satisfaction-5);addLog('隔离了感染者，健康-20','bad')}}}]},
  {type:'festival',w:8,minLv:2,t:'🎊 村民庆典',txt:'村民们自发组织庆典，需要你的支持。',ch:[
    {t:'资助庆典 (-50💰,+15😊)',a:()=>{if(RESOURCES.gold>=50){RESOURCES.gold-=50;satisfaction=Math.min(100,satisfaction+15);addLog('庆典让村民们很开心','good')}else addLog('金币不够','bad')}},
    {t:'口头支持 (+5😊)',a:()=>{satisfaction=Math.min(100,satisfaction+5);addLog('村民们自发庆祝','good')}}]},
  {type:'trader',w:10,minLv:2,t:'🧙 游方工匠',txt:'一位工匠路过，愿意为你的村庄修建建筑。',ch:[
    {t:'雇佣 (-80💰，随机建造)',a:()=>{if(RESOURCES.gold>=80){RESOURCES.gold-=80;const ks=BT_KEYS.filter(k=>BT[k].minLv<=villageLevel&&BT[k].unlocked);if(ks.length){const rk=ks[Math.floor(Math.random()*ks.length)];const bt=BT[rk];let idx;for(let t=0;t<100;t++){idx=Math.floor(Math.random()*gridData.length);if(!gridData[idx])break}if(!gridData[idx]){const b={type:rk,workers:0,level:1,guards:0,index:idx};if(bt.maxW>0&&bt.prod&&Object.keys(bt.prod).length&&getIdlePop()>=1)b.workers=1;gridData[idx]=b;buildings.push(b);if(bt.popB)popMax+=bt.popB;if(bt.satB)satisfaction=Math.min(100,satisfaction+bt.satB);renderAll();addLog(`工匠建造了${bt.n}`,'good')}}else addLog('金币不够','bad')}}},
    {t:'不用了',a:()=>addLog('工匠离开了','event')}]},
  {type:'taxman',w:5,minLv:3,t:'👑 朝廷来使',txt:'朝廷派来了税务官，要求缴纳税收。',ch:[
    {t:'乖乖交税 (-150💰,+10😊)',a:()=>{if(RESOURCES.gold>=150){RESOURCES.gold-=150;satisfaction=Math.min(100,satisfaction+10);addLog('交了税，朝廷很满意','good')}else{population=Math.max(1,population-1);reconcilePop();addLog('没钱交税，1位村民被征去服劳役','bad')}}},
    {t:'贿赂官员 (-100💰)',a:()=>{if(RESOURCES.gold>=100){RESOURCES.gold-=100;addLog('税务官收了好处，睁一只眼闭一只眼','event')}else{population=Math.max(1,population-1);reconcilePop();addLog('没钱交税，1位村民被征去服劳役','bad')}}}]}
];

const WALL_RED={1:.3,2:.5,3:.7},WALL_CAP={1:2,2:3,3:4};
const BANDIT_NAME={small:'小股盗匪',gang:'盗匪团伙',army:'盗匪大军'};

// 成就系统
const ACHIEVEMENTS=[
  {id:'first_build',g:'建设',ic:'🏡',nm:'破土动工',ds:'建造第一座建筑',rw:{gold:50},ck:()=>stats.buildingsBuilt>=1},
  {id:'build10',g:'建设',ic:'🧱',nm:'初具规模',ds:'建筑达到10座',rw:{gold:150},ck:()=>buildings.length>=10},
  {id:'build25',g:'建设',ic:'🏘️',nm:'阡陌纵横',ds:'建筑达到25座',rw:{gold:400},ck:()=>buildings.length>=25},
  {id:'upgrade_max',g:'建设',ic:'⭐',nm:'精益求精',ds:'任意建筑升到Lv3',rw:{gold:200},ck:()=>buildings.some(b=>b.level>=3)},
  {id:'all_types',g:'建设',ic:'🗺️',nm:'百业俱兴',ds:'集齐13种建筑',rw:{gold:800,sat:5},ck:()=>new Set(buildings.map(b=>b.type)).size>=13},
  {id:'pop20',g:'民生',ic:'👥',nm:'人丁兴旺',ds:'人口达到20',rw:{sat:3},ck:()=>population>=20},
  {id:'pop50',g:'民生',ic:'🎏',nm:'万家灯火',ds:'人口达到50',rw:{gold:500},ck:()=>population>=50},
  {id:'full_employ',g:'民生',ic:'👷',nm:'人尽其才',ds:'人口≥15且零闲置',rw:{gold:200},ck:()=>population>=15&&getIdlePop()===0},
  {id:'survive50',g:'民生',ic:'📅',nm:'五十日谈',ds:'存活满50天',rw:{food:200},ck:()=>day>=50},
  {id:'gold1000',g:'经济',ic:'💰',nm:'家有余粮',ds:'金币达到1000',rw:{sat:2},ck:()=>RESOURCES.gold>=1000},
  {id:'gold5000',g:'经济',ic:'🏦',nm:'富甲一方',ds:'累计赚5000金',rw:{gold:300},ck:()=>stats.goldEarned>=5000},
  {id:'food500',g:'经济',ic:'🌾',nm:'仓廪殷实',ds:'食物储量达500',rw:{sat:5},ck:()=>RESOURCES.food>=500},
  {id:'sat90',g:'治理',ic:'😊',nm:'政通人和',ds:'满意度达90',rw:{gold:300},ck:()=>satisfaction>=90},
  {id:'health95',g:'治理',ic:'🏥',nm:'无病无灾',ds:'健康度达95',rw:{research:20},ck:()=>health>=95},
  {id:'research100',g:'治理',ic:'📚',nm:'学富五车',ds:'累计研究点达100',rw:{gold:400},ck:()=>research+researchSpent>=100},
  {id:'officials3',g:'治理',ic:'🏛️',nm:'群贤毕至',ds:'文官达3人',rw:{gold:300},ck:()=>officials>=3},
  {id:'wall3',g:'防务',ic:'🏰',nm:'固若金汤',ds:'城墙升到Lv3',rw:{gold:400},ck:()=>{const w=getWall();return!!w&&w.level>=3}},
  {id:'perfect3',g:'防务',ic:'🛡️',nm:'一夫当关',ds:'无损击退盗匪3次',rw:{gold:500},ck:()=>stats.banditsPerfect>=3},
  {id:'survive100',g:'防务',ic:'📜',nm:'百日筑城',ds:'存活满100天',rw:{gold:600,sat:5},ck:()=>day>=100},
  {id:'broke',g:'隐藏',ic:'💸',nm:'家徒四壁',ds:'金币归零',rw:{food:50},hidden:!0,ck:()=>RESOURCES.gold<=0&&stats.buildingsBuilt>=3},
  {id:'ghost',g:'隐藏',ic:'👻',nm:'人去楼空',ds:'人口一度只剩1人',rw:{sat:10},hidden:!0,ck:()=>population<=1&&stats.maxPop>=8}
];
const ACHV_GROUPS=['建设','民生','经济','治理','防务','隐藏'];

const WIN_GOALS=[
  {ic:'🏯',l:'村庄等级',cur:()=>`Lv.${villageLevel}/Lv.4`,ok:()=>villageLevel>=4},
  {ic:'👥',l:'人口',cur:()=>`${population}/50`,ok:()=>population>=50},
  {ic:'😊',l:'满意度',cur:()=>`${Math.round(satisfaction)}/85`,ok:()=>satisfaction>=85},
  {ic:'🗺️',l:'建筑种类',cur:()=>`${new Set(buildings.map(b=>b.type)).size}/13`,ok:()=>new Set(buildings.map(b=>b.type)).size>=13},
  {ic:'📅',l:'存活天数',cur:()=>`${day}/100`,ok:()=>day>=100}
];

const SAVE_KEYS=['villageDiary_slot1','villageDiary_slot2','villageDiary_slot3'],AUTOSAVE_KEY='villageDiary_autosave';
let saveMode='save',latestSave=null;

// ===================== 工具函数 =====================
function addLog(t,ty='event'){const a=document.getElementById('log-area'),e=document.createElement('div');e.className=`log-entry ${ty}`;e.innerHTML=`<span class="time">第${day}天</span> ${t}`;a.insertBefore(e,a.firstChild);while(a.children.length>15)a.removeChild(a.lastChild)}
function flashResource(id){const e=document.getElementById(id);if(!e)return;e.classList.add('flash');setTimeout(()=>e.classList.remove('flash'),400)}
function hasClinic(){return buildings.some(b=>b.type==='clinic')}
function hasPaifang(){return buildings.some(b=>b.type==='paifang')}
function getWall(){return buildings.find(b=>b.type==='wall')}
function getWallReduction(){const w=getWall();return w?WALL_RED[w.level]||0:0}
function getTotalGuards(){return buildings.reduce((s,b)=>s+(b.guards||0),0)}
function getGuardBonus(){return getTotalGuards()*.1}
function getWallCap(){const w=getWall();return w?WALL_CAP[w.level]||0:0}
function getWallUpkeep(b){return(b.level+1)+(b.guards||0)}
function applyWallUpkeep(wall){const up=getWallUpkeep(wall),justU=!wall.underfunded;if(RESOURCES.stone>=up){RESOURCES.stone-=up;wall.underfunded=false;return{upkeep:up,charged:up,underfunded:false,justUnderfunded:false}}else{RESOURCES.stone=0;wall.underfunded=true;return{upkeep:up,charged:0,underfunded:true,justUnderfunded:justU}}}
function canAssignGuard(b){const cap=WALL_CAP[b.level]||0,guards=b.guards||0,next=getWallUpkeep(b)+1,stoneOk=villageLevel>=4?RESOURCES.stone>=next:true;return guards<cap&&getIdlePop()>=1&&!b.underfunded&&stoneOk}
function getTotalScholars(){return buildings.reduce((s,b)=>s+(b.scholars||0),0)}
function getIdlePop(){let a=getTotalGuards()+getTotalScholars()+officials;for(const b of buildings)a+=b.workers||0;return Math.max(0,population-a)}
function reconcilePop(){let assigned=officials;for(const b of buildings)assigned+=(b.workers||0)+(b.guards||0)+(b.scholars||0);let over=assigned-population;if(over<=0)return;const order=buildings.map((b,i)=>({b,i})).sort((x,y)=>{const px=PULL[x.b.type]??3,py=PULL[y.b.type]??3;if(px!==py)return py-px;return y.i-x.i});for(const{b} of order){if(over<=0)break;while(over>0&&(b.workers||0)>0){b.workers--;over--}while(over>0&&(b.guards||0)>0){b.guards--;over--}while(over>0&&(b.scholars||0)>0){b.scholars--;over--}}if(over>0)officials=Math.max(0,officials-over);renderAll();updateUI()}
function processInjuries(){
  // 1. 一定概率新增轻伤
  if(population>0&&injuries.length<population&&Math.random()<getInjureChance()){
    injuries.push({sev:'light',days:LIGHT_DAYS});
    addLog('一位村民在劳作中受了轻伤 🩹','event');
  }
  // 2. 有医馆则每日治疗（优先重伤）
  if(hasClinic()&&injuries.length){
    const order=injuries.map((inj,i)=>({inj,i})).sort((a,b)=>(a.inj.sev==='heavy'?0:1)-(b.inj.sev==='heavy'?0:1));
    let healed=0;
    for(const{o} of order){
      if(healed>=clinicHealPerDay())break;
      const idx=injuries.indexOf(o);
      if(idx>=0){injuries.splice(idx,1);healed++;addLog(o.sev==='heavy'?'医馆治好了一名重伤村民 ✅':'医馆治好了一名轻伤村民 ✅','good')}
    }
  }
  // 3. 倒计时推进
  for(let i=injuries.length-1;i>=0;i--){
    const inj=injuries[i];
    inj.days--;
    if(inj.days>0)continue;
    if(hasClinic()){injuries.splice(i,1);continue;} // 有医馆接管，好转移除
    if(inj.sev==='light'){ // 无医馆→转重伤
      inj.sev='heavy';inj.days=HEAVY_DAYS;
      addLog('一名轻伤村民因无医馆医治，恶化成重伤！','bad');
    }else{ // 无医馆→死亡
      injuries.splice(i,1);
      population=Math.max(1,population-1);
      reconcilePop();
      addLog('一名重伤村民不幸去世……','bad');
    }
  }
}
function getGridSize(lv){if(lv<=1)return{cols:8,rows:5};if(lv===2)return{cols:9,rows:5};if(lv===3)return{cols:10,rows:6};return{cols:12,rows:6}}

function getBanditScale(){const p=(villageLevel-1)*.12,pS=Math.max(.2,.6-p),pA=Math.min(.4,.1+p),r=Math.random();if(r<pS)return'small';if(r<pS+(1-pS-pA))return'gang';return'army'}
function getBanditDemand(s){if(s==='small')return{gold:50};if(s==='gang')return Math.random()<.5?{gold:100}:{casualties:1};return Math.random()<.5?{gold:200}:{casualties:2}}

// ===================== 网格 =====================
function remapBuildings(oldC,oldR,newC,newR){const old=gridData.slice();gridData.length=0;for(let i=0;i<newC*newR;i++)gridData.push(null);for(let i=0;i<oldC*oldR;i++){if(!old[i])continue;const oc=i%oldC,or=Math.floor(i/oldC);let nc=oc,nr=or;for(let d=0;d<20;d++){if(!gridData[nr*newC+nc])break;const dc=[0,1,-1,0,1,-1,1,-1][d%8],dr=[1,0,0,-1,-1,1,-1,1][d%8];nc=Math.max(0,Math.min(newC-1,nc+dc));nr=Math.max(0,Math.min(newR-1,nr+dr))}const ni=nr*newC+nc;gridData[ni]=old[i];gridData[ni].index=ni}}

function initGrid(){const sz=getGridSize(villageLevel);const nc=sz.cols,nr=sz.rows,ol=gridData.length;if(ol){remapBuildings(GRID_COLS,GRID_ROWS,nc,nr)}else{for(let i=0;i<nc*nr;i++)gridData.push(null)}GRID_COLS=nc;GRID_ROWS=nr;const g=document.getElementById('grid');g.style.gridTemplateColumns=`repeat(${nc},92px)`;g.style.gridTemplateRows=`repeat(${nr},92px)`;g.innerHTML='';for(let i=0;i<nc*nr;i++){const c=document.createElement('div');c.className='grid-cell';c.onclick=()=>onCellClick(i,c);g.appendChild(c);if(gridData[i]&&gridData[i].type)renderCell(i,c)}}

function onCellClick(idx,cell){if(demolishMode){if(gridData[idx]){demolishBuilding(idx,cell)}return}if(selectedBuilding){placeBuilding(idx,cell);return}if(gridData[idx]){const t=gridData[idx].type;const btype=BT[t];if(btype.maxW>0&&btype.prod&&Object.keys(btype.prod).length){openWorkerMenu(idx,cell);return}if(t==='school'){openSchoolMenu(idx,cell);return}if(t==='wall'){openWallMenu(idx,cell);return}if(t==='paifang'){openPaifangMenu(idx,cell);return}tryUpgradeBuilding(idx,cell)}}

function renderCell(idx,cell){const b=gridData[idx];if(!b||!b.type)return;const bt=BT[b.type];cell.classList.add('has-building');let h=`<span class="building-emoji">${bt.c}</span><span class="level-badge">Lv${b.level}</span>`;if(b.workers>0)h+=`<span class="worker-badge">👷${b.workers}</span>`;if(b.guards>0)h+=`<span class="worker-badge" style="background:#4a4;top:auto;bottom:2px;right:2px">🛡️${b.guards}</span>`;if(b.scholars>0)h+=`<span class="worker-badge" style="background:#48b">📖${b.scholars}</span>`;cell.innerHTML=h}

function renderAll(){const cs=document.querySelectorAll('.grid-cell');for(const b of buildings){const c=cs[b.index];if(c)renderCell(b.index,c)}}

// ===================== 建筑操作 =====================
function placeBuilding(idx,cell){const bt=BT[selectedBuilding];if(villageLevel<bt.minLv)return;for(const[k,v]of Object.entries(bt.cost)){if(RESOURCES[k]<v){addLog(`建造${bt.n}失败：资源不足`,'bad');return}}for(const[k,v]of Object.entries(bt.cost))RESOURCES[k]-=v;const b={type:selectedBuilding,workers:0,level:1,guards:0,index:idx};if(bt.maxW>0&&bt.prod&&Object.keys(bt.prod).length&&getIdlePop()>=1)b.workers=1;gridData[idx]=b;buildings.push(b);renderCell(idx,cell);if(bt.popB)popMax+=bt.popB;if(bt.satB)satisfaction=Math.min(100,satisfaction+bt.satB);stats.buildingsBuilt++;addLog(`建造了${bt.n}`,'good');flashResource('res-gold');selectedBuilding=null;document.querySelectorAll('.build-btn').forEach(b=>b.classList.remove('selected'));updateUI()}

function tryUpgradeBuilding(idx,cell){const b=gridData[idx];if(!b)return;const bt=BT[b.type];if(b.level>=3){addLog(`${bt.n}已是最高等级`,'event');return}const cost={};for(const[k,v]of Object.entries(bt.cost))cost[k]=Math.floor(v*(b.level+1)*.8);for(const[k,v]of Object.entries(cost)){if(RESOURCES[k]<v){addLog(`${bt.n}升级失败：资源不足`,'bad');return}}for(const[k,v]of Object.entries(cost))RESOURCES[k]-=v;b.level++;stats.upgradesDone++;const bi=buildings.findIndex(bb=>bb.index===idx);if(bi>=0)buildings[bi].level=b.level;if(bt.popB)popMax+=bt.popB;cell.querySelector('.level-badge').textContent=`Lv${b.level}`;addLog(`${bt.n}升级到Lv${b.level}`,'good');updateUI()}

function demolishBuilding(idx,cell){const b=gridData[idx];if(!b)return;const bt=BT[b.type];for(const[k,v]of Object.entries(bt.cost))RESOURCES[k]+=Math.floor(v*.5);if(bt.popB)popMax-=bt.popB*b.level;cell.classList.remove('has-building');cell.innerHTML='';gridData[idx]=null;buildings=buildings.filter(bb=>bb.index!==idx);addLog(`拆除了${bt.n}（返还50%资源）`,'event');updateUI()}

function openWorkerMenu(idx,cell){const b=gridData[idx];if(!b)return;const bt=BT[b.type],workers=b.workers||0,cap=bt.maxW,idle=getIdlePop(),rk=Object.keys(bt.prod)[0],rm={food:'食物',wood:'木材',stone:'石材',gold:'金币',water:'水'},rl=rm[rk]||rk,pw=bt.prod[rk];let m=workers*pw*b.level;if(b.type==='lumber'&&hasTech('ind_efficient'))m*=1.25;if(b.type==='quarry'&&hasTech('ind_deepmine'))m*=1.25;if(b.type==='market'&&hasPaifang())m*=1.3;if(b.type==='market'&&hasTech('com_market'))m*=1.3;if(b.type==='well'&&hasTech('agri_irrigation'))m*=1.3;if(officials>0)m*=(1+officialBonus()*officials);document.getElementById('modal-title').textContent=`${bt.c} ${bt.n}`;document.getElementById('modal-text').innerHTML=`👷 工人：${workers}/${cap}<br>📊 每5秒产出：${m.toFixed(1)} ${rl}<br>👤 闲置村民：${idle}`;const ct=document.getElementById('modal-btns');ct.innerHTML='';const add=document.createElement('button');add.className='modal-btn yes';add.textContent=`派工人 (+1)`;add.disabled=workers>=cap||idle<1;add.onclick=()=>{b.workers++;renderCell(idx,cell);updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(add);const rmBtn=document.createElement('button');rmBtn.className='modal-btn no';rmBtn.textContent='撤回工人 (-1)';rmBtn.disabled=workers<=0;rmBtn.onclick=()=>{b.workers--;renderCell(idx,cell);updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(rmBtn);if(b.level<3){const cost={};for(const[k,v]of Object.entries(bt.cost))cost[k]=Math.floor(v*(b.level+1)*.8);const canUp=Object.entries(cost).every(([r,c])=>RESOURCES[r]>=c);if(canUp){const upBtn=document.createElement('button');upBtn.className='modal-btn yes';upBtn.textContent=`升级到Lv${b.level+1} (${Object.entries(cost).map(([r,c])=>`${r==='stone'?'🪨':r==='wood'?'🪵':r==='gold'?'💰':r==='water'?'💧':r==='food'?'🌾':''}${c}`).join(',')})`;upBtn.onclick=()=>{for(const[k,v]of Object.entries(cost))RESOURCES[k]-=v;b.level++;stats.upgradesDone++;const bi=buildings.findIndex(bb=>bb.index===idx);if(bi>=0)buildings[bi].level=b.level;renderCell(idx,cell);updateUI();addLog(`${bt.n}升级到Lv${b.level}`,'good');openWorkerMenu(idx,cell)};ct.appendChild(upBtn)}}const close=document.createElement('button');close.className='modal-btn no';close.textContent='关闭';close.onclick=()=>document.getElementById('modal-overlay').classList.remove('show');ct.appendChild(close);document.getElementById('modal-overlay').classList.add('show')}

function openSchoolMenu(idx,cell){const b=gridData[idx];if(!b)return;const sc=b.scholars||0,cap=BT.school.maxW,idle=getIdlePop(),rp=hasPaifang()?3:2;document.getElementById('modal-title').textContent='📚 学堂';document.getElementById('modal-text').innerHTML=`📖 学者：${sc}/${cap}<br>💡 每天产出：${sc*rp} 研究点<br>👤 闲置村民：${idle}`;const ct=document.getElementById('modal-btns');ct.innerHTML='';const add=document.createElement('button');add.className='modal-btn yes';add.textContent='派遣学者 (+1)';add.disabled=sc>=cap||idle<1;add.onclick=()=>{b.scholars=(b.scholars||0)+1;renderCell(idx,cell);updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(add);const rmBtn=document.createElement('button');rmBtn.className='modal-btn no';rmBtn.textContent='召回学者 (-1)';rmBtn.disabled=sc<=0;rmBtn.onclick=()=>{b.scholars=Math.max(0,(b.scholars||0)-1);renderCell(idx,cell);updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(rmBtn);const close=document.createElement('button');close.className='modal-btn no';close.textContent='关闭';close.onclick=()=>document.getElementById('modal-overlay').classList.remove('show');ct.appendChild(close);document.getElementById('modal-overlay').classList.add('show')}

function openWallMenu(idx,cell){const b=gridData[idx];if(!b)return;const cap=getWallCap(),guards=b.guards||0,redPct=Math.round(getWallReduction()*100),idle=getIdlePop(),upkeep=getWallUpkeep(b);let ml=villageLevel>=4?`⚙️ 维护费：${upkeep} 石材/天`:'⚙️ Lv4后开启维护费';if(b.underfunded)ml='⚠️ 欠费！暂停增派守卫。补足石材后可恢复。';document.getElementById('modal-title').textContent=`🏰 城墙 Lv.${b.level}`;document.getElementById('modal-text').innerHTML=`🛡️ 减伤：${redPct}%<br>🛡️ 守卫：${guards}/${cap}（每名+10%）<br>${ml}<br>👤 闲置村民：${idle}`;const ct=document.getElementById('modal-btns');ct.innerHTML='';const cost={};for(const[k,v]of Object.entries(BT.wall.cost))cost[k]=Math.floor(v*(b.level+1)*.8);const canUp=b.level<3&&Object.entries(cost).every(([r,c])=>RESOURCES[r]>=c);if(canUp){const upBtn=document.createElement('button');upBtn.className='modal-btn yes';upBtn.textContent=`升级到Lv${b.level+1} (${Object.entries(cost).map(([r,c])=>`${r==='stone'?'🪨':r==='wood'?'🪵':'💰'}${c}`).join(',')})`;upBtn.onclick=()=>{for(const[k,v]of Object.entries(cost))RESOURCES[k]-=v;b.level++;stats.upgradesDone++;renderCell(idx,cell);updateUI();addLog(`城墙升级到Lv${b.level}`,'good');document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(upBtn)}const addBtn=document.createElement('button');addBtn.className='modal-btn yes';addBtn.textContent='增派守卫 (+1)';addBtn.disabled=!canAssignGuard(b);addBtn.onclick=()=>{b.guards=(b.guards||0)+1;renderCell(idx,cell);updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(addBtn);const rmBtn=document.createElement('button');rmBtn.className='modal-btn no';rmBtn.textContent='撤回守卫 (-1)';rmBtn.disabled=guards<=0;rmBtn.onclick=()=>{b.guards=Math.max(0,(b.guards||0)-1);renderCell(idx,cell);updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(rmBtn);const close=document.createElement('button');close.className='modal-btn no';close.textContent='关闭';close.onclick=()=>document.getElementById('modal-overlay').classList.remove('show');ct.appendChild(close);document.getElementById('modal-overlay').classList.add('show')}

function openPaifangMenu(idx,cell){const b=gridData[idx];if(!b)return;const cap=officialCap(),idle=getIdlePop();document.getElementById('modal-title').textContent='🏛️ 牌坊';document.getElementById('modal-text').innerHTML=`🏛️ 文官：${officials}/${cap}（每人全产出+${(officialBonus()*100).toFixed(0)}%）<br>👤 闲置村民：${idle}`;const ct=document.getElementById('modal-btns');ct.innerHTML='';const add=document.createElement('button');add.className='modal-btn yes';add.textContent='任命文官 (+1)';add.disabled=officials>=cap||idle<1;add.onclick=()=>{officials++;updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(add);const rmBtn=document.createElement('button');rmBtn.className='modal-btn no';rmBtn.textContent='罢免文官 (-1)';rmBtn.disabled=officials<=0;rmBtn.onclick=()=>{officials=Math.max(0,officials-1);updateUI();document.getElementById('modal-overlay').classList.remove('show')};ct.appendChild(rmBtn);const close=document.createElement('button');close.className='modal-btn no';close.textContent='关闭';close.onclick=()=>document.getElementById('modal-overlay').classList.remove('show');ct.appendChild(close);document.getElementById('modal-overlay').classList.add('show')}

function toggleDemolishMode(){demolishMode=!demolishMode;selectedBuilding=null;document.querySelectorAll('.build-btn').forEach(b=>b.classList.remove('selected'));addLog(demolishMode?'拆除模式开启，点击建筑拆除（返还50%资源）':'拆除模式关闭','event')}

// ===================== 建筑面板 =====================
function renderBuildPanel(){const c=document.getElementById('build-buttons');c.innerHTML='';let canAny=false;for(const[k,v]of Object.entries(BT)){if(!v.unlocked)continue;const btn=document.createElement('button');btn.className='build-btn';btn.dataset.type=k;let afford=true,costStr='';for(const[r,amt]of Object.entries(v.cost)){const ic=r==='gold'?'💰':r==='food'?'🌾':r==='wood'?'🪵':r==='stone'?'🪨':'💧';const ok=RESOURCES[r]>=amt;if(!ok)afford=false;costStr+=`${ic}${amt} `}btn.textContent=`${v.c} ${v.n} (${costStr.trim()})`;if(!afford){canAny=false;btn.style.opacity='.5'}else canAny=true;btn.onclick=()=>{selectedBuilding=(selectedBuilding===k?null:k);document.querySelectorAll('.build-btn').forEach(b=>b.classList.remove('selected'));if(selectedBuilding===k){btn.classList.add('selected');demolishMode=false}};c.appendChild(btn)}const dm=document.createElement('button');dm.className='build-btn';dm.style.background=demolishMode?'rgba(233,69,96,.3)':'';dm.textContent='🔨 拆除';dm.onclick=()=>{toggleDemolishMode();dm.style.background=demolishMode?'rgba(233,69,96,.3)':'';if(demolishMode){selectedBuilding=null;document.querySelectorAll('.build-btn:not(:last-child)').forEach(b=>b.classList.remove('selected'))}};c.appendChild(dm)}

// ===================== 游戏主循环 =====================
function tick(){if(gamePaused)return;gameTime++;if(gameTime%30===0){day++;if(hasClinic())health=Math.min(100,health+5);processInjuries();if(hasTech('com_bank')){RESOURCES.gold+=8;stats.goldEarned+=8}let nrp=0;for(const b of buildings){if(b.type==='school'&&(b.scholars||0)>0){let rp=b.scholars*2;if(hasPaifang())rp=Math.round(rp*1.5);nrp+=rp}}if(nrp>0)research+=nrp;const wall=getWall();if(wall&&villageLevel>=4){const r=applyWallUpkeep(wall);if(r.justUnderfunded)addLog('⚠️ 石材不足以维护城墙，已欠费——暂停增派守卫！','bad')}}const dp=(gameTime%30)/30*100;document.getElementById('time-progress').style.width=dp+'%';document.getElementById('time-day').textContent=`第${day}天`;if(gameTime%5===0){let income={food:0,wood:0,stone:0,gold:0,water:0};let wp=0;for(const b of buildings){const bt=BT[b.type];if(bt.prod&&bt.prod.water)wp+=bt.prod.water*b.level}let bwc=0;for(const b of buildings){const bt=BT[b.type];if(bt.cons&&bt.cons.water)bwc+=bt.cons.water*b.level}const ws=bwc>0&&(RESOURCES.water+wp)<bwc;for(const b of buildings){const bt=BT[b.type];if(!bt.prod)continue;let mul;if(bt.maxW>0)mul=(b.workers||0)*b.level;else mul=b.level;if(b.type==='lumber'&&hasTech('ind_efficient'))mul*=1.25;if(b.type==='quarry'&&hasTech('ind_deepmine'))mul*=1.25;if(b.type==='market'&&hasPaifang())mul*=1.3;if(b.type==='market'&&hasTech('com_market'))mul*=1.3;if(b.type==='well'&&hasTech('agri_irrigation'))mul*=1.3;if(officials>0)mul*=(1+officialBonus()*officials);if(ws&&bt.cons&&bt.cons.water)mul=0;for(const[r,amt]of Object.entries(bt.prod))income[r]+=amt*mul}RESOURCES.food+=income.food;RESOURCES.wood+=income.wood;RESOURCES.stone+=income.stone;RESOURCES.gold+=income.gold;RESOURCES.water+=income.water;stats.goldEarned+=income.gold;stats.foodProduced+=income.food;if(bwc>0){RESOURCES.water-=bwc;if(RESOURCES.water<0){RESOURCES.water=0;satisfaction=Math.max(0,satisfaction-3);if(Math.random()<.4)addLog('水源不足，需水建筑停产！','bad')}}let vw=population,vf=population;RESOURCES.water-=vw;RESOURCES.food-=vf;if(RESOURCES.water<0){RESOURCES.water=0;satisfaction=Math.max(0,satisfaction-3);addLog('村民饮水困难','bad')}if(RESOURCES.food<0){RESOURCES.food=0;satisfaction=Math.max(0,satisfaction-5);if(population>1&&Math.random()<.3){population--;reconcilePop();addLog('食物短缺，1位村民离开','bad')}}document.getElementById('income-food').textContent=`+${income.food.toFixed(1)} (-${vf}消耗)`;document.getElementById('income-wood').textContent=ws?`+${income.wood} (缺水停产)`:`+${income.wood}`;document.getElementById('income-stone').textContent=`+${income.stone}`;document.getElementById('income-gold').textContent=`+${income.gold.toFixed(1)}`;document.getElementById('income-water').textContent=`+${income.water.toFixed(1)} (-${vw+bwc}消耗)`;if(income.food>0)flashResource('res-food');if(income.wood>0)flashResource('res-wood');if(income.gold>0)flashResource('res-gold');if(income.water>0)flashResource('res-water');updateUI()}if(gameTime%15===0){if(RESOURCES.food>100)satisfaction=Math.min(100,satisfaction+1);satisfaction=Math.min(100,satisfaction+(population<=popMax?1:-3));if(health>70)satisfaction=Math.min(100,satisfaction+2);else if(health<30){satisfaction=Math.max(0,satisfaction-5);if(population>1&&Math.random()<.15){population--;addLog('健康度过低，1位村民病倒离开','bad')}}if(satisfaction>70&&population<popMax&&Math.random()<.3){population++;addLog('村庄繁荣，吸引新村民','good')}if(satisfaction<30&&population>1&&Math.random()<.2){population--;addLog('满意度太低，1位村民离开','bad')}}if(gameTime>10&&gameTime%50===0)triggerRandomEvent();checkLevelUp();if(population>stats.maxPop)stats.maxPop=population;checkAchv();checkWin()}

function triggerRandomEvent(){const av=EVENTS.filter(e=>villageLevel>=e.minLv);if(!av.length)return;let r=Math.random()*av.reduce((s,e)=>s+e.w,0);let ch=av[0];for(const e of av){r-=e.w;if(r<=0){ch=e;break}}if(ch.type==='bandit'){handleBanditEvent();return}stats.eventsHandled++;document.getElementById('modal-title').textContent=ch.t;document.getElementById('modal-text').textContent=ch.txt;const ct=document.getElementById('modal-btns');ct.innerHTML='';for(const cc of ch.ch){const btn=document.createElement('button');btn.className='modal-btn '+(cc.t.includes('拒绝')||cc.t.includes('算了')||cc.t.includes('不用')?'no':'yes');btn.textContent=cc.t;btn.onclick=()=>{cc.a();document.getElementById('modal-overlay').classList.remove('show');updateUI()};ct.appendChild(btn)}document.getElementById('modal-overlay').classList.add('show')}

function handleBanditEvent(){const s=getBanditScale();showBanditModal(s)}

function showBanditModal(s){const d=getBanditDemand(s),wr=getWallReduction(),gb=getGuardBonus(),rp=Math.round((wr+gb)*100),dt=d.gold!=null?`抢夺约${d.gold}金币`:`掳走约${d.casualties}人`;document.getElementById('modal-title').textContent=`🗡️ ${BANDIT_NAME[s]}来袭！`;document.getElementById('modal-text').innerHTML=`${dt}<br>🛡️ 当前防御：${rp}%`;const ct=document.getElementById('modal-btns');ct.innerHTML='';const rb=document.createElement('button');rb.className='modal-btn yes';rb.textContent='🎯 紧急加固 (+20%防御, -30🪵)';rb.disabled=RESOURCES.wood<30;rb.onclick=()=>{RESOURCES.wood-=30;resolveBandit(s,.2,d)};ct.appendChild(rb);const hb=document.createElement('button');hb.className='modal-btn no';hb.textContent='坚守阵地';hb.onclick=()=>resolveBandit(s,0,d);ct.appendChild(hb);document.getElementById('modal-overlay').classList.add('show')}

function resolveBandit(s,rb,d){document.getElementById('modal-overlay').classList.remove('show');stats.banditsFought++;const wr=getWallReduction(),gb=getGuardBonus(),red=Math.min(1,wr+gb+rb);if(d.gold!=null){const ls=Math.ceil(d.gold*(1-red));let rem=ls;const lg=Math.min(RESOURCES.gold,rem);RESOURCES.gold-=lg;rem-=lg;let lf=0;if(rem>0){lf=Math.min(RESOURCES.food,rem);RESOURCES.food-=lf;rem-=lf}const sh=Math.ceil(rem*.5);satisfaction=Math.max(0,satisfaction-sh);const ps=[];if(lg>0)ps.push(`金币-${lg}`);if(lf>0)ps.push(`食物-${lf}`);if(rem>0)ps.push(`满意度-${sh}`);if(!ps.length){stats.banditsPerfect++;addLog('城墙与守卫完全挡住了盗匪！','good')}else addLog(`盗匪洗劫：${ps.join('，')}`,'bad')}else{const cs=Math.ceil(d.casualties*(1-red));if(cs<=0){stats.banditsPerfect++;addLog('城墙与守卫完全挡住了盗匪！','good')}else if(hasClinic()){addLog(`盗匪造成${cs}名伤员，医馆全力救治...`,'bad');setTimeout(()=>{addLog(`${cs}名伤员已治愈`,'good');updateUI()},10000)}else{population=Math.max(1,population-cs);reconcilePop();satisfaction=Math.max(0,satisfaction-10);addLog(`盗匪掳走${cs}名村民！满意度-10`,'bad')}}updateUI()}

// ===================== 成就系统 =====================
function applyAchvRw(a){const r=a.rw||{};if(r.gold)RESOURCES.gold+=r.gold;if(r.food)RESOURCES.food+=r.food;if(r.sat)satisfaction=Math.min(100,satisfaction+r.sat);if(r.research)research+=r.research}
function rwT(a){const r=a.rw||{},ps=[];if(r.gold)ps.push(`金币+${r.gold}`);if(r.food)ps.push(`食物+${r.food}`);if(r.sat)ps.push(`满意度+${r.sat}`);if(r.research)ps.push(`研究+${r.research}`);return ps.length?ps.join('，'):'无奖励'}
function showAchvToast(a){const w=document.getElementById('achv-toast-wrap');if(!w)return;const e=document.createElement('div');e.className='achv-toast';e.innerHTML=`<div class="t1">🏆 成就达成</div><div class="t2">${a.ic} ${a.nm}</div><div class="t3">${a.ds} · ${rwT(a)}</div>`;w.appendChild(e);setTimeout(()=>e.remove(),3900)}
function checkAchv(){for(const a of ACHIEVEMENTS){if(unlockedAchievements.includes(a.id))continue;let ok=false;try{ok=!!a.ck()}catch(e){ok=false}if(!ok)continue;unlockedAchievements.push(a.id);applyAchvRw(a);showAchvToast(a);addLog(`🏆 达成成就「${a.nm}」（${rwT(a)}）`,'good')}updateAchvBtn()}
function silentSyncAchv(){for(const a of ACHIEVEMENTS){if(unlockedAchievements.includes(a.id))continue;let ok=false;try{ok=!!a.ck()}catch(e){ok=false}if(ok)unlockedAchievements.push(a.id)}if(WIN_GOALS.every(g=>{try{return g.ok()}catch(e){return false}}))gameWon=true;updateAchvBtn()}
function updateAchvBtn(){const b=document.getElementById('achv-btn');if(b)b.textContent=`🏆 成就 ${unlockedAchievements.length}/${ACHIEVEMENTS.length}`}
function showAchievementModal(){const t=ACHIEVEMENTS.length,g=unlockedAchievements.length;document.getElementById('achv-count-text').textContent=`已解锁 ${g} / ${t}（${Math.round(g/t*100)}%）`;document.getElementById('achv-progress-fill').style.width=(g/t*100)+'%';let h='';for(const gr of ACHV_GROUPS){const ls=ACHIEVEMENTS.filter(a=>a.g===gr);if(!ls.length)continue;const gg=ls.filter(a=>unlockedAchievements.includes(a.id)).length;h+=`<div class="achv-group-title">${gr} · ${gg}/${ls.length}</div><div class="achv-grid">`;for(const a of ls){const d=unlockedAchievements.includes(a.id),s=a.hidden&&!d;h+=`<div class="achv-card ${d?'done':''}"><div class="ic">${s?'❔':a.ic}</div><div><div class="nm">${s?'???':a.nm}</div><div class="ds">${s?'隐藏成就，达成后揭晓':a.ds}</div><div class="rw">${d?'✅ '+rwT(a):(s?'':'奖励：'+rwT(a))}</div></div></div>`}h+='</div>'}document.getElementById('achv-list').innerHTML=h;document.getElementById('achv-overlay').classList.add('show')}
function closeAchievementModal(){document.getElementById('achv-overlay').classList.remove('show')}

// ===================== 科技树 =====================
function openTechTree(){document.getElementById('tech-research-text').textContent=`📖 当前研究点：${Math.floor(research)}（学堂学者每日产出，研究即消耗）`;renderTechList();document.getElementById('tech-overlay').classList.add('show')}
function closeTechTree(){document.getElementById('tech-overlay').classList.remove('show')}
function renderTechList(){let h='';for(const br of TECH_BRANCHES){const ls=Object.entries(TECH).filter(([k,t])=>t.branch===br);if(!ls.length)continue;h+=`<div class="achv-group-title">${br}</div><div class="achv-grid">`;for(const[k,t]of ls){const done=hasTech(k),preOk=t.pre.every(p=>hasTech(p)),canBuy=!done&&preOk&&research>=t.cost;const lockMsg=preOk?'':`🔒 需先研究：${t.pre.map(p=>TECH[p].n).join('、')}`;h+=`<div class="achv-card ${done?'done':(preOk?'':'')}" style="${!done&&!preOk?'opacity:.45':''}"><div class="ic">${t.c}</div><div><div class="nm">${t.n}</div><div class="ds">${t.ds}</div><div class="rw">📖 ${t.cost} 研究点</div><button class="tech-btn ${done?'done':(canBuy?'':'disabled')}" ${done||!canBuy?'disabled':''} onclick="buyTech('${k}')">${done?'✅ 已研究':(preOk?(canBuy?'🔬 研究':'研究点不足'):'前置未满足')}</button>${!done&&!preOk?`<div class="ds" style="color:#ff8a8a;margin-top:3px;">${lockMsg}</div>`:''}</div></div>`}h+='</div>'}document.getElementById('tech-list').innerHTML=h}
function buyTech(id){const t=TECH[id];if(hasTech(id))return;if(!t.pre.every(p=>hasTech(p))){addLog('科技前置未满足','bad');return}if(research<t.cost){addLog('研究点不足','bad');return}research-=t.cost;researchSpent+=t.cost;techUnlocked.push(id);addLog(`🔬 研究完成：${t.c}${t.n}`,'good');renderTechList();updateUI()}

// ===================== 通关目标 =====================
function renderGoalInfo(){const e=document.getElementById('goal-info');if(!e)return;if(gameWon){e.innerHTML=`<div class="upgrade-maxed">🎊 已通关 · 无尽经营中</div><div class="goal-hint">第${day}天，人口${population}，成就${unlockedAchievements.length}/${ACHIEVEMENTS.length}</div>`;return}const dc=WIN_GOALS.filter(g=>g.ok()).length;let h=`<div class="upgrade-next">进度 ${dc}/${WIN_GOALS.length}</div>`;for(const g of WIN_GOALS){const ok=g.ok();h+=`<div class="goal-row"><span>${g.ic} ${g.l}</span><span class="${ok?'g-done':'g-todo'}">${g.cur()} ${ok?'✅':''}</span></div>`}h+='<div class="goal-hint">五项全部达成即通关，可查看评级结算并继续无尽经营。</div>';e.innerHTML=h}
function computeWinRank(){const as=unlockedAchievements.length/ACHIEVEMENTS.length*60,od=Math.max(0,day-100),ts=Math.max(0,40-Math.floor(od/10)*3),total=Math.round(as+ts);let rk,cm;if(total>=85){rk='S';cm='千古一村长'}else if(total>=72){rk='A';cm='治村有方'}else if(total>=58){rk='B';cm='安稳一方'}else{rk='C';cm='磕磕绊绊'}return{rank:rk,comment:cm,total}}
function checkWin(){if(gameWon)return;if(!WIN_GOALS.every(g=>g.ok()))return;gameWon=true;addLog('🎊 《村志》终章达成！你的村庄成了一方名镇！','good');showWinModal()}
function showWinModal(){const{rank,comment,total}=computeWinRank();document.getElementById('win-rank').textContent=rank;document.getElementById('win-comment').textContent=comment;const rs=[['用时',`${day}天`],['最终人口',`${population}/${popMax}`],['村庄等级',`Lv.${villageLevel}`],['建筑',`${buildings.length}座·${new Set(buildings.map(b=>b.type)).size}种`],['累计金币',`${Math.floor(stats.goldEarned)}`],['无损击退',`${stats.banditsPerfect}/${stats.banditsFought}次`],['事件',`${stats.eventsHandled}次`],['成就',`${unlockedAchievements.length}/${ACHIEVEMENTS.length}`],['综合评分',`${total}分`]];document.getElementById('win-stats').innerHTML=rs.map(r=>`<div class="win-stat-row"><span>${r[0]}</span><span class="v">${r[1]}</span></div>`).join('');document.getElementById('win-overlay').classList.add('show')}
function closeWinModal(){document.getElementById('win-overlay').classList.remove('show');addLog('村志已成，但日子还得往下过——无尽经营。','event')}

// ===================== 村庄升级 =====================
function checkLevelUp(){const lvs=[{lv:2,np:10,ng:300,ns:50},{lv:3,np:20,ng:800,ns:60},{lv:4,np:40,ng:2000,ns:70,needP:true}];for(const lv of lvs){if(villageLevel!==lv.lv-1)continue;if(population<lv.np||RESOURCES.gold<lv.ng||satisfaction<lv.ns)continue;if(lv.needP&&!hasPaifang())continue;villageLevel=lv.lv;for(const[k,v]of Object.entries(BT)){if(v.minLv<=villageLevel)v.unlocked=true}RESOURCES.gold+=lv.lv*100;satisfaction=Math.min(100,satisfaction+10);const t=document.getElementById('levelup-toast');t.innerHTML=`🎉 村庄升级到 Lv.${lv.lv}！<br><span style="font-size:16px;">解锁新建筑，奖励${lv.lv*100}金币</span>`;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);addLog(`村庄升级到Lv.${lv.lv}！`,'good');renderBuildPanel();initGrid();updateUI();break}}

// ===================== UI更新 =====================
function updateUI(){document.getElementById('val-gold').textContent=Math.floor(RESOURCES.gold);document.getElementById('val-food').textContent=Math.floor(RESOURCES.food);document.getElementById('val-wood').textContent=Math.floor(RESOURCES.wood);document.getElementById('val-stone').textContent=Math.floor(RESOURCES.stone);document.getElementById('val-water').textContent=Math.floor(RESOURCES.water);document.getElementById('val-pop').textContent=population;document.getElementById('val-popmax').textContent=popMax;document.getElementById('val-sat').textContent=Math.round(satisfaction);document.getElementById('sat-fill').style.width=satisfaction+'%';document.getElementById('village-level').textContent=`村庄 Lv.${villageLevel}`;document.getElementById('info-pop').textContent=`${population} / ${popMax}`;document.getElementById('info-buildings').textContent=`${buildings.length}/${GRID_COLS*GRID_ROWS}`;document.getElementById('info-sat').textContent=Math.round(satisfaction);document.getElementById('info-health').textContent=Math.round(health);
const ii=document.getElementById('info-injured');if(ii){const n=injuries.length;ii.textContent=n;const hasHeavy=injuries.some(x=>x.sev==='heavy');ii.style.color=hasHeavy?'#e74c3c':n>0?'#e67e22':'#27ae60'}document.getElementById('info-research').textContent=Math.floor(research);document.getElementById('info-officials').textContent=officials;document.getElementById('info-time').textContent=`第${day}天`;renderUpgradeInfo();renderGoalInfo();updateAchvBtn();renderBuildPanel()}
function renderUpgradeInfo(){const e=document.getElementById('upgrade-info'),lvs=[{lv:2,np:10,ng:300,ns:50},{lv:3,np:20,ng:800,ns:60},{lv:4,np:40,ng:2000,ns:70,needP:true}];const n=lvs.find(l=>l.lv===villageLevel+1);if(!n){e.innerHTML='<div class="upgrade-maxed">✅ 已满级！</div>';return}const rs=[{la:'👥 人口',cur:population,need:n.np},{la:'💰 金币',cur:Math.floor(RESOURCES.gold),need:n.ng},{la:'😊 满意度',cur:Math.round(satisfaction),need:n.ns}];let h=`<div class="upgrade-next">下一级：Lv.${n.lv}</div>`;for(const r of rs){const m=r.cur>=r.need;h+=`<div class="upgrade-row"><span>${r.la}</span><span class="${m?'req-met':'req-not'}">${r.cur}/${r.need} ${m?'✅':''}</span></div>`}if(n.needP){const m=hasPaifang();h+=`<div class="upgrade-row"><span>🏛️ 牌坊</span><span class="${m?'req-met':'req-not'}">${m?'已建成 ✅':'未建造'}</span></div>`}e.innerHTML=h}

// ===================== 暂停/速度 =====================
function togglePause(){gamePaused=!gamePaused;const b=document.getElementById('pause-btn');if(gamePaused){clearInterval(tickInterval);b.classList.add('active');b.textContent='▶ 继续'}else{tickInterval=setInterval(tick,1000/gameSpeed);b.classList.remove('active');b.textContent='⏸ 暂停'}}
function setSpeed(s){gameSpeed=s;document.querySelectorAll('.speed-btn').forEach(b=>b.classList.remove('active'));document.querySelector(`.speed-btn:nth-child(${s})`).classList.add('active');if(!gamePaused){clearInterval(tickInterval);tickInterval=setInterval(tick,1000/gameSpeed)}}

// ===================== 存档系统 =====================
function getSaveData(){return{resources:{...RESOURCES},population,popMax,satisfaction,villageLevel,day,gameTime,buildings:buildings.map(b=>({type:b.type,workers:b.workers,level:b.level,guards:b.guards||0,scholars:b.scholars||0,index:b.index})),injuries:injuries.map(x=>({sev:x.sev,days:x.days})),health,research,researchSpent,officials,techUnlocked:[...techUnlocked],stats:{...stats},unlockedAchievements:[...unlockedAchievements],gameWon,saveTime:new Date().toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}}
function saveGame(k){try{localStorage.setItem(k,JSON.stringify(getSaveData()));addLog('游戏已保存','good');return true}catch(e){addLog('保存失败：存储空间不足','bad');return false}}
function loadGame(k){const r=localStorage.getItem(k);if(!r)return false;try{const d=JSON.parse(r);RESOURCES.gold=d.resources.gold;RESOURCES.food=d.resources.food;RESOURCES.wood=d.resources.wood;RESOURCES.stone=d.resources.stone;RESOURCES.water=d.resources.water||20;health=d.health!=null?d.health:80;research=d.research||0;researchSpent=d.researchSpent||0;officials=d.officials||0;population=d.population;popMax=d.popMax;satisfaction=d.satisfaction;villageLevel=d.villageLevel;day=d.day;gameTime=d.gameTime;techUnlocked=Array.isArray(d.techUnlocked)?d.techUnlocked.slice():[];buildings=[];const loadSz=getGridSize(villageLevel);GRID_COLS=loadSz.cols;GRID_ROWS=loadSz.rows;gridData.length=0;for(let i=0;i<GRID_COLS*GRID_ROWS;i++)gridData.push(null);const KNOWN=new Set(BT_KEYS);let removedUnknown=0;for(const b of d.buildings){if(!KNOWN.has(b.type)){removedUnknown++;continue;}const o={type:b.type,workers:b.workers,level:b.level,guards:b.guards||0,scholars:b.scholars||0,index:b.index};gridData[b.index]=o;buildings.push(o)}if(removedUnknown>0)addLog(`已移除${removedUnknown}个已下线的建筑（如磨坊）`,'event');for(const b of buildings){const bt=BT[b.type];if((b.workers||0)===0&&bt.maxW>0&&bt.prod&&Object.keys(bt.prod).length&&getIdlePop()>=1)b.workers=1}injuries=Array.isArray(d.injuries)?d.injuries.map(x=>({sev:x.sev,days:x.days})):[];stats={...DEFAULT_STATS,...(d.stats||{})};unlockedAchievements=Array.isArray(d.unlockedAchievements)?d.unlockedAchievements.slice():[];gameWon=!!d.gameWon;for(const[k,v]of Object.entries(BT)){if(v.minLv<=villageLevel)v.unlocked=true}if(!Array.isArray(d.unlockedAchievements)){stats.maxPop=Math.max(stats.maxPop,population);silentSyncAchv()}initGrid();renderAll();updateUI();addLog(`读档成功（第${day}天）`,'good');return true}catch(e){addLog('读档失败：存档损坏','bad');return false}}

function getSlotInfo(k){const r=localStorage.getItem(k);if(!r)return null;try{const d=JSON.parse(r);return{day:d.day,saveTime:d.saveTime||'',villageLevel:d.villageLevel}}catch(e){return null}}
function showSaveModal(m){saveMode=m;const o=document.getElementById('save-overlay'),t=document.getElementById('save-modal-title'),c=document.getElementById('save-slots-container');t.textContent=m==='save'?'💾 存档':'📂 读档';const sn=['存档一','存档二','存档三'];let h='';for(let i=0;i<3;i++){const info=getSlotInfo(SAVE_KEYS[i]);h+=`<div class="save-slot" onclick="onSlotClick('${SAVE_KEYS[i]}')">`+`<div class="save-slot-name">${sn[i]}</div>`+(info?`<div class="save-slot-detail">第${info.day}天 · 村庄Lv.${info.villageLevel} · ${info.saveTime}</div>`:'<div class="save-slot-detail" style="color:#666;">空</div>')+'</div>'}const ai=getSlotInfo(AUTOSAVE_KEY);if(ai)h+=`<div class="save-slot" onclick="onSlotClick('${AUTOSAVE_KEY}')"><div class="save-slot-name">🕐 自动存档</div><div class="save-slot-detail">第${ai.day}天 · 村庄Lv.${ai.villageLevel} · ${ai.saveTime}</div></div>`;c.innerHTML=h;o.classList.add('show')}
function closeSaveModal(){document.getElementById('save-overlay').classList.remove('show')}
function onSlotClick(k){if(saveMode==='save'){const ex=getSlotInfo(k);if(ex&&!confirm(`覆盖「第${ex.day}天 · Lv.${ex.villageLevel}」的存档？`))return;saveGame(k);closeSaveModal()}else{const info=getSlotInfo(k);if(!info)return;if(!confirm(`读取「第${info.day}天 · Lv.${info.villageLevel}」的存档？当前进度将丢失。`))return;loadGame(k);closeSaveModal();if(gamePaused)togglePause();if(!gamePaused&&!tickInterval)tickInterval=setInterval(tick,1000/gameSpeed)}}

// ===================== 启动 =====================
initGrid();
const autoSave=getSlotInfo(AUTOSAVE_KEY);
const manualSave=getSlotInfo(SAVE_KEYS[0])||getSlotInfo(SAVE_KEYS[1])||getSlotInfo(SAVE_KEYS[2]);
latestSave=(()=>{let best=null;for(const k of[AUTOSAVE_KEY,...SAVE_KEYS]){const i=getSlotInfo(k);if(i&&(!best||i.day>best.info.day)){best={key:k,info:i}}}return best})();
if(latestSave){document.getElementById('modal-title').textContent='🏠 欢迎回来，村长';document.getElementById('modal-text').innerHTML=`检测到存档：<b>第${latestSave.info.day}天 · 村庄Lv.${latestSave.info.villageLevel}</b><br>是否继续游戏？`;document.getElementById('modal-btns').innerHTML=`<button class="modal-btn yes" onclick="confirmContinue('${latestSave.key}')">继续游戏</button><button class="modal-btn no" onclick="confirmNewGame()">重新开始</button>`;document.getElementById('modal-overlay').classList.add('show')}else{tickInterval=setInterval(tick,1000/gameSpeed);updateUI();addLog('你是新任村长，带领村民建设家园吧！','event');addLog('提示：先建水井产水，再建农田和伐木场（点击建筑可派/撤工人）','event')}
function confirmContinue(k){document.getElementById('modal-overlay').classList.remove('show');loadGame(k);for(const[v]of Object.entries(BT)){if(v.minLv<=villageLevel)v.unlocked=true}initGrid();renderAll();updateUI();if(!gamePaused&&!tickInterval)tickInterval=setInterval(tick,1000/gameSpeed)}
function confirmNewGame(){document.getElementById('modal-overlay').classList.remove('show');resetGame()}

// ===================== 重新开始 =====================
function confirmReset(){const o=document.getElementById('modal-overlay');document.getElementById('modal-title').textContent='🔄 重新开始';document.getElementById('modal-text').innerHTML='确定重新开始？所有进度将清空，无法恢复。';const ct=document.getElementById('modal-btns');ct.innerHTML='';const y=document.createElement('button');y.className='modal-btn yes';y.textContent='确定重新开始';y.onclick=()=>{o.classList.remove('show');resetGame()};ct.appendChild(y);const n=document.createElement('button');n.className='modal-btn no';n.textContent='取消';n.onclick=()=>o.classList.remove('show');ct.appendChild(n);o.classList.add('show')}
function resetGame(){RESOURCES.gold=500;RESOURCES.food=50;RESOURCES.wood=30;RESOURCES.stone=0;RESOURCES.water=20;population=3;popMax=5;satisfaction=65;health=80;research=0;researchSpent=0;officials=0;villageLevel=1;day=1;gameTime=0;buildings=[];injuries=[];techUnlocked=[];stats={...DEFAULT_STATS};unlockedAchievements=[];gameWon=false;document.getElementById('achv-toast-wrap').innerHTML='';GRID_COLS=8;GRID_ROWS=5;gridData.length=0;for(const[k,v]of Object.entries(BT))v.unlocked=v.minLv<=1;localStorage.removeItem(AUTOSAVE_KEY);document.getElementById('log-area').innerHTML='';addLog('村庄重置！你是新任村长，加油吧！','event');addLog('提示：先建水井产水，再建农田和伐木场（点击建筑可派/撤工人）','event');initGrid();updateUI();clearInterval(tickInterval);gamePaused=false;const pb=document.getElementById('pause-btn');pb.classList.remove('active');pb.textContent='⏸ 暂停';tickInterval=setInterval(tick,1000/gameSpeed)}

// 每60秒自动存档
setInterval(()=>{if(!gamePaused&&buildings.length>0)saveGame(AUTOSAVE_KEY)},60000);

// ===================== 一键复制分享链接 =====================
function copyShareLink(){
  const url=location.href;
  const ok=()=>showCopyToast('✅ 链接已复制，去粘贴分享吧');
  const fail=()=>showCopyToast('⚠️ 复制失败，请长按网址手动复制');
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(ok).catch(()=>fallbackCopy(url,ok,fail));
  }else{
    fallbackCopy(url,ok,fail);
  }
}
function fallbackCopy(text,ok,err){
  try{
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.position='fixed';ta.style.top='-9999px';
    document.body.appendChild(ta);ta.focus();ta.select();
    const done=document.execCommand('copy');
    document.body.removeChild(ta);
    done?ok():err();
  }catch(e){err();}
}
function showCopyToast(msg){
  let w=document.getElementById('copy-toast');
  if(!w){
    w=document.createElement('div');w.id='copy-toast';
    w.style.cssText='position:fixed;left:50%;top:18%;transform:translateX(-50%);background:rgba(20,20,40,0.92);color:#f5c518;padding:10px 18px;border-radius:24px;font-size:14px;font-weight:bold;z-index:9999;box-shadow:0 4px 18px rgba(0,0,0,0.4);pointer-events:none;transition:opacity .25s;opacity:0;font-family:inherit;';
    document.body.appendChild(w);
  }
  w.textContent=msg;w.style.opacity='1';
  clearTimeout(w._t);w._t=setTimeout(()=>{w.style.opacity='0';},1800);
}
