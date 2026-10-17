import { MineEngine, PHYSICS, type MineEvent, type RuntimeOre } from './engine.ts';
import { LEVELS, type LevelDefinition } from './levels.ts';

interface Particle {x:number;y:number;vx:number;vy:number;life:number;max:number;color:string;size:number}
interface Floater {x:number;y:number;text:string;life:number;color:string}
const TAU = Math.PI * 2;
const font = '"Microsoft YaHei", "PingFang SC", sans-serif';

export class MineRenderer {
  private ctx: CanvasRenderingContext2D;
  private background: HTMLCanvasElement;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private level: LevelDefinition = LEVELS[0];
  private shake = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.background = document.createElement('canvas');
    this.background.width = 1280; this.background.height = 720;
    this.setLevel(this.level);
  }

  setLevel(level: LevelDefinition) {
    this.level = level; this.particles = []; this.floaters = []; this.shake = 0;
    const ctx = this.background.getContext('2d')!;
    const palettes = {
      ochre:['#c58b4d','#9e633a','#70482f','#e3b56c'],
      copper:['#b57c52','#91583f','#673d32','#e0a478'],
      emerald:['#a28e5c','#707052','#454f42','#c7bb80'],
      deep:['#8e7b61','#645a51','#3c3e3c','#b8a47e'],
    };
    const colors = palettes[level.palette];
    const sky = ctx.createLinearGradient(0,0,0,220);
    sky.addColorStop(0,'#f5ebcd'); sky.addColorStop(1,'#e8c793');
    ctx.fillStyle=sky;ctx.fillRect(0,0,1280,720);
    ctx.fillStyle='#f8f0d8'; ctx.beginPath();ctx.arc(1060,70,38,0,TAU);ctx.fill();
    this.hill(ctx, '#d2c89d', [[0,149],[100,66],[224,146],[350,88],[477,177],[621,135],[790,169],[891,97],[1035,165],[1163,97],[1280,137]]);
    this.hill(ctx, '#bebc8a', [[0,172],[130,135],[266,177],[425,135],[603,184],[765,146],[958,182],[1135,145],[1280,179]]);
    ctx.fillStyle='#8e9363';ctx.fillRect(0,190,1280,25);
    for(let i=0;i<90;i++) {
      const x=(i*97)%1280,y=192+(i*19)%12;
      ctx.strokeStyle=i%2?'#b7b782':'#787e50';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y+9);ctx.lineTo(x-3,y-6);ctx.moveTo(x,y+6);ctx.lineTo(x+5,y-3);ctx.stroke();
    }
    this.drawCabin(ctx,102,118);
    this.drawCart(ctx,1114,167);
    // A continuous cutaway with irregular strata and carved stone texture.
    const earth = ctx.createLinearGradient(0,212,0,720);
    earth.addColorStop(0,colors[0]);earth.addColorStop(.48,colors[1]);earth.addColorStop(1,colors[2]);
    ctx.fillStyle=earth;ctx.beginPath();ctx.moveTo(0,213);
    for(let x=0;x<=1280;x+=16)ctx.lineTo(x,210+Math.sin(x*.031)*5+Math.cos(x*.079)*3);
    ctx.lineTo(1280,720);ctx.lineTo(0,720);ctx.closePath();ctx.fill();
    for(let j=0;j<7;j++) {
      const y=262+j*70;ctx.strokeStyle=j%2?'#291f1919':'#f9d58a17';ctx.lineWidth=4+(j%3)*3;
      ctx.beginPath();ctx.moveTo(0,y);
      for(let x=0;x<=1280;x+=32)ctx.lineTo(x,y+Math.sin(x*.006+j)*15+Math.sin(x*.021+j)*4);
      ctx.stroke();
    }
    for(let i=0;i<360;i++) {
      const x=(i*173.71+29)%1280,y=235+(i*97.37)%485;
      ctx.fillStyle=i%4?'#31211812':'#f9d58a24';ctx.beginPath();ctx.ellipse(x,y,1+i%4,1+i%2,(i%7)*.4,0,TAU);ctx.fill();
    }
    for(let i=0;i<23;i++) {
      const x=40+(i*113)%1200,y=260+(i*67)%430;
      ctx.strokeStyle='#31211822';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-10,y-8);ctx.lineTo(x,y);ctx.lineTo(x+17,y-2);ctx.moveTo(x,y);ctx.lineTo(x+4,y+12);ctx.stroke();
    }
    // Framed mining sign and corner rock beds.
    ctx.save();ctx.translate(34,28);ctx.rotate(-.035);this.round(ctx,0,0,148,54,6,'#e9d8ac','#796345',2);
    ctx.font=`700 11px ${font}`;ctx.letterSpacing='2px';ctx.fillStyle='#9b7240';ctx.fillText('GOLDEN VALLEY',13,19);
    ctx.letterSpacing='0px';ctx.font=`700 18px ${font}`;ctx.fillStyle='#55402b';ctx.fillText(`第 ${String(level.id).padStart(2,'0')} 号矿场`,13,42);ctx.restore();
    ctx.strokeStyle=colors[3];ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,217);for(let x=0;x<1280;x+=20)ctx.lineTo(x,214+Math.sin(x*.031)*5);ctx.stroke();
    ctx.fillStyle='#efd39d66';ctx.font=`12px ${font}`;ctx.fillText('GOLDEN VALLEY MINING CO.',34,695);
    ctx.textAlign='right';ctx.fillText('每一次下钩，都有新的发现',1246,695);ctx.textAlign='left';
  }

  private hill(ctx:CanvasRenderingContext2D,color:string,points:number[][]) {
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,215);for(const [x,y]of points)ctx.lineTo(x,y);ctx.lineTo(1280,215);ctx.closePath();ctx.fill();
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
      this.floaters.push({x:640,y:120,text:`+ ¥${event.value}`,life:1.35,color:'#fff4c2'});
      this.burst(640,177,14,['#f6cc4c','#fff2b5','#cf8e25']);
    } else if(event.type==='bomb') {this.shake=.35;this.burst(event.x,event.y,40,['#f6bb52','#fee4a3','#42332b','#a85e32']);}
    else if(event.type==='grab'||event.type==='rock')this.burst(event.x,event.y,6,['#ebcf96','#fff0c1']);
    else if(event.type==='end'&&event.won)for(let i=0;i<5;i++)this.burst(190+i*225,110,18,['#eac056','#f9edc3','#9eac72']);
  }
  private burst(x:number,y:number,n:number,colors:string[]) {
    for(let i=0;i<n;i++)this.particles.push({x,y,vx:(Math.random()-.5)*280,vy:-50-Math.random()*180,life:.6+Math.random()*.6,max:1.2,color:colors[i%colors.length],size:2+Math.random()*5});
  }

  render(engine:MineEngine,time:number,dt:number,paused=false) {
    const ctx=this.ctx;
    ctx.clearRect(0,0,1280,720);ctx.save();
    this.shake=Math.max(0,this.shake-dt);
    if(this.shake>0&&!paused)ctx.translate(Math.sin(time*100)*this.shake*10,Math.cos(time*89)*this.shake*8);
    ctx.drawImage(this.background,0,0);
    for(let i=0;i<15;i++) {
      const x=35+(i*157)%1210+Math.sin(time*.3+i)*8,y=255+(i*93)%410+Math.cos(time*.2+i)*10;
      ctx.fillStyle='#fff2bb18';ctx.beginPath();ctx.arc(x,y,1.5,0,TAU);ctx.fill();
    }
    for(const ore of engine.ores)if(!ore.removed&&!ore.held)this.drawOre(ctx,ore,ore.x,ore.y,time);
    const {x,y}=engine.head;
    ctx.strokeStyle='#3c3027';ctx.lineWidth=5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(PHYSICS.pivotX,PHYSICS.pivotY);ctx.lineTo(x,y);ctx.stroke();
    ctx.strokeStyle='#d9bd80';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(PHYSICS.pivotX+1,PHYSICS.pivotY);ctx.lineTo(x+1,y);ctx.stroke();
    if(engine.held)this.drawOre(ctx,engine.held,x,y+engine.held.radius*.65,time);
    this.drawHook(ctx,x,y,engine.angle,engine.phase==='loaded');
    this.drawMiner(ctx,time,engine.phase!=='swing'&&!engine.ended);
    for(const p of this.particles){if(!paused){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=250*dt;}ctx.globalAlpha=Math.max(0,Math.min(1,p.life*2));ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}
    ctx.globalAlpha=1;this.particles=this.particles.filter(p=>p.life>0);
    for(const f of this.floaters){if(!paused){f.life-=dt;f.y-=28*dt;}ctx.globalAlpha=Math.min(1,f.life*2);ctx.textAlign='center';ctx.font=`900 26px ${font}`;ctx.lineWidth=4;ctx.strokeStyle='#634023';ctx.strokeText(f.text,f.x,f.y);ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);}
    ctx.globalAlpha=1;ctx.textAlign='left';this.floaters=this.floaters.filter(f=>f.life>0);
    if(engine.strength||engine.diamondBonus){
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
  private drawHook(ctx:CanvasRenderingContext2D,x:number,y:number,angle:number,closed:boolean) {
    ctx.save();ctx.translate(x,y);ctx.rotate(-angle);ctx.strokeStyle='#443a2b';ctx.lineWidth=7;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(0,3);ctx.moveTo(0,0);ctx.lineTo(closed?-10:-15,8);ctx.lineTo(closed?-7:-12,19);ctx.moveTo(0,0);ctx.lineTo(closed?10:15,8);ctx.lineTo(closed?7:12,19);ctx.stroke();
    ctx.strokeStyle='#d0c7a8';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#e3d6ad';ctx.beginPath();ctx.arc(0,0,4,0,TAU);ctx.fill();ctx.restore();
  }
  private drawMiner(ctx:CanvasRenderingContext2D,t:number,working:boolean) {
    ctx.save();ctx.translate(620,136);
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
    this.round(ctx,-23,-12,47,39,10,'#687d76','#3c4f49',2.5);
    this.round(ctx,-13,-14,6,26,2,'#a9baa0');this.round(ctx,10,-14,6,26,2,'#a9baa0');
    ctx.fillStyle='#e7ca82';ctx.beginPath();ctx.arc(-10,0,2,0,TAU);ctx.arc(13,0,2,0,TAU);ctx.fill();
    ctx.strokeStyle='#6d806f';ctx.lineWidth=14;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(22,-5);ctx.lineTo(37,8+(working?Math.sin(t*8)*3:0));ctx.stroke();ctx.fillStyle='#dfaf74';ctx.beginPath();ctx.arc(38,8+(working?Math.sin(t*8)*3:0),7,0,TAU);ctx.fill();
    // Face, big beard and hat.
    ctx.fillStyle='#e2b77e';ctx.strokeStyle='#705337';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,-31,25,27,0,0,TAU);ctx.fill();ctx.stroke();
    ctx.fillStyle='#f0e4c5';ctx.beginPath();ctx.moveTo(-24,-27);ctx.quadraticCurveTo(-22,6,0,9);ctx.quadraticCurveTo(26,-1,25,-27);ctx.quadraticCurveTo(0,-8,-24,-27);ctx.fill();
    ctx.fillStyle='#c78d57';ctx.beginPath();ctx.ellipse(1,-24,9,7,0,0,TAU);ctx.fill();
    ctx.fillStyle='#3a392c';ctx.beginPath();ctx.arc(-9,-37,2.5,0,TAU);ctx.arc(11,-37,2.5,0,TAU);ctx.fill();
    ctx.strokeStyle='#f5ecd0';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-15,-43);ctx.lineTo(-5,-44);ctx.moveTo(7,-44);ctx.lineTo(17,-42);ctx.stroke();
    this.round(ctx,-24,-65,48,23,10,'#c68c40','#76512b',2.5);this.round(ctx,-34,-49,69,10,4,'#daaa55','#76512b',2.5);
    this.round(ctx,-8,-63,17,13,5,'#ecda95','#866836',2);ctx.fillStyle='#fff4bd';ctx.beginPath();ctx.arc(0,-57,4,0,TAU);ctx.fill();
    ctx.restore();
  }
}
