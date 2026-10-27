/* El reloj: lo que el sistema hace solo cada día.
 *
 * Se prueba con un estado armado a mano, sin servidor, porque lo que importa
 * son las reglas de negocio: cuándo una factura entra en mora, cuándo hay que
 * llamar por la renovación y cuándo un cliente activo está en riesgo.
 */

const path = require('path');
const reloj = require(path.join(__dirname, '..', 'lib', 'reloj.js'));
const { today, addDays } = require(path.join(__dirname, '..', 'lib', 'dates.js'));

let fallas = 0;
function ok(label, cond, extra) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${label}${extra !== undefined ? ` — ${extra}` : ''}`);
  if (!cond) fallas += 1;
}

function estadoBase() {
  return {
    settings: {
      reloj: { activo: true, hora: '08:00', avisoRenovacionDias: 15, ultimaCorrida: '', ultimaCorridaAt: '' },
      outbound: { dailyGoal: 10 },
    },
    clients: [],
    deals: [],
    invoices: [],
    proposals: [],
    subscriptions: [],
    productions: [],
    pieces: [],
    touches: [],
  };
}

// --- Moras -------------------------------------------------------------------
const s1 = estadoBase();
s1.invoices = [
  { id: 'i1', number: 'FA-0001', status: 'enviada', dueDate: addDays(today(), -3) },
  { id: 'i2', number: 'FA-0002', status: 'enviada', dueDate: addDays(today(), 5) },
  { id: 'i3', number: 'FA-0003', status: 'enviada', dueDate: today() },
  { id: 'i4', number: 'FA-0004', status: 'pagada', dueDate: addDays(today(), -30) },
  { id: 'i5', number: 'FA-0005', status: 'borrador', dueDate: addDays(today(), -10) },
];
const moras = reloj.marcarMoras(s1);
ok('marca en mora la que ya venció', moras.includes('FA-0001'));
ok('no toca la que aún no vence', !moras.includes('FA-0002'));
ok('la que vence hoy todavía no está en mora', !moras.includes('FA-0003'));
ok('no toca una factura ya pagada', !moras.includes('FA-0004'));
ok('no toca un borrador sin enviar', !moras.includes('FA-0005'));
ok('deja el estado escrito', s1.invoices[0].status === 'vencida');

// Correr dos veces no debe volver a reportar lo mismo.
ok('correrla otra vez no reporta de nuevo', reloj.marcarMoras(s1).length === 0);

// --- Renovaciones ------------------------------------------------------------
const s2 = estadoBase();
s2.clients = [
  { id: 'c1', name: 'Aurora Med Spa', status: 'activo' },
  { id: 'c2', name: 'Bella Skin', status: 'activo' },
  { id: 'c3', name: 'Lejana', status: 'activo' },
];
s2.subscriptions = [
  { id: 's1', clientId: 'c1', status: 'activa', nextInvoiceDate: addDays(today(), 10), amount: 1800, currency: 'USD' },
  { id: 's2', clientId: 'c2', status: 'activa', nextInvoiceDate: addDays(today(), 40), amount: 1800, currency: 'USD' },
  { id: 's3', clientId: 'c3', status: 'pausada', nextInvoiceDate: addDays(today(), 5), amount: 900, currency: 'USD' },
];
const renov = reloj.avisarRenovaciones(s2, 15);
ok('avisa la que renueva dentro del plazo', renov.some((r) => r.cliente === 'Aurora Med Spa'));
ok('no avisa la que renueva en 40 días', !renov.some((r) => r.cliente === 'Bella Skin'));
ok('ignora las suscripciones pausadas', !renov.some((r) => r.cliente === 'Lejana'));
ok('dice cuántos días faltan', renov[0] && renov[0].faltan === 10, renov[0] ? renov[0].faltan : '—');

// --- Riesgo de churn ---------------------------------------------------------
const mes = today().slice(0, 7);
const s3 = estadoBase();
s3.clients = [
  { id: 'c1', name: 'Sin mes', status: 'activo' },
  { id: 'c2', name: 'Mes vacio', status: 'activo' },
  { id: 'c3', name: 'Entregando', status: 'activo' },
  { id: 'c4', name: 'Ex cliente', status: 'perdido' },
];
s3.productions = [
  { id: 'p2', clientId: 'c2', month: mes },
  { id: 'p3', clientId: 'c3', month: mes },
];
s3.pieces = [{ id: 'x1', productionId: 'p3', status: 'publicado' }];
const riesgo = reloj.detectarRiesgo(s3);
ok('detecta al cliente sin mes abierto', riesgo.some((r) => r.cliente === 'Sin mes'));
ok('detecta el mes abierto sin piezas', riesgo.some((r) => r.cliente === 'Mes vacio'));
ok('no marca al que sí está entregando', !riesgo.some((r) => r.cliente === 'Entregando'));
ok('ignora a quien ya no es cliente', !riesgo.some((r) => r.cliente === 'Ex cliente'));

// --- Propuestas caducadas ----------------------------------------------------
const s6 = estadoBase();
s6.proposals = [
  { id: 'p1', number: 'P-0001', status: 'enviada', validUntil: addDays(today(), -1) },
  { id: 'p2', number: 'P-0002', status: 'enviada', validUntil: addDays(today(), 5) },
  { id: 'p3', number: 'P-0003', status: 'enviada', validUntil: today() },
  { id: 'p4', number: 'P-0004', status: 'aceptada', validUntil: addDays(today(), -20) },
  { id: 'p5', number: 'P-0005', status: 'enviada', validUntil: '' },
];
const caducadas = reloj.vencerPropuestas(s6);
ok('vence la que pasó su vigencia', caducadas.includes('P-0001'));
ok('no toca la que sigue viva', !caducadas.includes('P-0002'));
ok('la que vence hoy todavía vale', !caducadas.includes('P-0003'));
ok('no toca una propuesta ya aceptada', !caducadas.includes('P-0004'));
ok('no inventa vencimiento sin fecha', !caducadas.includes('P-0005'));
ok('correrla otra vez no reporta de nuevo', reloj.vencerPropuestas(s6).length === 0);

// --- Prospectos sin un solo dato de contacto ---------------------------------
const s7 = estadoBase();
s7.clients = [
  { id: 'c1', name: 'Fantasma', status: 'lead' },
  { id: 'c2', name: 'Con telefono', status: 'lead', phone: '+1 305 555 0000' },
  { id: 'c3', name: 'Solo instagram', status: 'lead', instagram: '@clinica' },
  { id: 'c4', name: 'Recien cargado', status: 'lead' },
  { id: 'c5', name: 'Ya grabado', status: 'lead' },
];
const viejo = addDays(today(), -10);
s7.deals = [
  { id: 'd1', clientId: 'c1', title: 'Fantasma', stage: 'nuevo', createdAt: viejo, audit: { status: 'sin-grabar' } },
  { id: 'd2', clientId: 'c2', title: 'Con telefono', stage: 'nuevo', createdAt: viejo, audit: { status: 'sin-grabar' } },
  { id: 'd3', clientId: 'c3', title: 'Solo instagram', stage: 'nuevo', createdAt: viejo, audit: { status: 'sin-grabar' } },
  { id: 'd4', clientId: 'c4', title: 'Recien cargado', stage: 'nuevo', createdAt: today(), audit: { status: 'sin-grabar' } },
  { id: 'd5', clientId: 'c5', title: 'Ya grabado', stage: 'nuevo', createdAt: viejo, audit: { status: 'grabada' } },
];
let cancelados = 0;
const depsLimpieza = { cancelPending: () => (cancelados += 1) };
const descartados = reloj.descartarSinContacto(s7, depsLimpieza, 3);
ok('descarta al que no tiene ningún dato', descartados.includes('Fantasma'));
ok('no toca al que tiene teléfono', !descartados.includes('Con telefono'));
ok('un instagram basta para conservarlo', !descartados.includes('Solo instagram'));
ok('respeta el período de gracia', !descartados.includes('Recien cargado'));
ok('no toca al que ya tiene auditoría grabada', !descartados.includes('Ya grabado'));
ok('cancela la secuencia del descartado', cancelados === 1, `${cancelados}`);
ok('lo deja como perdido con motivo', s7.deals[0].stage === 'perdido' && s7.deals[0].lostReason === 'Sin datos de contacto');
ok('y marca la auditoría descartada', s7.deals[0].audit.status === 'descartada');
ok('correrla otra vez no lo vuelve a descartar', reloj.descartarSinContacto(s7, depsLimpieza, 3).length === 0);
ok('con gracia cero sí barre al recién cargado', reloj.descartarSinContacto(s7, depsLimpieza, 0).includes('Recien cargado'));

// --- Llamadas que pasaron sin resultado --------------------------------------
const s8 = estadoBase();
s8.clients = [{ id: 'c1', name: 'Aurora Med Spa' }, { id: 'c2', name: 'Bella Skin' }, { id: 'c3', name: 'Cerrada' }];
s8.deals = [
  { id: 'd1', clientId: 'c1', title: 'A', meeting: { at: `${addDays(today(), -2)}T10:00`, status: 'agendada' } },
  { id: 'd2', clientId: 'c2', title: 'B', meeting: { at: `${addDays(today(), 3)}T10:00`, status: 'agendada' } },
  { id: 'd3', clientId: 'c3', title: 'C', meeting: { at: `${addDays(today(), -5)}T10:00`, status: 'realizada' } },
];
const colgadas = reloj.reunionesSinResultado(s8);
ok('detecta la llamada que ya pasó sin cerrar', colgadas.some((r) => r.cliente === 'Aurora Med Spa'));
ok('no molesta con la que todavía no llega', !colgadas.some((r) => r.cliente === 'Bella Skin'));
ok('ignora la que ya tiene resultado', !colgadas.some((r) => r.cliente === 'Cerrada'));
ok('dice hace cuántos días fue', colgadas[0] && colgadas[0].dias === 2, colgadas[0] ? colgadas[0].dias : '—');

// --- La corrida completa -----------------------------------------------------
const s4 = estadoBase();
s4.clients = [{ id: 'c1', name: 'Aurora Med Spa', status: 'activo' }];
s4.invoices = [{ id: 'i1', number: 'FA-0009', status: 'enviada', dueDate: addDays(today(), -2) }];
s4.subscriptions = [{ id: 's1', clientId: 'c1', status: 'activa', nextInvoiceDate: addDays(today(), 7), amount: 1800, currency: 'USD' }];
s4.deals = [
  {
    id: 'd1',
    clientId: 'c1',
    title: 'Aurora',
    stage: 'reunion',
    meeting: { at: `${today()}T10:30`, status: 'agendada' },
  },
];

s4.proposals = [{ id: 'p9', number: 'P-0009', status: 'enviada', validUntil: addDays(today(), -4) }];

const deps = {
  sweepExhausted: () => ['Prospecto agotado'],
  limpiarEspejos: () => ['clients/viejo.md'],
  queueFor: () => [],
  recordingList: () => [],
  cancelPending: () => 0,
  abrirMes: () => ['Aurora Med Spa'],
  importarVault: () => ['Aurora Med Spa (3)'],
};

const r = reloj.correrDia(s4, deps);
ok('la corrida vence las propuestas caducadas', r.propuestasVencidas.includes('P-0009'));
ok('la corrida abre el mes de producción', r.mesAbierto.includes('Aurora Med Spa'));
ok('la corrida importa lo que dejaron los agentes', r.importadas.length === 1);
ok('la facturación automática viene apagada', r.facturas.length === 0);
ok('la corrida marca las moras', r.moras.includes('FA-0009'));
ok('la corrida cierra secuencias agotadas', r.cerrados.length === 1);
ok('la corrida trae las renovaciones', r.renovaciones.length === 1);
ok('la corrida lista las llamadas del día', r.reuniones.length === 1 && r.reuniones[0].hora === '10:30', JSON.stringify(r.reuniones));
ok('la corrida limpia espejos huérfanos', r.espejos.length === 1);
ok('deja registrada la fecha para no repetirse', s4.settings.reloj.ultimaCorrida === today());

const parte = reloj.armarParte(s4, r, { ...deps, outboxPendientes: 3 });
ok('el parte trae la fecha', parte.includes(`# Parte del ${today()}`));
ok('el parte anuncia la llamada', parte.includes('10:30') && parte.includes('Aurora Med Spa'));
ok('el parte avisa de la renovación', parte.includes('Renovaciones cerca'));
ok('el parte muestra la mora', parte.includes('FA-0009'));
ok('el parte cuenta la bandeja', parte.includes('**3** en la bandeja'), parte.split('\n').find((l) => l.includes('bandeja')));
ok('el parte es markdown con frontmatter', parte.startsWith('---\ntipo: parte-diario'));
ok('el parte reporta el mantenimiento del día', parte.includes('## Mantenimiento') && parte.includes('P-0009'));
ok('el parte cuenta el mes abierto y lo importado', parte.includes('Mes de producción abierto') && parte.includes('Importado del vault'));

