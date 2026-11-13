"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const box={setTimeout,Float32Array};vm.createContext(box);
for(const file of ["audio-engine.js","version-model.js"])new vm.Script(fs.readFileSync(path.join(__dirname,"..",file),"utf8")).runInContext(box);
const A=box.MelodyAudio,V=box.MelodyVersions;
function fixture(seconds=1,frequency=220,sampleRate=8000){return{sampleRate,channels:[Float32Array.from({length:Math.round(seconds*sampleRate)},(_,i)=>0.4*Math.sin(2*Math.PI*frequency*i/sampleRate))]};}
function stateEdit(history,index=8,value=2){const state=V.clone(history.working);state.points[index].value=value;history.apply(state,"Pitch edit");}
test("dense control data is relative adjustment with fixed endpoint coverage",()=>{
 const state=V.initialState(2);assert.equal(state.points.length,33);assert.equal(state.points[0].time,0);assert.equal(state.points.at(-1).time,2);assert.ok(state.points.every(p=>p.value===0));
 assert.equal(V.initialState(300).points.length,2401);assert.throws(()=>V.initialState(301));
});
test("shared smoothstep interpolation has exact endpoints and a smooth midpoint",()=>{
 const points=[{time:0,value:0},{time:1,value:4}];assert.equal(A.curveValue(points,0),0);assert.equal(A.curveValue(points,1),4);assert.equal(A.curveValue(points,0.5),2);
 assert.ok(A.curveValue(points,0.001)<0.00002);assert.equal(A.curveValue(points,2),4);
});
test("saved versions deeply freeze real state and use unique names and colors",()=>{
 const h=new V.VersionHistory(2,"source");const original=JSON.stringify(h.get("original"));stateEdit(h);const one=h.save();stateEdit(h,8,5);const two=h.save();
 assert.equal(one.name,"Version 1");assert.equal(two.name,"Version 2");assert.notEqual(one.color,two.color);assert.notEqual(one.color,h.get("original").color);
 assert.equal(one.state.points[8].value,2);assert.equal(two.state.points[8].value,5);assert.equal(JSON.stringify(h.get("original")),original);
 assert.ok(Object.isFrozen(one.state.points[8]));assert.throws(()=>{one.state.points[8].value=9;},TypeError);
});
test("editing a numbered version updates only that version and Undo Redo restore its state",()=>{
  const h=new V.VersionHistory(2,"source"),original=JSON.stringify(h.get("original"));
  const one=h.save("Added version",null,"original",true),two=h.save("Added version",null,"original",true);
  const next=V.clone(one.state);next.points[8].value=3;
  assert.equal(h.amend(one.id,next,"Pitch edit"),true);assert.equal(h.get(one.id).state.points[8].value,3);
  assert.equal(h.get(two.id).state.points[8].value,0);assert.equal(JSON.stringify(h.get("original")),original);
  assert.equal(h.dirty(),false);assert.equal(h.get(one.id).changes.length,1);
  h.undo();assert.equal(h.get(one.id).state.points[8].value,0);assert.equal(h.dirty(),false);
  h.redo();assert.equal(h.get(one.id).state.points[8].value,3);assert.equal(h.dirty(),false);
  assert.throws(()=>h.amend("original",next,"bad"),/Only a saved numbered version/);
});
test("restore adds a new node while undo redo and branching preserve all versions",()=>{
 const h=new V.VersionHistory(2,"source");stateEdit(h);const one=h.save();stateEdit(h,8,5);const two=h.save();const restored=h.restore(one.id);
 assert.equal(h.versions.length,4);assert.equal(restored.restoredFrom,one.id);assert.equal(restored.parentId,two.id);assert.equal(h.working.points[8].value,2);
 h.undo();assert.equal(h.working.points[8].value,5);assert.equal(h.versions.length,4);h.redo();assert.equal(h.working.points[8].value,2);
 h.undo();stateEdit(h,8,-2);const branch=h.save();assert.equal(h.redoStack.length,0);assert.equal(h.versions.length,5);assert.equal(branch.parentId,two.id);
 const reset=h.restore("original");assert.equal(reset.restoredFrom,"original");assert.ok(h.working.points.every(p=>p.value===0));assert.equal(h.versions.length,6);
});
test("deleting a saved version preserves Original and never reuses its number",()=>{
 const h=new V.VersionHistory(2,"source"),original=JSON.stringify(h.get("original"));stateEdit(h);const one=h.save();stateEdit(h,8,5);const two=h.save();
 assert.throws(()=>h.remove("original"),/Original cannot be deleted/);assert.throws(()=>h.remove("edit-99"),/Version not found/);
 assert.equal(h.remove(two.id).id,two.id);assert.equal(h.baseId,"original");assert.ok(h.working.points.every(p=>p.value===0));
 assert.equal(h.get(two.id),undefined);assert.equal(h.get(one.id).state.points[8].value,2);assert.equal(JSON.stringify(h.get("original")),original);
 assert.ok(h.undoStack.every(s=>s.baseId!==two.id));assert.ok(h.redoStack.every(s=>s.baseId!==two.id));
 stateEdit(h,8,3);const third=h.save();assert.equal(third.name,"Version 3");assert.equal(third.parentId,"original");
});
test("deleting the base of an unsaved edit preserves that edit",()=>{
 const h=new V.VersionHistory(2,"source");stateEdit(h);const saved=h.save();stateEdit(h,8,4);
 h.remove(saved.id);assert.equal(h.baseId,"original");assert.equal(h.working.points[8].value,4);assert.equal(h.dirty(),true);
 const next=h.save();assert.equal(next.name,"Version 2");assert.equal(next.parentId,"original");
});
test("undo capacity is independent of append-only saved history",()=>{
 const h=new V.VersionHistory(1,"source");for(let i=0;i<45;i++){stateEdit(h,8,i%2?2:3);h.save();}
 assert.equal(h.undoStack.length,40);assert.equal(h.versions.length,46);assert.equal(new Set(h.versions.map(v=>v.color)).size,46);
});
test("parameter agreement locates pitch edits and also detects source timing volume and speed",()=>{
 const a=V.initialState(2),b=V.clone(a);b.points[16].value=4;const r=V.compare(a,b);
 assert.ok(r.score<100&&r.score>80);assert.ok(r.regions.some(x=>x.status==='modified'&&x.start<1&&x.end>1));assert.ok(r.regions.some(x=>x.status==='similar'));
 const small=V.clone(a);small.points[16].value=0.2;assert.equal(V.compare(a,small).score,100);
 const volume=V.clone(a);volume.settings.volume=50;assert.equal(V.compare(a,volume).score,0);
 const speed=V.clone(a);speed.settings.speed=1.25;assert.equal(V.compare(a,speed).score,0);
 const cut=V.editRange(a,{start:0.5,end:1.5},true);assert.equal(V.compare(a,cut).score,0);
});
test("selected-time comparison only measures the requested interval",()=>{
 const a=V.initialState(2),b=V.clone(a);b.points[16].value=4;
 const untouched=V.compare(a,b,0.02,{start:0,end:0.3}),changed=V.compare(a,b,0.02,{start:0.85,end:1.15});
 assert.equal(untouched.score,100);assert.ok(changed.score<100);assert.ok(changed.regions.every(r=>r.start>=0.85-1e-9&&r.end<=1.15+1e-9));
 assert.ok(Math.abs(changed.duration-0.3)<1e-9);assert.equal(V.compare(a,a,0.02,{start:0.5,end:1}).score,100);
 assert.throws(()=>V.compare(a,b,0.02,{start:1,end:0.5}),/Comparison range/);
});
test("range edits retain source mappings and remap real pitch controls",()=>{
 const s=V.initialState(2);s.points.forEach(p=>p.value=p.time);
 const keep=V.editRange(s,{start:0.5,end:1.5},true);assert.equal(V.duration(keep),1);assert.equal(keep.segments[0].sourceStart,0.5);assert.equal(keep.points[0].value,0.5);
 const remove=V.editRange(s,{start:0.5,end:1},false);assert.equal(V.duration(remove),1.5);assert.equal(V.sourcePosition(remove,0.75),1.25);
 assert.throws(()=>V.editRange(s,{start:0,end:2},false),/remove all/);
});
test("continuous renderer preserves exact untouched mono and stereo samples even with many controls",async()=>{
 const source=fixture(1.001);source.channels.push(Float32Array.from(source.channels[0],v=>-v));const state=V.initialState(source.channels[0].length/source.sampleRate);
 const out=await A.renderCurve(source,state);assert.equal(out.channels[0].length,source.channels[0].length);
 assert.deepEqual(Array.from(out.channels[0]),Array.from(source.channels[0]));assert.deepEqual(Array.from(out.channels[1]),Array.from(source.channels[1]));
});
test("a local control edit changes real PCM while preserving original samples and distant unedited audio",async()=>{
 const source=fixture(2),before=Float32Array.from(source.channels[0]),state=V.initialState(2);state.points[16].value=7;
 const out=await A.renderCurve(source,state);assert.equal(out.duration,2);assert.deepEqual(Array.from(source.channels[0]),Array.from(before));
 assert.ok(out.channels[0].some((v,i)=>Math.abs(v-before[i])>0.1));assert.deepEqual(Array.from(out.channels[0].subarray(0,4000)),Array.from(before.subarray(0,4000)));
 assert.ok(out.channels[0].every(Number.isFinite));
});
test("one overlap-add stream avoids artificial per-slice amplitude restarts on a constant fixture",async()=>{
 const source={sampleRate:8000,channels:[new Float32Array(8000).fill(0.4)]},state=V.initialState(1);state.points.forEach(p=>p.value=6);
 const out=await A.renderCurve(source,state);let id=0;const notes=A.splitSource(1,96,()=>++id,4);notes.forEach(n=>n.pitch=66);
 const old=await A.render(notes,source,{tempo:96,speed:1,volume:100,fadeIn:false,fadeOut:false});
 for(const index of [2000,4000,6000]){assert.ok(Math.abs(out.channels[0][index]-0.4)<1e-5);assert.equal(old.channels[0][index],0);}
 const two=V.clone(state);two.points=[{id:1,time:0,value:6},{id:2,time:1,value:6}];const sparse=await A.renderCurve(source,two);
 assert.deepEqual(Array.from(out.channels[0]),Array.from(sparse.channels[0]));
});
test("splice crossfade reduces a constructed cut discontinuity while preserving length",async()=>{
 const source={sampleRate:8000,channels:[Float32Array.from({length:16000},(_,i)=>i<8000?0.4:-0.4)]};
 const state=V.editRange(V.initialState(2),{start:0.75,end:1.25},false),out=await A.renderCurve(source,state);
 assert.equal(out.channels[0].length,12000);const at=6000;assert.ok(Math.abs(out.channels[0][at]-out.channels[0][at-1])<0.02);
 assert.equal(out.channels[0][at-200],source.channels[0][at-200]);
});
test("continuous renderer applies speed volume fades and cancellation to actual output",async()=>{
 const source=fixture(),state=V.initialState(1);state.settings.speed=1.25;let out=await A.renderCurve(source,state);assert.equal(out.channels[0].length,6400);
 state.settings.volume=0;out=await A.renderCurve(source,state);assert.ok(out.channels[0].every(v=>v===0));state.settings.volume=100;state.settings.fadeIn=true;state.settings.fadeOut=true;
 out=await A.renderCurve(source,state);assert.equal(out.channels[0][0],0);assert.equal(Math.abs(out.channels[0].at(-1)),0);
 await assert.rejects(A.renderCurve(source,state,{cancelled:()=>true}),/superseded/);
});
test("common playback windows use actual stereo samples and silence-pad a shorter version",()=>{
 const data=[Float32Array.from([0,0.1,0.2,0.3]),Float32Array.from([0,-0.1,-0.2,-0.3])],buffer={sampleRate:4,numberOfChannels:2,getChannelData:c=>data[c]};
 const out=V.segment(buffer,{start:0.5,end:1.5});assert.equal(out.channels[0].length,4);assert.equal(out.channels[0][0],data[0][2]);assert.equal(out.channels[1][1],data[1][3]);assert.equal(out.channels[0][2],0);
 assert.ok(V.segment(buffer,{start:2,end:3}).channels[0].every(v=>v===0));assert.throws(()=>V.segment(buffer,{start:2,end:1}));
});

