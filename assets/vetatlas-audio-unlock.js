/**
 * AMC VetAtlas - Desbloqueo de Web Audio para iOS Safari (vetatlas-audio-unlock.js)
 * Se carga en el <head> de cada página, antes que cualquier AudioContext.
 *   - iOS solo desbloquea un AudioContext dentro de touchend/click: en cada gesto
 *     se llama ctx.resume() y se reproduce un buffer silencioso de 1 muestra.
 *     Los listeners siguen activos hasta que todos los contextos están 'running'.
 *   - navigator.audioSession.type = 'playback' para que el interruptor de
 *     silencio del iPhone no calle la música ni los efectos.
 *   - Reanuda los contextos 'suspended' / 'interrupted' al volver a la pestaña
 *     o tras una llamada, salvo que el usuario haya silenciado el audio.
 * Cada AudioContext creado en la página se registra solo (constructor envuelto);
 * también se puede registrar a mano con window.VetAtlasAudio.register(ctx).
 */
(function (window, document) {
  'use strict';

  if (window.VetAtlasAudio) return;

  const STORAGE_KEY = 'vetatlas-audio-muted';
  const GESTURE_EVENTS = ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'];

  const contexts = [];
  let listening = false;

  function isMuted() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function setPlaybackSession() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback';
      }
    } catch (e) {}
  }

  function isIdle(ctx) {
    return ctx.state === 'suspended' || ctx.state === 'interrupted';
  }

  function resumeContext(ctx) {
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  // Dentro de un gesto: resume() + buffer silencioso de 1 muestra (requisito de iOS)
  function unlock(ctx) {
    if (!ctx || !isIdle(ctx)) return;
    setPlaybackSession();
    resumeContext(ctx);
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.onended = function () {
        try { src.disconnect(); } catch (e) {}
      };
      src.start(0);
    } catch (e) {}
  }

  function allRunning() {
    for (let i = 0; i < contexts.length; i++) {
      if (contexts[i].state !== 'running' && contexts[i].state !== 'closed') return false;
    }
    return true;
  }

  function onGesture() {
    if (!isMuted()) {
      for (let i = 0; i < contexts.length; i++) unlock(contexts[i]);
    }
    if (contexts.length && allRunning()) stopListening();
  }

  // Captura (antes que la página) y burbujeo (después de que un botón de sonido cambie el silencio)
  function startListening() {
    if (listening) return;
    listening = true;
    GESTURE_EVENTS.forEach(function (evt) {
      window.addEventListener(evt, onGesture, { capture: true, passive: true });
      window.addEventListener(evt, onGesture, { passive: true });
    });
  }

  function stopListening() {
    if (!listening) return;
    listening = false;
    GESTURE_EVENTS.forEach(function (evt) {
      window.removeEventListener(evt, onGesture, true);
      window.removeEventListener(evt, onGesture, false);
    });
  }

  // Al volver a la pestaña o tras una interrupción (llamada, Siri...) se reanuda si no está silenciado
  function resumeIdle() {
    if (document.hidden || isMuted()) return;
    for (let i = 0; i < contexts.length; i++) {
      if (isIdle(contexts[i])) {
        resumeContext(contexts[i]);
        startListening();
      }
    }
  }

  function register(ctx) {
    if (!ctx || contexts.indexOf(ctx) !== -1) return ctx;
    contexts.push(ctx);
    if (typeof ctx.addEventListener === 'function') {
      ctx.addEventListener('statechange', function () {
        if (isIdle(ctx)) resumeIdle();
      });
    }
    if (ctx.state !== 'running') startListening();
    return ctx;
  }

  function wrapConstructor(name) {
    const Native = window[name];
    if (typeof Native !== 'function') return;
    try {
      const Tracked = class extends Native {
        constructor() {
          super(...arguments);
          register(this);
        }
      };
      window[name] = Tracked;
    } catch (e) {}
  }

  wrapConstructor('AudioContext');
  wrapConstructor('webkitAudioContext');
  setPlaybackSession();

  document.addEventListener('visibilitychange', resumeIdle);
  window.addEventListener('pageshow', resumeIdle);
  window.addEventListener('focus', resumeIdle);

  window.VetAtlasAudio = {
    register: register,
    unlock: unlock
  };
})(window, document);
