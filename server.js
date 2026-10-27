const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { today, nowISO, addDays, addMonths, daysUntil } = require('./lib/dates');
const { lineTotal, computeTotals, money } = require('./lib/money');
const auth = require('./lib/auth');
const seq = require('./lib/sequences');
const prospecting = require('./lib/prospecting');
const outbox = require('./lib/outbox');
const pubdocs = require('./lib/publicdocs');
const validate = require('./lib/validate');
const reloj = require('./lib/reloj');
const mk = require('./lib/marketing');
const juego = require('./lib/juego');

const PORT = process.env.PORT || 4180;
// El vault de Obsidian donde viven los datos. OBSIDIAN_VAULT lo apunta a otra carpeta.
const VAULT_ROOT = process.env.OBSIDIAN_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault');
const AGENCY_DIR = path.join(VAULT_ROOT, 'Agency');
const DATA_FILE = path.join(AGENCY_DIR, 'agency-os.json');

// Espejos en markdown para que todo sea legible/enlazable desde Obsidian.
const MIRROR_DIRS = {
  clients: path.join(AGENCY_DIR, 'Clientes'),
  proposals: path.join(AGENCY_DIR, 'Propuestas'),
  contracts: path.join(AGENCY_DIR, 'Contratos'),
  invoices: path.join(AGENCY_DIR, 'Facturas'),
  briefs: path.join(AGENCY_DIR, 'Briefs'),
  reports: path.join(AGENCY_DIR, 'Reportes'),
};

// Carpetas donde los agentes de producción dejan su trabajo.
const ADS_SUITE_DIR = path.join(VAULT_ROOT, 'AdsSuite');
const VIDEO_DIR = path.join(VAULT_ROOT, 'Video');

// Cola de trabajos para los agentes. Vive solo como archivos markdown: es la
// unica fuente de verdad, para que un agente pueda procesarla aunque el
// servidor este apagado.
const JOBS_DIR = path.join(AGENCY_DIR, 'Cola');

// Bandeja de salida: los mensajes que el sistema manda, con el mismo criterio
// de archivos que la cola. Se pueden revisar y despachar sin el servidor.
const OUTBOX_DIR = path.join(AGENCY_DIR, 'Outbox');

// Copias del estado antes de cada escritura. Todo el negocio vive en un solo
// archivo; sin historial, un guardado equivocado no tiene vuelta atras.
const BACKUP_DIR = path.join(AGENCY_DIR, '.respaldos');
const BACKUP_KEEP = 40;

// El parte que el reloj escribe cada manana, para leerlo desde Obsidian.
const PARTE_DIR = path.join(AGENCY_DIR, 'Partes');

const CURRENCIES = ['COP', 'USD', 'MXN'];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function slugify(text) {
  return (
    String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'sin-titulo'
  );
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

// ---------------------------------------------------------------------------
// Semilla
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  company: {
    tradeName: 'Cyclone AI',
    legalName: '',
    taxId: '',
    taxIdLabel: 'NIT',
    address: '',
    city: '',
    country: 'Colombia',
    email: '',
    phone: '',
    website: '',
    signerName: '',
    signerRole: 'Representante legal',
  },
  banking: {
    copDetails: 'Banco: ____  ·  Cuenta de ahorros N.º ____  ·  Titular: ____',
    usdDetails: 'Wise / Payoneer: ____  ·  Titular: ____',
    notes: 'El pago se entiende recibido cuando los fondos estan acreditados.',
  },
  invoicing: {
    defaultTermsDays: 8,
    taxRate: { COP: 19, USD: 0, MXN: 16 },
    taxLabel: { COP: 'IVA', USD: 'Tax', MXN: 'IVA' },
    withholdingNote: 'Si aplica retencion en la fuente, se descuenta al momento del pago segun la ley vigente.',
    footerNote: 'Documento generado por Agency OS. Para clientes que exijan factura electronica DIAN, este documento debe replicarse en el proveedor tecnologico autorizado.',
  },
  counters: {
    invoice: { COP: 1, USD: 1, MXN: 1 },
    proposal: 1,
    contract: 1,
  },
  series: { COP: 'FA', USD: 'INV', MXN: 'FM' },
  fx: { usdToCop: 4000, usdToMxn: 18 },
  goals: { dailyProspects: 5, targetMrrCop: 15000000 },

  /* La calculadora. Finanzas mira hacia atras —lo que ya se facturo y se
   * gasto—; esto mira hacia adelante: cuanto hay que facturar para que la
   * cuenta cierre. Se guarda en ajustes y no como coleccion porque no es un
   * registro contable: es un tanteo, y un tanteo que se olvida al recargar no
   * sirve para nada. */
  calculadora: {
    moneda: 'COP',
    impuestoPct: 0,
    ticketPromedio: 0,
    personalVisible: false,
    ingresos: [],
    gastosEmpresa: [],
    gastosPersonales: [],
  },

  /* La meta del dia: lo que hace que el dia se pueda cerrar.
   *
   * Sin una condicion de victoria solo hay backlog, y con backlog infinito
   * nunca se gana — solo se deja de perder. Las auditorias heredan la meta que
   * ya existia en `outbound.dailyGoal` para no tener dos numeros diciendo lo
   * mismo. El historial lo escribe el reloj al cerrar cada dia. */
  juego: {
    activo: true,
    // `metaAuditorias` se omite a proposito: mientras no se fije aqui, manda
    // `outbound.dailyGoal`. Dos numeros para la misma meta se desincronizan.
    metaMensajes: 10,
    metaDecisiones: true,
    sonido: true,
    historial: [],
  },

  // Direccion con la que se arman los enlaces publicos de documentos. En local
  // sirve para probar; para mandarselos a un cliente tiene que ser la direccion
  // del tunel (Cloudflare Tunnel, ngrok o el dominio propio).
  publicBaseUrl: 'http://localhost:4180',

  // Llave de acceso desde fuera de este computador. Se genera sola la primera
  // vez. Desde el propio equipo nunca se pide.
  security: { accessKey: '' },

  // Rieles de cobro. Los enlaces se pegan tal cual los da la pasarela (Stripe
  // Payment Links, Wise, Payoneer): no hace falta ninguna integracion ni clave
  // de API, y un enlace pegado cobra igual de rapido que uno generado.
  payments: {
    links: [],
    note: 'Los enlaces de pago se crean en el panel de la pasarela y se pegan aqui. El de monto vacio sirve como enlace general de esa moneda.',
  },

  // Envio real de correo. La contrasena NO se guarda aqui: se lee de la
  // variable de entorno AGENCY_SMTP_PASS, porque este archivo vive en el vault.
  mail: {
    fromName: '',
    fromEmail: '',
    replyTo: '',
    signature: '',
    smtp: { host: 'smtp.gmail.com', port: 587, user: '', secure: false },
  },

  // Lo que el sistema hace solo cada dia. Corre mientras el servidor corra; si
  // el computador estuvo apagado, al prender se pone al dia.
  reloj: {
    activo: true,
    hora: '08:00',
    avisoRenovacionDias: 15,
    graciaSinContactoDias: 3,
    ultimaCorrida: '',
    ultimaCorridaAt: '',
    // Lo que reordena datos propios viene encendido; emitir una factura con
    // consecutivo no, porque numerar es un acto contable y no lo decide un
    // temporizador.
    tareas: {
      vencerPropuestas: true,
      limpiarProspectos: true,
      abrirMes: true,
      importarVault: true,
      reportes: true,
      facturarBorradores: false,
    },
  },

  // Datos que alimentan las variables de los mensajes y el guion de auditoria.
  outbound: {
    dailyGoal: 10,
    sector: 'med spas',
    bookingUrl: '',
    caseStudy: '',
    angles: '',
    defaultSequenceId: 'seq-auditoria',
    proposalSequenceId: 'seq-propuesta',
  },
};

const DEFAULT_SERVICES = [
  {
    name: 'Diagnostico de IA',
    category: 'entrada',
    billing: 'proyecto',
    priceCOP: 900000,
    priceUSD: 250,
    description: 'Auditoria de 5 dias: identificamos los 3 procesos con mayor potencial de automatizacion y cuantificamos el ahorro de cada uno.',
    deliverables: ['Mapa de procesos actual', 'Top 3 automatizaciones priorizadas', 'Estimacion de horas/mes ahorradas', 'Hoja de ruta a 90 dias'],
  },
  {
    name: 'Gestion de Ads con IA',
    category: 'ads',
    billing: 'retainer',
    priceCOP: 3500000,
    priceUSD: 900,
    description: 'Produccion y testing continuo de anuncios con variantes generadas por IA para Meta y Google.',
    deliverables: ['20 anuncios estaticos/mes', '5 variantes A/B por campana', 'Optimizacion semanal', 'Reporte mensual de resultados'],
  },
  {
    name: 'Paquete Contenido IA',
    category: 'contenido',
    billing: 'suscripcion',
    priceCOP: 2500000,
    priceUSD: 650,
    description: 'Suscripcion productizada de contenido y creativos listos para publicar.',
    deliverables: ['20 piezas graficas/mes', '4 guiones de video ad/mes', 'Calendario editorial', '1 ronda de ajustes por pieza'],
  },
  {
    name: 'Automatizacion de procesos con IA',
    category: 'automatizacion',
    billing: 'proyecto',
    priceCOP: 8000000,
    priceUSD: 2000,
    description: 'Convertimos un proceso manual del equipo del cliente en un agente que corre solo.',
    deliverables: ['Levantamiento del proceso', 'Agente implementado y probado', 'Documentacion de operacion', 'Capacitacion al equipo (2h)'],
  },
  {
    name: 'Mantenimiento de agentes',
    category: 'automatizacion',
    billing: 'retainer',
    priceCOP: 1800000,
    priceUSD: 450,
    description: 'Soporte, monitoreo y mejora continua de los agentes implementados.',
    deliverables: ['Monitoreo de errores', 'Ajustes de prompts y flujos', 'Soporte con respuesta < 24h habiles', 'Reporte trimestral'],
  },
  {
    name: 'Video ads UGC',
    category: 'video',
    billing: 'suscripcion',
    priceCOP: 3200000,
    priceUSD: 800,
    description: 'Guiones y edicion de video ads de 15-30s optimizados para retencion.',
    deliverables: ['8 videos/mes', 'Guion por video', '2 hooks alternativos por video', 'Formatos 9:16 y 1:1'],
  },
];

const ONBOARDING_TEMPLATE = [
  'Contrato firmado y archivado',
  'Primera factura emitida y pagada',
  'Accesos recibidos (Meta Business, Google Ads, web, analitica)',
  'Canal de comunicacion creado (grupo/WhatsApp/Slack)',
  'Reunion de kickoff realizada',
  'Brief de marca y tono de voz documentado',
  'KPIs y meta del primer trimestre acordados',
  'Proyecto creado en task-manager (vault Projects\\)',
  'Primer entregable enviado (dia 7)',
  'Reporte de primer mes enviado (dia 30)',
];

function buildInitialState() {
  const created = nowISO();
  return {
    version: 1,
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    services: DEFAULT_SERVICES.map((s, i) => ({ id: newId(), active: true, order: i, createdAt: created, ...s })),
    clients: [],
    deals: [],
    proposals: [],
    contracts: [],
    subscriptions: [],
    invoices: [],
    onboardings: [],
    expenses: [],
    activities: [],
    briefs: [],
    productions: [],
    pieces: [],
    reports: [],
    diagnostics: [],
    sequences: seq.seedSequences(),
    touches: [],
    // Marketing OS: el ledger de lo que se produjo y de lo que pasó después.
    campaigns: [],
    assets: [],
    outcomes: [],
    experiments: [],
    patterns: [],
    onboardingTemplate: ONBOARDING_TEMPLATE.slice(),
  };
}

const COLLECTIONS = [
  'services',
  'clients',
  'deals',
  'proposals',
  'contracts',
  'subscriptions',
  'invoices',
  'onboardings',
  'expenses',
  'activities',
  'briefs',
  'productions',
  'pieces',
  'reports',
  'diagnostics',
  'sequences',
  'touches',
  // Marketing OS. Registrarlas aquí es lo único que hace falta para que
  // hereden CRUD, respaldo y relleno automático al abrir un estado viejo.
  'campaigns',
  'assets',
  'outcomes',
  'experiments',
  'patterns',
];

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

function ensureDirs() {
  if (!fs.existsSync(VAULT_ROOT)) {
    throw new Error(
      `No se encontro el vault de Obsidian en: ${VAULT_ROOT}. Verifica la ruta antes de arrancar el servidor.`
    );
  }
  fs.mkdirSync(AGENCY_DIR, { recursive: true });
  Object.values(MIRROR_DIRS).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(PARTE_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(buildInitialState(), null, 2), 'utf8');
  }
}

function readState() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const state = JSON.parse(raw);
  // Rellena lo que falte si el archivo viene de una version anterior.
  const base = buildInitialState();
  COLLECTIONS.forEach((c) => {
    if (!Array.isArray(state[c])) state[c] = [];
  });
  if (!Array.isArray(state.onboardingTemplate)) state.onboardingTemplate = base.onboardingTemplate;
  state.settings = deepDefaults(state.settings || {}, base.settings);

  // Las plantillas de secuencia se siembran una sola vez. Despues son del
  // usuario: si las edita o las borra, no se las volvemos a meter.
  if (!state.sequences.length && !state.seededSequences) {
    state.sequences = seq.seedSequences();
    state.seededSequences = true;
  }
  if (!state.settings.security.accessKey) state.settings.security.accessKey = auth.newKey();

  return state;
}

