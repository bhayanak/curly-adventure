/* audio.js — Web Audio SFX + a tiny themed music sequencer (no audio files).
 * Call Sfx.unlock() from a user gesture first.
 */
(function () {
  "use strict";

  let ctx = null;
  let master = null;
  let musicGain = null;
  let enabled = false;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.32;
    musicGain.connect(master);
    return ctx;
  }

  // One-shot tone with envelope.
  function blip({ freq = 440, type = "square", dur = 0.12, gain = 0.2, slide = 0, when = 0, dest } = {}) {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise({ dur = 0.18, gain = 0.18, when = 0 } = {}) {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime + when;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 800;
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  }

  // ---------------- Music ----------------
  // Simple looping arpeggio per theme. Notes in Hz.
  const NOTE = (semitoneFromA4) => 440 * Math.pow(2, semitoneFromA4 / 12);
  const SCALES = {
    forest: [-9, -5, -2, 0, 3, 7, 12, 7].map(NOTE),   // bright major-ish
    cave: [-12, -10, -5, -3, 0, -3, -5, -10].map(NOTE), // moodier
    underwater: [-7, -3, 0, 5, 7, 5, 0, -3].map(NOTE),  // floaty
  };
  let musicTimer = null;
  let step = 0;
  let curTheme = null;

  // Pre-recorded suspenseful loop for the deeper levels.
  let dungeon = null;
  const OGG_THEMES = { cave: true, underwater: true };
  function ensureDungeon() {
    if (dungeon) return dungeon;
    dungeon = new Audio("assets/audio/dungeon002.ogg");
    dungeon.loop = true;
    dungeon.volume = 0.55;
    dungeon.muted = muted;
    return dungeon;
  }

  function startMusic(theme) {
    if (!enabled) return;
    if (curTheme === theme && (musicTimer || (dungeon && !dungeon.paused))) return;
    stopMusic();
    curTheme = theme;

    if (OGG_THEMES[theme]) {
      const d = ensureDungeon();
      d.muted = muted;
      d.currentTime = 0;
      const p = d.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }

    if (!ctx) return;
    const scale = SCALES[theme] || SCALES.forest;
    step = 0;
    const tempo = theme === "underwater" ? 360 : 300; // ms per step
    musicTimer = setInterval(() => {
      const n = scale[step % scale.length];
      // melody
      blip({ freq: n, type: theme === "cave" ? "triangle" : "square", dur: 0.22, gain: 0.12, dest: musicGain });
      // bass every other step
      if (step % 2 === 0)
        blip({ freq: n / 2, type: "sine", dur: 0.3, gain: 0.16, dest: musicGain });
      // sparkle on the 4
      if (step % 8 === 4)
        blip({ freq: n * 2, type: "triangle", dur: 0.14, gain: 0.07, dest: musicGain });
      step++;
    }, tempo);
  }

  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
    if (dungeon) { dungeon.pause(); }
    curTheme = null;
  }

  const Sfx = {
    unlock() {
      const c = ensure();
      if (!c) return;
      if (c.state === "suspended") c.resume();
      enabled = true;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.9;
      if (dungeon) dungeon.muted = muted;
      return muted;
    },
    get muted() {
      return muted;
    },

    // SFX
    jump() { blip({ freq: 440, type: "square", dur: 0.14, gain: 0.16, slide: 300 }); },
    doubleJump() { blip({ freq: 620, type: "square", dur: 0.14, gain: 0.16, slide: 320 }); },
    dash() { blip({ freq: 240, type: "sawtooth", dur: 0.18, gain: 0.16, slide: 520 }); noise({ dur: 0.12, gain: 0.1 }); },
    coin() { blip({ freq: 880, type: "square", dur: 0.07, gain: 0.14 }); blip({ freq: 1320, type: "square", dur: 0.09, gain: 0.13, when: 0.05 }); },
    gem() { blip({ freq: 1046, type: "triangle", dur: 0.1, gain: 0.16 }); blip({ freq: 1568, type: "triangle", dur: 0.12, gain: 0.14, when: 0.07 }); blip({ freq: 2093, type: "triangle", dur: 0.12, gain: 0.1, when: 0.14 }); },
    letter() { [0, 4, 7, 12].forEach((s, i) => blip({ freq: NOTE(s) * 2, type: "square", dur: 0.1, gain: 0.12, when: i * 0.06 })); },
    power() { [0, 5, 9, 12, 16].forEach((s, i) => blip({ freq: NOTE(s), type: "triangle", dur: 0.12, gain: 0.14, when: i * 0.05 })); },
    stomp() { blip({ freq: 200, type: "square", dur: 0.12, gain: 0.16, slide: -120 }); noise({ dur: 0.1, gain: 0.12 }); },
    punch() { noise({ dur: 0.08, gain: 0.14 }); blip({ freq: 180, type: "square", dur: 0.1, gain: 0.18, slide: -90 }); },
    hit() { blip({ freq: 320, type: "sawtooth", dur: 0.22, gain: 0.2, slide: -200 }); noise({ dur: 0.16, gain: 0.16 }); },
    shoot() { blip({ freq: 520, type: "sawtooth", dur: 0.12, gain: 0.12, slide: -260 }); },
    door() { [0, 7, 12].forEach((s, i) => blip({ freq: NOTE(s), type: "sine", dur: 0.18, gain: 0.16, when: i * 0.08 })); },
    levelClear() { [0, 4, 7, 12, 16, 19].forEach((s, i) => blip({ freq: NOTE(s), type: "square", dur: 0.16, gain: 0.16, when: i * 0.1 })); },
    win() { [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) => blip({ freq: NOTE(s), type: "triangle", dur: 0.2, gain: 0.16, when: i * 0.14 })); },
    gameOver() { [0, -2, -4, -7].forEach((s, i) => blip({ freq: NOTE(s) / 2, type: "sawtooth", dur: 0.3, gain: 0.18, when: i * 0.18, slide: -40 })); },
    splash() { noise({ dur: 0.25, gain: 0.14 }); blip({ freq: 300, type: "sine", dur: 0.2, gain: 0.1, slide: -120 }); },

    startMusic,
    stopMusic,
  };

  window.Sfx = Sfx;
})();
