/* Agency OS — la ruta de extraño a cliente: captación, diagnóstico y mensajes. */

const BANDS = {
  agendar: { label: 'Agendar ya', tone: 'green' },
  nutrir: { label: 'Nutrir', tone: 'amber' },
  descartar: { label: 'No califica', tone: 'red' },
};

// En qué paso del recorrido está cada oportunidad.
function journeyStep(d) {
  if (d.stage === 'perdido') return 0;
  if (d.stage === 'ganado') return 7;
  if (d.stage === 'negociacion') return 6;
  if (d.stage === 'propuesta') return 5;
  if (d.stage === 'reunion') return 4;
  if (d.stage === 'contactado') return 3;
  return d.application ? 2 : 1;
}

const JOURNEY = [
  { n: 1, title: 'Prospecto sin contactar', what: 'Está en la base, nadie le ha escrito. El primer mensaje es una observación de su negocio, no un pitch.' },
  { n: 2, title: 'Aplicó por el formulario', what: 'Ya contó su problema por escrito. Respóndele hoy: en menos de 24h la conversión se duplica.' },
  { n: 3, title: 'En seguimiento', what: 'Va por la secuencia de 5 toques en 12 días. Cada mensaje aporta algo antes de pedir algo.' },
  { n: 4, title: 'Diagnóstico', what: 'Llamada de 30 minutos. El guion está aquí: 20 de esos minutos son para que él hable.' },
  { n: 5, title: 'Propuesta enviada', what: 'Vigencia de 7 días. Si a las 72h no responde, el seguimiento decide la venta.' },
  { n: 6, title: 'Resolviendo objeciones', what: 'Ya quiere; falta una duda. Las respuestas están en Mensajes.' },
  { n: 7, title: 'Cliente', what: 'Contrato firmado. Ahora manda el onboarding: los primeros 14 días deciden el año.' },
];

App.views.ruta = {
  title: 'Ruta',
  sub: 'De extraño a cliente, paso por paso, con el siguiente movimiento a la vista.',
  actions: () => btn('Ver formulario', 'apply-open', { cls: 'btn-primary' }),
  render() {
    const s = App.state;
    const url = `${window.location.origin}/aplicar`;

    const captacion = section(
      'Paso 0 — El formulario de captación',
      `<div class="capture">
        <div class="capture-main">
          <p>En vez de sacarle el contexto por chat pregunta a pregunta, mándale este formulario. Llega a la
          primera llamada con el problema ya escrito por él, y tú llegas sabiendo si califica.</p>
          <code class="run-cmd">${esc(url)}</code>
          <p class="muted">Hoy corre en tu computador: sirve para llenarlo tú durante la llamada, o para compartirlo
          en tu red local. Para mandarlo por WhatsApp a cualquiera hay que publicarlo en internet — pídemelo y lo montamos.</p>
        </div>
        <div class="capture-actions">
          ${btn('Abrir', 'apply-open', { small: true })}
          ${btn('Copiar link', 'apply-copy', { small: true })}
        </div>
      </div>
      <div class="rubric">
        <strong>Cómo se califica solo</strong>
        <ul>
          <li>Presupuesto declarado — hasta 35 pts</li>
          <li>Urgencia para empezar — hasta 25 pts</li>
          <li>Ya invierte en publicidad — hasta 20 pts</li>
          <li>Tamaño del equipo — hasta 10 pts</li>
          <li>Qué tan concreto describió su problema — hasta 10 pts</li>
        </ul>
        <p class="muted">70 o más: agendar diagnóstico. Entre 40 y 69: nutrir. Menos de 40: responder con recursos, no agendar.
        El puntaje es interno — el prospecto siempre recibe la misma respuesta cálida.</p>
      </div>`
    );

    const steps = JOURNEY.map((step) => {
      const deals = s.deals.filter((d) => journeyStep(d) === step.n);
      const rows = deals
        .map((d) => {
          const app = d.application;
          const band = app ? BANDS[app.band] || BANDS.nutrir : null;
          const late = d.nextActionDate ? daysUntil(d.nextActionDate) : null;
          return `<li class="journey-item">
            <div class="ji-main">
              <strong>${esc(clientName(d.clientId))}</strong>
              ${band ? `${badge(`${app.score}/100 · ${band.label}`, band.tone)}` : ''}
              <span class="ji-next">${esc(d.nextAction || 'sin próxima acción')}${
                late !== null ? ` · ${late < 0 ? `${-late}d tarde` : late === 0 ? 'hoy' : fmtDate(d.nextActionDate)}` : ''
              }</span>
            </div>
            <div class="ji-actions">${stepActions(step.n, d)}</div>
          </li>`;
        })
        .join('');

      return `<section class="journey-step ${deals.length ? '' : 'empty-step'}">
        <header>
          <span class="js-num">${step.n}</span>
          <div>
            <h3>${esc(step.title)}</h3>
            <p>${esc(step.what)}</p>
          </div>
          <em>${deals.length}</em>
        </header>
        ${rows ? `<ul class="journey-list">${rows}</ul>` : ''}
      </section>`;
    }).join('');

    return `${captacion}${section('El recorrido', `<div class="journey">${steps}</div>`)}`;
  },
};

