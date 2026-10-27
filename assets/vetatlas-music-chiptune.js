/**
 * AMC VetAtlas - 8-Bit Chiptune Background Music Engine (vetatlas-music.js)
 * 100% Web Audio API | Ondas de pulso 12.5% / 25% / 50% + Bajo Triangular + Ruido 8-Bit
 * Estructura A-A-B-A en Sol Mayor @ 160 BPM (24 compases = 36 s por bucle)
 */
(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'vetatlas-audio-muted';
  const DEFAULT_VOLUME = 0.20;
  const BPM = 160;
  const STEP_DURATION = 60 / BPM / 4; // Semicorchea (~0.09375 s)
  const LOOKAHEAD_MS = 25;            // Reloj del scheduler en ms
  const SCHEDULE_AHEAD_SEC = 0.12;    // Ventana de programación anticipada en s
  const TOTAL_BARS = 24;              // Estructura A (6) + A' (6) + B (6) + A'' (6)
  const STEPS_PER_BAR = 16;
  const TOTAL_STEPS = TOTAL_BARS * STEPS_PER_BAR; // 384 pasos (36.0 s)

  let ctx = null;
  let masterGain = null;
  let compressor = null;
  let noiseBuffer = null;
  let pulseWaves = null; // { p125, p25, p50 }

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

  /* =========================================================================
     COMPOSICIÓN CHIPTUNE 8-BIT ORIGINAL EN SOL MAYOR (ESTRUCTURA A - A' - B - A'')
     - Sección A  (Compases 0-5):   Gancho de 2 compases + Variación alta + Cadencia
     - Sección A' (Compases 6-11):  Repetición del gancho con resolución triunfal
     - Sección B  (Compases 12-17): Puente aventurero con timbre 12.5% y llamada/respuesta
     - Sección A''(Compases 18-23): Retorno climático con floreo final de 8 bits
  ========================================================================= */

  // Mapa de bajo triangular por compás: arreglo de 8 corcheas (pasos pares 0,2,4,6,8,10,12,14)
  const BASS_MAP = [
    // --- Sección A (0-5) ---
    [43, 55, 50, 55, 40, 52, 47, 52], // G -> E7
    [45, 57, 48, 57, 50, 62, 52, 54], // Am7 -> D7 (walking)
    [43, 55, 50, 55, 43, 55, 47, 53], // G -> G7
    [48, 60, 52, 60, 48, 60, 51, 55], // C -> Cm6
    [43, 55, 47, 50, 40, 52, 44, 47], // G/B -> E7
    [45, 49, 52, 57, 50, 54, 57, 50], // A7 -> D7

    // --- Sección A' (6-11) ---
    [43, 55, 50, 55, 40, 52, 47, 52], // G -> E7
    [45, 57, 48, 57, 50, 62, 54, 50], // Am7 -> D7
    [43, 55, 50, 55, 43, 55, 47, 53], // G -> G7
    [48, 60, 52, 60, 48, 60, 51, 55], // C -> Cm6
    [43, 50, 55, 52, 45, 52, 50, 54], // G -> Am7 -> D7
    [43, 50, 47, 50, 43, 55, 50, 43], // G resolución

    // --- Sección B (12-17) ---
    [48, 60, 55, 60, 48, 60, 52, 55], // Cmaj7
    [50, 62, 57, 62, 50, 54, 57, 60], // D7
    [47, 59, 54, 59, 40, 52, 47, 52], // Bm7 -> Em7
    [45, 57, 49, 52, 50, 62, 54, 57], // A7 -> D7
    [48, 60, 52, 55, 49, 61, 52, 55], // C -> C#dim7
    [50, 50, 52, 52, 54, 54, 50, 45], // D7 corte rítmico y subida

    // --- Sección A'' (18-23) ---
    [43, 55, 50, 55, 40, 52, 47, 52], // G -> E7
    [45, 57, 48, 57, 50, 62, 52, 54], // Am7 -> D7
    [43, 55, 50, 55, 43, 55, 47, 53], // G -> G7
    [48, 60, 52, 60, 48, 60, 51, 55], // C -> Cm6
    [43, 55, 47, 50, 40, 52, 44, 47], // G -> E7
    [45, 52, 50, 54, 43, 50, 55, 43]  // Am7 -> D7 -> G final
  ];

  // Melodía Protagonista (Canal Pulse 1):
  // s: paso(0-15), n: nota MIDI, l: duración en pasos, w: duty('p25'|'p125'|'p50'), slide: adorno opcional
  const LEAD_MELODY = [
    // ================= SECCIÓN A (Compases 0-5) =================
    // Compás 0-1: GANCHO PRINCIPAL DE 2 COMPASES (Sincopado y saltarín)
    [
      { s: 0, n: 74, l: 2, w: 'p25' }, { s: 2, n: 71, l: 1, w: 'p25' },
      { s: 3, n: 74, l: 3, w: 'p25', slide: true }, { s: 6, n: 79, l: 2, w: 'p25' },
      { s: 8, n: 76, l: 2, w: 'p25' }, { s: 10, n: 71, l: 1, w: 'p25' },
      { s: 11, n: 74, l: 3, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 72, l: 2, w: 'p25' }, { s: 2, n: 69, l: 1, w: 'p25' },
      { s: 3, n: 72, l: 3, w: 'p25', slide: true }, { s: 6, n: 76, l: 2, w: 'p25' },
      { s: 8, n: 74, l: 3, w: 'p25' }, { s: 11, n: 71, l: 1, w: 'p25' },
      { s: 12, n: 69, l: 2, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    // Compás 2-3: VARIACIÓN DEL GANCHO (Salto al registro agudo A5/G5 y giro modal C -> Cm6)
    [
      { s: 0, n: 74, l: 2, w: 'p25' }, { s: 2, n: 71, l: 1, w: 'p25' },
      { s: 3, n: 74, l: 3, w: 'p25', slide: true }, { s: 6, n: 81, l: 2, w: 'p125' },
      { s: 8, n: 79, l: 2, w: 'p25' }, { s: 10, n: 74, l: 1, w: 'p25' },
      { s: 11, n: 77, l: 3, w: 'p25' }, { s: 14, n: 74, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 76, l: 2, w: 'p25' }, { s: 2, n: 72, l: 1, w: 'p25' },
      { s: 3, n: 76, l: 3, w: 'p25', slide: true }, { s: 6, n: 79, l: 2, w: 'p125' },
      { s: 8, n: 78, l: 1, w: 'p125' }, { s: 9, n: 79, l: 2, w: 'p25' },
      { s: 11, n: 75, l: 3, w: 'p25' }, { s: 14, n: 74, l: 2, w: 'p25' }
    ],
    // Compás 4-5: CADENCIA Y RETORNO (Ragtime chiptune bounce)
    [
      { s: 0, n: 71, l: 2, w: 'p25' }, { s: 2, n: 74, l: 2, w: 'p25' },
      { s: 4, n: 79, l: 3, w: 'p125', slide: true }, { s: 7, n: 76, l: 1, w: 'p25' },
      { s: 8, n: 74, l: 2, w: 'p25' }, { s: 10, n: 71, l: 2, w: 'p25' },
      { s: 12, n: 68, l: 2, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 69, l: 2, w: 'p25' }, { s: 2, n: 73, l: 2, w: 'p25' },
      { s: 4, n: 76, l: 2, w: 'p25' }, { s: 6, n: 79, l: 2, w: 'p125' },
      { s: 8, n: 78, l: 3, w: 'p25', slide: true }, { s: 11, n: 76, l: 1, w: 'p25' },
      { s: 12, n: 74, l: 2, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],

    // ================= SECCIÓN A' (Compases 6-11) =================
    // Compás 6-7: Gancho principal con articulación brillante
    [
      { s: 0, n: 74, l: 2, w: 'p25' }, { s: 2, n: 71, l: 1, w: 'p25' },
      { s: 3, n: 74, l: 3, w: 'p25', slide: true }, { s: 6, n: 79, l: 2, w: 'p25' },
      { s: 8, n: 76, l: 2, w: 'p25' }, { s: 10, n: 71, l: 1, w: 'p25' },
      { s: 11, n: 74, l: 3, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 72, l: 2, w: 'p25' }, { s: 2, n: 69, l: 1, w: 'p25' },
      { s: 3, n: 72, l: 3, w: 'p25', slide: true }, { s: 6, n: 76, l: 2, w: 'p25' },
      { s: 8, n: 74, l: 3, w: 'p25' }, { s: 11, n: 76, l: 1, w: 'p25' },
      { s: 12, n: 78, l: 2, w: 'p125' }, { s: 14, n: 79, l: 2, w: 'p125' }
    ],
    // Compás 8-9: Variación del gancho con floritura superior (B5)
    [
      { s: 0, n: 74, l: 2, w: 'p25' }, { s: 2, n: 71, l: 1, w: 'p25' },
      { s: 3, n: 74, l: 3, w: 'p25', slide: true }, { s: 6, n: 83, l: 2, w: 'p125' },
      { s: 8, n: 79, l: 2, w: 'p25' }, { s: 10, n: 77, l: 1, w: 'p25' },
      { s: 11, n: 74, l: 3, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 76, l: 2, w: 'p25' }, { s: 2, n: 72, l: 1, w: 'p25' },
      { s: 3, n: 76, l: 3, w: 'p25', slide: true }, { s: 6, n: 81, l: 2, w: 'p125' },
      { s: 8, n: 79, l: 2, w: 'p25' }, { s: 10, n: 75, l: 2, w: 'p25' },
      { s: 12, n: 74, l: 2, w: 'p25' }, { s: 14, n: 72, l: 2, w: 'p25' }
    ],
    // Compás 10-11: Cadencia conclusiva en Tónica (Sol Mayor)
    [
      { s: 0, n: 71, l: 2, w: 'p25' }, { s: 2, n: 74, l: 1, w: 'p25' },
      { s: 3, n: 79, l: 3, w: 'p125', slide: true }, { s: 6, n: 76, l: 2, w: 'p25' },
      { s: 8, n: 72, l: 2, w: 'p25' }, { s: 10, n: 74, l: 1, w: 'p25' },
      { s: 11, n: 78, l: 3, w: 'p125' }, { s: 14, n: 74, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 79, l: 4, w: 'p25', slide: true }, { s: 4, n: 74, l: 2, w: 'p50' },
      { s: 6, n: 71, l: 2, w: 'p50' }, { s: 8, n: 74, l: 2, w: 'p25' },
      { s: 10, n: 76, l: 2, w: 'p25' }, { s: 12, n: 79, l: 4, w: 'p125' }
    ],

    // ================= SECCIÓN B: PUENTE AVENTURERO (Compases 12-17) =================
    // Timbre 12.5% protagonista con síncopas de llamada y respuesta
    [
      { s: 0, n: 79, l: 3, w: 'p125', slide: true }, { s: 3, n: 76, l: 1, w: 'p125' },
      { s: 4, n: 72, l: 2, w: 'p125' }, { s: 6, n: 76, l: 2, w: 'p125' },
      { s: 8, n: 79, l: 3, w: 'p125' }, { s: 11, n: 81, l: 1, w: 'p125' },
      { s: 12, n: 79, l: 2, w: 'p125' }, { s: 14, n: 76, l: 2, w: 'p125' }
    ],
    [
      { s: 0, n: 78, l: 3, w: 'p125', slide: true }, { s: 3, n: 74, l: 1, w: 'p125' },
      { s: 4, n: 69, l: 2, w: 'p125' }, { s: 6, n: 74, l: 2, w: 'p125' },
      { s: 8, n: 78, l: 3, w: 'p125' }, { s: 11, n: 79, l: 1, w: 'p125' },
      { s: 12, n: 81, l: 4, w: 'p125' }
    ],
    [
      { s: 0, n: 83, l: 3, w: 'p125', slide: true }, { s: 3, n: 78, l: 1, w: 'p125' },
      { s: 4, n: 74, l: 2, w: 'p125' }, { s: 6, n: 78, l: 2, w: 'p125' },
      { s: 8, n: 79, l: 3, w: 'p125' }, { s: 11, n: 76, l: 1, w: 'p125' },
      { s: 12, n: 71, l: 4, w: 'p125' }
    ],
    [
      { s: 0, n: 76, l: 2, w: 'p125' }, { s: 2, n: 73, l: 1, w: 'p125' },
      { s: 3, n: 76, l: 3, w: 'p125', slide: true }, { s: 6, n: 81, l: 2, w: 'p125' },
      { s: 8, n: 78, l: 2, w: 'p125' }, { s: 10, n: 74, l: 2, w: 'p125' },
      { s: 12, n: 76, l: 2, w: 'p125' }, { s: 14, n: 78, l: 2, w: 'p125' }
    ],
    [
      { s: 0, n: 79, l: 2, w: 'p125' }, { s: 2, n: 76, l: 1, w: 'p125' },
      { s: 3, n: 79, l: 3, w: 'p125', slide: true }, { s: 6, n: 81, l: 2, w: 'p125' },
      { s: 8, n: 82, l: 2, w: 'p125' }, { s: 10, n: 79, l: 1, w: 'p125' },
      { s: 11, n: 76, l: 3, w: 'p125' }, { s: 14, n: 73, l: 2, w: 'p125' }
    ],
    // Compás 17: Subida de tensión en D7 para relanzar el gancho A
    [
      { s: 0, n: 74, l: 2, w: 'p25' }, { s: 2, n: 76, l: 2, w: 'p25' },
      { s: 4, n: 78, l: 2, w: 'p25' }, { s: 6, n: 79, l: 2, w: 'p125' },
      { s: 8, n: 81, l: 3, w: 'p125', slide: true }, { s: 11, n: 78, l: 1, w: 'p125' },
      { s: 12, n: 74, l: 2, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],

    // ================= SECCIÓN A'': RETORNO CLIMÁTICO (Compases 18-23) =================
    [
      { s: 0, n: 74, l: 2, w: 'p25' }, { s: 2, n: 71, l: 1, w: 'p25' },
      { s: 3, n: 74, l: 3, w: 'p25', slide: true }, { s: 6, n: 79, l: 2, w: 'p125' },
      { s: 8, n: 76, l: 2, w: 'p25' }, { s: 10, n: 71, l: 1, w: 'p25' },
      { s: 11, n: 74, l: 3, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 72, l: 2, w: 'p25' }, { s: 2, n: 69, l: 1, w: 'p25' },
      { s: 3, n: 72, l: 3, w: 'p25', slide: true }, { s: 6, n: 76, l: 2, w: 'p125' },
      { s: 8, n: 74, l: 3, w: 'p25' }, { s: 11, n: 71, l: 1, w: 'p25' },
      { s: 12, n: 69, l: 2, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 74, l: 2, w: 'p25' }, { s: 2, n: 71, l: 1, w: 'p25' },
      { s: 3, n: 74, l: 3, w: 'p25', slide: true }, { s: 6, n: 83, l: 2, w: 'p125' },
      { s: 8, n: 81, l: 2, w: 'p125' }, { s: 10, n: 79, l: 1, w: 'p25' },
      { s: 11, n: 77, l: 3, w: 'p25' }, { s: 14, n: 74, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 76, l: 2, w: 'p25' }, { s: 2, n: 72, l: 1, w: 'p25' },
      { s: 3, n: 76, l: 3, w: 'p25', slide: true }, { s: 6, n: 84, l: 2, w: 'p125' },
      { s: 8, n: 83, l: 2, w: 'p125' }, { s: 10, n: 79, l: 1, w: 'p25' },
      { s: 11, n: 75, l: 3, w: 'p25' }, { s: 14, n: 74, l: 2, w: 'p25' }
    ],
    [
      { s: 0, n: 71, l: 2, w: 'p25' }, { s: 2, n: 74, l: 2, w: 'p25' },
      { s: 4, n: 79, l: 3, w: 'p125', slide: true }, { s: 7, n: 76, l: 1, w: 'p25' },
      { s: 8, n: 74, l: 2, w: 'p25' }, { s: 10, n: 71, l: 2, w: 'p25' },
      { s: 12, n: 68, l: 2, w: 'p25' }, { s: 14, n: 71, l: 2, w: 'p25' }
    ],
    // Compás 23: Gran cierre con arpegio rápido de 8 bits de vuelta al compás 0
    [
      { s: 0, n: 72, l: 2, w: 'p25' }, { s: 2, n: 76, l: 2, w: 'p25' },
      { s: 4, n: 78, l: 2, w: 'p125' }, { s: 6, n: 81, l: 2, w: 'p125' },
      { s: 8, n: 79, l: 4, w: 'p25', slide: true },
      { s: 12, n: 67, l: 1, w: 'p125' }, { s: 13, n: 71, l: 1, w: 'p125' },
      { s: 14, n: 74, l: 1, w: 'p125' }, { s: 15, n: 79, l: 1, w: 'p125' }
    ]
  ];

  // Contracanto Sencillo y Armonía Rítmica (Canal Pulse 2 - 50% y 25% duty cycle)
  const COUNTER_MELODY = [
    // --- Sección A (0-5) ---
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 71, l: 2, w: 'p50' }, { s: 6, n: 74, l: 2, w: 'p50' }, { s: 8, n: 68, l: 2, w: 'p50' }, { s: 12, n: 71, l: 2, w: 'p50' }, { s: 14, n: 68, l: 2, w: 'p50' } ],
    [ { s: 0, n: 64, l: 2, w: 'p50' }, { s: 4, n: 69, l: 2, w: 'p50' }, { s: 6, n: 72, l: 2, w: 'p50' }, { s: 8, n: 66, l: 3, w: 'p50' }, { s: 12, n: 66, l: 2, w: 'p50' }, { s: 14, n: 69, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 71, l: 2, w: 'p50' }, { s: 6, n: 74, l: 2, w: 'p50' }, { s: 8, n: 71, l: 2, w: 'p50' }, { s: 12, n: 71, l: 2, w: 'p50' }, { s: 14, n: 67, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 72, l: 2, w: 'p50' }, { s: 6, n: 76, l: 2, w: 'p50' }, { s: 8, n: 72, l: 3, w: 'p50' }, { s: 11, n: 69, l: 3, w: 'p50' }, { s: 14, n: 66, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 4, w: 'p50' }, { s: 4, n: 71, l: 4, w: 'p50' }, { s: 8, n: 68, l: 4, w: 'p50' }, { s: 12, n: 64, l: 4, w: 'p50' } ],
    [ { s: 0, n: 64, l: 4, w: 'p50' }, { s: 4, n: 69, l: 4, w: 'p50' }, { s: 8, n: 66, l: 4, w: 'p50' }, { s: 12, n: 69, l: 2, w: 'p50' }, { s: 14, n: 66, l: 2, w: 'p50' } ],

    // --- Sección A' (6-11) ---
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 71, l: 2, w: 'p50' }, { s: 6, n: 74, l: 2, w: 'p50' }, { s: 8, n: 68, l: 2, w: 'p50' }, { s: 12, n: 71, l: 2, w: 'p50' }, { s: 14, n: 68, l: 2, w: 'p50' } ],
    [ { s: 0, n: 64, l: 2, w: 'p50' }, { s: 4, n: 69, l: 2, w: 'p50' }, { s: 6, n: 72, l: 2, w: 'p50' }, { s: 8, n: 66, l: 3, w: 'p50' }, { s: 12, n: 69, l: 2, w: 'p50' }, { s: 14, n: 72, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 71, l: 2, w: 'p50' }, { s: 6, n: 74, l: 2, w: 'p50' }, { s: 8, n: 71, l: 2, w: 'p50' }, { s: 12, n: 67, l: 2, w: 'p50' }, { s: 14, n: 65, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 72, l: 2, w: 'p50' }, { s: 6, n: 72, l: 2, w: 'p50' }, { s: 8, n: 72, l: 2, w: 'p50' }, { s: 10, n: 69, l: 2, w: 'p50' }, { s: 12, n: 66, l: 4, w: 'p50' } ],
    [ { s: 0, n: 67, l: 3, w: 'p50' }, { s: 3, n: 71, l: 3, w: 'p50' }, { s: 6, n: 67, l: 2, w: 'p50' }, { s: 8, n: 64, l: 3, w: 'p50' }, { s: 11, n: 69, l: 3, w: 'p50' }, { s: 14, n: 66, l: 2, w: 'p50' } ],
    [ { s: 0, n: 71, l: 4, w: 'p50' }, { s: 4, n: 67, l: 4, w: 'p50' }, { s: 8, n: 67, l: 2, w: 'p50' }, { s: 10, n: 69, l: 2, w: 'p50' }, { s: 12, n: 71, l: 4, w: 'p50' } ],

    // --- Sección B: Contracanto activo en respuesta al Lead (12-17) ---
    [ { s: 0, n: 64, l: 4, w: 'p50' }, { s: 4, n: 67, l: 2, w: 'p25' }, { s: 6, n: 71, l: 2, w: 'p25' }, { s: 8, n: 72, l: 4, w: 'p50' }, { s: 12, n: 71, l: 2, w: 'p25' }, { s: 14, n: 67, l: 2, w: 'p25' } ],
    [ { s: 0, n: 66, l: 4, w: 'p50' }, { s: 4, n: 69, l: 2, w: 'p25' }, { s: 6, n: 72, l: 2, w: 'p25' }, { s: 8, n: 74, l: 4, w: 'p50' }, { s: 12, n: 72, l: 2, w: 'p25' }, { s: 14, n: 69, l: 2, w: 'p25' } ],
    [ { s: 0, n: 71, l: 4, w: 'p50' }, { s: 4, n: 66, l: 4, w: 'p50' }, { s: 8, n: 67, l: 4, w: 'p50' }, { s: 12, n: 64, l: 2, w: 'p25' }, { s: 14, n: 67, l: 2, w: 'p25' } ],
    [ { s: 0, n: 69, l: 3, w: 'p50' }, { s: 3, n: 69, l: 3, w: 'p50' }, { s: 6, n: 73, l: 2, w: 'p50' }, { s: 8, n: 69, l: 2, w: 'p50' }, { s: 10, n: 66, l: 2, w: 'p50' }, { s: 12, n: 69, l: 2, w: 'p50' }, { s: 14, n: 72, l: 2, w: 'p50' } ],
    [ { s: 0, n: 72, l: 3, w: 'p50' }, { s: 3, n: 72, l: 3, w: 'p50' }, { s: 6, n: 72, l: 2, w: 'p50' }, { s: 8, n: 70, l: 3, w: 'p50' }, { s: 11, n: 70, l: 3, w: 'p50' }, { s: 14, n: 67, l: 2, w: 'p50' } ],
    [ { s: 0, n: 66, l: 2, w: 'p25' }, { s: 2, n: 67, l: 2, w: 'p25' }, { s: 4, n: 69, l: 2, w: 'p25' }, { s: 6, n: 71, l: 2, w: 'p25' }, { s: 8, n: 72, l: 4, w: 'p25' }, { s: 12, n: 69, l: 2, w: 'p25' }, { s: 14, n: 66, l: 2, w: 'p25' } ],

    // --- Sección A'' (18-23) ---
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 71, l: 2, w: 'p50' }, { s: 6, n: 74, l: 2, w: 'p50' }, { s: 8, n: 68, l: 2, w: 'p50' }, { s: 12, n: 71, l: 2, w: 'p50' }, { s: 14, n: 68, l: 2, w: 'p50' } ],
    [ { s: 0, n: 64, l: 2, w: 'p50' }, { s: 4, n: 69, l: 2, w: 'p50' }, { s: 6, n: 72, l: 2, w: 'p50' }, { s: 8, n: 66, l: 3, w: 'p50' }, { s: 12, n: 66, l: 2, w: 'p50' }, { s: 14, n: 69, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 71, l: 2, w: 'p50' }, { s: 6, n: 74, l: 2, w: 'p50' }, { s: 8, n: 74, l: 2, w: 'p50' }, { s: 11, n: 71, l: 3, w: 'p50' }, { s: 14, n: 67, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 2, w: 'p50' }, { s: 4, n: 72, l: 2, w: 'p50' }, { s: 6, n: 76, l: 2, w: 'p50' }, { s: 8, n: 75, l: 2, w: 'p50' }, { s: 11, n: 72, l: 3, w: 'p50' }, { s: 14, n: 69, l: 2, w: 'p50' } ],
    [ { s: 0, n: 67, l: 4, w: 'p50' }, { s: 4, n: 71, l: 4, w: 'p50' }, { s: 8, n: 68, l: 4, w: 'p50' }, { s: 12, n: 64, l: 4, w: 'p50' } ],
    [ { s: 0, n: 64, l: 2, w: 'p50' }, { s: 2, n: 69, l: 2, w: 'p50' }, { s: 4, n: 69, l: 2, w: 'p50' }, { s: 6, n: 72, l: 2, w: 'p50' }, { s: 8, n: 71, l: 4, w: 'p50' }, { s: 12, n: 67, l: 4, w: 'p50' } ]
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
     INICIALIZACIÓN DE WEB AUDIO API Y TABLAS DE PULSO (12.5%, 25%, 50%)
  ========================================================================= */

  function createPulseWave(audioCtx, duty) {
    const harmonics = 48;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    real[0] = 0;
    imag[0] = 0;
    for (let n = 1; n <= harmonics; n++) {
      // Serie de Fourier para onda rectangular de ancho de pulso `duty`
      real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
      imag[n] = 0;
    }
    return audioCtx.createPeriodicWave(real, imag);
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

      masterGain = ctx.createGain();
      const initialGain = isMutedInStorage() ? 0.0001 : currentVolume;
      masterGain.gain.setValueAtTime(initialGain, ctx.currentTime);

      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Crear las 3 formas de onda de pulso clásicas de 8 bits (12.5%, 25%, 50%)
      pulseWaves = {
        p125: createPulseWave(ctx, 0.125),
        p25:  createPulseWave(ctx, 0.25),
        p50:  createPulseWave(ctx, 0.50)
      };

      // Buffer de ruido escalonado estilo LFSR de 8 bits para la batería
      const length = Math.floor(ctx.sampleRate * 0.22);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const out = noiseBuffer.getChannelData(0);
      let hold = 0;
      for (let i = 0; i < length; i++) {
        // Cuantización cada 3 muestras para textura crujiente de consola clásica
        if (i % 3 === 0) {
          hold = (Math.random() > 0.5 ? 1 : -1) * 0.65;
        }
        out[i] = hold;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /* =========================================================================
     VOCES CHIPTUNE DE 8 BITS (CON AUTO-DESCONEXIÓN EN onended)
  ========================================================================= */

  // 1. Canal de Pulso (Melodía Protagonista y Contracanto)
  function playPulseVoice(midi, time, duration, waveKey, isCounter, hasSlide) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (pulseWaves && pulseWaves[waveKey]) {
      osc.setPeriodicWave(pulseWaves[waveKey]);
    } else {
      osc.type = 'square';
    }

    const targetFreq = mtof(midi);
    if (hasSlide) {
      // Pequeño mordente ascendente de semitono típico de consolas de 8 bits
      osc.frequency.setValueAtTime(mtof(midi - 1), time);
      osc.frequency.setValueAtTime(targetFreq, time + 0.024);
    } else {
      osc.frequency.setValueAtTime(targetFreq, time);
    }

    const peak = isCounter ? 0.115 : 0.22;
    const sustain = isCounter ? 0.085 : 0.165;
    const gateDur = duration * (isCounter ? 0.82 : 0.88);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.004);
    gain.gain.linearRampToValueAtTime(sustain, time + Math.min(0.035, gateDur * 0.4));
    gain.gain.setValueAtTime(sustain, time + Math.max(0.005, gateDur - 0.012));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + gateDur);

    osc.connect(gain);
    gain.connect(compressor);

    osc.onended = function () {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + gateDur + 0.005);
  }

  // 2. Canal de Bajo Triangular de 8 Bits
  function playTriangleBass(midi, time, duration, isDownbeat) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(mtof(midi), time);

    const peak = isDownbeat ? 0.34 : 0.28;
    const gateDur = duration * 0.84;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.004);
    gain.gain.setValueAtTime(peak * 0.85, time + gateDur * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + gateDur);

    osc.connect(gain);
    gain.connect(compressor);

    osc.onended = function () {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + gateDur + 0.005);
  }

  // 3. Bombo Chiptune (Pitch-drop rápido de consola)
  function play8BitKick(time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(165, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.065);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.32, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);

    osc.connect(gain);
    gain.connect(compressor);

    osc.onended = function () {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + 0.09);
  }

  // 4. Caja de Ruido de 8 Bits (Snare)
  function play8BitSnare(time, isFill) {
    if (!noiseBuffer) return;

    // Golpe de cuerpo corto
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, time);
    osc.frequency.exponentialRampToValueAtTime(110, time + 0.045);

    oscGain.gain.setValueAtTime(0.0001, time);
    oscGain.gain.linearRampToValueAtTime(isFill ? 0.11 : 0.15, time + 0.002);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    osc.connect(oscGain);
    oscGain.connect(compressor);

    // Ráfaga de ruido de 8 bits
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, time);
    filter.Q.setValueAtTime(1.2, time);

    const noiseGain = ctx.createGain();
    const peak = isFill ? 0.10 : 0.14;
    noiseGain.gain.setValueAtTime(0.0001, time);
    noiseGain.gain.linearRampToValueAtTime(peak, time + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.095);

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
    osc.stop(time + 0.055);
    noise.start(time);
    noise.stop(time + 0.10);
  }

  // 5. Hi-Hat de Ruido de 8 Bits
  function play8BitHat(time, isOpen) {
    if (!noiseBuffer) return;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(5200, time);

    const gain = ctx.createGain();
    const dur = isOpen ? 0.085 : 0.026;
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
    noise.stop(time + dur + 0.005);
  }

  /* =========================================================================
     PROGRAMADOR DE PASOS (SCHEDULER CON LOOKAHEAD)
  ========================================================================= */

  function scheduleStep(stepIndex, time) {
    const bar = Math.floor(stepIndex / STEPS_PER_BAR);
    const stepInBar = stepIndex % STEPS_PER_BAR;
    const isTurnaroundBar = (bar === 5 || bar === 11 || bar === 17 || bar === 23);

    // 1. Melodía Protagonista (Pulse 1)
    const leadEvents = LEAD_MELODY[bar];
    if (leadEvents) {
      for (let i = 0; i < leadEvents.length; i++) {
        const ev = leadEvents[i];
        if (ev.s === stepInBar) {
          playPulseVoice(ev.n, time, ev.l * STEP_DURATION, ev.w || 'p25', false, Boolean(ev.slide));
        }
      }
    }

    // 2. Contracanto Sencillo (Pulse 2)
    const counterEvents = COUNTER_MELODY[bar];
    if (counterEvents) {
      for (let i = 0; i < counterEvents.length; i++) {
        const ev = counterEvents[i];
        if (ev.s === stepInBar) {
          playPulseVoice(ev.n, time, ev.l * STEP_DURATION, ev.w || 'p50', true, false);
        }
      }
    }

    // 3. Bajo Triangular en Corcheas Saltarinas (con anticipación sincopada ocasional)
    const bassBar = BASS_MAP[bar];
    if (bassBar && stepInBar % 2 === 0) {
      const eigthIdx = stepInBar >> 1;
      const bassMidi = bassBar[eigthIdx];
      if (bassMidi) {
        playTriangleBass(bassMidi, time, STEP_DURATION * 2, stepInBar % 4 === 0);
      }
    }

    // 4. Batería de 8 Bits
    // Bombo en tiempos 1 y 3 + síncopa arcade en el paso 10
    if (stepInBar === 0 || stepInBar === 8 || (stepInBar === 10 && bar % 2 === 0)) {
      play8BitKick(time);
    }

    // Caja en tiempos 2 y 4 + redobles alegres de 8 bits al cerrar cada sección de 6 compases
    if (stepInBar === 4 || stepInBar === 12) {
      play8BitSnare(time, false);
    } else if (isTurnaroundBar && (stepInBar === 11 || stepInBar === 14 || stepInBar === 15)) {
      play8BitSnare(time, true);
    }

    // Hi-Hat ágil en contratiempos
    if (stepInBar % 4 === 2) {
      play8BitHat(time, true);
    } else if (stepInBar % 2 === 0) {
      play8BitHat(time, false);
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
      const mutedBeforeClick = isMutedInStorage();
      const targetMuted = !mutedBeforeClick;
      pendingToggleMuted = targetMuted;
      applyMuteState(targetMuted);
    }

    if (!isMutedInStorage()) unlockContext();
    releaseGestureListenersIfRunning();
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