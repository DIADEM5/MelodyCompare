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
      this.tagName = tag; this.id = id; this.style = {}; this.children = []; this.dataset = {}; this.attributes = {};
      this.events = new Map(); this.value = ""; this.textContent = ""; this.disabled = false;
      const classes = new Set();
      this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name), toggle: (name, force) => { const next = force === undefined ? !classes.has(name) : force; if (next) classes.add(name); else classes.delete(name); return next; } };
      this.currentTime = 0; this.duration = 1;
    }
    get options() { return this.children.filter(child => child.tagName === "option"); }
    append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
    async trigger(name, extra = {}) { const event = { target: this, preventDefault() {}, ...extra }; for (const fn of this.events.get(name) || []) await fn(event); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    querySelectorAll(selector) { return selector === "[data-current]" ? this.children.filter(child => child.dataset.current) : []; }
    getBoundingClientRect() { return { width: this.id === "trackCanvas" ? (String(this.style.width).endsWith("%") ? 800 : Number.parseFloat(this.style.width) || 800) : 800, height: 280, left: this.id === "trackCanvas" ? -(elements.get("rollWrap").scrollLeft || 0) : 0, top: 0 }; }
    setPointerCapture() {}
    getContext() { return { scale() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillText() {}, roundRect() {}, arc() {} }; }
    load() {}
    pause() {}
    play() { return Promise.resolve(); }
    focus() {}
    click() { if (this.tagName === "a") lastDownload = { filename: this.download, blob: blobs.get(this.href) }; else if (!this.disabled) return this.trigger("click"); }
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) elements.set(match[2], new Element(match[1], match[2]));
  for (const value of ["0.5", "1", "1.5", "2"]) { const option = new Element("option"); option.value = value; elements.get("noteLength").append(option); }
  elements.get("moodSelect").value = "follow"; elements.get("tempoControl").value = "96"; elements.get("suggestionDirection").value = "smoother";
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
  new vm.Script(fs.readFileSync(path.join(root, "app.js"), "utf8")).runInContext(box);
  return {
    elements, html, run: code => new vm.Script(code).runInContext(box),
    async generate() { elements.get("scenePrompt").value = "A calm sunny morning"; await this.run("generateFromPrompt()"); },
    async import(duration = 2) {
      decoded = makeBuffer(1, Math.round(duration * 8000), 8000); const samples = decoded.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / 8000);
      await this.run('loadFile({name:"fixture.wav",size:100,arrayBuffer:async()=>new ArrayBuffer(1)})');
    },
    setSelected(index = 0) { this.run("selectedNoteId=editedNotes[" + index + "].id;updateUI()"); },
    get download() { return lastDownload; }
  };
}

