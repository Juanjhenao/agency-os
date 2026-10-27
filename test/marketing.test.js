/* El ledger de marketing: agregacion, guardrails de evidencia y veredictos.
 *
 * Todo corre sobre un estado sintetico en memoria — no toca el vault. Es
 * deliberado: estas pruebas afirman cosas sobre COMO se concluye, y para eso
 * hace falta poder fabricar el caso exacto (el ganador claro, el empate, el
 * volumen insuficiente) en vez de esperar a que aparezca en los datos reales.
 *
 * La mitad de las pruebas verifican que el modulo se NIEGUE a concluir. Esa es
 * la funcionalidad, no el borde: un motor de aprendizaje que siempre encuentra
 * un ganador es un generador de supersticiones.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const mk = require(path.join(ROOT, 'lib/marketing.js'));
const validate = require(path.join(ROOT, 'lib/validate.js'));

function ok(label, cond, extra) {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
}

// --- Andamiaje -------------------------------------------------------------

let n = 0;
function asset(props) {
  n += 1;
  return {
    id: `a${n}`,
    campaignId: 'c1',
    canal: 'outbound',
    tipo: 'email',
    titulo: `Pieza ${n}`,
    angulo: 'dolor',
    gancho: 'gancho generico',
    nicho: 'medspa',
    estado: 'publicado',
    publicadoAt: '2026-08-01',
    ...props,
  };
}

function outcome(assetId, m) {
  return { id: `o-${assetId}-${Math.random()}`, assetId, campaignId: 'c1', fecha: '2026-08-10', fuente: 'crm', m };
}

// --- 1. Metricas derivadas -------------------------------------------------

const suma = mk.sumar([
  outcome('x', { enviados: 100, respuestas: 20, reuniones: 4 }),
  outcome('x', { enviados: 100, respuestas: 10, reuniones: 2 }),
]);
ok('suma los contadores crudos', suma.enviados === 200 && suma.respuestas === 30);

const der = mk.derivar(suma);
ok('deriva la tasa sobre el total, no promediando promedios', Math.abs(der.tasaRespuesta - 0.15) < 1e-9, `${der.tasaRespuesta}`);

/* Si se promediaran las dos tasas (20% y 10%) daria 15% por coincidencia de
 * volumenes iguales. Con volumenes distintos la diferencia se vuelve gruesa, y
 * es el error clasico que invierte la conclusion. */
const desigual = mk.derivar(mk.sumar([
  outcome('x', { enviados: 10, respuestas: 5 }),   // 50%
  outcome('x', { enviados: 990, respuestas: 99 }), // 10%
]));
ok('el volumen manda sobre el promedio de tasas', Math.abs(desigual.tasaRespuesta - 0.104) < 1e-3, `${desigual.tasaRespuesta.toFixed(4)} (promediar daria 0.30)`);

ok('division por cero devuelve null, no Infinity', mk.derivar(mk.sumar([outcome('x', { gasto: 500, leads: 0 })])).cpl === null);
ok('un CTR sin impresiones es null', mk.derivar(crudo({ clics: 3 })).ctr === null);

function crudo(m) {
  return mk.sumar([outcome('x', m)]);
}

// --- 2. El guardrail de evidencia -----------------------------------------

ok(
  'niega con volumen insuficiente en outbound',
  mk.evidenciaSuficiente('outbound', crudo({ enviados: 12 })).suficiente === false,
  mk.evidenciaSuficiente('outbound', crudo({ enviados: 12 })).motivo
);
ok('acepta con volumen suficiente', mk.evidenciaSuficiente('outbound', crudo({ enviados: 30 })).suficiente === true);
ok('el motivo dice cuanto falta', mk.evidenciaSuficiente('outbound', crudo({ enviados: 12 })).motivo.includes('30'));
ok(
  'la pauta se mide en impresiones, no en envios',
  mk.evidenciaSuficiente('meta-ads', crudo({ impresiones: 999 })).suficiente === false &&
    mk.evidenciaSuficiente('meta-ads', crudo({ impresiones: 1000 })).suficiente === true
);
ok('canal desconocido nunca es suficiente', mk.evidenciaSuficiente('tiktok-ads', crudo({ enviados: 9999 })).suficiente === false);

/* Volumen alto con pocos leads es ambiguo y se frena. Volumen alto con CERO
 * leads no es ambiguo: es un resultado, y de los mas utiles, asi que tiene que
 * poder concluirse para que el patron se degrade. */
ok('frena con volumen alto pero pocos leads', mk.evidenciaSuficiente('outbound', crudo({ enviados: 500, leads: 2 })).suficiente === false);
ok('cero leads con volumen SI concluye (es un resultado)', mk.evidenciaSuficiente('outbound', crudo({ enviados: 500, leads: 0 })).suficiente === true);

