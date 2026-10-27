/* Prueba de extremo a extremo sobre una copia del estado real, sin escribir
 * nada en el vault. Verifica: importacion con deduplicacion, inscripcion
 * escalonada, cola del dia, avance de la secuencia y corrimiento de fechas. */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VAULT_ROOT = process.env.OBSIDIAN_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault');
const seq = require(path.join(ROOT, 'lib/sequences.js'));
const prospecting = require(path.join(ROOT, 'lib/prospecting.js'));
const pubdocs = require(path.join(ROOT, 'lib/publicdocs.js'));
const { today, addDays } = require(path.join(ROOT, 'lib/dates.js'));

const state = JSON.parse(
  fs.readFileSync(path.join(VAULT_ROOT, 'Agency', 'agency-os.json'), 'utf8')
);
state.touches = state.touches || [];
state.sequences = state.sequences && state.sequences.length ? state.sequences : seq.seedSequences();

function ok(label, cond, extra) {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
}

// --- 1. Importacion y deduplicacion ----------------------------------------
// "Face Beauty Med Spa" ya existe en la base real; debe rebotar.
const lote = [
  'nombre\tciudad\ttelefono\temail\tdias\tcontacto',
  'Face Beauty Med Spa\tDoral\t305-555-0001\t\t70',
  'Prueba Aurora Med Spa\tHialeah\t+1 786 555 0002\taurora@ejemplo.com\t95\tAna Restrepo',
  'Prueba Bella Skin\tKendall\t3055550003\t\t20',
  'Prueba Bella Skin\tKendall\t3055550003\t\t20',
].join('\n');

const prev = prospecting.preview(state, lote);
ok('detecta el que ya existe', prev[0].status === 'existe', prev[0].existingName);
ok('detecta los nuevos', prev[1].status === 'nuevo' && prev[2].status === 'nuevo');
ok('detecta el repetido dentro del lote', prev[3].status === 'repetido');

const antesClientes = state.clients.length;
const r = prospecting.importBatch(state, lote, { currency: 'USD', city: 'Miami', value: 1800 });
ok('importa solo los nuevos', r.creados.length === 2, `creados ${r.creados.length}, saltados ${r.saltados.length}`);
ok('crea el cliente', state.clients.length === antesClientes + 2);
ok('genera guion de auditoria', r.creados[0].deal.audit.script.bloques.length === 5);
ok(
  'marca la senal de oro cuando el creativo esta viejo',
  r.creados[0].deal.audit.script.checklist.join(' ').includes('95'),
  r.creados[0].deal.audit.script.checklist[4]
);

// --- 2. Inscripcion escalonada ---------------------------------------------
r.creados.forEach((c, i) => seq.enroll(state, c.deal, 'seq-auditoria', addDays(today(), Math.floor(i / 1))));

/* La prueba corre contra el vault real, que ya tiene prospectos cargados. Todo
 * lo que se afirme aqui tiene que mirar SOLO los registros que creo esta
 * prueba: contar el total fue un error que aguanto mientras la base estuvo
 * casi vacia y reviento el dia que entraron 100 prospectos de verdad. */
const mios = new Set(r.creados.map((c) => c.deal.id));
const misToques = state.touches.filter((t) => mios.has(t.dealId));
ok('crea 5 toques por prospecto', misToques.length === 10, `${misToques.length} toques`);
const primero = state.touches.filter((t) => t.dealId === r.creados[0].deal.id).sort((a, b) => a.step - b.step);
ok('el toque 1 vence hoy', primero[0].dueDate === today(), primero[0].dueDate);
ok('el toque 5 vence a 12 dias', primero[4].dueDate === addDays(today(), 12), primero[4].dueDate);
const segundo = state.touches.filter((t) => t.dealId === r.creados[1].deal.id).sort((a, b) => a.step - b.step);
ok('el segundo prospecto arranca al dia siguiente', segundo[0].dueDate === addDays(today(), 1), segundo[0].dueDate);

// --- 3. Cola del dia y variables -------------------------------------------
state.settings.outbound = Object.assign(
  { dailyGoal: 10, sector: 'med spas', bookingUrl: 'https://cal.com/juanjo/30', caseStudy: '', angles: '' },
  state.settings.outbound
);
state.settings.company.signerName = state.settings.company.signerName || 'Juanjo';

let cola = seq.queueFor(state).filter((c) => mios.has(c.deal.id));
ok('la cola de hoy trae solo lo vencido', cola.length === 1, `${cola.length} en cola`);
ok('resuelve las variables que si tiene', cola[0].body.includes(cola[0].client.name), 'nombre de empresa en el cuerpo');
ok('reporta las variables sin llenar', cola[0].missing.includes('observacion'), cola[0].missing.join(','));

