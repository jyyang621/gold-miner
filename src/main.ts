import { LEVELS } from './levels.ts';
import { MineEngine } from './engine.ts';
import { MineRenderer } from './renderer.ts';
import { GameAudio } from './audio.ts';
import { loadSave, saveGame, clearRun, type RunCheckpoint, type ShopSave } from './storage.ts';

type Scene = 'menu'|'ready'|'playing'|'paused'|'help'|'result'|'shop'|'complete'|'confirm';
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id)! as T;
const canvas=$<HTMLCanvasElement>('game-canvas');
const overlay=$('overlay'), modal=$('modal-content');
const pauseButton=$<HTMLButtonElement>('pause-btn'), bombButton=$<HTMLButtonElement>('bomb-btn'), finishButton=$<HTMLButtonElement>('finish-btn');
const format=(value:number)=>Math.round(value).toLocaleString('zh-CN');
const money=(value:number)=>`¥ ${format(value)}`;
let save=loadSave();
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

function persist() {
  if(!saveGame(save)&&!storageWarning){storageWarning=true;toast('浏览器未允许保存进度，本次仍可继续游玩。');}
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
  return `<div class="minimap-levels" aria-label="共20关，当前第${index+1}关">${LEVELS.map((_,i)=>`<span class="minimap-dot ${i<index?'completed':i===index?'current':''}">${i+1}</span>`).join('')}</div>`;
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
  requestAnimationFrame(()=>modal.querySelector<HTMLButtonElement>('.button-primary:not(:disabled), button:not(:disabled)')?.focus({preventScroll:true}));
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
  const resume=save.shop||save.checkpoint;
  checkpoint=resume?{...resume}:{levelIndex:0,wallet:0,bombs:0,strength:false,diamondBonus:false,totalEarned:0};
  engine=new MineEngine(LEVELS[checkpoint.levelIndex],checkpoint);renderer.setLevel(engine.level);
  show(`${heroArt}${title('GOLDEN VALLEY · EST. 2026','黄金矿工','瞄准那一点金光，把整座矿山的好运带回家。<br>20 关矿场冒险，等你满载而归。')}
    <div class="menu-feature-line"><span>✦ 经典抓钩</span><span>✦ 关间商店</span><span>✦ 本地存档</span></div>
    <div class="modal-actions">${resume?button('continue',`继续第 ${resume.levelIndex+1} 关 →`,true):button('new','开始挖金 →',true)}${resume?button('new','新的挑战'):button('help','怎么玩')}</div>
    <p class="modal-footer">最高到达 ${save.highestCleared} / 20 关 <span class="footer-divider">·</span> 最佳累计收入 ${money(save.bestEarned)}<br>空格或点击矿区下钩 · 拉回地面才算收入</p>`);
}

