"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");

function createHarness() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8"), elements = new Map(), blobs = new Map();
  let decoded = null, blobCounter = 0, lastDownload = null;
  class Element {
    constructor(tag = "div", id = "") {
      this.tagName = tag; this.id = id; this.style = {setProperty(name,value){this[name]=value;}}; this.children = []; this.dataset = {}; this.attributes = {};
      this.events = new Map(); this.value = ""; this.textContent = ""; this.disabled = false;
      const classes = new Set();
      this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name), toggle: (name, force) => { const next = force === undefined ? !classes.has(name) : force; if (next) classes.add(name); else classes.delete(name); return next; } };
      this.currentTime = 0; this.duration = 1; this.paused=true; this.ended=false;
    }
    get options() { return this.children.filter(child => child.tagName === "option"); }
    append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
    async trigger(name, extra = {}) { const event = { target: this, preventDefault() {}, ...extra }; for (const fn of this.events.get(name) || []) await fn(event); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name === "src" ? this.src || null : this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; if(name === "src") this.src=""; }
    querySelectorAll(selector) { return selector === "[data-current]" ? this.children.filter(child => child.dataset.current) : []; }
    getBoundingClientRect() { return { width: this.id === "trackCanvas" ? (String(this.style.width).endsWith("%") ? 800 : Number.parseFloat(this.style.width) || 800) : 800, height: 300, left: this.id === "trackCanvas" ? -(elements.get("rollWrap").scrollLeft || 0) : 0, top: 0 }; }
    setPointerCapture() {}
    getContext() { return { save() {},restore() {},rect() {},clip() {},bezierCurveTo() {}, scale() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillText() {}, roundRect() {}, arc() {} }; }
    load() {}
    pause() {this.paused=true;}
    play() {this.paused=false;this.ended=false;return this.trigger("play");}
    focus() {}
    click() { if (this.tagName === "a") lastDownload = { filename: this.download, blob: blobs.get(this.href) }; else if (!this.disabled) return this.trigger("click"); }
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) elements.set(match[2], new Element(match[1], match[2]));
  elements.get("zoomControl").value="10";
  const legend = [new Element(), new Element()];
  const document = { getElementById: id => { if (!elements.has(id)) throw new Error("Missing element: " + id); return elements.get(id); },
    createElement: tag => new Element(tag), querySelectorAll: selector => selector === ".note-legend" ? legend : [], body: new Element("body") };
  function makeBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: c => data[c], copyToChannel: (values, c) => data[c].set(values) };
  }
  class AudioContext {
    createBuffer(channels, length, sampleRate) { return makeBuffer(channels, length, sampleRate); }
    resume() { return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve(decoded); }
  }
  const box = { document, window: { AudioContext, addEventListener() {} }, Blob, Float32Array,
    URL: { createObjectURL: blob => { const url = "blob:test/" + ++blobCounter; blobs.set(url, blob); return url; }, revokeObjectURL: url => blobs.delete(url) },
    setTimeout: (fn, delay) => delay === 0 ? setTimeout(fn, 0) : 0, clearTimeout() {}, console };
  vm.createContext(box);
  new vm.Script(fs.readFileSync(path.join(root, "audio-engine.js"), "utf8")).runInContext(box);
  box.window.MelodyAudio = box.MelodyAudio;
  new vm.Script(fs.readFileSync(path.join(root,"version-model.js"),"utf8")).runInContext(box);
  box.window.MelodyVersions=box.MelodyVersions;
  new vm.Script(fs.readFileSync(path.join(root, "app.js"), "utf8")).runInContext(box);
  return {
    elements, html, blobs, run: code => new vm.Script(code).runInContext(box),
    async import(duration = 2,name="fixture.wav") {
      decoded = makeBuffer(1, Math.round(duration * 8000), 8000); const samples = decoded.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / 8000);
      await this.run('loadFile({name:'+JSON.stringify(name)+',size:100,arrayBuffer:async()=>new ArrayBuffer(1)})');
    },
    setSelected(index = 8) { this.run("if(selectedVersionId!=='draft'){history.checkout('original');workingBuffer=originalBuffer;renderedSignature=signature(history.working)}selectedVersionId='draft';selectedPointId=history.working.points["+index+"].id;renderUI()"); },
    get download() { return lastDownload; }
  };
}


