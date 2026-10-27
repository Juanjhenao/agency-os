/* Agency OS — vistas comerciales: panel, CRM, clientes, servicios, onboarding y guía. */

const STAGES = [
  { id: 'nuevo', label: 'Nuevo', prob: 10 },
  { id: 'contactado', label: 'Contactado', prob: 20 },
  { id: 'reunion', label: 'Reunión', prob: 40 },
  { id: 'propuesta', label: 'Propuesta', prob: 60 },
  { id: 'negociacion', label: 'Negociación', prob: 75 },
  { id: 'ganado', label: 'Ganado', prob: 100 },
  { id: 'perdido', label: 'Perdido', prob: 0 },
];

const OPEN_STAGES = ['nuevo', 'contactado', 'reunion', 'propuesta', 'negociacion'];

// ---------------------------------------------------------------------------
// Métricas compartidas
// ---------------------------------------------------------------------------

function mrrCop() {
  return App.state.subscriptions
    .filter((s) => s.status === 'activa')
    .reduce((sum, s) => sum + toCop(s.amount, s.currency), 0);
}

function pipelineCop() {
  return App.state.deals
    .filter((d) => OPEN_STAGES.includes(d.stage))
    .reduce((sum, d) => sum + toCop(d.value, d.currency) * (Number(d.probability || 0) / 100), 0);
}

function receivableCop() {
  return App.state.invoices
    .filter((i) => i.status === 'enviada' || i.status === 'vencida')
    .reduce((sum, i) => sum + toCop(computeTotals(i).total, i.currency), 0);
}

function overdueInvoices() {
  return App.state.invoices.filter(
    (i) => (i.status === 'enviada' || i.status === 'vencida') && daysUntil(i.dueDate) < 0
  );
}

