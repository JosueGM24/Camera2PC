// Piezas visuales compartidas.
//
// La firma de la interfaz es el CAMINO DE SENAL: dos extremos y la ruta entre
// ellos. No es un adorno — codifica cosas verdaderas:
//   · el color dice de que flujo se trata (camara o pantalla)
//   · las rayas viajan solo cuando hay video pasando
//   · si la ruta pasa por un TURN, el camino se dobla por un tercer nodo
//   · si va por cable, se rotula como tal
//
// Todo en SVG inline: nada de imagenes externas, para que el modo cable sin
// internet se vea igual.

// --- glifos de dispositivo (rejilla 46x40, trazo 1.75) ----------------------
export const GLYPHS = {
  phone: '<rect x="15" y="4" width="16" height="32" rx="3"/><path d="M20.5 7.5h5"/><path d="M21.5 32.5h3"/>',
  pc: '<rect x="6" y="6" width="34" height="22" rx="2"/><path d="M18 28v5"/><path d="M28 28v5"/><path d="M14 33.5h18"/>',
  tablet: '<rect x="7" y="8" width="32" height="24" rx="3"/><path d="M35.5 15v10"/>',
};

/**
 * Cable decorativo-pero-honesto entre dos nodos del patchbay del inicio.
 * Se dibuja con preserveAspectRatio none para que estire sin deformar el trazo.
 */
export function wireSvg() {
  return `
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
      <path class="wire-track" d="M2 22 H98" vector-effect="non-scaling-stroke"/>
      <path class="wire-flow" d="M2 22 H98" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

/**
 * Camino de senal en vivo. Devuelve un controlador con setState().
 *
 * @param {HTMLElement} host  contenedor (recibe las clases y los data-*)
 * @param {object} opts  { from, to, fromLabel, toLabel }  from/to = claves de GLYPHS
 */
export function createLink(host, { from, to, fromLabel, toLabel }) {
  host.classList.add('link');
  host.dataset.state = 'new';

  // Coordenadas: dos extremos a los lados, el cable en medio a la altura y=38.
  host.innerHTML = `
    <svg viewBox="0 0 320 92" role="img" aria-label="Camino de la senal">
      <g class="lk-glyph" transform="translate(8,14)">${GLYPHS[from]}</g>
      <text class="lk-label" x="31" y="72" text-anchor="middle">${fromLabel}</text>

      <path class="lk-track" d="M62 34 H258" vector-effect="non-scaling-stroke"/>
      <path class="lk-flow"  d="M62 34 H258" vector-effect="non-scaling-stroke"/>

      <rect class="lk-hop" x="149" y="24" width="22" height="20" rx="3"/>
      <text class="lk-label lk-hop-label" x="160" y="58" text-anchor="middle">TURN</text>

      <g class="lk-glyph" transform="translate(266,14)">${GLYPHS[to]}</g>
      <text class="lk-label" x="289" y="72" text-anchor="middle">${toLabel}</text>

      <text class="lk-label lk-route" x="160" y="14" text-anchor="middle"></text>
    </svg>`;

  const flow = host.querySelector('.lk-flow');
  const track = host.querySelector('.lk-track');
  const routeLabel = host.querySelector('.lk-route');

  return {
    /**
     * @param {string} state  new | gathering | waiting | connecting | connected | failed | closed
     * @param {object|null} route  lo que devuelve describeConnection()
     */
    setState(state, route = null) {
      host.dataset.state = state;
      host.dataset.relay = route?.relayed ? '1' : '0';

      if (state !== 'connected' || !route) {
        routeLabel.textContent = '';
        setPath('M62 34 H258');
        return;
      }

      if (route.relayed) {
        // Dobla el camino por el nodo TURN: la senal da un rodeo de verdad.
        setPath('M62 34 Q110 34 149 34 M171 34 Q210 34 258 34');
        routeLabel.textContent = 'rebotando en TURN';
      } else if (route.linkHint) {
        // Por cable: camino corto y recto, rotulado.
        setPath('M62 34 H258');
        routeLabel.textContent = route.linkHint;
      } else {
        // Directo por red local: una onda suave, para distinguirlo del cable.
        setPath('M62 34 C110 22 210 46 258 34');
        routeLabel.textContent = 'directo';
      }
    },
  };

  function setPath(d) {
    flow.setAttribute('d', d);
    track.setAttribute('d', d);
  }
}

// --- iconos (rejilla 24, trazo 1.75, sin relleno) ---------------------------
const ICONS = {
  expand: '<path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5"/>',
  photo: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.4"/>',
  record: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
  sound: '<path d="M4 9.5h3L12 5v14l-5-4.5H4z"/><path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.6 6.6a7.5 7.5 0 0 1 0 10.8"/>',
  mute: '<path d="M4 9.5h3L12 5v14l-5-4.5H4z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6H6a2 2 0 0 0-2 2v9"/>',
  again: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  torch: '<path d="M9 3h6v3.5l-1.5 2.5v11h-3v-11L9 6.5z"/>',
  cable: '<path d="M6 3v5a3 3 0 0 0 3 3h1v6a4 4 0 0 0 8 0v-2"/><path d="M4 3h4M16 3v5a3 3 0 0 1-3 3"/>',
  monitor: '<rect x="2.5" y="5" width="19" height="12" rx="1.5"/><path d="M9 20h6M12 17v3"/>',
  camera: '<rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="m15.5 12 6-3.5v11l-6-3.5z"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
};

/** Inserta el trazo de un icono en cada <svg data-icon="nombre"> de la pagina. */
export function paintIcons(root = document) {
  root.querySelectorAll('svg[data-icon]').forEach((svg) => {
    const path = ICONS[svg.dataset.icon];
    if (!path) return;
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = path;
  });
}

/** Cambia el icono de un <svg data-icon> ya pintado. */
export function setIcon(svg, name) {
  if (!svg || !ICONS[name]) return;
  svg.dataset.icon = name;
  svg.innerHTML = ICONS[name];
}

/**
 * Confirmacion breve en un boton de icono: muestra una palomita y vuelve.
 * Los botones de icono no tienen sitio para un "Copiado", asi que el propio
 * icono es el acuse de recibo.
 */
export function flashConfirm(button, ms = 1300) {
  const svg = button.querySelector('svg[data-icon]');
  if (!svg) return;
  const before = svg.dataset.icon;
  setIcon(svg, 'check');
  button.style.color = 'var(--signal)';
  setTimeout(() => {
    setIcon(svg, before);
    button.style.color = '';
  }, ms);
}

/** Recuerda que secciones desplegables dejo abiertas el usuario. */
export function rememberFolds(scope = document, storeKey = 'camera2pc.folds') {
  let open;
  try { open = new Set(JSON.parse(localStorage.getItem(storeKey) ?? '[]')); }
  catch { open = new Set(); }

  const folds = [...scope.querySelectorAll('details.fold[id]')];
  folds.forEach((el) => { if (open.has(el.id)) el.open = true; });

  const save = () => {
    const ids = folds.filter((el) => el.open).map((el) => el.id);
    try { localStorage.setItem(storeKey, JSON.stringify(ids)); } catch { /* modo privado */ }
  };
  folds.forEach((el) => el.addEventListener('toggle', save));
}