test("simplified English UI has version picker, score data, segment listening and separate downloads",()=>{
  const ui=createHarness();
  for(const id of ["generateTab","generateBtn","suggestBtn","feedbackExplanation","compareA","compareB","regionList","versionList","pointSelect","regionPitch","applyRegionBtn","keepSelectionBtn","deleteSelectionBtn","fadeInBtn","fadeOutBtn","resetBtn","discardBtn"]) assert.equal(ui.elements.has(id),false);
  for(const id of ["versionPicker","similarityList","partialComparison","partialRange","partialSimilarityList","wholePanel","segmentPanel","segmentPlayList","downloadList","versionChanges","playAllSegmentsBtn"]) assert.equal(ui.elements.has(id),true);
  assert.equal(/[\u3400-\u9fff]/.test(ui.html),false);
  assert.ok(ui.html.includes("relative pitch adjustment"));assert.ok(ui.html.includes("not detected melody similarity"));assert.equal(ui.html.includes("More edit tools"),false);assert.equal(ui.html.includes("Working copy"),false);assert.equal(ui.elements.has("editWorkingBtn"),false);assert.equal(ui.elements.has("wholeMode"),false);assert.equal(ui.elements.has("partMode"),false);assert.equal(ui.elements.has("restoreBtn"),false);assert.equal(ui.elements.has("stopPlaybackBtn"),false);
});
test("WAV and MP3 import routes keep immutable Original and its 100 percent row",async()=>{
  const ui=createHarness();await ui.import(2,"fixture.mp3");assert.equal(ui.run("history.working.points.length"),33);assert.equal(ui.run("history.versions.length"),1);
  assert.equal(ui.elements.get("fileName").textContent,"fixture.mp3");
  const rows=ui.elements.get("similarityList").children;assert.equal(rows.length,1);assert.equal(rows[0].children[1].textContent,"100.0%");assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original"]);
  assert.equal(ui.run("history.get('original').color"),"#65737f");assert.ok(ui.run("history.working.points.every(p=>p.value===0)"));
  await ui.import();assert.equal(ui.elements.get("fileName").textContent,"fixture.wav");assert.equal(ui.run("history.versions.length"),1);
});
test("dragging a curve point changes actual PCM but not imported Original",async()=>{
  const ui=createHarness();await ui.import();const original=ui.run("originalBuffer"),before=ui.run("originalBuffer.getChannelData(0).slice()");
  const point=ui.run("(()=>{const g=geometry(),p=history.working.points[8];return{clientX:g.left+p.time*g.px,clientY:g.y(p.value),pointerId:1};})()");
  const moved={...point,clientY:point.clientY-ui.run("geometry().height/24*3")};
  await ui.elements.get("trackCanvas").trigger("pointerdown",point);await ui.elements.get("trackCanvas").trigger("pointermove",moved);await ui.elements.get("trackCanvas").trigger("pointerup",moved);
  assert.equal(ui.run("history.working.points[8].value"),3);assert.equal(ui.run("history.versions.length"),1);assert.equal(ui.run("originalBuffer"),original);
  assert.deepEqual(Array.from(ui.run("originalBuffer.getChannelData(0)")),Array.from(before));
  assert.ok(ui.run("workingBuffer.getChannelData(0).some((v,i)=>Math.abs(v-originalBuffer.getChannelData(0)[i])>0.05)"));
  assert.ok(ui.elements.get("pitchValue").textContent.includes("+3"));assert.ok(ui.elements.get("versionChanges").children.some(li=>li.textContent.includes("Point at")));
});
test("Add version saves independent states and the picker controls matching audio",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected();ui.elements.get("pitchControl").value="2";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  ui.setSelected();ui.elements.get("pitchControl").value="5";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  assert.equal(ui.run("history.get('edit-1').state.points[8].value"),2);assert.equal(ui.run("history.get('edit-2').state.points[8].value"),5);
  assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original","edit-1","edit-2"]);assert.equal(ui.elements.get("versionPicker").options.some(x=>x.textContent.includes("Working")),false);
  for(const id of ["original","edit-1","edit-2"]){
    ui.elements.get("versionPicker").value=id;await ui.elements.get("versionPicker").trigger("change");
    assert.equal(ui.elements.get("playSelectedBtn").style.backgroundColor,ui.run("entity('"+id+"').color"));
    await ui.elements.get("playSelectedBtn").trigger("click");assert.equal(ui.run("playingId"),id);assert.equal(ui.run("selectedVersionId"),id);
    const bytes=await ui.blobs.get(ui.elements.get("audioPlayer").src).arrayBuffer(),expected=await ui.run("getBuffer('"+id+"')");assert.equal(new DataView(bytes).getUint32(40,true),expected.length*2);
    await ui.elements.get("pausePlaybackBtn").trigger("click");assert.equal(ui.elements.get("audioPlayer").paused,true);
  }
});
test("dragging a saved curve updates its audio while Original remains unchanged",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(16);ui.elements.get("pitchControl").value="2";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  ui.run("selectVersion('edit-1')");const at=ui.run("(()=>{const g=geometry(),p=history.get('edit-1').state.points[16];return{clientX:g.left+p.time*g.px,clientY:g.y(p.value),pointerId:7};})()");
  const moved={...at,clientY:at.clientY-ui.run("geometry().height/24*2")};await ui.elements.get("trackCanvas").trigger("pointerdown",at);await ui.elements.get("trackCanvas").trigger("pointermove",moved);await ui.elements.get("trackCanvas").trigger("pointerup",moved);
  assert.equal(ui.run("selectedVersionId"),"edit-1");assert.equal(ui.run("history.get('edit-1').state.points[16].value"),4);assert.equal(ui.run("history.working.points[16].value"),4);
  assert.equal(ui.elements.get("versionPicker").options.some(x=>x.value==="draft"),false);
  assert.equal(ui.run("history.get('original').state.points[16].value"),0);
});
test("each displayed comparison value uses Original as its fixed reference",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(8);ui.elements.get("pitchControl").value="2";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  ui.elements.get("volumeControl").value="50";await ui.elements.get("volumeControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  const rows=ui.elements.get("similarityList").children;assert.equal(rows.length,3);assert.equal(rows[0].children[1].textContent,"100.0%");
  for(const [i,id] of [[1,"edit-1"],[2,"edit-2"]])assert.equal(rows[i].children[1].textContent,ui.run("Versions.compare(history.get('original').state,entity('"+id+"').state).score.toFixed(1)+'%'"));
  assert.ok(Number.parseFloat(rows[1].children[1].textContent)<100);assert.equal(ui.elements.has("regionList"),false);
});
test("drag selection offers each version for the same real PCM segment",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(8);ui.elements.get("pitchControl").value="3";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  ui.run("activeSelection={start:0.4,end:0.8};renderUI()");const buttons=ui.elements.get("segmentPlayList").children;assert.equal(buttons.length,2);
  for(const id of ["original","edit-1"]){const button=buttons.find(b=>b.dataset.versionId===id);await button.trigger("click");assert.equal(ui.run("playingId"),id);assert.equal(ui.run("playbackOffset"),0.4);
    const bytes=await ui.blobs.get(ui.elements.get("audioPlayer").src).arrayBuffer();assert.equal(new DataView(bytes).getUint32(40,true),6400);
    const expected=await ui.run("getBuffer('"+id+"')");assert.ok(Math.abs(new DataView(bytes).getInt16(84,true)/32768-expected.getChannelData(0)[Math.round(0.4*8000)+20])<0.0001);
  }
});
test("Listen in order plays one prepared audio stream and follows each version",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");await ui.elements.get("saveVersionBtn").trigger("click");ui.run("activeSelection={start:0.4,end:0.8};renderUI()");
  await ui.elements.get("playAllSegmentsBtn").trigger("click");assert.equal(ui.run("playingId"),"original");
  assert.deepEqual(Array.from(ui.run("sequencePlan.items.map(x=>x.id)")),["original","edit-1","edit-2"]);
  const url=ui.elements.get("audioPlayer").src,bytes=await ui.blobs.get(url).arrayBuffer();
  assert.equal(new DataView(bytes).getUint32(40,true),3*3200*2);
  ui.elements.get("audioPlayer").currentTime=0.45;await ui.elements.get("audioPlayer").trigger("timeupdate");
  assert.equal(ui.run("playingId"),"edit-1");assert.equal(ui.run("playbackOffset"),0.4);assert.ok(Math.abs(ui.run("playbackProgress")-0.45)<1e-6);
  ui.elements.get("audioPlayer").currentTime=0.85;await ui.elements.get("audioPlayer").trigger("timeupdate");
  assert.equal(ui.run("playingId"),"edit-2");assert.equal(ui.elements.get("audioPlayer").src,url);
  await ui.elements.get("pausePlaybackBtn").trigger("click");assert.equal(ui.elements.get("audioPlayer").paused,true);
  assert.ok(ui.run("sequencePlan"));
});
test("sequential stream contains each version's processed samples in order",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");
  ui.elements.get("volumeControl").value="0";await ui.elements.get("volumeControl").trigger("change");
  await ui.elements.get("saveVersionBtn").trigger("click");ui.run("activeSelection={start:0.4,end:0.8};renderUI()");
  await ui.elements.get("playAllSegmentsBtn").trigger("click");
  const bytes=await ui.blobs.get(ui.elements.get("audioPlayer").src).arrayBuffer(),view=new DataView(bytes);
  const sample=frame=>view.getInt16(44+frame*2,true);
  assert.ok(Math.abs(sample(817))>1000);assert.equal(sample(3200+817),0);assert.ok(Math.abs(sample(6400+817))>1000);
  assert.equal(ui.run("history.get('edit-1').state.settings.volume"),0);
});
test("starting another playback cancels a sequence still being prepared",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");
  ui.run("audioCache.clear();window.realRender=Engine.renderCurve;window.waiters=[];Engine.renderCurve=()=>new Promise(resolve=>window.waiters.push(resolve));activeSelection={start:0.4,end:0.8};renderUI()");
  const preparing=ui.elements.get("playAllSegmentsBtn").trigger("click");
  assert.equal(ui.run("sequencePreparing"),true);assert.equal(ui.elements.get("playAllSegmentsBtn").disabled,true);
  await Promise.resolve();assert.equal(ui.run("window.waiters.length"),1);
  ui.run("selectVersion('original')");await ui.elements.get("playSelectedBtn").trigger("click");assert.equal(ui.run("sequencePreparing"),false);
  ui.run("Engine.renderCurve=window.realRender;window.waiters[0]({sampleRate:8000,channels:[new Float32Array(16000)],duration:2})");
  await preparing;assert.equal(ui.run("sequencePlan"),null);assert.equal(ui.run("playingId"),"original");
});
test("volume and speed directly update the selected saved version",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");await ui.elements.get("saveVersionBtn").trigger("click");ui.run("selectVersion('edit-1')");assert.equal(ui.run("selectedVersionId"),"edit-1");
  ui.elements.get("volumeControl").value="0";await ui.elements.get("volumeControl").trigger("change");assert.equal(ui.run("selectedVersionId"),"edit-1");assert.ok(ui.run("workingBuffer.getChannelData(0).every(v=>v===0)"));
  assert.equal(ui.run("history.get('edit-1').state.settings.volume"),0);assert.ok(ui.elements.get("versionChanges").children.some(li=>li.textContent.includes("volume")));
  ui.elements.get("speedControl").value="1.25";await ui.elements.get("speedControl").trigger("change");assert.equal(ui.run("workingBuffer.duration"),1.6);
});
test("Undo and Redo preserve saved versions and immutable Original",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(8);
  for(const value of [2,5]){ui.elements.get("pitchControl").value=String(value);await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");ui.setSelected(8);}
  const original=ui.run("originalBuffer");ui.elements.get("pitchControl").value="3";await ui.elements.get("pitchControl").trigger("change");
  assert.equal(ui.run("history.working.points[8].value"),3);await ui.elements.get("undoBtn").trigger("click");assert.equal(ui.run("history.working.points[8].value"),0);
  assert.equal(ui.run("history.versions.length"),3);await ui.elements.get("redoBtn").trigger("click");assert.equal(ui.run("history.working.points[8].value"),3);assert.equal(ui.run("originalBuffer"),original);
});
test("visible volume and speed controls change real audio and Undo restores prior settings",async()=>{
  const ui=createHarness();await ui.import();ui.elements.get("volumeControl").value="0";await ui.elements.get("volumeControl").trigger("change");assert.ok(ui.run("workingBuffer.getChannelData(0).every(v=>v===0)"));
  ui.elements.get("volumeControl").value="100";await ui.elements.get("volumeControl").trigger("change");assert.ok(ui.run("workingBuffer.getChannelData(0).some(v=>Math.abs(v)>0.3)"));
  ui.elements.get("speedControl").value="1.25";await ui.elements.get("speedControl").trigger("change");assert.equal(ui.run("workingBuffer.duration"),1.6);assert.equal(ui.run("originalBuffer.duration"),2);
  await ui.elements.get("undoBtn").trigger("click");assert.equal(ui.run("workingBuffer.duration"),2);
});
test("per-version download writes processed WAV bytes and keeps Original separate",async()=>{
  const ui=createHarness();await ui.import();ui.elements.get("volumeControl").value="0";await ui.elements.get("volumeControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  const rows=ui.elements.get("downloadList").children;const edited=rows.find(r=>r.children[0].textContent==="Version 1");await edited.children[1].trigger("click");
  assert.equal(ui.download.filename,"fixture-version-1.wav");let bytes=await ui.download.blob.arrayBuffer(),data=new DataView(bytes);
  assert.equal(String.fromCharCode(...new Uint8Array(bytes,8,4)),"WAVE");assert.equal(data.getUint32(40,true),32000);assert.ok(new Int16Array(bytes,44).every(v=>v===0));
  await rows.find(r=>r.children[0].textContent==="Original").children[1].trigger("click");bytes=await ui.download.blob.arrayBuffer();assert.ok(new Int16Array(bytes,44).some(v=>v!==0));
});
test("long imports remain inside contained pan and zoom view",async()=>{
  const ui=createHarness();await ui.import(184);assert.equal(ui.run("history.working.points.length"),1473);assert.equal(ui.elements.get("trackCanvas").style.width,"100%");
  ui.elements.get("trackPan").value="1000";await ui.elements.get("trackPan").trigger("input");assert.equal(ui.run("viewOffset"),174);
  const start=ui.run("({clientX:geometry().left+geometry().px,clientY:70,shiftKey:true,pointerId:4})"),end={...start,clientX:start.clientX+ui.run("geometry().px*2")};
  await ui.elements.get("trackCanvas").trigger("pointerdown",start);await ui.elements.get("trackCanvas").trigger("pointermove",end);await ui.elements.get("trackCanvas").trigger("pointerup",end);
  assert.equal(ui.run("activeSelection.start"),175);assert.equal(ui.run("activeSelection.end"),177);
});
test("import limits and read errors preserve the previous source and versions",async()=>{
  const ui=createHarness();await ui.import();const original=ui.run("originalBuffer");
  await ui.run('loadFile({name:"huge.mp3",size:51*1024*1024})');assert.ok(ui.elements.get("status").textContent.includes("50 MB"));
  await ui.import(301);assert.ok(ui.elements.get("status").textContent.includes("longer than 5 minutes"));assert.equal(ui.run("originalBuffer"),original);
  await ui.run('loadFile({name:"broken.mp3",size:10,arrayBuffer:async()=>{throw new Error("fixture read failed")}})');assert.ok(ui.elements.get("status").textContent.includes("Could not read"));assert.equal(ui.run("originalBuffer"),original);
});
test("obsolete rendering cannot overwrite a newly imported recording",async()=>{
  const ui=createHarness();await ui.import();ui.run("window.oldRender=Engine.renderCurve;window.waiting=[];Engine.renderCurve=()=>new Promise(resolve=>window.waiting.push(resolve))");
  const pending=ui.run("(()=>{const next=Versions.clone(history.working);next.points[8].value=4;return applyWorking(next,'pending edit')})()");
  assert.equal(ui.elements.get("saveVersionBtn").disabled,false);await ui.import(1,"new.wav");const newest=ui.run("originalBuffer");
  ui.run("Engine.renderCurve=window.oldRender;window.waiting[0]({sampleRate:8000,channels:[new Float32Array(16000)],duration:2})");await pending;
  assert.equal(ui.run("workingBuffer"),newest);assert.equal(ui.run("history.versions.length"),1);assert.equal(ui.elements.get("fileName").textContent,"new.wav");
});
test("render failure disables the affected draft download and Undo can recover",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected();ui.run("window.oldRender=Engine.renderCurve;Engine.renderCurve=async()=>{throw new Error('fixture rendering failure')}");
  ui.elements.get("pitchControl").value="3";await ui.elements.get("pitchControl").trigger("change");assert.equal(ui.run("workingBuffer"),null);
  assert.equal(ui.elements.get("downloadList").children.at(-1).children[1].disabled,true);assert.equal(ui.elements.get("audioPlayer").src,"");
  assert.ok(ui.elements.get("status").textContent.includes("fixture rendering failure"));ui.run("Engine.renderCurve=window.oldRender");await ui.elements.get("undoBtn").trigger("click");
  assert.equal(ui.elements.get("downloadList").children.at(-1).children[1].disabled,false);
});
test("audio cache eviction retains every reconstructible snapshot",async()=>{
  const ui=createHarness();await ui.import();for(const value of [40,50,60,70]){await ui.elements.get("saveVersionBtn").trigger("click");ui.elements.get("volumeControl").value=String(value);await ui.elements.get("volumeControl").trigger("change");}
  assert.equal(ui.run("audioCache.size"),3);assert.equal(ui.run("history.versions.length"),5);
  const first=await ui.run("getBuffer('edit-1')");assert.ok(Math.abs(first.getChannelData(0)[123]-ui.run("originalBuffer.getChannelData(0)[123]")*0.4)<1e-6);assert.equal(ui.run("audioCache.size"),3);
});
test("clicking a draft point without moving does not change audio or save a node",async()=>{
  const ui=createHarness();await ui.import();const point=ui.run("(()=>{const g=geometry(),p=history.working.points[8];return{clientX:g.left+p.time*g.px,clientY:g.y(0),pointerId:9};})()");
  await ui.elements.get("trackCanvas").trigger("pointerdown",point);await ui.elements.get("trackCanvas").trigger("pointerup",point);assert.equal(ui.run("history.undoStack.length"),0);assert.equal(ui.run("history.versions.length"),1);
});
test("selected segment remains available while switching between saved versions",async()=>{
  const ui=createHarness();await ui.import();ui.run("activeSelection={start:0.5,end:1};renderUI()");assert.equal(ui.elements.get("segmentPlayList").children.length,1);
  ui.setSelected(8);ui.elements.get("pitchControl").value="2";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  ui.run("selectVersion('original')");assert.equal(ui.run("history.versions.length"),2);assert.equal(ui.run("selectedVersionId"),"original");
  assert.equal(ui.run("activeSelection.start"),0.5);assert.equal(ui.elements.get("partialSimilarityList").children[0].children[1].textContent,"100.0%");
});
test("Add version saves immediately and a later addition starts from Original",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(8);ui.elements.get("pitchControl").value="2";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  assert.equal(ui.run("selectedVersionId"),"edit-1");assert.equal(ui.run("history.working.points[8].value"),2);assert.equal(ui.run("history.baseId"),"edit-1");
  assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original","edit-1"]);
  ui.setSelected(8);ui.elements.get("pitchControl").value="5";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  ui.run("selectVersion('edit-1')");await ui.elements.get("saveVersionBtn").trigger("click");
  assert.equal(ui.run("history.versions.length"),4);assert.equal(ui.run("selectedVersionId"),"edit-3");assert.equal(ui.run("history.get('edit-3').state.points[8].value"),0);
  assert.equal(ui.run("history.get('edit-3').parentId"),"original");
  assert.equal(ui.run("history.get('edit-1').state.points[8].value"),2);assert.equal(ui.run("history.get('edit-2').state.points[8].value"),5);
  assert.equal(ui.elements.get("versionPicker").options.some(x=>x.value==="draft"),false);
});

