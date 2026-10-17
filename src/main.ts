import { LEVELS } from './levels.ts';
import { MineEngine } from './engine.ts';
import { MineRenderer } from './renderer.ts';
import { WIDE_VIEWPORT, type MineViewport } from './viewport.ts';
import { GameAudio } from './audio.ts';
import { loadSave, saveGame, clearRun, type RunCheckpoint, type ShopSave } from './storage.ts';
import { MODE_LABELS, emptyMatch, roundWinner, scoreRound, type GameMode, type MatchScore } from './modes.ts';

type Scene = 'menu'|'ready'|'playing'|'paused'|'help'|'result'|'shop'|'complete'|'confirm';
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id)! as T;
const canvas=$<HTMLCanvasElement>('game-canvas');
const overlay=$('overlay'), modal=$('modal-content');
const pauseButton=$<HTMLButtonElement>('pause-btn'), bombButton=$<HTMLButtonElement>('bomb-btn'), finishButton=$<HTMLButtonElement>('finish-btn');
const launchButton=$<HTMLButtonElement>('launch-btn'), fullscreenButton=$<HTMLButtonElement>('fullscreen-btn');
const launchTwoButton=$<HTMLButtonElement>('launch-two-btn'), bombTwoButton=$<HTMLButtonElement>('bomb-two-btn');
const stage=canvas.parentElement!;
const format=(value:number)=>Math.round(value).toLocaleString('zh-CN');
const money=(value:number)=>`¥ ${format(value)}`;
let mode:GameMode='solo';
let save=loadSave(mode);
const audio=new GameAudio(save.sound);
let checkpoint:RunCheckpoint=save.checkpoint?{...save.checkpoint}:{levelIndex:0,wallet:0,bombs:0,strength:false,diamondBonus:false,totalEarned:0};
let engine=new MineEngine(LEVELS[checkpoint.levelIndex],checkpoint);
const renderer=new MineRenderer(canvas);
renderer.setLevel(engine.level);
let scene:Scene='menu';
let beforeHelp:Scene='menu';
let lastFrame=performance.now(), elapsed=0, accumulator=0, hudElapsed=0;
let toastTimer:ReturnType<typeof setTimeout>;
let lastTick=60, reachedGoal=false, storageWarning=false;
let currentViewport:MineViewport={...WIDE_VIEWPORT};
let layoutFrame=0;
let completedMatch:MatchScore|null=null;

function isDuo() {return mode!=='solo';}
function newEngine(run:RunCheckpoint|ShopSave) {
  return new MineEngine(LEVELS[run.levelIndex],{...run,playerCount:isDuo()?2:1,...(mode==='versus'?{bombStocks:[1,1] as [number,number]}:{})});
}
function modeChip() {return `<p><span class="mode-chip">${MODE_LABELS[mode]}${isDuo()?' · 同一台设备':''}</span></p>`;}
function controlsText() {
  return isDuo()?(touchControls()?'P1 / P2 分别点击下钩；也可点击矿区左半 / 右半':'P1：S 下钩 / W 炸药 · P2：↓ 下钩 / ↑ 炸药'):
    (touchControls()?'点击「下钩」按钮或矿区':'空格 / ↓ 下钩 · B / ↑ 炸药');
}
function syncMode() {
  document.documentElement.classList.toggle('duo-mode',isDuo());
  document.documentElement.classList.toggle('versus-mode',mode==='versus');
  $('player-two-controls').classList.toggle('hidden',!isDuo());
  document.querySelector('.goal-track')!.classList.toggle('hidden',mode==='versus');
  $('income-label').textContent=mode==='versus'?'P1 金队':mode==='coop'?'合计收入':'本关收入';
  $('target-label').textContent=mode==='versus'?'P2 青队':mode==='coop'?'共同目标':'目标';
  $('wallet-label').textContent=mode==='versus'?'累计总收入':mode==='coop'?'共同钱包':'我的钱包';
  $('footer-controls').textContent=isDuo()?'P1：S / W · P2：↓ / ↑ · 手机点击各自按钮':'空格下钩 · 点击矿区也可以';
  canvas.setAttribute('aria-label',`挖矿画布。${isDuo()?'P1 用 S 下钩、W 炸药；P2 用向下方向键下钩、向上方向键炸药；点击矿区左右半边分别控制两人。':'点击矿区或下钩按钮；电脑空格或向下方向键下钩，B 或向上方向键炸药。'}`);
  scheduleViewport();
}
function selectMode(next:GameMode) {
  if(scene!=='menu'||next===mode)return;
  persist();const sound=save.sound;mode=next;save=loadSave(mode);save.sound=sound;completedMatch=null;mainMenu();
}

