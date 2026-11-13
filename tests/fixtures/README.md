# Manual listening fixtures

The files here are synthetic repeatable signals, not user recordings or extracted melodies:

- tone-440hz-4s.wav: four seconds, mono 16 kHz PCM16, 440 Hz sine with a 40 ms attack/release.
- two-tone-chord-4s.wav: same format/duration, with 440 Hz and about 554.365 Hz tones.

## Browser check

1. Open the page in Windows Chrome or Edge and import the single-tone WAV. The picker should show only **Original**. Play and pause it, and check the Console for errors.
2. Drag a curve point upward near one second. The picker should now show **Version 1 (unsaved)**. Play it and compare with Original; the grey original curve/audio should stay fixed. Note any clicks or warbling.
3. Click **Add version**. The picker should show **Original** and **Version 1**, without an extra unsaved entry. Change another point or Volume/Speed, then save **Version 2**. Listen to both independently.
4. Select roughly 1–2 seconds by dragging an empty graph area or using Shift + drag. Play each numbered version's segment, then **Listen in order**. Pause or Stop should cancel the sequence.
5. Check each percentage against Original. It reports edit-parameter agreement, not detected musical similarity.
6. Download Original, Version 1 and Version 2 as WAV. Play them outside the webpage and compare actual sound, volume, speed and duration.
7. Select Version 1 and use **Restore as new version**. Version 3 should contain its state while Versions 1/2 remain. Check Undo/Redo and every download button.
8. Repeat with the two-tone fixture and a real MP3. Listen near edited points and on a longer file. Note lag, artifacts, distorted transients or console errors.

Record browser version, file, audio device, adjustment, date and observed result. These are manual steps, not claimed completed listening results.
