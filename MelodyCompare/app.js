
"use strict";

// 1. Melody data
const START_MELODY = [60, 62, 64, 65, 67, 65, 64, 62];

let original = [...START_MELODY];

let revised = [60, 62, 64, 67, 67, 65, 62, 62];

let feedbackMode = "global";
let suggestionCount = 0;

// 2. Convert MIDI numbers to note names
const pitchNames = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B"
];

function pitchLabel(midi) {
  const name = pitchNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return name + octave;
}

// 3. Calculate similarity
function countMatches() {
  return revised.reduce((total, note, index) => {
    return total + (note === original[index] ? 1 : 0);
  }, 0);
}

// 4. Update a note
function changeNote(index, amount) {
  revised[index] = Math.max(
    48,
    Math.min(84, revised[index] + amount)
  );

  render();

  showStatus(
    "Note " + (index + 1) +
    " changed to " + pitchLabel(revised[index])
  );
}

// 5. Draw notes on the screen
function drawNotes(containerId, melody, editable) {
  const container = document.getElementById(containerId);
  container.replaceChildren();

  melody.forEach((pitch, index) => {
    const cell = document.createElement("div");
    cell.className = "note";

    if (feedbackMode === "local") {
      const matches = original[index] === revised[index];
      cell.classList.add(matches ? "matched" : "changed");
    }

    const number = document.createElement("span");
    number.className = "index";
    number.textContent = "Note " + (index + 1);

    const noteName = document.createElement("strong");
    noteName.textContent = pitchLabel(pitch);

    cell.append(number, noteName);

    if (editable) {
      const controls = document.createElement("div");
      controls.className = "note-controls";

      const downButton = document.createElement("button");
      downButton.textContent = "−";
      downButton.title = "Lower pitch by one semitone";
      downButton.addEventListener("click", () => {
        changeNote(index, -1);
      });

      const upButton = document.createElement("button");
      upButton.textContent = "+";
      upButton.title = "Raise pitch by one semitone";
      upButton.addEventListener("click", () => {
        changeNote(index, 1);
      });

      controls.append(downButton, upButton);
      cell.appendChild(controls);
    }

    container.appendChild(cell);
  });
}

// 6. Refresh the entire interface
function render() {
  drawNotes("originalNotes", original, false);
  drawNotes("revisedNotes", revised, true);

  const matches = countMatches();
  const score = Math.round(
    (matches / original.length) * 100
  );

  document.getElementById("similarityScore")
    .textContent = score + "%";

  document.getElementById("matchCount")
    .textContent = matches + " of 8 notes match";

  document.getElementById("scoreBar")
    .style.width = score + "%";

  document.getElementById("globalPanel")
    .classList.toggle(
      "hidden", feedbackMode !== "global"
    );

  document.getElementById("localPanel")
    .classList.toggle(
      "hidden", feedbackMode !== "local"
    );
}

function showStatus(message) {
  document.getElementById("status").textContent = message;
}

// 7. Switch feedback mode
document.querySelectorAll(
  'input[name="feedbackMode"]'
).forEach(input => {
  input.addEventListener("change", event => {
    feedbackMode = event.target.value;
    render();
    showStatus("Feedback mode: " + feedbackMode);
  });
});

// 8. Simulated AI suggestions
document.getElementById("suggestBtn")
  .addEventListener("click", () => {

    const patterns = [
      {3: 2, 6: -2},
      {1: 2, 4: 2, 7: -2},
      {2: -1, 5: 2}
    ];

    const pattern =
      patterns[suggestionCount % patterns.length];

    revised = original.map((pitch, index) => {
      return pitch + (pattern[index] ?? 0);
    });

    suggestionCount++;
    render();

    showStatus(
      "Simulated suggestion generated. " +
      "You may edit, accept or reject it."
    );
  });

// 9. Accept or reject a revision
document.getElementById("acceptBtn")
  .addEventListener("click", () => {
    original = [...revised];
    render();

    showStatus(
      "Revision accepted. " +
      "The revised melody is now the new original."
    );
  });

document.getElementById("rejectBtn")
  .addEventListener("click", () => {
    revised = [...original];
    render();

    showStatus(
      "Revision rejected. " +
      "The original melody has been restored."
    );
  });

// 10. Play a melody using Web Audio API
let audioContext;

async function playMelody(melody) {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    showStatus("Audio playback is not supported.");
    return;
  }

  try {
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    await audioContext.resume();

    const startTime = audioContext.currentTime + 0.05;

    melody.forEach((midi, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      const time = startTime + index * 0.32;

      oscillator.type = "sine";
      oscillator.frequency.value =
        440 * Math.pow(2, (midi - 69) / 12);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(
        0.16, time + 0.02
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001, time + 0.26
      );

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      oscillator.start(time);
      oscillator.stop(time + 0.27);
    });

  } catch (error) {
    console.error(error);
    showStatus("Could not play the melody.");
  }
}

document.getElementById("playOriginalBtn")
  .addEventListener("click", () => {
    playMelody(original);
  });

document.getElementById("playRevisedBtn")
  .addEventListener("click", () => {
    playMelody(revised);
  });

// 11. Initial page
render();