function touchControls() {return window.matchMedia('(pointer: coarse)').matches||window.innerWidth<=900;}
function syncViewport() {
  const bounds=stage.getBoundingClientRect();
  if(bounds.width<1||bounds.height<1)return;
  const portrait=getComputedStyle(stage).getPropertyValue('--mine-portrait').trim()==='1';
  const width=portrait?720:1280;
  const viewport:MineViewport={width,height:portrait?Math.max(740,Math.round(width*bounds.height/bounds.width)):720,portrait};
  const rotated=currentViewport.portrait!==portrait;
  if(rotated&&scene==='playing')pause('orientation');
  currentViewport=viewport;
  engine.setViewport(viewport);
  renderer.resize(viewport,Math.min(2,(window.devicePixelRatio||1)*bounds.width/width));
  document.documentElement.dataset.mineLayout=portrait?'portrait':'wide';
  document.documentElement.classList.toggle('touch-controls',touchControls());
}
function scheduleViewport() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame=requestAnimationFrame(syncViewport);
}
function useCurrentViewport() {engine.setViewport(currentViewport);renderer.setLevel(engine.level);scheduleViewport();}

function persist() {
  if(!saveGame(save,mode)&&!storageWarning){storageWarning=true;toast('浏览器未允许保存进度，本次仍可继续游玩。');}
}
function toast(text:string) {
  $('toast').textContent=text;$('toast').classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);
}
function button(action:string,label:string,primary=false,disabled=false) {
  return `<button type="button" class="button ${primary?'button-primary':'button-secondary'}" data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
}
function stats(items:Array<[string,string]>) {
  return `<div class="stat-grid">${items.map(([label,value])=>`<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
}
function mapDots(index:number) {
  const unit=mode==='versus'?'轮':'关';
  return `<div class="minimap-levels" aria-label="共20${unit}，当前第${index+1}${unit}">${LEVELS.map((_,i)=>`<span class="minimap-dot ${i<index?'completed':i===index?'current':''}">${i+1}</span>`).join('')}</div>`;
}
function show(html:string,wide=false) {
  modal.innerHTML=html;
  modal.classList.toggle('wide-modal',wide);
  modal.classList.toggle('menu-modal',scene==='menu');
  modal.classList.toggle('ready-modal',scene==='ready');
  overlay.classList.remove('hidden');
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  const heading=modal.querySelector('.modal-title');
  if(heading){heading.id='dialog-title';modal.setAttribute('aria-labelledby','dialog-title');}
  modal.scrollTop=0;
  requestAnimationFrame(()=>(modal.querySelector<HTMLButtonElement>('.button-primary:not(:disabled)')??modal.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({preventScroll:true}));
  updateHud();
}
function hide() {overlay.classList.add('hidden');canvas.focus({preventScroll:true});}
function title(eyebrow:string,heading:string,description='') {
  return `<p class="modal-eyebrow">${eyebrow}</p><h1 class="modal-title">${heading}</h1>${description?`<p class="modal-description">${description}</p>`:''}`;
}
function badges(run:RunCheckpoint|ShopSave) {
  return [run.strength?'力量提升 35%':'',run.diamondBonus?'钻石增值 50%':''].filter(Boolean).join(' · ')||'轻装出发，凭实力捞金';
}

const heroArt=`<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 300 110" fill="none"><path d="M26 88h248" stroke="#d9c29a" stroke-width="2"/><path d="m75 82 11-27 33-8 23 24-9 20H88Z" fill="#eebf55" stroke="#9b6a2e" stroke-width="3"/><path d="m89 59 25-5 11 13-31 3Z" fill="#ffe7a1"/><path d="m172 82 9-37 32-11 29 31-12 25h-45Z" fill="#edbd48" stroke="#9b6a2e" stroke-width="3"/><path d="m186 51 25-10 17 19-32 5Z" fill="#ffe7a1"/><path d="m137 77 13-14h17l13 14-21 25Z" fill="#88cfb3" stroke="#4e8272" stroke-width="2"/><path d="m137 77 43 0m-30-14 9 39 8-39" stroke="#d5f0d4" stroke-width="2"/><path d="M151 0v28m0 0-15 10 5 11m10-21 15 10-5 11" stroke="#71583a" stroke-width="5" stroke-linecap="round"/><path d="m53 39 3 7 8 2-8 3-3 8-3-8-8-3 8-2Zm195-13 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#c39846"/></svg></div>`;

function mainMenu() {
  scene='menu';audio.setScene('menu');
  syncMode();
  const resume=save.shop||save.checkpoint;
  checkpoint=resume?{...resume}:{levelIndex:0,wallet:0,bombs:0,strength:false,diamondBonus:false,totalEarned:0};
  engine=newEngine(checkpoint);useCurrentViewport();
  show(`${heroArt}${title('GOLDEN VALLEY · EST. 2026','黄金矿工','瞄准那一点金光，把整座矿山的好运带回家。<br>20 关矿场冒险，等你满载而归。')}
    <div class="menu-feature-line"><span>✦ 经典抓钩</span><span>✦ 关间商店</span><span>✦ 本地存档</span></div>
    <div class="mode-options" role="group" aria-label="选择游戏模式">${(['solo','coop','versus'] as GameMode[]).map(item=>`<button type="button" class="mode-option ${mode===item?'selected':''}" data-action="mode-${item}" aria-pressed="${mode===item}"><strong>${MODE_LABELS[item]}</strong><small>${item==='solo'?'独自挑战 20 关':item==='coop'?'同屏挖金 · 共同过关':'同屏比拼 · 各自计分'}</small></button>`).join('')}</div>
    <div class="modal-actions">${resume?button('continue',`继续第 ${resume.levelIndex+1} ${mode==='versus'?'轮':'关'} →`,true):button('new',mode==='solo'?'开始挖金 →':mode==='coop'?'一起挖金 →':'开始对战 →',true)}${resume?button('new','新的挑战'):button('help','怎么玩')}</div>
    <p class="modal-footer">${MODE_LABELS[mode]} · 最高到达 ${save.highestCleared} / 20 ${mode==='versus'?'轮':'关'} · 最佳累计 ${money(save.bestEarned)}<br>三种模式独立存档 · ${isDuo()?'两人在同一台设备上游玩':'横屏竖屏都能玩'}</p>`);
}

function startNew(force=false) {
  if(!force&&(save.checkpoint||save.shop)){
    scene='confirm';
    show(`${modeChip()}${title('A NEW ADVENTURE','再出发一次',`开始新的挑战会重置${MODE_LABELS[mode]}的本轮进度。<br>最佳记录和其他模式的存档会继续保留。`)}<div class="modal-actions">${button('force-new',`从第 1 ${mode==='versus'?'轮':'关'}开始`,true)}${button('home','保留进度')}</div>`);return;
  }
  save=clearRun(save);
  checkpoint={levelIndex:0,wallet:0,bombs:0,strength:false,diamondBonus:false,totalEarned:0};
  if(mode==='versus')checkpoint.match=emptyMatch();
  save.checkpoint={...checkpoint};persist();prepare(checkpoint);
}
function continueRun() {
  if(save.shop){openShop();return;}
  if(save.checkpoint){prepare({...save.checkpoint});return;}
  startNew();
}
function prepare(run:RunCheckpoint) {
  checkpoint={...run};
  save.checkpoint={...checkpoint};save.shop=null;persist();
  engine=newEngine(checkpoint);completedMatch=null;
  useCurrentViewport();scene='ready';audio.setScene('menu');
  reachedGoal=false;lastTick=60;accumulator=0;
  const level=engine.level;
  show(`<div class="level-badge">第 ${String(level.id).padStart(2,'0')} / 20 ${mode==='versus'?'轮':'关'}</div>${modeChip()}${title('EXPLORE THE MINE',level.name,mode==='versus'?'同一片矿场，各凭本事。60 秒结束后比较收入。':level.subtitle)}
    ${mode==='versus'?stats([['P1 累计',money(checkpoint.match?.totals[0]??0)],['P2 累计',money(checkpoint.match?.totals[1]??0)],['本轮炸药','每人 1 枚']]):stats([[mode==='coop'?'共同目标':'本关目标',money(level.target)],['挖矿时间','60 秒'],[mode==='coop'?'共用炸药':'炸药库存',`${checkpoint.bombs} 枚`]])}
    <p class="ready-buffs">${mode==='versus'?'每轮工具相同，无商店加成；20 轮累计收入更高者获胜。':mode==='coop'?`两人收入合并、钱包和道具共用。${badges(checkpoint)}`:badges(checkpoint)}</p>
    <p class="intro-controls">${controlsText()} <span>·</span> 拉回才计分</p>
    ${level.id>1?mapDots(checkpoint.levelIndex):''}
    <div class="modal-actions">${button('play','准备好了，下矿 →',true)}${button('home','返回主菜单')}</div>`);
}
function play() {
  if(scene!=='ready'&&scene!=='paused')return;
  const wasReady=scene==='ready';scene='playing';audio.setScene('game');hide();accumulator=0;lastFrame=performance.now();updateHud();
  if(wasReady)toast(checkpoint.levelIndex===0?controlsText():engine.level.subtitle);
}
function pause(automatic:boolean|'orientation'=false) {
  if(scene!=='playing')return;
  scene='paused';audio.setScene('silent');
  show(`${title('TAKE A BREATHER',automatic==='orientation'?'屏幕已切换，继续挖金吧':automatic?'休息一下，时间已暂停':'矿工休息中',automatic==='orientation'?'矿场已适配新方向，当前抓钩和收入都已保留。<br>点击继续，从刚才的地方接着玩。':'矿场、倒计时和道具效果都已暂停。<br>回来后，继续追逐你的下一块黄金。')}
    ${mode==='versus'?stats([['P1 本轮',money(engine.players[0].income)],['P2 本轮',money(engine.players[1].income)],['还剩时间',`${Math.ceil(engine.timeLeft)} 秒`]]):stats([['本关收入',money(engine.income)],['还剩时间',`${Math.ceil(engine.timeLeft)} 秒`],['本关目标',money(engine.level.target)]])}
    <div class="modal-actions">${button('resume','继续挖矿 →',true)}${button('help','查看玩法')}${button('home','返回主菜单')}</div><p class="modal-footer">返回主菜单后，可从本关开始时重新挑战。</p>`);
}
function help() {
  if(scene==='playing'){pause();beforeHelp='paused';}else beforeHelp=scene;
  scene='help';audio.setScene('silent');
  show(`${title('A MINER’S HANDBOOK','挖金小手册','时机、重量与一点点运气，就是你的挖矿秘诀。')}
    ${modeChip()}<ul class="help-list"><li><strong>当前操作：</strong>${controlsText()}。${isDuo()?'支持两人同时下钩。':''}</li><li><strong>双人合作：</strong>两人收入合并达标，共享钱包、炸药和商店增益；两把抓钩都返回后可收工。</li><li><strong>双人对战：</strong>每轮 60 秒，两人各计收入、各有 1 枚炸药。20 轮累计收入更高者获胜；相同则平局。对战没有商店，也不能提前收工。</li><li><strong>抢矿：</strong>先碰到矿物的抓钩获得它，绳索可交叉，不会撞到对方。</li><li><strong>炸药：</strong>只能炸掉自己正在回收的物品。单人 B / ↑，双人 P1 用 W、P2 用 ↑。</li><li><strong>手机横竖屏：</strong>双人模式下点击矿区左半控制 P1、右半控制 P2，或使用各自下钩按钮。转屏会暂停并保留抓钩状态。</li><li><strong>暂停：</strong>Esc / P 或顶部按钮。切换窗口也会自动暂停。</li><li><strong>拉回才入账：</strong>小 / 中 / 大金块 ¥50 / 200 / 500，钻石 ¥600；倒计时结束仍在路上的物品不计收入。</li><li><strong>存档：</strong>三种模式各自保存；刷新或返回菜单后从本关开始时恢复。对战完成一轮后保留累计成绩并进入下一轮。</li></ul>
    <div class="modal-actions">${button('help-back','明白了 →',true)}</div>`,true);
}
function backFromHelp() {
  if(beforeHelp==='paused'){scene='playing';pause();}
  else if(beforeHelp==='ready')prepare(checkpoint);
  else if(beforeHelp==='shop')openShop();
  else if(beforeHelp==='result')showResult();
  else if(beforeHelp==='complete')showComplete();
  else mainMenu();
}

function settled() {
  scene='result';
  if(mode==='versus') {
    completedMatch=scoreRound(checkpoint.match??emptyMatch(),[engine.players[0].income,engine.players[1].income]);
    const total=completedMatch.totals[0]+completedMatch.totals[1];
    save.bestEarned=Math.max(save.bestEarned,total);save.highestCleared=Math.max(save.highestCleared,engine.level.id);
    save.shop=null;
    if(checkpoint.levelIndex===LEVELS.length-1)save=clearRun(save);
    else save.checkpoint={levelIndex:checkpoint.levelIndex+1,wallet:total,bombs:0,strength:false,diamondBonus:false,totalEarned:total,match:completedMatch};
    persist();
    if(checkpoint.levelIndex===LEVELS.length-1)showComplete();else showResult();
    return;
  }
  if(engine.won){
    const total=checkpoint.totalEarned+engine.income;
    save.bestEarned=Math.max(save.bestEarned,total);save.highestCleared=Math.max(save.highestCleared,engine.level.id);
    if(checkpoint.levelIndex===LEVELS.length-1){save=clearRun(save);persist();showComplete();return;}
    save.checkpoint=null;
    save.shop={levelIndex:checkpoint.levelIndex+1,wallet:checkpoint.wallet+engine.income,bombs:engine.bombs,strength:false,diamondBonus:false,totalEarned:total,purchaseCounts:{bomb:0,strength:0,diamond:0}};
    persist();
  }
  showResult();
}
function showResult() {
  scene='result';audio.setScene('menu');
  if(mode==='versus') {
    const match=completedMatch!;
    const winner=roundWinner([engine.players[0].income,engine.players[1].income]);
    const label=winner===null?'本轮平局':`P${winner+1} 赢下本轮`;
    show(`${modeChip()}${title('A FRIENDLY RIVALRY',label,`第 ${engine.level.id} / 20 轮结束，准备下一场较量。`)}
      ${stats([['P1 金队 · 本轮',money(engine.players[0].income)],['P2 青队 · 本轮',money(engine.players[1].income)],['本轮结果',winner===null?'平局':`P${winner+1} 胜`]])}
      <p class="ready-buffs">累计收入：P1 ${money(match.totals[0])} · P2 ${money(match.totals[1])}<br>胜场 ${match.wins[0]} : ${match.wins[1]} · 平局 ${match.draws} 轮</p>
      <div class="modal-actions">${button('versus-next','下一轮 →',true)}${button('home','返回主菜单')}</div><p class="modal-footer">累计成绩已保存。下一轮双方各补充 1 枚炸药。</p>`);
    return;
  }
  const win=engine.won;
  show(`<span class="result-symbol ${win?'success':'failure'}" aria-hidden="true">${win?'✦':'⌛'}</span>${title(win?'A GOOD DAY’S WORK':'ONE MORE TRY',win?'这一趟，满载而归':'就差一点，再试一次',win?`第 ${engine.level.id} 关完成！带上你的收获，去商店看看。`:`还差 <strong>${money(engine.level.target-engine.income)}</strong> 就能过关。<br>优先瞄准钻石和金块，别被沉重的石头拖住。`)}
    ${stats([['本关收入',money(engine.income)],['目标收入',money(engine.level.target)],[win?'钱包余额':'重试炸药',win?money(checkpoint.wallet+engine.income):`${checkpoint.bombs} 枚`]])}
    <div class="modal-actions">${win?button('shop','去矿工商店 →',true):button('retry','再试一次 →',true)}${button('home','返回主菜单')}</div>
    <p class="modal-footer">${win?'消费只扣钱包，不影响累计成绩。':'重试会恢复本关开始时的钱包、炸药与增益，矿物布局保持不变。'}</p>`);
}
function showComplete() {
  scene='complete';audio.setScene('menu');
  if(mode==='versus') {
    const match=completedMatch!;
    const winner=roundWinner(match.totals);
    show(`${modeChip()}${title('TWENTY ROUNDS TOGETHER',winner===null?'旗鼓相当，整场平局':`P${winner+1}，今日矿王！`,'20 轮对战完成，以累计收入决出胜负。')}
      ${stats([['P1 累计',money(match.totals[0])],['P2 累计',money(match.totals[1])],['整场胜者',winner===null?'平局':`P${winner+1}`]])}
      <p class="ready-buffs">P1 获胜 ${match.wins[0]} 轮 · P2 获胜 ${match.wins[1]} 轮 · 平局 ${match.draws} 轮<br>最后一轮：P1 ${money(engine.players[0].income)} · P2 ${money(engine.players[1].income)}</p>
      <div class="modal-actions">${button('force-new','再战一场 →',true)}${button('home','返回主菜单')}</div>`);
    return;
  }
  const total=checkpoint.totalEarned+engine.income;
  show(`<span class="result-symbol success" aria-hidden="true">♛</span>${title('LEGEND OF GOLDEN VALLEY','传奇矿工，诞生！','20 座矿场，20 次满载而归。<br>你已经把金谷的故事，写进了自己的矿工手册。')}
    ${stats([['完成关卡','20 / 20'],['累计收入',money(total)],['剩余钱包',money(checkpoint.wallet+engine.income)]])}
    <div class="minimap-levels">${LEVELS.map(l=>`<span class="minimap-dot completed">${l.id}</span>`).join('')}</div>
    <div class="modal-actions">${button('force-new','再来一轮 →',true)}${button('home','返回主菜单')}</div><p class="modal-footer">最佳累计收入 ${money(save.bestEarned)} · 记录已自动保存</p>`);
}

const products=[
  {key:'bomb',icon:'✹',name:'炸药',price:100,description:'炸掉钩中物品<br>省下宝贵回收时间',limit:2},
  {key:'strength',icon:'⚗',name:'力量药水',price:250,description:'下一关携物回收<br>速度提高 35%',limit:1},
  {key:'diamond',icon:'◇',name:'钻石增值券',price:300,description:'下一关所有钻石<br>收入提高 50%',limit:1},
] as const;
function openShop() {
  const shop=save.shop;if(!shop){continueRun();return;}
  scene='shop';audio.setScene('shop');
  // Preview the next mine while the merchant is open.
  if(engine.level.id!==shop.levelIndex+1){engine=newEngine(shop);useCurrentViewport();}
  const hasDiamonds=LEVELS[shop.levelIndex].ores.some(ore=>ore.kind==='diamond');
  show(`${title('THE MINER’S GENERAL STORE','矿工补给站',`下一站：第 ${shop.levelIndex+1} 关 · ${LEVELS[shop.levelIndex].name}<br>钱包 <strong>${money(shop.wallet)}</strong> <span class="footer-divider">·</span> 炸药库存 ${shop.bombs} / 5`)}
    <div class="shop-grid">${products.map(p=>{
      const count=shop.purchaseCounts[p.key];
      const sold=count>=p.limit;
      const unavailable=p.key==='diamond'&&!hasDiamonds;
      const full=p.key==='bomb'&&shop.bombs>=5;
      const disabled=sold||unavailable||full||shop.wallet<p.price;
      const label=sold?'已购满':unavailable?'下关无钻石':full?'库存已满':shop.wallet<p.price?`还差 ¥${p.price-shop.wallet}`:'购买';
      return `<article class="shop-item"><span class="shop-icon ${p.key}" aria-hidden="true">${p.icon}</span><h3>${p.name}</h3><p>${p.description}</p><div class="shop-price">${money(p.price)}</div><button class="shop-buy" data-action="buy-${p.key}" ${disabled?'disabled':''}>${label}</button><small class="shop-limit">本店已购 ${count} / ${p.limit}</small></article>`;
    }).join('')}</div>
    <div class="modal-actions">${button('next','装备好了，下一关 →',true)}${button('home','稍后再来')}</div><p class="modal-footer">${badges(shop)}<br>道具可自由选购，每一关都能凭实力完成。</p>`,true);
}
function buy(key:'bomb'|'strength'|'diamond') {
  if(scene!=='shop'||!save.shop)return;
  const shop=save.shop,p=products.find(item=>item.key===key)!;
  if(shop.wallet<p.price||shop.purchaseCounts[key]>=p.limit||(key==='bomb'&&shop.bombs>=5)||(key==='diamond'&&!LEVELS[shop.levelIndex].ores.some(o=>o.kind==='diamond')))return;
  shop.wallet-=p.price;shop.purchaseCounts[key]++;
  if(key==='bomb')shop.bombs++;else if(key==='strength')shop.strength=true;else shop.diamondBonus=true;
  persist();audio.play('coin');openShop();toast(`已购买${p.name}`);
}
function nextLevel() {
  if(scene!=='shop'||!save.shop)return;
  const shop=save.shop;
  prepare({levelIndex:shop.levelIndex,wallet:shop.wallet,bombs:shop.bombs,strength:shop.strength,diamondBonus:shop.diamondBonus,totalEarned:shop.totalEarned});
}
function nextVersus() {if(mode==='versus'&&scene==='result'&&save.checkpoint)prepare(save.checkpoint);}

function updateHud() {
  const shop=scene==='shop'?save.shop:null;
  const playing=scene==='playing';
  $('level-number').textContent=String(engine.level.id).padStart(2,'0');$('level-name').textContent=`${mode==='coop'?'合作 · ':mode==='versus'?'对战 · ':''}${engine.level.name}`;
  $('level-unit').textContent=mode==='versus'?'/ 20 轮':'/ 20 关';
  $('income-value').textContent=money(mode==='versus'?engine.players[0].income:engine.income);$('target-value').textContent=money(mode==='versus'?engine.players[1].income:engine.level.target);
  $('wallet-value').textContent=money(mode==='versus'?checkpoint.totalEarned+engine.income:shop?shop.wallet:checkpoint.wallet+engine.income);
  $('time-value').innerHTML=`${Math.ceil(engine.timeLeft)}<span class="time-unit">s</span>`;
  $('time-value').classList.toggle('danger',engine.timeLeft<=10&&!engine.ended);
  const progress=Math.min(100,engine.income/engine.level.target*100);
  $('goal-fill').style.width=`${progress}%`;
  const progressbar=document.querySelector('[role="progressbar"]')!;
  progressbar.setAttribute('aria-valuenow',String(Math.round(progress)));progressbar.setAttribute('aria-valuemin','0');progressbar.setAttribute('aria-valuemax','100');
  $('bag-count').textContent=String(shop?shop.bombs:engine.bombStocks?.[0]??engine.bombs);
  $('bag-count-two').textContent=String(shop?shop.bombs:engine.bombStocks?.[1]??engine.bombs);
  $('player-one-income').textContent=money(engine.players[0].income);$('player-two-income').textContent=money(engine.players[1]?.income??0);
  $('buff-label').textContent=[(shop?.strength??engine.strength)?'力量 +35%':'',(shop?.diamondBonus??engine.diamondBonus)?'钻石 +50%':''].filter(Boolean).join(' · ')||'暂无加成';
  bombButton.disabled=!playing||!engine.canBombFor(0);bombTwoButton.disabled=!playing||!engine.canBombFor(1);finishButton.disabled=mode==='versus'||!playing||!engine.canFinish;
  for(const [index,control] of [launchButton,launchTwoButton].entries()) {
    const player=engine.players[index];
    control.disabled=!playing||!player||player.phase!=='swing';
    const launchLabel=player?.phase==='out'?'下钩中':!player||player.phase==='swing'?'下钩':'回收中';
    if(control.dataset.phase!==launchLabel){control.innerHTML=`<span aria-hidden="true">↓</span><span>${launchLabel}</span>`;control.dataset.phase=launchLabel;}
    control.setAttribute('aria-label',`${isDuo()?`P${index+1} `:''}${launchLabel}`);
  }
  bombButton.setAttribute('aria-label',isDuo()?'P1 使用炸药':'使用炸药');bombTwoButton.setAttribute('aria-label','P2 使用炸药');
  bombButton.title=isDuo()?'P1 使用炸药（W）':'使用炸药（B / ↑）';bombTwoButton.title='P2 使用炸药（↑）';
  fullscreenButton.classList.toggle('hidden',!document.fullscreenEnabled||!touchControls());
  fullscreenButton.innerHTML=`<span aria-hidden="true">⛶</span><span>${document.fullscreenElement?'退出全屏':'全屏'}</span>`;
  fullscreenButton.setAttribute('aria-label',document.fullscreenElement?'退出全屏':'全屏游戏');
  finishButton.title=engine.income>=engine.level.target?(isDuo()?'两把抓钩都回到起点后可收工':'抓钩回到起点后可收工'):'收入达标后可收工';
  pauseButton.disabled=scene!=='playing'&&scene!=='paused';
  pauseButton.innerHTML=scene==='paused'?'<span aria-hidden="true">▶</span><span>继续</span>':'<span aria-hidden="true">Ⅱ</span><span>暂停</span>';
  $('sound-btn').innerHTML=`<span aria-hidden="true">${save.sound?'♫':'♪'}</span><span>${save.sound?'声音开启':'声音关闭'}</span>`;
  $('sound-btn').setAttribute('aria-pressed',String(save.sound));
}
function launch(index=0) {if(scene==='playing'&&engine.launch(index))updateHud();}
function useBomb(index=0) {if(scene==='playing'){
  if(!engine.bomb(index))toast((engine.bombStocks?.[index]??engine.bombs)===0?(mode==='versus'?`P${index+1} 本轮炸药已用完。`:'没有炸药了，过关后可在商店补给。'):'抓到物品、正在回收时才能使用炸药。');
  updateHud();
}}
function action(name:string) {
  audio.unlock();if(!name.startsWith('buy-'))audio.play('click');
  switch(name){
    case'mode-solo':selectMode('solo');break;case'mode-coop':selectMode('coop');break;case'mode-versus':selectMode('versus');break;
    case'new':startNew();break;case'force-new':startNew(true);break;case'continue':continueRun();break;
    case'play':play();break;case'resume':play();break;case'home':mainMenu();break;case'help':help();break;
    case'help-back':backFromHelp();break;case'shop':openShop();break;case'retry':prepare(checkpoint);break;case'next':nextLevel();break;
    case'versus-next':nextVersus();break;
    case'buy-bomb':buy('bomb');break;case'buy-strength':buy('strength');break;case'buy-diamond':buy('diamond');break;
  }
}

modal.addEventListener('click',event=>{const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');if(target&&!target.disabled)action(target.dataset.action!);});
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();audio.unlock();if(event.pointerType!=='touch')canvas.focus({preventScroll:true});const bounds=canvas.getBoundingClientRect();launch(isDuo()&&event.clientX>=bounds.left+bounds.width/2?1:0);});
function bindPlayerButton(control:HTMLButtonElement,run:()=>void) {
  // A second finger is deliberately accepted so both miners can act together.
  control.addEventListener('pointerdown',event=>{if(event.button!==0||control.disabled)return;event.preventDefault();audio.unlock();run();});
  control.addEventListener('click',event=>{if(event.detail===0&&!control.disabled){audio.unlock();run();}});
}
bindPlayerButton(launchButton,()=>launch(0));bindPlayerButton(launchTwoButton,()=>launch(1));
bindPlayerButton(bombButton,()=>useBomb(0));bindPlayerButton(bombTwoButton,()=>useBomb(1));
finishButton.addEventListener('click',()=>{audio.unlock();if(mode!=='versus'&&scene==='playing')engine.finish();});
pauseButton.addEventListener('click',()=>{audio.unlock();if(scene==='paused')play();else pause();});
$('home-btn').addEventListener('click',()=>{audio.unlock();audio.play('click');mainMenu();});
$('help-btn').addEventListener('click',()=>{audio.unlock();if(scene==='help')backFromHelp();else help();});
$('sound-btn').addEventListener('click',()=>{save.sound=!save.sound;audio.setEnabled(save.sound);audio.unlock();audio.setScene(scene==='playing'?'game':scene==='shop'?'shop':scene==='paused'||scene==='help'?'silent':'menu');persist();updateHud();});
fullscreenButton.addEventListener('click',async()=>{
  audio.unlock();
  try {
    if(document.fullscreenElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({navigationUI:'hide'});
  }catch{toast('当前浏览器未开启全屏，横屏或竖屏仍可正常游玩。');}
});

document.addEventListener('keydown',event=>{
  // Keep keyboard navigation inside the active dialog.
  if(event.key==='Tab'&&!overlay.classList.contains('hidden')){
    const focusable=Array.from(modal.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){last?.focus();event.preventDefault();}
    else if(!event.shiftKey&&document.activeElement===last){first?.focus();event.preventDefault();}
    return;
  }
  const key=event.key.toLowerCase();
  if((event.target as HTMLElement).tagName==='BUTTON'&&key===' ')return;
  if([' ','arrowdown','arrowup','escape','p','b',...(isDuo()?['s','w']:[])].includes(key))event.preventDefault();
  if(event.repeat)return;
  if(key==='escape'||key==='p'){audio.unlock();if(scene==='playing')pause();else if(scene==='paused')play();else if(scene==='help')backFromHelp();return;}
  if(scene!=='playing')return;
  audio.unlock();
  if(isDuo()) {if(key==='s')launch(0);else if(key==='w')useBomb(0);else if(key==='arrowdown')launch(1);else if(key==='arrowup')useBomb(1);}
  else {if(key===' '||key==='arrowdown')launch();else if(key==='arrowup'||key==='b')useBomb();}
});
function background() {pause(true);audio.setScene('silent');}
function foreground() {
  if(document.hidden)return;
  audio.setScene(scene==='playing'?'game':scene==='shop'?'shop':scene==='paused'||scene==='help'?'silent':'menu');
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)background();else foreground();});
window.addEventListener('blur',background);
window.addEventListener('focus',foreground);
window.addEventListener('pagehide',()=>{persist();audio.setScene('silent');});
new ResizeObserver(scheduleViewport).observe(stage);
window.addEventListener('resize',scheduleViewport);
window.visualViewport?.addEventListener('resize',scheduleViewport);
document.addEventListener('fullscreenchange',()=>{scheduleViewport();updateHud();});

function frame(now:number) {
  const dt=Math.min(.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
  const frozen=scene==='paused'||scene==='help';
  if(!frozen)elapsed+=dt;
  if(scene==='playing'){
    accumulator+=dt;
    while(accumulator>=1/120&&!engine.ended){engine.update(1/120);accumulator-=1/120;}
    for(const event of engine.drainEvents()){
      renderer.event(event);
      if(event.type!=='end')audio.play(event.type);
    }
    if(mode!=='versus'&&!reachedGoal&&engine.income>=engine.level.target){reachedGoal=true;toast(isDuo()?'共同目标达成！两把抓钩回到起点后可以收工。':'目标达成！可以继续挖金，或等抓钩回来后收工。');}
    const second=Math.ceil(engine.timeLeft);
    if(second!==lastTick&&second<=10&&second>0)audio.play('tick');lastTick=second;
    if(engine.ended){settled();audio.play(mode==='versus'||engine.won?'win':'lose');}
  }
  renderer.render(engine,elapsed,dt,frozen);
  hudElapsed+=dt;if(hudElapsed>=.08){updateHud();hudElapsed=0;}requestAnimationFrame(frame);
}

mainMenu();syncViewport();requestAnimationFrame(frame);
