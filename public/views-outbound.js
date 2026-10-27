/* Agency OS — el motor de prospeccion y el secuenciador.
 *
 * Dos vistas, y una de ellas es la pantalla de la manana:
 *
 *   Hoy  — lo unico que hay que mirar antes de empezar: que auditorias grabar,
 *          que mensajes salen, que hay en la bandeja. Si esta vacia, el dia
 *          esta hecho.
 *   Prospeccion — de un pegote de texto a 200 prospectos con su secuencia
 *          programada, sin volver a escribir nada.
 */

// ---------------------------------------------------------------------------
// Estado local de las dos vistas
// ---------------------------------------------------------------------------

App.outbound = { queue: [], recording: [], preview: null, loaded: false, verTodas: false };

async function loadOutbound() {
  const [q, rec, ags] = await Promise.all([
    req('GET', '/api/touches/queue'),
    req('GET', `/api/prospecting/today${App.outbound.verTodas ? '?limit=0' : ''}`),
    req('GET', '/api/meetings'),
  ]);
  App.outbound.queue = q.hoy;
  App.outbound.upcoming = q.proximos;
  App.outbound.recording = rec.lista;
  App.outbound.goal = rec.meta;
  App.outbound.total = rec.total;
  App.outbound.sinContacto = rec.sinContacto;
  App.outbound.meetings = ags.lista;
  App.outbound.loaded = true;
}

// Refresca el estado global y los datos propios de la vista, y repinta.
async function refreshOutbound() {
  await Promise.all([refresh(), loadOutbound()]);
  render();
}

const CHANNEL_ICON = { whatsapp: '◉', email: '✉', llamada: '☎' };

// ---------------------------------------------------------------------------
// Hoy
// ---------------------------------------------------------------------------

App.views.hoy = {
  title: 'Hoy',
  sub: 'La meta del dia, y lo que hace falta para cerrarla.',
  actions: () =>
    `${btn('+ Negocio', 'audit-add')}
     ${btn('Encolar todo lo de hoy', 'touch-queue-all', { cls: 'btn-primary' })}
     ${btn('Recargar', 'outbound-reload')}`,
  render() {
    if (!App.outbound.loaded) {
      loadOutbound().then(render);
      return '<div class="empty"><p>Cargando la cola del dia…</p></div>';
    }

    const cola = App.outbound.queue;
    const vencidos = cola.filter((t) => t.late > 0);
    const pend = (App.state.outbox || []).filter((m) => m.status === 'pendiente');
    const errores = (App.state.outbox || []).filter((m) => m.status === 'error');
    const grabar = App.outbound.recording;
    const smtp = (App.state.runtime && App.state.runtime.smtp) || { ready: false, reason: '' };

    const agenda = App.outbound.meetings || [];
    const hoyMismo = agenda.filter((m) => m.fecha === today());

    const pendientesAgenda = agenda.filter((m) => m.sinResultado);
    const total = App.outbound.total || grabar.length;

    const kpis = `<div class="kpi-row">
      ${kpi(
        'Llamadas hoy',
        String(hoyMismo.length),
        pendientesAgenda.length ? `${pendientesAgenda.length} sin resultado` : agenda.length ? `${agenda.length} en 14 dias` : 'nada agendado',
        pendientesAgenda.length ? 'red' : hoyMismo.length ? 'green' : ''
      )}
      ${kpi('Auditorias por grabar', String(grabar.length), total > grabar.length ? `${total} en total · meta ${App.outbound.goal}` : `meta diaria: ${App.outbound.goal}`, grabar.length ? '' : 'green')}
      ${kpi('Mensajes de hoy', String(cola.length), vencidos.length ? `${vencidos.length} atrasados` : 'al dia', vencidos.length ? 'red' : '')}
      ${kpi('En la bandeja', String(pend.length), errores.length ? `${errores.length} con error` : 'listos para salir', errores.length ? 'red' : '')}
    </div>`;

    /* La cabecera del juego va primero, antes de los pendientes. El orden es
     * el cambio: esta pantalla abria con cuatro contadores de deuda —lo que
     * falta grabar, lo atrasado, lo que no ha salido— y leerla era un
     * inventario de maneras de ir quedando mal. Ahora abre con lo que se lleva
     * hecho y con una meta que se puede cerrar; los pendientes siguen ahi,
     * pero dejan de ser lo primero. */
    return `${typeof juegoHeader === 'function' ? juegoHeader() : ''}
      ${kpis}
      ${agendaSection(agenda)}
      ${grabarSection(grabar)}
      ${colaSection(cola, smtp)}
      ${bandejaSection(pend, errores, smtp)}`;
  },
};

/* La agenda no es un calendario: es la lista de las llamadas que hay que hacer,
 * con el botón de resultado al lado. Sin registrar el resultado no existe tasa
 * de asistencia ni de conversión, y esos dos números dicen si estás agendando
 * mal o vendiendo mal. */
