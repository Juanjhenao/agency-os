/* Lo que hiciste, no lo que debes.
 *
 * Agency OS nació como un sistema de control: el Panel lista seguimientos
 * atrasados, facturas vencidas y propuestas sin respuesta. Cada línea es una
 * deuda. Abrir la aplicación era leer un inventario de maneras en que uno va
 * quedando mal, y no existía una sola pantalla que dijera "esto hiciste hoy".
 *
 * Con un backlog infinito no hay nada que ganar: solo se deja de perder. Este
 * archivo agrega lo que faltaba —un día que se puede cerrar, una racha que se
 * puede sostener y un nivel que sube— sin inventar ningún dato nuevo.
 *
 * Dos decisiones que sostienen todo lo demás:
 *
 *   1. EL XP SE DERIVA, NO SE GUARDA. Cada punto sale de una marca de tiempo
 *      que ya existía en el CRM: `audit.recordedAt`, `touch.sentAt`,
 *      `deal.repliedAt`, `deal.closedAt`, `invoice.paidDate`. No hay contador
 *      que incrementar, así que no hay contador que inflar: los puntos son una
 *      relectura de lo que de verdad pasó. Si se borra un deal, su XP se va
 *      con él. Un marcador que se puede editar aparte de la realidad deja de
 *      significar algo a la semana de existir.
 *
 *   2. LOS RESULTADOS PESAN SOBRE LA ACTIVIDAD. Mandar un mensaje vale 1;
 *      cerrar un cliente vale 500. Quinientos mensajes al vacío valen lo mismo
 *      que un cliente firmado, y esa proporción es el mensaje entero: se puede
 *      hacer mucho ruido y no haber avanzado. Un juego que premiara la
 *      actividad pareja entrenaría para hacer bulto, que es exactamente el
 *      fracaso que este negocio ya tuvo —137 prospectos cargados, cero
 *      enviados— con otra cara.
 */

const { today } = require('./dates');

/* Cuánto vale cada cosa. La tabla es la política del negocio escrita en
 * números: lo que sube de nivel es lo que acerca la plata. */
const XP = {
  auditoria: 5, // grabarla es el trabajo que desbloquea todo lo demás
  mensaje: 1, // volumen: deliberadamente barato
  piezaAprobada: 3,
  piezaPublicada: 5,
  respuesta: 25, // la primera señal de que el mercado existe
  reunionAgendada: 50,
  reunionRealizada: 75,
  propuestaEnviada: 30,
  propuestaAceptada: 200,
  clienteGanado: 500,
  facturaPagada: 100,
};

const ETIQUETAS = {
  auditoria: 'Auditoría grabada',
  mensaje: 'Mensaje enviado',
  piezaAprobada: 'Pieza aprobada',
  piezaPublicada: 'Pieza publicada',
  respuesta: 'Respuesta recibida',
  reunionAgendada: 'Reunión agendada',
  reunionRealizada: 'Reunión realizada',
  propuestaEnviada: 'Propuesta enviada',
  propuestaAceptada: 'Propuesta aceptada',
  clienteGanado: 'Cliente ganado',
  facturaPagada: 'Factura pagada',
};

const META_POR_DEFECTO = { auditorias: 10, mensajes: 10, decisiones: true };

