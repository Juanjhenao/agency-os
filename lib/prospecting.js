/* El motor de prospeccion.
 *
 * Los primeros 37 prospectos se cargaron a mano, uno por uno. El plan necesita
 * 250. Este modulo convierte un pegote de texto — lo que sale de la Biblioteca
 * de Anuncios, de Google Maps o de una hoja de calculo — en clientes, deals y
 * toques programados, sin volver a escribir nada.
 *
 * Tres trabajos:
 *   1. Leer el lote y entender sus columnas aunque vengan desordenadas.
 *   2. No duplicar: un negocio que ya esta en la base no vuelve a entrar.
 *   3. Dejar cada prospecto listo para grabarle la auditoria, con el guion
 *      escrito y el toque 1 en la cola del dia que corresponde.
 */

const { today, nowISO, addDays } = require('./dates');

// ---------------------------------------------------------------------------
// Lectura del lote
// ---------------------------------------------------------------------------

// Sinonimos de cada columna. El lote se pega tal como viene, sin renombrar nada.
const COLUMN_ALIASES = {
  name: ['nombre', 'name', 'negocio', 'empresa', 'business', 'clinica', 'razon social'],
  contactName: ['contacto', 'contact', 'dueno', 'dueño', 'owner', 'persona'],
  city: ['ciudad', 'city', 'zona', 'barrio', 'area'],
  phone: ['telefono', 'teléfono', 'phone', 'celular', 'whatsapp', 'tel'],
  email: ['email', 'correo', 'mail', 'e-mail'],
  website: ['web', 'sitio', 'website', 'url', 'pagina'],
  instagram: ['instagram', 'ig', 'perfil'],
  adLibraryUrl: ['adlibrary', 'ad library', 'biblioteca', 'anuncios', 'ads'],
  creativeAgeDays: ['dias', 'días', 'antiguedad', 'antigüedad', 'age', 'dias creativo'],
  notes: ['notas', 'notes', 'observacion', 'observación', 'comentario'],
};

function normalizeHeader(cell) {
  const clean = String(cell || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => clean === a.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return field;
  }
  return null;
}

function splitRow(line) {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes('|')) return line.split('|');
  // La coma solo separa si hay al menos dos, para no partir "Miami, FL".
  if ((line.match(/,/g) || []).length >= 2) return line.split(',');
  return [line];
}

/* Convierte el texto pegado en filas. Si la primera linea parece encabezado, se
 * usa para mapear columnas; si no, se asume el orden por defecto. Y si solo hay
 * una columna, es una lista de nombres — el caso mas comun al empezar. */
function parseBatch(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { rows: [], columns: [] };

  const firstCells = splitRow(lines[0]).map((c) => c.trim());
  const mapped = firstCells.map(normalizeHeader);
  const hasHeader = mapped.filter(Boolean).length >= Math.max(1, Math.ceil(firstCells.length / 2));

  const columns = hasHeader
    ? mapped.map((m, i) => m || `extra${i}`)
    : ['name', 'city', 'phone', 'website', 'instagram', 'notes'];

  const body = hasHeader ? lines.slice(1) : lines;

  const rows = body.map((line) => {
    const cells = splitRow(line).map((c) => c.trim());
    const row = {};
    cells.forEach((cell, i) => {
      const key = columns[i];
      if (!key || key.startsWith('extra') || !cell) return;
      row[key] = cell;
    });
    // Una sola columna = solo el nombre.
    if (cells.length === 1) row.name = cells[0];
    return row;
  });

  return { rows: rows.filter((r) => r.name), columns };
}

// ---------------------------------------------------------------------------
// Deduplicacion
// ---------------------------------------------------------------------------

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(inc|llc|corp|sa|sas|ltda|the|med|spa|medspa|clinic|clinica|center|centro)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normDomain(url) {
  const m = String(url || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  return m || '';
}

function normPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}

/* Busca el prospecto en la base por cuatro caminos distintos. Un med spa que ya
 * esta cargado con otro nombre comercial pero el mismo dominio es el mismo
 * negocio, y volver a escribirle seria el peor error posible. */