function deepDefaults(target, defaults) {
  const out = Array.isArray(defaults) ? (Array.isArray(target) ? target : defaults) : { ...defaults };
  if (Array.isArray(defaults)) return out;
  Object.keys(target || {}).forEach((k) => {
    const dv = defaults[k];
    const tv = target[k];
    if (dv && typeof dv === 'object' && !Array.isArray(dv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      out[k] = deepDefaults(tv, dv);
    } else {
      out[k] = tv;
    }
  });
  return out;
}

/* Guarda una copia del estado anterior antes de pisarlo, y conserva las
 * ultimas. Es lo unico que separa un guardado equivocado de perder el CRM, los
 * contratos y la cartera de una vez. Las copias van a una carpeta oculta para
 * que no ensucien la vista del vault en Obsidian. */
function backupState() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `agency-os-${stamp}.json`));
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('agency-os-'))
      .sort();
    files.slice(0, Math.max(0, files.length - BACKUP_KEEP)).forEach((f) => {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
    });
  } catch (err) {
    console.error('[agency-os] No se pudo respaldar el estado:', err.message);
  }
}

/* Node atiende una peticion a la vez, pero una escritura que empieza en medio
 * de otra (una automatizacion mientras guardas un formulario) puede pisarla.
 * Este contador detecta el caso y lo deja en el registro en vez de esconderlo. */
let writing = false;

function writeState(state) {
  if (writing) console.warn('[agency-os] Escritura anidada del estado — revisa el flujo que la produjo.');
  writing = true;
  try {
    backupState();
    const tmp = `${DATA_FILE}.tmp`;
    // `jobs` vive en archivos, no en el JSON: nunca se persiste aqui.
    const { jobs, outbox: _ob, ...persisted } = state;
    fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } finally {
    writing = false;
  }
}

// ---------------------------------------------------------------------------
// Cola de trabajos (archivos markdown en Agency\Cola)
// ---------------------------------------------------------------------------

function jobFile(id) {
  return path.join(JOBS_DIR, `${id}.md`);
}

function readJob(file) {
  const raw = fs.readFileSync(path.join(JOBS_DIR, file), 'utf8');
  const fm = parseFrontmatter(raw);
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return {
    id: fm.id || file.replace(/\.md$/, ''),
    type: fm.trabajo || '',
    client: fm.cliente || '',
    clientId: fm.clienteId || '',
    month: fm.mes || '',
    status: fm.estado || 'pendiente',
    requestedAt: fm.solicitado || '',
    doneAt: fm.completado || '',
    result: fm.resultado || '',
    prompt: (body.match(/^>\s?(.*)$/m) || [])[1] || '',
    body,
  };
}

function scanJobs() {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => {
      try {
        return readJob(f);
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
}

const JOB_LABEL = {
  'ads-package': 'Paquete de anuncios',
  'video-batch': 'Lote de videos',
};

function jobPrompt(job) {
  if (job.type === 'video-batch') {
    return `Genera el lote semanal de videos para "${job.client}". Usa el brief de Agency\\Briefs\\${job.client}.md. Guarda la nota en Video\\ con client: ${job.client} y date de hoy.`;
  }
  return `Genera el paquete de anuncios para "${job.client}". Usa el brief de Agency\\Briefs\\${job.client}.md. Guarda la nota en AdsSuite\\ con client: ${job.client} y date de hoy.`;
}

function writeJob(job) {
  const content = [
    '---',
    'tipo: trabajo',
    `id: ${job.id}`,
    `trabajo: ${job.type}`,
    `cliente: ${job.client}`,
    `clienteId: ${job.clientId || ''}`,
    `mes: ${job.month || ''}`,
    `estado: ${job.status}`,
    `solicitado: ${job.requestedAt}`,
    `completado: ${job.doneAt || ''}`,
    `resultado: ${job.result || ''}`,
    '---',
    '',
    `# ${JOB_LABEL[job.type] || job.type} — ${job.client} (${job.month})`,
    '',
    'Instruccion para el agente:',
    '',
    `> ${jobPrompt(job)}`,
    '',
    job.notes ? `## Notas\n\n${job.notes}\n` : '',
    '',
    'Al terminar, cambia `estado:` a `hecho` y escribe en `resultado:` la ruta de la nota generada.',
    '',
  ].join('\n');
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.writeFileSync(jobFile(job.id), content, 'utf8');
  return job;
}

// ---------------------------------------------------------------------------
// Calculos de documentos
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Espejos markdown
// ---------------------------------------------------------------------------

function safeWrite(dir, filename, content) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), content, 'utf8');
  } catch (err) {
    console.error('[agency-os] No se pudo escribir el espejo markdown:', err.message);
  }
}

/* Dos clientes con el mismo nombre comercial — cosa normal en odontologia en
 * Hialeah — se pisaban el archivo del vault: el segundo borraba la ficha del
 * primero sin avisar.
 *
 * La regla es determinista para que el nombre del archivo no dependa del orden
 * en que se guarden las cosas: entre los que comparten nombre, el mas antiguo
 * conserva el archivo limpio y los demas llevan un sufijo con su id. Asi los 39
 * clientes que ya existen no cambian de nombre, y el duplicado que llegue
 * maniana entra sin destruir nada. */
function nombreEspejo(state, collection, record) {
  // El brief se nombra por el cliente, no por la marca: los agentes de
  // produccion lo buscan por esa ruta y ese formato es un contrato.
  const nombreDe = (r) => (collection === 'clients' ? slugify(r.name) : slugify(clientName(state, r.clientId)));
  const base = nombreDe(record);
  const hermanos = (state[collection] || []).filter((r) => nombreDe(r) === base);
  if (hermanos.length <= 1) return `${base}.md`;

  const duenio = hermanos
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)))[0];
  return duenio.id === record.id ? `${base}.md` : `${base} (${String(record.id).slice(-5)}).md`;
}

// Los nombres que el sistema espera encontrar en cada carpeta de espejos.
function espejosEsperados(state) {
  const esperados = {};
  const poner = (col, nombre) => {
    esperados[col] = esperados[col] || new Set();
    esperados[col].add(nombre);
  };
  state.clients.forEach((c) => poner('clients', nombreEspejo(state, 'clients', c)));
  state.briefs.forEach((b) => poner('briefs', nombreEspejo(state, 'briefs', b)));
  state.proposals.forEach((p) => poner('proposals', `${p.number} - ${slugify(clientName(state, p.clientId))}.md`));
  state.invoices.forEach((i) => poner('invoices', `${i.number} - ${slugify(clientName(state, i.clientId))}.md`));
  state.contracts.forEach((c) => poner('contracts', `${c.number} - ${slugify(clientName(state, c.clientId))}.md`));
  state.reports.forEach((r) => poner('reports', `${r.month} - ${slugify(clientName(state, r.clientId))}.md`));
  return esperados;
}

/* Barrido de espejos huerfanos: los que quedaron de un registro borrado o de un
 * cliente que cambio de nombre. No los borra — los mueve a un aparte, porque
 * borrar archivos del vault de alguien sin preguntar no se hace. */
function limpiarEspejos(state, opts) {
  const o = opts || {};
  const esperados = espejosEsperados(state);
  const destino = path.join(BACKUP_DIR, 'espejos-huerfanos');
  const movidos = [];

  Object.entries(MIRROR_DIRS).forEach(([col, dir]) => {
    if (!fs.existsSync(dir)) return;
    const validos = esperados[col] || new Set();
    fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !validos.has(f))
      .forEach((f) => {
        movidos.push(`${col}/${f}`);
        if (o.seco) return;
        try {
          fs.mkdirSync(destino, { recursive: true });
          fs.renameSync(path.join(dir, f), path.join(destino, `${col} - ${f}`));
        } catch (err) {
          console.error('[agency-os] No se pudo mover el espejo huerfano:', err.message);
        }
      });
  });

  return movidos;
}

function clientName(state, clientId) {
  const c = state.clients.find((x) => x.id === clientId);
  return c ? c.name : 'Sin cliente';
}

function mirrorClient(state, client) {
  const fm = [
    '---',
    `nombre: ${client.name}`,
    `razon_social: ${client.legalName || ''}`,
    `identificacion: ${client.taxId || ''}`,
    `pais: ${client.country || ''}`,
    `moneda: ${client.currency || ''}`,
    `estado: ${client.status || ''}`,
    `contacto: ${client.contactName || ''}`,
    `email: ${client.email || ''}`,
    `telefono: ${client.phone || ''}`,
    `origen: ${client.source || ''}`,
    `creado: ${(client.createdAt || nowISO()).slice(0, 10)}`,
    '---',
    '',
    `# ${client.name}`,
    '',
    client.notes || '',
    '',
  ].join('\n');
  safeWrite(MIRROR_DIRS.clients, nombreEspejo(state, 'clients', client), fm);
}

function itemsTable(doc) {
  const rows = (doc.items || []).map(
    (it) =>
      `| ${it.description || ''} | ${it.qty || 0} | ${money(it.unitPrice, doc.currency)} | ${money(lineTotal(it), doc.currency)} |`
  );
  return ['| Concepto | Cant. | Valor unitario | Total |', '|---|---:|---:|---:|', ...rows].join('\n');
}

function totalsBlock(doc) {
  const t = computeTotals(doc);
  const lines = [`- Subtotal: ${money(t.subtotal, doc.currency)}`];
  if (t.discount) lines.push(`- Descuento: -${money(t.discount, doc.currency)}`);
  if (t.tax) lines.push(`- Impuesto (${doc.taxRate}%): ${money(t.tax, doc.currency)}`);
  if (t.withholding) lines.push(`- Retencion: -${money(t.withholding, doc.currency)}`);
  lines.push(`- **Total: ${money(t.total, doc.currency)}**`);
  return lines.join('\n');
}

function mirrorProposal(state, p) {
  const content = [
    '---',
    `tipo: propuesta`,
    `numero: ${p.number}`,
    `cliente: ${clientName(state, p.clientId)}`,
    `estado: ${p.status}`,
    `moneda: ${p.currency}`,
    `total: ${computeTotals(p).total}`,
    `fecha: ${p.issueDate}`,
    `vigencia: ${p.validUntil || ''}`,
    '---',
    '',
    `# Propuesta ${p.number} — ${p.title || ''}`,
    '',
    `Cliente: [[${slugify(clientName(state, p.clientId))}]]`,
    '',
    p.summary || '',
    '',
    '## Alcance',
    '',
    itemsTable(p),
    '',
    totalsBlock(p),
    '',
    p.terms ? `## Condiciones\n\n${p.terms}\n` : '',
  ].join('\n');
  safeWrite(MIRROR_DIRS.proposals, `${p.number} - ${slugify(clientName(state, p.clientId))}.md`, content);
}

function mirrorInvoice(state, inv) {
  const t = computeTotals(inv);
  const content = [
    '---',
    'tipo: factura',
    `numero: ${inv.number}`,
    `cliente: ${clientName(state, inv.clientId)}`,
    `estado: ${inv.status}`,
    `moneda: ${inv.currency}`,
    `total: ${t.total}`,
    `emision: ${inv.issueDate}`,
    `vencimiento: ${inv.dueDate}`,
    `pagada: ${inv.paidAt || ''}`,
    '---',
    '',
    `# Factura ${inv.number}`,
    '',
    `Cliente: [[${slugify(clientName(state, inv.clientId))}]]`,
    `Emision: ${inv.issueDate}  ·  Vence: ${inv.dueDate}`,
    '',
    itemsTable(inv),
    '',
    totalsBlock(inv),
    '',
    inv.notes ? `## Notas\n\n${inv.notes}\n` : '',
  ].join('\n');
  safeWrite(MIRROR_DIRS.invoices, `${inv.number} - ${slugify(clientName(state, inv.clientId))}.md`, content);
}

function mirrorContract(state, c) {
  const content = [
    '---',
    'tipo: contrato',
    `numero: ${c.number}`,
    `cliente: ${clientName(state, c.clientId)}`,
    `modalidad: ${c.type}`,
    `jurisdiccion: ${c.jurisdiction}`,
    `estado: ${c.status}`,
    `moneda: ${c.currency}`,
    `valor_mensual: ${c.monthlyFee || 0}`,
    `inicio: ${c.startDate}`,
    `firmado: ${c.signedAt || ''}`,
    '---',
    '',
    c.body || '',
    '',
  ].join('\n');
  safeWrite(MIRROR_DIRS.contracts, `${c.number} - ${slugify(clientName(state, c.clientId))}.md`, content);
}

// El brief es el contrato entre Agency OS y el agente `enhanced-ads-suite`:
// el agente lo lee de aquí en vez de volver a preguntarlo en cada solicitud.
function mirrorBrief(state, b) {
  const name = clientName(state, b.clientId);
  const list = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- (sin definir)');
  const content = [
    '---',
    'tipo: brief',
    `cliente: ${name}`,
    `enfoque: ${b.kind || 'ads'}`,
    `idioma: ${b.language || 'espanol'}`,
    `plataformas: ${(b.platforms || []).join(',') || 'facebook,google'}`,
    `objetivo: ${b.objective || ''}`,
    `cta: ${b.cta || ''}`,
    `actualizado: ${(b.updatedAt || nowISO()).slice(0, 10)}`,
    '---',
    '',
    `# Brief — ${name}`,
    '',
    `Cliente: [[${slugify(name)}]]`,
    '',
    '## Marca',
    '',
    b.brand || '(sin definir)',
    '',
    '## Publico objetivo',
    '',
    b.audience || '(sin definir)',
    '',
    '## Dolor principal',
    '',
    b.pain || '(sin definir)',
    '',
    '## Oferta',
    '',
    b.offer || '(sin definir)',
    '',
    '## Tono de voz',
    '',
    b.tone || '(sin definir)',
    '',
    '## Diferenciadores',
    '',
    list(b.differentiators),
    '',
    '## Restricciones y claims prohibidos',
    '',
    list(b.restrictions),
    '',
    '## Landing / destino',
    '',
    b.landing || '(sin definir)',
    '',
    '## Marca personal',
    '',
    '### Posicionamiento',
    '',
    b.positioning || '(sin definir)',
    '',
    '### Pilares de contenido',
    '',
    list(b.pillars),
    '',
    '### Pruebas y credenciales',
    '',
    b.proof || '(sin definir)',
    '',
    '### Formatos de video',
    '',
    b.videoFormats || '(sin definir)',
    '',
    b.notes ? `## Notas\n\n${b.notes}\n` : '',
  ].join('\n');
  safeWrite(MIRROR_DIRS.briefs, nombreEspejo(state, 'briefs', b), content);
}

