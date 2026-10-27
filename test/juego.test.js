/* El juego: XP derivado, meta del dia, racha, niveles y logros.
 *
 * Estado sintetico en memoria, sin servidor ni vault. Lo que se afirma aqui no
 * es "el numero sale bien" sino que las reglas que hacen que el marcador
 * signifique algo se cumplan:
 *
 *   - que el XP se derive del CRM y no se pueda inflar aparte
 *   - que los resultados pesen sobre la actividad
 *   - que la meta no pida mas trabajo del que hay
 *   - que un dia vacio no cuente como victoria
 *   - que la racha no la rompa un dia que todavia se esta jugando
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const juego = require(path.join(ROOT, 'lib/juego.js'));

function ok(label, cond, extra) {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${label}${extra !== undefined ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
}

const HOY = '2026-08-15';
const AYER = '2026-08-14';

function base(extra) {
  return {
    deals: [],
    touches: [],
    assets: [],
    proposals: [],
    invoices: [],
    settings: { outbound: { dailyGoal: 10 }, juego: { metaMensajes: 10, metaDecisiones: false, historial: [] } },
    ...extra,
  };
}

// --- 1. El XP se deriva de las marcas del CRM ------------------------------

const conTrabajo = base({
  deals: [
    { id: 'd1', title: 'Aurora', stage: 'nuevo', audit: { status: 'grabada', recordedAt: `${HOY}T10:00:00Z` } },
    { id: 'd2', title: 'Bella', stage: 'reunion', audit: {}, repliedAt: `${HOY}T11:00:00Z` },
  ],
  touches: [{ id: 't1', status: 'enviado', sentAt: `${HOY}T09:00:00Z`, label: 'Toque 1' }],
});

const e1 = juego.estado(conTrabajo, HOY);
ok('cuenta la auditoria grabada', e1.totales.auditorias === 1);
ok('cuenta el mensaje enviado', e1.totales.mensajes === 1);
ok('cuenta la respuesta', e1.totales.respuestas === 1);
ok('suma el XP de los tres', e1.xp === juego.XP.auditoria + juego.XP.mensaje + juego.XP.respuesta, `${e1.xp}`);

/* La prueba central del diseno: no hay contador que escribir. Si se borra el
 * deal, su XP se va con el. Un marcador que sobrevive al hecho que lo produjo
 * deja de significar algo. */
const sinDeal = juego.estado(base({ touches: conTrabajo.touches }), HOY);
ok('borrar el hecho borra su XP', sinDeal.xp === juego.XP.mensaje, `${sinDeal.xp}`);

// Un XP inventado en settings no cambia nada: no se lee de ninguna parte.
const conTrampa = base({ settings: { outbound: { dailyGoal: 10 }, juego: { xp: 999999, historial: [] } } });
ok('no se puede inflar el marcador por fuera', juego.estado(conTrampa, HOY).xp === 0);

// --- 2. Los resultados pesan sobre la actividad ---------------------------

const cliente = juego.XP.clienteGanado;
const mensaje = juego.XP.mensaje;
ok('un cliente vale como 500 mensajes', cliente === mensaje * 500, `${cliente} vs ${mensaje}`);
ok('una respuesta vale mas que 20 mensajes', juego.XP.respuesta > mensaje * 20);
ok('cerrar vale mas que agendar', juego.XP.clienteGanado > juego.XP.reunionAgendada);
ok('agendar vale mas que grabar', juego.XP.reunionAgendada > juego.XP.auditoria);

// --- 3. La meta del dia ---------------------------------------------------

// Con mucho trabajo disponible, la meta es la configurada.
const conCola = base({
  deals: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, stage: 'nuevo', audit: { status: 'sin-grabar' } })),
  touches: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, status: 'pendiente', dueDate: HOY })),
});
const dia = juego.estado(conCola, HOY).hoy;
ok('pide la meta completa cuando hay trabajo de sobra', dia.partes[0].meta === 10 && dia.partes[1].meta === 10);
ok('el dia arranca sin cumplir', dia.cumplida === false);

