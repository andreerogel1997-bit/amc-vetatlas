/**
 * AMC VetAtlas - Original Space Arcade Background Music Engine (vetatlas-music.js)
 * 100% Web Audio API | Cero archivos externos | 32 compases @ 145 BPM
 */
(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'vetatlas-audio-muted';
  const DEFAULT_VOLUME = 0.18;
  const BPM = 145;
  const STEP_DURATION = 60 / BPM / 4; // Duración de semicorchea (~0.1034s)
  const LOOKAHEAD_MS = 25;            // Intervalo del reloj en ms
  const SCHEDULE_AHEAD_SEC = 0.12;    // Ventana de programación anticipada en s
  const TOTAL_BARS = 32;
  const STEPS_PER_BAR = 16;
  const TOTAL_STEPS = TOTAL_BARS * STEPS_PER_BAR; // 512 pasos (~53s por vuelta)

  let ctx = null;
  let masterGain = null;
  let compressor = null;
  let noiseBuffer = null;

  let currentVolume = DEFAULT_VOLUME;
  let userInteracted = false;
  let isRunning = false;
  let shouldResumeOnVisible = false;
  let schedulerTimer = null;
  let currentStep = 0;
  let nextNoteTime = 0;
  let pendingToggleMuted = null;

  // Conversión MIDI a Hz
  function mtof(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* =========================================================================
     COMPOSICIÓN ORIGINAL DE 32 COMPASES (E menor / C Lidio / G Mayor Espacial)
     - Sección A (0-7):   Fanfarria de Lanzamiento Orbital
     - Sección B (8-15):  Vuelo de Escuadrón (Tema Heroico Principal)
     - Sección C (16-23): Sector Nebulosa (Puente Cósmico y Tensión)
     - Sección D (24-31): Clímax de Flota Estelar y Retorno
  ========================================================================= */

  // Mapa armónico por compás: [notaGraveBajo, [notasDelArpegio]]
  const HARMONY_MAP = [
    // Sección A (Compases 0-7)
    [40, [64, 67, 71, 76]], [40, [64, 71, 76, 79]], // Em
    [36, [60, 64, 67, 71]], [38, [62, 66, 69, 74]], // Cmaj7 -> D
    [40, [64, 67, 71, 76]], [36, [60, 64, 67, 72]], // Em -> C
    [33, [57, 60, 64, 69]], [35, [59, 63, 66, 71]], // Am7 -> B7

    // Sección B (Compases 8-15)
    [36, [60, 64, 67, 72]], [38, [62, 66, 69, 74]], // C -> D
    [35, [59, 62, 66, 71]], [40, [64, 67, 71, 76]], // Bm7 -> Em
    [36, [60, 64, 67, 72]], [38, [62, 66, 69, 74]], // C -> D
    [43, [59, 62, 67, 71]], [35, [59, 63, 66, 71]], // G -> B7

    // Sección C (Compases 16-23)
    [33, [60, 64, 69, 72]], [35, [62, 66, 69, 74]], // Am7 -> Bm7
    [36, [64, 67, 71, 76]], [38, [66, 69, 74, 78]], // Cmaj7 -> D6
    [33, [60, 64, 69, 72]], [40, [64, 67, 71, 76]], // Am7 -> Em
    [41, [60, 65, 69, 72]], [35, [59, 63, 66, 71]], // Fmaj7 -> B7

    // Sección D (Compases 24-31)
    [40, [64, 71, 76, 79]], [38, [62, 69, 74, 78]], // Em -> D
    [36, [60, 67, 72, 76]], [35, [59, 66, 71, 75]], // C -> B7
    [33, [57, 64, 69, 72]], [35, [59, 66, 71, 74]], // Am -> Bm
    [36, [60, 67, 72, 76]], [35, [59, 63, 66, 71]]  // C -> B7
  ];

  // Patrones de orden de arpegio de 16 pasos para variar la textura
  const ARP_PATTERNS = {
    fastUp:     [0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3],
    cosmicWave: [0, 2, 1, 3, 2, 3, 1, 2, 0, 2, 1, 3, 3, 2, 1, 0],
    nebulaBell: [0, null, 2, 3, null, 2, 1, null, 0, null, 3, 2, null, 1, 2, null],
    climaxRun:  [0, 1, 2, 3, 3, 2, 1, 0, 0, 2, 1, 3, 1, 3, 2, 3]
  };

  // Melodía original por compás: arreglo de eventos { s: paso(0-15), n: midi, l: duraciónEnPasos, t: timbre }
  const LEAD_MELODY = [
    // --- SECCIÓN A: Fanfarria Orbital (0-7) ---
    [ { s: 0, n: 64, l: 3, t: 'brass' }, { s: 3, n: 67, l: 3, t: 'brass' }, { s: 6, n: 71, l: 2, t: 'brass' }, { s: 8, n: 76, l: 6, t: 'brass' }, { s: 14, n: 74, l: 2, t: 'brass' } ],
    [ { s: 0, n: 71, l: 4, t: 'brass' }, { s: 4, n: 67, l: 4, t: 'brass' }, { s: 8, n: 64, l: 4, t: 'brass' }, { s: 12, n: 71, l: 2, t: 'brass' }, { s: 14, n: 74, l: 2, t: 'brass' } ],
    [ { s: 0, n: 72, l: 6, t: 'brass' }, { s: 6, n: 71, l: 2, t: 'brass' }, { s: 8, n: 67, l: 4, t: 'brass' }, { s: 12, n: 72, l: 4, t: 'brass' } ],
    [ { s: 0, n: 74, l: 3, t: 'brass' }, { s: 3, n: 76, l: 3, t: 'brass' }, { s: 6, n: 74, l: 2, t: 'brass' }, { s: 8, n: 71, l: 8, t: 'brass' } ],
    [ { s: 0, n: 64, l: 3, t: 'brass' }, { s: 3, n: 71, l: 3, t: 'brass' }, { s: 6, n: 74, l: 2, t: 'brass' }, { s: 8, n: 76, l: 4, t: 'brass' }, { s: 12, n: 79, l: 4, t: 'brass' } ],
    [ { s: 0, n: 78, l: 3, t: 'brass' }, { s: 3, n: 76, l: 3, t: 'brass' }, { s: 6, n: 72, l: 2, t: 'brass' }, { s: 8, n: 74, l: 6, t: 'brass' }, { s: 14, n: 71, l: 2, t: 'brass' } ],
    [ { s: 0, n: 72, l: 4, t: 'brass' }, { s: 4, n: 69, l: 4, t: 'brass' }, { s: 8, n: 64, l: 4, t: 'brass' }, { s: 12, n: 72, l: 4, t: 'brass' } ],
    [ { s: 0, n: 71, l: 6, t: 'brass' }, { s: 6, n: 75, l: 6, t: 'brass' }, { s: 12, n: 78, l: 4, t: 'brass' } ],

    // --- SECCIÓN B: Escuadrón Hiperespacial (8-15) ---
    [ { s: 0, n: 79, l: 6, t: 'hero' }, { s: 6, n: 76, l: 2, t: 'hero' }, { s: 8, n: 72, l: 4, t: 'hero' }, { s: 12, n: 76, l: 4, t: 'hero' } ],
    [ { s: 0, n: 78, l: 6, t: 'hero' }, { s: 6, n: 74, l: 2, t: 'hero' }, { s: 8, n: 69, l: 4, t: 'hero' }, { s: 12, n: 74, l: 4, t: 'hero' } ],
    [ { s: 0, n: 74, l: 3, t: 'hero' }, { s: 3, n: 76, l: 3, t: 'hero' }, { s: 6, n: 78, l: 2, t: 'hero' }, { s: 8, n: 79, l: 4, t: 'hero' }, { s: 12, n: 74, l: 4, t: 'hero' } ],
    [ { s: 0, n: 76, l: 8, t: 'hero' }, { s: 8, n: 71, l: 4, t: 'hero' }, { s: 12, n: 74, l: 2, t: 'hero' }, { s: 14, n: 76, l: 2, t: 'hero' } ],
    [ { s: 0, n: 79, l: 4, t: 'hero' }, { s: 4, n: 81, l: 4, t: 'hero' }, { s: 8, n: 83, l: 4, t: 'hero' }, { s: 12, n: 79, l: 4, t: 'hero' } ],
    [ { s: 0, n: 78, l: 4, t: 'hero' }, { s: 4, n: 79, l: 4, t: 'hero' }, { s: 8, n: 81, l: 6, t: 'hero' }, { s: 14, n: 78, l: 2, t: 'hero' } ],
    [ { s: 0, n: 79, l: 6, t: 'hero' }, { s: 6, n: 74, l: 2, t: 'hero' }, { s: 8, n: 71, l: 4, t: 'hero' }, { s: 12, n: 74, l: 4, t: 'hero' } ],
    [ { s: 0, n: 75, l: 6, t: 'hero' }, { s: 6, n: 71, l: 2, t: 'hero' }, { s: 8, n: 78, l: 4, t: 'hero' }, { s: 12, n: 83, l: 4, t: 'hero' } ],

    // --- SECCIÓN C: Sector Nebulosa (16-23) ---
    [ { s: 0, n: 76, l: 6, t: 'bell' }, { s: 8, n: 72, l: 4, t: 'bell' }, { s: 12, n: 69, l: 4, t: 'bell' } ],
    [ { s: 0, n: 74, l: 6, t: 'bell' }, { s: 8, n: 71, l: 4, t: 'bell' }, { s: 12, n: 66, l: 4, t: 'bell' } ],
    [ { s: 0, n: 79, l: 6, t: 'bell' }, { s: 8, n: 76, l: 4, t: 'bell' }, { s: 12, n: 71, l: 4, t: 'bell' } ],
    [ { s: 0, n: 78, l: 8, t: 'bell' }, { s: 8, n: 81, l: 4, t: 'bell' }, { s: 12, n: 78, l: 4, t: 'bell' } ],
    [ { s: 0, n: 76, l: 4, t: 'bell' }, { s: 4, n: 72, l: 4, t: 'bell' }, { s: 8, n: 69, l: 4, t: 'bell' }, { s: 12, n: 76, l: 4, t: 'bell' } ],
    [ { s: 0, n: 74, l: 4, t: 'bell' }, { s: 4, n: 71, l: 4, t: 'bell' }, { s: 8, n: 67, l: 8, t: 'bell' } ],
    [ { s: 0, n: 69, l: 4, t: 'brass' }, { s: 4, n: 72, l: 4, t: 'brass' }, { s: 8, n: 76, l: 4, t: 'brass' }, { s: 12, n: 81, l: 4, t: 'brass' } ],
    [ { s: 0, n: 78, l: 3, t: 'brass' }, { s: 3, n: 75, l: 3, t: 'brass' }, { s: 6, n: 78, l: 2, t: 'brass' }, { s: 8, n: 83, l: 8, t: 'brass' } ],

    // --- SECCIÓN D: Clímax de Flota Estelar (24-31) ---
    [ { s: 0, n: 83, l: 3, t: 'hero' }, { s: 3, n: 79, l: 3, t: 'hero' }, { s: 6, n: 76, l: 2, t: 'hero' }, { s: 8, n: 71, l: 4, t: 'hero' }, { s: 12, n: 76, l: 4, t: 'hero' } ],
    [ { s: 0, n: 81, l: 3, t: 'hero' }, { s: 3, n: 78, l: 3, t: 'hero' }, { s: 6, n: 74, l: 2, t: 'hero' }, { s: 8, n: 69, l: 4, t: 'hero' }, { s: 12, n: 74, l: 4, t: 'hero' } ],
    [ { s: 0, n: 79, l: 3, t: 'hero' }, { s: 3, n: 76, l: 3, t: 'hero' }, { s: 6, n: 72, l: 2, t: 'hero' }, { s: 8, n: 67, l: 4, t: 'hero' }, { s: 12, n: 79, l: 4, t: 'hero' } ],
    [ { s: 0, n: 78, l: 4, t: 'hero' }, { s: 4, n: 75, l: 4, t: 'hero' }, { s: 8, n: 71, l: 4, t: 'hero' }, { s: 12, n: 75, l: 4, t: 'hero' } ],
    [ { s: 0, n: 76, l: 3, t: 'brass' }, { s: 3, n: 79, l: 3, t: 'brass' }, { s: 6, n: 81, l: 2, t: 'brass' }, { s: 8, n: 76, l: 4, t: 'brass' }, { s: 12, n: 72, l: 4, t: 'brass' } ],
    [ { s: 0, n: 74, l: 3, t: 'brass' }, { s: 3, n: 78, l: 3, t: 'brass' }, { s: 6, n: 79, l: 2, t: 'brass' }, { s: 8, n: 74, l: 4, t: 'brass' }, { s: 12, n: 71, l: 4, t: 'brass' } ],
    [ { s: 0, n: 76, l: 3, t: 'hero' }, { s: 3, n: 79, l: 3, t: 'hero' }, { s: 6, n: 84, l: 4, t: 'hero' }, { s: 10, n: 83, l: 2, t: 'hero' }, { s: 12, n: 79, l: 4, t: 'hero' } ],
    [ { s: 0, n: 78, l: 4, t: 'hero' }, { s: 4, n: 75, l: 4, t: 'hero' }, { s: 8, n: 71, l: 4, t: 'hero' }, { s: 12, n: 66, l: 4, t: 'hero' } ]
  ];

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
     INICIALIZACIÓN DE WEB AUDIO API Y GENERADOR DE RUIDO
  ========================================================================= */

  function initAudio() {
    if (ctx) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    try {
      ctx = new AudioCtx();

      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, ctx.currentTime);
      compressor.knee.setValueAtTime(10, ctx.currentTime);
      compressor.ratio.setValueAtTime(3.5, ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, ctx.currentTime);
      compressor.release.setValueAtTime(0.12, ctx.currentTime);

      masterGain = ctx.createGain();
      const initialGain = isMutedInStorage() ? 0.0001 : currentVolume;
      masterGain.gain.setValueAtTime(initialGain, ctx.currentTime);

      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Buffer único de ruido blanco/rosa ligero para percusión sintética
      const length = Math.floor(ctx.sampleRate * 0.28);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const out = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.09;
        b1 = 0.965 * b1 + white * 0.18;
        b2 = 0.650 * b2 + white * 0.45;
        out[i] = (b0 + b1 + b2 + white * 0.35) * 0.35;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /* =========================================================================
     VOCES SINTÉTICAS (CON AUTO-DESCONEXIÓN PARA CERO FUGAS DE MEMORIA)
  ========================================================================= */

  // 1. Bajo Arcade Pulsante (Sawtooth + Filtro Lowpass Resonante)
  function playBass(midi, time, duration, accent) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(mtof(midi), time);

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(3.2, time);
    filter.frequency.setValueAtTime(accent ? 1050 : 720, time);
    filter.frequency.exponentialRampToValueAtTime(135, time + duration * 0.9);

    const peak = accent ? 0.30 : 0.23;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.94);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(compressor);

    osc.onended = function () {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + duration);
  }

  // 2. Arpegiador Espacial Rápido
  function playArp(midi, time, duration, isClimax) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = isClimax ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(mtof(midi), time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isClimax ? 2800 : 2100, time);
    filter.frequency.exponentialRampToValueAtTime(650, time + duration * 0.9);

    const peak = isClimax ? 0.095 : 0.085;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.9);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(compressor);

    osc.onended = function () {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + duration);
  }

  // 3. Sintetizador Épico Principal (Brass / Hero Lead / Cosmic Bell)
  function playLead(midi, time, duration, timbre) {
    const freq = mtof(midi);
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    if (timbre === 'bell') {
      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, time);
      osc2.frequency.setValueAtTime(freq * 2, time);
      osc2.detune.setValueAtTime(4, time);
    } else if (timbre === 'brass') {
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, time);
      osc2.frequency.setValueAtTime(freq, time);
      osc1.detune.setValueAtTime(-7, time);
      osc2.detune.setValueAtTime(7, time);
    } else {
      osc1.type = 'sawtooth';
      osc2.type = 'square';
      osc1.frequency.setValueAtTime(freq, time);
      osc2.frequency.setValueAtTime(freq, time);
      osc1.detune.setValueAtTime(-9, time);
      osc2.detune.setValueAtTime(9, time);
    }

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(timbre === 'brass' ? 2.4 : 1.6, time);
    filter.frequency.setValueAtTime(500, time);
    filter.frequency.exponentialRampToValueAtTime(timbre === 'bell' ? 3800 : 3200, time + 0.035);
    filter.frequency.exponentialRampToValueAtTime(1100, time + duration * 0.95);

    const peak = timbre === 'bell' ? 0.13 : 0.145;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.015);
    gain.gain.setValueAtTime(peak * 0.82, time + Math.min(0.06, duration * 0.4));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.98);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(compressor);

    osc1.onended = function () {
      try {
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration);
    osc2.stop(time + duration);
  }

  // 4. Acorde de Impacto Sintético (Stab Heroico en cambios de sección)
  function playChordStab(chordNotes, time, duration) {
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, time);
    filter.frequency.exponentialRampToValueAtTime(480, time + duration);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.055, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    filter.connect(gain);
    gain.connect(compressor);

    const oscs = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(mtof(chordNotes[i]), time);
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + duration);
      oscs.push(osc);
    }

    oscs[0].onended = function () {
      try {
        for (let i = 0; i < oscs.length; i++) oscs[i].disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    };
  }

  // 5. Batería Sintética Arcade: Bombo (Kick)
  function playKick(time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.09);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.34, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);

    osc.connect(gain);
    gain.connect(compressor);

    osc.onended = function () {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + 0.15);
  }

  // 6. Batería Sintética Arcade: Caja Espacial (Snare)
  function playSnare(time, isFill) {
    if (!noiseBuffer) return;

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, time);
    osc.frequency.exponentialRampToValueAtTime(95, time + 0.07);

    oscGain.gain.setValueAtTime(0.0001, time);
    oscGain.gain.linearRampToValueAtTime(isFill ? 0.12 : 0.16, time + 0.003);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

    osc.connect(oscGain);
    oscGain.connect(compressor);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(850, time);

    const noiseGain = ctx.createGain();
    const peak = isFill ? 0.11 : 0.15;
    noiseGain.gain.setValueAtTime(0.0001, time);
    noiseGain.gain.linearRampToValueAtTime(peak, time + 0.003);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(compressor);

    osc.onended = function () {
      try {
        osc.disconnect();
        oscGain.disconnect();
      } catch (e) {}
    };
    noise.onended = function () {
      try {
        noise.disconnect();
        filter.disconnect();
        noiseGain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + 0.09);
    noise.start(time);
    noise.stop(time + 0.14);
  }

  // 7. Batería Sintética Arcade: Hi-Hat Cerrado / Abierto
  function playHiHat(time, isOpen) {
    if (!noiseBuffer) return;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(5800, time);

    const gain = ctx.createGain();
    const dur = isOpen ? 0.14 : 0.038;
    const peak = isOpen ? 0.065 : 0.042;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(compressor);

    noise.onended = function () {
      try {
        noise.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    noise.start(time);
    noise.stop(time + dur + 0.01);
  }

  /* =========================================================================
     PROGRAMADOR DE PASOS (SCHEDULER CON LOOKAHEAD)
  ========================================================================= */

  function scheduleStep(stepIndex, time) {
    const bar = Math.floor(stepIndex / STEPS_PER_BAR);
    const stepInBar = stepIndex % STEPS_PER_BAR;
    const harmony = HARMONY_MAP[bar];
    const rootMidi = harmony[0];
    const arpChord = harmony[1];

    const isSectionB = bar >= 8 && bar < 16;
    const isSectionC = bar >= 16 && bar < 24;
    const isSectionD = bar >= 24;
    const isTurnaroundBar = (bar % 8 === 7);

    // 1. Impacto armónico en el inicio de cada bloque de 4 compases
    if (stepInBar === 0 && (bar % 4 === 0)) {
      playChordStab(arpChord, time, STEP_DURATION * 4);
    }

    // 2. Línea de Bajo Pulsante (salto de octava estilo arcade 2000s)
    if (!isSectionC || bar >= 20) {
      if (stepInBar % 2 === 0) {
        playBass(rootMidi, time, STEP_DURATION * 0.92, stepInBar % 4 === 0);
      } else if (stepInBar % 4 === 2 || isSectionB || isSectionD) {
        const fifthOrOctave = (stepInBar === 15 && isTurnaroundBar) ? rootMidi + 7 : rootMidi + 12;
        playBass(fifthOrOctave, time, STEP_DURATION * 0.85, false);
      }
    } else {
      if (stepInBar === 0 || stepInBar === 6 || stepInBar === 10 || stepInBar === 12) {
        const note = stepInBar === 10 ? rootMidi + 12 : rootMidi;
        playBass(note, time, STEP_DURATION * 1.8, stepInBar === 0);
      }
    }

    // 3. Arpegiador Rápido
    let pattern = ARP_PATTERNS.fastUp;
    if (isSectionB) pattern = ARP_PATTERNS.cosmicWave;
    else if (isSectionC && bar < 22) pattern = ARP_PATTERNS.nebulaBell;
    else if (isSectionD) pattern = ARP_PATTERNS.climaxRun;

    const arpIdx = pattern[stepInBar];
    if (arpIdx !== null && arpIdx !== undefined) {
      const octaveBoost = (isSectionD && stepInBar % 4 === 3) ? 12 : 0;
      playArp(arpChord[arpIdx] + octaveBoost, time, STEP_DURATION * 0.9, isSectionD);
    }

    // 4. Melodía Principal Original
    const barNotes = LEAD_MELODY[bar];
    if (barNotes) {
      for (let i = 0; i < barNotes.length; i++) {
        const ev = barNotes[i];
        if (ev.s === stepInBar) {
          playLead(ev.n, time, ev.l * STEP_DURATION * 0.96, ev.t);
        }
      }
    }

    // 5. Batería Sintética Ligera
    if (!isSectionC || bar >= 20) {
      if (stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12 || (isSectionD && stepInBar === 10)) {
        playKick(time);
      }
    } else if (stepInBar === 0 || stepInBar === 10) {
      playKick(time);
    }

    if (stepInBar === 4 || stepInBar === 12) {
      playSnare(time, false);
    } else if (isTurnaroundBar && (stepInBar === 11 || stepInBar === 13 || stepInBar === 14 || stepInBar === 15)) {
      playSnare(time, true);
    }

    if (isSectionB || isSectionD) {
      if (stepInBar % 4 === 2) {
        playHiHat(time, true);
      } else if (stepInBar % 2 === 0) {
        playHiHat(time, false);
      }
    } else if (stepInBar % 2 === 0) {
      playHiHat(time, stepInBar === 14);
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
      currentStep = (currentStep + 1) % TOTAL_STEPS;
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

    if (ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }

    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
    masterGain.gain.linearRampToValueAtTime(currentVolume, now + 0.06);

    if (!isRunning) {
      isRunning = true;
      nextNoteTime = ctx.currentTime + 0.03;
      schedulerTick();
    }
    return true;
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
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
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
    }
  };

  window.VetAtlasMusic = VetAtlasMusic;

  /* =========================================================================
     GESTIÓN ROBUSTA DE INTERACCIÓN Y #audio-toggle-btn (CAPTURA + BURBUJEO)
  ========================================================================= */

  function isEventOnAudioToggle(e) {
    if (!e || !e.target || typeof e.target.closest !== 'function') return false;
    return Boolean(e.target.closest('#audio-toggle-btn'));
  }

  function onFirstUserGesture(e) {
    userInteracted = true;

    // Si la primera interacción no fue sobre #audio-toggle-btn y no está silenciado, arrancamos
    if (!isEventOnAudioToggle(e) && !isMutedInStorage()) {
      shouldResumeOnVisible = true;
      beginPlaybackInternal();
    }

    window.removeEventListener('pointerdown', onFirstUserGesture, true);
    window.removeEventListener('touchstart', onFirstUserGesture, true);
    window.removeEventListener('keydown', onFirstUserGesture, true);
  }

  window.addEventListener('pointerdown', onFirstUserGesture, { capture: true, passive: true });
  window.addEventListener('touchstart', onFirstUserGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onFirstUserGesture, { capture: true, passive: true });

  // 1) FASE DE CAPTURA en window: corre SIEMPRE ANTES que el listener bubble de index.html
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
      // Leemos el estado real antes de que index.html modifique localStorage
      const mutedBeforeClick = isMutedInStorage();
      const targetMuted = !mutedBeforeClick;
      pendingToggleMuted = targetMuted;
      applyMuteState(targetMuted);
    }
  }, true);

  // 2) FASE DE BURBUJEO en window: corre SIEMPRE DESPUÉS que el listener bubble de index.html
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