function activeClients() {
  return App.state.clients.filter((c) => c.status === 'activo');
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

App.views.panel = {
  title: 'Panel',
  sub: 'El estado real del negocio en una pantalla.',
  actions: () => btn('+ Oportunidad', 'deal-new', { cls: 'btn-primary' }),
  render() {
    const s = App.state;
    const mrr = mrrCop();
    const goal = Number(s.settings.goals.targetMrrCop || 0);
    const overdue = overdueInvoices();
    const activos = activeClients();

    // Concentración: qué tanto pesa el cliente más grande sobre el MRR.
    const perClient = {};
    s.subscriptions
      .filter((x) => x.status === 'activa')
      .forEach((x) => {
        perClient[x.clientId] = (perClient[x.clientId] || 0) + toCop(x.amount, x.currency);
      });
    const top = Object.entries(perClient).sort((a, b) => b[1] - a[1])[0];
    const concentration = top && mrr ? Math.round((top[1] / mrr) * 100) : 0;

    const kpis = `<div class="kpi-row">
      ${kpi('MRR consolidado', fmtShort(mrr, 'COP'), goal ? `meta ${fmtShort(goal, 'COP')} · ${Math.round((mrr / goal) * 100)}%` : '', 'green')}
      ${kpi('Pipeline ponderado', fmtShort(pipelineCop(), 'COP'), `${s.deals.filter((d) => OPEN_STAGES.includes(d.stage)).length} oportunidades abiertas`, 'blue')}
      ${kpi('Por cobrar', fmtShort(receivableCop(), 'COP'), overdue.length ? `${overdue.length} vencida(s)` : 'al día', overdue.length ? 'red' : '')}
      ${kpi('Clientes activos', String(activos.length), `${s.clients.length} en base`, '')}
      ${kpi('Concentración', concentration ? `${concentration}%` : '—', top ? `mayor: ${esc(clientName(top[0]))}` : 'sin suscripciones', concentration > 40 ? 'red' : '')}
    </div>`;

    // --- Acciones de hoy -----------------------------------------------------
    const items = [];

    s.deals
      .filter((d) => OPEN_STAGES.includes(d.stage) && d.nextActionDate && daysUntil(d.nextActionDate) <= 0)
      .forEach((d) => {
        const late = -daysUntil(d.nextActionDate);
        items.push({
          tone: late > 0 ? 'red' : 'blue',
          label: late > 0 ? `Seguimiento atrasado ${late}d` : 'Seguimiento hoy',
          text: `${esc(d.title)} — ${esc(clientName(d.clientId))}: ${esc(d.nextAction || 'definir siguiente paso')}`,
          action: btn('Abrir', 'deal-edit', { data: { id: d.id }, small: true }),
        });
      });

    overdue.forEach((i) => {
      items.push({
        tone: 'red',
        label: `Factura vencida ${-daysUntil(i.dueDate)}d`,
        text: `${esc(i.number)} — ${esc(clientName(i.clientId))} · ${esc(fmtMoney(computeTotals(i).total, i.currency))}`,
        action: btn('Cobrar', 'invoice-open', { data: { id: i.id }, small: true }),
      });
    });

    s.subscriptions
      .filter((x) => x.status === 'activa' && daysUntil(x.nextInvoiceDate) <= 0)
      .forEach((x) => {
        items.push({
          tone: 'amber',
          label: 'Facturar suscripción',
          text: `${esc(clientName(x.clientId))} — ${esc(x.planName)} · ${esc(fmtMoney(x.amount, x.currency))}`,
          action: btn('Generar factura', 'sub-invoice', { data: { id: x.id }, small: true, cls: 'btn-primary' }),
        });
      });

    s.proposals
      .filter((p) => p.status === 'enviada' && p.sentAt && -daysUntil(p.sentAt.slice(0, 10)) >= 3)
      .forEach((p) => {
        items.push({
          tone: 'amber',
          label: `Propuesta sin respuesta ${-daysUntil(p.sentAt.slice(0, 10))}d`,
          text: `${esc(p.number)} — ${esc(clientName(p.clientId))} · ${esc(fmtMoney(computeTotals(p).total, p.currency))}`,
          action: btn('Abrir', 'proposal-open', { data: { id: p.id }, small: true }),
        });
      });

    s.contracts
      .filter((c) => c.status !== 'firmado' && c.status !== 'terminado')
      .forEach((c) => {
        items.push({
          tone: 'blue',
          label: 'Contrato sin firmar',
          text: `${esc(c.number)} — ${esc(clientName(c.clientId))}`,
          action: btn('Abrir', 'contract-open', { data: { id: c.id }, small: true }),
        });
      });

    s.onboardings.forEach((ob) => {
      const pending = ob.steps.filter((st) => !st.done).length;
      if (pending && ob.steps.some((st) => st.done)) {
        items.push({
          tone: 'blue',
          label: `Onboarding ${ob.steps.length - pending}/${ob.steps.length}`,
          text: `${esc(clientName(ob.clientId))} — siguiente: ${esc((ob.steps.find((st) => !st.done) || {}).label || '')}`,
          action: btn('Abrir', 'go-onboarding', { small: true }),
        });
      }
    });

    const todo = items.length
      ? `<ul class="todo-list">${items
          .map(
            (i) => `<li class="todo todo-${i.tone}">
              <span class="todo-tag">${esc(i.label)}</span>
              <span class="todo-text">${i.text}</span>
              ${i.action}
            </li>`
          )
          .join('')}</ul>`
      : emptyState('Nada urgente. Usa el tiempo en prospección: 5 contactos nuevos hoy.');

    // --- Prospección de hoy --------------------------------------------------
    const meta = Number(s.settings.goals.dailyProspects || 5);
    const hechos = s.deals.filter((d) => (d.createdAt || '').slice(0, 10) === today()).length;
    const pct = Math.min(100, Math.round((hechos / meta) * 100));
    const prospect = `<div class="prospect">
      <div class="prospect-head"><span>Prospección de hoy</span><strong>${hechos} / ${meta}</strong></div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <p class="muted">Cada contacto nuevo entra como oportunidad con próxima acción y fecha. Sin fecha, no existe.</p>
      ${btn('+ Registrar contacto', 'deal-new', { cls: 'btn-primary', small: true })}
    </div>`;

    return `${kpis}
      <div class="cols-2">
        ${section('Acciones de hoy', todo)}
        <div class="stack">
          ${section('Ritmo comercial', prospect)}
          ${section('Embudo', funnelHTML())}
        </div>
      </div>`;
  },
};

function funnelHTML() {
  const counts = STAGES.filter((s) => OPEN_STAGES.includes(s.id)).map((s) => ({
    label: s.label,
    n: App.state.deals.filter((d) => d.stage === s.id).length,
  }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  return `<ul class="funnel">${counts
    .map(
      (c) => `<li><span>${esc(c.label)}</span>
        <div class="bar"><div class="bar-fill" style="width:${Math.round((c.n / max) * 100)}%"></div></div>
        <strong>${c.n}</strong></li>`
    )
    .join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

App.views.crm = {
  title: 'CRM',
  sub: 'Ninguna oportunidad sin próxima acción con fecha.',
  actions: () => btn('+ Oportunidad', 'deal-new', { cls: 'btn-primary' }),
  render() {
    const cols = STAGES.map((st) => {
      const deals = App.state.deals.filter((d) => d.stage === st.id);
      const value = deals.reduce((s, d) => s + toCop(d.value, d.currency), 0);
      const cards = deals
        .map((d) => {
          const late = d.nextActionDate ? daysUntil(d.nextActionDate) : null;
          const lateCls = late === null ? '' : late < 0 ? 'late' : late === 0 ? 'due' : '';
          return `<article class="deal ${lateCls}" data-act="deal-edit" data-id="${d.id}">
            <h4>${esc(d.title)}</h4>
            <p class="deal-client">${esc(clientName(d.clientId))}</p>
            <p class="deal-value">${esc(fmtMoney(d.value, d.currency))} · ${Number(d.probability || 0)}%</p>
            ${d.nextAction ? `<p class="deal-next">▸ ${esc(d.nextAction)}<br><small>${esc(fmtDate(d.nextActionDate))}</small></p>` : '<p class="deal-next muted">▸ sin próxima acción</p>'}
            <div class="deal-move">
              <button class="icon-btn" data-act="deal-move" data-id="${d.id}" data-dir="-1" title="Etapa anterior">‹</button>
              <button class="icon-btn" data-act="deal-move" data-id="${d.id}" data-dir="1" title="Etapa siguiente">›</button>
            </div>
          </article>`;
        })
        .join('');
      return `<div class="kanban-col">
        <header><span>${esc(st.label)}</span><em>${deals.length}</em></header>
        <div class="kanban-sum">${esc(fmtShort(value, 'COP'))}</div>
        <div class="kanban-body">${cards || '<p class="muted kanban-empty">—</p>'}</div>
      </div>`;
    }).join('');
    return `<div class="kanban">${cols}</div>`;
  },
};

function dealFields(d) {
  const v = d || {};
  return [
    { name: 'title', label: 'Oportunidad', value: v.title || '', required: true, width: 2, placeholder: 'Ej: Retainer de ads — Q4' },
    { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), value: v.clientId || '' },
    { name: 'newClientName', label: '…o cliente nuevo', value: '', hint: 'Si lo llenas, se crea el cliente como lead.' },
    { name: 'value', label: 'Valor', type: 'number', value: v.value || 0 },
    { name: 'currency', label: 'Moneda', type: 'select', options: ['COP', 'USD', 'MXN'], value: v.currency || 'COP' },
    { name: 'stage', label: 'Etapa', type: 'select', options: STAGES.map((s) => ({ value: s.id, label: s.label })), value: v.stage || 'nuevo' },
    { name: 'probability', label: 'Probabilidad %', type: 'number', value: v.probability ?? 10 },
    { name: 'expectedCloseDate', label: 'Cierre estimado', type: 'date', value: v.expectedCloseDate || addDays(today(), 15) },
    { name: 'source', label: 'Origen', type: 'select', options: ['referido', 'cercano', 'cliente-anterior', 'outbound', 'contenido', 'otro'], value: v.source || 'outbound' },
    { name: 'nextAction', label: 'Próxima acción', value: v.nextAction || '', width: 2, required: true, placeholder: 'Ej: llamar para agendar diagnóstico' },
    { name: 'nextActionDate', label: 'Fecha próxima acción', type: 'date', value: v.nextActionDate || today(), required: true },
    { name: 'notes', label: 'Notas', type: 'textarea', value: v.notes || '', width: 2 },
  ];
}

async function resolveClientId(values) {
  if (values.newClientName && values.newClientName.trim()) {
    const c = await api.create('clients', {
      name: values.newClientName.trim(),
      status: 'lead',
      currency: values.currency || 'COP',
      country: values.currency === 'USD' ? '' : 'Colombia',
      source: values.source || '',
    });
    return c.id;
  }
  return values.clientId || '';
}

App.actions = App.actions || {};

const NOMBRE_COLECCION = {
  deals: 'oportunidad(es)',
  proposals: 'propuesta(s)',
  contracts: 'contrato(s)',
  subscriptions: 'suscripción(es)',
  invoices: 'factura(s)',
  onboardings: 'onboarding(s)',
  briefs: 'brief(s)',
  productions: 'mes(es) de producción',
  pieces: 'pieza(s)',
  reports: 'reporte(s)',
  diagnostics: 'diagnóstico(s)',
};

/* Borrar un cliente con historia se lleva contratos firmados y facturas
 * cobradas. Se muestra exactamente qué se pierde antes de dejarlo pasar. */
function confirmarBorradoTotal(c, deps) {
  const lista = Object.entries(deps)
    .map(([col, n]) => `<li><strong>${n}</strong> ${esc(NOMBRE_COLECCION[col] || col)}</li>`)
    .join('');
  openForm({
    title: `Eliminar ${c.name} y todo lo suyo`,
    intro: `Este cliente no está solo. Si continúas se borra también:<ul class="mini-list">${lista}</ul>
            <p class="warn">No hay deshacer desde la app. Sí queda copia del estado anterior en <code>Agency\\.respaldos\\</code>.</p>`,
    fields: [
      {
        name: 'confirmacion',
        label: `Escribe el nombre del cliente para confirmar`,
        required: true,
        width: 2,
        placeholder: c.name,
      },
    ],
    submitLabel: 'Eliminar todo',
    onSubmit: async (v) => {
      if (String(v.confirmacion || '').trim().toLowerCase() !== c.name.trim().toLowerCase()) {
        throw new Error('El nombre no coincide. No se borró nada.');
      }
      await req('DELETE', `/api/clients/${c.id}?cascade=1`);
      toast(`${c.name} y sus documentos fueron eliminados`);
    },
  });
}

App.actions['deal-new'] = () =>
  openForm({
    title: 'Nueva oportunidad',
    wide: true,
    fields: dealFields(null),
    onSubmit: async (v) => {
      v.clientId = await resolveClientId(v);
      delete v.newClientName;
      await api.create('deals', v);
      toast('Oportunidad creada');
    },
  });

App.actions['deal-edit'] = (el) => {
  const d = byId('deals', el.dataset.id);
  if (!d) return;
  openForm({
    title: `Oportunidad — ${d.title}`,
    wide: true,
    fields: dealFields(d),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('deals', d.id);
        toast('Oportunidad eliminada');
      },
    },
    onSubmit: async (v) => {
      v.clientId = await resolveClientId(v);
      delete v.newClientName;
      if (v.stage === 'ganado' && d.stage !== 'ganado') {
        await api.update('deals', d.id, v);
        await api.action(`/api/deals/${d.id}/win`);
        toast('Cerrado como ganado. El cliente pasó a activo.');
        return;
      }
      await api.update('deals', d.id, v);
      toast('Oportunidad actualizada');
    },
  });
};

App.actions['deal-move'] = async (el, ev) => {
  ev.stopPropagation();
  const d = byId('deals', el.dataset.id);
  const idx = STAGES.findIndex((s) => s.id === d.stage);
  const next = STAGES[Math.max(0, Math.min(STAGES.length - 1, idx + Number(el.dataset.dir)))];
  if (next.id === 'ganado') {
    await api.update('deals', d.id, { stage: 'ganado', probability: 100 });
    await api.action(`/api/deals/${d.id}/win`);
  } else {
    await api.update('deals', d.id, { stage: next.id, probability: next.prob });
  }
  await refresh();
};

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

App.views.clientes = {
  title: 'Clientes',
  sub: 'Ficha 360: todo lo comercial de cada cuenta en un solo lugar.',
  actions: () => btn('+ Cliente', 'client-new', { cls: 'btn-primary' }),
  render() {
    if (App.ctx.clientId) return clientDetail(App.ctx.clientId);
    const rows = sortBy(App.state.clients, 'name').map((c) => {
      const mrr = App.state.subscriptions
        .filter((s) => s.clientId === c.id && s.status === 'activa')
        .reduce((sum, s) => sum + toCop(s.amount, s.currency), 0);
      const due = App.state.invoices
        .filter((i) => i.clientId === c.id && (i.status === 'enviada' || i.status === 'vencida'))
        .reduce((sum, i) => sum + toCop(computeTotals(i).total, i.currency), 0);
      return {
        cells: [
          `<a class="link" data-act="client-open" data-id="${c.id}">${esc(c.name)}</a>`,
          badge(c.status || 'lead'),
          esc(c.contactName || '—'),
          esc(c.country || '—'),
          esc(c.currency || '—'),
          mrr ? esc(fmtShort(mrr, 'COP')) : '—',
          due ? `<span class="warn">${esc(fmtShort(due, 'COP'))}</span>` : '—',
        ],
      };
    });
    return table(
      [
        { label: 'Cliente' },
        { label: 'Estado' },
        { label: 'Contacto' },
        { label: 'País' },
        { label: 'Moneda' },
        { label: 'MRR', align: 'right' },
        { label: 'Por cobrar', align: 'right' },
      ],
      rows,
      'Sin clientes todavía. Carga primero los 20 contactos que ya conoces.'
    );
  },
};

function clientDetail(id) {
  const c = byId('clients', id);
  if (!c) {
    App.ctx.clientId = null;
    return '';
  }
  const deals = App.state.deals.filter((d) => d.clientId === id);
  const props = App.state.proposals.filter((p) => p.clientId === id);
  const contracts = App.state.contracts.filter((x) => x.clientId === id);
  const subs = App.state.subscriptions.filter((x) => x.clientId === id);
  const invs = sortBy(App.state.invoices.filter((i) => i.clientId === id), 'issueDate', 'desc');
  const ob = App.state.onboardings.find((o) => o.clientId === id);
  const paid = invs.filter((i) => i.status === 'pagada').reduce((s, i) => s + toCop(computeTotals(i).total, i.currency), 0);

  const info = `<div class="detail-grid">
    <div><span>Razón social</span><strong>${esc(c.legalName || '—')}</strong></div>
    <div><span>${esc(c.taxIdLabel || 'NIT')}</span><strong>${esc(c.taxId || '—')}</strong></div>
    <div><span>Contacto</span><strong>${esc(c.contactName || '—')}</strong></div>
    <div><span>Email</span><strong>${esc(c.email || '—')}</strong></div>
    <div><span>Teléfono</span><strong>${esc(c.phone || '—')}</strong></div>
    <div><span>País / ciudad</span><strong>${esc([c.city, c.country].filter(Boolean).join(', ') || '—')}</strong></div>
    <div><span>Moneda</span><strong>${esc(c.currency || 'COP')}</strong></div>
    <div><span>Origen</span><strong>${esc(c.source || '—')}</strong></div>
    <div><span>Facturado histórico</span><strong>${esc(fmtShort(paid, 'COP'))}</strong></div>
  </div>${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ''}`;

  const listOr = (arr, fn, msg) => (arr.length ? `<ul class="mini-list">${arr.map(fn).join('')}</ul>` : `<p class="muted">${msg}</p>`);

  return `<div class="detail">
    <div class="detail-head">
      ${btn('‹ Volver', 'client-back')}
      <h2>${esc(c.name)} ${badge(c.status || 'lead')}</h2>
      <div class="spacer"></div>
      ${btn('Editar', 'client-edit', { data: { id: c.id } })}
      ${ob ? '' : btn('Iniciar onboarding', 'onboarding-start', { data: { id: c.id }, cls: 'btn-primary' })}
      ${btn('+ Propuesta', 'proposal-new', { data: { client: c.id }, cls: 'btn-primary' })}
    </div>
    ${section('Datos', info)}
    <div class="cols-2">
      ${section(
        'Oportunidades',
        listOr(deals, (d) => `<li><a data-act="deal-edit" data-id="${d.id}" class="link">${esc(d.title)}</a> ${badge(d.stage)} <em>${esc(fmtMoney(d.value, d.currency))}</em></li>`, 'Sin oportunidades.')
      )}
      ${section(
        'Propuestas',
        listOr(props, (p) => `<li><a data-act="proposal-open" data-id="${p.id}" class="link">${esc(p.number)}</a> ${badge(p.status)} <em>${esc(fmtMoney(computeTotals(p).total, p.currency))}</em></li>`, 'Sin propuestas.')
      )}
      ${section(
        'Contratos',
        listOr(contracts, (x) => `<li><a data-act="contract-open" data-id="${x.id}" class="link">${esc(x.number)}</a> ${badge(x.status)} <em>${esc(x.type)}</em></li>`, 'Sin contratos.')
      )}
      ${section(
        'Suscripciones',
        listOr(subs, (x) => `<li>${esc(x.planName)} ${badge(x.status)} <em>${esc(fmtMoney(x.amount, x.currency))}/mes</em> · próx. ${esc(fmtDate(x.nextInvoiceDate))}</li>`, 'Sin suscripciones activas.')
      )}
    </div>
    ${section(
      'Facturas',
      table(
        [{ label: 'Número' }, { label: 'Emisión' }, { label: 'Vence' }, { label: 'Estado' }, { label: 'Total', align: 'right' }],
        invs.map((i) => ({
          cells: [
            `<a class="link" data-act="invoice-open" data-id="${i.id}">${esc(i.number)}</a>`,
            esc(fmtDate(i.issueDate)),
            esc(fmtDate(i.dueDate)),
            badge(i.status),
            esc(fmtMoney(computeTotals(i).total, i.currency)),
          ],
        })),
        'Sin facturas.'
      )
    )}
    ${ob ? section('Onboarding', onboardingBlock(ob)) : ''}
  </div>`;
}

function clientFields(c) {
  const v = c || {};
  return [
    { name: 'name', label: 'Nombre comercial', value: v.name || '', required: true, width: 2 },
    { name: 'status', label: 'Estado', type: 'select', options: ['lead', 'activo', 'pausado', 'perdido'], value: v.status || 'lead' },
    { name: 'currency', label: 'Moneda de facturación', type: 'select', options: ['COP', 'USD', 'MXN'], value: v.currency || 'COP' },
    { name: 'legalName', label: 'Razón social', value: v.legalName || '', width: 2 },
    { name: 'taxIdLabel', label: 'Tipo de ID', type: 'select', options: ['NIT', 'CC', 'RFC', 'EIN', 'VAT'], value: v.taxIdLabel || 'NIT' },
    { name: 'taxId', label: 'Identificación', value: v.taxId || '' },
    { name: 'contactName', label: 'Persona de contacto', value: v.contactName || '' },
    { name: 'email', label: 'Email', type: 'email', value: v.email || '' },
    { name: 'phone', label: 'Teléfono', value: v.phone || '' },
    { name: 'city', label: 'Ciudad', value: v.city || '' },
    { name: 'country', label: 'País', value: v.country || 'Colombia' },
    { name: 'source', label: 'Origen', type: 'select', options: ['referido', 'cercano', 'cliente-anterior', 'outbound', 'contenido', 'otro'], value: v.source || 'outbound' },
    { name: 'notes', label: 'Notas', type: 'textarea', value: v.notes || '', width: 2 },
  ];
}

App.actions['client-new'] = () =>
  openForm({
    title: 'Nuevo cliente',
    wide: true,
    fields: clientFields(null),
    onSubmit: async (v) => {
      await api.create('clients', v);
      toast('Cliente creado');
    },
  });

App.actions['client-edit'] = (el) => {
  const c = byId('clients', el.dataset.id);
  openForm({
    title: `Editar — ${c.name}`,
    wide: true,
    fields: clientFields(c),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        const deps = (await req('GET', `/api/clients/${c.id}/dependencies`)).dependencias;
        const total = Object.values(deps).reduce((s, n) => s + n, 0);
        if (!total) {
          await api.remove('clients', c.id);
          App.ctx.clientId = null;
          return toast('Cliente eliminado');
        }
        /* Tiene documentos colgando. El servidor rechaza el borrado simple; se
         * pide confirmación con la lista de lo que se perdería. El modal se
         * abre después del ciclo actual porque el que lo llamó va a cerrar el
         * suyo apenas esta función retorne. */
        App.ctx.clientId = null;
        setTimeout(() => confirmarBorradoTotal(c, deps), 0);
      },
    },
    onSubmit: async (v) => {
      await api.update('clients', c.id, v);
      toast('Cliente actualizado');
    },
  });
};

App.actions['client-open'] = (el) => {
  // Se asigna después de fijar la vista: go() limpia el cliente seleccionado al cambiar de sección.
  App.view = 'clientes';
  App.ctx.clientId = el.dataset.id;
  render();
};

App.actions['client-back'] = () => {
  App.ctx.clientId = null;
  render();
};

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

App.views.servicios = {
  title: 'Servicios',
  sub: 'Oferta empaquetada con precio fijo. Si no está aquí, no se vende.',
  actions: () => btn('+ Servicio', 'service-new', { cls: 'btn-primary' }),
  render() {
    const cards = sortBy(App.state.services, 'order')
      .map(
        (s) => `<article class="service ${s.active === false ? 'off' : ''}">
        <header>
          <h3>${esc(s.name)}</h3>
          ${badge(s.billing === 'retainer' ? 'retainer' : s.billing === 'suscripcion' ? 'suscripción' : 'proyecto', s.billing === 'proyecto' ? 'blue' : 'green')}
        </header>
        <p class="service-desc">${esc(s.description || '')}</p>
        <ul class="service-deliv">${(s.deliverables || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
        <footer>
          <div class="service-price"><strong>${esc(fmtMoney(s.priceCOP, 'COP'))}</strong><span>${esc(fmtMoney(s.priceUSD, 'USD'))}</span></div>
          ${btn('Editar', 'service-edit', { data: { id: s.id }, small: true })}
        </footer>
      </article>`
      )
      .join('');
    return `<div class="services-grid">${cards}</div>`;
  },
};

function serviceFields(s) {
  const v = s || {};
  return [
    { name: 'name', label: 'Nombre', value: v.name || '', required: true, width: 2 },
    { name: 'billing', label: 'Modalidad', type: 'select', options: [{ value: 'retainer', label: 'Retainer mensual' }, { value: 'suscripcion', label: 'Suscripción' }, { value: 'proyecto', label: 'Proyecto' }], value: v.billing || 'retainer' },
    { name: 'category', label: 'Categoría', type: 'select', options: ['entrada', 'ads', 'contenido', 'video', 'automatizacion', 'otro'], value: v.category || 'ads' },
    { name: 'priceCOP', label: 'Precio COP', type: 'number', value: v.priceCOP || 0 },
    { name: 'priceUSD', label: 'Precio USD', type: 'number', value: v.priceUSD || 0 },
    { name: 'description', label: 'Promesa (una línea)', type: 'textarea', rows: 2, value: v.description || '', width: 2 },
    { name: 'deliverables', label: 'Entregables', type: 'lines', value: v.deliverables || [], rows: 5, width: 2, hint: 'Uno por línea. Esto es lo que aparece en la propuesta.' },
    { name: 'active', label: 'Disponible', type: 'checkbox', checkLabel: 'Se puede vender', value: v.active !== false },
  ];
}

App.actions['service-new'] = () =>
  openForm({
    title: 'Nuevo servicio',
    wide: true,
    fields: serviceFields(null),
    onSubmit: async (v) => {
      v.order = App.state.services.length;
      await api.create('services', v);
      toast('Servicio creado');
    },
  });

App.actions['service-edit'] = (el) => {
  const s = byId('services', el.dataset.id);
  openForm({
    title: `Editar — ${s.name}`,
    wide: true,
    fields: serviceFields(s),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('services', s.id);
        toast('Servicio eliminado');
      },
    },
    onSubmit: async (v) => {
      await api.update('services', s.id, v);
      toast('Servicio actualizado');
    },
  });
};

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

App.views.onboarding = {
  title: 'Onboarding',
  sub: 'Los primeros 14 días deciden si el cliente se queda un año.',
  actions: () => btn('Editar plantilla', 'onboarding-template'),
  render() {
    if (!App.state.onboardings.length)
      return emptyState(
        'Ningún onboarding activo. Se inicia desde la ficha del cliente cuando el contrato queda firmado.',
        btn('Ir a clientes', 'go-clientes', { cls: 'btn-primary' })
      );
    return App.state.onboardings
      .map((ob) => section(clientName(ob.clientId), onboardingBlock(ob), btn('Eliminar', 'onboarding-del', { data: { id: ob.id }, small: true })))
      .join('');
  },
};

function onboardingBlock(ob) {
  const done = ob.steps.filter((s) => s.done).length;
  const pct = Math.round((done / ob.steps.length) * 100);
  return `<div class="onboard">
    <div class="onboard-head"><span>Inició ${esc(fmtDate(ob.startedAt))}</span><strong>${done}/${ob.steps.length}</strong></div>
    <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
    <ul class="checklist">${ob.steps
      .map(
        (st) => `<li class="${st.done ? 'done' : ''}">
        <label><input type="checkbox" data-act="onboarding-step" data-id="${ob.id}" data-step="${st.id}" ${st.done ? 'checked' : ''}>
        <span>${esc(st.label)}</span></label>
        ${st.done && st.doneAt ? `<em>${esc(fmtDate(st.doneAt))}</em>` : ''}
      </li>`
      )
      .join('')}</ul>
  </div>`;
}

App.actions['onboarding-start'] = async (el) => {
  await api.action(`/api/clients/${el.dataset.id}/onboarding`);
  toast('Onboarding iniciado');
  await refresh();
};

App.actions['onboarding-step'] = async (el) => {
  const ob = byId('onboardings', el.dataset.id);
  const step = ob.steps.find((s) => s.id === el.dataset.step);
  step.done = el.checked;
  step.doneAt = el.checked ? today() : '';
  await api.update('onboardings', ob.id, { steps: ob.steps });
  await refresh();
};

App.actions['onboarding-del'] = (el) =>
  confirmAction('¿Eliminar este onboarding? El historial de pasos se pierde.', async () => {
    await api.remove('onboardings', el.dataset.id);
    toast('Onboarding eliminado');
  });

App.actions['onboarding-template'] = () =>
  openForm({
    title: 'Plantilla de onboarding',
    intro: 'Se aplica a los onboardings nuevos. Los que ya están en curso no cambian.',
    fields: [{ name: 'steps', type: 'lines', label: 'Pasos', value: App.state.onboardingTemplate, rows: 12, width: 2 }],
    wide: true,
    onSubmit: async (v) => {
      await api.onboardingTemplate(v.steps);
      toast('Plantilla actualizada');
    },
  });

App.actions['go-onboarding'] = () => go('onboarding');
App.actions['go-clientes'] = () => go('clientes');

// ---------------------------------------------------------------------------
// Guía
// ---------------------------------------------------------------------------

App.views.guia = {
  title: 'Guía',
  sub: 'Qué hacer con este sistema, en orden.',
  actions: () => '',
  render() {
    const semanas = [
      ['Semana 1 — Cargar la máquina', 'Ajustes con datos fiscales reales. Revisar precios del catálogo. Cargar en el CRM los 20 contactos que ya conoces.'],
      ['Semana 2 — Prospección', '5 contactos nuevos al día, todos con próxima acción y fecha. Objetivo: 3 reuniones.'],
      ['Semana 3 — Propuestas', 'Cada reunión se convierte en propuesta el mismo día. Vigencia 7 días para forzar decisión.'],
      ['Semana 4 — Cerrar', 'Contrato desde la propuesta aceptada → suscripción activa → primera factura → onboarding.'],
    ];
    const reglas = [
      'Nunca cotices sin haber oído el dolor en las palabras del cliente.',
      'Anticipo siempre: retainer por mes adelantado, proyecto 50% para arrancar.',
      'Sin pago no hay accesos. El onboarding arranca con la factura en pagada.',
      'Si cierras más del 70% de tus propuestas, estás barato: sube precio cada 3 clientes.',
      'Descuento solo a cambio de algo: permanencia, pago anticipado, caso de estudio o referido.',
      'Ningún cliente debe pasar del 40% del MRR. El panel te avisa en rojo.',
    ];
    const secuencia = [
      ['Día 0', 'Observación específica de su negocio + una pregunta. Sin pitch, sin link.'],
      ['Día 2', 'Valor gratis: una idea concreta que puede aplicar hoy.'],
      ['Día 5', 'Prueba: caso o mini-demo de 30 segundos.'],
      ['Día 8', 'Oferta directa del diagnóstico.'],
      ['Día 12', 'Cierre de ciclo: "¿lo dejo para más adelante?" — el que más respuestas genera.'],
    ];
    return `<div class="cols-2">
      ${section('Los primeros 30 días', `<ol class="guide-list">${semanas.map(([t, d]) => `<li><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join('')}</ol>`)}
      ${section('Secuencia de contacto (5 toques / 12 días)', `<ol class="guide-list">${secuencia.map(([t, d]) => `<li><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join('')}</ol>`)}
    </div>
    ${section('Reglas que no se negocian', `<ul class="rules">${reglas.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`)}
    ${section(
      'Cómo se conecta con tus agentes',
      `<pre class="flow">Lead → CRM → Propuesta → Contrato firmado → Suscripción → Factura mensual
                                    ↓
                              Onboarding (checklist)
                                    ↓
                    Proyecto en task-manager (vault Projects\\)
                                    ↓
              Entrega con ads-copywriter (vault Ads\\)</pre>
      <p class="muted">Agency OS es la capa comercial; los agentes son la capa de producción. Todo vive en el mismo vault de Obsidian, en <code>Agency\\</code>.</p>`
    )}`;
  },
};