// Con la auditoria grabada, el mensaje queda completo.
const d0 = state.deals.find((d) => d.id === r.creados[0].deal.id);
d0.audit.observation = 'Lleva 95 dias con el mismo anuncio de botox.';
d0.audit.videoUrl = 'https://loom.com/share/abc';
d0.audit.idea = 'Rotar el creativo y probar un angulo de precio.';
cola = seq.queueFor(state).filter((c) => mios.has(c.deal.id));
ok('sin huecos cuando la auditoria esta grabada', cola[0].missing.length === 0, cola[0].missing.join(','));
ok('mete el enlace del video en el toque 1', cola[0].body.includes('loom.com'));

// --- 4. Avance y corrimiento de fechas -------------------------------------
// Se manda con 2 dias de atraso: los siguientes deben correrse 2 dias.
state.touches.filter((t) => t.dealId === d0.id).forEach((t) => (t.dueDate = addDays(t.dueDate, -2)));
const antesT5 = state.touches.find((t) => t.dealId === d0.id && t.step === 4).dueDate;
const res = seq.markSent(state, state.touches.find((t) => t.dealId === d0.id && t.step === 0).id);
const despuesT5 = state.touches.find((t) => t.dealId === d0.id && t.step === 4).dueDate;
ok('corre los toques siguientes por el atraso', res.shifted === 4, `corridos ${res.shifted}`);
ok('el toque 5 se movio 2 dias', despuesT5 === addDays(antesT5, 2), `${antesT5} -> ${despuesT5}`);
ok('el deal pasa a contactado', d0.stage === 'contactado');
ok('la proxima accion apunta al toque 2', d0.nextAction.includes('Toque 2'), d0.nextAction);

// --- 5. Respuesta: se para la secuencia ------------------------------------
const rep = seq.replied(state, d0.id, 'Pidio precio por WhatsApp');
ok('cancela lo pendiente al responder', rep.cancelled === 4, `cancelados ${rep.cancelled}`);
ok('sube el deal a reunion', d0.stage === 'reunion');
ok('no queda nada pendiente de ese deal', seq.pendingFor(state, d0.id).length === 0);

// --- 6. Documento publico ---------------------------------------------------
const prop = {
  id: 'p1',
  clientId: r.creados[0].client.id,
  number: 'PROP-0009',
  title: 'Sprint de 14 dias',
  currency: 'USD',
  issueDate: today(),
  validUntil: addDays(today(), 7),
  taxRate: 0,
  items: [{ description: 'Sprint de arranque', qty: 1, unitPrice: 900 }],
};
state.proposals.push(prop);
const share = pubdocs.ensureShare(prop);
ok('genera token de enlace', share.token.length > 15);
ok('encuentra el documento por token', pubdocs.findByToken(state, share.token).collection === 'proposals');

const fakeReq = { get: (h) => (h === 'user-agent' ? 'prueba' : ''), ip: '203.0.113.9', socket: {} };
pubdocs.logView(prop, fakeReq);
ok('registra la apertura', prop.share.views.length === 1);

pubdocs.accept(state, 'proposals', prop, { name: 'Ana Perez', email: 'ana@ejemplo.com', agree: '1' }, fakeReq);
ok('marca la propuesta aceptada', prop.status === 'aceptada');
ok('guarda la huella del documento', prop.acceptance.documentHash.length === 64);
ok('guarda la IP de quien acepto', prop.acceptance.ip === '203.0.113.9');

state.settings.security = state.settings.security || { accessKey: 'LLAVE-SECRETA-DE-PRUEBA' };
const html = pubdocs.renderPublic(state, 'proposals', prop);
ok('la pagina publica se arma', html.includes('Propuesta aceptada'), html.slice(0, 0) || 'sin bloque de aceptacion');
ok('muestra el total con la moneda correcta', /900[.,]00 USD/.test(html));
ok('muestra quien acepto', html.includes('Ana Perez'));
ok('la pagina no filtra la llave de acceso', !html.includes(state.settings.security.accessKey));
ok('la pagina no se indexa en buscadores', html.includes('noindex'));

// --- 7. Enlace de pago ------------------------------------------------------
state.settings.payments = { links: [{ id: 'l1', label: 'Pagar sprint', url: 'https://buy.stripe.com/test', amount: 900, currency: 'USD' }] };
const link = pubdocs.paymentLinkFor(state.settings, prop);
ok('encuentra el enlace de pago por monto y moneda', link && link.url.includes('stripe'), link ? link.url : 'ninguno');

console.log('\nEstado del proceso:', process.exitCode ? 'CON FALLAS' : 'todo en verde');