function agendaSection(lista) {
  if (!lista.length) {
    return section(
      'Llamadas agendadas',
      emptyState('Nada agendado. Cuando un prospecto responda, usa "Agendar" en su toque y el sistema manda la confirmación y el recordatorio solo.')
    );
  }

  const rows = lista.map((m) => {
    const cuando = daysUntil(m.fecha);
    const etiqueta = m.sinResultado
      ? badge(`hace ${-cuando}d · sin resultado`, 'red')
      : cuando === 0
        ? badge('hoy', 'green')
        : cuando === 1
          ? badge('mañana', 'blue')
          : esc(fmtDate(m.fecha));
    return {
      cells: [
        `<strong>${esc(m.hora)}</strong> ${etiqueta}`,
        `<strong>${esc(m.cliente)}</strong>${m.contacto ? `<br><small class="muted">${esc(m.contacto)}</small>` : ''}`,
        m.telefono ? `<a class="link" href="tel:${esc(m.telefono)}">${esc(m.telefono)}</a>` : '<span class="muted">sin teléfono</span>',
        `${btn('Resultado', 'meeting-result', { data: { deal: m.dealId }, small: true, cls: cuando <= 0 ? 'btn-primary' : 'btn-ghost' })}`,
      ],
    };
  });

  const pendientes = lista.filter((m) => m.sinResultado).length;

  return section(
    `Llamadas agendadas · ${lista.length}`,
    `${table([{ label: 'Cuándo' }, { label: 'Cliente' }, { label: 'Teléfono' }, { label: '' }], rows)}
     ${pendientes ? `<p class="muted warn">${pendientes} llamada(s) ya pasaron y siguen sin resultado. Antes desaparecían de esta pantalla al día siguiente; ahora se quedan hasta que las cierres, porque sin eso no hay tasa de asistencia ni de conversión.</p>` : ''}`
  );
}

/* La lista de grabacion. Tres cosas que antes no se podian hacer y convertian
 * este bloque en una reja: agregar un negocio suelto sin pasar por el lote, ver
 * mas alla de la meta diaria cuando el dia cunde, y sacar de la lista lo que no
 * sirve — contacto errado, negocio sin un solo dato real, el que ya trabaja con
 * otra agencia. Sin salida, esa basura se queda arriba (es la mas vieja) y
 * empuja hacia abajo a los prospectos que si valen. */
function grabarSection(lista) {
  const total = App.outbound.total || lista.length;
  const acciones = `${btn('+ Negocio', 'audit-add', { small: true, cls: 'btn-primary' })}
    ${
      total > App.outbound.goal
        ? btn(App.outbound.verTodas ? `Ver solo la meta (${App.outbound.goal})` : `Ver todas (${total})`, 'recording-toggle', { small: true })
        : ''
    }
    ${App.outbound.sinContacto ? btn(`Descartar ${App.outbound.sinContacto} sin contacto`, 'audit-clean', { small: true }) : ''}`;

  if (!lista.length) {
    return section(
      'Grabar auditorias',
      emptyState(
        'No hay prospectos esperando auditoria. Agrega un negocio suelto o importa un lote nuevo en Prospeccion.',
        `${btn('+ Negocio', 'audit-add', { cls: 'btn-primary' })} ${btn('Ir a Prospeccion', 'go-prospeccion')}`
      ),
      acciones
    );
  }

  const rows = lista.map((p) => {
    const enlaces = [
      p.audit.adLibraryUrl ? `<a class="link" href="${esc(p.audit.adLibraryUrl)}" target="_blank" rel="noopener">Biblioteca</a>` : '',
      p.website ? `<a class="link" href="${esc(/^https?:/.test(p.website) ? p.website : `https://${p.website}`)}" target="_blank" rel="noopener">Web</a>` : '',
      p.instagram ? `<a class="link" href="${esc(/^https?:/.test(p.instagram) ? p.instagram : `https://instagram.com/${String(p.instagram).replace(/^@/, '')}`)}" target="_blank" rel="noopener">IG</a>` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      cells: [
        `<strong>${esc(p.name)}</strong>${p.city ? `<br><small class="muted">${esc(p.city)}</small>` : ''}${
          p.sinContacto ? '<br><small class="warn">sin telefono, correo, web ni IG</small>' : ''
        }`,
        enlaces || '<span class="muted">sin enlaces</span>',
        p.audit.creativeAgeDays ? `<span class="${Number(p.audit.creativeAgeDays) >= 60 ? 'warn' : 'muted'}">${esc(p.audit.creativeAgeDays)} d</span>` : '<span class="muted">—</span>',
        `${btn('Guion', 'audit-script', { data: { deal: p.dealId }, small: true })}
         ${btn('Registrar', 'audit-log', { data: { deal: p.dealId }, small: true, cls: 'btn-primary' })}
         ${btn('Descartar', 'audit-discard', { data: { deal: p.dealId }, small: true })}`,
      ],
    };
  });

  return section(
    `Grabar auditorias · ${lista.length}${total > lista.length ? ` de ${total}` : ''}`,
    `${table(
      [{ label: 'Negocio' }, { label: 'Enlaces' }, { label: 'Creativo' }, { label: '' }],
      rows
    )}
     <p class="muted">Doce a quince minutos cada una. Es el unico bloque del dia que no se negocia: de aqui sale todo lo demas.${
       total > lista.length ? ` Se muestran ${lista.length} porque esa es la meta diaria — hay ${total} esperando.` : ''
     }</p>`,
    acciones
  );
}

