/**
 * AMC VetAtlas - Cargador de música de fondo (vetatlas-music.js)
 * En cada visita elige al azar una de las dos pistas originales y la carga
 * de forma síncrona, así window.VetAtlasMusic existe igual que antes.
 *   - vetatlas-music-epic.js      (épica espacial, 145 BPM)
 *   - vetatlas-music-chiptune.js  (chiptune 8 bits)
 * Antes carga vetatlas-audio-unlock.js si la página aún no lo tiene.
 * La portada carga directamente vetatlas-music-epic.js.
 */
(function (window, document) {
  'use strict';
  var TRACKS = ['epic', 'chiptune'];
  var me = document.currentScript;
  var base = (me && me.src) ? me.src.replace(/[^/?#]*([?#].*)?$/, '') : 'assets/';
  var track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
  var src = base + 'vetatlas-music-' + track + '.js';
  window.VetAtlasMusicTrack = track;
  // Desbloqueo de Web Audio para iOS, por si la página no lo cargó en el <head>
  var srcs = window.VetAtlasAudio ? [src] : [base + 'vetatlas-audio-unlock.js', src];
  srcs.forEach(function (url) {
    if (document.readyState === 'loading') {
      document.write('<script src="' + url + '"><' + '/script>');
    } else {
      var s = document.createElement('script');
      s.src = url;
      s.async = false;
      document.head.appendChild(s);
    }
  });
})(window, document);
