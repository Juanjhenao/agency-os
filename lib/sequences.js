/* El secuenciador de seguimiento.
 *
 * La secuencia de 5 toques existia como documento: texto para copiar a mano.
 * Aqui pasa a ser una maquina. Cada prospecto inscrito genera sus toques con
 * fecha; el sistema sabe cuales vencen hoy, con que texto, por que canal y a
 * quien. Marcar uno como enviado reprograma los siguientes desde la fecha real
 * de envio, no desde la teorica: si un dia no alcanzaste, la secuencia se corre
 * entera en vez de amontonarse.
 *
 * Reglas que se respetan solas:
 *   - Un prospecto que responde sale de la secuencia (no se le sigue insistiendo).
 *   - Un deal que avanza de etapa sale de la secuencia de captacion.
 *   - Terminada la secuencia sin respuesta, el deal se marca perdido con motivo
 *     y queda para recontacto en 90 dias. Nunca se borra un lead.
 */

const { today, nowISO, addDays, daysUntil } = require('./dates');

const CHANNELS = ['whatsapp', 'email', 'llamada'];
const FINAL_STATES = ['enviado', 'omitido', 'cancelado'];

// ---------------------------------------------------------------------------
// Plantillas semilla
// ---------------------------------------------------------------------------

/* La secuencia real del plan: auditoria en video de sus propios anuncios. El
 * gancho no es un pitch, es mostrarle algo suyo que el no sabe que es publico. */
const SEED_SEQUENCES = [
  {
    id: 'seq-auditoria',
    name: 'Auditoria en video (outbound frio)',
    kind: 'outbound',
    active: true,
    description: '5 toques en 12 dias. El toque 1 lleva el video de auditoria; el resto aporta antes de pedir.',
    steps: [
      {
        day: 0,
        channel: 'whatsapp',
        label: 'Toque 1 · La auditoria',
        subject: 'Le grabe algo sobre los anuncios de {{empresa}}',
        body:
          'Hola {{contacto}}, soy {{yo}}. Le grabe un video de 4 minutos revisando los anuncios que {{empresa}} tiene activos ahora mismo.\n\n' +
          '{{observacion}}\n\n' +
          'Aqui esta, sin compromiso: {{link_auditoria}}\n\n' +
          'No le estoy vendiendo nada todavia — si algo de lo que digo le sirve, uselo.',
      },
      {
        day: 2,
        channel: 'whatsapp',
        label: 'Toque 2 · Valor gratis',
        subject: 'Una idea para {{empresa}}',
        body:
          '{{contacto}}, no se si alcanzo a ver el video. Le dejo la idea principal por escrito para que no tenga que verlo:\n\n' +
          '{{idea}}\n\n' +
          'Eso lo puede probar esta semana sin contratar a nadie.',
      },
      {
        day: 5,
        channel: 'whatsapp',
        label: 'Toque 3 · Prueba',
        subject: 'Como se ve cuando funciona',
        body:
          '{{contacto}}, mire este ejemplo rapido: {{caso}}.\n\n' +
          'Mismo tipo de negocio, mismo problema de creativo quemado. ¿Le muestro en 15 minutos como lo aplicaria a {{empresa}}?\n\n' +
          '{{link_agenda}}',
      },
      {
        day: 8,
        channel: 'whatsapp',
        label: 'Toque 4 · Oferta directa',
        subject: 'Propuesta concreta',
        body:
          '{{contacto}}, le propongo algo concreto y sin contrato largo: un sprint de 14 dias.\n\n' +
          'Seis creativos nuevos, una campana montada y un reporte al final. Si a los 14 dias no le sirve, no seguimos y usted se queda con los creativos.\n\n' +
          '¿Lo arrancamos esta semana?',
      },
      {
        day: 12,
        channel: 'whatsapp',
        label: 'Toque 5 · Cierre de ciclo',
        subject: '¿Lo dejo para mas adelante?',
        body:
          '{{contacto}}, no quiero seguir apareciendo en su chat si no es el momento.\n\n' +
          '¿Lo dejo para mas adelante o lo miramos ahora?',
      },
    ],
  },
  {
    id: 'seq-propuesta',
    name: 'Seguimiento de propuesta',
    kind: 'propuesta',
    active: true,
    description: 'Los 3 toques despues de mandar la propuesta. A las 72 horas sin respuesta la probabilidad de cierre cae a la mitad.',
    steps: [
      {
        day: 3,
        channel: 'whatsapp',
        label: 'Seguimiento 72h · Aporta algo',
        subject: 'Se me ocurrio algo mas',
        body:
          '{{contacto}}, sin presionar: se me ocurrio algo para lo de {{empresa}} que no alcance a poner en la propuesta — {{idea}}.\n\n' +
          '¿Alguna duda con lo que le mande?',
      },
      {
        day: 6,
        channel: 'llamada',
        label: 'Llamada, no mensaje',
        subject: 'Llamar',
        body: 'A esta altura el que no contesta el telefono no iba a firmar por escrito. Llamar, no escribir.',
      },
      {
        day: 9,
        channel: 'whatsapp',
        label: 'Cierre del ciclo',
        subject: '¿Cierro el tema por ahora?',
        body:
          '{{contacto}}, entiendo que no sea prioridad ahora y esta perfecto.\n\n' +
          '¿Cierro el tema por este trimestre y le escribo mas adelante, o prefiere que lo dejemos abierto?',
      },
    ],
  },
];