// --- 3. Agrupacion por dimension ------------------------------------------

const ganador = asset({ angulo: 'dolor' });
const perdedor = asset({ angulo: 'beneficio' });
const borrador = asset({ angulo: 'urgencia', estado: 'generado', publicadoAt: '' });

const state = {
  assets: [ganador, perdedor, borrador],
  outcomes: [
    outcome(ganador.id, { enviados: 200, respuestas: 40, reuniones: 8 }),
    outcome(perdedor.id, { enviados: 200, respuestas: 10, reuniones: 1 }),
    outcome(borrador.id, { enviados: 999, respuestas: 999 }),
  ],
  experiments: [],
  patterns: [],
};

const grupos = mk.agrupar(state, { dimension: 'angulo' });
ok('agrupa solo lo que estuvo publicado', grupos.length === 2, `${grupos.length} grupos: ${grupos.map((g) => g.valor).join(', ')}`);
ok('lo que nunca salio no entra', !grupos.some((g) => g.valor === 'urgencia'));

const comparados = mk.comparar(grupos, 'tasaRespuesta');
ok('ordena el mejor primero', comparados[0].valor === 'dolor', `primero: ${comparados[0].valor}`);
/* `valor` es el nombre del angulo; la cifra va en `valorMetrica`. Estuvieron
 * colisionando y el consumidor recibia 0.2 donde esperaba "dolor". */
ok('la comparacion conserva el nombre de la dimension', typeof comparados[0].valor === 'string' && typeof comparados[0].valorMetrica === 'number');
ok('los campos salen con el nombre que usa la coleccion patterns', 'baseline' in comparados[0] && 'valorMetrica' in comparados[0]);
ok('el delta se mide contra los OTROS, no contra el total', Math.abs(comparados[0].delta - 3) < 1e-9, `delta ${comparados[0].delta} (20% vs 5%)`);

// En CPL, menos es mejor: el delta positivo tiene que ser el del mas barato.
const barato = asset({ angulo: 'barato', canal: 'meta-ads' });
const caro = asset({ angulo: 'caro', canal: 'meta-ads' });
const stateCPL = {
  assets: [barato, caro],
  outcomes: [
    outcome(barato.id, { impresiones: 5000, gasto: 100, leads: 20 }), // CPL 5
    outcome(caro.id, { impresiones: 5000, gasto: 400, leads: 20 }),   // CPL 20
  ],
};
const porCPL = mk.comparar(mk.agrupar(stateCPL, { dimension: 'angulo' }), 'cpl');
ok('en CPL gana el mas barato, no el mas alto', porCPL[0].valor === 'barato', `primero: ${porCPL[0].valor}`);
ok('el delta de un CPL menor es positivo', porCPL[0].delta > 0, `${porCPL[0].delta}`);

// Un grupo que mezcla canales no puede evaluarse con un solo umbral.
const mezcla = mk.agrupar(
  { assets: [asset({ angulo: 'mixto', canal: 'outbound' }), asset({ angulo: 'mixto', canal: 'meta-ads' })], outcomes: [] },
  { dimension: 'angulo' }
);
ok('marca la mezcla de canales en vez de concluir', mezcla[0].evidencia.suficiente === false && mezcla[0].evidencia.motivo.includes('canales'), mezcla[0].evidencia.motivo);

// --- 4. Experimentos: el veredicto y sus negativas -------------------------

const vA = asset({ variante: 'A' });
const vB = asset({ variante: 'B' });

function expEstado(outcomes) {
  return { assets: [vA, vB], outcomes, experiments: [], patterns: [] };
}
const exp = { id: 'e1', metrica: 'tasaRespuesta', variantes: [vA.id, vB.id] };

const flaco = mk.evaluarExperimento(expEstado([
  outcome(vA.id, { enviados: 10, respuestas: 5 }),
  outcome(vB.id, { enviados: 10, respuestas: 1 }),
]), exp);
ok('no declara ganador sin evidencia, por clara que parezca la diferencia', flaco.estado === 'corriendo', flaco.veredicto);
ok('dice exactamente que falta', flaco.veredicto.includes('30'), flaco.veredicto);

const claro = mk.evaluarExperimento(expEstado([
  outcome(vA.id, { enviados: 200, respuestas: 40 }),
  outcome(vB.id, { enviados: 200, respuestas: 10 }),
]), exp);
ok('declara ganador cuando hay evidencia y diferencia', claro.estado === 'concluido' && claro.ganador === vA.id, claro.veredicto);