test("Delete version removes selected audio, scores and controls without touching Original",async()=>{
 const ui=createHarness();await ui.import();const original=ui.run("originalBuffer");assert.equal(ui.elements.get("deleteVersionBtn").disabled,true);
 ui.setSelected(8);assert.equal(ui.elements.get("deleteVersionBtn").disabled,true);ui.elements.get("pitchControl").value="3";await ui.elements.get("pitchControl").trigger("change");
 await ui.elements.get("saveVersionBtn").trigger("click");assert.equal(ui.run("selectedVersionId"),"edit-1");assert.equal(ui.elements.get("deleteVersionBtn").disabled,false);
 ui.run("activeSelection={start:0.3,end:0.7};renderUI()");assert.equal(ui.elements.get("partialSimilarityList").children.length,2);
 await ui.elements.get("playSelectedBtn").trigger("click");assert.equal(ui.run("playingId"),"edit-1");assert.equal(ui.run("wavBlobCache.has('edit-1')"),true);
 await ui.elements.get("deleteVersionBtn").trigger("click");
 assert.equal(ui.run("history.get('edit-1')"),undefined);assert.equal(ui.run("selectedVersionId"),"original");assert.equal(ui.run("originalBuffer"),original);
 assert.equal(ui.run("audioCache.has('edit-1')"),false);assert.equal(ui.run("wavBlobCache.has('edit-1')"),false);assert.equal(ui.run("playingId"),null);
 assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original"]);
 for(const id of ["similarityList","partialSimilarityList","segmentPlayList","downloadList"])assert.equal(ui.elements.get(id).children.length,1);
 assert.equal(ui.elements.get("deleteVersionBtn").disabled,true);
});
test("deleting an older saved version keeps later versions playable and numbering monotonic",async()=>{
 const ui=createHarness();await ui.import();ui.setSelected(8);ui.elements.get("pitchControl").value="2";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
 ui.setSelected(8);ui.elements.get("pitchControl").value="5";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
 ui.run("selectVersion('edit-1')");await ui.elements.get("deleteVersionBtn").trigger("click");
 assert.equal(ui.run("history.get('edit-1')"),undefined);assert.equal(ui.run("history.get('edit-2').state.points[8].value"),5);
 ui.run("selectVersion('edit-2')");await ui.elements.get("playSelectedBtn").trigger("click");assert.equal(ui.run("playingId"),"edit-2");
 await ui.elements.get("saveVersionBtn").trigger("click");assert.equal(ui.run("selectedVersionId"),"edit-3");assert.equal(ui.run("history.get('edit-3').state.points[8].value"),0);
 assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original","edit-2","edit-3"]);
});
test("editing and segment tools stay visible and empty comparison explains selection",async()=>{
  const ui=createHarness();await ui.import();
  for(const id of ["wholePanel","segmentPanel","partialComparison"])assert.equal(ui.elements.get(id).classList.contains("hidden"),false);
  assert.equal(ui.elements.get("partialSimilarityList").children.length,0);
  assert.ok(ui.elements.get("partialRange").textContent.includes("Shift"));assert.ok(ui.elements.get("partialRange").textContent.includes("drag"));
});
test("Selected-segment percentages use only the chosen time span",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(8);ui.elements.get("pitchControl").value="4";await ui.elements.get("pitchControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");
  ui.run("activeSelection={start:1.4,end:1.7};renderUI()");
  let rows=ui.elements.get("partialSimilarityList").children;assert.equal(rows[0].children[1].textContent,"100.0%");assert.equal(rows[1].children[1].textContent,"100.0%");
  ui.run("activeSelection={start:0.35,end:0.65};renderUI()");rows=ui.elements.get("partialSimilarityList").children;
  assert.ok(Number.parseFloat(rows[1].children[1].textContent)<100);assert.equal(rows[1].children[1].textContent,ui.run("Versions.compare(history.get('original').state,history.get('edit-1').state,0.02,{start:0.35,end:0.65}).score.toFixed(1)+'%'"));
  await ui.elements.get("clearSelectionBtn").trigger("click");assert.equal(ui.elements.get("partialSimilarityList").children.length,0);
});
test("Shift-drag selects a range across a pitch point without changing audio",async()=>{
  const ui=createHarness();await ui.import();
  const start=ui.run("(()=>{const g=geometry(),p=history.working.points[8];return{clientX:g.left+p.time*g.px,clientY:g.y(0),pointerId:41,shiftKey:true};})()");
  const end={...start,clientX:start.clientX+ui.run("0.3*geometry().px")};
  await ui.elements.get("trackCanvas").trigger("pointerdown",start);await ui.elements.get("trackCanvas").trigger("pointermove",end);await ui.elements.get("trackCanvas").trigger("pointerup",end);
  assert.ok(ui.run("activeSelection.end-activeSelection.start")>0.29);assert.equal(ui.run("history.working.points[8].value"),0);assert.equal(ui.elements.get("partialSimilarityList").children[0].children[1].textContent,"100.0%");
});
test("dragging an empty curve area boxes a segment without editing audio",async()=>{
 const ui=createHarness();await ui.import();const original=ui.run("originalBuffer.getChannelData(0).slice()");
 const start=ui.run("(()=>{const g=geometry();return{clientX:g.left+0.3*g.px,clientY:g.top+10,pointerId:12};})()");
 const end={...start,clientX:start.clientX+ui.run("0.4*geometry().px")};
 await ui.elements.get("trackCanvas").trigger("pointerdown",start);await ui.elements.get("trackCanvas").trigger("pointermove",end);await ui.elements.get("trackCanvas").trigger("pointerup",end);
 assert.ok(Math.abs(ui.run("activeSelection.start")-0.3)<0.001);assert.ok(Math.abs(ui.run("activeSelection.end")-0.7)<0.001);
 assert.equal(ui.elements.get("segmentPlayList").children.length,1);assert.equal(ui.run("history.versions.length"),1);
 assert.deepEqual(Array.from(ui.run("originalBuffer.getChannelData(0)")),Array.from(original));
});

