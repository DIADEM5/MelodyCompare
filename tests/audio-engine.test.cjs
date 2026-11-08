"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { setTimeout, Float32Array };
vm.createContext(sandbox);
new vm.Script(fs.readFileSync(path.join(__dirname, "..", "audio-engine.js"), "utf8")).runInContext(sandbox);
const Engine = sandbox.MelodyAudio;
const controls = { tempo: 96, speed: 1, volume: 100, fadeIn: false, fadeOut: false };
function fixture(frames = 16000, sampleRate = 16000) {
  return { sampleRate, channels: [Float32Array.from({ length: frames }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / sampleRate))] };
}
function notesFor(duration, count = 8) { let id = 0; return Engine.splitSource(duration, controls.tempo, () => ++id, count); }
function maxDifference(a, b) { let result = 0; for (let i = 0; i < a.length; i++) result = Math.max(result, Math.abs(a[i] - b[i])); return result; }
function energyAt(data, frequency, sampleRate) {
  let real = 0, imag = 0;
  for (let i = Math.round(data.length * 0.1); i < Math.round(data.length * 0.9); i++) {
    real += data[i] * Math.cos(2 * Math.PI * frequency * i / sampleRate);
    imag += data[i] * Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }
  return Math.hypot(real, imag);
}
test("unmodified imported slices preserve every sample in mono and stereo", async () => {
  const source = fixture(16001);
  source.channels.push(Float32Array.from(source.channels[0], value => -value));
  const rendered = await Engine.render(notesFor(16001 / 16000), source, controls);
  assert.equal(rendered.channels[0].length, 16001);
  assert.equal(maxDifference(rendered.channels[0], source.channels[0]), 0);
  assert.equal(maxDifference(rendered.channels[1], source.channels[1]), 0);
});
test("relative octave transpose changes real sample pitch while retaining target duration", async () => {
  const source = fixture(), notes = notesFor(1, 1); notes[0].pitch = 72;
  const rendered = await Engine.render(notes, source, controls);
  assert.equal(rendered.channels[0].length, 16000);
  let bestFrequency = 0, strength = 0;
  for (let frequency = 840; frequency <= 920; frequency++) {
    const candidate = energyAt(rendered.channels[0], frequency, source.sampleRate);
    if (candidate > strength) { strength = candidate; bestFrequency = frequency; }
  }
  assert.ok(Math.abs(bestFrequency - 880) < 8, "Expected an approximate octave shift, got " + bestFrequency);
  assert.ok(strength > energyAt(rendered.channels[0], 440, source.sampleRate) * 20);
});
test("length edits change sample duration without replacing the recording with a synth", async () => {
  const source = fixture(), notes = notesFor(1, 1); notes[0].length *= 1.5;
  const rendered = await Engine.render(notes, source, controls);
  assert.equal(rendered.channels[0].length, 24000);
  assert.ok(rendered.channels[0].some(value => Math.abs(value) > 0.2));
});
test("moving and deleting slices change the correct time regions", async () => {
  const source = fixture(), notes = notesFor(1, 2);
  notes[0].start += 0.25 / Engine.beatSeconds(controls);
  const rendered = await Engine.render(notes, source, controls);
  assert.ok(rendered.channels[0].subarray(0, 3999).every(value => value === 0));
  const deleted = await Engine.render([notesFor(1, 2)[1]], source, controls);
  assert.ok(deleted.channels[0].subarray(0, 7999).every(value => value === 0));
});
test("keep range trims actual source boundaries and shifts the kept samples to zero", async () => {
  const source = fixture(), notes = notesFor(1); let id = 8;
  const trimmed = Engine.editRange(notes, { start: 0.2, end: 0.7 }, true, controls, () => ++id);
  const rendered = await Engine.render(trimmed, source, controls);
  assert.equal(rendered.channels[0].length, 8000);
  assert.ok(maxDifference(rendered.channels[0], source.channels[0].subarray(3200, 11200)) < 0.00001);
});
test("remove range joins retained source audio in the exported arrangement", async () => {
  const source = fixture(), notes = notesFor(1); let id = 8;
  const trimmed = Engine.editRange(notes, { start: 0.2, end: 0.5 }, false, controls, () => ++id);
  const rendered = await Engine.render(trimmed, source, controls);
  assert.equal(rendered.channels[0].length, 11200);
  assert.ok(maxDifference(rendered.channels[0].subarray(0, 3200), source.channels[0].subarray(0, 3200)) < 0.00001);
  assert.ok(maxDifference(rendered.channels[0].subarray(3200), source.channels[0].subarray(8000)) < 0.00001);
});
test("volume zero can be reversed and fades reach zero at the endpoints", async () => {
  const source = fixture(), notes = notesFor(1);
  const mute = await Engine.render(notes, source, { ...controls, volume: 0 });
  assert.ok(mute.channels[0].every(value => value === 0));
  const restored = await Engine.render(notes, source, controls);
  assert.equal(maxDifference(restored.channels[0], source.channels[0]), 0);
  const faded = await Engine.render(notes, source, { ...controls, fadeIn: true, fadeOut: true });
  assert.equal(faded.channels[0][0], 0);
  assert.equal(Math.abs(faded.channels[0].at(-1)), 0);
});
test("speed affects actual audio duration and comparison timing", async () => {
  const source = fixture(), notes = notesFor(1);
  const fast = await Engine.render(notes, source, { ...controls, speed: 1.25 });
  assert.equal(fast.channels[0].length, 12800);
  assert.equal(Engine.compare(notes, notes, controls, { ...controls, speed: 1.25 }).score, 0);
});
test("similarity counts pitch, timing, length, added and removed items transparently", () => {
  const reference = notesFor(1);
  assert.equal(Engine.compare(reference, reference, controls, controls).score, 100);
  const changed = reference.map(note => ({ ...note })); changed[0].pitch++;
  assert.equal(Engine.compare(reference, changed, controls, controls).score, 88);
  changed[0].pitch--; changed[0].start += 0.25;
  assert.equal(Engine.compare(reference, changed, controls, controls).changed, 1);
  changed.shift(); changed.push({ ...reference[0], id: 99 });
  const replacement = Engine.compare(reference, changed, controls, controls);
  assert.equal(replacement.total, 9); assert.equal(replacement.matches, 7);
  assert.equal(replacement.added, 1); assert.equal(replacement.removed, 1);
});
test("cancelled renders stop and excessive arrangements produce a readable error", async () => {
  await assert.rejects(Engine.render(notesFor(1), fixture(), controls, { cancelled: () => true }), /superseded/);
  await assert.rejects(Engine.render([{ id: 1, start: 0, length: 2000, pitch: 60 }], null, controls), /longer than 10 minutes/);
});

test("default imported subdivision is finer for short clips and no longer caps long music at 16 slices", () => {
  assert.equal(Engine.sliceCount(2), 16);
  assert.equal(Engine.sliceCount(184), 368);
  assert.equal(Engine.sliceCount(300), 600);
  assert.equal(Engine.sliceCount(0.1), 4);
  let id = 0;
  const slices = Engine.splitSource(184, 96, () => ++id);
  assert.equal(slices.length, 368);
  assert.ok(slices.every(note => note.sampleEnd - note.sampleStart <= 0.500001));
  assert.equal(slices[0].sampleStart, 0);
  assert.equal(slices.at(-1).sampleEnd, 184);
});
test("finer default slices still reconstruct the original samples without gaps or overlaps", async () => {
  const source = fixture(16001); let id = 0;
  const slices = Engine.splitSource(16001 / 16000, 96, () => ++id);
  assert.equal(slices.length, 16);
  const result = await Engine.render(slices, source, controls);
  assert.equal(result.channels[0].length, 16001);
  assert.equal(maxDifference(result.channels[0], source.channels[0]), 0);
});
