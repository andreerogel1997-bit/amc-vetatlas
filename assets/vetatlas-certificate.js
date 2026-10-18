/* =============================================================================
   AMC VetAtlas · Certificado PNG compartido (script clásico, no ES module)
   -----------------------------------------------------------------------------
   API:
     VetAtlasCert.draw(canvas, opciones)        → Promise<canvas>
     VetAtlasCert.download(canvas, archivo?)    → Promise<boolean>
     VetAtlasCert.celebrate(canvas, { confeti }) → animación en la página (no en el PNG)
     VetAtlasCert.codigo(opciones)               → código de verificación determinista

   opciones de draw:
     nombre, curso, puntaje, total, fecha (Date | 'AAAA-MM-DD' | texto),
     tema: 'dark' | 'light', titulo?, temas?, insignia?, logoSrc?
   ============================================================================= */
(function () {
  'use strict';
  if (window.VetAtlasCert) return;

  // Lienzo lógico: proporción A4 horizontal
  const W = 1600;
  const H = 1131;
  const UMBRAL = 0.7;
  const NOMBRE_DEFECTO = 'Profesional Veterinario';
  const TITULO_DEFECTO = 'Certificado de Competencia Clínica';
  const TITULO_NO_APROBADO = 'Constancia de Participación';
  const MARCA = 'AMC VetAtlas · Animal Medical Center';
  const FIRMA = 'Andreé, médico veterinario';

  const FUENTES_URL = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap';
  const F_TITULO = "Cinzel, 'Playfair Display', Georgia, 'Times New Roman', serif";
  const F_SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
  const F_SANS = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";
  const F_MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const PUNTA_ARRIBA = -Math.PI / 2;

  // Paletas: dorado sobre negro y pergamino con dorado oscuro
  const PALETAS = {
    dark: {
      fondo: ['#2b2217', '#211a12', '#120c06'],
      franja: '#0c0804',
      patron: 'rgba(230, 194, 116, 0.05)',
      guilloche: 'rgba(230, 194, 116, 0.06)',
      vineta: 'rgba(0, 0, 0, 0.55)',
      halo: 'rgba(230, 194, 116, 0.26)',
      sombraLogo: 'rgba(0, 0, 0, 0.5)',
      metal: ['#9a6f28', '#e6c274', '#c79a3e', '#f3dc9c', '#b08436', '#e6c274', '#9a6f28'],
      oro: '#e6c274',
      tinta: '#f4e9d0',
      tintaSuave: 'rgba(236, 222, 190, 0.74)',
      sombraTexto: 'rgba(0, 0, 0, 0.65)',
      relleno: '#171009'
    },
    light: {
      fondo: ['#fefbf3', '#fbf6ea', '#efe0bd'],
      franja: '#e8d6ad',
      patron: 'rgba(154, 111, 40, 0.075)',
      guilloche: 'rgba(154, 111, 40, 0.1)',
      vineta: 'rgba(150, 105, 35, 0.2)',
      halo: 'rgba(199, 154, 62, 0.16)',
      sombraLogo: 'rgba(90, 60, 15, 0.22)',
      metal: ['#6e4b14', '#b8872f', '#8a611f', '#c99a45', '#7a5418', '#a87a2c', '#6e4b14'],
      oro: '#8a611f',
      tinta: '#2a1d10',
      tintaSuave: 'rgba(58, 40, 20, 0.78)',
      sombraTexto: 'rgba(120, 80, 20, 0.18)',
      relleno: '#f6ecd6'
    }
  };

  // Sello y cintas: iguales en ambos temas (es un objeto físico)
  const SELLO = {
    aprobado: {
      metal: ['#8a6224', '#f3dc9c', '#c79a3e', '#e6c274', '#9a6f28'],
      centro: '#1d150c',
      texto: '#f0d48e',
      cinta: ['#8a2c37', '#5c1a22'],
      bordeCinta: '#e6c274',
      textoCinta: '#f6e3b0'
    },
    noAprobado: {
      metal: ['#5f5a51', '#d8d1c2', '#8e887c', '#bfb8a8', '#6a655b'],
      centro: '#24201b',
      texto: '#e4ddcd',
      cinta: ['#57504a', '#38332e'],
      bordeCinta: '#bfb8a8',
      textoCinta: '#efe8da'
    }
  };

  // Ruta del logo por defecto: junto a este script (assets/amc-logo.png)
  let LOGO_DEFECTO = 'assets/amc-logo.png';
  try {
    if (document.currentScript && document.currentScript.src) {
      LOGO_DEFECTO = new URL('amc-logo.png', document.currentScript.src).href;
    }
  } catch (e) { /* se queda la ruta relativa */ }

  /* ---------------------------------------------------------------------------
     Carga de fuentes y logo (antes de dibujar)
     --------------------------------------------------------------------------- */
  let fuentesPromesa = null;
  let fuentesListas = false;

  function cargarFuentes() {
    if (fuentesPromesa) return fuentesPromesa;
    fuentesPromesa = new Promise(function (resolve) {
      const fin = function () { fuentesListas = true; resolve(); };
      try {
        if (!document.fonts || !document.head) { fin(); return; }
        const enlaces = Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
        let link = enlaces.find(function (l) {
          return (l.href || '').indexOf('Cinzel') !== -1 && (l.href || '').indexOf('Playfair') !== -1;
        });
        const hoja = new Promise(function (res) {
          if (!link) {
            link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = FUENTES_URL;
            link.setAttribute('data-vetatlas-cert', '');
            link.onload = res;
            link.onerror = res;
            document.head.appendChild(link);
          } else if (link.sheet) {
            res();
          } else {
            link.addEventListener('load', res);
            link.addEventListener('error', res);
          }
        });
        hoja.then(function () {
          const muestras = [
            '600 56px Cinzel', '700 36px Cinzel',
            '700 80px "Playfair Display"', '600 30px "Playfair Display"',
            'italic 400 28px "Playfair Display"', 'italic 600 36px "Playfair Display"',
            '400 20px Inter', '500 20px Inter', '600 20px Inter', '700 20px Inter',
            '500 16px "JetBrains Mono"'
          ];
          return Promise.all(muestras.map(function (f) {
            return document.fonts.load(f).catch(function () { return null; });
          }));
        }).then(function () { return document.fonts.ready; }).then(fin, fin);
      } catch (e) {
        fin();
      }
    });
    return fuentesPromesa;
  }

  const logos = {};
  function cargarLogo(src) {
    if (!src) return Promise.resolve(null);
    if (logos[src]) return logos[src];
    logos[src] = new Promise(function (resolve) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
    return logos[src];
  }

  function conTiempo(promesa, ms) {
    return Promise.race([
      promesa,
      new Promise(function (res) { setTimeout(function () { res(null); }, ms); })
    ]);
  }

  /* ---------------------------------------------------------------------------
     Datos: fecha en español y código de verificación
     --------------------------------------------------------------------------- */
  function dos(n) { return (n < 10 ? '0' : '') + n; }

  function normalizarFecha(f) {
    let d = null;
    if (f instanceof Date) d = f;
    else if (typeof f === 'number') d = new Date(f);
    else if (typeof f === 'string' && f.trim()) {
      const p = f.trim().split('-');
      if (p.length === 3 && p[0].length === 4 && !isNaN(Number(p[0])) && !isNaN(Number(p[1])) && !isNaN(Number(p[2]))) {
        d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      } else {
        // Texto ya formateado por la página
        return { texto: f.trim(), clave: f.trim() };
      }
    }
    if (!d || isNaN(d.getTime())) d = new Date();
    return {
      texto: d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(),
      clave: d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate())
    };
  }

  // FNV-1a de 32 bits
  function fnv(texto, semilla) {
    let h = semilla >>> 0;
    for (let i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function normalizarDatos(o) {
    const total = Math.max(1, Math.round(Number(o.total) || 0));
    const puntaje = Math.min(total, Math.max(0, Math.round(Number(o.puntaje) || 0)));
    return {
      nombre: String(o.nombre || '').trim() || NOMBRE_DEFECTO,
      curso: String(o.curso || '').trim(),
      titulo: String(o.titulo || '').trim() || TITULO_DEFECTO,
      temas: String(o.temas || '').trim(),
      insignia: String(o.insignia || '').trim(),
      puntaje: puntaje,
      total: total,
      pct: Math.round((puntaje / total) * 100),
      aprobado: puntaje / total >= UMBRAL,
      fecha: normalizarFecha(o.fecha)
    };
  }

  function codigoDe(d) {
    const base = [d.nombre.toLowerCase(), d.curso, d.puntaje + '/' + d.total, d.fecha.clave].join('|');
    let a = fnv(base, 2166136261);
    let b = fnv(base + '|amc-vetatlas', 2654435769);
    let s = '';
    for (let i = 0; i < 4; i++) { s += ALFABETO[a & 31]; a >>>= 5; }
    for (let i = 0; i < 4; i++) { s += ALFABETO[b & 31]; b >>>= 5; }
    return 'AMC-' + s.slice(0, 4) + '-' + s.slice(4);
  }

  /* ---------------------------------------------------------------------------
     Utilidades de dibujo
     --------------------------------------------------------------------------- */
  function metal(ctx, x0, y0, x1, y1, paradas) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    paradas.forEach(function (c, i) { g.addColorStop(i / (paradas.length - 1), c); });
    return g;
  }

  // Subtrayecto hexagonal (sin beginPath, para agrupar muchos)
  function hexSub(ctx, cx, cy, r, rot) {
    for (let i = 0; i < 6; i++) {
      const a = rot + (Math.PI / 3) * i;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function hex(ctx, cx, cy, r, rot) {
    ctx.beginPath();
    hexSub(ctx, cx, cy, r, rot === undefined ? PUNTA_ARRIBA : rot);
  }

  function rombo(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  }

  function fuente(peso, tam, familia) { return peso + ' ' + tam + 'px ' + familia; }

  // Reduce el tamaño hasta que el texto quepa en el ancho dado
  function ajustar(ctx, texto, peso, familia, max, min, ancho) {
    for (let t = max; t > min; t -= 1) {
      ctx.font = fuente(peso, t, familia);
      if (ctx.measureText(texto).width <= ancho) return t;
    }
    ctx.font = fuente(peso, min, familia);
    return min;
  }

  function recortar(ctx, texto, ancho) {
    if (ctx.measureText(texto).width <= ancho) return texto;
    let t = texto;
    while (t.length > 1 && ctx.measureText(t + '…').width > ancho) t = t.slice(0, -1);
    return t.trim() + '…';
  }

  // Divide un texto en dos líneas lo más parejas posible
  function dividirEnDos(ctx, texto) {
    const p = texto.split(' ').filter(Boolean);
    if (p.length < 2) return [texto];
    let mejor = [texto];
    let dif = Infinity;
    for (let i = 1; i < p.length; i++) {
      const a = p.slice(0, i).join(' ');
      const b = p.slice(i).join(' ');
      const d = Math.abs(ctx.measureText(a).width - ctx.measureText(b).width);
      if (d < dif) { dif = d; mejor = [a, b]; }
    }
    return mejor;
  }

  // Texto con espaciado entre letras (dibujado letra a letra)
  function espaciado(ctx, texto, x, y, esp) {
    const letras = Array.from(texto);
    const anchos = letras.map(function (c) { return ctx.measureText(c).width; });
    const total = anchos.reduce(function (a, b) { return a + b; }, 0) + esp * (letras.length - 1);
    const alin = ctx.textAlign;
    let cx = alin === 'center' ? x - total / 2 : (alin === 'right' ? x - total : x);
    ctx.textAlign = 'left';
    letras.forEach(function (c, i) { ctx.fillText(c, cx, y); cx += anchos[i] + esp; });
    ctx.textAlign = alin;
    return total;
  }

  function anchoEspaciado(ctx, texto, esp) {
    const letras = Array.from(texto);
    return letras.reduce(function (a, c) { return a + ctx.measureText(c).width; }, 0) + esp * (letras.length - 1);
  }

  // Línea dorada que se desvanece hacia los extremos
  function lineaDesvanecida(ctx, P, cx, y, mitad, grosor) {
    const g = ctx.createLinearGradient(cx - mitad, 0, cx + mitad, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.2, P.metal[0]);
    g.addColorStop(0.5, P.metal[3]);
    g.addColorStop(0.8, P.metal[0]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - mitad, y - grosor / 2, mitad * 2, grosor);
  }

  /* ---------------------------------------------------------------------------
     Capas del certificado
     --------------------------------------------------------------------------- */
  function pintarFondo(ctx, P) {
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, P.fondo[0]);
    g.addColorStop(0.55, P.fondo[1]);
    g.addColorStop(1, P.fondo[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Patrón hexagonal muy tenue dentro del marco
    ctx.save();
    ctx.beginPath();
    ctx.rect(80, 80, W - 160, H - 160);
    ctx.clip();
    const r = 24;
    const paso = Math.sqrt(3) * r;
    ctx.beginPath();
    let fila = 0;
    for (let y = 70; y < H + r; y += 1.5 * r, fila++) {
      for (let x = (fila % 2 ? paso / 2 : 0) + 60; x < W + paso; x += paso) {
        hexSub(ctx, x, y, r, PUNTA_ARRIBA);
      }
    }
    ctx.strokeStyle = P.patron;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Guilloché: roseta grabada detrás del nombre
    ctx.translate(W / 2, 570);
    ctx.strokeStyle = P.guilloche;
    ctx.lineWidth = 0.9;
    for (let k = 0; k < 12; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 900; i++) {
        const t = (i / 900) * Math.PI * 2;
        const rr = 240 + 22 * Math.sin(16 * t + (k * Math.PI) / 6) + 9 * Math.sin(4 * t);
        const x = rr * Math.cos(t) * 1.75;
        const y = rr * Math.sin(t) * 0.92;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // Viñeta radial
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, W * 0.66);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, P.vineta);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function pintarMarco(ctx, P) {
    const oro = metal(ctx, 0, 0, W, H, P.metal);

    // Franja exterior (paspartú)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(30, 30, W - 60, H - 60);
    ctx.fillStyle = P.franja;
    ctx.fill('evenodd');
    ctx.restore();

    ctx.strokeStyle = oro;
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(41, 41, W - 82, H - 82);
    ctx.strokeRect(69, 69, W - 138, H - 138);
    ctx.lineWidth = 2.4;
    ctx.strokeRect(79, 79, W - 158, H - 158);

    // Greca: cadena de hexágonos y rombos entre los filetes
    ctx.fillStyle = oro;
    ctx.lineWidth = 1.1;
    const lados = [
      { x0: 100, y0: 55, x1: W - 100, y1: 55 },
      { x0: 100, y0: H - 55, x1: W - 100, y1: H - 55 },
      { x0: 55, y0: 100, x1: 55, y1: H - 100 },
      { x0: W - 55, y0: 100, x1: W - 55, y1: H - 100 }
    ];
    lados.forEach(function (l) {
      const largo = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
      const n = Math.round(largo / 24);
      ctx.beginPath();
      for (let i = 0; i <= n; i += 2) {
        const t = i / n;
        hexSub(ctx, l.x0 + (l.x1 - l.x0) * t, l.y0 + (l.y1 - l.y0) * t, 6.5, PUNTA_ARRIBA);
      }
      ctx.stroke();
      for (let i = 1; i < n; i += 2) {
        const t = i / n;
        rombo(ctx, l.x0 + (l.x1 - l.x0) * t, l.y0 + (l.y1 - l.y0) * t, 2.6);
        ctx.fill();
      }
    });

    // Esquinas: medallón hexagonal y escuadras art déco
    const esquinas = [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]];
    esquinas.forEach(function (e) {
      ctx.save();
      ctx.translate(e[0], e[1]);
      ctx.scale(e[2], e[3]);

      hex(ctx, 55, 55, 31);
      ctx.fillStyle = P.franja;
      ctx.fill();
      ctx.strokeStyle = oro;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      hex(ctx, 55, 55, 22);
      ctx.lineWidth = 1;
      ctx.stroke();
      hex(ctx, 55, 55, 10);
      ctx.fillStyle = oro;
      ctx.fill();

      // Escuadras escalonadas
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(94, 250);
      ctx.lineTo(94, 94);
      ctx.lineTo(250, 94);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(104, 180);
      ctx.lineTo(104, 104);
      ctx.lineTo(180, 104);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(114, 140);
      ctx.lineTo(114, 114);
      ctx.lineTo(140, 114);
      ctx.stroke();
      rombo(ctx, 94, 258, 4);
      ctx.fill();
      rombo(ctx, 258, 94, 4);
      ctx.fill();
      hex(ctx, 126, 126, 5);
      ctx.fill();
      ctx.restore();
    });
  }

  function pintarEmblema(ctx, P, logo) {
    const cx = W / 2;
    const cy = 204;
    const tam = 200;

    // Halo dorado
    const h = ctx.createRadialGradient(cx, cy, 10, cx, cy, 190);
    h.addColorStop(0, P.halo);
    h.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = h;
    ctx.fillRect(cx - 200, cy - 200, 400, 400);

    // Líneas laterales que flanquean el emblema
    lineaDesvanecida(ctx, P, cx - 320, cy, 190, 1.6);
    lineaDesvanecida(ctx, P, cx + 320, cy, 190, 1.6);
    ctx.fillStyle = metal(ctx, cx - 120, cy - 6, cx + 120, cy + 6, P.metal);
    rombo(ctx, cx - 124, cy, 5);
    ctx.fill();
    rombo(ctx, cx + 124, cy, 5);
    ctx.fill();

    // Anillos hexagonales
    const oro = metal(ctx, cx - 100, cy - 100, cx + 100, cy + 100, P.metal);
    ctx.strokeStyle = oro;
    ctx.lineWidth = 1.6;
    hex(ctx, cx, cy, 112);
    ctx.stroke();
    ctx.lineWidth = 0.9;
    hex(ctx, cx, cy, 104);
    ctx.stroke();

    if (logo) {
      ctx.save();
      ctx.shadowColor = P.sombraLogo;
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.drawImage(logo, cx - tam / 2, cy - tam / 2, tam, tam);
      ctx.restore();
    } else {
      // Respaldo vectorial si el logo no carga
      hex(ctx, cx, cy, 86);
      ctx.fillStyle = '#1d150c';
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = oro;
      ctx.font = fuente('700', 40, F_TITULO);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AMC', cx, cy + 2);
      ctx.textBaseline = 'alphabetic';
    }
  }

  function pintarDivisor(ctx, P, cx, y) {
    lineaDesvanecida(ctx, P, cx - 150, y, 130, 1.4);
    lineaDesvanecida(ctx, P, cx + 150, y, 130, 1.4);
    const oro = metal(ctx, cx - 30, y - 10, cx + 30, y + 10, P.metal);
    ctx.fillStyle = oro;
    ctx.strokeStyle = oro;
    ctx.lineWidth = 1.2;
    hex(ctx, cx, y, 9);
    ctx.stroke();
    hex(ctx, cx, y, 4);
    ctx.fill();
    rombo(ctx, cx - 22, y, 3);
    ctx.fill();
    rombo(ctx, cx + 22, y, 3);
    ctx.fill();
  }

  function conSombra(ctx, P, fn) {
    ctx.save();
    ctx.shadowColor = P.sombraTexto;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    fn();
    ctx.restore();
  }

  function pintarTextos(ctx, P, d) {
    const cx = W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Marca
    ctx.font = fuente('600', 19, F_SANS);
    ctx.fillStyle = P.oro;
    espaciado(ctx, MARCA.toUpperCase(), cx, 352, 5);

    // Título (dorado metálico)
    const titulo = d.aprobado ? d.titulo : TITULO_NO_APROBADO;
    const tt = ajustar(ctx, titulo, '600', F_TITULO, 60, 34, 1180);
    conSombra(ctx, P, function () {
      ctx.fillStyle = metal(ctx, 0, 416 - tt, 0, 420, P.metal);
      ctx.fillText(titulo, cx, 418);
    });
    pintarDivisor(ctx, P, cx, 452);

    // «Se otorga a»
    ctx.font = fuente('italic 400', 29, F_SERIF);
    ctx.fillStyle = P.tintaSuave;
    ctx.fillText('Se otorga a', cx, 502);

    // Nombre grande, con ajuste automático
    const tn = ajustar(ctx, d.nombre, '700', F_SERIF, 88, 40, 1160);
    const nombre = recortar(ctx, d.nombre, 1160);
    const anchoNombre = ctx.measureText(nombre).width;
    conSombra(ctx, P, function () {
      ctx.fillStyle = metal(ctx, 0, 588 - tn, 0, 600, P.metal);
      ctx.fillText(nombre, cx, 588);
    });
    lineaDesvanecida(ctx, P, cx, 616, Math.max(300, Math.min(640, anchoNombre / 2 + 90)), 1.6);

    // Módulo
    ctx.font = fuente('400', 23, F_SANS);
    ctx.fillStyle = P.tintaSuave;
    ctx.fillText(d.aprobado ? 'por aprobar el módulo' : 'por completar la evaluación del módulo', cx, 660);

    let y = 710;
    if (d.curso) {
      const curso = '«' + d.curso + '»';
      ctx.fillStyle = P.tinta;
      ctx.font = fuente('italic 600', 38, F_SERIF);
      if (ctx.measureText(curso).width <= 1200) {
        ctx.fillText(curso, cx, y);
      } else {
        ctx.font = fuente('italic 600', 34, F_SERIF);
        const lineas = dividirEnDos(ctx, curso);
        const t = Math.min(
          ajustar(ctx, lineas[0], 'italic 600', F_SERIF, 34, 22, 1200),
          ajustar(ctx, lineas[1] || '', 'italic 600', F_SERIF, 34, 22, 1200)
        );
        ctx.font = fuente('italic 600', t, F_SERIF);
        ctx.fillText(lineas[0], cx, y - 8);
        if (lineas[1]) ctx.fillText(lineas[1], cx, y - 8 + t + 8);
        y += t;
      }
    }

    // Temas (texto pequeño)
    if (d.temas) {
      y += 46;
      ajustar(ctx, d.temas, '500', F_SANS, 18, 13, 1180);
      ctx.fillStyle = P.tintaSuave;
      ctx.fillText(recortar(ctx, d.temas, 1180), cx, y);
    }

  }

  function pintarSello(ctx, d) {
    const S = d.aprobado ? SELLO.aprobado : SELLO.noAprobado;
    const cx = W / 2;
    const cy = 914;
    const R = 100;

    // Colas de cinta detrás del sello
    [-1, 1].forEach(function (lado) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(lado, 1);
      ctx.beginPath();
      ctx.moveTo(14, 60);
      ctx.lineTo(56, 52);
      ctx.lineTo(88, 124);
      ctx.lineTo(68, 114);
      ctx.lineTo(52, 132);
      ctx.closePath();
      ctx.fillStyle = metal(ctx, 0, 50, 0, 132, S.cinta);
      ctx.fill();
      ctx.strokeStyle = S.bordeCinta;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    });

    // Roseta dentada
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.beginPath();
    const dientes = 60;
    for (let i = 0; i <= dientes * 2; i++) {
      const a = (i / (dientes * 2)) * Math.PI * 2;
      const r = i % 2 ? R - 6 : R;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = metal(ctx, cx - R, cy - R, cx + R, cy + R, S.metal);
    ctx.fill();
    ctx.restore();

    // Disco central
    ctx.beginPath();
    ctx.arc(cx, cy, R - 13, 0, Math.PI * 2);
    ctx.fillStyle = S.centro;
    ctx.fill();
    const aro = metal(ctx, cx - R, cy - R, cx + R, cy + R, S.metal);
    ctx.strokeStyle = aro;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 40, 0, Math.PI * 2);
    ctx.stroke();

    // Texto en arco superior
    ctx.fillStyle = S.texto;
    ctx.font = fuente('700', 12.5, F_SANS);
    ctx.textAlign = 'center';
    const arco = 'AMC · VETATLAS';
    const radio = R - 33;
    const esp = 3.2;
    const letras = Array.from(arco);
    const total = anchoEspaciado(ctx, arco, esp);
    let ang = -Math.PI / 2 - total / radio / 2;
    letras.forEach(function (c) {
      const w = ctx.measureText(c).width;
      ang += (w / 2) / radio;
      ctx.save();
      ctx.translate(cx + radio * Math.cos(ang), cy + radio * Math.sin(ang));
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillText(c, 0, 4);
      ctx.restore();
      ang += (w / 2 + esp) / radio;
    });
    // Estrellitas a los lados del arco
    [-1, 1].forEach(function (lado) {
      const a = -Math.PI / 2 + lado * (total / radio / 2 + 0.22);
      rombo(ctx, cx + radio * Math.cos(a), cy + radio * Math.sin(a), 3);
      ctx.fill();
    });

    // Puntaje al centro
    const marcador = d.puntaje + ' / ' + d.total;
    const tm = ajustar(ctx, marcador, '700', F_TITULO, 36, 22, 112);
    ctx.fillStyle = metal(ctx, 0, cy + 8 - tm, 0, cy + 10, S.metal);
    ctx.fillText(marcador, cx, cy + 8);
    ctx.font = fuente('600', 16, F_SANS);
    ctx.fillStyle = S.texto;
    ctx.fillText('(' + d.pct + '%)', cx, cy + 32);

    // Banda con el estado
    const by = cy + 52;
    const bh = 38;
    const bw = 132;
    [-1, 1].forEach(function (lado) {
      ctx.save();
      ctx.translate(cx, by);
      ctx.scale(lado, 1);
      ctx.beginPath();
      ctx.moveTo(bw - 12, 8);
      ctx.lineTo(bw + 26, 8);
      ctx.lineTo(bw + 14, 8 + bh / 2);
      ctx.lineTo(bw + 26, 8 + bh);
      ctx.lineTo(bw - 12, 8 + bh);
      ctx.closePath();
      ctx.fillStyle = S.cinta[1];
      ctx.fill();
      ctx.restore();
    });
    ctx.beginPath();
    ctx.rect(cx - bw, by, bw * 2, bh);
    ctx.fillStyle = metal(ctx, 0, by, 0, by + bh, S.cinta);
    ctx.fill();
    ctx.strokeStyle = S.bordeCinta;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - bw, by + 4);
    ctx.lineTo(cx + bw, by + 4);
    ctx.moveTo(cx - bw, by + bh - 4);
    ctx.lineTo(cx + bw, by + bh - 4);
    ctx.stroke();

    const estado = d.aprobado ? 'APROBADO' : 'NO APROBADO';
    ctx.fillStyle = S.textoCinta;
    ajustar(ctx, estado, '700', F_TITULO, 21, 14, bw * 2 - 40);
    espaciado(ctx, estado, cx, by + 26, 2.5);
  }

  function pintarPie(ctx, P, d, codigo) {
    ctx.textAlign = 'center';
    const ly = 952;

    // Firma de texto (no manuscrita)
    const fx = 400;
    ctx.font = fuente('italic 600', 30, F_SERIF);
    ctx.fillStyle = P.tinta;
    ctx.fillText(FIRMA, fx, 936);
    lineaDesvanecida(ctx, P, fx, ly, 175, 1.5);
    ctx.font = fuente('500', 15, F_SANS);
    ctx.fillStyle = P.tintaSuave;
    espaciado(ctx, MARCA, fx, 982, 0.6);

    // Insignia secundaria de la página (solo si aprobó)
    if (d.insignia && d.aprobado) {
      ajustar(ctx, d.insignia.toUpperCase(), '700', F_SANS, 12.5, 9, 300);
      ctx.fillStyle = P.oro;
      espaciado(ctx, d.insignia.toUpperCase(), fx, 1014, 1.6);
    }

    // Fecha y código
    const dx = W - 400;
    ctx.font = fuente('600', 30, F_SERIF);
    ctx.fillStyle = P.tinta;
    ctx.fillText(d.fecha.texto, dx, 936);
    lineaDesvanecida(ctx, P, dx, ly, 175, 1.5);
    ctx.font = fuente('500', 15, F_SANS);
    ctx.fillStyle = P.tintaSuave;
    espaciado(ctx, 'Fecha de emisión', dx, 982, 0.6);

    ctx.font = fuente('600', 12.5, F_SANS);
    ctx.fillStyle = P.tintaSuave;
    const etiqueta = 'VERIFICACIÓN';
    const we = anchoEspaciado(ctx, etiqueta, 2);
    ctx.font = fuente('500', 16, F_MONO);
    const wc = ctx.measureText(codigo).width;
    const x0 = dx - (we + 14 + wc) / 2;
    ctx.textAlign = 'left';
    ctx.font = fuente('600', 12.5, F_SANS);
    espaciado(ctx, etiqueta, x0, 1014, 2);
    ctx.font = fuente('500', 16, F_MONO);
    ctx.fillStyle = P.oro;
    ctx.fillText(codigo, x0 + we + 14, 1014);
    ctx.textAlign = 'center';
  }

  function pintar(canvas, o, logo) {
    const dpr = window.devicePixelRatio || 1;
    const escala = Number(o.escala) > 0 ? Math.min(3, Number(o.escala)) : Math.min(2, Math.max(1.5, dpr));
    canvas.width = Math.round(W * escala);
    canvas.height = Math.round(H * escala);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let tema = o.tema;
    if (tema !== 'light' && tema !== 'dark') {
      tema = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }
    const P = PALETAS[tema];
    const d = normalizarDatos(o);
    const codigo = codigoDe(d);

    pintarFondo(ctx, P);
    pintarMarco(ctx, P);
    pintarEmblema(ctx, P, logo);
    pintarTextos(ctx, P, d);
    pintarSello(ctx, d);
    pintarPie(ctx, P, d, codigo);

    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label',
      (d.aprobado ? d.titulo : TITULO_NO_APROBADO) + ' para ' + d.nombre + '. Módulo: ' + d.curso +
      '. Puntaje ' + d.puntaje + ' de ' + d.total + ' (' + d.pct + '%), ' + (d.aprobado ? 'aprobado' : 'no aprobado') +
      '. Fecha: ' + d.fecha.texto + '. Código ' + codigo + '.');
    canvas.dataset.codigo = codigo;
    return codigo;
  }

  /* ---------------------------------------------------------------------------
     API pública
     --------------------------------------------------------------------------- */
  function draw(canvas, opciones) {
    if (!canvas || !canvas.getContext) return Promise.reject(new Error('VetAtlasCert: canvas no válido'));
    const o = Object.assign({}, opciones || {});
    const token = (canvas.__vetatlasCertToken || 0) + 1;
    canvas.__vetatlasCertToken = token;
    const logoSrc = o.logoSrc || LOGO_DEFECTO;

    return Promise.all([
      conTiempo(cargarFuentes(), 4000),
      conTiempo(cargarLogo(logoSrc), 5000)
    ]).then(function (r) {
      // Si llegó un dibujo más reciente, este se descarta
      if (canvas.__vetatlasCertToken !== token) return canvas;
      pintar(canvas, o, r[1] || null);
      // Si las fuentes tardaron, se redibuja cuando lleguen
      if (!fuentesListas) {
        cargarFuentes().then(function () {
          if (canvas.__vetatlasCertToken === token) draw(canvas, o);
        });
      }
      return canvas;
    });
  }

  function download(canvas, nombreArchivo) {
    let archivo = String(nombreArchivo || 'Certificado_AMC_VetAtlas.png');
    if (!/[.]png$/i.test(archivo)) archivo += '.png';
    return new Promise(function (resolve) {
      const bajar = function (url, revocar) {
        const a = document.createElement('a');
        a.href = url;
        a.download = archivo;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (revocar) setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        resolve(true);
      };
      try {
        if (canvas.toBlob && window.URL && URL.createObjectURL) {
          canvas.toBlob(function (blob) {
            if (blob) bajar(URL.createObjectURL(blob), true);
            else bajar(canvas.toDataURL('image/png'), false);
          }, 'image/png');
        } else {
          bajar(canvas.toDataURL('image/png'), false);
        }
      } catch (err) {
        console.warn('VetAtlasCert: no se pudo exportar el PNG', err);
        resolve(false);
      }
    });
  }

  /* ---------------------------------------------------------------------------
     Animación en la página: aparición suave, brillo y confeti dorado
     --------------------------------------------------------------------------- */
  function inyectarEstilos() {
    if (document.getElementById('vetatlas-cert-estilos')) return;
    const st = document.createElement('style');
    st.id = 'vetatlas-cert-estilos';
    st.textContent = [
      '@keyframes vetatlasCertIn {',
      '  0% { opacity: 0; transform: translateY(16px) scale(0.95); filter: brightness(1.5) saturate(0.7); }',
      '  60% { opacity: 1; filter: brightness(1.12); }',
      '  100% { opacity: 1; transform: none; filter: none; }',
      '}',
      '.vetatlas-cert-in { animation: vetatlasCertIn 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both; }',
      '.vetatlas-cert-fx { position: absolute; pointer-events: none; z-index: 3; }',
      '@media (prefers-reduced-motion: reduce) {',
      '  .vetatlas-cert-in { animation: none; }',
      '  .vetatlas-cert-fx { display: none; }',
      '}'
    ].join('');
    document.head.appendChild(st);
  }

  function estrella(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  }

  function celebrate(canvas, op) {
    if (!canvas) return;
    op = op || {};
    inyectarEstilos();
    const reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducir) return;

    // Se mide antes de animar: la escala de la animación altera la caja
    canvas.classList.remove('vetatlas-cert-in');
    const caja = canvas.getBoundingClientRect();
    canvas.classList.add('vetatlas-cert-in');

    if (canvas.__vetatlasFx) canvas.__vetatlasFx.parar();
    const padre = canvas.parentElement;
    if (!padre || canvas.clientWidth === 0) return;
    if (getComputedStyle(padre).position === 'static') padre.style.position = 'relative';

    // Margen para que el confeti salga del borde, sin provocar scroll horizontal
    const anchoVista = document.documentElement.clientWidth || window.innerWidth;
    const m = Math.max(0, Math.floor(Math.min(36, caja.left, anchoVista - caja.right)));
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const w = cw + m * 2;
    const h = ch + m * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fx = document.createElement('canvas');
    fx.className = 'vetatlas-cert-fx';
    fx.setAttribute('aria-hidden', 'true');
    fx.width = Math.round(w * dpr);
    fx.height = Math.round(h * dpr);
    fx.style.width = w + 'px';
    fx.style.height = h + 'px';
    fx.style.left = (canvas.offsetLeft - m) + 'px';
    fx.style.top = (canvas.offsetTop - m) + 'px';
    padre.appendChild(fx);
    const ctx = fx.getContext('2d');
    ctx.scale(dpr, dpr);

    const colores = ['#e6c274', '#c79a3e', '#9a6f28', '#f3dc9c', '#fff2cf'];
    const confeti = op.confeti !== false;
    const piezas = [];
    const n = confeti ? (cw < 520 ? 70 : 140) : 0;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
      const vel = (0.55 + Math.random() * 0.75) * Math.max(ch, 260) * 1.5;
      piezas.push({
        x: w / 2 + (Math.random() - 0.5) * cw * 0.18,
        y: m + ch * 0.42,
        vx: Math.cos(ang) * vel,
        vy: Math.sin(ang) * vel,
        giro: Math.random() * Math.PI * 2,
        vgiro: (Math.random() - 0.5) * 14,
        tam: 4 + Math.random() * 6,
        color: colores[i % colores.length],
        tipo: Math.random() < 0.3 ? 'estrella' : 'tira',
        retraso: Math.random() * 0.25
      });
    }
    const destellos = [];
    for (let i = 0; i < (cw < 520 ? 10 : 18); i++) {
      destellos.push({
        x: m + Math.random() * cw,
        y: m + Math.random() * ch,
        t0: 0.15 + Math.random() * 1.6,
        tam: 6 + Math.random() * 10
      });
    }

    const DURACION = 2.9;
    const gravedad = Math.max(ch, 260) * 1.9;
    let inicio = null;
    let raf = 0;
    let vivo = true;
    const parar = function () {
      vivo = false;
      cancelAnimationFrame(raf);
      if (fx.parentNode) fx.parentNode.removeChild(fx);
      if (canvas.__vetatlasFx && canvas.__vetatlasFx.fx === fx) canvas.__vetatlasFx = null;
    };
    canvas.__vetatlasFx = { parar: parar, fx: fx };

    let previo = 0;
    const cuadro = function (ahora) {
      if (!vivo) return;
      if (inicio === null) { inicio = ahora; previo = ahora; }
      const t = (ahora - inicio) / 1000;
      const dt = Math.min(0.05, (ahora - previo) / 1000);
      previo = ahora;
      ctx.clearRect(0, 0, w, h);

      // Barrido de brillo diagonal sobre el certificado
      if (t < 1.3) {
        const p = t / 1.3;
        const bx = m - cw * 0.4 + p * cw * 1.8;
        ctx.save();
        ctx.beginPath();
        ctx.rect(m, m, cw, ch);
        ctx.clip();
        const g = ctx.createLinearGradient(bx - 90, 0, bx + 90, 0);
        g.addColorStop(0, 'rgba(255, 240, 200, 0)');
        g.addColorStop(0.5, 'rgba(255, 240, 200, ' + (0.38 * Math.sin(p * Math.PI)).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255, 240, 200, 0)');
        ctx.fillStyle = g;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(bx, m + ch / 2);
        ctx.transform(1, 0, -0.45, 1, 0, 0);
        ctx.translate(-bx, -(m + ch / 2));
        ctx.fillRect(bx - 90, m, 180, ch);
        ctx.restore();
      }

      // Destellos dorados que titilan
      destellos.forEach(function (s) {
        const e = (t - s.t0) / 0.7;
        if (e <= 0 || e >= 1) return;
        ctx.globalAlpha = Math.sin(e * Math.PI);
        ctx.fillStyle = '#fff2cf';
        estrella(ctx, s.x, s.y, s.tam * Math.sin(e * Math.PI));
      });
      ctx.globalAlpha = 1;

      // Confeti
      piezas.forEach(function (p) {
        if (t < p.retraso) return;
        p.vy += gravedad * dt;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.giro += p.vgiro * dt;
        const vida = 1 - Math.max(0, (t - DURACION * 0.6) / (DURACION * 0.4));
        ctx.globalAlpha = Math.max(0, vida);
        ctx.fillStyle = p.color;
        if (p.tipo === 'estrella') {
          estrella(ctx, p.x, p.y, p.tam * (0.8 + 0.3 * Math.sin(p.giro * 2)));
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.giro);
          ctx.scale(1, Math.cos(p.giro * 1.7));
          ctx.fillRect(-p.tam / 2, -p.tam * 0.3, p.tam, p.tam * 0.6);
          ctx.restore();
        }
      });
      ctx.globalAlpha = 1;

      if (t < DURACION) raf = requestAnimationFrame(cuadro);
      else parar();
    };
    raf = requestAnimationFrame(cuadro);
  }

  window.VetAtlasCert = {
    version: '1.0.0',
    ancho: W,
    alto: H,
    umbral: UMBRAL,
    draw: draw,
    download: download,
    celebrate: celebrate,
    codigo: function (opciones) { return codigoDe(normalizarDatos(Object.assign({}, opciones || {}))); },
    precargar: function (logoSrc) {
      return Promise.all([cargarFuentes(), cargarLogo(logoSrc || LOGO_DEFECTO)]);
    }
  };

  // Empieza a bajar las fuentes desde ya, sin bloquear la página
  try { cargarFuentes(); } catch (e) { /* sin fuentes: se usan serif/sans-serif */ }
})();