test("a real Blob import uses the original file for native playback but exports PCM WAV",async()=>{
 const ui=createHarness();await ui.import();
 await ui.run("(()=>{const file=new Blob([new Uint8Array(8)],{type:'audio/wav'});file.name='native.wav';return loadFile(file)})()");
 const raw=ui.blobs.get(ui.elements.get("audioPlayer").src);assert.equal(raw.size,8);assert.equal(ui.run("selectedVersionId"),"original");
 await ui.elements.get("playSelectedBtn").trigger("click");assert.equal(ui.blobs.get(ui.elements.get("audioPlayer").src),raw);
 const original=ui.elements.get("downloadList").children.find(r=>r.children[0].textContent==="Original");await original.children[1].trigger("click");
 const bytes=await ui.download.blob.arrayBuffer();assert.equal(String.fromCharCode(...new Uint8Array(bytes,8,4)),"WAVE");assert.ok(bytes.byteLength>44);
});
test("replaying an unchanged saved version reuses its encoded WAV Blob",async()=>{
 const ui=createHarness();await ui.import();ui.elements.get("volumeControl").value="80";await ui.elements.get("volumeControl").trigger("change");await ui.elements.get("saveVersionBtn").trigger("click");ui.run("selectVersion('edit-1')");
 await ui.elements.get("playSelectedBtn").trigger("click");const first=ui.blobs.get(ui.elements.get("audioPlayer").src);assert.ok(first.size>44);
 await ui.elements.get("playSelectedBtn").trigger("click");const second=ui.blobs.get(ui.elements.get("audioPlayer").src);assert.equal(second,first);
 assert.equal(ui.run("wavBlobCache.size"),1);
});
test("draft score is computed once until its state changes",async()=>{
 const ui=createHarness();await ui.import(20);ui.elements.get("volumeControl").value="80";await ui.elements.get("volumeControl").trigger("change");
 ui.run("window.scoreCalls=0;window.realCompare=Versions.compare;Versions.compare=(...args)=>{window.scoreCalls++;return window.realCompare(...args)};renderUI();renderUI()");
 assert.equal(ui.run("window.scoreCalls"),0);
 ui.elements.get("volumeControl").value="70";await ui.elements.get("volumeControl").trigger("change");assert.equal(ui.run("window.scoreCalls"),1);
});