// El botón que corresponde al paso: uno solo, el obvio.
function stepActions(n, d) {
  const diag = App.state.diagnostics.find((x) => x.dealId === d.id);
  const prop = App.state.proposals.find((p) => p.dealId === d.id || (p.clientId === d.clientId && p.status !== 'rechazada'));
  const contract = App.state.contracts.find((c) => c.clientId === d.clientId);
  const ob = App.state.onboardings.find((o) => o.clientId === d.clientId);

  const msg = btn('Mensaje', 'msg-for', { data: { deal: d.id }, small: true });
  const open = btn('Abrir', 'deal-edit', { data: { id: d.id }, small: true });

  if (n === 2) return `${btn('Ver aplicación', 'application-view', { data: { id: d.id }, small: true, cls: 'btn-primary' })} ${msg} ${open}`;
  if (n === 4) {
    return diag
      ? `${btn('Ver diagnóstico', 'diag-open', { data: { id: diag.id }, small: true, cls: 'btn-primary' })} ${open}`
      : `${btn('Abrir guion', 'diag-new', { data: { deal: d.id }, small: true, cls: 'btn-primary' })} ${msg} ${open}`;
  }
  if (n === 5) return `${prop ? btn('Ver propuesta', 'proposal-open', { data: { id: prop.id }, small: true, cls: 'btn-primary' }) : btn('+ Propuesta', 'proposal-new', { data: { client: d.clientId }, small: true, cls: 'btn-primary' })} ${msg} ${open}`;
  if (n === 6) return `${btn('Objeciones', 'go-mensajes', { small: true, cls: 'btn-primary' })} ${msg} ${open}`;
  if (n === 7) {
    if (!contract) return `${btn('+ Contrato', 'contract-new', { small: true, cls: 'btn-primary' })} ${open}`;
    if (!ob) return `${btn('Iniciar onboarding', 'onboarding-start', { data: { id: d.clientId }, small: true, cls: 'btn-primary' })} ${open}`;
    return `${btn('Ver onboarding', 'go-onboarding', { small: true })} ${open}`;
  }
  return `${msg} ${open}`;
}

App.actions['apply-open'] = () => window.open('/aplicar', '_blank');
App.actions['apply-copy'] = () => copyText(`${window.location.origin}/aplicar`, 'Link copiado');
App.actions['go-mensajes'] = () => go('mensajes');

App.actions['application-view'] = (el) => {
  const d = byId('deals', el.dataset.id);
  const a = d.application;
  if (!a) return toast('Esta oportunidad no vino del formulario', 'error');
  const band = BANDS[a.band] || BANDS.nutrir;
  const line = (k, v) => (v ? `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>` : '');
  openPanel(
    `Aplicación — ${clientName(d.clientId)}`,
    `<div class="application">
      <div class="app-score">
        <div class="app-score-num">${a.score}<small>/100</small></div>
        ${badge(band.label, band.tone)}
        <ul>${(a.breakdown || []).map((b) => `<li>${esc(b.label)} <strong>+${b.points}</strong></li>`).join('')}</ul>
      </div>
      <div class="detail-grid">
        ${line('Contacto', a.name)}
        ${line('Empresa', a.company)}
        ${line('Email', a.email)}
        ${line('WhatsApp', a.phone)}
        ${line('Web', a.website)}
        ${line('Equipo', a.team)}
        ${line('Invierte hoy', a.invests === 'si' ? 'Sí' : 'No')}
        ${line('Presupuesto', a.budget)}
        ${line('Urgencia', a.urgency)}
        ${line('Nos conoció por', a.source)}
        ${line('Recibida', fmtDate((a.receivedAt || '').slice(0, 10)))}
      </div>
      <h3 class="app-h">Qué vende</h3><p>${esc(a.business || '—')}</p>
      <h3 class="app-h">El problema, en sus palabras</h3><p class="app-quote">${esc(a.problem || '—')}</p>
      <h3 class="app-h">Qué ya intentó</h3><p>${esc(a.tried || '—')}</p>
    </div>`,
    `${btn('Abrir guion de diagnóstico', 'diag-new', { data: { deal: d.id }, cls: 'btn-primary' })}
     ${btn('Copiar respuesta sugerida', 'msg-for', { data: { deal: d.id } })}`
  );
};

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

