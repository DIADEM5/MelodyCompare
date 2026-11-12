"use strict";

/* Dependency-free sample and melody renderer. Imported items are audio slices:
   pitch=60 means an unchanged sample, not a detected C4. */
(function (root) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const beatSeconds = settings => 60 / settings.tempo / settings.speed;
  const startSeconds = (note, settings) => note.start * beatSeconds(settings);
  const lengthSeconds = (note, settings) => note.length * beatSeconds(settings);
  const close = (a, b) => Math.abs(a - b) <= 0.002;
  const sameItem = (a, b, aSettings, bSettings) => Boolean(a && b &&
    a.pitch === b.pitch && close(startSeconds(a, aSettings), startSeconds(b, bSettings)) &&
    close(lengthSeconds(a, aSettings), lengthSeconds(b, bSettings)) &&
    (a.sampleStart === undefined || (close(a.sampleStart, b.sampleStart) && close(a.sampleEnd, b.sampleEnd))));

  function compare(reference, revision, referenceSettings, revisionSettings) {
    const ref = new Map(reference.map(n => [n.id, n]));
    const edit = new Map(revision.map(n => [n.id, n]));
    const ids = new Set([...ref.keys(), ...edit.keys()]);
    let matches = 0;
    for (const id of ids) if (sameItem(ref.get(id), edit.get(id), referenceSettings, revisionSettings)) matches++;
    return { matches, total: ids.size, score: ids.size ? Math.round(matches / ids.size * 100) : 100,
      added: revision.filter(n => !ref.has(n.id)).length,
      removed: reference.filter(n => !edit.has(n.id)).length,
      changed: reference.filter(n => edit.has(n.id) && !sameItem(n, edit.get(n.id), referenceSettings, revisionSettings)).length };
  }

  function sliceCount(duration) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Audio duration must be positive.");
    // Target half-second slices, with finer division for short recordings.
    const target = Math.max(16, Math.ceil(duration / 0.5));
    const shortClipLimit = Math.max(1, Math.floor(duration / 0.025));
    return Math.min(target, shortClipLimit);
  }

  function splitSource(duration, tempo, nextId, count = sliceCount(duration)) {
    const beat = 60 / tempo;
    return Array.from({ length: count }, (_, index) => {
      const from = duration * index / count, to = duration * (index + 1) / count;
      return { id: nextId(), pitch: 60, start: from / beat, length: (to - from) / beat,
        sampleStart: from, sampleEnd: to };
    });
  }

  function cropPart(note, from, to, settings) {
    const sourceStart = startSeconds(note, settings), sourceLength = lengthSeconds(note, settings);
    const result = { ...note, start: from / beatSeconds(settings), length: (to - from) / beatSeconds(settings) };
    if (note.sampleStart !== undefined) {
      const span = note.sampleEnd - note.sampleStart;
      result.sampleStart = note.sampleStart + (from - sourceStart) / sourceLength * span;
      result.sampleEnd = note.sampleStart + (to - sourceStart) / sourceLength * span;
    }
    return result;
  }
  function editRange(notes, range, keep, settings, nextId) {
    const result = [], removedTime = range.end - range.start, beat = beatSeconds(settings);
    for (const note of notes) {
      const from = startSeconds(note, settings), to = from + lengthSeconds(note, settings);
      if (keep) {
        const lo = Math.max(from, range.start), hi = Math.min(to, range.end);
        if (hi > lo + 0.0001) { const part = cropPart(note, lo, hi, settings); part.start -= range.start / beat; result.push(part); }
      } else if (to <= range.start) result.push({ ...note });
      else if (from >= range.end) result.push({ ...note, start: note.start - removedTime / beat });
      else {
        let left = false;
        if (from < range.start) { result.push(cropPart(note, from, range.start, settings)); left = true; }
        if (to > range.end) {
          const part = cropPart(note, range.end, to, settings);
          part.start -= removedTime / beat;
          if (left) part.id = nextId();
          result.push(part);
        }
      }
    }
    return result;
  }

  const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
  function abortIfNeeded(options) {
    if (options.cancelled?.()) { const error = new Error("Rendering superseded"); error.name = "AbortError"; throw error; }
  }
  function sampleAt(data, position, from, to) {
    if (position < from || position >= to) return 0;
    const index = Math.floor(position), fraction = position - index;
    return data[index] * (1 - fraction) + data[Math.min(to - 1, index + 1)] * fraction;
  }

  async function render(notes, source, settings, options = {}) {
    const sampleRate = source?.sampleRate || 44100;
    const channelCount = source?.channels.length || 2;
    const beat = beatSeconds(settings);
    const duration = Math.max(0.1, ...notes.map(n => (n.start + n.length) * beat));
    if (duration > 600) throw new Error("The edited version is longer than 10 minutes. Shorten it before rendering.");
    const frames = Math.max(1, Math.round(duration * sampleRate));
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      abortIfNeeded(options);
      const note = notes[noteIndex], start = Math.round(note.start * beat * sampleRate);
      const length = Math.min(Math.round((note.start + note.length) * beat * sampleRate) - start, frames - start);
      if (length <= 0) continue;
      if (!source) {
        const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
        for (let i = 0; i < length; i++) {
          const t = i / sampleRate, phase = t * frequency;
          const triangle = 2 / Math.PI * Math.asin(Math.sin(2 * Math.PI * phase));
          const attack = Math.min(1, t / 0.012), release = Math.min(1, (length - i) / (sampleRate * 0.055));
          const envelope = attack * release * (0.45 + 0.55 * Math.exp(-t * 6));
          const value = 0.2 * envelope * (triangle + 0.16 * Math.sin(4 * Math.PI * phase));
          for (const output of channels) output[start + i] += value;
        }
      } else {
        const from = clamp(Math.round(note.sampleStart * sampleRate), 0, source.channels[0].length - 1);
        const to = clamp(Math.round(note.sampleEnd * sampleRate), from + 1, source.channels[0].length);
        const sourceLength = to - from, ratio = 2 ** ((note.pitch - 60) / 12) * settings.speed;
        const naturalRatio = sourceLength / length;
        if (Math.abs(ratio - naturalRatio) < 0.001) {
          // Unchanged slices copy their real samples; speed-only edits resample them.
          for (let c = 0; c < channelCount; c++) {
            const input = source.channels[c], output = channels[c];
            for (let i = 0; i < length; i++) output[start + i] += sampleAt(input, from + i * naturalRatio, from, to);
          }
        } else {
          // Overlapping Hann-window grains allow relative pitch and target length
          // to be edited independently. This basic sampler can produce artifacts.
          const grain = Math.min(2048, Math.max(64, 2 ** Math.floor(Math.log2(Math.max(64, sourceLength)))));
          const half = grain / 2, hop = grain / 4;
          const window = Float32Array.from({ length: grain }, (_, k) => 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (grain - 1)));
          const weights = new Float32Array(length);
          const slices = Array.from({ length: channelCount }, () => new Float32Array(length));
          for (let center = 0; center < length + half; center += hop) {
            const sourceCenter = from + center / length * sourceLength;
            for (let k = 0; k < grain; k++) {
              const position = center + k - half;
              if (position < 0 || position >= length) continue;
              const at = sourceCenter + (k - half) * ratio;
              if (at < from || at >= to) continue;
              const weight = window[k];
              weights[position] += weight;
              for (let c = 0; c < channelCount; c++) slices[c][position] += sampleAt(source.channels[c], at, from, to) * weight;
            }
            if (center % (hop * 64) === 0) { await yieldTask(); abortIfNeeded(options); }
          }
          for (let c = 0; c < channelCount; c++) for (let i = 0; i < length; i++) {
            const edge = Math.min(1, i / (sampleRate * 0.005), (length - i) / (sampleRate * 0.005));
            channels[c][start + i] += (weights[i] > 0.00001 ? slices[c][i] / weights[i] : 0) * edge;
          }
        }
      }
      options.progress?.((noteIndex + 1) / notes.length);
      if (noteIndex % 16 === 15 || noteIndex === notes.length - 1) await yieldTask();
    }
    abortIfNeeded(options);
    const volume = settings.volume / 100;
    for (const data of channels) for (let i = 0; i < data.length; i++) {
      let envelope = 1;
      if (settings.fadeIn) envelope *= Math.min(1, i / Math.min(data.length, 2 * sampleRate));
      if (settings.fadeOut) envelope *= Math.min(1, (data.length - 1 - i) / Math.min(data.length, 2 * sampleRate));
      data[i] = clamp(data[i] * volume * envelope, -1, 1);
    }
    return { sampleRate, channels, duration: frames / sampleRate };
  }

  // Shared interpolation: this is a relative pitch-control envelope, not pitch detection.
  function curveValue(points, time) {
    if (!points.length) return 0;
    if (time <= points[0].time) return points[0].value;
    if (time >= points.at(-1).time) return points.at(-1).value;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].time <= time) lo = mid; else hi = mid; }
    const a = points[lo], b = points[hi], u = (time - a.time) / (b.time - a.time), smooth = u * u * (3 - 2 * u);
    return a.value + (b.value - a.value) * smooth;
  }


  // Align overlapping grains to the existing signal to reduce phase cancellation.
  // This bounded waveform correlation is a basic time-domain aid, not a spectral model.
  function grainOffset(base, output, weights, center, half, hop, ratio, sourceCenter, sampleRate) {
    if (center === 0) return 0;
    const from = Math.max(0, center - half + hop), to = Math.min(output.length - 1, center + half - hop);
    if (to <= from) return 0;
    const probes = [];
    for (let q = 0; q < 32; q++) {
      const at = Math.min(to, Math.round(from + (to - from) * q / 32) + q % 3);
      if (weights[at] > 0.01) probes.push({ delta: at - center, value: output[at] / weights[at] });
    }
    if (probes.length < 12) return 0;
    const radius = Math.min(Math.round(sampleRate * 0.015), Math.floor(half * 0.75)), step = Math.max(2, Math.round(sampleRate / 4000));
    function score(offset) {
      let dot = 0, a = 0, b = 0, count = 0;
      for (const probe of probes) {
        const at = sourceCenter + offset + probe.delta * ratio;
        if (at < 0 || at >= base.length) continue;
        const value = sampleAt(base, at, 0, base.length); dot += value * probe.value; a += value * value; b += probe.value * probe.value; count++;
      }
      return count >= 12 && a * b > 1e-12 ? dot / Math.sqrt(a * b) : -2;
    }
    let best = 0, strongest = score(0);
    function tryOffset(offset) { const candidate = score(offset); if (candidate > strongest + 1e-6 || Math.abs(candidate - strongest) <= 1e-6 && Math.abs(offset) < Math.abs(best)) { best = offset; strongest = candidate; } }
    for (let offset = -radius; offset <= radius; offset += step) tryOffset(offset);
    const coarse = best;
    for (let offset = Math.max(-radius, coarse - step); offset <= Math.min(radius, coarse + step); offset++) tryOffset(offset);
    return best;
  }

  async function renderCurve(source, state, options = {}) {
    abortIfNeeded(options);
    const { segments, points, settings } = state;
    const sampleRate = source.sampleRate, count = source.channels.length, speed = settings.speed;
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 1.5 || !Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 150)
      throw new Error("Invalid speed or volume.");
    if (!segments.length || points.some((p, i) => !Number.isFinite(p.time) || !Number.isFinite(p.value) || Math.abs(p.value) > 12 || i && p.time <= points[i - 1].time))
      throw new Error("Invalid pitch curve or source ranges.");
    const cuts = segments.map(s => ({ from: Math.round(s.sourceStart * sampleRate), to: Math.round(s.sourceEnd * sampleRate) }));
    if (cuts.some(s => s.from < 0 || s.to > source.channels[0].length || s.to <= s.from)) throw new Error("Invalid source range.");
    const baseFrames = cuts.reduce((sum, s) => sum + s.to - s.from, 0), frames = Math.max(1, Math.round(baseFrames / speed));
    if (frames / sampleRate > 600) throw new Error("The edited version is longer than 10 minutes.");
    const base = Array.from({ length: count }, () => new Float32Array(baseFrames));
    let offset = 0;
    for (let index = 0; index < cuts.length; index++) {
      const cut = cuts[index];
      for (let c = 0; c < count; c++) base[c].set(source.channels[c].subarray(cut.from, cut.to), offset);
      offset += cut.to - cut.from;
    }
    // A centered 20 ms splice crossfade preserves the output timeline length.
    // It may use up to 10 ms of source context immediately outside a cut.
    offset = 0;
    for (let index = 1; index < cuts.length; index++) {
      const previous = cuts[index - 1], next = cuts[index]; offset += previous.to - previous.from;
      if (Math.abs(previous.to - next.from) <= 1) continue;
      const half = Math.min(Math.round(sampleRate * 0.01), Math.floor((previous.to - previous.from) / 4), Math.floor((next.to - next.from) / 4));
      for (let k = -half; k < half; k++) {
        const u = (k + half) / Math.max(1, 2 * half - 1), mix = u * u * (3 - 2 * u);
        for (let c = 0; c < count; c++) {
          const data = source.channels[c];
          const left = sampleAt(data, clamp(previous.to + k, 0, data.length - 1), 0, data.length);
          const right = sampleAt(data, clamp(next.from + k, 0, data.length - 1), 0, data.length);
          base[c][offset + k] = left * (1 - mix) + right * mix;
        }
      }
    }
    const channels = Array.from({ length: count }, () => new Float32Array(frames));
    const active = points.some(p => Math.abs(p.value) > 0.000001);
    if (!active) {
      for (let c = 0; c < count; c++) for (let i = 0; i < frames; i++) {
        channels[c][i] = sampleAt(base[c], i * speed, 0, baseFrames);
        if ((i & 32767) === 32767) { await yieldTask(); abortIfNeeded(options); }
      }
    } else {
      // One continuous overlap-add stream for the entire arrangement. No grain,
      // envelope or phase is restarted at a control point or old slice boundary.
      const grain = Math.min(2048, Math.max(128, 2 ** Math.round(Math.log2(sampleRate * 0.046))));
      const half = grain / 2, hop = grain / 4, weights = new Float32Array(frames);
      const window = Float32Array.from({ length: grain }, (_, k) => 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (grain - 1)));
      let guide = 0, guideEnergy = -1;
      for (let c = 0; c < count; c++) { let energy = 0; for (let i = 0; i < baseFrames; i += Math.max(1, Math.floor(baseFrames / 256))) energy += base[c][i] ** 2; if (energy > guideEnergy) { guide = c; guideEnergy = energy; } }
      // Only control intervals with a nonzero adjustment need granular rendering.
      // Zero intervals copy the source directly, even when another point is edited.
      const activeRanges = [];
      function addRange(start, end) {
        start = Math.max(0, Math.floor(start)); end = Math.min(frames, Math.ceil(end));
        if (end <= start) return;
        const previous = activeRanges.at(-1);
        if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
        else activeRanges.push({ start, end });
      }
      if (Math.abs(points[0].value) > 0.000001) addRange(0, points[0].time / speed * sampleRate);
      for (let i = 1; i < points.length; i++) {
        if (Math.abs(points[i - 1].value) > 0.000001 || Math.abs(points[i].value) > 0.000001)
          addRange(points[i - 1].time / speed * sampleRate, points[i].time / speed * sampleRate);
      }
      if (Math.abs(points.at(-1).value) > 0.000001) addRange(points.at(-1).time / speed * sampleRate, frames);
      const grainRanges = [];
      for (const range of activeRanges) {
        const first = Math.max(0, Math.floor((range.start - half) / hop) * hop);
        const last = Math.min(frames + half, Math.ceil((range.end + half) / hop) * hop);
        const previous = grainRanges.at(-1);
        if (previous && first <= previous.end + hop) previous.end = Math.max(previous.end, last);
        else grainRanges.push({ start: first, end: last });
      }
      const totalGrains = grainRanges.reduce((sum, range) => sum + Math.floor((range.end - range.start) / hop) + 1, 0);
      let iteration = 0;
      for (const range of grainRanges) for (let center = range.start; center <= range.end; center += hop) {
        const ratio = speed * 2 ** (curveValue(points, center * speed / sampleRate) / 12);
        const sourceCenter = center * speed + grainOffset(base[guide], channels[guide], weights, center, half, hop, ratio, center * speed, sampleRate);
        for (let k = 0; k < grain; k++) {
          const target = center + k - half, at = sourceCenter + (k - half) * ratio;
          if (target < 0 || target >= frames || at < 0 || at >= baseFrames) continue;
          const weight = window[k]; weights[target] += weight;
          for (let c = 0; c < count; c++) channels[c][target] += sampleAt(base[c], at, 0, baseFrames) * weight;
        }
        if (++iteration % 32 === 0) { options.progress?.(Math.min(1, iteration / totalGrains)); await yieldTask(); abortIfNeeded(options); }
      }
      let interval = 0;
      for (let i = 0; i < frames; i++) {
        while (interval < activeRanges.length && i >= activeRanges[interval].end) interval++;
        const adjusted = interval < activeRanges.length && i >= activeRanges[interval].start;
        const amount = adjusted ? Math.min(1, Math.abs(curveValue(points, i * speed / sampleRate)) / 0.25) : 0;
        const wet = amount * amount * (3 - 2 * amount);
        for (let c = 0; c < count; c++) {
          const dry = sampleAt(base[c], i * speed, 0, baseFrames);
          const shifted = weights[i] > 0.000001 ? channels[c][i] / weights[i] : dry;
          channels[c][i] = shifted * wet + dry * (1 - wet);
        }
        if ((i & 32767) === 32767) { await yieldTask(); abortIfNeeded(options); }
      }
    }
    abortIfNeeded(options);
    for (const data of channels) for (let i = 0; i < frames; i++) {
      let gain = settings.volume / 100;
      if (settings.fadeIn) gain *= Math.min(1, i / Math.min(frames, 2 * sampleRate));
      if (settings.fadeOut) gain *= Math.min(1, (frames - 1 - i) / Math.min(frames, 2 * sampleRate));
      data[i] = clamp(data[i] * gain, -1, 1);
      if ((i & 32767) === 32767) { await yieldTask(); abortIfNeeded(options); }
    }
    options.progress?.(1);
    return { sampleRate, channels, duration: frames / sampleRate };
  }

  root.MelodyAudio = { clamp, beatSeconds, startSeconds, lengthSeconds, sameItem, compare, sliceCount, splitSource, editRange, render, curveValue, renderCurve };
})(globalThis);