test("Add version immediately saves and a point click alone never creates an unsaved entry",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");
  assert.equal(ui.run("selectedVersionId"),"edit-1");assert.equal(ui.run("history.dirty()"),false);
  const at=ui.run("(()=>{const g=geometry(),p=history.get('edit-1').state.points[8];return{clientX:g.left+p.time*g.px,clientY:g.y(p.value),pointerId:18};})()");
  await ui.elements.get("trackCanvas").trigger("pointerdown",at);await ui.elements.get("trackCanvas").trigger("pointerup",at);
  assert.equal(ui.run("selectedVersionId"),"edit-1");assert.equal(ui.run("history.dirty()"),false);
  assert.equal(ui.elements.get("pitchControl").disabled,false);
  assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original","edit-1"]);
});
test("newly added version can be edited by slider without creating an unsaved entry",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");
  const at=ui.run("(()=>{const g=geometry(),p=history.get('edit-1').state.points[8];return{clientX:g.left+p.time*g.px,clientY:g.y(p.value),pointerId:19};})()");
  await ui.elements.get("trackCanvas").trigger("pointerdown",at);await ui.elements.get("trackCanvas").trigger("pointerup",at);
  ui.elements.get("pitchControl").value="3";await ui.elements.get("pitchControl").trigger("change");
  assert.equal(ui.run("history.working.points[8].value"),3);assert.equal(ui.run("history.get('edit-1').state.points[8].value"),3);
  assert.equal(ui.run("selectedVersionId"),"edit-1");assert.equal(ui.run("history.dirty()"),false);
  assert.equal(ui.elements.get("versionPicker").options.some(x=>x.value==="draft"),false);
  await ui.elements.get("saveVersionBtn").trigger("click");
  assert.equal(ui.run("selectedVersionId"),"edit-2");assert.equal(ui.run("history.dirty()"),false);
  assert.equal(ui.run("history.get('edit-2').state.points[8].value"),0);
  assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original","edit-1","edit-2"]);
});
test("Undo of a saved edit selects its clean base instead of a phantom unsaved version",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(8);ui.elements.get("pitchControl").value="2";await ui.elements.get("pitchControl").trigger("change");
  await ui.elements.get("saveVersionBtn").trigger("click");assert.equal(ui.run("selectedVersionId"),"edit-1");
  await ui.elements.get("undoBtn").trigger("click");assert.equal(ui.run("history.dirty()"),false);
  assert.notEqual(ui.run("selectedVersionId"),"draft");assert.equal(ui.elements.get("versionPicker").options.some(x=>x.value==="draft"),false);
  await ui.elements.get("redoBtn").trigger("click");assert.equal(ui.run("history.dirty()"),false);
  assert.notEqual(ui.run("selectedVersionId"),"draft");assert.equal(ui.elements.get("versionPicker").options.some(x=>x.value==="draft"),false);
});
test("a long file permits dragging between sparse displayed point markers",async()=>{
  const ui=createHarness();await ui.import(30);await ui.elements.get("saveVersionBtn").trigger("click");
  ui.elements.get("zoomControl").value="0";ui.run("drawTrack()");
  const at=ui.run("(()=>{const g=geometry(),p=history.get('edit-1').state.points[17];return{clientX:g.left+(p.time-g.offset)*g.px,clientY:g.y(p.value),pointerId:20};})()");
  const moved={...at,clientY:at.clientY-ui.run("geometry().height/24*2")};
  await ui.elements.get("trackCanvas").trigger("pointerdown",at);await ui.elements.get("trackCanvas").trigger("pointermove",moved);await ui.elements.get("trackCanvas").trigger("pointerup",moved);
  assert.equal(ui.run("history.working.points[17].value"),2);assert.equal(ui.run("history.get('edit-1').state.points[17].value"),2);
  await ui.elements.get("saveVersionBtn").trigger("click");assert.equal(ui.run("history.get('edit-2').state.points[17].value"),0);
});
test("Add version waits for a pending audio render and then saves without an unsaved entry",async()=>{
  const ui=createHarness();await ui.import();ui.setSelected(8);
  ui.run("window.realRender=Engine.renderCurve;window.waiters=[];Engine.renderCurve=()=>new Promise(resolve=>window.waiters.push(resolve))");
  ui.elements.get("pitchControl").value="2";const editing=ui.elements.get("pitchControl").trigger("change");
  assert.equal(ui.run("rendering"),true);assert.equal(ui.elements.get("saveVersionBtn").disabled,false);
  const saving=ui.elements.get("saveVersionBtn").trigger("click");assert.equal(ui.elements.get("saveVersionBtn").disabled,true);
  ui.run("Engine.renderCurve=window.realRender;window.waiters[0]({sampleRate:8000,channels:[new Float32Array(16000)],duration:2})");
  await Promise.all([editing,saving]);
  assert.equal(ui.run("selectedVersionId"),"edit-1");assert.equal(ui.run("history.dirty()"),false);
  assert.equal(ui.run("history.get('edit-1').state.points[8].value"),2);
  assert.deepEqual(ui.elements.get("versionPicker").options.map(x=>x.value),["original","edit-1"]);
});
test("playing and downloading a directly edited version uses its new audio",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");
  await ui.elements.get("playSelectedBtn").trigger("click");const originalWav=ui.blobs.get(ui.elements.get("audioPlayer").src);
  const at=ui.run("(()=>{const g=geometry(),p=history.get('edit-1').state.points[8];return{clientX:g.left+p.time*g.px,clientY:g.y(p.value),pointerId:30};})()");
  await ui.elements.get("trackCanvas").trigger("pointerdown",at);await ui.elements.get("trackCanvas").trigger("pointerup",at);
  ui.elements.get("pitchControl").value="4";await ui.elements.get("pitchControl").trigger("change");
  assert.equal(ui.run("history.get('edit-1').state.points[8].value"),4);assert.equal(ui.run("history.dirty()"),false);
  await ui.elements.get("playSelectedBtn").trigger("click");const revisedWav=ui.blobs.get(ui.elements.get("audioPlayer").src);
  assert.notEqual(revisedWav,originalWav);assert.ok(ui.run("workingBuffer.getChannelData(0).some((v,i)=>Math.abs(v-originalBuffer.getChannelData(0)[i])>0.05)"));
  const row=ui.elements.get("downloadList").children.find(r=>r.children[0].textContent==="Version 1");
  await row.children[1].trigger("click");assert.equal(ui.download.blob,revisedWav);
  assert.equal(ui.run("history.get('original').state.points[8].value"),0);
});
test("Undo Redo restore a directly edited version and its comparison score",async()=>{
  const ui=createHarness();await ui.import();await ui.elements.get("saveVersionBtn").trigger("click");
  const at=ui.run("(()=>{const g=geometry(),p=history.get('edit-1').state.points[8];return{clientX:g.left+p.time*g.px,clientY:g.y(p.value),pointerId:31};})()");
  await ui.elements.get("trackCanvas").trigger("pointerdown",at);await ui.elements.get("trackCanvas").trigger("pointerup",at);
  ui.elements.get("pitchControl").value="4";await ui.elements.get("pitchControl").trigger("change");
  assert.ok(Number.parseFloat(ui.elements.get("similarityList").children[1].children[1].textContent)<100);
  await ui.elements.get("undoBtn").trigger("click");assert.equal(ui.run("history.get('edit-1').state.points[8].value"),0);
  assert.equal(ui.elements.get("similarityList").children[1].children[1].textContent,"100.0%");
  await ui.elements.get("redoBtn").trigger("click");assert.equal(ui.run("history.get('edit-1').state.points[8].value"),4);
  assert.ok(Number.parseFloat(ui.elements.get("similarityList").children[1].children[1].textContent)<100);
  assert.equal(ui.elements.get("versionPicker").options.some(x=>x.value==="draft"),false);
});
