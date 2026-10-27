/**
 * AMC VetAtlas - Música de batalla RPG portátil 8 bits (vetatlas-music-gbbattle.js)
 * Composición 100 % original, generada en código con Web Audio API (sin samples).
 * Cuatro canales al estilo de una consola portátil clásica:
 *   - Pulso 1: melodía (duty 12,5 / 25 / 50 %)
 *   - Pulso 2: armonía (arpegios y terceras)
 *   - Onda (wavetable de 4 bits, 32 muestras): bajo
 *   - Ruido (LFSR de 15 y 7 bits): bombo, caja, hi-hat y platillo
 * Re menor @ 164 BPM. Intro «encuentro» de 2 compases (arpegio y barrido ascendente
 * + golpe) y luego un bucle A-B de 16 compases (~23,4 s) que no repite la intro.
 * Misma API que vetatlas-music-chiptune.js (window.VetAtlasMusic) y mismo silencio
 * con localStorage 'vetatlas-audio-muted'. Extra opcional: VetAtlasMusic.duck(seg)
 * baja la música un momento para que los efectos de la página se oigan por encima.
 */
(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'vetatlas-audio-muted';
  const DEFAULT_VOLUME = 0.20;
  const BPM = 164;
  const STEP_DURATION = 60 / BPM / 4; // Semicorchea (~0.0915 s)
  const LOOKAHEAD_MS = 25;            // Reloj del scheduler en ms
  const SCHEDULE_AHEAD_SEC = 0.12;    // Ventana de programación anticipada en s
  const STEPS_PER_BAR = 16;
  const INTRO_BARS = 2;
  const LOOP_BARS = 16;
  const INTRO_STEPS = INTRO_BARS * STEPS_PER_BAR;            // 32 pasos (~2,9 s)
  const TOTAL_STEPS = INTRO_STEPS + LOOP_BARS * STEPS_PER_BAR; // 288 pasos
  const DUCK_LEVEL = 0.35;            // Nivel de la música mientras suena un SFX

  let ctx = null;
  let masterGain = null;
  let duckGain = null;
  let compressor = null;
  let noiseLong = null;   // LFSR de 15 bits (ruido «blanco» de consola)
  let noiseShort = null;  // LFSR de 7 bits (ruido metálico)
  let pulseWaves = null;  // { p125, p25, p50 }
  let bassWave = null;

  let currentVolume = DEFAULT_VOLUME;
  let userInteracted = false;
  let isRunning = false;
  let shouldResumeOnVisible = false;
  let schedulerTimer = null;
  let currentStep = 0;
  let nextNoteTime = 0;
  let pendingToggleMuted = null;

  // Conversión de nota MIDI a frecuencia (Hz)
  function mtof(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // 'C#5' / 'Bb4' / 'D6' -> número MIDI
  function noteToMidi(name) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return null;
    let n = NOTE_INDEX[m[1]] + (Number(m[3]) + 1) * 12;
    if (m[2] === '#') n += 1;
    if (m[2] === 'b') n -= 1;
    return n;
  }

  /* =========================================================================
     COMPOSICIÓN ORIGINAL EN RE MENOR
     Cada compás = 16 semicorcheas: nota, '-' prolonga la anterior, '.' silencio.
     A  (compases 1-8):  Dm Dm Bb C | Dm Dm Bb A   (gancho + respuesta, cadencia a La)
     B  (compases 9-16): Gm Gm Dm Dm | Bb C A A7   (puente más agudo y clímax)
  ========================================================================= */

  const LEAD_A = [
    'D5 - - A4 - D5 - F5 - E5 - D5 - C5 - A4',
    '- - - - D5 - E5 - F5 - G5 - A5 - - -',
    'Bb5 - - A5 - G5 - F5 - - G5 - F5 - D5 -',
    'E5 - - - C5 - E5 - G5 - - - F5 - E5 -',
    'D5 - - A4 - D5 - F5 - E5 - D5 - C5 - D5',
    '- - F5 - A5 - D6 - - - C6 - A5 - - -',
    'Bb5 - A5 - G5 - F5 - G5 - A5 - Bb5 - C6 -',
    'C#6 - - - A5 - - - E5 - - - C#5 - E5 -'
  ];

  const LEAD_B = [
    'G5 - - D5 - G5 - Bb5 - - A5 - G5 - F5 -',
    'G5 - - - - - D5 - G5 - A5 - Bb5 - D6 -',
    'C6 - - A5 - F5 - A5 - - G5 - F5 - E5 -',
    'F5 - - - D5 - - - . . D5 E5 F5 G5 A5 -',
    'Bb5 - - - D6 - - - C6 - Bb5 - A5 - G5 -',
    'A5 - - - G5 - - - E5 - G5 - C6 - - -',
    'C#6 - - - E6 - - - D6 - C#6 - Bb5 - A5 -',
    'G5 - F5 - E5 - C#5 - E5 - G5 - A5 - . .'
  ];

  // Acordes del bucle (raíz del bajo + tonos para la armonía del pulso 2)
  const CHORDS = {
    Dm: { root: 'D2', tones: ['D4', 'F4', 'A4', 'D5'] },
    Bb: { root: 'Bb1', tones: ['Bb3', 'D4', 'F4', 'Bb4'] },
    C:  { root: 'C2', tones: ['C4', 'E4', 'G4', 'C5'] },
    A:  { root: 'A1', tones: ['A3', 'C#4', 'E4', 'A4'] },
    A7: { root: 'A1', tones: ['A3', 'C#4', 'E4', 'G4'] },
    Gm: { root: 'G1', tones: ['G3', 'Bb3', 'D4', 'G4'] }
  };
  const PROGRESSION_A = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A'];
  const PROGRESSION_B = ['Gm', 'Gm', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A7'];

  // Arpegio de semicorcheas (índices de tonos) para la sección A
  const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 1];
  // Bajo en corcheas: desplazamiento en semitonos sobre la raíz (null = silencio)
  const BASS_A = [0, 12, 0, 12, 0, 12, 0, 12];
  const BASS_B = [0, 12, null, 0, 12, 0, 7, 12];

  // Partitura: lista de eventos por paso; cada evento = { off (fracción de paso), play(t) }
  const SONG = [];
  for (let i = 0; i < TOTAL_STEPS; i++) SONG.push([]);

  function at(step, off, play) {
    if (step >= 0 && step < TOTAL_STEPS) SONG[step].push({ off: off, play: play });
  }

  // Convierte una línea de tokens (uno por semicorchea) en notas con su duración en pasos
  function parseBar(line, startStep, voice) {
    const tokens = line.trim().split(/\s+/);
    let i = 0;
    while (i < tokens.length) {
      const midi = noteToMidi(tokens[i]);
      if (midi === null) { i++; continue; }
      let len = 1;
      while (i + len < tokens.length && tokens[i + len] === '-') len++;
      voice(startStep + i, midi, len);
      i += len;
    }
  }

  function buildSong() {
    const S = STEP_DURATION;
    const loopStart = INTRO_STEPS;

    /* ---------------- INTRO «ENCUENTRO» (2 compases) ---------------- */
    // Compás 1: arpegios menores en fusas que suben por tonos enteros (pulso 2)
    for (let g = 0; g < 8; g++) {
      const base = 50 + g * 2;
      const notes = [base, base + 3, base + 7, base + 12];
      for (let k = 0; k < 4; k++) {
        const pos = g * 2 + k * 0.5;
        const vol = 0.07 + g * 0.008;
        at(Math.floor(pos), pos % 1, function (t) {
          pulse(notes[k], t, S * 0.5, 'p50', vol, { gate: 0.9 });
        });
      }
    }
    // Barrido ascendente de pulso 12,5 % (pulso 1) + ruido que crece
    at(0, 0, function (t) { pulse(50, t, S * 16, 'p125', 0.09, { glideTo: 86, gate: 1 }); });
    at(4, 0, function (t) { noiseHit(t, S * 12, 0.11, { rate: 0.18, rateTo: 1.2, swell: true }); });
    // Bajo que empuja en corcheas con crescendo
    for (let s = 0; s < 16; s += 2) {
      const vol = 0.24 + s * 0.008;
      at(s, 0, function (t) { waveBass(38, t, S * 2, vol); });
    }
    // Compás 2, tiempo 1: ¡GOLPE! platillo + bombo + acorde de Re menor
    at(16, 0, function (t) {
      noiseHit(t, 0.9, 0.16, { rate: 1, long: true });
      kick(t, 1.2);
      waveBass(38, t, S * 6, 0.36);
      pulse(86, t, S * 6, 'p50', 0.2, { vib: true });
      pulse(81, t, S * 6, 'p25', 0.1);
    });
    // Suspenso: trino La-Sib en fusas (pulso 2) y hi-hats
    for (let s = 18; s < 24; s++) {
      at(s, 0, function (t) { pulse(69, t, S * 0.5, 'p125', 0.06, { gate: 0.85 }); });
      at(s, 0.5, function (t) { pulse(70, t, S * 0.5, 'p125', 0.06, { gate: 0.85 }); });
    }
    [18, 20, 22].forEach(function (s) { at(s, 0, function (t) { hat(t, false); }); });
    at(20, 0, function (t) { kick(t, 0.8); });
    // Anacrusa en La7 hacia el bucle: melodía + armonía + redoble
    parseBar('. . . . . . . . A4 - C#5 - E5 - G5 -', 16, function (step, midi, len) {
      at(step, 0, function (t) { pulse(midi, t, S * len, 'p25', 0.17); });
    });
    parseBar('. . . . . . . . E4 - A4 - C#5 - E5 -', 16, function (step, midi, len) {
      at(step, 0, function (t) { pulse(midi, t, S * len, 'p50', 0.06); });
    });
    [24, 26, 28, 30].forEach(function (s, idx) {
      at(s, 0, function (t) { waveBass(idx % 2 ? 45 : 33, t, S * 2, 0.3); });
    });
    at(24, 0, function (t) { kick(t, 1); });
    [24, 26, 28, 29, 30, 31].forEach(function (s, idx) {
      at(s, 0, function (t) { snare(t, 0.7 + idx * 0.06); });
    });

    /* ---------------- BUCLE A-B (16 compases) ---------------- */
    function addSection(firstBar, leadLines, progression, isB) {
      const sectionStep = loopStart + firstBar * STEPS_PER_BAR;

      // Pulso 1: melodía de la sección entera (las ligaduras cruzan la barra de compás).
      // Duty 25 % en A; 12,5 % y luego 50 % en B para cambiar de color.
      parseBar(leadLines.join(' '), sectionStep, function (step, midi, len) {
        const b = Math.floor((step - sectionStep) / STEPS_PER_BAR);
        const duty = !isB ? 'p25' : (b < 4 ? 'p125' : 'p50');
        at(step, 0, function (t) {
          pulse(midi, t, S * len, duty, 0.2, { vib: len >= 4, slide: len >= 3 });
        });
      });

      for (let b = 0; b < 8; b++) {
        const bar = firstBar + b;
        const barStep = loopStart + bar * STEPS_PER_BAR;
        const chord = CHORDS[progression[b]];
        const tones = chord.tones.map(noteToMidi);
        const root = noteToMidi(chord.root);

        // Pulso 2: arpegio rápido (A) o terceras sostenidas con vibrato (B)
        if (!isB) {
          for (let s = 0; s < 16; s++) {
            const midi = tones[ARP_PATTERN[s]];
            at(barStep + s, 0, function (t) {
              pulse(midi, t, S, 'p125', 0.055, { gate: 0.55 });
            });
          }
        } else {
          [0, 8].forEach(function (s, half) {
            const midi = tones[half ? 2 : 1] + 12;
            at(barStep + s, 0, function (t) {
              pulse(midi, t, S * 8, 'p50', 0.06, { vib: true, gate: 0.94 });
            });
          });
        }

        // Onda: bajo en corcheas (caminata ascendente en los compases de La)
        let pattern = isB ? BASS_B : BASS_A;
        if (b === 7) pattern = isB ? [0, 12, 0, 12, 7, 10, 12, 16] : [0, 12, 0, 12, 0, 4, 7, 10];
        pattern.forEach(function (offset, k) {
          if (offset === null) return;
          const s = k * 2;
          at(barStep + s, 0, function (t) {
            waveBass(root + offset, t, S * 2, s % 4 === 0 ? 0.36 : 0.3);
          });
        });

        // Ruido: batería
        const isTurnaround = b === 7;
        const kicks = isB ? [0, 3, 8, 11] : [0, 6, 8];
        kicks.forEach(function (s) { at(barStep + s, 0, function (t) { kick(t, 1); }); });
        if (isTurnaround) {
          [4, 10, 12, 13, 14, 15].forEach(function (s, idx) {
            at(barStep + s, 0, function (t) { snare(t, 0.75 + idx * 0.05); });
          });
        } else {
          [4, 12].forEach(function (s) { at(barStep + s, 0, function (t) { snare(t, 1); }); });
        }
        // Hi-hat: corcheas en A; semicorcheas en la segunda mitad de B (más energía)
        const hatEvery = isB && b >= 4 ? 1 : 2;
        for (let s = 0; s < 16; s += hatEvery) {
          if (isTurnaround && s >= 12) break;
          const open = s % 8 === 6;
          at(barStep + s, 0, function (t) { hat(t, open); });
        }
        // Platillo al entrar a cada sección
        if (b === 0) at(barStep, 0, function (t) { noiseHit(t, 0.6, 0.09, { rate: 1, long: true }); });
      }
    }

    addSection(0, LEAD_A, PROGRESSION_A, false);
    addSection(8, LEAD_B, PROGRESSION_B, true);
  }

  buildSong();

  /* =========================================================================
     GESTIÓN DE ESTADO Y PERSISTENCIA (localStorage + UI)
  ========================================================================= */

  function isMutedInStorage() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function setMutedInStorage(muted) {
    try {
      localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false');
    } catch (e) {}
  }

  function syncButtonUI(active) {
    const btn = document.getElementById('audio-toggle-btn');
    const label = document.getElementById('audio-status-label');
    const waves = document.getElementById('audio-waves');
    if (btn) {
      btn.classList.toggle('muted', !active);
      btn.setAttribute('aria-pressed', String(active));
    }
    if (label) {
      label.textContent = active ? 'Audio: ON' : 'Silenciado';
    }
    if (waves) {
      waves.style.display = active ? 'block' : 'none';
    }
  }

  /* =========================================================================
     INICIALIZACIÓN: PULSOS, WAVETABLE DE 4 BITS Y RUIDO LFSR
  ========================================================================= */

  function createPulseWave(audioCtx, duty) {
    const harmonics = 48;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      // Serie de Fourier para onda rectangular de ancho de pulso `duty`
      real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    }
    return audioCtx.createPeriodicWave(real, imag);
  }

  // Wavetable de 32 muestras con valores de 4 bits (0-15) -> PeriodicWave por DFT
  const BASS_TABLE = [
    15, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    0, 0, 1, 2, 4, 6, 8, 10, 12, 13, 13, 12, 10, 8, 6, 3
  ];

  function createWavetable(audioCtx, table) {
    const N = table.length;
    const half = N / 2;
    const real = new Float32Array(half + 1);
    const imag = new Float32Array(half + 1);
    for (let k = 1; k <= half; k++) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < N; n++) {
        const v = (table[n] - 7.5) / 7.5;
        const ph = (2 * Math.PI * k * n) / N;
        re += v * Math.cos(ph);
        im += v * Math.sin(ph);
      }
      real[k] = (2 * re) / N;
      imag[k] = (2 * im) / N;
    }
    return audioCtx.createPeriodicWave(real, imag);
  }

  // Ruido de registro de desplazamiento (15 bits o 7 bits «corto»), cada paso retenido `hold` muestras
  function createLfsrNoise(audioCtx, seconds, shortMode, hold) {
    const length = Math.floor(audioCtx.sampleRate * seconds);
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const out = buffer.getChannelData(0);
    let lfsr = 0x7fff;
    let v = 1;
    for (let i = 0; i < length; i++) {
      if (i % hold === 0) {
        const bit = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        if (shortMode) lfsr = (lfsr & ~0x40) | (bit << 6);
        v = (lfsr & 1) ? -0.7 : 0.7;
      }
      out[i] = v;
    }
    return buffer;
  }

  function initAudio() {
    if (ctx) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    try {
      ctx = new AudioCtx();
      if (window.VetAtlasAudio) window.VetAtlasAudio.register(ctx);

      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, ctx.currentTime);
      compressor.knee.setValueAtTime(8, ctx.currentTime);
      compressor.ratio.setValueAtTime(3.0, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.10, ctx.currentTime);

      // Ducking independiente del volumen maestro (no interfiere con silenciar/pausar)
      duckGain = ctx.createGain();
      duckGain.gain.setValueAtTime(1, ctx.currentTime);

      masterGain = ctx.createGain();
      const initialGain = isMutedInStorage() ? 0.0001 : currentVolume;
      masterGain.gain.setValueAtTime(initialGain, ctx.currentTime);

      compressor.connect(duckGain);
      duckGain.connect(masterGain);
      masterGain.connect(ctx.destination);

      pulseWaves = {
        p125: createPulseWave(ctx, 0.125),
        p25:  createPulseWave(ctx, 0.25),
        p50:  createPulseWave(ctx, 0.50)
      };
      bassWave = createWavetable(ctx, BASS_TABLE);
      noiseLong = createLfsrNoise(ctx, 1.0, false, 2);
      noiseShort = createLfsrNoise(ctx, 0.25, true, 2);

      return true;
    } catch (e) {
      return false;
    }
  }

  /* =========================================================================
     CANALES (CON AUTO-DESCONEXIÓN EN onended)
  ========================================================================= */

  function release(nodes) {
    return function () {
      for (let i = 0; i < nodes.length; i++) {
        try { nodes[i].disconnect(); } catch (e) {}
      }
    };
  }

  // Pulso 1 / Pulso 2. opts: gate, vib (vibrato retardado), slide (ligadura de semitono), glideTo (barrido)
  function pulse(midi, time, duration, waveKey, vol, opts) {
    const o = opts || {};
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const nodes = [osc, gain];

    osc.setPeriodicWave(pulseWaves[waveKey] || pulseWaves.p50);

    const freq = mtof(midi);
    const gateDur = Math.max(0.02, duration * (o.gate || 0.88));
    if (o.glideTo) {
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(mtof(o.glideTo), time + gateDur);
    } else if (o.slide) {
      osc.frequency.setValueAtTime(mtof(midi - 1), time);
      osc.frequency.setValueAtTime(freq, time + 0.022);
    } else {
      osc.frequency.setValueAtTime(freq, time);
    }

    if (o.vib && gateDur > 0.3) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(5.8, time);
      depth.gain.setValueAtTime(0, time);
      depth.gain.setValueAtTime(0, time + 0.18);
      depth.gain.linearRampToValueAtTime(freq * 0.012, time + 0.32);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(time);
      lfo.stop(time + gateDur + 0.01);
      nodes.push(lfo, depth);
    }

    const sustain = vol * 0.78;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.004);
    gain.gain.linearRampToValueAtTime(sustain, time + Math.min(0.04, gateDur * 0.4));
    gain.gain.setValueAtTime(sustain, time + Math.max(0.006, gateDur - 0.014));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + gateDur);

    osc.connect(gain);
    gain.connect(compressor);
    osc.onended = release(nodes);
    osc.start(time);
    osc.stop(time + gateDur + 0.01);
  }

  // Canal de onda: bajo con wavetable de 4 bits
  function waveBass(midi, time, duration, vol) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.setPeriodicWave(bassWave);
    osc.frequency.setValueAtTime(mtof(midi), time);

    const gateDur = duration * 0.86;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.004);
    gain.gain.setValueAtTime(vol * 0.85, time + gateDur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + gateDur);

    osc.connect(gain);
    gain.connect(compressor);
    osc.onended = release([osc, gain]);
    osc.start(time);
    osc.stop(time + gateDur + 0.01);
  }

  // Canal de ruido genérico. opts: rate, rateTo, short, filter, freq, swell (crescendo), long (platillo)
  function noiseHit(time, duration, vol, opts) {
    const o = opts || {};
    const buffer = o.short ? noiseShort : noiseLong;
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.setValueAtTime(o.rate || 1, time);
    if (o.rateTo) src.playbackRate.linearRampToValueAtTime(o.rateTo, time + duration);

    const gain = ctx.createGain();
    const nodes = [src, gain];
    let head = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq || 1000, time);
      src.connect(f);
      head = f;
      nodes.push(f);
    }

    gain.gain.setValueAtTime(0.0001, time);
    if (o.swell) {
      gain.gain.exponentialRampToValueAtTime(vol, time + duration * 0.95);
      gain.gain.linearRampToValueAtTime(0.0001, time + duration);
    } else if (o.long) {
      gain.gain.linearRampToValueAtTime(vol, time + 0.003);
      gain.gain.exponentialRampToValueAtTime(vol * 0.3, time + duration * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    } else {
      gain.gain.linearRampToValueAtTime(vol, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    }

    head.connect(gain);
    gain.connect(compressor);
    src.onended = release(nodes);
    src.start(time);
    src.stop(time + duration + 0.01);
  }

  // Bombo: ruido muy grave con caída de frecuencia de muestreo y filtro paso bajo
  function kick(time, accent) {
    if (!noiseLong) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseLong;
    src.loop = true;
    src.playbackRate.setValueAtTime(0.32, time);
    src.playbackRate.exponentialRampToValueAtTime(0.04, time + 0.09);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(420, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.62 * accent, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    src.connect(f);
    f.connect(gain);
    gain.connect(compressor);
    src.onended = release([src, f, gain]);
    src.start(time);
    src.stop(time + 0.13);
  }

  function snare(time, accent) {
    noiseHit(time, 0.13, 0.17 * accent, { rate: 0.55, rateTo: 0.4, filter: 'highpass', freq: 700 });
  }

  function hat(time, open) {
    noiseHit(time, open ? 0.08 : 0.025, open ? 0.06 : 0.045, { rate: 1, short: true, filter: 'highpass', freq: 6000 });
  }

  /* =========================================================================
     PROGRAMADOR DE PASOS (SCHEDULER CON LOOKAHEAD)
  ========================================================================= */

  function scheduleStep(stepIndex, time) {
    const events = SONG[stepIndex];
    for (let i = 0; i < events.length; i++) {
      events[i].play(time + events[i].off * STEP_DURATION);
    }
  }

  function schedulerTick() {
    if (!isRunning || !ctx) return;

    if (nextNoteTime < ctx.currentTime - 0.08) {
      nextNoteTime = ctx.currentTime + 0.01;
    }

    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      scheduleStep(currentStep, nextNoteTime);
      nextNoteTime += STEP_DURATION;
      currentStep += 1;
      // Tras la intro, el bucle vuelve al compás 1 (la intro suena una sola vez)
      if (currentStep >= TOTAL_STEPS) currentStep = INTRO_STEPS;
    }

    schedulerTimer = window.setTimeout(schedulerTick, LOOKAHEAD_MS);
  }

  /* =========================================================================
     CONTROL INTERNO DE ARRANQUE, PARADA Y APLICACIÓN DE SILENCIO
  ========================================================================= */

  function beginPlaybackInternal() {
    if (isMutedInStorage() || document.hidden) return false;
    if (!userInteracted) return false;
    if (!initAudio()) return false;

    if (ctx.state !== 'running') {
      unlockContext();
    }

    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
    masterGain.gain.linearRampToValueAtTime(currentVolume, now + 0.05);

    if (!isRunning) {
      isRunning = true;
      nextNoteTime = ctx.currentTime + 0.03;
      schedulerTick();
    }
    return true;
  }

  // iOS: resume() + buffer silencioso de 1 muestra dentro del gesto (vetatlas-audio-unlock.js)
  function unlockContext() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    if (window.VetAtlasAudio) {
      window.VetAtlasAudio.unlock(ctx);
    } else {
      ctx.resume().catch(function () {});
    }
  }

  function pausePlaybackInternal() {
    if (schedulerTimer) {
      window.clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
    isRunning = false;

    if (ctx && masterGain) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    }
  }

  function applyMuteState(targetMuted) {
    setMutedInStorage(targetMuted);
    syncButtonUI(!targetMuted);

    if (targetMuted) {
      shouldResumeOnVisible = false;
      pausePlaybackInternal();
    } else {
      shouldResumeOnVisible = true;
      beginPlaybackInternal();
    }
  }

  /* =========================================================================
     API PÚBLICA: window.VetAtlasMusic
  ========================================================================= */

  const VetAtlasMusic = {
    start: function () {
      applyMuteState(false);
      return isRunning;
    },

    stop: function () {
      shouldResumeOnVisible = false;
      pausePlaybackInternal();
      return false;
    },

    toggle: function () {
      userInteracted = true;
      const currentlyMuted = isMutedInStorage();
      const targetMuted = currentlyMuted ? false : true;
      applyMuteState(targetMuted);
      return !targetMuted;
    },

    setVolume: function (v) {
      const num = Number(v);
      if (!Number.isFinite(num)) return currentVolume;
      currentVolume = Math.max(0, Math.min(1, num));

      if (ctx && masterGain && !isMutedInStorage() && isRunning) {
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, currentVolume), now + 0.04);
      }
      return currentVolume;
    },

    isPlaying: function () {
      return Boolean(isRunning && !isMutedInStorage() && !document.hidden);
    },

    // Baja la música durante `seconds` para que un efecto se oiga por encima (no crea nodos)
    duck: function (seconds) {
      if (!ctx || !duckGain || !isRunning) return false;
      const hold = Math.max(0.1, Math.min(4, Number(seconds) || 0.5));
      const now = ctx.currentTime;
      const g = duckGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(DUCK_LEVEL, now + 0.04);
      g.setValueAtTime(DUCK_LEVEL, now + hold);
      g.linearRampToValueAtTime(1, now + hold + 0.4);
      return true;
    }
  };

  window.VetAtlasMusic = VetAtlasMusic;
  window.VetAtlasMusicTrack = 'gbbattle';

  /* =========================================================================
     GESTIÓN ROBUSTA DE INTERACCIÓN Y #audio-toggle-btn (CAPTURA + BURBUJEO)
  ========================================================================= */

  function isEventOnAudioToggle(e) {
    if (!e || !e.target || typeof e.target.closest !== 'function') return false;
    return Boolean(e.target.closest('#audio-toggle-btn'));
  }

  // iOS solo desbloquea Web Audio en touchend/click: no se quitan hasta que el contexto suene
  const GESTURE_EVENTS = ['pointerdown', 'touchstart', 'touchend', 'keydown'];

  function releaseGestureListenersIfRunning() {
    if (!ctx || ctx.state !== 'running') return;
    GESTURE_EVENTS.forEach(function (evt) {
      window.removeEventListener(evt, onUserGesture, true);
    });
  }

  function onUserGesture(e) {
    if (!userInteracted) {
      userInteracted = true;
      if (!isEventOnAudioToggle(e) && !isMutedInStorage()) {
        shouldResumeOnVisible = true;
        beginPlaybackInternal();
      }
    }

    if (!isMutedInStorage()) unlockContext();
    releaseGestureListenersIfRunning();
  }

  GESTURE_EVENTS.forEach(function (evt) {
    window.addEventListener(evt, onUserGesture, { capture: true, passive: true });
  });

  // 1) FASE DE CAPTURA en window: corre antes que los listeners de la página
  window.addEventListener('click', function (e) {
    const clickedToggle = isEventOnAudioToggle(e);

    if (!userInteracted) {
      userInteracted = true;
      if (!clickedToggle && !isMutedInStorage()) {
        shouldResumeOnVisible = true;
        beginPlaybackInternal();
      }
    }

    if (clickedToggle) {
      const mutedBeforeClick = isMutedInStorage();
      const targetMuted = !mutedBeforeClick;
      pendingToggleMuted = targetMuted;
      applyMuteState(targetMuted);
    }

    if (!isMutedInStorage()) unlockContext();
    releaseGestureListenersIfRunning();
  }, true);

  // 2) FASE DE BURBUJEO en window: corre después que los listeners de la página
  window.addEventListener('click', function (e) {
    if (pendingToggleMuted !== null && isEventOnAudioToggle(e)) {
      const finalMuted = pendingToggleMuted;
      pendingToggleMuted = null;
      applyMuteState(finalMuted);
    }
  }, false);

  function initButtonState() {
    syncButtonUI(!isMutedInStorage());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initButtonState);
  } else {
    initButtonState();
  }

  // Pausa automática en pestaña oculta y reanudación al volver si correspondía
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (isRunning) {
        shouldResumeOnVisible = true;
        pausePlaybackInternal();
      }
    } else if (shouldResumeOnVisible && userInteracted && !isMutedInStorage()) {
      beginPlaybackInternal();
    }
  });

  // Sincronización entre pestañas si cambia localStorage
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      const muted = e.newValue === 'true';
      syncButtonUI(!muted);
      if (muted) {
        shouldResumeOnVisible = false;
        pausePlaybackInternal();
      } else if (userInteracted && !document.hidden) {
        shouldResumeOnVisible = true;
        beginPlaybackInternal();
      }
    }
  });
})(window, document);
