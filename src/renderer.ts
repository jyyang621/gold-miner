import { MineEngine, type MineEvent, type RuntimeOre } from './engine.ts';
import { LEVELS, type LevelDefinition } from './levels.ts';
import { WIDE_VIEWPORT, type MineViewport } from './viewport.ts';

interface Particle {x:number;y:number;vx:number;vy:number;life:number;max:number;color:string;size:number}
interface Floater {x:number;y:number;text:string;life:number;color:string}
interface MinerPalette {
  rope:string; hook:string; hookPin:string;
  overalls:string; overallsEdge:string; straps:string; sleeve:string;
  hat:string; hatBrim:string; hatEdge:string; lamp:string; badge:string;
}
const TAU = Math.PI * 2;
const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
const originalMiner:MinerPalette = {
  rope:'#ffe064',hook:'#ffe58b',hookPin:'#fffbe3',
  overalls:'#687d76',overallsEdge:'#3c4f49',straps:'#a9baa0',sleeve:'#6d806f',
  hat:'#c68c40',hatBrim:'#daaa55',hatEdge:'#76512b',lamp:'#ecda95',badge:'#76512b',
};
const duoMiners:MinerPalette[] = [
  {...originalMiner,rope:'#ffd34b',hook:'#ffe17a',hookPin:'#fff9d7',
    overalls:'#ae793a',overallsEdge:'#71502d',straps:'#ebca80',sleeve:'#b28649',
    hat:'#d49b3c',hatBrim:'#edbc5c',hatEdge:'#785022',badge:'#805422'},
  {...originalMiner,rope:'#55f4db',hook:'#7dffe7',hookPin:'#edfffb',
    overalls:'#408b83',overallsEdge:'#285b58',straps:'#a8d8c6',sleeve:'#4d978b',
    hat:'#4d9c91',hatBrim:'#83c5af',hatEdge:'#2d655f',lamp:'#d7efbf',badge:'#285d58'},
];