// Una llamada que quedó sin cerrar tiene que salir en el parte, no perderse.
const s9 = estadoBase();
s9.clients = [{ id: 'c1', name: 'Aurora Med Spa' }];
s9.deals = [{ id: 'd1', clientId: 'c1', title: 'A', meeting: { at: `${addDays(today(), -1)}T09:00`, status: 'agendada' } }];
const r9 = reloj.correrDia(s9, { sweepExhausted: () => [], limpiarEspejos: () => [], queueFor: () => [], recordingList: () => [] });
const parte9 = reloj.armarParte(s9, r9, { queueFor: () => [], recordingList: () => [], outboxPendientes: 0 });
ok('el parte reclama la llamada sin resultado', parte9.includes('Llamadas sin resultado registrado') && parte9.includes('Aurora Med Spa'));

// Un día tranquilo no debe inventar secciones.
const s5 = estadoBase();
const r5 = reloj.correrDia(s5, { sweepExhausted: () => [], limpiarEspejos: () => [], queueFor: () => [], recordingList: () => [] });
const parte5 = reloj.armarParte(s5, r5, { queueFor: () => [], recordingList: () => [], outboxPendientes: 0 });
ok('un día sin novedades no inventa secciones', !parte5.includes('Renovaciones cerca') && !parte5.includes('Llamadas de hoy'));
ok('pero siempre dice qué te espera', parte5.includes('Lo que te espera hoy'));

console.log(`\n${fallas ? `${fallas} FALLA(S)` : 'Todo en verde'}`);
process.exit(fallas ? 1 : 0);