function findExisting(state, row) {
  const name = normName(row.name);
  const domain = normDomain(row.website);
  const phone = normPhone(row.phone);
  const email = String(row.email || '').toLowerCase().trim();

  return (
    state.clients.find((c) => {
      if (email && String(c.email || '').toLowerCase() === email) return true;
      if (domain && normDomain(c.website) === domain) return true;
      if (phone && normPhone(c.phone) === phone) return true;
      if (name && normName(c.name) === name) return true;
      return false;
    }) || null
  );
}

// ---------------------------------------------------------------------------
// El guion de la auditoria
// ---------------------------------------------------------------------------

/* La estructura de los 4 minutos. No es un guion palabra por palabra a
 * proposito: leido suena leido, y el valor del video es que se note que es para
 * el. Lo que si esta fijo es el orden — es el que sostiene la atencion. */
function auditScript(state, client, row) {
  const s = state.settings || {};
  const yo = (s.company && s.company.signerName) || (s.company && s.company.tradeName) || 'yo';
  const out = s.outbound || {};
  const edad = Number(row.creativeAgeDays || 0);
  const nombre = client.name;

  const bloques = [
    ['0:00 – 0:20', 'Gancho', `"Hola, ${row.contactName || 'buenas'}, no nos conocemos. Soy ${yo}. Busque ${nombre} en la biblioteca de anuncios de Meta — la que es publica — y le grabe esto en 4 minutos."`],
    ['0:20 – 1:10', 'Lo que veo', `Pantalla compartida con sus anuncios activos. Leer en voz alta el titular real de uno de ellos. ${edad ? `Senalar que el mismo creativo lleva ${edad} dias sin rotar.` : 'Senalar cuantos creativos distintos tiene corriendo.'}`],
    ['1:10 – 2:20', 'El problema, sin insultar', 'Nombrar UN problema concreto (creativo quemado / sin oferta clara / sin llamado a la accion / mismo anuncio para publicos distintos). Explicar que le cuesta eso en dinero, no en teoria.'],
    ['2:20 – 3:30', 'Tres angulos que probaria', out.angles || 'Angulo 1: prueba/resultado real. Angulo 2: objecion frontal (precio o miedo). Angulo 3: quien es el cliente ideal, dicho literal.'],
    ['3:30 – 4:00', 'Cierre suave', '"Si quiere se los produzco y los probamos. Si no, use las ideas, son suyas." Sin link, sin precio, sin urgencia.'],
  ];

  const checklist = [
    'Grabar en espanol, con su nombre y el de su negocio dichos en voz alta.',
    'Mostrar SU cuenta en pantalla, no diapositivas.',
    'Maximo 4 minutos: pasado ese punto se abandona.',
    'Nada de precio ni de propuesta en el video.',
    edad >= 60 ? `Senal de oro: mismo creativo hace ${edad} dias. Nombrarlo explicitamente.` : 'Si no tiene anuncios activos, bajar prioridad — no descartar.',
  ];

  return { bloques, checklist };
}

// ---------------------------------------------------------------------------
// Importacion
// ---------------------------------------------------------------------------

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Revisa el lote contra la base y dice que pasaria, sin escribir nada. Importar
 * a ciegas 200 filas sobre un CRM que ya tiene datos es como se ensucia una
 * base para siempre. */
function preview(state, text) {
  const { rows } = parseBatch(text);
  const vistos = new Map();
  return rows.map((row) => {
    const existing = findExisting(state, row);
    const key = normName(row.name) || normDomain(row.website);
    const dupInBatch = key && vistos.has(key);
    if (key) vistos.set(key, true);
    return {
      row,
      status: existing ? 'existe' : dupInBatch ? 'repetido' : 'nuevo',
      existingName: existing ? existing.name : '',
      existingId: existing ? existing.id : '',
    };
  });
}