/* Con el embudo casi vacio la meta se recorta a lo que existe. Sin esto, la
 * racha se volveria imposible el dia que se acabe el trabajo, y castigar por
 * haber terminado es la forma mas rapida de que alguien deje de abrir la app. */
const casiVacio = base({
  deals: [
    { id: 'a', stage: 'nuevo', audit: { status: 'sin-grabar' } },
    { id: 'b', stage: 'nuevo', audit: { status: 'sin-grabar' } },
  ],
  touches: [{ id: 't', status: 'pendiente', dueDate: HOY }],
});
const diaCorto = juego.estado(casiVacio, HOY).hoy;
ok('la meta se recorta a lo que hay', diaCorto.partes[0].meta === 2 && diaCorto.partes[1].meta === 1, `${diaCorto.partes[0].meta}/${diaCorto.partes[1].meta}`);

// Sin nada que hacer y nada hecho: no es victoria, es un dia vacio.
const diaVacio = juego.estado(base(), HOY).hoy;
ok('un dia sin trabajo no es un dia perfecto', diaVacio.vacia === true);

// Todo hecho: el dia se cierra.
const todoHecho = base({
  deals: [{ id: 'a', stage: 'nuevo', audit: { status: 'grabada', recordedAt: `${HOY}T08:00:00Z` } }],
  touches: [{ id: 't', status: 'enviado', sentAt: `${HOY}T09:00:00Z` }],
});
const cerrado = juego.estado(todoHecho, HOY).hoy;
ok('el dia se cierra cuando no queda nada pendiente', cerrado.cumplida === true && cerrado.vacia === false, `${cerrado.pct}%`);

// --- 4. La racha ----------------------------------------------------------

function conHistorial(dias, extra) {
  const s = base(extra);
  s.settings.juego.historial = dias;
  return s;
}

const tresSeguidos = conHistorial([
  { fecha: '2026-08-12', cumplida: true },
  { fecha: '2026-08-13', cumplida: true },
  { fecha: AYER, cumplida: true },
]);
ok('cuenta los dias seguidos de ayer hacia atras', juego.racha(tresSeguidos, HOY, false).actual === 3);
ok('hoy cumplido suma uno mas', juego.racha(tresSeguidos, HOY, true).actual === 4);

/* Que hoy siga pendiente no rompe la racha: todavia queda dia por delante.
 * Esta es la regla que evita que abrir la app a las 8 de la manana se sienta
 * como haber fallado. */
ok('el dia vivo no cuenta en contra', juego.racha(tresSeguidos, HOY, false).actual === 3);

const conHueco = conHistorial([
  { fecha: '2026-08-10', cumplida: true },
  { fecha: '2026-08-11', cumplida: true },
  { fecha: '2026-08-12', cumplida: false },
  { fecha: AYER, cumplida: true },
]);
const rHueco = juego.racha(conHueco, HOY, false);
ok('un dia fallado corta la racha', rHueco.actual === 1, `${rHueco.actual}`);
ok('pero la mejor racha historica se conserva', rHueco.mejor === 2, `${rHueco.mejor}`);

// --- 5. Cierre del dia ----------------------------------------------------

const paraCerrar = conHistorial([], {
  deals: [{ id: 'a', stage: 'nuevo', audit: { status: 'grabada', recordedAt: `${AYER}T08:00:00Z` } }],
  touches: [{ id: 't', status: 'enviado', sentAt: `${AYER}T09:00:00Z` }],
});
const reg = juego.cerrarDia(paraCerrar, AYER);
ok('cierra el dia y lo escribe', reg && reg.fecha === AYER);
ok('el registro guarda el resultado, no los ingredientes', reg.cumplida === true && typeof reg.xp === 'number');
ok('no cierra dos veces el mismo dia', juego.cerrarDia(paraCerrar, AYER) === null);
ok('queda una sola entrada', paraCerrar.settings.juego.historial.length === 1);