function colaSection(cola, smtp) {
  if (!cola.length) {
    return section('Mandar hoy', emptyState('Nada pendiente de enviar. Bien.'));
  }

  const cards = cola
    .map((t) => {
      // Lo que falta casi siempre sale de la auditoria (observacion, idea, el
      // enlace del video). Se ofrece el formulario aqui mismo en vez de mandar
      // a buscarlo arriba: registrarla desbloquea el mensaje y lo corre a hoy.
      const deAuditoria = t.missing.some((m) => ['observacion', 'idea', 'link_auditoria'].includes(m));
      const faltan = t.missing.length
        ? `<p class="msg-when warn">Faltan datos: ${t.missing.map(esc).join(', ')} — ${
            deAuditoria ? 'registra la auditoria y el mensaje queda listo para hoy.' : 'complétalos en Ajustes o en la ficha del cliente.'
          }</p>`
        : '';
      const canal = CHANNEL_ICON[t.channel] || '·';
      const atraso = t.late > 0 ? `<span class="badge badge-red">${t.late}d tarde</span>` : '';

      const acciones = [
        deAuditoria ? btn('Registrar auditoria', 'audit-log', { data: { deal: t.dealId }, small: true, cls: 'btn-primary' }) : '',
        t.channel === 'whatsapp' && t.client.phone && !t.missing.length
          ? btn('Abrir WhatsApp', 'touch-wa', { data: { id: t.id }, small: true, cls: 'btn-primary' })
          : '',
        t.channel === 'email' && t.client.email && !t.missing.length
          ? smtp.ready
            ? btn('Encolar correo', 'touch-queue', { data: { id: t.id }, small: true, cls: 'btn-primary' })
            : btn('Abrir correo', 'touch-mailto', { data: { id: t.id }, small: true, cls: 'btn-primary' })
          : '',
        btn('Copiar', 'touch-copy', { data: { id: t.id }, small: true }),
        btn('Enviado', 'touch-sent', { data: { id: t.id }, small: true }),
        btn('Agendar', 'meeting-set', { data: { deal: t.dealId }, small: true }),
        btn('Respondio', 'touch-replied', { data: { deal: t.dealId }, small: true }),
        btn('+1 dia', 'touch-snooze', { data: { id: t.id }, small: true }),
        btn('Omitir', 'touch-skip', { data: { id: t.id }, small: true }),
      ]
        .filter(Boolean)
        .join(' ');

      return `<article class="msg touch">
        <header>
          <h3>${canal} ${esc(t.client.name)} — ${esc(t.label)}</h3>
          ${atraso}
        </header>
        <p class="msg-when">${esc(t.deal.title)} · ${esc(t.sequenceName)} · vence ${esc(fmtDate(t.dueDate))}</p>
        ${faltan}
        ${t.subject && t.channel === 'email' ? `<p class="msg-when"><strong>Asunto:</strong> ${esc(t.subject)}</p>` : ''}
        <pre class="msg-body">${esc(t.body)}</pre>
        <footer class="msg-actions">${acciones}</footer>
      </article>`;
    })
    .join('');

  return section(`Mandar hoy · ${cola.length}`, `<div class="msg-grid">${cards}</div>`);
}