function mirrorReport(state, r) {
  const name = clientName(state, r.clientId);
  const rows = (r.metrics || [])
    .map((m) => `| ${m.label} | ${m.value} | ${m.previous || '—'} | ${m.note || ''} |`)
    .join('\n');
  const content = [
    '---',
    'tipo: reporte',
    `cliente: ${name}`,
    `mes: ${r.month}`,
    `estado: ${r.status || 'borrador'}`,
    `enviado: ${r.sentAt || ''}`,
    '---',
    '',
    `# Reporte ${r.month} — ${name}`,
    '',
    `Cliente: [[${slugify(name)}]]`,
    '',
    '## Cumplimiento de entregables',
    '',
    (r.delivery || []).map((d) => `- ${d.label}: ${d.done}/${d.target}`).join('\n') || '- (sin entregables registrados)',
    '',
    '## Resultados',
    '',
    rows ? ['| Metrica | Este mes | Mes anterior | Nota |', '|---|---:|---:|---|', rows].join('\n') : '(sin metricas cargadas)',
    '',
    '## Lo que funciono',
    '',
    r.highlights || '(sin notas)',
    '',
    '## Plan del proximo mes',
    '',
    r.nextMonth || '(sin definir)',
    '',
  ].join('\n');
  safeWrite(MIRROR_DIRS.reports, `${r.month} - ${slugify(name)}.md`, content);
}

function mirrorFor(state, collection, record) {
  if (collection === 'clients') mirrorClient(state, record);
  if (collection === 'proposals') mirrorProposal(state, record);
  if (collection === 'invoices') mirrorInvoice(state, record);
  if (collection === 'contracts') mirrorContract(state, record);
  if (collection === 'briefs') mirrorBrief(state, record);
  if (collection === 'reports') mirrorReport(state, record);
}

/* Borrar un registro tiene que borrar tambien su espejo. Si no, el vault se va
 * llenando de notas de cosas que ya no existen y las busquedas en Obsidian
 * empiezan a devolver documentos fantasma. */