function startNew(force=false) {
  if(!force&&(save.checkpoint||save.shop)){
    scene='confirm';
    show(`${title('A NEW ADVENTURE','再出发一次','开始新的挑战会重置本轮关卡、钱包和道具。<br>你的最佳记录会继续保留。')}<div class="modal-actions">${button('force-new','从第 1 关开始',true)}${button('home','保留进度')}</div>`);return;
  }
  save=clearRun(save);
  checkpoint={levelIndex:0,wallet:0,bombs:0,strength:false,diamondBonus:false,totalEarned:0};
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
  engine=new MineEngine(LEVELS[checkpoint.levelIndex],checkpoint);
  renderer.setLevel(engine.level);scene='ready';audio.setScene('menu');
  reachedGoal=false;lastTick=60;accumulator=0;
  const level=engine.level;
  show(`<div class="level-badge">第 ${String(level.id).padStart(2,'0')} / 20 关</div>${title('EXPLORE THE MINE',level.name,level.subtitle)}
    ${stats([['本关目标',money(level.target)],['挖矿时间','60 秒'],['炸药库存',`${checkpoint.bombs} 枚`]])}
    <p class="ready-buffs">${badges(checkpoint)}</p>
    ${level.id===1?'<p class="intro-controls"><kbd>SPACE</kbd> / <kbd>↓</kbd> 下钩 <span>·</span> 拉回地面才计分</p>':mapDots(checkpoint.levelIndex)}
    <div class="modal-actions">${button('play','准备好了，下矿 →',true)}${button('home','返回主菜单')}</div>`);
}
function play() {
  if(scene!=='ready'&&scene!=='paused')return;
  const wasReady=scene==='ready';scene='playing';audio.setScene('game');hide();accumulator=0;lastFrame=performance.now();updateHud();
  if(wasReady)toast(checkpoint.levelIndex===0?'空格 / ↓ / 点击矿区下钩，拉回地面才算收入。':engine.level.subtitle);
}
function pause(automatic=false) {
  if(scene!=='playing')return;
  scene='paused';audio.setScene('silent');
  show(`${title('TAKE A BREATHER',automatic?'休息一下，时间已暂停':'矿工休息中','矿场、倒计时和道具效果都已暂停。<br>回来后，继续追逐你的下一块黄金。')}
    ${stats([['本关收入',money(engine.income)],['还剩时间',`${Math.ceil(engine.timeLeft)} 秒`],['本关目标',money(engine.level.target)]])}
    <div class="modal-actions">${button('resume','继续挖矿 →',true)}${button('help','查看玩法')}${button('home','返回主菜单')}</div><p class="modal-footer">返回主菜单后，可从本关开始时重新挑战。</p>`);
}
function help() {
  if(scene==='playing'){pause();beforeHelp='paused';}else beforeHelp=scene;
  scene='help';audio.setScene('silent');
  show(`${title('A MINER’S HANDBOOK','挖金小手册','时机、重量与一点点运气，就是你的挖矿秘诀。')}
    <ul class="help-list"><li><strong>空格 / ↓ / 点击矿区：</strong>在抓钩摆动时下钩，一次抓一个物品。</li><li><strong>↑ / B / 炸药按钮：</strong>炸掉正在回收的物品，节省时间；物品不计收入。</li><li><strong>Esc / P：</strong>暂停。切换窗口也会自动暂停，回来后手动继续。</li><li><strong>收入：</strong>小金块 ¥50，中金块 ¥200，大金块 ¥500，钻石 ¥600，钱袋 ¥100 / 300 / 600。</li><li><strong>拉回才入账：</strong>倒计时结束仍在路上的物品不计收入；达标后可继续挖或收工。</li><li><strong>商店与存档：</strong>钱包跨关保留，买道具不扣本关成绩；失败或刷新恢复进关时的状态。</li></ul>
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
  const win=engine.won;
  show(`<span class="result-symbol ${win?'success':'failure'}" aria-hidden="true">${win?'✦':'⌛'}</span>${title(win?'A GOOD DAY’S WORK':'ONE MORE TRY',win?'这一趟，满载而归':'就差一点，再试一次',win?`第 ${engine.level.id} 关完成！带上你的收获，去商店看看。`:`还差 <strong>${money(engine.level.target-engine.income)}</strong> 就能过关。<br>优先瞄准钻石和金块，别被沉重的石头拖住。`)}
    ${stats([['本关收入',money(engine.income)],['目标收入',money(engine.level.target)],[win?'钱包余额':'重试炸药',win?money(checkpoint.wallet+engine.income):`${checkpoint.bombs} 枚`]])}
    <div class="modal-actions">${win?button('shop','去矿工商店 →',true):button('retry','再试一次 →',true)}${button('home','返回主菜单')}</div>
    <p class="modal-footer">${win?'消费只扣钱包，不影响累计成绩。':'重试会恢复本关开始时的钱包、炸药与增益，矿物布局保持不变。'}</p>`);
}
function showComplete() {
  scene='complete';audio.setScene('menu');
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
  if(engine.level.id!==shop.levelIndex+1){engine=new MineEngine(LEVELS[shop.levelIndex],shop);renderer.setLevel(engine.level);}
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

function updateHud() {
  const shop=scene==='shop'?save.shop:null;
  const playing=scene==='playing';
  $('level-number').textContent=String(engine.level.id).padStart(2,'0');$('level-name').textContent=engine.level.name;
  $('income-value').textContent=money(engine.income);$('target-value').textContent=money(engine.level.target);
  $('wallet-value').textContent=money(shop?shop.wallet:checkpoint.wallet+engine.income);
  $('time-value').innerHTML=`${Math.ceil(engine.timeLeft)}<span class="time-unit">s</span>`;
  $('time-value').classList.toggle('danger',engine.timeLeft<=10&&!engine.ended);
  const progress=Math.min(100,engine.income/engine.level.target*100);
  $('goal-fill').style.width=`${progress}%`;
  const progressbar=document.querySelector('[role="progressbar"]')!;
  progressbar.setAttribute('aria-valuenow',String(Math.round(progress)));progressbar.setAttribute('aria-valuemin','0');progressbar.setAttribute('aria-valuemax','100');
  $('bag-count').textContent=String(shop?shop.bombs:engine.bombs);
  $('buff-label').textContent=[(shop?.strength??engine.strength)?'力量 +35%':'',(shop?.diamondBonus??engine.diamondBonus)?'钻石 +50%':''].filter(Boolean).join(' · ')||'暂无加成';
  bombButton.disabled=!playing||!engine.canBomb;finishButton.disabled=!playing||!engine.canFinish;
  finishButton.title=engine.income>=engine.level.target?'抓钩回到起点后可收工':'收入达标后可收工';
  pauseButton.disabled=scene!=='playing'&&scene!=='paused';
  pauseButton.innerHTML=scene==='paused'?'<span aria-hidden="true">▶</span><span>继续</span>':'<span aria-hidden="true">Ⅱ</span><span>暂停</span>';
  $('sound-btn').innerHTML=`<span aria-hidden="true">${save.sound?'♫':'♪'}</span><span>${save.sound?'声音开启':'声音关闭'}</span>`;
  $('sound-btn').setAttribute('aria-pressed',String(save.sound));
}
function launch() {if(scene==='playing')engine.launch();}
function useBomb() {if(scene==='playing'){if(!engine.bomb())toast(engine.bombs===0?'没有炸药了，过关后可在商店补给。':'抓到物品、正在回收时才能使用炸药。');}}
function action(name:string) {
  audio.unlock();if(!name.startsWith('buy-'))audio.play('click');
  switch(name){
    case'new':startNew();break;case'force-new':startNew(true);break;case'continue':continueRun();break;
    case'play':play();break;case'resume':play();break;case'home':mainMenu();break;case'help':help();break;
    case'help-back':backFromHelp();break;case'shop':openShop();break;case'retry':prepare(checkpoint);break;case'next':nextLevel();break;
    case'buy-bomb':buy('bomb');break;case'buy-strength':buy('strength');break;case'buy-diamond':buy('diamond');break;
  }
}

modal.addEventListener('click',event=>{const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');if(target&&!target.disabled)action(target.dataset.action!);});
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();audio.unlock();canvas.focus({preventScroll:true});launch();});
bombButton.addEventListener('click',()=>{audio.unlock();useBomb();});
finishButton.addEventListener('click',()=>{audio.unlock();if(scene==='playing')engine.finish();});
pauseButton.addEventListener('click',()=>{audio.unlock();if(scene==='paused')play();else pause();});
$('home-btn').addEventListener('click',()=>{audio.unlock();audio.play('click');mainMenu();});
$('help-btn').addEventListener('click',()=>{audio.unlock();if(scene==='help')backFromHelp();else help();});
$('sound-btn').addEventListener('click',()=>{save.sound=!save.sound;audio.setEnabled(save.sound);audio.unlock();audio.setScene(scene==='playing'?'game':scene==='shop'?'shop':scene==='paused'||scene==='help'?'silent':'menu');persist();updateHud();});

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
  if([' ','arrowdown','arrowup','escape','p','b'].includes(key))event.preventDefault();
  if(event.repeat)return;
  if(key==='escape'||key==='p'){audio.unlock();if(scene==='playing')pause();else if(scene==='paused')play();else if(scene==='help')backFromHelp();return;}
  if(scene!=='playing')return;
  audio.unlock();
  if(key===' '||key==='arrowdown')launch();else if(key==='arrowup'||key==='b')useBomb();
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
    if(!reachedGoal&&engine.income>=engine.level.target){reachedGoal=true;toast('目标达成！可以继续挖金，或等抓钩回来后收工。');}
    const second=Math.ceil(engine.timeLeft);
    if(second!==lastTick&&second<=10&&second>0)audio.play('tick');lastTick=second;
    if(engine.ended){settled();audio.play(engine.won?'win':'lose');}
  }
  renderer.render(engine,elapsed,dt,frozen);
  hudElapsed+=dt;if(hudElapsed>=.08){updateHud();hudElapsed=0;}requestAnimationFrame(frame);
}

mainMenu();requestAnimationFrame(frame);