const empate = mk.evaluarExperimento(expEstado([
  outcome(vA.id, { enviados: 200, respuestas: 42 }),
  outcome(vB.id, { enviados: 200, respuestas: 40 }),
]), exp);
ok('5% de diferencia es empate, no victoria', empate.estado === 'concluido' && !empate.ganador, empate.veredicto);

const solo = mk.evaluarExperimento(expEstado([outcome(vA.id, { enviados: 200, respuestas: 40 })]), { ...exp, variantes: [vA.id] });
ok('un solo brazo no es un experimento', solo.estado === 'corriendo' && !solo.ganador);

// --- 5. Vigencia de patrones ----------------------------------------------

const conPatrones = {
  patterns: [
    { id: 'p1', estado: 'promovido', revisadoAt: '2026-08-10' },
    { id: 'p2', estado: 'promovido', revisadoAt: '2026-01-01' },
    { id: 'p3', estado: 'cementerio', revisadoAt: '2026-01-01' },
  ],
};
const vencidos = mk.patronesVencidos(conPatrones, '2026-08-15');
ok('caduca el patron viejo', vencidos.some((p) => p.id === 'p2'));
ok('respeta el patron reciente', !vencidos.some((p) => p.id === 'p1'));
ok('no revive lo que ya esta en el cementerio', !vencidos.some((p) => p.id === 'p3'));

// --- 6. Los rechazos como senal -------------------------------------------

const rechazos = mk.motivosDeRechazo({
  assets: [
    asset({ estado: 'rechazado', motivoRechazo: 'muy largo', updatedAt: '2026-08-10' }),
    asset({ estado: 'rechazado', motivoRechazo: 'muy largo', updatedAt: '2026-08-11' }),
    asset({ estado: 'rechazado', motivoRechazo: 'promete resultados', updatedAt: '2026-08-12' }),
    asset({ estado: 'publicado' }),
  ],
});
ok('cuenta los rechazos', rechazos.total === 3, `${rechazos.total}`);
ok('ordena el motivo mas repetido primero', rechazos.motivos[0].motivo === 'muy largo' && rechazos.motivos[0].veces === 2);

// --- 7. Validacion de la API ----------------------------------------------

ok(
  'rechaza un canal inventado',
  lanza(() => validate.limpiar('assets', { canal: 'telepatia' })),
  'assets.canal'
);
ok('acepta un canal valido', !lanza(() => validate.limpiar('assets', { canal: 'meta-ads', tipo: 'ad-copy' })));

const limpio = validate.limpiar('outcomes', { m: { impresiones: '1,234', gasto: '$ 45,60', leads: 7 } });
ok('normaliza los numeros que llegan del CSV', limpio.m.impresiones === 1234 && limpio.m.leads === 7, `impresiones ${limpio.m.impresiones}`);
ok('una metrica negativa es un error, no un dato', lanza(() => validate.limpiar('outcomes', { m: { leads: -3 } })));
ok('una metrica ilegible es un error, no un cero', lanza(() => validate.limpiar('outcomes', { m: { impresiones: 'muchas' } })));

// Transiciones de estado.
ok('no se puede publicar lo rechazado', lanza(() => validate.limpiar('assets', { estado: 'publicado', _estadoActual: 'rechazado' })));
ok('no se puede revivir lo retirado', lanza(() => validate.limpiar('assets', { estado: 'publicado', _estadoActual: 'retirado' })));
ok('generado puede aprobarse', !lanza(() => validate.limpiar('assets', { estado: 'aprobado', _estadoActual: 'generado' })));
ok('aprobado puede publicarse', !lanza(() => validate.limpiar('assets', { estado: 'publicado', _estadoActual: 'aprobado' })));
ok('publicado puede pausarse', !lanza(() => validate.limpiar('assets', { estado: 'pausado', _estadoActual: 'publicado' })));
ok('no se puede saltar de generado a publicado', lanza(() => validate.limpiar('assets', { estado: 'publicado', _estadoActual: 'generado' })));
ok('el campo de control no se guarda', validate.limpiar('assets', { estado: 'aprobado', _estadoActual: 'generado' })._estadoActual === undefined);

function lanza(fn) {
  try {
    fn();
    return false;
  } catch (err) {
    return err.esDeDatos === true;
  }
}

// --- 8. El tablero ---------------------------------------------------------

const tab = mk.tablero(state, { metrica: 'tasaRespuesta' });
ok('el tablero cuenta lo que espera en Despacho', tab.despacho === 1, `${tab.despacho}`);
ok('el tablero trae las dimensiones', Array.isArray(tab.dimensiones.angulo) && tab.dimensiones.angulo.length === 2);
ok('el tablero cubre los cinco canales', tab.porCanal.length === 5);