/* Cerrado el dia, cambiar la meta ya no lo reescribe. Es lo que hace que la
 * racha se sienta ganada en vez de recalculada. */
paraCerrar.settings.juego.metaMensajes = 999;
ok('el pasado no se reescribe al cambiar la meta', paraCerrar.settings.juego.historial[0].cumplida === true);

// --- 6. Niveles -----------------------------------------------------------

ok('se arranca en nivel 1', juego.nivelDesdeXP(0).nivel === 1);
ok('100 XP sube a nivel 2', juego.nivelDesdeXP(100).nivel === 2);
ok('cada nivel cuesta mas que el anterior', juego.nivelDesdeXP(100).necesita > 100);
const n = juego.nivelDesdeXP(150);
ok('el porcentaje dentro del nivel es coherente', n.pct === Math.round((n.dentro / n.necesita) * 100));

// --- 7. Logros ------------------------------------------------------------

const l0 = juego.logrosDe({ auditorias: 0, mensajes: 0, respuestas: 0, reuniones: 0, reunionesHechas: 0, propuestas: 0, clientes: 0, facturasPagadas: 0, piezasPublicadas: 0, nivel: 1, mejorRacha: 0 });
ok('sin nada hecho no hay logros', l0.every((l) => !l.conseguido));
// Todos traen su meta y un avance legible. Los de nivel arrancan con progreso
// parcial —se empieza en nivel 1 de 5— y eso esta bien: es progreso real.
ok('todos muestran cuanto falta', l0.every((l) => l.meta > 0 && l.pct >= 0 && l.pct <= 100));
ok('los de esfuerzo arrancan en cero', l0.filter((l) => l.grupo !== 'nivel').every((l) => l.pct === 0));

const l1 = juego.logrosDe({ auditorias: 1, mensajes: 100, respuestas: 1, reuniones: 0, reunionesHechas: 0, propuestas: 0, clientes: 0, facturasPagadas: 0, piezasPublicadas: 0, nivel: 1, mejorRacha: 0 });
ok('la primera auditoria es un logro', l1.find((l) => l.id === 'primeraAudit').conseguido);
ok('la Regla de 100 se consigue a los 100 mensajes', l1.find((l) => l.id === 'msg100').conseguido);
ok('la primera respuesta es un logro', l1.find((l) => l.id === 'primeraRespuesta').conseguido);
ok('lo que no se ha hecho sigue pendiente', !l1.find((l) => l.id === 'primerCliente').conseguido);
ok('el progreso parcial se ve', l1.find((l) => l.id === 'msg500').pct === 20, `${l1.find((l) => l.id === 'msg500').pct}%`);

// --- 8. Los eventos vienen fechados y ordenados ---------------------------

const variados = base({
  deals: [
    { id: 'd', title: 'X', stage: 'ganado', closedAt: HOY, audit: { recordedAt: `2026-08-01T10:00:00Z` } },
    { id: 'm', title: 'Y', stage: 'reunion', audit: {}, meeting: { at: '2026-09-01T15:00:00Z', createdAt: `${HOY}T12:00:00Z`, status: 'agendada' } },
  ],
});
const evs = juego.eventos(variados);
ok('el mas reciente va primero', evs[0].fecha >= evs[evs.length - 1].fecha);
ok(
  'la reunion se acredita el dia que se agendo, no el dia que ocurre',
  evs.some((e) => e.tipo === 'reunionAgendada' && e.fecha === HOY),
  evs.filter((e) => e.tipo === 'reunionAgendada').map((e) => e.fecha).join()
);
ok('cerrar cliente es el evento mas caro del lote', Math.max(...evs.map((e) => e.xp)) === juego.XP.clienteGanado);
