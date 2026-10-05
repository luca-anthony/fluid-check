#!/usr/bin/env node
/* Web fluid formula search: headless engine.
 * Runs the same model as index.html, and writes data/formulas.json, data/log.json, data/skeletons.json.
 * Usage: node search.js [--patience 30000] [--target 200] [--max-minutes 10] [--out data] [--fresh]
 * Re-running resumes from the files already in the output folder unless --fresh is passed.
 * Scores are estimates from a simplified model, not lab measurements. */
const fs=require("fs"),path=require("path");
const arg=(n,d)=>{const i=process.argv.indexOf("--"+n);return i<0?d:(process.argv[i+1]===undefined||process.argv[i+1].startsWith("--")?true:process.argv[i+1])};
const PATIENCE=+arg("patience",30000),MAXMIN=+arg("max-minutes",10),OUT=arg("out","data"),FRESH=arg("fresh",false);
// ---------- Component library (properties are approximate estimates) ----------
// evap = relative evaporation rate (n-butyl acetate = 1); visc in cP; haz 0-1 penalty
const S={
acetone:{n:"Acetone",f:"C3H6O",ev:14.4,v:.31,haz:.15,sk:"C:-.87:.5,C:0:0,C:.87:.5,O:0:-1|0-1,1-2,1=3"},
mek:{n:"Methyl ethyl ketone",f:"C4H8O",ev:6.3,v:.40,haz:.35,sk:"C:0:0,C:.87:.5,C:1.73:0,C:2.6:.5,O:.87:1.5|0-1,1-2,2-3,1=4"},
etoac:{n:"Ethyl acetate",f:"C4H8O2",ev:6.2,v:.42,haz:.15,sk:"C:0:0,C:.87:.5,O:1.73:0,C:2.6:.5,C:3.46:0,O:.87:1.5|0-1,1-2,2-3,3-4,1=5"},
meoac:{n:"Methyl acetate",f:"C3H6O2",ev:11,v:.36,haz:.15,sk:"C:0:0,C:.87:.5,O:1.73:0,C:2.6:.5,O:.87:1.5|0-1,1-2,2-3,1=4"},
tol:{n:"Toluene",f:"C7H8",ev:2,v:.56,haz:.6,sk:"C:0:1,C:-.87:.5,C:-.87:-.5,C:0:-1,C:.87:-.5,C:.87:.5,C:0:2|0=1,1-2,2=3,3-4,4=5,5-0,0-6"},
hept:{n:"n-Heptane",f:"C7H16",ev:4,v:.39,haz:.35,sk:"C:0:0,C:.87:.5,C:1.73:0,C:2.6:.5,C:3.46:0,C:4.33:.5,C:5.2:0|0-1,1-2,2-3,3-4,4-5,5-6"},
ipa:{n:"Isopropanol",f:"C3H8O",ev:1.7,v:2.4,haz:.1,sk:"C:0:0,C:.87:.5,C:1.73:0,O:.87:1.5|0-1,1-2,1-3"},
etoh:{n:"Ethanol",f:"C2H6O",ev:1.6,v:1.1,haz:.05,sk:"C:0:0,C:.87:.5,O:1.73:0|0-1,1-2"},
chex:{n:"Cyclohexanone",f:"C6H10O",ev:.3,v:2,haz:.2,sk:"C:0:1,C:-.87:.5,C:-.87:-.5,C:0:-1,C:.87:-.5,C:.87:.5,O:0:2|0-1,1-2,2-3,3-4,4-5,5-0,0=6"}};
const P={
fabri:{n:"Fabri-Tac (composition unpublished)",f:"proprietary",str:6,coh:.8,k:14,fl:.7,haz:.2,c:{acetone:.9,mek:.9,etoac:.85,meoac:.85,tol:.6,hept:.2,ipa:.2,etoh:.2,chex:.7},sk:null},
neo:{n:"Polychloroprene (neoprene)",f:"(C4H5Cl)n",str:10,coh:.9,k:17,fl:.9,haz:.1,c:{acetone:.4,mek:.85,etoac:.6,meoac:.5,tol:.9,hept:.5,ipa:0,etoh:0,chex:.6},sk:"C:0:0,C:.87:.5,C:1.73:0,C:2.6:.5,Cl:.87:1.5|0-1,1=2,2-3,1-4"},
pvac:{n:"Polyvinyl acetate",f:"(C4H6O2)n",str:6,coh:.6,k:13,fl:.5,haz:0,c:{acetone:.95,mek:.9,etoac:.9,meoac:.9,tol:.7,hept:0,ipa:.3,etoh:.4,chex:.8},sk:"C:0:0,C:.87:.5,C:1.73:0,O:.87:1.5,C:1.73:2,O:1.73:3,C:2.6:1.5|0-1,1-2,1-3,3-4,4=5,4-6"},
nbr:{n:"Nitrile rubber (NBR)",f:"(C4H6·C3H3N)n",str:12,coh:.8,k:17,fl:.9,haz:.15,c:{acetone:.8,mek:.95,etoac:.6,meoac:.6,tol:.6,hept:.1,ipa:0,etoh:0,chex:.7},sk:"C:0:0,C:.87:.5,C:1.73:0,C:2.6:.5,C:3.46:0,C:4.33:.5,C:.87:1.5,N:.87:2.5|0-1,1-2,2-3,3=4,4-5,1-6,6#7"},
sbs:{n:"SBS rubber (butadiene block shown)",f:"(C4H6)n(C8H8)m",str:15,coh:.7,k:16,fl:.95,haz:.1,c:{acetone:0,mek:.3,etoac:.3,meoac:.1,tol:.95,hept:.6,ipa:0,etoh:0,chex:.5},sk:"C:0:0,C:.87:.5,C:1.73:0,C:2.6:.5|0-1,1=2,2-3"},
ps:{n:"Polystyrene",f:"(C8H8)n",str:40,coh:.2,k:11,fl:.1,haz:.1,c:{acetone:.8,mek:.9,etoac:.85,meoac:.7,tol:.95,hept:0,ipa:0,etoh:0,chex:.8},sk:"C:0:0,C:.87:.5,C:1.73:0,C:.87:1.5,C:1.73:2,C:1.73:3,C:.87:3.5,C:0:3,C:0:2|0-1,1-2,1-3,3=4,4-5,5=6,6-7,7=8,8-3"},
pmma:{n:"PMMA (acrylic)",f:"(C5H8O2)n",str:50,coh:.25,k:12,fl:.1,haz:.1,c:{acetone:.85,mek:.85,etoac:.8,meoac:.7,tol:.8,hept:0,ipa:0,etoh:0,chex:.8},sk:"C:0:0,C:.87:.5,C:1.73:0,C:0:1,C:1.73:1,O:1.73:2,O:2.6:.5,C:3.46:1|0-1,1-2,1-3,1-4,4=5,4-6,6-7"},
pib:{n:"Polyisobutylene (tacky)",f:"(C4H8)n",str:1.5,coh:1,k:14,fl:1,haz:.05,c:{acetone:0,mek:.2,etoac:.3,meoac:.1,tol:.9,hept:.95,ipa:0,etoh:0,chex:.5},sk:"C:0:0,C:.87:.5,C:1.73:0,C:0:1,C:1.73:1|0-1,1-2,1-3,1-4"}};
const A={
egda:{n:"Ethylene glycol diacetate (plasticizer)",f:"C6H10O4",sk:"C:0:0,C:.87:.5,O:.87:1.5,O:1.73:0,C:2.6:.5,C:3.46:0,O:4.33:.5,C:5.2:0,O:5.2:-1,C:6.06:.5|0-1,1=2,1-3,3-4,4-5,5-6,6-7,7=8,7-9"},
silica:{n:"Fumed silica (thickener)",f:"SiO2",sk:"O:0:0,Si:1:0,O:2:0|0=1,1=2"}};
const TYPE={};Object.keys(S).forEach(k=>TYPE[k]="s");Object.keys(P).forEach(k=>TYPE[k]="p");Object.keys(A).forEach(k=>TYPE[k]="a");
const LIB=Object.assign({},S,P,A);
const ids=t=>Object.keys(TYPE).filter(k=>TYPE[k]===t);
function parseSk(s){if(!s)return null;const[a,b]=s.split("|");return{atoms:a.split(",").map(x=>{const q=x.split(":");return[q[0],+q[1],+q[2]]}),bonds:b.split(",").map(x=>{const m=x.match(/(\d+)([-=#])(\d+)/);return[+m[1],+m[3],m[2]=="-"?1:m[2]=="="?2:3]})}}

// ---------- Scoring model ----------
let target=200;
function evaluate(c){
 let Ws=0,Wp=0,Wa=0;
 for(const x of c){const w=x.wt/100,t=TYPE[x.id];if(t=="s")Ws+=w;else if(t=="p")Wp+=w;else Wa+=w}
 if(Ws<.4||Ws>.95||Wp<.04||Wa>.1)return null;
 let lnv=0,E=0,hz=0,slow=0;
 for(const x of c)if(TYPE[x.id]=="s"){const w=x.wt/100/Ws,s=S[x.id];lnv+=w*Math.log(s.v);E+=w/s.ev;hz+=w*s.haz;if(s.ev<1)slow+=w}
 E=1/E;
 let kw=0,comp=0,str=0,coh=0,fl=0,ph=0;
 for(const x of c)if(TYPE[x.id]=="p"){const p=P[x.id],w=x.wt/100;let cc=0;
  for(const y of c)if(TYPE[y.id]=="s")cc+=y.wt/100/Ws*p.c[y.id];
  kw+=p.k*w*(.5+.5*cc);comp+=w/Wp*cc;str+=w/Wp*p.str;coh+=w/Wp*p.coh;fl+=w/Wp*p.fl;ph+=w/Wp*p.haz}
 const si=(c.find(x=>x.id=="silica")||{wt:0}).wt/100,pl=(c.find(x=>x.id=="egda")||{wt:0}).wt/100;
 const eta=Math.exp(lnv+kw+18*si),le=Math.log10(eta);
 const sol=Math.min(1,Math.max(0,(comp-.35)/.45));
 const flow=Math.exp(-Math.pow((le-2)/.7,2));
 const t=1.2*(Ws/.667)*(14.4/E)*(1+3*slow);
 const dry=1/(1+t*t);
 fl=Math.min(1,fl+2*pl);
 const flexS=Math.min(1,fl/.6);
 const sigma=str*(.5+.5*fl)*(1-2.5*pl)*(.4+.6*sol);
 const solids=Wp+Wa;
 const hold=Math.max(0,sigma*.785*solids/.0098);
 const holdS=1-Math.exp(-hold/target);
 const tack=Math.min(1,coh*Math.min(1,Wp/.2)+1.5*si);
 const haz=1-.4*(hz*.6+ph*.4);
 const fs=[[dry,.3],[flow,.2],[holdS,.3],[tack,.15],[sol,.25],[flexS,.1]];
 let ls=0,tw=0;for(const[v,w]of fs){ls+=w*Math.log(Math.max(v,1e-3));tw+=w}
 const score=100*Math.exp(ls/tw)*haz;
 return{score:+score.toFixed(2),visc:Math.round(eta),dryS:+t.toFixed(2),holdG:Math.round(hold),tack:+tack.toFixed(2),sol:+sol.toFixed(2),flex:+fl.toFixed(2),haz:+(1-haz).toFixed(2)}
}

// ---------- Search ----------
const R=Math.random,pick=a=>a[Math.floor(R()*a.length)];
function norm(c){c=c.filter(x=>x.wt>0);let s=c.reduce((a,x)=>a+x.wt,0);c.forEach(x=>x.wt=Math.max(1,Math.round(x.wt*100/s)));
 s=c.reduce((a,x)=>a+x.wt,0);const big=c.reduce((a,x)=>x.wt>a.wt?x:a,c[0]);big.wt+=100-s;return c.sort((a,b)=>a.id<b.id?-1:1)}
function randomF(){
 const sh=ids("s").sort(()=>R()-.5).slice(0,1+Math.floor(R()*3)),ph=ids("p").sort(()=>R()-.5).slice(0,1+Math.floor(R()*3)),ah=ids("a").filter(()=>R()<.3);
 const ws=55+R()*35,wp=100-ws-ah.length*3,c=[];
 const sp=sh.map(()=>R()+.1),pp=ph.map(()=>R()+.1),ss=sp.reduce((a,b)=>a+b),ps=pp.reduce((a,b)=>a+b);
 sh.forEach((id,i)=>c.push({id,wt:ws*sp[i]/ss}));ph.forEach((id,i)=>c.push({id,wt:wp*pp[i]/ps}));ah.forEach(id=>c.push({id,wt:1+R()*4}));
 return norm(c)}
function mutate(b){
 let c=b.map(x=>({id:x.id,wt:x.wt}));const op=R();
 if(op<.55&&c.length>1){const a=pick(c),d=pick(c);if(a!==d){const m=1+Math.floor(R()*8);a.wt+=m;d.wt-=m;if(d.wt<1)d.wt=0}}
 else if(op<.75){const x=pick(c),t=TYPE[x.id],o=ids(t).filter(i=>!c.some(y=>y.id==i));if(o.length)x.id=pick(o)}
 else if(op<.9){const t=pick(["s","p","a"]),o=ids(t).filter(i=>!c.some(y=>y.id==i));if(o.length)c.push({id:pick(o),wt:1+R()*10})}
 else{const x=pick(c);if(c.filter(y=>TYPE[y.id]==TYPE[x.id]).length>1||TYPE[x.id]=="a")x.wt=0}
 return norm(c)}
const key=c=>c.map(x=>x.id+":"+x.wt).join("|");

// ---------- Runner ----------
target=+arg("target",200);
let F=[],seen=new Set(),LOG=[],evals=0,lastGain=0,best=null,counter=0;
const rd=n=>{try{return JSON.parse(fs.readFileSync(path.join(OUT,n),"utf8"))}catch(e){return null}};
function logE(msg,f){const e={time:new Date().toISOString(),evals,msg,best:best?best.m.score:null,bestId:best?best.id:null,formulaId:f?f.id:null,mix:f?f.comps.map(x=>x.id+" "+x.wt+"%").join(", "):null,kept:F.length};
 LOG.push(e);if(LOG.length>3000)LOG.splice(1,500);return e}
function add(c,gen){
 const k=key(c);if(seen.has(k))return;seen.add(k);
 const m=evaluate(c);evals++;if(!m)return;
 const f={id:"F"+String(++counter).padStart(6,"0"),gen,comps:c,m};F.push(f);
 if(!best||m.score>best.m.score+.005){best=f;lastGain=evals;const e=logE("new best",f);console.log(`#${evals}  best ${m.score}  ${f.comps.map(x=>x.wt+"% "+x.id).join(" + ")}  (hold ${m.holdG} g, dry ${m.dryS} s, ${m.visc} cP)`)}}
function files(base){
 const top=F.slice().sort((a,b)=>b.m.score-a.m.score).slice(0,1500);top.push(base);
 const sk={},fm={};top.forEach(f=>{fm[f.id]=f.comps.map(x=>[x.id,x.wt]);f.comps.forEach(x=>{if(!sk[x.id]){const p=parseSk(LIB[x.id].sk);sk[x.id]={name:LIB[x.id].n,formula:LIB[x.id].f,atoms:p?p.atoms:null,bonds:p?p.bonds:null}}})});
 return{
 "formulas.json":{schema:1,generated:new Date().toISOString(),target_hold_g:target,evaluated:evals,counter,best:best&&best.id,baseline:base,formulas:top},
 "log.json":{schema:1,entries:LOG},
 "skeletons.json":{schema:1,note:"atoms=[element,x,y] in bond-length units, bonds=[a,b,order]. formulas maps formula id to [componentId, wt%].",components:sk,formulas:fm}}}
function save(base){fs.mkdirSync(OUT,{recursive:true});const o=files(base);for(const n in o)fs.writeFileSync(path.join(OUT,n),JSON.stringify(o[n],null,1))}

const bc=norm([{id:"acetone",wt:67},{id:"fabri",wt:33}]);
const base={id:"BASE",gen:"baseline",comps:bc,m:evaluate(bc)};
if(!FRESH){const j=rd("formulas.json"),l=rd("log.json");
 if(j&&j.formulas){F=j.formulas.filter(f=>f.id!="BASE");F.forEach(f=>f.m=evaluate(f.comps)||f.m);seen=new Set(F.map(f=>key(f.comps)));evals=j.evaluated||F.length;counter=j.counter||F.length;console.log(`Resuming: ${F.length} formulas, ${evals} evaluated`)}
 if(l&&l.entries)LOG=l.entries}
best=F.slice().sort((a,b)=>b.m.score-a.m.score)[0]||null;lastGain=evals;
logE("search started");
console.log(`Baseline 2:1 acetone:Fabri-Tac scores ${base.m.score}`);
const t0=Date.now();let stop="converged: no gain for "+PATIENCE+" blends";
process.on("SIGINT",()=>{save(base);console.log("\nSaved. Bye.");process.exit(0)});
while(true){
 F.sort((a,b)=>b.m.score-a.m.score);if(F.length>5000)F.length=4000;
 const el=F.slice(0,40);
 for(let i=0;i<500;i++){const g=el.length>=20&&R()<.75;
  add(g?mutate(pick(el.slice(0,Math.min(el.length,1+Math.floor(R()*R()*40)))).comps):randomF(),g?"mutate":"random")}
 if(evals%5000<500){logE("checkpoint");save(base)}
 if(evals-lastGain>=PATIENCE)break;
 if((Date.now()-t0)/60000>=MAXMIN){stop="time limit "+MAXMIN+" min reached";break}}
logE(stop,best);save(base);
console.log(`\n${stop}\nEvaluated ${evals} blends, kept ${F.length}.\nBest ${best.id}: score ${best.m.score} vs baseline ${base.m.score}`);
best.comps.forEach(x=>console.log(`  ${String(x.wt).padStart(3)}%  ${LIB[x.id].n}  ${LIB[x.id].f}`));
console.log(`  est. hold ${best.m.holdG} g, dry ~${best.m.dryS} s, ${best.m.visc} cP, hazard load ${best.m.haz}\nFiles written to ${path.resolve(OUT)}/`);