test("all UI copy is English, cards are separate, and same-item colors are grey", () => {
  const ui = createHarness();
  assert.equal(/[\u3400-\u9fff]/.test(ui.html), false);
  assert.ok(ui.html.includes('id="suggestionCard"'));
  const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(css.includes(".same-key{background:#b7c3ca}"));
  assert.equal((css.match(/:root\{/g) || []).length, 1);
  assert.ok(css.includes("grid-template-columns:minmax(0,1fr);min-width:0"));
  assert.ok(css.includes(".roll-wrap{width:100%;min-width:0;max-width:100%"));
});
test("generated note edits update both feedback panels and append undo/redo history", async () => {
  const ui = createHarness(); await ui.generate(); ui.setSelected();
  assert.equal(ui.elements.get("similarityScore").textContent, "100%");
  const originalPitch = ui.run("editedNotes[0].pitch");
  ui.elements.get("notePitch").value = String(originalPitch === 79 ? 78 : originalPitch + 1);
  await ui.elements.get("notePitch").trigger("change");
  assert.equal(ui.elements.get("similarityScore").textContent, "88%");
  assert.ok(ui.elements.get("feedbackExplanation").textContent.includes("1 changed"));
  const count = ui.run("changeLog.length");
  await ui.elements.get("undoBtn").trigger("click");
  assert.equal(ui.elements.get("similarityScore").textContent, "100%");
  assert.ok(ui.run("changeLog.length") > count);
  await ui.elements.get("redoBtn").trigger("click");
  assert.equal(ui.elements.get("similarityScore").textContent, "88%");
  assert.equal(ui.run("changeLog.some(entry=>entry.action==='Redo · Note '+editedNotes[0].id)"), true);
});
test("clicking a block without dragging does not create a fake edit record", async () => {
  const ui = createHarness(); await ui.generate();
  const point = ui.run("({clientX:geometry().left+4,clientY:geometry().top+(geometry().high-editedNotes[0].pitch)*geometry().rowH+3,pointerId:1})");
  const count = ui.run("changeLog.length");
  await ui.elements.get("trackCanvas").trigger("pointerdown", point);
  await ui.elements.get("trackCanvas").trigger("pointerup", point);
  assert.equal(ui.run("changeLog.length"), count);
});
test("imported samples expose the same pitch, length, duplicate, delete and add controls", async () => {
  const ui = createHarness(); await ui.import(); ui.setSelected();
  assert.equal(ui.elements.get("suggestBtn").disabled, false);
  assert.equal(ui.elements.get("duplicateNoteBtn").disabled, false);
  assert.equal(ui.elements.get("notePitch").disabled, false);
  ui.elements.get("notePitch").value = "72"; await ui.elements.get("notePitch").trigger("change");
  assert.equal(ui.elements.get("similarityScore").textContent, "94%");
  assert.equal(ui.run("editedBuffer.duration"), 2);
  assert.ok(ui.run("editedBuffer.getChannelData(0).some((v,i)=>Math.abs(v-originalBuffer.getChannelData(0)[i])>0.1)"));
  await ui.elements.get("duplicateNoteBtn").trigger("click"); assert.equal(ui.run("editedNotes.length"), 17);
  await ui.elements.get("deleteNoteBtn").trigger("click"); assert.equal(ui.run("editedNotes.length"), 16);
  await ui.elements.get("addNoteBtn").trigger("click"); assert.equal(ui.run("editedNotes.length"), 17);
  ui.elements.get("noteLength").value = "0.5"; await ui.elements.get("noteLength").trigger("change");
  assert.equal(ui.run("editedNotes.find(n=>n.id===selectedNoteId).length"), 0.5);
  assert.ok(ui.elements.get("feedbackExplanation").textContent.includes("no absolute melody pitches"));
});
test("every suggestion change and its undo are retained as individual local-history records", async () => {
  const ui = createHarness(); await ui.import();
  ui.elements.get("suggestionDirection").value = "higher"; await ui.elements.get("suggestBtn").trigger("click");
  assert.equal(ui.run("changeLog.filter(entry=>entry.action.startsWith('Suggestion · higher · Slice')).length"), 16);
  assert.equal(ui.elements.get("similarityScore").textContent, "0%");
  await ui.elements.get("undoBtn").trigger("click");
  assert.equal(ui.run("changeLog.filter(entry=>entry.action.startsWith('Suggestion · higher · Slice')).length"), 16);
  assert.equal(ui.run("changeLog.filter(entry=>entry.action.startsWith('Undo · Slice')).length"), 16);
  assert.equal(ui.elements.get("similarityScore").textContent, "100%");
});
test("accept, reject and reset preserve the original and keep the complete history", async () => {
  const ui = createHarness(); await ui.import(); ui.setSelected();
  ui.elements.get("notePitch").value = "62"; await ui.elements.get("notePitch").trigger("change");
  await ui.elements.get("acceptBtn").trigger("click");
  assert.equal(ui.elements.get("similarityScore").textContent, "94%");
  const accepted = ui.run("editedNotes[0].pitch");
  ui.elements.get("notePitch").value = "64"; await ui.elements.get("notePitch").trigger("change");
  await ui.elements.get("rejectBtn").trigger("click"); assert.equal(ui.run("editedNotes[0].pitch"), accepted);
  await ui.elements.get("resetBtn").trigger("click"); assert.equal(ui.elements.get("similarityScore").textContent, "100%");
  assert.equal(ui.run("originalNotes[0].pitch"), 60);
  assert.ok(ui.run("changeLog.some(entry=>entry.action==='Accept revision')"));
  assert.ok(ui.run("changeLog.some(entry=>entry.action.startsWith('Reject revision'))"));
});
test("Shift-drag range editing on slices and WAV export contain actual processed samples", async () => {
  const ui = createHarness(); await ui.import();
  const start = ui.run("({clientX:geometry().rect.left+geometry().left+0.25/Engine.beatSeconds(settings)*geometry().beatW,clientY:130,shiftKey:true,pointerId:3})");
  const end = ui.run("({clientX:geometry().rect.left+geometry().left+1.25/Engine.beatSeconds(settings)*geometry().beatW,clientY:130,shiftKey:true,pointerId:3})");
  await ui.elements.get("trackCanvas").trigger("pointerdown", start);
  await ui.elements.get("trackCanvas").trigger("pointermove", end);
  await ui.elements.get("trackCanvas").trigger("pointerup", end);
  assert.equal(ui.elements.get("keepSelectionBtn").disabled, false);
  await ui.elements.get("keepSelectionBtn").trigger("click");
  assert.equal(ui.run("editedBuffer.duration"), 1);
  assert.equal(ui.run("originalBuffer.duration"), 2);
  await ui.elements.get("downloadBtn").trigger("click");
  const bytes = await ui.download.blob.arrayBuffer(), header = new DataView(bytes);
  assert.equal(header.getUint32(40, true), 8000 * 2);
  assert.equal(String.fromCharCode(...new Uint8Array(bytes, 8, 4)), "WAVE");
  assert.equal(ui.download.filename, "fixture-edited.wav");
});
test("volume changes can return from silence and effects are logged", async () => {
  const ui = createHarness(); await ui.import();
  ui.elements.get("volumeControl").value = "0"; await ui.elements.get("volumeControl").trigger("change");
  assert.ok(ui.run("editedBuffer.getChannelData(0).every(v=>v===0)"));
  ui.elements.get("volumeControl").value = "100"; await ui.elements.get("volumeControl").trigger("change");
  assert.ok(ui.run("editedBuffer.getChannelData(0).some(v=>Math.abs(v)>0.3)"));
  await ui.elements.get("fadeInBtn").trigger("click");
  assert.ok(ui.elements.get("feedbackExplanation").textContent.includes("fade in"));
  assert.ok(ui.run("changeLog.some(entry=>entry.action==='Toggle fade in')"));
});

test("dragging an imported slice changes relative pitch, time, audio and local history", async () => {
  const ui = createHarness(); await ui.import();
  const point = ui.run("({clientX:geometry().left+5,clientY:geometry().top+(geometry().high-editedNotes[0].pitch)*geometry().rowH+3,pointerId:2})");
  const moved = ui.run("({clientX:geometry().left+5+geometry().beatW*0.5,clientY:geometry().top+(geometry().high-editedNotes[0].pitch)*geometry().rowH+3-geometry().rowH*3,pointerId:2})");
  await ui.elements.get("trackCanvas").trigger("pointerdown", point);
  await ui.elements.get("trackCanvas").trigger("pointermove", moved);
  await ui.elements.get("trackCanvas").trigger("pointerup", moved);
  assert.equal(ui.run("editedNotes[0].pitch"), 63);
  assert.ok(ui.run("editedNotes[0].start") > 0);
  assert.equal(ui.elements.get("similarityScore").textContent, "94%");
  assert.ok(ui.run("editedBuffer.getChannelData(0).subarray(0,1000).every(v=>v===0)"));
  assert.ok(ui.run("changeLog.some(entry=>entry.action.startsWith('Drag slice')&&entry.detail.includes('pitch')&&entry.detail.includes('start'))"));
});

test("long imports stay within the page and the view slider reaches later fine slices", async () => {
  const ui = createHarness(); await ui.import(184);
  assert.equal(ui.html.includes('id="waveformViewBtn"'), false);
  assert.equal(ui.run("editedNotes.length"), 368);
  assert.equal(ui.elements.get("trackCanvas").style.width, "100%");
  assert.ok(ui.elements.get("trackCanvas").getBoundingClientRect().width <= ui.elements.get("rollWrap").getBoundingClientRect().width);
  assert.ok(ui.elements.get("trackCanvas").width <= 1600);
  assert.ok(ui.elements.get("sliceInfo").textContent.includes("0.50s each"));
  const targetId = ui.run("editedNotes[300].id");
  ui.elements.get("trackPan").value = ui.run("Math.round((editedNotes[300].start-geometry().visibleBeats*0.25)/geometry().maxOffset*1000)");
  await ui.elements.get("trackPan").trigger("input");
  const point = ui.run("(()=>{const g=geometry(),n=editedNotes[300];return {clientX:g.rect.left+g.left+(n.start-g.offset)*g.beatW+5,clientY:g.top+(g.high-n.pitch)*g.rowH+3,pointerId:4};})()");
  await ui.elements.get("trackCanvas").trigger("pointerdown", point);
  await ui.elements.get("trackCanvas").trigger("pointerup", point);
  assert.equal(ui.run("selectedNoteId"), targetId);
  ui.elements.get("trackPan").value = 0; await ui.elements.get("trackPan").trigger("input");
  await ui.elements.get("playEditedBtn").trigger("click");
  ui.elements.get("audioPlayer").currentTime = 150; ui.elements.get("audioPlayer").duration = 184;
  await ui.elements.get("audioPlayer").trigger("timeupdate");
  assert.ok(ui.run("trackOffsetBeats") > 0);
});
test("left/right buttons and draggable view slider move only the view and respect both ends", async () => {
  const ui = createHarness(); await ui.import(30);
  const audio = ui.run("editedBuffer"), notes = ui.run("JSON.stringify(editedNotes)"), history = ui.run("changeLog.length");
  assert.equal(ui.elements.get("panLeftBtn").disabled, true);
  assert.equal(ui.elements.get("panRightBtn").disabled, false);
  await ui.elements.get("panRightBtn").trigger("click");
  assert.ok(ui.run("trackOffsetBeats") > 0);
  assert.equal(ui.elements.get("panLeftBtn").disabled, false);
  ui.elements.get("trackPan").value = "1000"; await ui.elements.get("trackPan").trigger("input");
  assert.equal(ui.run("trackOffsetBeats"), ui.run("geometry().maxOffset"));
  assert.equal(ui.elements.get("panRightBtn").disabled, true);
  const endOffset = ui.run("trackOffsetBeats");
  ui.elements.get("audioPlayer").currentTime = 1; await ui.elements.get("audioPlayer").trigger("timeupdate");
  assert.equal(ui.run("trackOffsetBeats"), endOffset, "Manual navigation should not snap back to playback.");
  await ui.elements.get("panLeftBtn").trigger("click"); assert.ok(ui.run("trackOffsetBeats") < endOffset);
  ui.elements.get("trackPan").value = "0"; await ui.elements.get("trackPan").trigger("input");
  assert.equal(ui.run("trackOffsetBeats"), 0); assert.equal(ui.elements.get("panLeftBtn").disabled, true);
  assert.equal(ui.run("editedBuffer"), audio); assert.equal(ui.run("JSON.stringify(editedNotes)"), notes);
  assert.equal(ui.run("changeLog.length"), history);
});
test("generated melodies also stay viewport-sized and can navigate after extending the arrangement", async () => {
  const ui = createHarness(); await ui.generate();
  assert.equal(ui.elements.get("trackCanvas").style.width, "100%");
  assert.equal(ui.elements.get("panRightBtn").disabled, true);
  await ui.elements.get("addNoteBtn").trigger("click");
  assert.equal(ui.elements.get("trackCanvas").getBoundingClientRect().width, 800);
  assert.equal(ui.elements.get("panRightBtn").disabled, false);
  await ui.elements.get("panRightBtn").trigger("click");
  assert.ok(ui.run("trackOffsetBeats") > 0);
  assert.equal(ui.elements.get("panRightBtn").disabled, true);
  assert.ok(ui.elements.get("viewRange").textContent.includes("–"));
});