/* Crea un prospecto suelto: cliente + oportunidad + datos de la auditoria, ya
 * metidos en el estado. Es la unidad minima de la importacion, y tambien lo que
 * usa el boton de "agregar negocio" de la lista de grabacion — porque la lista
 * del dia se queda corta con una frecuencia que no justifica pegar un lote de
 * una sola fila. */
function buildProspect(state, row, opts) {
  const o = opts || {};

  const client = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    name: row.name,
    legalName: '',
    taxId: '',
    taxIdLabel: o.currency === 'USD' ? 'EIN' : 'NIT',
    contactName: row.contactName || '',
    email: row.email || '',
    phone: row.phone || '',
    website: row.website || '',
    instagram: row.instagram || '',
    city: row.city || o.city || '',
    country: o.country || 'Estados Unidos',
    currency: o.currency || 'USD',
    status: 'lead',
    source: 'outbound',
    niche: o.niche || '',
    notes: row.notes || '',
  };

  const deal = {
    id: newId(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    clientId: client.id,
    title: `${client.name} — auditoria de anuncios`,
    stage: 'nuevo',
    value: Number(o.value || 0),
    currency: o.currency || 'USD',
    probability: 10,
    expectedCloseDate: addDays(today(), Number(o.closeDays || 45)),
    source: 'outbound',
    nextAction: 'Grabar auditoria en video de 4 min',
    nextActionDate: o.startDate || today(),
    notes: '',
    audit: {
      status: 'sin-grabar',
      adLibraryUrl: row.adLibraryUrl || '',
      creativeAgeDays: Number(row.creativeAgeDays || 0) || '',
      observation: row.observation || '',
      idea: row.idea || '',
      videoUrl: '',
      script: auditScript(state, client, row),
    },
  };

  state.clients.push(client);
  state.deals.push(deal);
  return { client, deal };
}

/* Crea cliente + oportunidad + datos de la auditoria para cada fila nueva. La
 * inscripcion en la secuencia la hace quien llama (server.js), porque depende
 * del modulo de secuencias. */
function importBatch(state, text, opts) {
  const items = preview(state, text);
  const creados = [];
  const saltados = [];

  items.forEach((item) => {
    if (item.status !== 'nuevo') {
      saltados.push({ name: item.row.name, motivo: item.status === 'existe' ? `ya existe como "${item.existingName}"` : 'repetido en el lote' });
      return;
    }
    creados.push(buildProspect(state, item.row, opts));
  });

  return { creados, saltados, total: items.length };
}

// Todo lo que espera auditoria, sin cortar. Los mas viejos primero.
function pendingAudits(state) {
  return state.deals
    .filter((d) => d.audit && !['grabada', 'descartada'].includes(d.audit.status) && ['nuevo', 'contactado'].includes(d.stage))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((d) => {
      const c = state.clients.find((x) => x.id === d.clientId) || {};
      return { deal: d, client: c };
    });
}

/* La lista de grabacion del dia: prospectos sin auditoria grabada, cortada en la
 * meta diaria. Diez al dia es el numero que sostiene todo el plan; mostrar mas
 * por defecto solo genera culpa. Pero cortar sin salida era peor: cuando el dia
 * cunde no habia forma de seguir, asi que `limit: 0` (o 'todas') devuelve todo. */
function recordingList(state, limit) {
  const todas = limit === 0 || limit === '0' || limit === 'todas';
  const goal = Number(limit || (state.settings.outbound && state.settings.outbound.dailyGoal) || 10);
  const lista = pendingAudits(state);
  return todas ? lista : lista.slice(0, goal);
}

// Un prospecto sin telefono, correo, web ni instagram no se puede auditar ni
// contactar: ocupa un puesto de la lista del dia y no lleva a ninguna parte.
function sinContacto(client) {
  const c = client || {};
  return !String(c.phone || '').trim() && !String(c.email || '').trim() && !String(c.website || '').trim() && !String(c.instagram || '').trim();
}

module.exports = {
  parseBatch,
  preview,
  buildProspect,
  importBatch,
  auditScript,
  recordingList,
  pendingAudits,
  sinContacto,
  findExisting,
  normName,
};