const DIAG_GUIDE = [
  ['0-5 min · Contexto', 'Qué hace, cómo vende hoy, quién le compra. Solo para calentar: no tomes decisiones aquí.'],
  ['5-20 min · Dolor', '"¿Qué parte de esto te quita más tiempo?" y te callas. Aquí sale el 100% de la propuesta.'],
  ['20-25 min · Reflejo', 'Le repites su propio dolor con sus palabras y le dices cómo se ve resuelto. Sin nombres de herramientas.'],
  ['25-30 min · Siguiente paso', 'Fecha concreta: "te mando la propuesta hoy, ¿la revisamos el jueves a las 10?"'],
];

App.views.diagnostico = {
  title: 'Diagnóstico',
  sub: 'La llamada de 30 minutos que se convierte en propuesta sola.',
  actions: () => btn('+ Diagnóstico', 'diag-new', { cls: 'btn-primary' }),
  render() {
    const guide = `<ol class="guide-list">${DIAG_GUIDE.map(([t, d]) => `<li><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join('')}</ol>
      <p class="muted">Regla: si no lograste que dijera el dolor en voz alta, no mandes propuesta — manda una pregunta.</p>`;

    const rows = sortBy(App.state.diagnostics, 'date', 'desc').map((d) => {
      const prop = d.proposalId ? byId('proposals', d.proposalId) : null;
      return {
        cells: [
          `<a class="link" data-act="diag-open" data-id="${d.id}">${esc(clientName(d.clientId))}</a>`,
          esc(fmtDate(d.date)),
          esc((d.pain || '—').slice(0, 60)),
          prop ? `<a class="link" data-act="proposal-open" data-id="${prop.id}">${esc(prop.number)}</a>` : '<span class="muted">sin propuesta</span>',
          prop ? '' : btn('Generar propuesta', 'diag-to-proposal', { data: { id: d.id }, small: true, cls: 'btn-primary' }),
        ],
      };
    });

    return `${section('El guion de los 30 minutos', guide)}
      ${section(
        'Diagnósticos',
        table(
          [{ label: 'Cliente' }, { label: 'Fecha' }, { label: 'Dolor detectado' }, { label: 'Propuesta' }, { label: '' }],
          rows,
          'Ninguno todavía. Se abre desde la Ruta cuando agendas la llamada.'
        )
      )}`;
  },
};

function diagFields(d, deal) {
  const v = d || {};
  return [
    { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), value: v.clientId || (deal ? deal.clientId : ''), required: true },
    { name: 'date', label: 'Fecha de la llamada', type: 'date', value: v.date || today(), required: true },
    { name: 'context', label: 'Contexto — qué hace y cómo vende hoy', type: 'textarea', rows: 3, width: 2, value: v.context || '' },
    { name: 'pain', label: 'El dolor, en SUS palabras', type: 'textarea', rows: 3, width: 2, value: v.pain || '', required: true, hint: 'Cópialo literal. Esto es lo que va a leer en la propuesta y lo que la hace sonar cierta.' },
    { name: 'impact', label: '¿Qué le está costando hoy?', type: 'textarea', rows: 2, width: 2, value: v.impact || '', hint: 'En horas, en plata o en clientes perdidos. Sin número, no hay urgencia.' },
    { name: 'tried', label: '¿Qué ya intentó y por qué no funcionó?', type: 'textarea', rows: 2, width: 2, value: v.tried || '' },
    { name: 'goal', label: '¿A dónde quiere llegar?', type: 'textarea', rows: 2, width: 2, value: v.goal || '' },
    { name: 'decision', label: '¿Quién decide y cuándo?', value: v.decision || '', width: 2, hint: 'Si no habla con quien firma, la propuesta se muere en el camino.' },
    { name: 'solution', label: 'Cómo lo resolvemos', type: 'textarea', rows: 3, width: 2, value: v.solution || '', hint: 'En resultado, no en herramientas. Va tal cual a la propuesta.' },
    { name: 'serviceIds', label: 'Servicios que encajan', type: 'services', value: v.serviceIds || [], width: 2 },
    { name: 'nextStep', label: 'Siguiente paso acordado', value: v.nextStep || '', width: 2 },
    { name: 'notes', label: 'Notas sueltas', type: 'textarea', rows: 3, width: 2, value: v.notes || '' },
  ];
}

App.actions['diag-new'] = (el) => {
  const deal = el && el.dataset.deal ? byId('deals', el.dataset.deal) : null;
  closeModal();
  openForm({
    title: 'Diagnóstico',
    wide: true,
    intro: 'Llénalo durante la llamada. Con esto la propuesta se genera sola.',
    fields: diagFields(null, deal),
    submitLabel: 'Guardar diagnóstico',
    onSubmit: async (v) => {
      await api.create('diagnostics', { ...v, dealId: deal ? deal.id : '' });
      if (deal && deal.stage !== 'propuesta') await api.update('deals', deal.id, { stage: 'reunion', probability: 40 });
      toast('Diagnóstico guardado');
    },
  });
};

App.actions['diag-open'] = (el) => {
  const d = byId('diagnostics', el.dataset.id);
  openForm({
    title: `Diagnóstico — ${clientName(d.clientId)}`,
    wide: true,
    fields: diagFields(d, null),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('diagnostics', d.id);
        toast('Diagnóstico eliminado');
      },
    },
    onSubmit: async (v) => {
      await api.update('diagnostics', d.id, v);
      toast('Diagnóstico actualizado');
    },
  });
};

App.actions['diag-to-proposal'] = async (el) => {
  const p = await api.action(`/api/diagnostics/${el.dataset.id}/to-proposal`);
  await refresh();
  toast(`${p.number} creada con el dolor y la solución ya escritos`);
  go('propuestas');
};

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

const TOUCHES = [
  ['Toque 1 · Día 0', 'Observación + pregunta. Sin pitch, sin link.', 'Hola {{contacto}}, vi {{observacion}} de {{empresa}}. Me llamó la atención porque es justo donde la mayoría de {{sector}} pierde plata sin darse cuenta.\n\n¿Eso lo están manejando internamente o con alguien de afuera?'],
  ['Toque 2 · Día 2', 'Valor gratis, aplicable hoy.', 'Hola {{contacto}}, estuve pensando en lo de {{empresa}}. Una cosa que puedes probar esta semana sin contratar a nadie: {{idea}}.\n\nSi quieres te cuento cómo lo hemos hecho con otros.'],
  ['Toque 3 · Día 5', 'Prueba concreta.', '{{contacto}}, te comparto algo rápido: {{caso}}.\n\nNo es magia, es el mismo proceso aplicado con IA. ¿Te sirve que te lo muestre en 15 minutos?'],
  ['Toque 4 · Día 8', 'La oferta directa.', '{{contacto}}, te propongo algo concreto: un diagnóstico de {{empresa}}. En 5 días te digo qué 3 procesos puedes automatizar y cuánto te ahorra cada uno.\n\nSi después de eso no quieres seguir, te quedas con el mapa igual. ¿Lo agendamos?'],
  ['Toque 5 · Día 12', 'Cierre de ciclo. El que más respuestas genera.', '{{contacto}}, no quiero seguir apareciendo en tu bandeja si no es el momento.\n\n¿Lo dejo para más adelante o lo miramos ahora?'],
];

const FLOW_MSGS = [
  ['Respuesta a quien califica', 'Contéstale el mismo día. Menciona algo específico de lo que escribió.', 'Hola {{contacto}}, gracias por escribir con ese nivel de detalle — se nota que lo tienes claro.\n\nLo que cuentas de {{dolor}} es exactamente el tipo de problema que resolvemos. Te propongo 30 minutos para diagnosticarlo bien y salir con un plan concreto, sin compromiso.\n\n¿Te sirve {{fecha}}?'],
  ['Respuesta a quien no califica', 'Sin agendar, sin cerrar la puerta. Hoy no es tu cliente; en un año puede serlo.', 'Hola {{contacto}}, gracias por escribir. Por lo que cuentas, en este momento no creo que trabajar con nosotros sea lo que más te conviene — estarías pagando por una estructura que todavía no necesitas.\n\nTe dejo dos cosas que sí te van a servir ahora: {{recurso1}} y {{recurso2}}.\n\nCuando {{condicion}}, escríbeme y lo retomamos.'],
  ['Confirmación de la llamada', 'Manda esto apenas agenden. Baja el ausentismo a la mitad.', 'Listo {{contacto}}, quedamos {{fecha}}.\n\nSon 30 minutos. Para aprovecharlos: piensa en qué parte de {{tema}} te quita más tiempo hoy. No necesitas preparar nada más.\n\nTe llamo al {{telefono}}.'],
  ['Envío de propuesta', 'El mismo día de la llamada. La propuesta llega mientras la conversación está caliente.', '{{contacto}}, aquí está la propuesta con lo que hablamos.\n\nEn corto: {{resumen}}.\n\nTiene vigencia de 7 días. ¿La revisamos juntos el {{fecha}} para resolver dudas en vivo?'],
  ['Seguimiento a las 72h', 'Sin "solo quería saber si viste mi mensaje". Aporta algo.', '{{contacto}}, sin presionar: se me ocurrió algo para lo de {{tema}} que no alcancé a poner en la propuesta — {{idea}}.\n\n¿Alguna duda con lo que te mandé?'],
  ['Cierre del ciclo', 'Cuando ya hubo 2 seguimientos sin respuesta.', '{{contacto}}, entiendo que no sea prioridad ahora y está perfecto.\n\n¿Cierro el tema por este trimestre y te escribo en {{mes}}, o prefieres que lo dejemos abierto?'],
  ['Bienvenida post-firma', 'Apenas firme. Da certeza y pide los accesos de una vez.', '¡Bienvenido {{contacto}}! Ya estamos arrancando.\n\nEsto es lo que sigue:\n1. Te mando la factura del primer mes hoy.\n2. Necesito accesos a {{accesos}}.\n3. Agendamos el kickoff de 45 minutos esta semana.\n4. Primer entregable el {{fecha}}.\n\n¿Con quién de tu equipo coordino los accesos?'],
];

const OBJECTIONS = [
  ['"Está caro"', 'No bajes el precio: cambia la unidad de comparación.', '¿Caro comparado con qué? Si lo comparas con contratar a alguien de medio tiempo, esto cuesta menos y no se enferma. Si el problema es el flujo de caja, podemos empezar por {{alternativa}} y escalar cuando veas resultado.'],
  ['"Lo tengo que pensar"', 'Casi siempre esconde una duda concreta. Sácala.', 'Claro. Solo para no dejarte con una duda: si tuvieras que decidir hoy, ¿qué es lo que más te haría dudar — el precio, el tiempo, o si de verdad va a funcionar en tu caso?'],
  ['"Ya tengo a alguien haciendo eso"', 'No compitas contra la persona; compite contra el resultado.', 'Perfecto, no vengo a reemplazar a nadie. ¿Cómo les está yendo con {{metrica}}? Si va bien, no toques nada. Si hay una parte que no avanza, ahí es donde entramos.'],
  ['"No tengo tiempo ahora"', 'El tiempo es justamente el argumento.', 'Es que ese es el punto: esto existe para devolverte tiempo. El arranque son 2 horas tuyas en total, repartidas en la primera semana. Después de eso corre sin ti.'],
  ['"¿Me garantizas resultados?"', 'Nunca garantices ventas. Garantiza proceso.', 'No te puedo garantizar ventas — quien te las garantice, te está mintiendo, porque dependen de tu producto y tu mercado. Lo que sí te garantizo es {{entregable}} cada mes y un reporte donde ves exactamente qué se hizo y qué pasó.'],
  ['"Mándame más información"', 'Suele ser un "no" educado. Conviértelo en una pregunta.', 'Te la mando con gusto. Para que no te llegue un PDF genérico: ¿qué es lo que más te interesa resolver — {{opcion1}} o {{opcion2}}?'],
  ['"Eso lo hago yo con ChatGPT"', 'Tiene razón en parte. No lo niegues.', 'Sí, buena parte de esto lo puedes hacer con IA — nosotros la usamos todo el día. La diferencia no es la herramienta, es tener el proceso montado y a alguien produciendo {{volumen}} al mes sin que tú tengas que acordarte. ¿Cuántas piezas alcanzaste a sacar el mes pasado?'],
];

App.views.mensajes = {
  title: 'Mensajes',
  sub: 'Lo que se dice en cada paso, listo para copiar. Rellena las variables antes de mandar.',
  actions: () => '',
  render() {
    const cards = (list, cls) =>
      list
        .map(
          ([title, when, text], i) => `<article class="msg ${cls}">
            <header><h3>${esc(title)}</h3>${btn('Copiar', 'msg-copy', { data: { set: cls, i }, small: true })}</header>
            <p class="msg-when">${esc(when)}</p>
            <pre class="msg-body">${esc(text)}</pre>
          </article>`
        )
        .join('');

    return `${section(
      'Secuencia de contacto en frío — 5 toques en 12 días',
      `<div class="msg-grid">${cards(TOUCHES, 'touch')}</div>`
    )}
    ${section('Mensajes del proceso', `<div class="msg-grid">${cards(FLOW_MSGS, 'flowmsg')}</div>`)}
    ${section(
      'Objeciones',
      `<div class="msg-grid">${cards(OBJECTIONS, 'objection')}</div>
       <p class="muted">Ninguna de estas respuestas promete resultados ni baja el precio. Si vas a ceder algo, que sea a cambio de permanencia, pago anticipado, caso de estudio o referido.</p>`
    )}`;
  },
};

const MSG_SETS = { touch: TOUCHES, flowmsg: FLOW_MSGS, objection: OBJECTIONS };

App.actions['msg-copy'] = (el) => {
  const set = MSG_SETS[el.dataset.set];
  const item = set && set[Number(el.dataset.i)];
  if (!item) return;
  copyText(item[2], 'Mensaje copiado — reemplaza las variables antes de mandarlo');
};

// Prellena lo que se sabe del prospecto y deja el resto como variable.
App.actions['msg-for'] = (el) => {
  const d = byId('deals', el.dataset.deal);
  if (!d) return go('mensajes');
  const c = byId('clients', d.clientId) || {};
  const a = d.application || {};
  const step = journeyStep(d);
  const pick = step === 2 ? (a.band === 'descartar' ? FLOW_MSGS[1] : FLOW_MSGS[0]) : step >= 5 ? FLOW_MSGS[4] : TOUCHES[0];
  const text = pick[2]
    .replace(/{{contacto}}/g, c.contactName || a.name || '')
    .replace(/{{empresa}}/g, c.name || a.company || '')
    .replace(/{{dolor}}/g, (a.problem || '').slice(0, 90))
    .replace(/{{tema}}/g, a.business || '');
  copyText(text, `Copiado: ${pick[0]}`);
};

// ---------------------------------------------------------------------------
// Exportar un documento para enviarlo
// ---------------------------------------------------------------------------

async function exportDoc(filename, title, html) {
  const r = await req('POST', '/api/export/doc', { filename, title, html });
  toast(`Guardado en ${r.path}`);
}

App.actions['proposal-send'] = (el) => {
  const p = byId('proposals', el.dataset.id);
  return exportDoc(`${p.number} - ${clientName(p.clientId)}`, `Propuesta ${p.number}`, proposalDocHTML(p));
};

App.actions['contract-send'] = (el) => {
  const c = byId('contracts', el.dataset.id);
  return exportDoc(`${c.number} - ${clientName(c.clientId)}`, `Contrato ${c.number}`, contractDocHTML(c));
};

App.actions['report-send'] = (el) => {
  const r = byId('reports', el.dataset.id);
  return exportDoc(`Reporte ${r.month} - ${clientName(r.clientId)}`, `Reporte ${r.month}`, reportDocHTML(r));
};