function seedSequences() {
  return SEED_SEQUENCES.map((s) => ({ ...s, steps: s.steps.map((x) => ({ ...x })) }));
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

/* Lo que no se puede resolver se deja como {{variable}} a proposito: es mejor
 * ver el hueco y llenarlo que mandar un mensaje con un vacio silencioso. La
 * interfaz cuenta cuantos huecos quedan y no deja encolar hasta que no haya. */
function buildVars(state, deal, client) {
  const s = state.settings || {};
  const out = s.outbound || {};
  const company = s.company || {};
  const audit = deal.audit || {};
  return {
    contacto: (client.contactName || '').split(' ')[0] || client.contactName || '',
    contacto_completo: client.contactName || '',
    empresa: client.name || '',
    ciudad: client.city || '',
    sector: out.sector || '',
    yo: company.signerName || company.tradeName || '',
    agencia: company.tradeName || '',
    link_agenda: out.bookingUrl || '',
    link_auditoria: audit.videoUrl || '',
    observacion: audit.observation || '',
    idea: audit.idea || '',
    caso: out.caseStudy || '',
    firma: (s.mail && s.mail.signature) || '',
  };
}

function fillVars(text, vars) {
  return String(text || '').replace(/{{\s*([a-z_0-9]+)\s*}}/gi, (whole, key) => {
    const v = vars[key.toLowerCase()];
    return v === undefined || v === null || v === '' ? whole : String(v);
  });
}

function missingVars(text) {
  const found = String(text || '').match(/{{\s*[a-z_0-9]+\s*}}/gi) || [];
  return [...new Set(found.map((m) => m.replace(/[{}\s]/g, '')))];
}

// ---------------------------------------------------------------------------
// Inscripcion
// ---------------------------------------------------------------------------

function newTouchId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function pendingFor(state, dealId) {
  return (state.touches || []).filter((t) => t.dealId === dealId && t.status === 'pendiente');
}

/* Inscribe un deal en una secuencia y le crea todos sus toques de una vez.
 * Tener el calendario completo por adelantado es lo que permite ver la carga
 * de los proximos dias antes de que llegue. */
function enroll(state, deal, sequenceId, startDate) {
  const seq = (state.sequences || []).find((s) => s.id === sequenceId);
  if (!seq) throw new Error(`Secuencia desconocida: ${sequenceId}`);

  // Reinscribir reemplaza lo pendiente, no lo duplica.
  cancelPending(state, deal.id, 'reinscrito');

  const start = startDate || today();
  const created = seq.steps.map((step, i) => ({
    id: newTouchId(),
    createdAt: nowISO(),
    dealId: deal.id,
    clientId: deal.clientId,
    sequenceId: seq.id,
    sequenceName: seq.name,
    step: i,
    label: step.label,
    channel: step.channel,
    subject: step.subject || '',
    body: step.body || '',
    dueDate: addDays(start, step.day),
    status: 'pendiente',
    sentAt: '',
    outboxId: '',
  }));

  state.touches.push(...created);
  return created;
}

function cancelPending(state, dealId, reason) {
  let n = 0;
  (state.touches || []).forEach((t) => {
    if (t.dealId === dealId && t.status === 'pendiente') {
      t.status = 'cancelado';
      t.cancelReason = reason || '';
      t.updatedAt = nowISO();
      n += 1;
    }
  });
  return n;
}

/* Marcar un toque como enviado corre los siguientes desde la fecha real. Si el
 * toque 2 se manda con 3 dias de atraso, el 3, 4 y 5 se corren 3 dias: la
 * cadencia se conserva en vez de aplastarse contra el final. */
function markSent(state, touchId, sentDate) {
  const t = (state.touches || []).find((x) => x.id === touchId);
  if (!t) throw new Error('Toque no encontrado');
  if (FINAL_STATES.includes(t.status)) return { touch: t, shifted: 0 };

  const when = sentDate || today();
  const drift = daysUntil(t.dueDate) === null ? 0 : -daysUntil(t.dueDate);
  t.status = 'enviado';
  t.sentAt = nowISO();
  t.sentDate = when;
  t.updatedAt = nowISO();

  let shifted = 0;
  if (drift > 0) {
    (state.touches || []).forEach((x) => {
      if (x.dealId === t.dealId && x.sequenceId === t.sequenceId && x.status === 'pendiente' && x.step > t.step) {
        x.dueDate = addDays(x.dueDate, drift);
        x.updatedAt = nowISO();
        shifted += 1;
      }
    });
  }

  // El deal deja de ser "nuevo" en cuanto sale el primer toque.
  const deal = state.deals.find((d) => d.id === t.dealId);
  if (deal) {
    if (deal.stage === 'nuevo') {
      deal.stage = 'contactado';
      deal.probability = Math.max(Number(deal.probability || 0), 20);
    }
    deal.lastTouchAt = when;
    deal.touchCount = Number(deal.touchCount || 0) + 1;
    const next = pendingFor(state, deal.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    deal.nextAction = next ? next.label : 'Secuencia terminada — decidir si se cierra o se recontacta';
    deal.nextActionDate = next ? next.dueDate : addDays(when, 2);
    deal.updatedAt = nowISO();
  }

  return { touch: t, shifted };
}

function skip(state, touchId, reason) {
  const t = (state.touches || []).find((x) => x.id === touchId);
  if (!t) throw new Error('Toque no encontrado');
  t.status = 'omitido';
  t.cancelReason = reason || '';
  t.updatedAt = nowISO();
  return t;
}

function snooze(state, touchId, days) {
  const t = (state.touches || []).find((x) => x.id === touchId);
  if (!t) throw new Error('Toque no encontrado');
  t.dueDate = addDays(t.dueDate < today() ? today() : t.dueDate, Number(days || 1));
  t.updatedAt = nowISO();
  return t;
}

/* El prospecto respondio: se acabo la secuencia. Es la regla mas importante de
 * todas — nada mata una conversacion viva como el toque automatico que sigue. */
function replied(state, dealId, note) {
  const cancelled = cancelPending(state, dealId, 'respondio');
  const deal = state.deals.find((d) => d.id === dealId);
  if (deal) {
    deal.stage = deal.stage === 'nuevo' || deal.stage === 'contactado' ? 'reunion' : deal.stage;
    deal.probability = Math.max(Number(deal.probability || 0), 40);
    deal.nextAction = note || 'Respondio — agendar diagnostico de 30 minutos';
    deal.nextActionDate = today();
    deal.repliedAt = nowISO();
    deal.updatedAt = nowISO();
  }
  return { cancelled, deal };
}

// ---------------------------------------------------------------------------
// La cola del dia
// ---------------------------------------------------------------------------

/* Todo lo pendiente con fecha de hoy o antes, con el texto ya resuelto. Es lo
 * unico que hay que mirar en la manana. */
function queueFor(state, dateStr) {
  const limit = dateStr || today();
  return (state.touches || [])
    .filter((t) => t.status === 'pendiente' && t.dueDate <= limit)
    .map((t) => hydrate(state, t))
    .filter(Boolean)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.step - b.step);
}

function upcoming(state, days) {
  const from = addDays(today(), 1);
  const to = addDays(today(), Number(days || 7));
  return (state.touches || [])
    .filter((t) => t.status === 'pendiente' && t.dueDate >= from && t.dueDate <= to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// Resuelve las variables y adjunta lo que la interfaz necesita para pintarlo.
function hydrate(state, touch) {
  const deal = state.deals.find((d) => d.id === touch.dealId);
  const client = state.clients.find((c) => c.id === touch.clientId);
  if (!deal || !client) return null; // Deal borrado: el toque queda huerfano.
  const vars = buildVars(state, deal, client);
  const subject = fillVars(touch.subject, vars);
  const body = fillVars(touch.body, vars);
  return {
    ...touch,
    subject,
    body,
    missing: missingVars(body).concat(missingVars(subject)),
    late: -(daysUntil(touch.dueDate) || 0),
    client: { id: client.id, name: client.name, contactName: client.contactName, email: client.email, phone: client.phone },
    deal: { id: deal.id, title: deal.title, stage: deal.stage },
  };
}

/* Barrido diario: cierra las secuencias agotadas. Un deal que recibio los 5
 * toques y no contesto no se queda flotando en "contactado" para siempre. */
function sweepExhausted(state) {
  const cerrados = [];
  state.deals.forEach((deal) => {
    if (!['nuevo', 'contactado'].includes(deal.stage)) return;
    const mine = (state.touches || []).filter((t) => t.dealId === deal.id);
    if (!mine.length) return;
    if (mine.some((t) => t.status === 'pendiente')) return;
    if (!mine.some((t) => t.status === 'enviado')) return;
    const last = mine.filter((t) => t.sentDate).sort((a, b) => b.sentDate.localeCompare(a.sentDate))[0];
    if (last && daysUntil(last.sentDate) > -3) return; // Dale 3 dias de gracia.
    deal.stage = 'perdido';
    deal.probability = 0;
    deal.lostReason = 'Secuencia agotada sin respuesta';
    deal.recontactDate = addDays(today(), 90);
    deal.nextAction = 'Recontactar (90 dias)';
    deal.nextActionDate = deal.recontactDate;
    deal.updatedAt = nowISO();
    cerrados.push(deal.title);
  });
  return cerrados;
}

module.exports = {
  CHANNELS,
  seedSequences,
  buildVars,
  fillVars,
  missingVars,
  enroll,
  cancelPending,
  markSent,
  skip,
  snooze,
  replied,
  queueFor,
  upcoming,
  hydrate,
  pendingFor,
  sweepExhausted,
};
