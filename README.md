# AMC VetAtlas · Animal Medical Center

Atlas didáctico interactivo de enfermedades veterinarias difíciles, con fisiopatología, 3D, simuladores y autoevaluación.

Sitio: https://andreerogel1997-bit.github.io/amc-vetatlas/

## Estructura

```
/
├── index.html                          Portada: buscador, filtros por área y especie, catálogo (array DISEASES)
├── 404.html                            Página de error con enlace a la portada
├── .nojekyll                           GitHub Pages sirve los archivos tal cual (sin Jekyll)
├── assets/amc-logo.png                 (opcional) Logo de AMC. Si falta, se muestra un sello SVG de respaldo
├── neurologia/
│   └── convulsiones/index.html         Convulsiones y estatus epiléptico (NeuroVet)
└── infecciosas/
    └── celulitis-flemonosa/index.html  Celulitis flemonosa bacteriana
```

Cada enfermedad es una página HTML autónoma en `area/slug/index.html`.

## Cómo agregar una enfermedad

1. Crea la carpeta `area/slug/` (en minúsculas, sin tildes ni espacios), por ejemplo `metabolicas/cetoacidosis-diabetica/`, y pon ahí su `index.html`.
2. Dentro de esa página, agrega un enlace de vuelta a la portada: `<a href="../../">Volver a AMC VetAtlas</a>`.
3. En `index.html` (portada), añade una entrada al array `DISEASES`:

```js
{
  titulo: 'Cetoacidosis diabética',
  area: 'Metabólicas/Endocrinas',     // debe coincidir exactamente con un valor de AREAS
  especies: ['Caninos', 'Felinos'],   // valores de SPECIES
  resumen: 'Resumen corto de una línea.',
  url: 'metabolicas/cetoacidosis-diabetica/',
  color: '#f59e0b',
  fecha: '2026-11'
}
```

4. Haz commit y push a `main`. GitHub Pages publica en uno o dos minutos.

Las áreas sin enfermedades aparecen solas como «Próximamente». Para crear un área nueva, agrégala a `AREAS` y su icono SVG a `AREA_ICONS`.

## Certificado del examen final

El certificado PNG lo dibuja el módulo compartido `assets/vetatlas-certificate.js` (script clásico). En cada página nueva:

1. Carga `<script src="../../assets/vetatlas-certificate.js"></script>` **antes** del `<script type="module">`.
2. Usa el mismo HTML del certificado (`#certNameInput`, `#renderCertBtn`, `#downloadCertBtn` y `#certCanvas` dentro de `.cert-stage`) y el CSS `.cert-controls` / `.cert-stage` / `#certCanvas` de las páginas existentes.
3. Dibuja con `window.VetAtlasCert.draw(canvas, { nombre, curso, titulo, temas, puntaje, total, fecha, tema, logoSrc: '../../assets/amc-logo.png' })`, descarga con `window.VetAtlasCert.download(canvas, 'Certificado_X_AMC_VetAtlas.png')` y, al calificar, anima con `window.VetAtlasCert.celebrate(canvas, { confeti: aprobado })`. Redibuja en el hook de tema y en el `input` del nombre (con debounce).

Vista previa: `cert-preview.html`.

## Logo

Sube el logo como `assets/amc-logo.png` (cuadrado, fondo transparente). No hace falta tocar el código.

---
Contenido educativo; no sustituye la consulta clínica.
