/* Ejecuta los scripts de la interfaz en Node con un DOM minimo y pinta cada
 * vista con el estado real. No reemplaza a un navegador, pero atrapa lo que de
 * verdad rompe una vista nueva: funciones que no existen, variables mal
 * escritas y campos que se asumen presentes. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:4199';
const PUB = path.join(__dirname, '..', 'public');
const ORDER = [
  'core.js',
  'juego.js',
  'views-sales.js',
  'views-outbound.js',
  'views-billing.js',
  'views-calculadora.js',
  'views-production.js',
  'views-marketing.js',
  'views-automation.js',
  'views-journey.js',
  'app.js',
];

// Fecha relativa en AAAA-MM-DD, igual que la que usa la interfaz.
function addDaysStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv');
}

let fallas = 0;
function ok(label, cond, extra) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fallas += 1;
}

// --- DOM minimo -------------------------------------------------------------
function fakeEl(id) {
  const el = {
    id,
    hidden: true,
    textContent: '',
    innerHTML: '',
    className: '',
    value: '',
    dataset: {},
    style: {},
    elements: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    remove() {},
    focus() {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    reportValidity: () => true,
  };
  return el;
}

const elements = new Map();
const document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, fakeEl(id));
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => fakeEl('nuevo'),
  body: { classList: { add() {}, remove() {} } },
};

const sandbox = {
  document,
  window: { print() {}, open() {}, location: {} },
  console,
  localStorage: { getItem: () => null, setItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  Set,
  Map,
  Intl,
  encodeURIComponent,
  decodeURIComponent,
  RegExp,
  Error,
  isNaN,
  parseInt,
  parseFloat,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

// El arranque de app.js llama a la API: se la damos ya resuelta.
let estado = null;
sandbox.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => {
    if (String(url).includes('/api/touches/queue')) return { hoy: [], proximos: 0 };
    if (String(url).includes('/api/prospecting/today')) return { meta: 10, lista: [] };
    return estado;
  },
});

(async () => {
  const res = await fetch(`${BASE}/api/state`);
  estado = await res.json();

  const ctx = vm.createContext(sandbox);

  /* Los scripts clásicos de un navegador comparten el ámbito léxico global, así
   * que un `const` de core.js es visible desde views-billing.js. `vm` solo
   * reproduce eso si se ejecutan como un único script, igual que el navegador. */
  const bundle = ORDER.map((f) => `/* ==== ${f} ==== */\n${fs.readFileSync(path.join(PUB, f), 'utf8')}`).join('\n;\n');
  try {
    vm.runInContext(`${bundle}\n;globalThis.__App = App;`, ctx, { filename: 'bundle.js' });
    ok(`cargan los ${ORDER.length} scripts de la interfaz`, true);
  } catch (err) {
    ok('cargan los scripts de la interfaz', false, `${err.message}\n${String(err.stack).split('\n')[1] || ''}`);
    process.exit(1);
  }

  const App = ctx.__App;
  App.state = estado;

  // La cola y la lista de grabación se piden por su cuenta; las simulamos con
  // datos que ejercitan los caminos con contenido, no solo los vacíos.
  App.outbound.loaded = true;
  App.outbound.goal = 10;
  App.outbound.upcoming = 12;
  // Más pendientes que la meta y uno sin contacto: así se pintan el botón de
  // "ver todas" y el de limpiar, que solo aparecen cuando hacen falta.
  App.outbound.total = 34;
  App.outbound.sinContacto = 2;
  App.outbound.meetings = [
    { dealId: 'd9', at: `${addDaysStr(-2)}T10:00`, fecha: addDaysStr(-2), hora: '10:00', cliente: 'Vieja Sin Cerrar', telefono: '', sinResultado: true },
    { dealId: 'd8', at: `${addDaysStr(0)}T15:00`, fecha: addDaysStr(0), hora: '15:00', cliente: 'Hoy Mismo', telefono: '3001234567', sinResultado: false },
  ];
  App.outbound.recording = [
    {
      dealId: 'd1',
      clientId: 'c1',
      name: 'Aurora Med Spa',
      city: 'Hialeah',
      phone: '7865559001',
      website: 'aurora.com',
      instagram: '@aurora',
      audit: {
        status: 'sin-grabar',
        creativeAgeDays: 95,
        adLibraryUrl: 'https://facebook.com/ads/library',
        script: { bloques: [['0:00 – 0:20', 'Gancho', 'texto']], checklist: ['grabar en español'] },
      },
    },
    {
      dealId: 'd3',
      clientId: 'c3',
      name: 'Negocio Fantasma',
      city: '',
      sinContacto: true,
      audit: { status: 'sin-grabar', script: { bloques: [], checklist: [] } },
    },
  ];
  App.outbound.queue = [
    {
      id: 't1',
      dealId: 'd1',
      step: 0,
      label: 'Toque 1 · La auditoria',
      channel: 'whatsapp',
      sequenceName: 'Auditoria en video',
      dueDate: new Date().toLocaleDateString('sv'),
      late: 2,
      subject: 'asunto',
      body: 'Hola Ana, le grabé algo.',
      missing: [],
      client: { id: 'c1', name: 'Aurora Med Spa', contactName: 'Ana', email: 'ana@x.com', phone: '7865559001' },
      deal: { id: 'd1', title: 'Aurora — auditoria', stage: 'nuevo' },
    },
    {
      id: 't2',
      dealId: 'd2',
      step: 1,
      label: 'Toque 2 · Valor gratis',
      channel: 'email',
      sequenceName: 'Auditoria en video',
      dueDate: new Date().toLocaleDateString('sv'),
      late: 0,
      subject: 'Una idea',
      body: 'Texto con {{observacion}} sin llenar',
      missing: ['observacion'],
      client: { id: 'c2', name: 'Bella Skin', contactName: '', email: '', phone: '' },
      deal: { id: 'd2', title: 'Bella — auditoria', stage: 'contactado' },
    },
  ];
  App.state.outbox = [
    { id: 'm1', status: 'pendiente', channel: 'email', to: 'ana@x.com', subject: 'Una idea', clientName: 'Aurora', body: 'hola' },
    { id: 'm2', status: 'error', channel: 'email', to: 'mal@x.com', subject: 'X', clientName: 'Bella', body: 'hola', error: 'rechazado' },
  ];
  App.state.runtime = { smtp: { ready: false, reason: 'Falta configurar el servidor SMTP.' }, publicBaseUrl: 'http://localhost:4180' };

  // --- Cada vista se pinta ---------------------------------------------------
  for (const [name, view] of Object.entries(App.views)) {
    try {
      const html = view.render();
      const acts = view.actions ? view.actions() : '';
      ok(`pinta ${name}`, typeof html === 'string' && html.length > 0, `${html.length} car.${acts ? ' + acciones' : ''}`);
    } catch (err) {
      ok(`pinta ${name}`, false, err.message);
    }
  }

  // --- Las piezas nuevas, en detalle ----------------------------------------
  const hoyHtml = App.views.hoy.render();
  ok('Hoy muestra el atraso', hoyHtml.includes('2d tarde'));
  ok('Hoy marca las variables sin llenar', hoyHtml.includes('Faltan datos'));
  ok('Hoy ofrece WhatsApp cuando hay teléfono', hoyHtml.includes('Abrir WhatsApp'));
  ok('Hoy no ofrece enviar el que tiene huecos', (hoyHtml.match(/Abrir WhatsApp/g) || []).length === 1);
  ok('Hoy avisa que el envío automático está apagado', hoyHtml.includes('Envío automático apagado') || hoyHtml.includes('envio automatico apagado') || hoyHtml.includes('apagado'));
  ok('Hoy marca la señal de creativo viejo', hoyHtml.includes('95 d'));

  // Las salidas que faltaban en la lista de grabación.
  ok('Hoy deja agregar un negocio suelto', hoyHtml.includes('audit-add'));
  ok('Hoy deja descartar el que no sirve', hoyHtml.includes('audit-discard'));
  ok('Hoy ofrece ver más allá de la meta diaria', hoyHtml.includes('recording-toggle') && hoyHtml.includes('Ver todas (34)'));
  ok('Hoy señala los prospectos sin ningún dato', hoyHtml.includes('audit-clean') && hoyHtml.includes('sin telefono, correo, web ni IG'));
  ok('Hoy dice cuántas auditorías esperan en total', hoyHtml.includes('34'));
  ok('Hoy reclama la llamada que pasó sin resultado', hoyHtml.includes('sin resultado'));
  ok('Hoy desbloquea el mensaje con la auditoría', hoyHtml.includes('Registrar auditoria'));

  const autoHtml = App.views.automatizaciones.render();
  ok('Automatizaciones muestra lo que corre solo cada mañana', autoHtml.includes('Lo que corre solo cada mañana'));
  ok('y enumera las tareas del reloj', autoHtml.includes('Descartar prospectos sin contacto') && autoHtml.includes('Abrir el mes de producción'));
  ok('y ofrece limpiar el embudo de un clic', autoHtml.includes('auto-clean'));

  const prosHtml = App.views.prospeccion.render();
  ok('Prospección trae el formulario del lote', prosHtml.includes('Pega el lote'));
  ok('Prospección muestra el embudo', prosHtml.includes('Embudo real'));

  const ajustesHtml = App.views.ajustes.render();
  ok('Ajustes trae cobro con tarjeta', ajustesHtml.includes('Cobro con tarjeta'));
  ok('Ajustes trae envío de correo', ajustesHtml.includes('Envío de correo'));
  ok('Ajustes trae prospección', ajustesHtml.includes('Meta diaria'));
  ok('Ajustes trae enlaces públicos', ajustesHtml.includes('Dirección pública'));

  // --- El modal abre y cierra sin motor de animación --------------------------
  // Este DOM de prueba no tiene `animate()`, así que se ejercita justamente el
  // camino de respaldo: la animación es la mejora, no el mecanismo. Si el panel
  // solo se viera cuando el navegador sabe animar, no sería una mejora.
  const backdrop = document.getElementById('modal-backdrop');
  ctx.openForm({
    title: 'Prueba',
    fields: [{ name: 'x', label: 'X', value: '1' }],
    onSubmit: async () => {},
  });
  ok('el modal se abre', backdrop.hidden === false);
  ok('y queda visible aunque el navegador no anime', backdrop.style.opacity === '1');
  ok('con el formulario dentro', document.getElementById('modal-body').innerHTML.includes('modal-form'));

  ctx.closeModal();
  ok('el modal se cierra', backdrop.hidden === true);
  ok('y suelta el contenido', document.getElementById('modal-body').innerHTML === '');

  ctx.openForm({ title: 'Otra vez', fields: [], onSubmit: async () => {} });
  ok('vuelve a abrir después de cerrarse', backdrop.hidden === false);
  ctx.closeModal();

  // --- Todas las acciones referenciadas existen ------------------------------
  const todas = Object.values(App.views)
    .map((v) => `${v.render()}${v.actions ? v.actions() : ''}`)
    .join(' ');
  const usadas = [...new Set([...todas.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]))];
  const internas = ['modal-close', 'modal-submit', 'modal-danger', 'item-add', 'item-del'];
  const huerfanas = usadas.filter((a) => !App.actions[a] && !internas.includes(a));
  ok('no hay botones sin acción detrás', huerfanas.length === 0, huerfanas.join(', ') || `${usadas.length} acciones revisadas`);

  console.log(`\n${fallas ? `${fallas} FALLA(S)` : 'Todo en verde'}`);
  process.exit(fallas ? 1 : 0);
})();