// Fecha local en AAAA-MM-DD desde cualquier marca (ISO o ya recortada).
function dia(marca) {
  if (!marca) return '';
  return String(marca).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Los hechos
// ---------------------------------------------------------------------------

/* Recorre el estado y devuelve la lista plana de todo lo que pasó, fechado.
 * Es la única función que sabe dónde vive cada marca de tiempo; el resto del
 * archivo trabaja sobre esta lista. */
function eventos(state) {
  const out = [];
  const push = (fecha, tipo, texto) => {
    if (!fecha) return;
    out.push({ fecha, tipo, xp: XP[tipo] || 0, texto: texto || ETIQUETAS[tipo] });
  };

  (state.deals || []).forEach((d) => {
    const a = d.audit || {};
    if (a.recordedAt) push(dia(a.recordedAt), 'auditoria', `Auditoría de ${d.title || 'un prospecto'}`);
    if (d.repliedAt) push(dia(d.repliedAt), 'respuesta', `Respondió ${d.title || 'un prospecto'}`);

    const m = d.meeting;
    if (m && m.at) push(dia(m.createdAt || m.at), 'reunionAgendada', `Reunión con ${d.title || 'un prospecto'}`);
    if (m && m.closedAt && m.status === 'realizada') push(dia(m.closedAt), 'reunionRealizada', `Reunión hecha: ${d.title || ''}`);

    if (d.stage === 'ganado' && d.closedAt) push(dia(d.closedAt), 'clienteGanado', `Ganaste ${d.title || 'un cliente'}`);
  });

  (state.touches || []).forEach((t) => {
    if (t.status === 'enviado' && t.sentAt) push(dia(t.sentAt), 'mensaje', t.label || 'Mensaje enviado');
  });

  (state.assets || []).forEach((a) => {
    if (a.aprobadoAt) push(dia(a.aprobadoAt), 'piezaAprobada', `Aprobaste "${a.titulo || 'una pieza'}"`);
    if (a.publicadoAt) push(dia(a.publicadoAt), 'piezaPublicada', `Publicaste "${a.titulo || 'una pieza'}"`);
  });

  (state.proposals || []).forEach((p) => {
    if (p.sentAt) push(dia(p.sentAt), 'propuestaEnviada', `Propuesta ${p.number || ''}`);
    if (p.status === 'aceptada' && p.acceptedDate) push(dia(p.acceptedDate), 'propuestaAceptada', `Aceptaron ${p.number || 'la propuesta'}`);
  });

  (state.invoices || []).forEach((i) => {
    if (i.status === 'pagada' && i.paidDate) push(dia(i.paidDate), 'facturaPagada', `Pagaron ${i.number || 'una factura'}`);
  });

  return out.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/* Agrupa por día: cuánto XP y cuántas cosas de cada tipo. */
function porDia(lista) {
  const mapa = new Map();
  lista.forEach((e) => {
    if (!mapa.has(e.fecha)) mapa.set(e.fecha, { fecha: e.fecha, xp: 0, tipos: {} });
    const d = mapa.get(e.fecha);
    d.xp += e.xp;
    d.tipos[e.tipo] = (d.tipos[e.tipo] || 0) + 1;
  });
  return mapa;
}

// ---------------------------------------------------------------------------
// La meta del día
// ---------------------------------------------------------------------------

function metaDe(state) {
  const cfg = (state.settings && state.settings.juego) || {};
  const auditorias = Number(
    cfg.metaAuditorias !== undefined
      ? cfg.metaAuditorias
      : ((state.settings || {}).outbound || {}).dailyGoal || META_POR_DEFECTO.auditorias
  );
  return {
    auditorias,
    mensajes: Number(cfg.metaMensajes !== undefined ? cfg.metaMensajes : META_POR_DEFECTO.mensajes),
    decisiones: cfg.metaDecisiones !== undefined ? !!cfg.metaDecisiones : META_POR_DEFECTO.decisiones,
  };
}

/* Cuánto trabajo hay disponible hoy de cada clase.
 *
 * La meta se recorta a lo que existe. Si quedan tres auditorías por grabar, el
 * día se cierra con tres, no con diez: pedir diez volvería la racha imposible
 * de sostener el día que el embudo se vacíe, y castigar por haber terminado el
 * trabajo es la forma más rápida de que alguien deje de abrir la aplicación. */
function disponible(state, fecha) {
  const pendientesAudit = (state.deals || []).filter(
    (d) => d.audit && d.audit.status !== 'grabada' && d.stage === 'nuevo'
  ).length;
  const toquesHoy = (state.touches || []).filter((t) => t.status === 'pendiente' && t.dueDate && t.dueDate <= fecha).length;
  const enDespacho = (state.assets || []).filter((a) => a.estado === 'generado').length;
  return { auditorias: pendientesAudit, mensajes: toquesHoy, despacho: enDespacho };
}

/* El día de hoy: qué se hizo, qué se pedía, si quedó cerrado. */
function diaDe(state, fecha, resumen) {
  const meta = metaDe(state);
  const hay = disponible(state, fecha);
  const hecho = resumen || { xp: 0, tipos: {} };

  const auditoriasHechas = hecho.tipos.auditoria || 0;
  const mensajesHechos = hecho.tipos.mensaje || 0;
  const decisionesHechas = (hecho.tipos.piezaAprobada || 0) + (hecho.tipos.piezaPublicada || 0);

  // La meta efectiva nunca pide más de lo que hay para hacer.
  const metaAudit = Math.min(meta.auditorias, auditoriasHechas + hay.auditorias);
  const metaMsg = Math.min(meta.mensajes, mensajesHechos + hay.mensajes);

  const partes = [
    { id: 'auditorias', label: 'Auditorías grabadas', hecho: auditoriasHechas, meta: metaAudit },
    { id: 'mensajes', label: 'Mensajes enviados', hecho: mensajesHechos, meta: metaMsg },
  ];
  if (meta.decisiones) {
    partes.push({
      id: 'despacho',
      label: 'Despacho al día',
      hecho: decisionesHechas,
      meta: decisionesHechas + hay.despacho,
    });
  }

  const cumplidas = partes.filter((p) => p.hecho >= p.meta).length;
  const totalMeta = partes.reduce((s, p) => s + p.meta, 0);
  const totalHecho = partes.reduce((s, p) => s + Math.min(p.hecho, p.meta), 0);

  return {
    fecha,
    xp: hecho.xp,
    partes,
    cumplida: cumplidas === partes.length,
    // Un día sin nada que hacer no es un día perfecto: es un día vacío, y
    // contarlo como victoria abarataría la racha hasta dejarla sin sentido.
    vacia: totalMeta === 0,
    pct: totalMeta ? Math.round((totalHecho / totalMeta) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// La racha
// ---------------------------------------------------------------------------

function ayer(fecha) {
  const d = new Date(`${fecha}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('sv');
}

/* Días seguidos cumpliendo la meta.
 *
 * La racha se lee del historial que cierra el reloj cada noche, no de un
 * recálculo sobre el estado actual. Es a propósito: si se recalculara, cambiar
 * la meta diaria reescribiría el pasado, y una racha que se puede reescribir
 * no se siente ganada. Lo único que se calcula en vivo es hoy, que todavía se
 * está jugando.
 *
 * Que hoy siga pendiente no rompe la racha: aún queda día por delante. */
function racha(state, fecha, hoyCumplido) {
  const historial = ((state.settings || {}).juego || {}).historial || [];
  const porFecha = new Map(historial.map((d) => [d.fecha, d]));

  // Que hoy siga pendiente no rompe la racha: el día vivo no cuenta en contra
  // hasta que termine. Por eso se cuenta hacia atrás desde ayer en los dos
  // casos, y hoy solo suma cuando ya está cumplido.
  let actual = hoyCumplido ? 1 : 0;
  let cursor = ayer(fecha);

  while (porFecha.has(cursor) && porFecha.get(cursor).cumplida) {
    actual += 1;
    cursor = ayer(cursor);
  }

  // La mejor racha histórica, recorriendo el historial en orden.
  const dias = historial.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  let mejor = 0;
  let enCurso = 0;
  let previa = null;
  dias.forEach((d) => {
    if (!d.cumplida) {
      enCurso = 0;
      previa = null;
      return;
    }
    const seguido = previa && Math.round((new Date(`${d.fecha}T00:00:00`) - previa) / 86400000) === 1;
    enCurso = seguido ? enCurso + 1 : 1;
    if (enCurso > mejor) mejor = enCurso;
    previa = new Date(`${d.fecha}T00:00:00`);
  });

  return { actual, mejor: Math.max(mejor, actual), diasCumplidos: dias.filter((d) => d.cumplida).length };
}

// ---------------------------------------------------------------------------
// Nivel
// ---------------------------------------------------------------------------

/* Cada nivel cuesta un 30% más que el anterior, redondeado a decenas para que
 * los números que se ven sean legibles. Misma curva que el habit-tracker: ya
 * está probada contra el uso real de una persona. */
function nivelDesdeXP(xp) {
  let nivel = 1;
  let necesita = 100;
  let acumulado = 0;
  while (xp >= acumulado + necesita) {
    acumulado += necesita;
    nivel += 1;
    necesita = Math.round((necesita * 1.3) / 10) * 10;
  }
  return { nivel, dentro: xp - acumulado, necesita, pct: Math.round(((xp - acumulado) / necesita) * 100) };
}

// ---------------------------------------------------------------------------
// Logros
// ---------------------------------------------------------------------------

/* Cada logro se describe con un valor actual y una meta: el mismo dato sirve
 * para saber si está conseguido y para pintar cuánto falta.
 *
 * Los hitos no son redondos por capricho. "Cien mensajes" es la Regla de 100
 * de Hormozi, que ya gobierna el playbook del negocio; "primera respuesta" es
 * el momento en que se sabe que el mercado existe, y merece ser el logro más
 * celebrado de los primeros. */
const GRUPOS = [
  { id: 'arranque', nombre: 'Arranque' },
  { id: 'volumen', nombre: 'Volumen' },
  { id: 'mercado', nombre: 'Mercado' },
  { id: 'dinero', nombre: 'Dinero' },
  { id: 'constancia', nombre: 'Constancia' },
  { id: 'nivel', nombre: 'Nivel' },
];

const LOGROS = [
  { id: 'primeraAudit', grupo: 'arranque', icon: '◉', nombre: 'Primera auditoría', desc: 'Graba tu primera auditoría', valor: (t) => t.auditorias, meta: 1 },
  { id: 'primerMensaje', grupo: 'arranque', icon: '✉', nombre: 'Primer contacto', desc: 'Manda el primer mensaje', valor: (t) => t.mensajes, meta: 1 },
  { id: 'primeraPieza', grupo: 'arranque', icon: '▷', nombre: 'Primera pieza', desc: 'Publica una pieza de marketing', valor: (t) => t.piezasPublicadas, meta: 1 },

  { id: 'audit10', grupo: 'volumen', icon: '◎', nombre: 'Diez auditorías', desc: 'Graba 10 auditorías', valor: (t) => t.auditorias, meta: 10 },
  { id: 'audit50', grupo: 'volumen', icon: '◎', nombre: 'Cincuenta', desc: 'Graba 50 auditorías', valor: (t) => t.auditorias, meta: 50 },
  { id: 'audit100', grupo: 'volumen', icon: '★', nombre: 'El lote entero', desc: 'Graba 100 auditorías', valor: (t) => t.auditorias, meta: 100 },
  { id: 'msg100', grupo: 'volumen', icon: '⚑', nombre: 'Regla de 100', desc: 'Manda 100 mensajes', valor: (t) => t.mensajes, meta: 100 },
  { id: 'msg500', grupo: 'volumen', icon: '⚑', nombre: 'Quinientos', desc: 'Manda 500 mensajes', valor: (t) => t.mensajes, meta: 500 },

  { id: 'primeraRespuesta', grupo: 'mercado', icon: '◈', nombre: 'El mercado existe', desc: 'Recibe tu primera respuesta', valor: (t) => t.respuestas, meta: 1 },
  { id: 'resp10', grupo: 'mercado', icon: '◈', nombre: 'Diez respuestas', desc: 'Recibe 10 respuestas', valor: (t) => t.respuestas, meta: 10 },
  { id: 'primeraReunion', grupo: 'mercado', icon: '◐', nombre: 'Primera reunión', desc: 'Agenda tu primera llamada', valor: (t) => t.reuniones, meta: 1 },
  { id: 'reunion10', grupo: 'mercado', icon: '◐', nombre: 'Diez llamadas', desc: 'Realiza 10 reuniones', valor: (t) => t.reunionesHechas, meta: 10 },
  { id: 'primeraPropuesta', grupo: 'mercado', icon: '◫', nombre: 'Primera propuesta', desc: 'Manda una propuesta', valor: (t) => t.propuestas, meta: 1 },

  { id: 'primerCliente', grupo: 'dinero', icon: '♛', nombre: 'Primer cliente', desc: 'Cierra tu primer cliente', valor: (t) => t.clientes, meta: 1 },
  { id: 'cliente5', grupo: 'dinero', icon: '♛', nombre: 'Cinco clientes', desc: 'Cierra 5 clientes', valor: (t) => t.clientes, meta: 5 },
  { id: 'primerCobro', grupo: 'dinero', icon: '◆', nombre: 'Primer cobro', desc: 'Cobra tu primera factura', valor: (t) => t.facturasPagadas, meta: 1 },
  { id: 'cobro10', grupo: 'dinero', icon: '◆', nombre: 'Diez cobros', desc: 'Cobra 10 facturas', valor: (t) => t.facturasPagadas, meta: 10 },

  { id: 'racha3', grupo: 'constancia', icon: '▲', nombre: 'Tres seguidos', desc: 'Cumple la meta 3 días seguidos', valor: (t) => t.mejorRacha, meta: 3 },
  { id: 'racha7', grupo: 'constancia', icon: '▲', nombre: 'Semana viva', desc: 'Cumple la meta 7 días seguidos', valor: (t) => t.mejorRacha, meta: 7 },
  { id: 'racha14', grupo: 'constancia', icon: '▲', nombre: 'Dos semanas', desc: 'Cumple la meta 14 días seguidos', valor: (t) => t.mejorRacha, meta: 14 },
  { id: 'racha30', grupo: 'constancia', icon: '★', nombre: 'Mes entero', desc: 'Cumple la meta 30 días seguidos', valor: (t) => t.mejorRacha, meta: 30 },

  { id: 'nivel5', grupo: 'nivel', icon: '✦', nombre: 'Nivel 5', desc: 'Llega al nivel 5', valor: (t) => t.nivel, meta: 5 },
  { id: 'nivel10', grupo: 'nivel', icon: '✦', nombre: 'Nivel 10', desc: 'Llega al nivel 10', valor: (t) => t.nivel, meta: 10 },
  { id: 'nivel25', grupo: 'nivel', icon: '♛', nombre: 'Nivel 25', desc: 'Llega al nivel 25', valor: (t) => t.nivel, meta: 25 },
];

function logrosDe(totales) {
  return LOGROS.map((l) => {
    const valor = Number(l.valor(totales) || 0);
    return {
      id: l.id,
      grupo: l.grupo,
      icon: l.icon,
      nombre: l.nombre,
      desc: l.desc,
      valor,
      meta: l.meta,
      conseguido: valor >= l.meta,
      pct: Math.min(100, Math.round((valor / l.meta) * 100)),
    };
  });
}

// ---------------------------------------------------------------------------
// El estado del juego
// ---------------------------------------------------------------------------

function contar(lista, tipo) {
  return lista.filter((e) => e.tipo === tipo).length;
}

function estado(state, fechaRef) {
  const fecha = fechaRef || today();
  const lista = eventos(state);
  const dias = porDia(lista);

  const xpTotal = lista.reduce((s, e) => s + e.xp, 0);
  const nivel = nivelDesdeXP(xpTotal);

  const hoy = diaDe(state, fecha, dias.get(fecha));
  const r = racha(state, fecha, hoy.cumplida && !hoy.vacia);

  const totales = {
    auditorias: contar(lista, 'auditoria'),
    mensajes: contar(lista, 'mensaje'),
    respuestas: contar(lista, 'respuesta'),
    reuniones: contar(lista, 'reunionAgendada'),
    reunionesHechas: contar(lista, 'reunionRealizada'),
    propuestas: contar(lista, 'propuestaEnviada'),
    clientes: contar(lista, 'clienteGanado'),
    facturasPagadas: contar(lista, 'facturaPagada'),
    piezasPublicadas: contar(lista, 'piezaPublicada'),
    xp: xpTotal,
    nivel: nivel.nivel,
    mejorRacha: r.mejor,
    rachaActual: r.actual,
  };

  return {
    xp: xpTotal,
    nivel,
    hoy,
    racha: r,
    totales,
    logros: logrosDe(totales),
    grupos: GRUPOS,
    // Lo último que pasó, para que la portada pueda mostrar movimiento en vez
    // de una lista de pendientes.
    reciente: lista.slice(0, 8),
    tabla: XP,
  };
}

/* Cierra el día y lo deja escrito en el historial. Lo llama el reloj.
 *
 * Se guarda el resultado, no los ingredientes: una vez cerrado, ese día ya no
 * cambia aunque después se ajuste la meta. Es lo que hace que la racha se
 * sienta ganada en vez de recalculada. */
function cerrarDia(state, fecha) {
  const f = fecha || today();
  const cfg = state.settings.juego || (state.settings.juego = {});
  if (!Array.isArray(cfg.historial)) cfg.historial = [];
  if (cfg.historial.some((d) => d.fecha === f)) return null;

  const dias = porDia(eventos(state));
  const d = diaDe(state, f, dias.get(f));
  const registro = { fecha: f, xp: d.xp, cumplida: d.cumplida && !d.vacia, pct: d.pct };
  cfg.historial.push(registro);

  // Un año de historial alcanza para cualquier racha que valga la pena y evita
  // que el archivo del vault crezca sin control.
  if (cfg.historial.length > 400) cfg.historial = cfg.historial.slice(-400);
  return registro;
}

module.exports = {
  XP,
  ETIQUETAS,
  LOGROS,
  GRUPOS,
  META_POR_DEFECTO,
  eventos,
  porDia,
  metaDe,
  disponible,
  diaDe,
  racha,
  nivelDesdeXP,
  logrosDe,
  estado,
  cerrarDia,
};
