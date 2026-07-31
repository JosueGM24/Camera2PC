// Lista los monitores que ve Windows, via Window Management API.
//
// No podemos CREAR una pantalla desde el navegador (eso exige un driver IddCx
// firmado), pero si podemos mirar las que hay. Sirve para que el paso del
// monitor virtual deje de hacerse a ciegas: confirmas que aparecio y sabes
// cual elegir al compartir.
//
// Solo Chrome y Edge de escritorio. Pide permiso la primera vez.

export const displaysReadable = () => typeof window.getScreenDetails === 'function';

/**
 * @returns {Promise<Array>} monitores con etiqueta, tamano y banderas
 * @throws  {Error} con .code = 'unsupported' | 'denied'
 */
export async function listDisplays() {
  if (!displaysReadable()) {
    const err = new Error('Este navegador no puede leer la lista de monitores');
    err.code = 'unsupported';
    throw err;
  }

  let details;
  try {
    details = await window.getScreenDetails();
  } catch (cause) {
    const err = new Error('Permiso de gestion de ventanas denegado');
    err.code = cause?.name === 'NotAllowedError' ? 'denied' : 'error';
    throw err;
  }

  return details.screens.map((s, i) => ({
    label: s.label || `Monitor ${i + 1}`,
    width: s.width,
    height: s.height,
    // Pixeles reales: es lo que hay que comparar con la resolucion de la tablet.
    pixelWidth: Math.round(s.width * s.devicePixelRatio),
    pixelHeight: Math.round(s.height * s.devicePixelRatio),
    primary: s.isPrimary === true,
    internal: s.isInternal === true,
  }));
}

/**
 * Texto para la interfaz. Marca los candidatos a monitor virtual, sin prometer
 * mas de lo que se puede saber: Windows no dice "este es virtual", asi que la
 * pista es que no sea el principal ni la pantalla integrada.
 */
export function formatDisplays(list) {
  if (!list.length) return 'Windows no reporto ningun monitor.';

  const lines = list.map((d) => {
    const marks = [];
    if (d.primary) marks.push('principal');
    if (d.internal) marks.push('integrada');
    const candidate = !d.primary && !d.internal;
    return `${candidate ? '>' : ' '} ${d.label}  ${d.pixelWidth}x${d.pixelHeight}`
      + (marks.length ? `  (${marks.join(', ')})` : '');
  });

  const candidates = list.filter((d) => !d.primary && !d.internal).length;
  const tail = candidates
    ? `\n\nLos marcados con > son los candidatos a monitor virtual: elige ese al compartir.`
    : `\n\nSolo veo tu pantalla principal. Si acabas de instalar el driver, revisa que el monitor este activado en Configuracion > Pantalla.`;

  return `${list.length} monitor(es):\n${lines.join('\n')}${tail}`;
}