function bandejaSection(pend, errores, smtp) {
  const enviados = (App.state.outbox || []).filter((m) => m.status === 'enviado').length;
  const estado = smtp.ready
    ? `<p class="muted">Envio automatico listo — ${esc(smtp.reason)}</p>`
    : `<p class="muted warn">Envio automatico apagado: ${esc(smtp.reason)} Mientras tanto, los correos salen con el boton de abrir correo y los de WhatsApp con su enlace.</p>`;

  if (!pend.length && !errores.length) {
    return section('Bandeja de salida', `${estado}${emptyState(`Nada pendiente. ${enviados} mensaje(s) enviados en total.`)}`);
  }

  const rows = pend.concat(errores).map((m) => ({
    cells: [
      `${CHANNEL_ICON[m.channel] || '·'} ${esc(m.clientName || m.toName)}`,
      esc(m.to),
      esc(m.subject || '—'),
      badge(m.status === 'error' ? 'vencida' : 'enviada') + (m.error ? `<br><small class="warn">${esc(m.error)}</small>` : ''),
      `${btn('Ver', 'outbox-view', { data: { id: m.id }, small: true })}
       ${btn('Enviado', 'outbox-sent', { data: { id: m.id }, small: true })}
       ${btn('Borrar', 'outbox-del', { data: { id: m.id }, small: true })}`,
    ],
  }));

  const enviar = smtp.ready && pend.some((m) => m.channel === 'email')
    ? btn('Enviar los correos ahora', 'outbox-send', { cls: 'btn-primary', small: true })
    : '';

  return section('Bandeja de salida', `${estado}${table([{ label: 'Cliente' }, { label: 'Para' }, { label: 'Asunto' }, { label: 'Estado' }, { label: '' }], rows)}`, enviar);
}

// ---------------------------------------------------------------------------
// Acciones de Hoy
// ---------------------------------------------------------------------------

function touchById(id) {
  return App.outbound.queue.find((t) => t.id === id);
}

App.actions['outbound-reload'] = () => refreshOutbound();
App.actions['go-prospeccion'] = () => go('prospeccion');

App.actions['touch-copy'] = (el) => {
  const t = touchById(el.dataset.id);
  if (t) copyText(t.body, 'Mensaje copiado');
};

/* WhatsApp abre en pestana nueva con el texto ya escrito. No lo marcamos como
 * enviado solo, porque abrir el chat no es lo mismo que darle enviar: eso lo
 * confirma la persona. */
