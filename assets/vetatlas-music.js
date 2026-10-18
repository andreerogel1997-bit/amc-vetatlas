/**
 * AMC VetAtlas - Cargador de música de fondo (vetatlas-music.js)
 * En cada visita elige al azar una de las dos pistas originales y la carga
 * de forma síncrona, así window.VetAtlasMusic existe igual que antes.
 *   - vetatlas-music-epic.js      (épica espacial, 145 BPM)
 *   - vetatlas-music-chiptune.js  (chiptune 8 bits)
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
  if (document.readyState === 'loading') {
    document.write('<script src="' + src + '"><' + '/script>');
  } else {
    var s = document.createElement('script');
    s.src = src;
    document.head.appendChild(s);
  }
})(window, document);