function removeMirror(state, collection, record) {
  const dir = MIRROR_DIRS[collection];
  if (!dir || !record) return;
  const nombre = clientName(state, record.clientId);
  const candidatos = {
    clients: `${slugify(record.name)}.md`,
    proposals: `${record.number} - ${slugify(nombre)}.md`,
    invoices: `${record.number} - ${slugify(nombre)}.md`,
    contracts: `${record.number} - ${slugify(nombre)}.md`,
    briefs: `${slugify(record.brand || nombre)}.md`,
    reports: `${record.month} - ${slugify(nombre)}.md`,
  };
  const file = path.join(dir, candidatos[collection] || '');
  try {
    if (candidatos[collection] && fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.error('[agency-os] No se pudo borrar el espejo:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Plantillas de contrato
// ---------------------------------------------------------------------------

const JURISDICTIONS = {
  CO: {
    label: 'Colombia',
    law: 'las leyes de la Republica de Colombia',
    venue: 'los jueces y tribunales de la ciudad de Medellin, Colombia',
    taxNote:
      'Los valores expresados no incluyen IVA. El IVA y las retenciones aplicables se liquidaran conforme a la normativa tributaria colombiana vigente.',
  },
  US: {
    label: 'Estados Unidos / Internacional',
    law: 'las leyes del Estado de Delaware, Estados Unidos de America',
    venue: 'los tribunales competentes del Estado de Delaware',
    taxNote:
      'Los valores expresados estan libres de impuestos locales. Cualquier impuesto, retencion o comision bancaria en el pais del CLIENTE corre por cuenta del CLIENTE.',
  },
  MX: {
    label: 'Mexico',
    law: 'las leyes de los Estados Unidos Mexicanos',
    venue: 'los tribunales competentes de la Ciudad de Mexico',
    taxNote:
      'Los valores expresados no incluyen IVA. El IVA y las retenciones aplicables se liquidaran conforme a la normativa fiscal mexicana vigente.',
  },
};

function renderContract(state, c) {
  const s = state.settings;
  const client = state.clients.find((x) => x.id === c.clientId) || {};
  const j = JURISDICTIONS[c.jurisdiction] || JURISDICTIONS.CO;
  const fee = money(c.monthlyFee, c.currency);
  const scope = (c.scope || []).map((x) => `   - ${x}`).join('\n');
  const isRecurring = c.type === 'retainer' || c.type === 'suscripcion';
  const modalityName =
    c.type === 'retainer'
      ? 'CONTRATO DE PRESTACION DE SERVICIOS PROFESIONALES CON HONORARIOS MENSUALES'
      : c.type === 'suscripcion'
      ? 'CONTRATO DE SUSCRIPCION DE SERVICIOS'
      : 'CONTRATO DE PRESTACION DE SERVICIOS POR PROYECTO';

  const lines = [];
  lines.push(`# ${modalityName}`, '', `**N.º ${c.number}**`, '');
  lines.push(
    `Entre **${s.company.legalName || s.company.tradeName}**, identificada con ${s.company.taxIdLabel} ${
      s.company.taxId || '____'
    }, con domicilio en ${s.company.city || '____'}, ${s.company.country || ''}, quien para efectos del presente contrato se denominara **EL PROVEEDOR**, y **${
      client.legalName || client.name || '____'
    }**, identificada con ${client.taxIdLabel || 'NIT'} ${client.taxId || '____'}, con domicilio en ${
      client.city || client.country || '____'
    }, quien se denominara **EL CLIENTE**, se celebra el presente contrato que se regira por las siguientes clausulas:`,
    ''
  );

  lines.push('## PRIMERA — OBJETO', '');
  lines.push(
    `EL PROVEEDOR prestara a EL CLIENTE servicios profesionales de marketing, produccion de contenido publicitario y automatizacion de procesos mediante inteligencia artificial, de acuerdo con el siguiente alcance:`,
    ''
  );
  lines.push(scope || '   - (alcance por definir)', '');
  lines.push(
    'Cualquier servicio no listado expresamente en esta clausula se considera fuera del alcance y requerira un otrosi o una propuesta adicional aceptada por escrito.',
    ''
  );

  lines.push('## SEGUNDA — DURACION', '');
  if (isRecurring) {
    lines.push(
      `El contrato inicia el ${c.startDate} y tendra una duracion inicial de ${c.termMonths || 3} (${
        c.termMonths || 3
      }) meses, prorrogable automaticamente por periodos iguales, salvo que cualquiera de las partes manifieste lo contrario por escrito con al menos ${
        c.noticeDays || 30
      } dias calendario de anticipacion al vencimiento del periodo en curso.`,
      ''
    );
  } else {
    lines.push(
      `El contrato inicia el ${c.startDate} y se extiende hasta la entrega y aceptacion del ultimo entregable${
        c.endDate ? `, con fecha estimada de finalizacion el ${c.endDate}` : ''
      }.`,
      ''
    );
  }

  lines.push('## TERCERA — VALOR Y FORMA DE PAGO', '');
  if (isRecurring) {
    lines.push(
      `EL CLIENTE pagara a EL PROVEEDOR la suma de **${fee}** mensuales, por mes anticipado. La factura se emite el dia ${
        c.billingDay || 1
      } de cada mes y debe pagarse dentro de los ${c.paymentTermsDays || s.invoicing.defaultTermsDays} dias calendario siguientes a su emision.`,
      ''
    );
  } else {
    lines.push(
      `EL CLIENTE pagara a EL PROVEEDOR la suma total de **${fee}**, distribuida asi: 50% como anticipo para el inicio de los trabajos y 50% contra entrega final. Cada factura debe pagarse dentro de los ${
        c.paymentTermsDays || s.invoicing.defaultTermsDays
      } dias calendario siguientes a su emision.`,
      ''
    );
  }
  lines.push(j.taxNote, '');
  lines.push(
    `La mora en el pago superior a diez (10) dias calendario faculta a EL PROVEEDOR para suspender la prestacion de los servicios sin que ello constituya incumplimiento, y hasta tanto se normalice el pago.`,
    ''
  );

  lines.push('## CUARTA — OBLIGACIONES DE EL CLIENTE', '');
  lines.push(
    '   - Entregar oportunamente los accesos, informacion, materiales y aprobaciones necesarios para la ejecucion.',
    '   - Designar una unica persona como contraparte con capacidad de aprobar entregables.',
    '   - Responder solicitudes de aprobacion dentro de los tres (3) dias habiles siguientes; el silencio se entendera como aprobacion para efectos de cronograma.',
    '   - Asumir directamente la inversion publicitaria en las plataformas, la cual no esta incluida en el valor de este contrato.',
    ''
  );

  lines.push('## QUINTA — OBLIGACIONES DE EL PROVEEDOR', '');
  lines.push(
    '   - Ejecutar los servicios con diligencia profesional y en los tiempos acordados.',
    `   - Atender solicitudes y consultas dentro de un plazo maximo de ${c.slaHours || 24} horas habiles.`,
    '   - Reportar resultados con la periodicidad pactada.',
    '   - Guardar reserva sobre la informacion de EL CLIENTE en los terminos de la clausula de confidencialidad.',
    ''
  );

  lines.push('## SEXTA — USO DE INTELIGENCIA ARTIFICIAL', '');
  lines.push(
    'Las partes reconocen que EL PROVEEDOR utiliza herramientas de inteligencia artificial generativa como parte de su metodologia de trabajo. EL PROVEEDOR revisa y valida los entregables antes de su entrega, y responde por ellos como si hubieran sido producidos integramente por medios tradicionales. EL CLIENTE autoriza el procesamiento de la informacion que suministre a traves de dichas herramientas, exclusivamente para la ejecucion de este contrato.',
    ''
  );

  lines.push('## SEPTIMA — PROPIEDAD INTELECTUAL', '');
  lines.push(
    'Los entregables finales aprobados y pagados en su totalidad son propiedad de EL CLIENTE, quien podra usarlos, reproducirlos y modificarlos sin limitacion territorial ni temporal. EL PROVEEDOR conserva la titularidad de sus metodologias, plantillas, prompts, agentes, flujos de trabajo y herramientas preexistentes o desarrolladas de forma generica, sobre los cuales otorga a EL CLIENTE una licencia de uso no exclusiva mientras el contrato este vigente. EL PROVEEDOR podra usar los trabajos realizados como referencia en su portafolio, salvo oposicion escrita de EL CLIENTE.',
    ''
  );

  lines.push('## OCTAVA — CONFIDENCIALIDAD', '');
  lines.push(
    'Cada parte se obliga a mantener reserva sobre la informacion no publica de la otra a la que acceda con ocasion de este contrato, y a no divulgarla a terceros sin autorizacion escrita. Esta obligacion permanece vigente por dos (2) anos despues de terminado el contrato.',
    ''
  );

  lines.push('## NOVENA — TRATAMIENTO DE DATOS PERSONALES', '');
  lines.push(
    'Cuando la ejecucion implique el tratamiento de datos personales de terceros, EL CLIENTE actua como responsable y EL PROVEEDOR como encargado del tratamiento, limitandose a las finalidades autorizadas por EL CLIENTE y aplicando medidas razonables de seguridad, conforme a la normativa de proteccion de datos aplicable.',
    ''
  );

  lines.push('## DECIMA — LIMITACION DE RESPONSABILIDAD', '');
  lines.push(
    `EL PROVEEDOR no garantiza resultados comerciales especificos, toda vez que estos dependen de factores fuera de su control (mercado, producto, precio, plataformas de terceros). La responsabilidad total de EL PROVEEDOR frente a EL CLIENTE por cualquier concepto se limita al valor efectivamente pagado por EL CLIENTE en los tres (3) meses anteriores al hecho que origine la reclamacion. Ninguna de las partes respondera por lucro cesante ni danos indirectos.`,
    ''
  );

  lines.push('## DECIMA PRIMERA — TERMINACION', '');
  lines.push(
    `Cualquiera de las partes podra terminar el contrato mediante aviso escrito con ${
      c.noticeDays || 30
    } dias calendario de anticipacion. Habra terminacion inmediata por incumplimiento grave no subsanado dentro de los diez (10) dias siguientes al requerimiento escrito. En todo caso, EL CLIENTE pagara los servicios efectivamente prestados hasta la fecha de terminacion, y EL PROVEEDOR entregara los materiales y accesos en su poder dentro de los cinco (5) dias habiles siguientes.`,
    ''
  );

  lines.push('## DECIMA SEGUNDA — INDEPENDENCIA', '');
  lines.push(
    'Este contrato no genera relacion laboral entre las partes ni entre EL CLIENTE y el personal o los contratistas de EL PROVEEDOR. EL PROVEEDOR actua con plena autonomia tecnica, administrativa y directiva.',
    ''
  );

  lines.push('## DECIMA TERCERA — LEY APLICABLE Y SOLUCION DE CONTROVERSIAS', '');
  lines.push(
    `Este contrato se rige por ${j.law}. Las diferencias se intentaran resolver directamente entre las partes dentro de los quince (15) dias siguientes al surgimiento del conflicto; de no lograrse acuerdo, seran sometidas a ${j.venue}.`,
    ''
  );

  lines.push('## DECIMA CUARTA — ACUERDO INTEGRO', '');
  lines.push(
    'Este contrato, junto con la propuesta comercial aceptada que se incorpora como anexo, constituye el acuerdo integro entre las partes y reemplaza cualquier acuerdo previo, verbal o escrito, sobre el mismo objeto. Toda modificacion debe constar por escrito y firmada por ambas partes.',
    ''
  );

  lines.push('---', '', 'En constancia se firma:', '');
  lines.push(
    '| EL PROVEEDOR | EL CLIENTE |',
    '|---|---|',
    `| ${s.company.signerName || '____________________'} | ${client.contactName || '____________________'} |`,
    `| ${s.company.legalName || s.company.tradeName} | ${client.legalName || client.name || ''} |`,
    `| ${s.company.taxIdLabel} ${s.company.taxId || '____'} | ${client.taxIdLabel || 'NIT'} ${client.taxId || '____'} |`,
    '| Fecha: ______________ | Fecha: ______________ |',
    ''
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Numeracion
// ---------------------------------------------------------------------------

function nextInvoiceNumber(state, currency) {
  const cur = CURRENCIES.includes(currency) ? currency : 'COP';
  const prefix = state.settings.series[cur] || 'FA';
  const n = state.settings.counters.invoice[cur] || 1;
  state.settings.counters.invoice[cur] = n + 1;
  return `${prefix}-${pad(n, 4)}`;
}

function nextProposalNumber(state) {
  const n = state.settings.counters.proposal || 1;
  state.settings.counters.proposal = n + 1;
  return `PROP-${pad(n, 4)}`;
}

function nextContractNumber(state) {
  const n = state.settings.counters.contract || 1;
  state.settings.counters.contract = n + 1;
  return `CT-${pad(n, 4)}`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

ensureDirs();

const app = express();
app.set('trust proxy', true); // Detras de un tunel, la IP real viene en la cabecera.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false })); // Formularios de las paginas publicas.

// El limite solo aplica a lo que puede ver un desconocido. Lo de adentro no se
// limita: eres tu usando tu propio sistema.
const publicLimiter = auth.rateLimiter({ windowMs: 60000, max: 40 });
app.use((req, res, next) => (auth.isPublicPath(req.path) ? publicLimiter(req, res, next) : next()));

// La llave se lee del estado solo cuando la peticion viene de fuera de este
// computador; desde adentro el guardia ni la pide. Cambiarla en Ajustes surte
// efecto sin reiniciar.
app.use(
  auth.guard(() => {
    try {
      return readState().settings.security.accessKey;
    } catch (err) {
      return '';
    }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// Etapas en las que una oportunidad sigue viva.
const OPEN_STAGE_IDS = ['nuevo', 'contactado', 'reunion', 'propuesta', 'negociacion'];

function handle(fn) {
  return (req, res) => {
    const fail = (err) => {
      // Un dato mal formado es culpa de quien llama, no del servidor: se
      // responde 400 con el motivo, para que la interfaz lo pueda mostrar.
      if (err && err.esDeDatos) {
        if (!res.headersSent) res.status(400).json({ error: err.message });
        return;
      }
      /* Un error que trae `status` ya sabe de quien es la culpa: lo puso el
       * manejador a proposito (404 de algo que no existe, 400 de una
       * transicion imposible). Sin esto salia como 500 y la interfaz mostraba
       * "error del servidor" donde el mensaje util ya estaba escrito. */
      if (err && err.status >= 400 && err.status < 500) {
        if (!res.headersSent) res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('[agency-os]', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    };
    try {
      // Algunos manejadores son asincronos (envio de correo): sin esto, una
      // promesa rechazada tumbaria el proceso en vez de responder un error.
      const out = fn(req, res);
      if (out && typeof out.catch === 'function') out.catch(fail);
    } catch (err) {
      fail(err);
    }
  };
}

app.get('/api/state', handle((req, res) => {
  const state = readState();
  state.jobs = scanJobs();
  state.outbox = outbox.scan(OUTBOX_DIR);
  state.runtime = {
    smtp: outbox.smtpStatus(state.settings),
    publicBaseUrl: state.settings.publicBaseUrl,
    port: PORT,
  };
  /* El juego viaja con el estado porque la portada lo necesita en cada
   * pintado. Es derivado, no almacenado: se recalcula aqui y nunca se
   * escribe, asi que no puede quedar desfasado de lo que el CRM dice. */
  state.juego = juego.estado(state);
  res.json(state);
}));

// ---------------------------------------------------------------------------
// Motor de prospeccion
// ---------------------------------------------------------------------------

// Dice que pasaria con el lote, sin escribir nada.
app.post('/api/prospecting/preview', handle((req, res) => {
  const state = readState();
  const items = prospecting.preview(state, req.body.text || '');
  res.json({
    items,
    resumen: {
      total: items.length,
      nuevos: items.filter((i) => i.status === 'nuevo').length,
      existen: items.filter((i) => i.status === 'existe').length,
      repetidos: items.filter((i) => i.status === 'repetido').length,
    },
  });
}));

/* Importa el lote: crea cliente + oportunidad + datos de auditoria y, si se
 * pidio, inscribe cada uno en la secuencia. Escalonar la inscripcion es lo que
 * evita que 200 prospectos importados el lunes generen 200 toques el mismo dia:
 * se reparten segun la meta diaria. */
app.post('/api/prospecting/import', handle((req, res) => {
  const state = readState();
  const b = req.body || {};
  const { creados, saltados, total } = prospecting.importBatch(state, b.text || '', {
    currency: b.currency || 'USD',
    country: b.country || 'Estados Unidos',
    city: b.city || '',
    niche: b.niche || '',
    value: Number(b.value || 0),
    closeDays: Number(b.closeDays || 45),
  });

  const sequenceId = b.sequenceId || state.settings.outbound.defaultSequenceId;
  const porDia = Math.max(1, Number(b.perDay || state.settings.outbound.dailyGoal || 10));
  let inscritos = 0;

  if (b.enroll !== false && sequenceId) {
    creados.forEach((c, i) => {
      const start = addDays(today(), Math.floor(i / porDia));
      c.deal.nextActionDate = start;
      seq.enroll(state, c.deal, sequenceId, start);
      inscritos += 1;
    });
  }

  writeState(state);
  creados.forEach((c) => mirrorClient(state, c.client));

  res.json({
    total,
    importados: creados.length,
    inscritos,
    saltados,
    porDia,
    dias: Math.ceil(creados.length / porDia),
  });
}));

// La lista de grabacion del dia, con el guion de cada auditoria. `limit=0` la
// devuelve completa: la meta diaria es una sugerencia, no una reja.
app.get('/api/prospecting/today', handle((req, res) => {
  const state = readState();
  const salida = ({ deal, client }) => ({
    dealId: deal.id,
    clientId: client.id,
    name: client.name,
    city: client.city,
    phone: client.phone,
    email: client.email,
    contactName: client.contactName,
    website: client.website,
    instagram: client.instagram,
    sinContacto: prospecting.sinContacto(client),
    audit: deal.audit,
  });
  const todas = prospecting.pendingAudits(state);
  const lista = prospecting.recordingList(state, req.query.limit).map(salida);
  res.json({
    meta: state.settings.outbound.dailyGoal,
    total: todas.length,
    sinContacto: todas.filter(({ client }) => prospecting.sinContacto(client)).length,
    lista,
  });
}));

/* Agregar un negocio a la lista de grabacion sin pasar por el lote. Acepta una
 * ficha completa o varias lineas pegadas: es el mismo motor de importacion, con
 * la puerta abierta para el caso de uno solo — que es el que se da cuando estas
 * grabando y aparece otro negocio que vale la pena. */
app.post('/api/prospecting/quick', handle((req, res) => {
  const state = readState();
  const b = req.body || {};
  const opts = {
    currency: b.currency || 'USD',
    country: b.country || 'Estados Unidos',
    city: b.city || '',
    niche: b.niche || '',
    value: Number(b.value || state.settings.outbound.defaultValue || 1800),
    closeDays: Number(b.closeDays || 45),
  };

  // Si vino texto pegado, se trata como lote; si no, como una sola ficha.
  let creados = [];
  let saltados = [];
  if (String(b.text || '').trim()) {
    const r = prospecting.importBatch(state, b.text, opts);
    creados = r.creados;
    saltados = r.saltados;
  } else {
    const nombre = String(b.name || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del negocio.' });
    const existente = prospecting.findExisting(state, b);
    if (existente) return res.status(409).json({ error: `Ese negocio ya esta en la base como "${existente.name}".` });
    creados = [prospecting.buildProspect(state, { ...b, name: nombre }, opts)];
  }

  const sequenceId = b.sequenceId || state.settings.outbound.defaultSequenceId;
  let inscritos = 0;
  if (b.enroll !== false && sequenceId) {
    creados.forEach((c) => {
      seq.enroll(state, c.deal, sequenceId, today());
      inscritos += 1;
    });
  }

  writeState(state);
  creados.forEach((c) => mirrorClient(state, c.client));
  res.json({ creados: creados.length, inscritos, saltados, nombres: creados.map((c) => c.client.name) });
}));

/* Descartar un prospecto. La lista del dia se ensucia sola: contactos erroneos,
 * negocios sin un solo dato real, gente que ya trabaja con otra agencia. Sin una
 * salida, esos se quedan arriba de la lista para siempre y empujan hacia abajo a
 * los que si sirven — que es exactamente lo que hace que el bloque de grabacion
 * se sienta pesado. Descartar cancela la secuencia y saca el deal del embudo,
 * pero deja el registro: es lo que evita volver a comprarlo o volver a cargarlo. */
app.post('/api/deals/:id/discard', handle((req, res) => {
  const state = readState();
  const deal = state.deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: 'Oportunidad no encontrada' });
  const client = state.clients.find((c) => c.id === deal.clientId);
  const motivo = String(req.body.reason || '').trim() || 'descartado a mano';

  // Borrado total: para lo que nunca debio entrar (datos basura, duplicado que
  // el deduplicador no vio). No deja rastro porque no hay nada que recordar.
  if (req.body.purge) {
    const nombre = client ? client.name : deal.title;
    state.touches = (state.touches || []).filter((t) => t.dealId !== deal.id);
    state.deals = state.deals.filter((d) => d.id !== deal.id);
    if (client && !state.deals.some((d) => d.clientId === client.id) && client.status === 'lead') {
      state.clients = state.clients.filter((c) => c.id !== client.id);
      writeState(state);
      removeMirror(state, 'clients', client);
    } else {
      writeState(state);
    }
    return res.json({ borrado: true, nombre, cancelados: 0 });
  }

  const cancelados = seq.cancelPending(state, deal.id, motivo);
  deal.stage = 'perdido';
  deal.probability = 0;
  deal.lostReason = motivo;
  deal.nextAction = 'Descartado';
  deal.nextActionDate = '';
  deal.discardedAt = nowISO();
  deal.audit = { ...(deal.audit || {}), status: 'descartada' };
  deal.updatedAt = nowISO();
  // Un lead descartado es un lead perdido: se usa el estado que ya existe en
  // vez de inventar uno nuevo que ningún filtro ni ninguna vista conoce.
  if (client && client.status === 'lead') {
    client.status = 'perdido';
    client.updatedAt = nowISO();
  }

  writeState(state);
  if (client) mirrorClient(state, client);
  res.json({ borrado: false, nombre: client ? client.name : deal.title, cancelados, deal });
}));

/* Registra la auditoria grabada. Aqui es donde el trabajo del dia se convierte
 * en material del mensaje: la observacion y la idea que se dijeron en el video
 * son las variables que el toque 1 necesita para no salir vacio. */
app.post('/api/deals/:id/audit', handle((req, res) => {
  const state = readState();
  const deal = state.deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: 'Oportunidad no encontrada' });
  const b = req.body || {};
  deal.audit = {
    ...(deal.audit || {}),
    adLibraryUrl: b.adLibraryUrl ?? (deal.audit || {}).adLibraryUrl ?? '',
    creativeAgeDays: b.creativeAgeDays ?? (deal.audit || {}).creativeAgeDays ?? '',
    observation: b.observation ?? (deal.audit || {}).observation ?? '',
    idea: b.idea ?? (deal.audit || {}).idea ?? '',
    videoUrl: b.videoUrl ?? (deal.audit || {}).videoUrl ?? '',
    status: b.videoUrl || b.status === 'grabada' ? 'grabada' : (deal.audit || {}).status || 'sin-grabar',
    recordedAt: b.videoUrl ? nowISO() : (deal.audit || {}).recordedAt || '',
  };
  deal.updatedAt = nowISO();

  /* Al importar el lote, la secuencia arranca antes de que exista el video: el
   * toque 1 pide {{observacion}} y {{link_auditoria}}, asi que queda bloqueado y
   * se atrasa mientras espera. Registrar la auditoria es el momento exacto en
   * que ese mensaje ya tiene con que salir, asi que la secuencia se corre a hoy
   * en vez de dejarla vencida. Solo si no se ha mandado nada todavia: mover una
   * cadencia que ya empezo seria peor que dejarla como esta. */
  let reprogramados = 0;
  if (deal.audit.status === 'grabada') {
    const mios = (state.touches || []).filter((t) => t.dealId === deal.id);
    const yaSalio = mios.some((t) => t.status === 'enviado');
    const pendientes = mios.filter((t) => t.status === 'pendiente');
    if (!yaSalio && pendientes.length) {
      const primero = pendientes.map((t) => t.dueDate).sort()[0];
      const corrimiento = -daysUntil(primero); // >0 si el toque 1 ya venció.
      if (corrimiento !== 0) {
        pendientes.forEach((t) => {
          t.dueDate = addDays(t.dueDate, corrimiento);
          t.updatedAt = nowISO();
        });
        reprogramados = pendientes.length;
      }
      const siguiente = pendientes.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      deal.nextAction = siguiente.label;
      deal.nextActionDate = siguiente.dueDate;
    }
  }

  writeState(state);
  res.json({ ...deal, reprogramados });
}));

// ---------------------------------------------------------------------------
// Secuenciador de seguimiento
// ---------------------------------------------------------------------------

// Todo lo que hay que mandar hoy, con el texto ya resuelto.
app.get('/api/touches/queue', handle((req, res) => {
  const state = readState();
  res.json({
    hoy: seq.queueFor(state, req.query.date),
    proximos: seq.upcoming(state, req.query.days || 7).length,
  });
}));

app.post('/api/deals/:id/enroll', handle((req, res) => {
  const state = readState();
  const deal = state.deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: 'Oportunidad no encontrada' });
  const sequenceId = req.body.sequenceId || state.settings.outbound.defaultSequenceId;
  const creados = seq.enroll(state, deal, sequenceId, req.body.startDate);
  deal.nextAction = creados[0] ? creados[0].label : deal.nextAction;
  deal.nextActionDate = creados[0] ? creados[0].dueDate : deal.nextActionDate;
  writeState(state);
  res.json({ creados: creados.length, primero: creados[0] || null });
}));

app.post('/api/touches/:id/sent', handle((req, res) => {
  const state = readState();
  const r = seq.markSent(state, req.params.id, req.body.date);
  writeState(state);
  res.json(r);
}));

app.post('/api/touches/:id/skip', handle((req, res) => {
  const state = readState();
  const t = seq.skip(state, req.params.id, req.body.reason);
  writeState(state);
  res.json(t);
}));

app.post('/api/touches/:id/snooze', handle((req, res) => {
  const state = readState();
  const t = seq.snooze(state, req.params.id, req.body.days || 1);
  writeState(state);
  res.json(t);
}));

/* Agendar la llamada de diagnostico.
 *
 * Entre "sí, hablemos" y la llamada efectiva se pierde entre el 20 y el 30% de
 * los que ya dijeron que sí, casi siempre en el ping-pong de horarios y en el
 * olvido. Por eso agendar no es solo guardar una fecha: cancela la secuencia de
 * captacion (ya respondio, insistirle seria absurdo), manda la confirmacion hoy
 * y deja el recordatorio para el dia anterior. Segun el propio playbook, la
 * confirmacion baja el ausentismo a la mitad. */
app.post('/api/deals/:id/meeting', handle((req, res) => {
  const state = readState();
  const deal = state.deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: 'Oportunidad no encontrada' });

  const at = String(req.body.at || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) {
    return res.status(400).json({ error: 'Falta la fecha y hora de la llamada.' });
  }
  const fecha = at.slice(0, 10);
  const hora = at.slice(11, 16);

  seq.cancelPending(state, deal.id, 'llamada agendada');

  deal.meeting = { at, status: 'agendada', notes: req.body.notes || '', createdAt: nowISO() };
  deal.stage = ['nuevo', 'contactado'].includes(deal.stage) ? 'reunion' : deal.stage;
  deal.probability = Math.max(Number(deal.probability || 0), 40);
  deal.nextAction = `Llamada de diagnostico ${fecha} ${hora}`;
  deal.nextActionDate = fecha;
  deal.updatedAt = nowISO();

  const client = state.clients.find((c) => c.id === deal.clientId) || {};
  const canal = client.phone ? 'whatsapp' : 'email';
  const nombre = (client.contactName || '').split(' ')[0] || '';

  // Dos toques sueltos, no una plantilla: sus fechas dependen de la reunion.
  const nuevos = [
    {
      label: 'Confirmacion de la llamada',
      dueDate: today(),
      subject: `Confirmado: ${fecha} a las ${hora}`,
      body:
        `Listo${nombre ? ` ${nombre}` : ''}, quedamos el ${fecha} a las ${hora}.\n\n` +
        'Son 30 minutos. Para aprovecharlos: piensa en que parte de conseguir pacientes te quita mas tiempo hoy. No necesitas preparar nada mas.',
    },
    {
      label: 'Recordatorio, dia antes',
      dueDate: addDays(fecha, -1),
      subject: `Manana a las ${hora}`,
      body: `${nombre ? `${nombre}, ` : ''}nos vemos manana a las ${hora}. Si te cambio algo, dime y lo movemos — sin problema.`,
    },
  ]
    .filter((t) => t.dueDate >= today())
    .map((t, i) => ({
      id: `t${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowISO(),
      dealId: deal.id,
      clientId: deal.clientId,
      sequenceId: 'reunion',
      sequenceName: 'Llamada agendada',
      step: i,
      channel: canal,
      status: 'pendiente',
      sentAt: '',
      outboxId: '',
      ...t,
    }));

  state.touches.push(...nuevos);
  writeState(state);
  res.json({ deal, toques: nuevos.length });
}));

// Como salio la llamada. Sin esto no hay tasa de asistencia ni de conversion.
app.post('/api/deals/:id/meeting-result', handle((req, res) => {
  const state = readState();
  const deal = state.deals.find((d) => d.id === req.params.id);
  if (!deal || !deal.meeting) return res.status(404).json({ error: 'Esa oportunidad no tiene llamada agendada' });

  const estado = ['realizada', 'no-asistio', 'cancelada', 'reagendada'].includes(req.body.status) ? req.body.status : 'realizada';
  deal.meeting.status = estado;
  deal.meeting.result = req.body.notes || '';
  deal.meeting.closedAt = nowISO();

  if (estado === 'realizada') {
    deal.stage = deal.stage === 'reunion' ? 'propuesta' : deal.stage;
    deal.probability = Math.max(Number(deal.probability || 0), 60);
    deal.nextAction = 'Mandar la propuesta HOY — a las 72 horas la probabilidad cae a la mitad';
    deal.nextActionDate = today();
  } else if (estado === 'no-asistio') {
    deal.nextAction = 'No asistio — reagendar una vez, y si no, de vuelta a secuencia';
    deal.nextActionDate = today();
  }
  deal.updatedAt = nowISO();

  writeState(state);
  res.json(deal);
}));

/* Las llamadas de hoy, las que vienen y — sobre todo — las que ya pasaron sin
 * que nadie registrara el resultado. La ventana arrancaba hoy, asi que una
 * llamada de ayer sin resultado desaparecia de la pantalla: ni tasa de
 * asistencia, ni propuesta, ni recontacto. Las que quedaron atras salen
 * marcadas para cerrarlas de una vez. */
app.get('/api/meetings', handle((req, res) => {
  const state = readState();
  const desde = req.query.from || addDays(today(), -30);
  const hasta = req.query.to || addDays(today(), 14);
  const lista = state.deals
    .filter((d) => d.meeting && d.meeting.at && ['agendada', 'reagendada'].includes(d.meeting.status))
    .filter((d) => d.meeting.at.slice(0, 10) >= desde && d.meeting.at.slice(0, 10) <= hasta)
    .map((d) => {
      const c = state.clients.find((x) => x.id === d.clientId) || {};
      const fecha = d.meeting.at.slice(0, 10);
      return {
        dealId: d.id,
        at: d.meeting.at,
        fecha,
        hora: d.meeting.at.slice(11, 16),
        cliente: c.name,
        contacto: c.contactName,
        telefono: c.phone,
        notas: d.meeting.notes,
        sinResultado: fecha < today(),
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  res.json({ lista, sinResultado: lista.filter((m) => m.sinResultado).length });
}));

// El prospecto contesto: se cancela lo pendiente y el deal avanza.
app.post('/api/deals/:id/replied', handle((req, res) => {
  const state = readState();
  const r = seq.replied(state, req.params.id, req.body.note);
  writeState(state);
  res.json({ cancelados: r.cancelled, deal: r.deal });
}));

// Cierra las secuencias agotadas y deja los deals listos para recontacto.
app.post('/api/touches/sweep', handle((req, res) => {
  const state = readState();
  const cerrados = seq.sweepExhausted(state);
  writeState(state);
  res.json({ cerrados });
}));

// --- Cola de trabajos. Va antes de las rutas genericas de coleccion. --------

app.post('/api/jobs', handle((req, res) => {
  const state = readState();
  const client = state.clients.find((c) => c.id === req.body.clientId);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  const job = {
    id: `${today()}-${slugify(client.name).toLowerCase().replace(/\s+/g, '-')}-${newId().slice(-4)}`,
    type: req.body.type === 'video-batch' ? 'video-batch' : 'ads-package',
    client: client.name,
    clientId: client.id,
    month: req.body.month || today().slice(0, 7),
    status: 'pendiente',
    requestedAt: nowISO(),
    doneAt: '',
    result: '',
    notes: req.body.notes || '',
  };
  writeJob(job);
  res.json(job);
}));

app.put('/api/jobs/:id', handle((req, res) => {
  const file = `${req.params.id}.md`;
  if (!fs.existsSync(path.join(JOBS_DIR, file))) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const job = readJob(file);
  const merged = { ...job, ...req.body, id: job.id };
  if (merged.status === 'hecho' && !merged.doneAt) merged.doneAt = nowISO();
  writeJob(merged);
  res.json(merged);
}));

app.delete('/api/jobs/:id', handle((req, res) => {
  const f = jobFile(req.params.id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Bandeja de salida
// ---------------------------------------------------------------------------

app.get('/api/outbox', handle((req, res) => {
  res.json({ mensajes: outbox.scan(OUTBOX_DIR), smtp: outbox.smtpStatus(readState().settings) });
}));

/* Encola los toques indicados (o todos los de hoy). El correo queda listo para
 * despacharse solo; el de WhatsApp queda con su enlace de un clic, que es lo
 * mas automatico que permite ese canal sin la API de negocios. */
app.post('/api/outbox/queue-today', handle((req, res) => {
  const state = readState();
  const ids = Array.isArray(req.body.touchIds) ? req.body.touchIds : null;
  const pendientes = seq.queueFor(state, req.body.date).filter((t) => (ids ? ids.includes(t.id) : true));

  const encolados = [];
  const bloqueados = [];

  pendientes.forEach((t) => {
    if (t.missing.length) return bloqueados.push({ cliente: t.client.name, faltan: t.missing });
    if (t.channel === 'llamada') return bloqueados.push({ cliente: t.client.name, faltan: ['es una llamada, no un mensaje'] });
    const destino = t.channel === 'email' ? t.client.email : t.client.phone;
    if (!destino) return bloqueados.push({ cliente: t.client.name, faltan: [t.channel === 'email' ? 'correo' : 'telefono'] });

    const msg = outbox.queue(OUTBOX_DIR, {
      channel: t.channel,
      to: destino,
      toName: t.client.contactName || t.client.name,
      subject: t.subject,
      body: t.body,
      clientName: t.client.name,
      clientId: t.client.id,
      dealId: t.dealId,
      touchId: t.id,
    });

    const stored = state.touches.find((x) => x.id === t.id);
    if (stored) stored.outboxId = msg.id;
    encolados.push({ id: msg.id, cliente: t.client.name, canal: t.channel });
  });

  writeState(state);
  res.json({ encolados, bloqueados, smtp: outbox.smtpStatus(state.settings) });
}));

/* Despacha los correos pendientes por SMTP y marca enviado el toque que los
 * origino, para que la secuencia avance sola. */
app.post('/api/outbox/send', handle(async (req, res) => {
  const state = readState();
  const r = await outbox.sendPending(OUTBOX_DIR, state.settings, { limit: req.body.limit });
  if (!r.ok) return res.status(400).json({ error: r.reason });

  const fresh = readState();
  r.enviados.forEach((e) => {
    if (!e.touchId) return;
    try {
      seq.markSent(fresh, e.touchId);
    } catch (err) {
      console.error('[agency-os] No se pudo avanzar el toque', e.touchId, err.message);
    }
  });
  writeState(fresh);
  res.json({ enviados: r.enviados, fallidos: r.fallidos });
}));

/* Marcar a mano: lo usa el boton de "ya lo mande" despues de abrir el enlace de
 * WhatsApp, y lo usa tambien el agente que despacha por Gmail. */
app.post('/api/outbox/:id/sent', handle((req, res) => {
  const msg = outbox.read(OUTBOX_DIR, req.params.id);
  if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
  outbox.markSent(OUTBOX_DIR, req.params.id, req.body.note);
  if (msg.touchId) {
    const state = readState();
    try {
      seq.markSent(state, msg.touchId);
      writeState(state);
    } catch (err) {
      // El toque pudo haberse cancelado antes; el mensaje igual quedo enviado.
    }
  }
  res.json({ ok: true });
}));

app.delete('/api/outbox/:id', handle((req, res) => {
  outbox.remove(OUTBOX_DIR, req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Documentos con enlace publico
// ---------------------------------------------------------------------------

// Genera (o devuelve) el enlace de un documento y lo deja listo para mandar.
app.post('/api/:collection/:id/share', handle((req, res) => {
  const { collection, id } = req.params;
  if (!pubdocs.SHAREABLE[collection]) return res.status(400).json({ error: 'Ese documento no se puede compartir' });
  const state = readState();
  const doc = state[collection].find((d) => d.id === id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

  const share = pubdocs.ensureShare(doc);
  delete share.revokedAt;
  doc.updatedAt = nowISO();
  writeState(state);
  res.json({ url: pubdocs.publicUrl(state.settings, share.token), token: share.token, views: (share.views || []).length });
}));

app.post('/api/:collection/:id/unshare', handle((req, res) => {
  const { collection, id } = req.params;
  if (!pubdocs.SHAREABLE[collection]) return res.status(400).json({ error: 'Ese documento no se puede compartir' });
  const state = readState();
  const doc = state[collection].find((d) => d.id === id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
  pubdocs.revokeShare(doc);
  writeState(state);
  res.json({ ok: true });
}));

// La pagina que abre el cliente. Registra la apertura: saber que la propuesta
// se abrio tres veces ayer cambia por completo el mensaje de seguimiento.
app.get('/d/:token', handle((req, res) => {
  const state = readState();
  const found = pubdocs.findByToken(state, req.params.token);
  if (!found) return res.status(404).type('html').send(pubdocs.renderNotFound());

  pubdocs.logView(found.doc, req);
  writeState(state);
  res.type('html').send(pubdocs.renderPublic(state, found.collection, found.doc));
}));

app.post('/d/:token/accept', handle((req, res) => {
  const state = readState();
  const found = pubdocs.findByToken(state, req.params.token);
  if (!found) return res.status(404).type('html').send(pubdocs.renderNotFound());
  if (found.doc.share.revokedAt) return res.type('html').send(pubdocs.renderPublic(state, found.collection, found.doc));

  try {
    pubdocs.accept(state, found.collection, found.doc, req.body || {}, req);
  } catch (err) {
    return res.type('html').send(pubdocs.renderPublic(state, found.collection, found.doc, { error: err.message }));
  }

  // Una propuesta aceptada mueve su oportunidad y para el seguimiento: seguir
  // insistiendole a quien ya dijo que si es la peor forma de perderlo.
  if (found.collection === 'proposals') {
    const deal = state.deals.find((d) => d.clientId === found.doc.clientId && OPEN_STAGE_IDS.includes(d.stage));
    if (deal) {
      seq.cancelPending(state, deal.id, 'propuesta aceptada');
      deal.stage = 'negociacion';
      deal.probability = 90;
      deal.nextAction = 'Generar contrato desde la propuesta aceptada';
      deal.nextActionDate = today();
      deal.updatedAt = nowISO();
    }
  }

  writeState(state);
  mirrorFor(state, found.collection, found.doc);
  res.type('html').send(pubdocs.renderPublic(state, found.collection, found.doc));
}));

app.put('/api/settings', handle((req, res) => {
  const state = readState();
  state.settings = deepDefaults(req.body || {}, state.settings);
  writeState(state);
  res.json(state.settings);
}));

app.put('/api/onboarding-template', handle((req, res) => {
  const state = readState();
  state.onboardingTemplate = Array.isArray(req.body.steps) ? req.body.steps : state.onboardingTemplate;
  writeState(state);
  res.json({ steps: state.onboardingTemplate });
}));

// Crear en cualquier coleccion. Aplica numeracion y espejo cuando corresponde.
app.post('/api/:collection', handle((req, res) => {
  const { collection } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(404).json({ error: 'Coleccion desconocida' });
  const state = readState();
  const record = { id: newId(), createdAt: nowISO(), updatedAt: nowISO(), ...validate.limpiar(collection, req.body) };

  /* Una pieza recien creada nace en Despacho, no publicada. El default es
   * explicito porque quien mas va a llamar aqui es un agente escribiendo su
   * propio entregable, y un agente que pudiera crear algo ya "publicado" se
   * saltaria la unica frontera humana que tiene el sistema. */
  if (collection === 'assets' && !record.estado) record.estado = 'generado';

  if (collection === 'proposals' && !record.number) record.number = nextProposalNumber(state);
  if (collection === 'invoices' && !record.number) record.number = nextInvoiceNumber(state, record.currency);
  if (collection === 'contracts') {
    if (!record.number) record.number = nextContractNumber(state);
    state.contracts.push(record);
    record.body = record.body || renderContract(state, record);
    state.contracts.pop();
  }

  state[collection].push(record);
  writeState(state);
  mirrorFor(state, collection, record);
  res.json(record);
}));

app.put('/api/:collection/:id', handle((req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(404).json({ error: 'Coleccion desconocida' });
  const state = readState();
  const idx = state[collection].findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  // El validador necesita saber de donde viene la pieza para decidir si la
  // transicion de estado es legal. Solo lo usa `assets`; para el resto sobra.
  const cuerpo = { ...req.body, _estadoActual: state[collection][idx].estado };
  const merged = { ...state[collection][idx], ...validate.limpiar(collection, cuerpo), id, updatedAt: nowISO() };
  state[collection][idx] = merged;
  writeState(state);
  mirrorFor(state, collection, merged);
  res.json(merged);
}));

// Todo lo que cuelga de un cliente. Se usa para avisar antes de borrar.
const HIJOS_DE_CLIENTE = ['deals', 'proposals', 'contracts', 'subscriptions', 'invoices', 'onboardings', 'briefs', 'productions', 'reports', 'diagnostics'];

function dependenciasDe(state, clientId) {
  const cuenta = {};
  HIJOS_DE_CLIENTE.forEach((col) => {
    const n = (state[col] || []).filter((r) => r.clientId === clientId).length;
    if (n) cuenta[col] = n;
  });
  const piezas = (state.pieces || []).filter((p) =>
    (state.productions || []).some((pr) => pr.clientId === clientId && pr.id === p.productionId)
  ).length;
  if (piezas) cuenta.pieces = piezas;
  return cuenta;
}

app.get('/api/clients/:id/dependencies', handle((req, res) => {
  res.json({ dependencias: dependenciasDe(readState(), req.params.id) });
}));

app.delete('/api/:collection/:id', handle((req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(404).json({ error: 'Coleccion desconocida' });
  const state = readState();
  const record = state[collection].find((r) => r.id === id);

  /* Borrar un cliente dejaba sus facturas, contratos y suscripciones colgando
   * de un id que ya no existe — y la cartera y el MRR los seguian sumando. Se
   * arrastra todo, pero solo cuando se pide expresamente: perder un contrato
   * firmado por un clic no puede pasar. */
  if (collection === 'clients') {
    const deps = dependenciasDe(state, id);
    const total = Object.values(deps).reduce((s, n) => s + n, 0);
    if (total && req.query.cascade !== '1') {
      return res.status(409).json({
        error: 'Ese cliente tiene documentos asociados.',
        dependencias: deps,
        pista: 'Repite con ?cascade=1 para borrarlo todo junto.',
      });
    }
    if (total) {
      const produccionIds = (state.productions || []).filter((p) => p.clientId === id).map((p) => p.id);
      state.pieces = (state.pieces || []).filter((p) => !produccionIds.includes(p.productionId));
      const dealIds = (state.deals || []).filter((d) => d.clientId === id).map((d) => d.id);
      state.touches = (state.touches || []).filter((t) => !dealIds.includes(t.dealId));
      HIJOS_DE_CLIENTE.forEach((col) => {
        state[col] = (state[col] || []).filter((r) => r.clientId !== id);
      });
    }
  }

  state[collection] = state[collection].filter((r) => r.id !== id);

  // Borrar una oportunidad se lleva sus toques: dejarlos vivos haria que la
  // cola del dia pidiera escribirle a un prospecto que ya no existe.
  if (collection === 'deals') {
    state.touches = (state.touches || []).filter((t) => t.dealId !== id);
  }

  writeState(state);
  if (record) removeMirror(state, collection, record);
  if (collection === 'clients') limpiarEspejos(state);
  res.json({ ok: true });
}));

// Regenera el texto del contrato desde la plantilla (pierde ediciones manuales).
app.post('/api/contracts/:id/regenerate', handle((req, res) => {
  const state = readState();
  const c = state.contracts.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Contrato no encontrado' });
  c.body = renderContract(state, c);
  c.updatedAt = nowISO();
  writeState(state);
  mirrorContract(state, c);
  res.json(c);
}));

// Propuesta aceptada -> contrato borrador con el alcance ya cargado.
app.post('/api/proposals/:id/to-contract', handle((req, res) => {
  const state = readState();
  const p = state.proposals.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Propuesta no encontrada' });
  const client = state.clients.find((x) => x.id === p.clientId) || {};
  const totals = computeTotals(p);
  const recurringItems = (p.items || []).filter((it) => it.billing === 'retainer' || it.billing === 'suscripcion');
  const type = recurringItems.length ? (recurringItems[0].billing === 'suscripcion' ? 'suscripcion' : 'retainer') : 'proyecto';
  const monthlyFee = recurringItems.length
    ? recurringItems.reduce((s, it) => s + lineTotal(it), 0)
    : totals.total;

  const contract = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    number: nextContractNumber(state),
    clientId: p.clientId,
    proposalId: p.id,
    type,
    jurisdiction: client.country === 'Mexico' ? 'MX' : client.currency === 'USD' ? 'US' : 'CO',
    currency: p.currency,
    monthlyFee,
    startDate: today(),
    termMonths: 3,
    noticeDays: 30,
    slaHours: 24,
    billingDay: 1,
    paymentTermsDays: state.settings.invoicing.defaultTermsDays,
    scope: (p.items || []).map((it) => it.description),
    status: 'borrador',
    signedAt: '',
  };
  state.contracts.push(contract);
  contract.body = renderContract(state, contract);
  writeState(state);
  mirrorContract(state, contract);
  res.json(contract);
}));

// Contrato firmado -> suscripcion activa (solo para modalidades recurrentes).
app.post('/api/contracts/:id/to-subscription', handle((req, res) => {
  const state = readState();
  const c = state.contracts.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Contrato no encontrado' });
  const sub = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    clientId: c.clientId,
    contractId: c.id,
    planName: c.type === 'suscripcion' ? 'Suscripcion mensual' : 'Retainer mensual',
    amount: c.monthlyFee,
    currency: c.currency,
    billingDay: c.billingDay || 1,
    status: 'activa',
    startDate: c.startDate,
    nextInvoiceDate: c.startDate,
    lastInvoiceId: '',
  };
  state.subscriptions.push(sub);
  writeState(state);
  res.json(sub);
}));

// Genera la factura del periodo de una suscripcion y avanza la fecha de corte.
function buildInvoiceForSub(state, sub, issueDate) {
  const termsDays = state.settings.invoicing.defaultTermsDays;
  const period = (sub.nextInvoiceDate || issueDate).slice(0, 7);
  const invoice = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    number: nextInvoiceNumber(state, sub.currency),
    clientId: sub.clientId,
    contractId: sub.contractId,
    subscriptionId: sub.id,
    issueDate,
    dueDate: addDays(issueDate, termsDays),
    currency: sub.currency,
    items: [{ description: `${sub.planName} — periodo ${period}`, qty: 1, unitPrice: sub.amount, billing: 'retainer' }],
    taxRate: state.settings.invoicing.taxRate[sub.currency] || 0,
    withholding: 0,
    discount: 0,
    status: 'borrador',
    notes: '',
  };
  state.invoices.push(invoice);
  sub.lastInvoiceId = invoice.id;
  sub.nextInvoiceDate = addMonths(sub.nextInvoiceDate || issueDate, 1);
  sub.updatedAt = nowISO();
  mirrorInvoice(state, invoice);
  return invoice;
}

app.post('/api/subscriptions/:id/invoice', handle((req, res) => {
  const state = readState();
  const sub = state.subscriptions.find((x) => x.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Suscripcion no encontrada' });
  const invoice = buildInvoiceForSub(state, sub, req.body.issueDate || today());
  writeState(state);
  res.json({ invoice, subscription: sub });
}));

// Arranca el checklist de onboarding de un cliente desde la plantilla.
app.post('/api/clients/:id/onboarding', handle((req, res) => {
  const state = readState();
  const client = state.clients.find((x) => x.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  const ob = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    clientId: client.id,
    startedAt: today(),
    steps: state.onboardingTemplate.map((label) => ({ id: newId(), label, done: false, doneAt: '' })),
  };
  state.onboardings.push(ob);
  writeState(state);
  res.json(ob);
}));

// Un deal ganado se convierte en cliente activo si aun era solo prospecto.
app.post('/api/deals/:id/win', handle((req, res) => {
  const state = readState();
  const deal = state.deals.find((x) => x.id === req.params.id);
  if (!deal) return res.status(404).json({ error: 'Oportunidad no encontrada' });
  deal.stage = 'ganado';
  deal.closedAt = today();
  deal.updatedAt = nowISO();
  const client = state.clients.find((x) => x.id === deal.clientId);
  if (client && client.status !== 'activo') {
    client.status = 'activo';
    client.updatedAt = nowISO();
    mirrorClient(state, client);
  }
  writeState(state);
  res.json({ deal, client });
}));

// ---------------------------------------------------------------------------
// Produccion
// ---------------------------------------------------------------------------

// Una pieza cuenta como entregada al llegar a los dos ultimos estados de su flujo:
// copy/grafica terminan en aprobado-publicado; video en editado-publicado.
const DELIVERED_STATES = ['aprobado', 'publicado', 'editado'];

function isDelivered(piece) {
  return DELIVERED_STATES.includes(piece.status);
}

// "20 anuncios estaticos/mes" -> 20 · "Optimizacion semanal" -> 4 · resto -> 1
function targetFromDeliverable(text) {
  const t = String(text || '').toLowerCase();
  const lead = t.match(/^\s*(\d+)/);
  if (lead) return Number(lead[1]);
  if (t.includes('semanal')) return 4;
  if (t.includes('quincenal')) return 2;
  return 1;
}

function servicesForClient(state, clientId) {
  const ids = new Set();
  const names = new Set();

  state.subscriptions
    .filter((s) => s.clientId === clientId && s.status === 'activa')
    .forEach((s) => {
      const contract = state.contracts.find((c) => c.id === s.contractId);
      if (!contract) return;
      (contract.scope || []).forEach((line) => names.add(String(line).toLowerCase().trim()));
      const proposal = state.proposals.find((p) => p.id === contract.proposalId);
      (proposal ? proposal.items || [] : []).forEach((it) => {
        if (it.serviceId) ids.add(it.serviceId);
        if (it.description) names.add(String(it.description).toLowerCase().trim());
      });
    });

  return state.services.filter((sv) => ids.has(sv.id) || names.has(String(sv.name).toLowerCase().trim()));
}

// Convierte los entregables comprometidos del contrato en el plan del mes.
// Devuelve null si ese mes ya existe para ese cliente.
function buildProduction(state, client, month) {
  if (state.productions.some((p) => p.clientId === client.id && p.month === month)) return null;

  const services = servicesForClient(state, client.id);
  const commitments = [];
  services.forEach((sv) => {
    (sv.deliverables || []).forEach((d) => {
      commitments.push({ id: newId(), label: d, target: targetFromDeliverable(d), serviceId: sv.id, serviceName: sv.name });
    });
  });

  const production = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    clientId: client.id,
    month,
    commitments,
    status: commitments.length ? 'en-curso' : 'sin-compromisos',
    notes: commitments.length
      ? ''
      : 'No hay suscripcion activa con servicios del catalogo: agrega los compromisos a mano.',
  };
  state.productions.push(production);
  return production;
}

app.post('/api/clients/:id/production', handle((req, res) => {
  const state = readState();
  const client = state.clients.find((x) => x.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  const month = req.body.month || today().slice(0, 7);
  const production = buildProduction(state, client, month);
  if (!production) return res.status(409).json({ error: `Ya existe el mes ${month} para ${client.name}` });
  writeState(state);
  res.json(production);
}));

// Lee el frontmatter simple de una nota del vault.
function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return out;
}

// Importa lo que dejaron los agentes de produccion en el vault:
// `enhanced-ads-suite` en AdsSuite\ y `personal-brand-video` en Video\.
function importForProduction(state, prod) {
  const name = clientName(state, prod.clientId);

  const sources = [ADS_SUITE_DIR, VIDEO_DIR].filter((d) => fs.existsSync(d));
  if (!sources.length) {
    return { imported: 0, scanned: 0, note: `Todavia no existen ${ADS_SUITE_DIR} ni ${VIDEO_DIR}` };
  }

  const files = [];
  sources.forEach((dir) => {
    fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .forEach((f) => files.push({ dir, file: f }));
  });
  const existing = new Set(state.pieces.map((p) => `${p.vaultNote}|${p.title}`));

  // Asigna cada pieza importada al compromiso que le corresponde, si hay uno obvio.
  const matchCommitment = (re) => {
    const c = (prod.commitments || []).find((x) => re.test(String(x.label)));
    return c ? c.id : '';
  };
  const copyCommitment = matchCommitment(/anuncio|pieza|copy|gr[aá]fic|creativ/i);
  const videoCommitment = matchCommitment(/video|gui[oó]n/i);
  let imported = 0;
  let scanned = 0;

  files.forEach(({ dir, file }) => {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const fm = parseFrontmatter(raw);
    const sameClient = String(fm.client || '').toLowerCase().trim() === name.toLowerCase().trim();
    const sameMonth = String(fm.date || '').slice(0, 7) === prod.month;
    if (!sameClient || !sameMonth) return;
    scanned += 1;

    const add = (title, type, platform, angle) => {
      if (existing.has(`${file}|${title}`)) return;
      existing.add(`${file}|${title}`);
      state.pieces.push({
        id: newId(),
        createdAt: nowISO(),
        updatedAt: nowISO(),
        clientId: prod.clientId,
        productionId: prod.id,
        commitmentId: type === 'video' ? videoCommitment : copyCommitment,
        type,
        platform,
        title,
        angle: angle || '',
        // Un video llega como guion escrito: todavia falta grabarlo y editarlo.
        status: type === 'video' ? 'guion' : 'borrador',
        vaultNote: file,
        dueDate: '',
        publishedAt: '',
        notes: '',
      });
      imported += 1;
    };

    // Cada "### Variante N - Angulo: X" es una pieza de copy.
    (raw.match(/^###\s+Variante.*$/gm) || []).forEach((line) => {
      const title = line.replace(/^###\s+/, '').trim();
      const angle = (title.match(/[AÁ]ngulo:\s*\[?([^\]\n]+)\]?/i) || [])[1] || '';
      add(title, 'copy', fm.platform || 'facebook', angle.trim());
    });

    // Cada "### Video N - titulo" es un guion de marca personal.
    (raw.match(/^###\s+Video\s+\d+.*$/gim) || []).forEach((line) => {
      const title = line.replace(/^###\s+/, '').trim();
      add(title, 'video', fm.platform || 'reels', fm.pilar || '');
    });

    if (/^##\s+Gui[oó]n de video/im.test(raw)) add('Guion de video ad', 'video', 'video', '');
  });

  return { imported, scanned, files: files.length };
}

app.post('/api/productions/:id/import-vault', handle((req, res) => {
  const state = readState();
  const prod = state.productions.find((p) => p.id === req.params.id);
  if (!prod) return res.status(404).json({ error: 'Mes de produccion no encontrado' });
  const result = importForProduction(state, prod);
  writeState(state);
  res.json(result);
}));

// Arma el borrador del reporte mensual con lo que ya esta registrado.
// Devuelve null si ya existe el reporte de ese mes.
function buildReport(state, client, month) {
  if (state.reports.some((r) => r.clientId === client.id && r.month === month)) return null;

  const prod = state.productions.find((p) => p.clientId === client.id && p.month === month);
  const pieces = state.pieces.filter((p) => p.clientId === client.id && (!prod || p.productionId === prod.id));
  const delivery = (prod ? prod.commitments : []).map((c) => ({
    label: c.label,
    target: c.target,
    done: pieces.filter((p) => p.commitmentId === c.id && isDelivered(p)).length,
  }));

  const report = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    clientId: client.id,
    month,
    productionId: prod ? prod.id : '',
    delivery,
    metrics: [
      { label: 'Inversion publicitaria', value: '', previous: '', note: '' },
      { label: 'Alcance / impresiones', value: '', previous: '', note: '' },
      { label: 'Clics', value: '', previous: '', note: '' },
      { label: 'Leads / conversiones', value: '', previous: '', note: '' },
      { label: 'Costo por lead', value: '', previous: '', note: '' },
    ],
    highlights: '',
    nextMonth: '',
    status: 'borrador',
    sentAt: '',
  };
  state.reports.push(report);
  mirrorReport(state, report);
  return report;
}

app.post('/api/clients/:id/report', handle((req, res) => {
  const state = readState();
  const client = state.clients.find((x) => x.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  const month = req.body.month || today().slice(0, 7);
  const report = buildReport(state, client, month);
  if (!report) return res.status(409).json({ error: `Ya existe el reporte de ${month} para ${client.name}` });
  writeState(state);
  res.json(report);
}));

// ---------------------------------------------------------------------------
// Captacion: formulario publico y calificacion del lead
// ---------------------------------------------------------------------------

// Rubrica de calificacion. El puntaje es interno: el prospecto nunca lo ve.
const SCORING = {
  budget: { 'mas-5m': 35, '2-5m': 25, '1-2m': 12, 'menos-1m': 0, 'no-se': 6 },
  urgency: { ya: 25, 'este-mes': 15, explorando: 5 },
  invests: { si: 20, no: 5 },
  team: { solo: 4, '2-10': 10, '11-50': 8, 'mas-50': 5 },
};

const BUDGET_VALUE = { 'mas-5m': 6000000, '2-5m': 3500000, '1-2m': 1500000, 'menos-1m': 700000, 'no-se': 0 };

function scoreApplication(a) {
  const breakdown = [];
  const add = (label, points) => {
    breakdown.push({ label, points });
    return points;
  };
  let score = 0;
  score += add('Presupuesto', SCORING.budget[a.budget] ?? 0);
  score += add('Urgencia', SCORING.urgency[a.urgency] ?? 0);
  score += add('Ya invierte en marketing', SCORING.invests[a.invests] ?? 0);
  score += add('Tamano del equipo', SCORING.team[a.team] ?? 0);
  // Un problema descrito con detalle es la mejor senal de intencion real.
  const detail = String(a.problem || '').trim().length;
  score += add('Claridad del problema', detail > 180 ? 10 : detail > 60 ? 6 : 2);
  return { score: Math.min(100, score), breakdown };
}

function scoreBand(score) {
  if (score >= 70) return 'agendar';
  if (score >= 40) return 'nutrir';
  return 'descartar';
}

// Endpoint publico: lo llama el formulario, no requiere nada previo.
app.post('/api/public/apply', handle((req, res) => {
  const a = req.body || {};
  const required = ['name', 'company', 'email', 'problem'];
  const missing = required.filter((f) => !String(a[f] || '').trim());
  if (missing.length) return res.status(400).json({ error: `Faltan campos: ${missing.join(', ')}` });

  const state = readState();
  const { score, breakdown } = scoreApplication(a);
  const band = scoreBand(score);

  // Reusa el cliente si ya existe por email o por nombre de empresa.
  let client = state.clients.find(
    (c) =>
      (a.email && String(c.email || '').toLowerCase() === String(a.email).toLowerCase()) ||
      String(c.name || '').toLowerCase() === String(a.company).toLowerCase()
  );
  if (!client) {
    client = {
      id: newId(),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      name: String(a.company).trim(),
      legalName: '',
      taxId: '',
      taxIdLabel: 'NIT',
      contactName: String(a.name).trim(),
      email: String(a.email).trim(),
      phone: String(a.phone || '').trim(),
      website: String(a.website || '').trim(),
      country: 'Colombia',
      currency: 'COP',
      status: 'lead',
      source: 'formulario',
      notes: '',
    };
    state.clients.push(client);
    mirrorClient(state, client);
  }

  const deal = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    clientId: client.id,
    title: `${client.name} — aplicación web`,
    stage: 'nuevo',
    value: BUDGET_VALUE[a.budget] || 0,
    currency: 'COP',
    probability: band === 'agendar' ? 25 : band === 'nutrir' ? 10 : 5,
    expectedCloseDate: addDays(today(), 21),
    source: 'formulario',
    nextAction: band === 'agendar' ? 'Escribir hoy y agendar diagnóstico' : band === 'nutrir' ? 'Responder y calificar mejor por chat' : 'Responder con recursos, no agendar',
    nextActionDate: today(),
    notes: '',
    application: { ...a, score, band, breakdown, receivedAt: nowISO() },
  };
  state.deals.push(deal);
  writeState(state);
  res.json({ ok: true });
}));

app.get('/aplicar', handle((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'aplicar.html'));
}));

// ---------------------------------------------------------------------------
// Diagnostico -> propuesta
// ---------------------------------------------------------------------------

app.post('/api/diagnostics/:id/to-proposal', handle((req, res) => {
  const state = readState();
  const d = state.diagnostics.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Diagnostico no encontrado' });
  const client = state.clients.find((c) => c.id === d.clientId) || {};
  const currency = client.currency || 'COP';

  const items = (d.serviceIds || [])
    .map((id) => state.services.find((s) => s.id === id))
    .filter(Boolean)
    .map((sv) => ({
      description: sv.name,
      detail: (sv.deliverables || []).join(' · '),
      qty: 1,
      unitPrice: currency === 'USD' ? sv.priceUSD : sv.priceCOP,
      billing: sv.billing,
      serviceId: sv.id,
    }));

  // El resumen se arma con las palabras del cliente, no con las nuestras.
  const summary = [
    d.pain ? `Lo que nos dijiste: ${d.pain}` : '',
    d.impact ? `Lo que está costando hoy: ${d.impact}` : '',
    d.tried ? `Lo que ya intentaste: ${d.tried}` : '',
    d.goal ? `A dónde quieres llegar: ${d.goal}` : '',
    d.solution ? `Cómo lo resolvemos: ${d.solution}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const proposal = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    number: nextProposalNumber(state),
    clientId: d.clientId,
    diagnosticId: d.id,
    dealId: d.dealId || '',
    title: d.goal ? d.goal.slice(0, 70) : `Propuesta para ${client.name || ''}`,
    currency,
    taxRate: state.settings.invoicing.taxRate[currency] || 0,
    issueDate: today(),
    validUntil: addDays(today(), 7),
    summary,
    items,
    discount: 0,
    status: 'borrador',
    terms: 'Forma de pago: mes anticipado / 50% de anticipo en proyectos.\nVigencia de esta propuesta: 7 días calendario.\nLa inversión publicitaria no está incluida y la asume el cliente directamente.',
  };
  state.proposals.push(proposal);
  d.proposalId = proposal.id;
  d.updatedAt = nowISO();
  writeState(state);
  mirrorProposal(state, proposal);
  res.json(proposal);
}));

// ---------------------------------------------------------------------------
// Exportar un documento como HTML autocontenido para enviarlo
// ---------------------------------------------------------------------------

const SEND_DIR = path.join(AGENCY_DIR, 'Enviar');

const DOC_CSS = `
body{margin:0;background:#f2f3f1;color:#111827;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;padding:24px}
.doc{background:#fff;max-width:820px;margin:0 auto;padding:44px 48px;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
.doc-head{display:flex;justify-content:space-between;gap:30px;border-bottom:2px solid #111827;padding-bottom:18px;margin-bottom:22px}
.p-company{display:flex;flex-direction:column;font-size:12px;color:#4b5563}
.p-company strong{font-size:15px;color:#111827;margin-bottom:3px}
.doc-meta{text-align:right;display:flex;flex-direction:column;font-size:12px;color:#4b5563}
.doc-meta h1{font-size:22px;letter-spacing:.04em;text-transform:uppercase;color:#111827;margin:0}
.doc-meta strong{font-size:14px;color:#111827;margin-bottom:4px}
.doc-to{display:flex;flex-direction:column;font-size:12px;color:#4b5563;margin-bottom:22px}
.doc-to span:first-child{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af}
.doc-to strong{font-size:14px;color:#111827}
.doc-title{font-size:17px;margin:0 0 8px}
.doc-summary{color:#374151;margin-bottom:20px;white-space:pre-wrap}
.doc-items{width:100%;border-collapse:collapse;margin-bottom:16px}
.doc-items th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;border-bottom:1px solid #d1d5db;padding:0 8px 7px}
.doc-items td{padding:9px 8px;border-bottom:1px solid #f0f1f3;vertical-align:top}
.doc-items small{color:#6b7280;font-size:11px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.doc-totals{margin-left:auto;border-collapse:collapse;min-width:260px}
.doc-totals td{padding:5px 8px;font-size:12.5px;color:#374151}
.doc-totals .grand td{border-top:2px solid #111827;font-size:15px;font-weight:700;color:#111827;padding-top:8px}
.doc-terms,.doc-pay{margin-top:26px;font-size:12px;color:#374151}
.doc-terms h3,.doc-pay h3{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;margin:0 0 6px}
.doc-foot{margin-top:30px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10.5px;color:#9ca3af}
.doc-contract h2{font-size:17px;text-align:center;margin-bottom:6px}
.doc-contract h3{font-size:12.5px;margin:20px 0 6px}
.doc-contract p{margin-bottom:8px;text-align:justify}
.doc-contract .doc-bullet{margin:2px 0 2px 18px;text-align:left}
.doc-contract hr{border:0;border-top:1px solid #d1d5db;margin:24px 0}
.doc-table{width:100%;border-collapse:collapse;margin:10px 0}
.doc-table td{border:1px solid #d1d5db;padding:7px 9px;font-size:12px}
@media print{body{background:#fff;padding:0}.doc{box-shadow:none;border-radius:0;padding:0;max-width:none}@page{margin:16mm 14mm}}
`;

// La ruta lleva dos segmentos a proposito: `/api/export` lo capturaria la ruta
// generica `/api/:collection` y responderia "coleccion desconocida".
app.post('/api/export/doc', handle((req, res) => {
  const { filename, title, html } = req.body || {};
  if (!filename || !html) return res.status(400).json({ error: 'Falta filename o html' });
  const safe = slugify(filename).replace(/[^\w\s.-]/g, '');
  const doc = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title || safe}</title><style>${DOC_CSS}</style></head>
<body>${html}</body></html>`;
  fs.mkdirSync(SEND_DIR, { recursive: true });
  const file = path.join(SEND_DIR, `${safe}.html`);
  fs.writeFileSync(file, doc, 'utf8');
  res.json({ path: file });
}));

// ---------------------------------------------------------------------------
// Marketing OS — Despacho y tablero
// ---------------------------------------------------------------------------

/* El Despacho es la unica frontera humana del sistema.
 *
 * Todo lo demas del Marketing OS corre solo: el estratega decide la semana,
 * la cola produce, el reloj ingiere resultados y el retro reescribe el
 * playbook. Nada de eso sale hacia afuera. Aqui si: aprobar una pieza es lo
 * que la habilita para ir a un cliente o a una plataforma de pauta, y eso lo
 * decide una persona.
 *
 * Por eso las transiciones se validan contra el grafo de estados (lib/
 * marketing.js) en vez de aceptar cualquier `estado` que llegue en el cuerpo:
 * quien mas va a llamar a esta API es un agente, y un agente que pudiera
 * publicar directo volveria decorativa la unica revision que existe.
 */

function assetDe(state, id) {
  const asset = (state.assets || []).find((a) => a.id === id);
  if (!asset) {
    const err = new Error('Pieza no encontrada');
    err.status = 404;
    throw err;
  }
  return asset;
}

function moverAsset(asset, nuevo) {
  const permitidos = mk.TRANSICIONES[asset.estado] || [];
  if (!permitidos.includes(nuevo)) {
    const err = new Error(
      permitidos.length
        ? `Una pieza en "${asset.estado}" no puede pasar a "${nuevo}". Solo a: ${permitidos.join(', ')}.`
        : `Una pieza en "${asset.estado}" es final: ya no puede cambiar de estado.`
    );
    err.status = 400;
    throw err;
  }
  asset.estado = nuevo;
  asset.updatedAt = nowISO();
}

app.post('/api/marketing/despacho/:id/aprobar', handle((req, res) => {
  const state = readState();
  const asset = assetDe(state, req.params.id);
  moverAsset(asset, 'aprobado');
  asset.aprobadoAt = nowISO();
  writeState(state);
  res.json(asset);
}));

/* Rechazar exige motivo. No es burocracia: el motivo es la senal de
 * entrenamiento mas barata que produce este sistema —cinco palabras al
 * oprimir un boton— y la unica que corrige el criterio ANTES de que algo
 * salga y cueste dinero. Un rechazo sin motivo es una pieza perdida y una
 * leccion perdida. */
app.post('/api/marketing/despacho/:id/rechazar', handle((req, res) => {
  const motivo = String(req.body.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'El rechazo necesita un motivo: es lo que el sistema aprende.' });

  const state = readState();
  const asset = assetDe(state, req.params.id);
  moverAsset(asset, 'rechazado');
  asset.motivoRechazo = motivo;
  asset.rechazadoAt = nowISO();
  writeState(state);
  res.json(asset);
}));

/* Publicar. Lo que significa depende del canal:
 *
 *  - outbound: se encola en la bandeja de salida y sale por Gmail con el
 *    skill outbox-sender. Es el unico canal con el circuito completo dentro
 *    de la casa, y por eso es el que primero produce aprendizaje real.
 *  - pauta y organico: el sistema no publica en Meta ni en Google. Devuelve
 *    el paquete y Juanjo lo pega en la plataforma. Al hacerlo anota el id del
 *    anuncio en `externalRef`, que es el unico amarre posible entre la pieza
 *    y la fila del CSV de metricas que llegara despues. Sin ese id la pieza
 *    queda publicada y muda: nunca se sabra que hizo.
 */
app.post('/api/marketing/despacho/:id/publicar', handle((req, res) => {
  const state = readState();
  const asset = assetDe(state, req.params.id);
  moverAsset(asset, 'publicado');
  asset.publicadoAt = today();
  if (req.body.externalRef !== undefined) asset.externalRef = String(req.body.externalRef).trim();

  let encolado = null;
  if (asset.canal === 'outbound' && asset.tipo === 'email') {
    const cliente = (state.clients || []).find((c) => c.id === asset.clientId) || {};
    const destino = asset.destino || cliente.email;
    if (!destino) {
      const err = new Error('Esta pieza no tiene a quien enviarse: falta el correo del cliente.');
      err.status = 400;
      throw err;
    }
    const msg = outbox.queue(OUTBOX_DIR, {
      channel: 'email',
      to: destino,
      toName: asset.contacto || cliente.contactName || cliente.name || '',
      subject: asset.asunto || asset.titulo,
      body: asset.cuerpo || '',
      clientName: cliente.name || '',
      clientId: asset.clientId || '',
      assetId: asset.id,
    });
    asset.externalRef = asset.externalRef || msg.id;
    encolado = { id: msg.id, para: destino };
  }

  writeState(state);
  res.json({ asset, encolado, smtp: outbox.smtpStatus(state.settings) });
}));

app.post('/api/marketing/despacho/:id/pausar', handle((req, res) => {
  const state = readState();
  const asset = assetDe(state, req.params.id);
  moverAsset(asset, 'pausado');
  writeState(state);
  res.json(asset);
}));

app.post('/api/marketing/despacho/:id/retirar', handle((req, res) => {
  const state = readState();
  const asset = assetDe(state, req.params.id);
  moverAsset(asset, 'retirado');
  asset.retiradoAt = today();
  writeState(state);
  res.json(asset);
}));

/* El tablero. Lo sirve la misma funcion que consume el agente de retro, a
 * proposito: si la pantalla y el que aprende leyeran cifras calculadas por
 * caminos distintos, tarde o temprano discrepan y no hay manera de saber cual
 * de las dos miente. */
app.get('/api/marketing/tablero', handle((req, res) => {
  res.json(mk.tablero(readState(), {
    desde: req.query.desde || '',
    hasta: req.query.hasta || '',
    metrica: req.query.metrica || 'tasaRespuesta',
    canal: req.query.canal || '',
    campaignId: req.query.campaignId || '',
  }));
}));

// ---------------------------------------------------------------------------
// Automatizaciones que corren solas (sin agente)
// ---------------------------------------------------------------------------

// Abre el mes de produccion de todos los clientes con suscripcion activa.
app.post('/api/automations/open-month', handle((req, res) => {
  const state = readState();
  const month = req.body.month || today().slice(0, 7);
  const clientIds = [...new Set(state.subscriptions.filter((s) => s.status === 'activa').map((s) => s.clientId))];
  const abiertos = [];
  const existentes = [];
  clientIds.forEach((id) => {
    const client = state.clients.find((c) => c.id === id);
    if (!client) return;
    const prod = buildProduction(state, client, month);
    (prod ? abiertos : existentes).push(client.name);
  });
  writeState(state);
  res.json({ month, abiertos, existentes });
}));

// Factura todas las suscripciones activas cuyo corte ya llego.
app.post('/api/automations/invoice-due', handle((req, res) => {
  const state = readState();
  const hoy = req.body.issueDate || today();
  const pendientes = state.subscriptions.filter((s) => s.status === 'activa' && (s.nextInvoiceDate || hoy) <= hoy);
  const generadas = pendientes.map((sub) => {
    const inv = buildInvoiceForSub(state, sub, hoy);
    return { numero: inv.number, cliente: clientName(state, sub.clientId), total: computeTotals(inv).total, moneda: inv.currency };
  });
  writeState(state);
  res.json({ generadas });
}));

// Importa del vault para todos los meses de produccion abiertos.
app.post('/api/automations/import-all', handle((req, res) => {
  const state = readState();
  const month = req.body.month || today().slice(0, 7);
  const detalle = [];
  state.productions
    .filter((p) => p.month === month)
    .forEach((prod) => {
      const r = importForProduction(state, prod);
      if (r.imported) detalle.push({ cliente: clientName(state, prod.clientId), importadas: r.imported });
    });
  writeState(state);
  res.json({ month, detalle, total: detalle.reduce((s, d) => s + d.importadas, 0) });
}));

// Genera el borrador de reporte de todos los clientes con produccion ese mes.
app.post('/api/automations/reports', handle((req, res) => {
  const state = readState();
  const month = req.body.month || today().slice(0, 7);
  const generados = [];
  const existentes = [];
  state.productions
    .filter((p) => p.month === month)
    .forEach((prod) => {
      const client = state.clients.find((c) => c.id === prod.clientId);
      if (!client) return;
      const r = buildReport(state, client, month);
      (r ? generados : existentes).push(client.name);
    });
  writeState(state);
  res.json({ month, generados, existentes });
}));

/* Saca de la lista de grabacion todo lo que no tiene un solo dato de contacto.
 * Es la basura que entra con cualquier lote: un nombre suelto sin telefono, sin
 * correo, sin web y sin instagram. No se le puede grabar nada ni mandarle nada,
 * pero ocupa los primeros puestos de la lista porque es de los mas viejos. */
app.post('/api/automations/clean-prospects', handle((req, res) => {
  const state = readState();
  const descartados = reloj.descartarSinContacto(state, DEPS_RELOJ, req.body.dias);
  const vencidas = reloj.vencerPropuestas(state);
  writeState(state);
  res.json({ descartados, vencidas });
}));

// Encola un trabajo de produccion para cada cliente activo con brief.
app.post('/api/automations/queue-production', handle((req, res) => {
  const state = readState();
  const month = req.body.month || today().slice(0, 7);
  const type = req.body.type === 'video-batch' ? 'video-batch' : 'ads-package';
  const existing = scanJobs();
  const encolados = [];
  const saltados = [];

  state.clients
    .filter((c) => c.status === 'activo')
    .forEach((client) => {
      const brief = state.briefs.find((b) => b.clientId === client.id);
      const kind = brief ? brief.kind || 'ads' : '';
      const sirve = type === 'video-batch' ? kind === 'personal' || kind === 'ambos' : kind === 'ads' || kind === 'ambos';
      if (!brief) return saltados.push(`${client.name} (sin brief)`);
      if (!sirve) return saltados.push(`${client.name} (brief es de ${kind})`);
      if (existing.some((j) => j.clientId === client.id && j.type === type && j.month === month && j.status === 'pendiente')) {
        return saltados.push(`${client.name} (ya estaba en cola)`);
      }
      const job = writeJob({
        id: `${today()}-${slugify(client.name).toLowerCase().replace(/\s+/g, '-')}-${newId().slice(-4)}`,
        type,
        client: client.name,
        clientId: client.id,
        month,
        status: 'pendiente',
        requestedAt: nowISO(),
        doneAt: '',
        result: '',
        notes: '',
      });
      encolados.push(job.client);
    });

  res.json({ encolados, saltados });
}));

// Corre el dia a mano, sin esperar la hora. Devuelve lo que encontro.
app.post('/api/reloj/correr', handle((req, res) => {
  const state = readState();
  const resultado = reloj.correrDia(state, DEPS_RELOJ, { fecha: req.body.fecha });
  writeState(state);
  const parte = reloj.armarParte(state, resultado, { ...DEPS_RELOJ, outboxPendientes: DEPS_RELOJ.contarBandeja() });
  reloj.escribirParte(PARTE_DIR, resultado.fecha, parte);
  res.json({ ...resultado, parte });
}));

// El parte de hoy, para pintarlo en el panel sin ir al vault.
app.get('/api/reloj/parte', handle((req, res) => {
  const fecha = req.query.fecha || today();
  const file = path.join(PARTE_DIR, `${fecha}.md`);
  res.json({ fecha, existe: fs.existsSync(file), texto: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
}));

/* Todo lo que el reloj necesita del servidor. Se le pasa en vez de que lo
 * importe, para que el modulo se pueda probar sin levantar nada. */
const DEPS_RELOJ = {
  readState,
  writeState,
  parteDir: PARTE_DIR,
  queueFor: seq.queueFor,
  sweepExhausted: seq.sweepExhausted,
  cancelPending: seq.cancelPending,
  recordingList: prospecting.recordingList,
  limpiarEspejos,
  contarBandeja: () => outbox.scan(OUTBOX_DIR).filter((m) => m.status === 'pendiente').length,

  // Deja escrito como cerro el dia anterior. Es lo unico que el juego guarda:
  // todo lo demas (XP, nivel, logros) se deriva del CRM en cada lectura.
  cerrarDia: (state, fecha) => juego.cerrarDia(state, fecha),

  // Lo mecanico de produccion, que hasta ahora habia que ir a oprimir a mano en
  // Automatizaciones todos los meses. Es calculo sobre datos propios: no sale
  // nada hacia un cliente, asi que no hay razon para que espere a un clic.
  abrirMes: (state, month) => {
    const abiertos = [];
    [...new Set(state.subscriptions.filter((s) => s.status === 'activa').map((s) => s.clientId))].forEach((id) => {
      const client = state.clients.find((c) => c.id === id);
      if (client && buildProduction(state, client, month)) abiertos.push(client.name);
    });
    return abiertos;
  },
  importarVault: (state, month) => {
    const detalle = [];
    state.productions
      .filter((p) => p.month === month)
      .forEach((prod) => {
        const r = importForProduction(state, prod);
        if (r.imported) detalle.push(`${clientName(state, prod.clientId)} (${r.imported})`);
      });
    return detalle;
  },
  generarReportes: (state, month) => {
    const generados = [];
    state.productions
      .filter((p) => p.month === month)
      .forEach((prod) => {
        const client = state.clients.find((c) => c.id === prod.clientId);
        if (client && buildReport(state, client, month)) generados.push(client.name);
      });
    return generados;
  },
  facturarVencidas: (state) => {
    const hoy = today();
    return state.subscriptions
      .filter((s) => s.status === 'activa' && (s.nextInvoiceDate || hoy) <= hoy)
      .map((sub) => {
        const inv = buildInvoiceForSub(state, sub, hoy);
        return `${inv.number} ${clientName(state, sub.clientId)}`;
      });
  },
};

app.listen(PORT, () => {
  console.log(`\n  Agency OS corriendo en http://localhost:${PORT}`);
  console.log(`  Datos: ${DATA_FILE}`);
  console.log(`  Espejos markdown: ${AGENCY_DIR}\n`);
  reloj.arrancar(DEPS_RELOJ);
});