App.actions['touch-wa'] = (el) => {
  const t = touchById(el.dataset.id);
  if (!t) return;
  const digits = String(t.client.phone || '').replace(/\D/g, '');
  if (!digits) return toast('Ese prospecto no tiene telefono', 'error');
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(t.body)}`, '_blank', 'noopener');
  toast('Chat abierto — marca "Enviado" cuando lo mandes');
};

App.actions['touch-mailto'] = (el) => {
  const t = touchById(el.dataset.id);
  if (!t) return;
  window.location.href = `mailto:${encodeURIComponent(t.client.email)}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`;
};

App.actions['touch-queue'] = async (el) => {
  const r = await api.action('/api/outbox/queue-today', { touchIds: [el.dataset.id] });
  if (r.bloqueados.length) toast(`Bloqueado: faltan ${r.bloqueados[0].faltan.join(', ')}`, 'error');
  else toast('Encolado para envio');
  await refreshOutbound();
};

App.actions['touch-queue-all'] = async () => {
  const r = await api.action('/api/outbox/queue-today', {});
  const msg = [`${r.encolados.length} encolado(s)`, r.bloqueados.length ? `${r.bloqueados.length} bloqueado(s)` : '']
    .filter(Boolean)
    .join(' · ');
  toast(msg);
  await refreshOutbound();
};

App.actions['touch-sent'] = async (el) => {
  const r = await api.action(`/api/touches/${el.dataset.id}/sent`, {});
  toast(r.shifted ? `Marcado. Se corrieron ${r.shifted} toques por el atraso.` : 'Marcado como enviado');
  await refreshOutbound();
};

App.actions['touch-skip'] = async (el) => {
  await api.action(`/api/touches/${el.dataset.id}/skip`, { reason: 'omitido a mano' });
  await refreshOutbound();
};

App.actions['touch-snooze'] = async (el) => {
  await api.action(`/api/touches/${el.dataset.id}/snooze`, { days: 1 });
  toast('Movido a manana');
  await refreshOutbound();
};

App.actions['touch-replied'] = (el) => {
  const dealId = el.dataset.deal;
  openForm({
    title: 'Respondio',
    intro: 'Se cancela lo que quedaba de la secuencia y la oportunidad sube a reunion. Nada enfria mas una conversacion viva que el toque automatico que sigue.',
    fields: [{ name: 'note', label: 'Que dijo / proxima accion', value: 'Respondio — agendar diagnostico de 30 minutos', width: 2, required: true }],
    submitLabel: 'Sacar de la secuencia',
    onSubmit: async (v) => {
      const r = await api.action(`/api/deals/${dealId}/replied`, { note: v.note });
      toast(`Secuencia detenida (${r.cancelados} toques cancelados)`);
      await loadOutbound();
    },
  });
};

/* Agendar es el momento de mayor riesgo del embudo: entre el "sí, hablemos" y
 * la llamada se cae entre el 20 y el 30% de los que ya dijeron que sí. Por eso
 * al guardar la fecha el sistema saca la confirmación hoy y el recordatorio el
 * día antes, sin que haya que acordarse. */
App.actions['meeting-set'] = (el) => {
  const dealId = el.dataset.deal;
  const d = byId('deals', dealId);
  const url = (App.state.settings.outbound || {}).bookingUrl;
  openForm({
    title: `Agendar llamada — ${d ? clientName(d.clientId) : ''}`,
    intro: `Se cancela lo que quede de la secuencia de captación y se programan la confirmación (hoy) y el recordatorio (el día antes).${
      url ? ` Tu link de agenda: <code>${esc(url)}</code>` : ''
    }`,
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', value: addDays(today(), 2), required: true },
      { name: 'hora', label: 'Hora', type: 'time', value: '10:00', required: true },
      { name: 'notes', label: 'Notas', type: 'textarea', rows: 2, width: 2, placeholder: 'Qué dijo, quién decide, qué le duele.' },
    ],
    submitLabel: 'Agendar',
    onSubmit: async (v) => {
      const r = await api.action(`/api/deals/${dealId}/meeting`, { at: `${v.fecha}T${v.hora}`, notes: v.notes });
      toast(`Agendada. ${r.toques} mensaje(s) programados.`);
      await loadOutbound();
    },
  });
};

App.actions['meeting-result'] = (el) => {
  const dealId = el.dataset.deal;
  const m = (App.outbound.meetings || []).find((x) => x.dealId === dealId);
  openForm({
    title: `Resultado — ${m ? m.cliente : ''}`,
    intro: 'Sin esto no hay tasa de asistencia ni de conversión, y esos dos números dicen si estás agendando mal o vendiendo mal.',
    fields: [
      {
        name: 'status',
        label: '¿Qué pasó?',
        type: 'select',
        options: [
          { value: 'realizada', label: 'Se hizo' },
          { value: 'no-asistio', label: 'No asistió' },
          { value: 'reagendada', label: 'Se movió' },
          { value: 'cancelada', label: 'Se canceló' },
        ],
        value: 'realizada',
        width: 2,
      },
      { name: 'notes', label: 'El dolor en SUS palabras', type: 'textarea', rows: 4, width: 2, placeholder: 'Cópialo literal. Es lo que hace que la propuesta suene cierta.' },
    ],
    submitLabel: 'Guardar',
    onSubmit: async (v) => {
      await api.action(`/api/deals/${dealId}/meeting-result`, v);
      toast(v.status === 'realizada' ? 'Registrada. Manda la propuesta HOY.' : 'Registrada');
      await loadOutbound();
    },
  });
};

App.actions['outbox-view'] = (el) => {
  const m = (App.state.outbox || []).find((x) => x.id === el.dataset.id);
  if (!m) return;
  openPanel(
    `${m.clientName} · ${m.channel}`,
    `<p class="muted">Para: ${esc(m.to)}</p>
     ${m.subject ? `<p><strong>${esc(m.subject)}</strong></p>` : ''}
     <pre class="msg-body">${esc(m.body)}</pre>`
  );
};

App.actions['outbox-sent'] = async (el) => {
  await api.action(`/api/outbox/${el.dataset.id}/sent`, {});
  toast('Marcado como enviado');
  await refreshOutbound();
};

App.actions['outbox-del'] = async (el) => {
  await req('DELETE', `/api/outbox/${el.dataset.id}`);
  await refreshOutbound();
};

App.actions['outbox-send'] = async () => {
  const r = await api.action('/api/outbox/send', {});
  toast(`${r.enviados.length} enviado(s)${r.fallidos.length ? ` · ${r.fallidos.length} con error` : ''}`, r.fallidos.length ? 'error' : 'ok');
  await refreshOutbound();
};

// ---------------------------------------------------------------------------
// La auditoria
// ---------------------------------------------------------------------------

/* Busca el prospecto en la lista del día y, si no está ahí —porque quedó fuera
 * del corte de la meta o porque el botón salió desde la cola de mensajes—, lo
 * arma con el deal y el cliente del estado global. Antes el botón simplemente
 * no hacía nada, que es la peor forma de fallar. */
function prospectoDe(dealId) {
  const enLista = (App.outbound.recording || []).find((x) => x.dealId === dealId);
  if (enLista) return enLista;
  const d = byId('deals', dealId);
  if (!d) return null;
  const c = byId('clients', d.clientId) || {};
  return {
    dealId: d.id,
    clientId: c.id,
    name: c.name || d.title,
    city: c.city,
    phone: c.phone,
    email: c.email,
    website: c.website,
    instagram: c.instagram,
    audit: d.audit || {},
  };
}

App.actions['audit-script'] = (el) => {
  const p = prospectoDe(el.dataset.deal);
  if (!p) return toast('Ese prospecto ya no existe', 'error');
  const s = p.audit.script || { bloques: [], checklist: [] };
  const bloques = s.bloques
    .map(([tiempo, titulo, texto]) => `<tr><td class="num">${esc(tiempo)}</td><td><strong>${esc(titulo)}</strong><br>${esc(texto)}</td></tr>`)
    .join('');
  openPanel(
    `Guion — ${p.name}`,
    `<div class="table-wrap"><table class="data-table"><tbody>${bloques}</tbody></table></div>
     <h3 style="margin-top:20px">Antes de grabar</h3>
     <ul class="guide-list">${s.checklist.map((c) => `<li><span>${esc(c)}</span></li>`).join('')}</ul>`,
    btn('Registrar la auditoria', 'audit-log', { data: { deal: p.dealId }, cls: 'btn-primary' })
  );
};

/* Lo que se registra aqui no es burocracia: la observacion y la idea son las
 * variables que el toque 1 y el toque 2 necesitan para no salir con huecos. */
App.actions['audit-log'] = (el) => {
  const p = prospectoDe(el.dataset.deal);
  if (!p) return toast('Ese prospecto ya no existe', 'error');
  const a = p.audit || {};
  openForm({
    title: `Auditoria — ${p.name}`,
    wide: true,
    intro: 'La observacion y la idea entran directo en los mensajes de la secuencia.',
    fields: [
      { name: 'videoUrl', label: 'Enlace del video', value: a.videoUrl || '', width: 2, placeholder: 'Loom, Drive, YouTube sin listar…' },
      { name: 'creativeAgeDays', label: 'Dias sin rotar el creativo', type: 'number', value: a.creativeAgeDays || 0 },
      { name: 'adLibraryUrl', label: 'Biblioteca de anuncios', value: a.adLibraryUrl || '' },
      {
        name: 'observation',
        label: 'La observacion (va en el toque 1)',
        type: 'textarea',
        rows: 3,
        width: 2,
        value: a.observation || '',
        placeholder: 'Ej: Lleva 95 dias con el mismo anuncio de botox y le habla igual a todo el mundo.',
        required: true,
      },
      {
        name: 'idea',
        label: 'La idea aplicable (va en el toque 2)',
        type: 'textarea',
        rows: 3,
        width: 2,
        value: a.idea || '',
        placeholder: 'Ej: Separar el publico de primera visita del de recompra y cambiarle el titular a cada uno.',
        required: true,
      },
    ],
    submitLabel: 'Guardar y marcar grabada',
    onSubmit: async (v) => {
      const r = await api.action(`/api/deals/${p.dealId}/audit`, { ...v, status: 'grabada' });
      toast(
        r.reprogramados
          ? `Auditoria registrada — la secuencia se corrio a hoy (${r.reprogramados} toque(s))`
          : 'Auditoria registrada — el toque 1 ya tiene con que salir'
      );
      await loadOutbound();
    },
  });
};

/* Agregar un negocio sin pasar por el lote. El campo de texto acepta varias
 * líneas si aparecen tres de golpe; con una sola ficha basta el nombre. */
App.actions['audit-add'] = () => {
  const s = App.state.settings.outbound || {};
  openForm({
    title: 'Agregar negocio a la lista',
    wide: true,
    intro:
      'Entra directo a la lista de grabación, con su guion armado y su secuencia programada desde hoy. Para cargar muchos de una vez, usa el campo de abajo o la vista de Prospección.',
    fields: [
      { name: 'name', label: 'Negocio', width: 2, placeholder: 'Ej: Aurora Med Spa' },
      { name: 'contactName', label: 'Contacto' },
      { name: 'city', label: 'Ciudad', value: s.defaultCity || '' },
      { name: 'phone', label: 'Telefono / WhatsApp' },
      { name: 'email', label: 'Correo' },
      { name: 'website', label: 'Web' },
      { name: 'instagram', label: 'Instagram' },
      { name: 'adLibraryUrl', label: 'Biblioteca de anuncios', width: 2 },
      { name: 'creativeAgeDays', label: 'Dias sin rotar el creativo', type: 'number', value: 0 },
      { name: 'currency', label: 'Moneda', type: 'select', options: ['USD', 'COP', 'MXN'], value: 'USD' },
      { name: 'value', label: 'Valor de la oportunidad', type: 'number', value: 1800 },
      {
        name: 'sequenceId',
        label: 'Secuencia',
        type: 'select',
        options: (App.state.sequences || []).filter((x) => x.kind === 'outbound').map((x) => ({ value: x.id, label: x.name })),
        value: s.defaultSequenceId || 'seq-auditoria',
      },
      { name: 'enroll', type: 'checkbox', value: true, checkLabel: 'Inscribir en la secuencia desde hoy', width: 2 },
      {
        name: 'text',
        label: '…o pega varios de una vez',
        type: 'textarea',
        rows: 4,
        width: 2,
        placeholder: 'Una linea por negocio: nombre\tciudad\ttelefono\tcorreo\ncontacto. Si llenas esto, se ignora la ficha de arriba.',
        hint: 'Se deduplica igual que en Prospeccion: lo que ya existe no vuelve a entrar.',
      },
    ],
    submitLabel: 'Agregar',
    onSubmit: async (v) => {
      const r = await api.action('/api/prospecting/quick', v);
      const saltados = (r.saltados || []).length ? ` · ${r.saltados.length} saltado(s)` : '';
      toast(`${r.creados} negocio(s) en la lista${r.inscritos ? ` · ${r.inscritos} en secuencia` : ''}${saltados}`);
      await loadOutbound();
    },
  });
};

/* Descartar. El motivo no es burocracia: "contacto errado" se corrige y se
 * vuelve a cargar, "ya trabaja con otra agencia" se recontacta en un año, y
 * "datos basura" no debería volver a aparecer nunca. */
const MOTIVOS_DESCARTE = [
  'El contacto no sirve (telefono o correo errado)',
  'No hay datos reales del negocio',
  'No tiene anuncios activos',
  'Ya trabaja con otra agencia',
  'Cerro o no existe',
  'No es del nicho',
];

App.actions['audit-discard'] = (el) => {
  const p = prospectoDe(el.dataset.deal);
  if (!p) return toast('Ese prospecto ya no existe', 'error');
  openForm({
    title: `Descartar — ${p.name}`,
    intro:
      'Sale de la lista de grabación y del embudo, y se cancela lo que quede de su secuencia. Queda registrado como perdido con el motivo, que es lo que evita volver a cargarlo el mes entrante.',
    fields: [
      { name: 'reason', label: 'Motivo', type: 'select', options: MOTIVOS_DESCARTE, value: MOTIVOS_DESCARTE[0], width: 2 },
      { name: 'nota', label: 'Detalle (opcional)', width: 2, placeholder: 'Lo que quieras recordar si vuelve a aparecer.' },
      {
        name: 'purge',
        type: 'checkbox',
        value: false,
        width: 2,
        checkLabel: 'Borrarlo del todo, sin dejar registro (datos basura o duplicado)',
      },
    ],
    submitLabel: 'Descartar',
    onSubmit: async (v) => {
      const reason = [v.reason, v.nota].filter(Boolean).join(' — ');
      const r = await api.action(`/api/deals/${p.dealId}/discard`, { reason, purge: v.purge });
      toast(r.borrado ? `${r.nombre} eliminado` : `${r.nombre} descartado${r.cancelados ? ` · ${r.cancelados} toque(s) cancelados` : ''}`);
      await loadOutbound();
    },
  });
};

App.actions['recording-toggle'] = async () => {
  App.outbound.verTodas = !App.outbound.verTodas;
  await loadOutbound();
  render();
};

App.actions['audit-clean'] = () => {
  const n = App.outbound.sinContacto || 0;
  confirmAction(
    `${n} prospecto(s) no tienen telefono, correo, web ni instagram. Sin un solo dato no se les puede grabar ni escribir: ocupan la lista y no llevan a ninguna parte. Se descartan con motivo "Sin datos de contacto" y quedan registrados como perdidos.`,
    async () => {
      const r = await api.action('/api/automations/clean-prospects', { dias: 0 });
      toast(`${r.descartados.length} prospecto(s) descartado(s)${r.vencidas.length ? ` · ${r.vencidas.length} propuesta(s) vencida(s)` : ''}`);
      await loadOutbound();
    },
    'Descartarlos'
  );
};

// ---------------------------------------------------------------------------
// Prospeccion
// ---------------------------------------------------------------------------

App.views.prospeccion = {
  title: 'Prospeccion',
  sub: 'De un pegote de texto a prospectos con su secuencia programada. La lista se arma una vez; el sistema la reparte.',
  actions: () => btn('Ver embudo', 'funnel-open'),
  render() {
    const p = App.outbound.preview;
    const s = App.state.settings.outbound || {};

    const form = `<div class="form-grid">
      ${fieldHTML({
        name: 'batch',
        label: 'Pega el lote',
        type: 'textarea',
        rows: 10,
        width: 2,
        value: App.outbound.batchText || '',
        placeholder:
          'Una linea por negocio. Separadas por tabulador, barra vertical o coma.\n\nnombre\tciudad\ttelefono\temail\tcontacto\tdias\nAurora Med Spa\tHialeah\t786-555-0002\tana@aurora.com\tAna Restrepo\t95\n\nSi solo tienes los nombres, pega los nombres y ya.',
      })}
      ${fieldHTML({ name: 'city', label: 'Ciudad por defecto', value: 'Miami' })}
      ${fieldHTML({ name: 'currency', label: 'Moneda', type: 'select', options: ['USD', 'COP', 'MXN'], value: 'USD' })}
      ${fieldHTML({ name: 'value', label: 'Valor de la oportunidad', type: 'number', value: 1800 })}
      ${fieldHTML({
        name: 'sequenceId',
        label: 'Secuencia',
        type: 'select',
        options: (App.state.sequences || []).filter((x) => x.kind === 'outbound').map((x) => ({ value: x.id, label: x.name })),
        value: s.defaultSequenceId || 'seq-auditoria',
      })}
      ${fieldHTML({
        name: 'perDay',
        label: 'Prospectos por dia',
        type: 'number',
        value: s.dailyGoal || 10,
        hint: 'El lote se reparte a este ritmo para que no venzan todos el mismo dia.',
      })}
    </div>
    <div class="items-bar">
      ${btn('Revisar el lote', 'prospect-preview', { cls: 'btn-primary' })}
      ${p ? btn(`Importar ${p.resumen.nuevos} nuevo(s)`, 'prospect-import', { cls: 'btn-primary' }) : ''}
    </div>`;

    let revision = '';
    if (p) {
      const rows = p.items.map((it) => ({
        cells: [
          esc(it.row.name),
          esc(it.row.city || ''),
          esc(it.row.phone || it.row.email || ''),
          it.status === 'nuevo'
            ? badge('nuevo', 'green')
            : it.status === 'existe'
              ? `${badge('ya existe', 'amber')} <small class="muted">${esc(it.existingName)}</small>`
              : badge('repetido', 'gray'),
        ],
      }));
      revision = section(
        `Revision del lote · ${p.resumen.total} filas`,
        `<p class="muted">${p.resumen.nuevos} entran · ${p.resumen.existen} ya estaban en la base · ${p.resumen.repetidos} repetidos dentro del lote. Los que ya existen no se vuelven a escribir: volver a contactar a un negocio que ya esta en secuencia es el peor error posible.</p>
         ${table([{ label: 'Negocio' }, { label: 'Ciudad' }, { label: 'Contacto' }, { label: 'Estado' }], rows)}`
      );
    }

    return `${section('Importar prospectos', form)}${revision}${funnelSection()}`;
  },
};

/* El embudo medido de verdad. Los documentos declaran conversiones sanas; esto
 * muestra las que estan pasando, que es lo unico que permite corregir. */
function funnelSection() {
  const deals = App.state.deals.filter((d) => d.source === 'outbound');
  const conAudit = deals.filter((d) => d.audit && d.audit.status === 'grabada');
  const contactados = deals.filter((d) => Number(d.touchCount || 0) > 0);
  const respondieron = deals.filter((d) => d.repliedAt);
  const propuesta = deals.filter((d) => ['propuesta', 'negociacion', 'ganado'].includes(d.stage));
  const ganados = deals.filter((d) => d.stage === 'ganado');

  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  const rows = [
    ['Prospectos en la base', deals.length, '', ''],
    ['Auditoria grabada', conAudit.length, pct(conAudit.length, deals.length), ''],
    ['Contactados', contactados.length, pct(contactados.length, deals.length), ''],
    ['Respondieron', respondieron.length, pct(respondieron.length, contactados.length), '12-15%'],
    ['Con propuesta', propuesta.length, pct(propuesta.length, respondieron.length), '80%'],
    ['Cerrados', ganados.length, pct(ganados.length, propuesta.length), '30%'],
  ].map(([label, n, conv, sano]) => ({
    cells: [esc(label), `<strong>${n}</strong>`, esc(conv), sano ? `<span class="muted">${esc(sano)}</span>` : ''],
  }));

  return section(
    'Embudo real',
    table([{ label: 'Etapa' }, { label: 'Cantidad', align: 'right' }, { label: 'Conversion', align: 'right' }, { label: 'Sano', align: 'right' }], rows)
  );
}

App.actions['funnel-open'] = () => openPanel('Embudo real', funnelSection());

function prospectFormValues() {
  const get = (n) => {
    const el = document.querySelector(`[name="${n}"]`);
    return el ? el.value : '';
  };
  return {
    text: get('batch'),
    city: get('city'),
    currency: get('currency'),
    value: Number(get('value') || 0),
    sequenceId: get('sequenceId'),
    perDay: Number(get('perDay') || 10),
  };
}

App.actions['prospect-preview'] = async () => {
  const v = prospectFormValues();
  if (!v.text.trim()) return toast('Pega el lote primero', 'error');
  App.outbound.batchText = v.text;
  App.outbound.preview = await api.action('/api/prospecting/preview', { text: v.text });
  render();
};

App.actions['prospect-import'] = async () => {
  const v = prospectFormValues();
  const r = await api.action('/api/prospecting/import', v);
  App.outbound.preview = null;
  App.outbound.batchText = '';
  toast(`${r.importados} prospecto(s) importados · ${r.inscritos} en secuencia · repartidos en ${r.dias} dia(s)`);
  await refreshOutbound();
  go('hoy');
};