test("a constant octave control shifts the dominant sine frequency to approximately 880 Hz",async()=>{
 const source=fixture(1,440,16000),state=V.initialState(1);state.points.forEach(p=>p.value=12);const out=await A.renderCurve(source,state);
 function energy(hz){let a=0,b=0;for(let i=1600;i<14400;i++){a+=out.channels[0][i]*Math.cos(2*Math.PI*hz*i/16000);b+=out.channels[0][i]*Math.sin(2*Math.PI*hz*i/16000);}return Math.hypot(a,b);}
 let best=0,peak=0;for(let hz=860;hz<=900;hz++){const candidate=energy(hz);if(candidate>peak){peak=candidate;best=hz;}}
 assert.ok(Math.abs(best-880)<=3);assert.ok(peak>energy(440)*20);assert.ok(peak>1000);
});

test("checking out an earlier snapshot and explicitly adding a version preserves both",()=>{
 const h=new V.VersionHistory(2,"source");stateEdit(h,8,2);const one=h.save();stateEdit(h,8,5);const two=h.save();
 h.checkout(one.id);assert.equal(h.working.points[8].value,2);assert.equal(h.baseId,one.id);
 const copy=h.save("Added version",null,h.baseId,true);assert.equal(copy.name,"Version 3");assert.equal(copy.parentId,one.id);
 assert.equal(copy.state.points[8].value,2);assert.equal(two.state.points[8].value,5);assert.equal(h.get("original").state.points[8].value,0);
 assert.ok(Object.isFrozen(copy.state));assert.equal(h.versions.length,4);
});

test("long flat renders yield and honor cancellation after processing begins",async()=>{
 const source=fixture(12,220,8000),state=V.initialState(12);let checks=0;
 await assert.rejects(A.renderCurve(source,state,{cancelled:()=>++checks>=2}),error=>error.name==="AbortError");
 assert.ok(checks>=2);
});