export class MineRenderer {
  private ctx: CanvasRenderingContext2D;
  private background: HTMLCanvasElement;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private level: LevelDefinition = LEVELS[0];
  private viewport: MineViewport = {...WIDE_VIEWPORT};
  private pixelScale = 1;
  private displayScale = 1;
  private shake = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.background = document.createElement('canvas');
    this.resize(this.viewport, 1);
  }

  /** Keep drawing in world coordinates while matching the display's pixel density. */
  resize(view: MineViewport, pixelScale: number) {
    const bounds = this.canvas.getBoundingClientRect();
    this.displayScale = bounds.width > 0 && bounds.height > 0 ? Math.min(bounds.width / view.width, bounds.height / view.height) : 1;
    const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
    const width = Math.max(1, Math.round(view.width * scale));
    const height = Math.max(1, Math.round(view.height * scale));
    if (this.canvas.width === width && this.canvas.height === height &&
        this.background.width === width && this.background.height === height &&
        this.viewport.width === view.width && this.viewport.height === view.height &&
        this.viewport.portrait === view.portrait &&
        this.pixelScale === scale) return;
    this.viewport = {...view};
    this.pixelScale = scale;
    this.canvas.width = width; this.canvas.height = height;
    this.background.width = width; this.background.height = height;
    this.rebuildBackground();
  }

  setLevel(level: LevelDefinition) {
    this.level = level; this.particles = []; this.floaters = []; this.shake = 0;
    this.rebuildBackground();
  }

  private rebuildBackground() {
    const ctx = this.background.getContext('2d')!;
    const {width, height, portrait} = this.viewport;
    const level = this.level;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.background.width, this.background.height);
    ctx.setTransform(this.background.width / width, 0, 0, this.background.height / height, 0, 0);
    const palettes = {
      ochre:['#c58b4d','#9e633a','#70482f','#e3b56c'],
      copper:['#b57c52','#91583f','#673d32','#e0a478'],
      emerald:['#a28e5c','#707052','#454f42','#c7bb80'],
      deep:['#8e7b61','#645a51','#3c3e3c','#b8a47e'],
    };
    const colors = palettes[level.palette];
    const sky = ctx.createLinearGradient(0,0,0,220);
    sky.addColorStop(0,'#f5ebcd'); sky.addColorStop(1,'#e8c793');
    ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#f8f0d8'; ctx.beginPath();ctx.arc(width*1060/1280,70,38,0,TAU);ctx.fill();
    this.hill(ctx, '#d2c89d', [[0,149],[100,66],[224,146],[350,88],[477,177],[621,135],[790,169],[891,97],[1035,165],[1163,97],[1280,137]]);
    this.hill(ctx, '#bebc8a', [[0,172],[130,135],[266,177],[425,135],[603,184],[765,146],[958,182],[1135,145],[1280,179]]);
    ctx.fillStyle='#8e9363';ctx.fillRect(0,190,width,25);
    for(let i=0;i<Math.round(90*width/1280);i++) {
      const x=(i*97)%width,y=192+(i*19)%12;
      ctx.strokeStyle=i%2?'#b7b782':'#787e50';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y+9);ctx.lineTo(x-3,y-6);ctx.moveTo(x,y+6);ctx.lineTo(x+5,y-3);ctx.stroke();
    }
    this.drawCabin(ctx,portrait?80:102,118);
    this.drawCart(ctx,portrait?width-96:1114,167);
    // A continuous cutaway with irregular strata and carved stone texture.
    const earth = ctx.createLinearGradient(0,212,0,height);
    earth.addColorStop(0,colors[0]);earth.addColorStop(.48,colors[1]);earth.addColorStop(1,colors[2]);
    ctx.fillStyle=earth;ctx.beginPath();ctx.moveTo(0,213);
    for(let x=0;x<=width;x+=16)ctx.lineTo(x,210+Math.sin(x*.031)*5+Math.cos(x*.079)*3);
    ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
    for(let j=0;j<Math.ceil((height-230)/70);j++) {
      const y=262+j*70;ctx.strokeStyle=j%2?'#291f1919':'#f9d58a17';ctx.lineWidth=4+(j%3)*3;
      ctx.beginPath();ctx.moveTo(0,y);
      for(let x=0;x<=width;x+=32)ctx.lineTo(x,y+Math.sin(x*.006+j)*15+Math.sin(x*.021+j)*4);
      ctx.stroke();
    }
    const undergroundHeight=Math.max(1,height-235);
    const textureArea=width*undergroundHeight/(1280*485);
    for(let i=0;i<Math.round(360*textureArea);i++) {
      const x=(i*173.71+29)%width,y=235+(i*97.37)%undergroundHeight;
      ctx.fillStyle=i%4?'#31211812':'#f9d58a24';ctx.beginPath();ctx.ellipse(x,y,1+i%4,1+i%2,(i%7)*.4,0,TAU);ctx.fill();
    }
    for(let i=0;i<Math.round(23*textureArea);i++) {
      const x=40+(i*113)%(width-80),y=260+(i*67)%Math.max(1,height-290);
      ctx.strokeStyle='#31211822';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-10,y-8);ctx.lineTo(x,y);ctx.lineTo(x+17,y-2);ctx.moveTo(x,y);ctx.lineTo(x+4,y+12);ctx.stroke();
    }
    // Framed mining sign and corner rock beds.
    ctx.save();ctx.translate(34,portrait?22:28);ctx.rotate(-.035);this.round(ctx,0,0,148,portrait?42:54,6,'#e9d8ac','#796345',2);
    ctx.font=`700 ${portrait?10:11}px ${font}`;ctx.letterSpacing=portrait?'1.5px':'2px';ctx.fillStyle='#9b7240';ctx.fillText('GOLDEN VALLEY',13,portrait?15:19);
    ctx.letterSpacing='0px';ctx.font=`700 ${portrait?16:18}px ${font}`;ctx.fillStyle='#55402b';ctx.fillText(`第 ${String(level.id).padStart(2,'0')} 号矿场`,13,portrait?34:42);ctx.restore();
    ctx.strokeStyle=colors[3];ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,217);for(let x=0;x<width;x+=20)ctx.lineTo(x,214+Math.sin(x*.031)*5);ctx.stroke();
    ctx.fillStyle='#efd39d66';ctx.font=`12px ${font}`;ctx.fillText('GOLDEN VALLEY MINING CO.',34,height-25);
    ctx.textAlign='right';ctx.fillText('每一次下钩，都有新的发现',width-34,height-25);ctx.textAlign='left';
  }

  private hill(ctx:CanvasRenderingContext2D,color:string,points:number[][]) {
    const width=this.viewport.width;
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,215);for(const [x,y]of points)ctx.lineTo(x*width/1280,y);ctx.lineTo(width,215);ctx.closePath();ctx.fill();
  }
  private round(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,fill:string,stroke?:string,line=1) {
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=line;ctx.stroke();}
  }
  private drawCabin(ctx:CanvasRenderingContext2D,x:number,y:number) {
    ctx.save();ctx.translate(x,y);ctx.rotate(-.025);
    this.round(ctx,-44,0,89,72,2,'#aa7445','#705033',3);
    for(let i=0;i<6;i++){ctx.strokeStyle='#7c553832';ctx.beginPath();ctx.moveTo(-42,12+i*10);ctx.lineTo(42,12+i*10);ctx.stroke();}
    ctx.fillStyle='#6b4e35';ctx.beginPath();ctx.moveTo(-58,4);ctx.lineTo(0,-31);ctx.lineTo(59,4);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#c5975d';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-58,4);ctx.lineTo(0,-31);ctx.lineTo(59,4);ctx.stroke();
    this.round(ctx,-10,26,26,46,2,'#503e2d');this.round(ctx,-32,23,16,18,2,'#dcc281','#695235',2);
    ctx.fillStyle='#f0dda3';ctx.font=`bold 10px ${font}`;ctx.textAlign='center';ctx.fillText('矿场',0,18);ctx.restore();
  }
  private drawCart(ctx:CanvasRenderingContext2D,x:number,y:number) {
    ctx.save();ctx.translate(x,y);
    ctx.strokeStyle='#625741';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-79,35);ctx.lineTo(82,35);ctx.moveTo(-58,41);ctx.lineTo(66,41);ctx.stroke();
    for(const cx of [-27,31]){ctx.fillStyle='#584f3c';ctx.beginPath();ctx.arc(cx,28,10,0,TAU);ctx.fill();ctx.fillStyle='#b39c6d';ctx.beginPath();ctx.arc(cx,28,4,0,TAU);ctx.fill();}
    ctx.fillStyle='#d6a84c';ctx.beginPath();ctx.moveTo(-36,-4);ctx.lineTo(-22,-18);ctx.lineTo(0,-10);ctx.lineTo(15,-24);ctx.lineTo(40,-5);ctx.closePath();ctx.fill();
    ctx.fillStyle='#81613f';ctx.strokeStyle='#523d2b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-48,-8);ctx.lineTo(47,-8);ctx.lineTo(37,24);ctx.lineTo(-35,24);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle='#ae8c57';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-30,4);ctx.lineTo(32,4);ctx.moveTo(-28,13);ctx.lineTo(29,13);ctx.stroke();ctx.restore();
  }

  event(event:MineEvent) {
    if(event.type==='coin') {
      this.floaters.push({x:event.x,y:event.y-66,text:`+ ¥${event.value}`,life:1.35,color:event.player===1?'#d6fff1':'#fff4c2'});
      this.burst(event.x,event.y-9,14,event.player===1?['#8edac3','#e4fff1','#398c7d']:['#f6cc4c','#fff2b5','#cf8e25']);
    } else if(event.type==='bomb') {this.shake=.35;this.burst(event.x,event.y,40,['#f6bb52','#fee4a3','#42332b','#a85e32']);}
    else if(event.type==='grab'||event.type==='rock')this.burst(event.x,event.y,6,['#ebcf96','#fff0c1']);
    else if(event.type==='end'&&event.won)for(let i=0;i<5;i++)this.burst(event.x+(i-2)*this.viewport.width*225/1280,110,18,['#eac056','#f9edc3','#9eac72']);
  }
  private burst(x:number,y:number,n:number,colors:string[]) {
    for(let i=0;i<n;i++)this.particles.push({x,y,vx:(Math.random()-.5)*280,vy:-50-Math.random()*180,life:.6+Math.random()*.6,max:1.2,color:colors[i%colors.length],size:2+Math.random()*5});
  }

  render(engine:MineEngine,time:number,dt:number,paused=false) {
    const ctx=this.ctx;
    const {width,height,portrait}=this.viewport;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    ctx.setTransform(this.canvas.width/width,0,0,this.canvas.height/height,0,0);ctx.save();
    this.shake=Math.max(0,this.shake-dt);
    if(this.shake>0&&!paused)ctx.translate(Math.sin(time*100)*this.shake*10,Math.cos(time*89)*this.shake*8);
    ctx.drawImage(this.background,0,0,width,height);
    for(let i=0;i<Math.round(15*width*(height-255)/(1280*465));i++) {
      const x=35+(i*157)%(width-70)+Math.sin(time*.3+i)*8,y=255+(i*93)%Math.max(1,height-310)+Math.cos(time*.2+i)*10;
      ctx.fillStyle='#fff2bb18';ctx.beginPath();ctx.arc(x,y,1.5,0,TAU);ctx.fill();
    }
    for(const ore of engine.ores)if(!ore.removed&&!ore.held)this.drawOre(ctx,ore,ore.x,ore.y,time);
    const duo=engine.players.length===2;
    // Shared ground objects are drawn once; each cable carries only its own ore.
    for(const player of engine.players) {
      const {pivotX,pivotY}=engine.playerGeometry(player.id);
      const {x,y}=engine.playerHead(player.id);
      const palette=duo?duoMiners[player.id]:originalMiner;
      this.drawCable(ctx,pivotX,pivotY,x,y,palette,duo&&player.id===1);
      if(player.held)this.drawOre(ctx,player.held,x,y+player.held.radius*.65,time);
    }
    for(const player of engine.players) {
      const {pivotX,pivotY}=engine.playerGeometry(player.id);
      const palette=duo?duoMiners[player.id]:originalMiner;
      this.drawMiner(ctx,time,player.phase!=='swing'&&!engine.ended,pivotX,pivotY,palette);
      if(duo)this.drawPlayerBadge(ctx,pivotX,pivotY,player.id,palette);
    }
    // Hooks stay in front of the timber platform, including when idle near the winch.
    for(const player of engine.players) {
      const {x,y}=engine.playerHead(player.id);
      const palette=duo?duoMiners[player.id]:originalMiner;
      this.drawHook(ctx,x,y,player.angle,player.phase==='loaded',palette);
    }
    if(duo)for(const player of engine.players)if(player.phase!=='swing') {
      const {x,y}=engine.playerHead(player.id);
      this.drawHookLabel(ctx,x,y,player.id,duoMiners[player.id]);
    }
    for(const p of this.particles){if(!paused){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=250*dt;}ctx.globalAlpha=Math.max(0,Math.min(1,p.life*2));ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}
    ctx.globalAlpha=1;this.particles=this.particles.filter(p=>p.life>0);
    for(const f of this.floaters){if(!paused){f.life-=dt;f.y-=28*dt;}ctx.globalAlpha=Math.min(1,f.life*2);ctx.textAlign='center';ctx.font=`900 26px ${font}`;ctx.lineWidth=4;ctx.strokeStyle='#634023';ctx.strokeText(f.text,f.x,f.y);ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);}
    ctx.globalAlpha=1;ctx.textAlign='left';this.floaters=this.floaters.filter(f=>f.life>0);
    if(!portrait&&(engine.strength||engine.diamondBonus)){
      const text=[engine.strength?'力量 +35%':'',engine.diamondBonus?'钻石 +50%':''].filter(Boolean).join('  ·  ');
      this.round(ctx,920,30,325,34,17,'#f5eacbcc','#ab8e5b',1);ctx.fillStyle='#705735';ctx.font=`600 13px ${font}`;ctx.textAlign='center';ctx.fillText(text,1082,52);ctx.textAlign='left';
    }
    ctx.restore();
  }

  private drawOre(ctx:CanvasRenderingContext2D,ore:RuntimeOre,x:number,y:number,t:number) {
    const r=ore.radius;
    ctx.save();ctx.translate(x,y);
    ctx.fillStyle='#33231533';ctx.beginPath();ctx.ellipse(2,r*.8,r*.9,r*.3,0,0,TAU);ctx.fill();
    if(ore.kind==='diamond') {
      ctx.shadowColor='#afe9d39c';ctx.shadowBlur=14;
      const pts=[[-r,-r*.3],[-r*.52,-r*.86],[r*.52,-r*.86],[r,-r*.3],[0,r]];
      ctx.fillStyle='#8cdec3';ctx.strokeStyle='#285953';ctx.lineWidth=2.5;ctx.beginPath();pts.forEach(([a,b],i)=>i?ctx.lineTo(a,b):ctx.moveTo(a,b));ctx.closePath();ctx.fill();ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle='#d0f5dc';ctx.beginPath();ctx.moveTo(-r,-r*.3);ctx.lineTo(-r*.32,-r*.3);ctx.lineTo(0,r);ctx.closePath();ctx.fill();
      ctx.fillStyle='#4ba68e';ctx.beginPath();ctx.moveTo(r,-r*.3);ctx.lineTo(r*.3,-r*.3);ctx.lineTo(0,r);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#f1fff0';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-r,-r*.3);ctx.lineTo(r,-r*.3);ctx.moveTo(-r*.32,-r*.3);ctx.lineTo(0,-r*.86);ctx.lineTo(r*.3,-r*.3);ctx.stroke();
      if(Math.sin(t*2+x)>.5){ctx.globalAlpha=(Math.sin(t*2+x)-.5)*2;this.star(ctx,r+5,-r-4,6,'#e7ffe5');ctx.globalAlpha=1;}
    } else if(ore.kind==='bag') {
      ctx.fillStyle='#bb8f53';ctx.strokeStyle='#5c3d27';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-r*.35,-r*.6);ctx.bezierCurveTo(-r*1.3,0,-r,r,0,r);ctx.bezierCurveTo(r,r,r*1.3,0,r*.35,-r*.6);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#d6ac6b';ctx.beginPath();ctx.moveTo(-r*.3,-r*.6);ctx.lineTo(-r*.5,-r);ctx.lineTo(0,-r*.87);ctx.lineTo(r*.4,-r);ctx.lineTo(r*.25,-r*.6);ctx.fill();
      ctx.strokeStyle='#69472c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-r*.5,-r*.55);ctx.lineTo(r*.45,-r*.55);ctx.stroke();ctx.font=`bold ${r}px ${font}`;ctx.fillStyle='#f5ddb1';ctx.textAlign='center';ctx.fillText('?',0,r*.52);ctx.textAlign='left';
    } else {
      const gold=ore.kind.startsWith('gold');
      const gradient=ctx.createLinearGradient(-r,-r,r,r);
      gradient.addColorStop(0,gold?'#ffe08a':'#b5aea0');gradient.addColorStop(.38,gold?'#eebe4e':'#96958b');gradient.addColorStop(1,gold?'#bd7c26':'#686c67');
      const pts=[[-.93,-.24],[-.52,-.88],[.21,-.96],[.85,-.55],[1,.2],[.45,.89],[-.42,.93],[-.99,.36]];
      ctx.fillStyle=gradient;ctx.strokeStyle=gold?'#805021':'#454b46';ctx.lineWidth=2.5;
      ctx.beginPath();pts.forEach(([a,b],i)=>i?ctx.lineTo(a*r,b*r):ctx.moveTo(a*r,b*r));ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle=gold?'#fff3b559':'#d7d3b939';ctx.beginPath();ctx.moveTo(-r*.78,-r*.2);ctx.lineTo(-r*.43,-r*.68);ctx.lineTo(r*.16,-r*.75);ctx.lineTo(r*.48,-r*.35);ctx.lineTo(-r*.24,-r*.25);ctx.closePath();ctx.fill();
      ctx.strokeStyle=gold?'#ffd46e':'#636b6366';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-r*.72,r*.31);ctx.lineTo(-r*.3,r*.61);ctx.lineTo(r*.25,r*.59);ctx.stroke();
      if(gold){this.star(ctx,-r*.33,-r*.35,Math.max(3,r*.12),'#fff5bb');if(r>25){ctx.fillStyle='#b97a29';ctx.beginPath();ctx.ellipse(r*.45,r*.25,3,2,-.4,0,TAU);ctx.fill();}}
      else{ctx.strokeStyle='#575f55';ctx.beginPath();ctx.moveTo(-r*.1,-r*.24);ctx.lineTo(r*.22,r*.06);ctx.lineTo(r*.11,r*.45);ctx.moveTo(r*.22,r*.06);ctx.lineTo(r*.58,-r*.08);ctx.stroke();}
    }
    ctx.restore();
  }
  private star(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,color:string) {
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r*.22,y-r*.22);ctx.lineTo(x+r,y);ctx.lineTo(x+r*.22,y+r*.22);ctx.lineTo(x,y+r);ctx.lineTo(x-r*.22,y+r*.22);ctx.lineTo(x-r,y);ctx.lineTo(x-r*.22,y-r*.22);ctx.closePath();ctx.fill();
  }
  private drawCable(ctx:CanvasRenderingContext2D,px:number,py:number,x:number,y:number,palette:MinerPalette,striped:boolean) {
    const unit=1/this.displayScale;
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);
    ctx.strokeStyle='#fff8e9e6';ctx.lineWidth=Math.max(8,6*unit);ctx.stroke();
    ctx.strokeStyle='#203135';ctx.lineWidth=Math.max(6,4.5*unit);ctx.stroke();
    ctx.strokeStyle=palette.rope;ctx.lineWidth=Math.max(3.5,2.5*unit);ctx.stroke();
    if(striped) {
      ctx.setLineDash([4*unit,8*unit]);ctx.strokeStyle='#f3fffb';ctx.lineWidth=unit;ctx.stroke();
    }
    ctx.restore();
  }
  private drawHook(ctx:CanvasRenderingContext2D,x:number,y:number,angle:number,closed:boolean,palette:MinerPalette) {
    // Size follows CSS pixels, independently of DPR and the mine's world size.
    const size=Math.max(1.15,.8/this.displayScale);
    ctx.save();ctx.translate(x,y);ctx.rotate(-angle);ctx.scale(size,size);
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(0,3);
    ctx.moveTo(0,0);ctx.lineTo(closed?-10:-15,8);ctx.lineTo(closed?-7:-12,19);
    ctx.moveTo(0,0);ctx.lineTo(closed?10:15,8);ctx.lineTo(closed?7:12,19);
    ctx.strokeStyle='#fffbea';ctx.lineWidth=11;ctx.stroke();
    ctx.strokeStyle='#203135';ctx.lineWidth=8;ctx.stroke();
    ctx.strokeStyle=palette.hook;ctx.lineWidth=4.5;ctx.stroke();
    ctx.fillStyle=palette.hookPin;ctx.strokeStyle='#203135';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,5,0,TAU);ctx.fill();ctx.stroke();
    ctx.fillStyle=palette.rope;ctx.beginPath();ctx.arc(0,0,2,0,TAU);ctx.fill();
    ctx.restore();
  }
  private drawHookLabel(ctx:CanvasRenderingContext2D,x:number,y:number,id:number,palette:MinerPalette) {
    const unit=1/this.displayScale,w=28*unit,h=17*unit,gap=13*unit;
    const margin=2*unit;
    let left=id===0?x-gap-w:x+gap;
    if(left<margin||left+w>this.viewport.width-margin)left=id===0?x+gap:x-gap-w;
    left=Math.max(margin,Math.min(this.viewport.width-w-margin,left));
    const top=Math.max(2*unit,Math.min(this.viewport.height-h-2*unit,y-h-8*unit));
    ctx.save();
    ctx.beginPath();ctx.moveTo(x,y-3*unit);ctx.lineTo(left+(left<x?w:0),top+h);
    ctx.strokeStyle='#203135';ctx.lineWidth=3*unit;ctx.stroke();
    ctx.strokeStyle=palette.rope;ctx.lineWidth=1.5*unit;ctx.stroke();
    this.round(ctx,left,top,w,h,5*unit,palette.badge,'#fffbea',1.5*unit);
    ctx.fillStyle='#ffffff';ctx.font=`900 ${11*unit}px ${font}`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(`P${id+1}`,left+w/2,top+h/2+.5*unit);
    ctx.restore();
  }
  private drawPlayerBadge(ctx:CanvasRenderingContext2D,pivotX:number,pivotY:number,id:number,palette:MinerPalette) {
    ctx.save();
    const x=pivotX+30,y=pivotY-79;
    const width=this.viewport.portrait?64:46,height=this.viewport.portrait?36:27;
    this.round(ctx,x,y,width,height,height/2,palette.badge,'#f9edd1',2);
    ctx.fillStyle='#fff7df';ctx.font=`800 ${this.viewport.portrait?24:15}px ${font}`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(`P${id+1}`,x+width/2,y+height/2+1);
    ctx.restore();
  }
  private drawMiner(ctx:CanvasRenderingContext2D,t:number,working:boolean,pivotX:number,pivotY:number,palette:MinerPalette) {
    ctx.save();ctx.translate(pivotX-20,pivotY-12);
    const bob=working?Math.sin(t*12)*1.5:Math.sin(t*2)*.7;
    // Timber stand and crank.
    this.round(ctx,-72,39,145,13,3,'#a57341','#65492e',3);
    this.round(ctx,-63,49,13,22,2,'#92633a','#65492e',2);this.round(ctx,48,49,13,22,2,'#92633a','#65492e',2);
    this.round(ctx,4,-2,13,39,3,'#6d5740','#443c2c',2);this.round(ctx,36,-2,13,39,3,'#6d5740','#443c2c',2);
    ctx.save();ctx.translate(20,12);ctx.rotate(working?t*5:0);
    ctx.fillStyle='#ad8c55';ctx.strokeStyle='#524530';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,21,0,TAU);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#e0c28a';ctx.lineWidth=3;for(let i=0;i<6;i++){ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(i*TAU/6)*16,Math.sin(i*TAU/6)*16);ctx.stroke();}ctx.restore();
    ctx.translate(-28,bob);
    // Boots, overalls, shoulders.
    this.round(ctx,-21,22,19,13,5,'#493c2c');this.round(ctx,5,22,20,13,5,'#493c2c');
    this.round(ctx,-23,-12,47,39,10,palette.overalls,palette.overallsEdge,2.5);
    this.round(ctx,-13,-14,6,26,2,palette.straps);this.round(ctx,10,-14,6,26,2,palette.straps);
    ctx.fillStyle='#e7ca82';ctx.beginPath();ctx.arc(-10,0,2,0,TAU);ctx.arc(13,0,2,0,TAU);ctx.fill();
    ctx.strokeStyle=palette.sleeve;ctx.lineWidth=14;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(22,-5);ctx.lineTo(37,8+(working?Math.sin(t*8)*3:0));ctx.stroke();ctx.fillStyle='#dfaf74';ctx.beginPath();ctx.arc(38,8+(working?Math.sin(t*8)*3:0),7,0,TAU);ctx.fill();
    // Face, big beard and hat.
    ctx.fillStyle='#e2b77e';ctx.strokeStyle='#705337';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,-31,25,27,0,0,TAU);ctx.fill();ctx.stroke();
    ctx.fillStyle='#f0e4c5';ctx.beginPath();ctx.moveTo(-24,-27);ctx.quadraticCurveTo(-22,6,0,9);ctx.quadraticCurveTo(26,-1,25,-27);ctx.quadraticCurveTo(0,-8,-24,-27);ctx.fill();
    ctx.fillStyle='#c78d57';ctx.beginPath();ctx.ellipse(1,-24,9,7,0,0,TAU);ctx.fill();
    ctx.fillStyle='#3a392c';ctx.beginPath();ctx.arc(-9,-37,2.5,0,TAU);ctx.arc(11,-37,2.5,0,TAU);ctx.fill();
    ctx.strokeStyle='#f5ecd0';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-15,-43);ctx.lineTo(-5,-44);ctx.moveTo(7,-44);ctx.lineTo(17,-42);ctx.stroke();
    this.round(ctx,-24,-65,48,23,10,palette.hat,palette.hatEdge,2.5);this.round(ctx,-34,-49,69,10,4,palette.hatBrim,palette.hatEdge,2.5);
    this.round(ctx,-8,-63,17,13,5,palette.lamp,'#866836',2);ctx.fillStyle='#fff4bd';ctx.beginPath();ctx.arc(0,-57,4,0,TAU);ctx.fill();
    ctx.restore();
  }
}
