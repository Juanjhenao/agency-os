/* Agency OS — capa de producción: briefs, plan mensual de entregables, piezas y reportes. */

// El video no se aprueba, se produce: tiene su propio recorrido.
const PIECE_FLOWS = {
  default: ['borrador', 'en-revision', 'aprobado', 'publicado'],
  video: ['idea', 'guion', 'grabado', 'editado', 'publicado'],
};
const PIECE_TONE = {
  borrador: 'gray',
  idea: 'gray',
  'en-revision': 'amber',
  guion: 'amber',
  grabado: 'blue',
  aprobado: 'blue',
  editado: 'green',
  publicado: 'green',
};

function flowOf(piece) {
  return PIECE_FLOWS[piece && piece.type === 'video' ? 'video' : 'default'];
}

function nextStatus(piece) {
  const flow = flowOf(piece);
  const i = flow.indexOf(piece.status);
  return i === -1 ? flow[0] : flow[i + 1];
}

// Entregado = uno de los dos estados finales del flujo de esa pieza.
function isDelivered(piece) {
  const flow = flowOf(piece);
  return flow.indexOf(piece.status) >= flow.length - 2;
}

function currentMonth() {
  return today().slice(0, 7);
}

function monthLabel(m) {
  if (!m) return '—';
  const [y, mm] = m.split('-');
  const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${names[Number(mm) - 1] || mm} ${y}`;
}

function piecesOf(productionId) {
  return App.state.pieces.filter((p) => p.productionId === productionId);
}

// Un compromiso se cumple con piezas entregadas: el borrador o el guion no cuentan.
function commitmentDone(productionId, commitmentId) {
  return piecesOf(productionId).filter((p) => p.commitmentId === commitmentId && isDelivered(p)).length;
}

function productionProgress(prod) {
  const target = (prod.commitments || []).reduce((s, c) => s + Number(c.target || 0), 0);
  const done = (prod.commitments || []).reduce((s, c) => s + Math.min(commitmentDone(prod.id, c.id), Number(c.target || 0)), 0);
  return { target, done, pct: target ? Math.round((done / target) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Producción
// ---------------------------------------------------------------------------

App.views.produccion = {
  title: 'Producción',
  sub: 'Lo que el contrato prometió, contado pieza por pieza.',
  actions: () => `${btn('+ Marca personal', 'production-personal')} ${btn('+ Mes de producción', 'production-new', { cls: 'btn-primary' })}`,
  render() {
    const prods = App.state.productions.slice().sort((a, b) => (a.month < b.month ? 1 : -1));
    if (!prods.length)
      return emptyState(
        'Sin meses de producción. Se abren desde un cliente con suscripción activa: los compromisos salen de los entregables del catálogo.',
        btn('+ Mes de producción', 'production-new', { cls: 'btn-primary' })
      );

    const mes = currentMonth();
    const delMes = prods.filter((p) => p.month === mes);
    const target = delMes.reduce((s, p) => s + productionProgress(p).target, 0);
    const done = delMes.reduce((s, p) => s + productionProgress(p).done, 0);
    const atrasadas = App.state.pieces.filter((p) => p.dueDate && daysUntil(p.dueDate) < 0 && !isDelivered(p)).length;
    const revision = App.state.pieces.filter((p) => p.status === 'en-revision' || p.status === 'grabado').length;

    const kpis = `<div class="kpi-row">
      ${kpi('Comprometido este mes', String(target), `${delMes.length} cliente(s) en producción`, '')}
      ${kpi('Entregado', String(done), target ? `${Math.round((done / target) * 100)}% de cumplimiento` : '', done >= target && target ? 'green' : '')}
      ${kpi('En proceso', String(revision), 'en revisión o grabadas sin editar', revision ? 'amber' : '')}
      ${kpi('Atrasadas', String(atrasadas), 'pasadas de fecha', atrasadas ? 'red' : '')}
    </div>`;

    return kpis + prods.map(productionCard).join('');
  },
};

function productionCard(prod) {
  const pr = productionProgress(prod);
  const pieces = piecesOf(prod.id);

  const commitments = (prod.commitments || []).length
    ? `<ul class="commit-list">${prod.commitments
        .map((c) => {
          const d = commitmentDone(prod.id, c.id);
          const pct = c.target ? Math.min(100, Math.round((d / c.target) * 100)) : 0;
          return `<li>
            <span class="commit-label">${esc(c.label)}<em>${esc(c.serviceName || '')}</em></span>
            <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
            <strong class="${d >= c.target ? 'ok' : ''}">${d}/${c.target}</strong>
          </li>`;
        })
        .join('')}</ul>`
    : `<p class="muted">Sin compromisos. ${btn('Agregar a mano', 'commitment-add', { data: { id: prod.id }, small: true })}</p>`;

  const rows = sortBy(pieces, 'createdAt').map((p) => {
    const late = p.dueDate && daysUntil(p.dueDate) < 0 && !isDelivered(p);
    const next = nextStatus(p);
    const commit = (prod.commitments || []).find((c) => c.id === p.commitmentId);
    return {
      cells: [
        `<a class="link" data-act="piece-edit" data-id="${p.id}">${esc(p.title)}</a>${p.angle ? `<br><small class="muted">${esc(p.angle)}</small>` : ''}`,
        esc(p.type),
        esc(p.platform || '—'),
        commit ? esc(commit.label) : '<span class="muted">sin asignar</span>',
        p.dueDate ? `${esc(fmtDate(p.dueDate))}${late ? ' <span class="warn">atrasada</span>' : ''}` : '—',
        badge(p.status, PIECE_TONE[p.status]),
        next ? btn(`→ ${next}`, 'piece-advance', { data: { id: p.id }, small: true }) : '',
      ],
    };
  });

  return section(
    `${clientName(prod.clientId)} · ${monthLabel(prod.month)}`,
    `<div class="prod-head">
      <div class="bar bar-lg"><div class="bar-fill" style="width:${pr.pct}%"></div></div>
      <strong>${pr.done}/${pr.target} · ${pr.pct}%</strong>
    </div>
    ${commitments}
    ${prod.notes ? `<p class="muted">${esc(prod.notes)}</p>` : ''}
    <div class="prod-pieces">
      ${table(
        [{ label: 'Pieza' }, { label: 'Tipo' }, { label: 'Canal' }, { label: 'Compromiso' }, { label: 'Fecha' }, { label: 'Estado' }, { label: '' }],
        rows,
        'Sin piezas registradas. Genera el paquete con el agente y usa "Importar del vault".'
      )}
    </div>`,
    `${btn('+ Pieza', 'piece-new', { data: { id: prod.id }, small: true })}
     ${btn('Importar del vault', 'production-import', { data: { id: prod.id }, small: true })}
     ${btn('Reporte del mes', 'report-new', { data: { client: prod.clientId, month: prod.month }, small: true, cls: 'btn-primary' })}`
  );
}

App.actions['production-new'] = () =>
  openForm({
    title: 'Abrir mes de producción',
    intro: 'Los compromisos se derivan de los entregables de los servicios contratados. Si no hay suscripción activa, se crea vacío para llenarlo a mano.',
    fields: [
      { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), required: true },
      { name: 'month', label: 'Mes', value: currentMonth(), required: true, hint: 'Formato AAAA-MM' },
    ],
    submitLabel: 'Abrir mes',
    onSubmit: async (v) => {
      await api.action(`/api/clients/${v.clientId}/production`, { month: v.month });
      toast('Mes de producción abierto');
    },
  });

// La marca personal no es un cliente que paga, pero sí es producción que hay que
// contar: se le abre su propio mes con el ritmo de 3 videos por semana.
App.actions['production-personal'] = () =>
  openForm({
    title: 'Mes de marca personal',
    intro: 'Abre el mes con el ritmo que ya tienes: escribir y grabar lunes, miércoles y viernes; editar martes y jueves.',
    fields: [
      { name: 'name', label: 'Nombre de la marca', value: 'Marca personal', required: true, hint: 'Debe coincidir con el campo <code>client</code> de las notas en Video\\.' },
      { name: 'month', label: 'Mes', value: currentMonth(), required: true },
      { name: 'weekly', label: 'Videos por semana', type: 'number', value: 3, required: true },
    ],
    submitLabel: 'Abrir mes',
    onSubmit: async (v) => {
      let client = App.state.clients.find((c) => c.name.toLowerCase() === v.name.toLowerCase());
      if (!client) client = await api.create('clients', { name: v.name, status: 'activo', currency: 'COP', source: 'interno', notes: 'Marca personal — no factura.' });
      const prod = await api.action(`/api/clients/${client.id}/production`, { month: v.month });
      const total = Number(v.weekly) * 4;
      await api.update('productions', prod.id, {
        status: 'en-curso',
        notes: '',
        commitments: (prod.commitments || []).concat([
          { id: `c${Date.now().toString(36)}`, label: `${total} videos cortos/mes (${v.weekly} por semana)`, target: total, serviceName: 'Marca personal' },
        ]),
      });
      toast(`Mes abierto: ${total} videos`);
    },
  });

App.actions['production-import'] = async (el) => {
  const r = await api.action(`/api/productions/${el.dataset.id}/import-vault`);
  await refresh();
  toast(
    r.imported
      ? `${r.imported} pieza(s) importada(s) de ${r.scanned} nota(s)`
      : `Nada nuevo que importar${r.note ? ` — ${r.note}` : ''}`,
    r.imported ? 'ok' : 'error'
  );
};

App.actions['commitment-add'] = (el) => {
  const prod = byId('productions', el.dataset.id);
  openForm({
    title: 'Agregar compromiso',
    fields: [
      { name: 'label', label: 'Entregable', required: true, width: 2, placeholder: 'Ej: 20 anuncios estáticos' },
      { name: 'target', label: 'Cantidad del mes', type: 'number', value: 1, required: true },
    ],
    onSubmit: async (v) => {
      const commitments = (prod.commitments || []).concat([{ id: `c${Date.now().toString(36)}`, label: v.label, target: v.target, serviceName: '' }]);
      await api.update('productions', prod.id, { commitments, status: 'en-curso' });
      toast('Compromiso agregado');
    },
  });
};

function pieceFields(p, prod) {
  const v = p || {};
  const commits = [{ value: '', label: '— sin asignar —' }].concat(
    (prod.commitments || []).map((c) => ({ value: c.id, label: `${c.label} (${commitmentDone(prod.id, c.id)}/${c.target})` }))
  );
  return [
    { name: 'title', label: 'Título de la pieza', value: v.title || '', required: true, width: 2 },
    { name: 'type', label: 'Tipo', type: 'select', options: ['copy', 'grafica', 'video', 'landing', 'automatizacion', 'otro'], value: v.type || 'copy' },
    { name: 'platform', label: 'Canal', type: 'select', options: ['facebook', 'google', 'instagram', 'tiktok', 'video', 'email', 'otro'], value: v.platform || 'facebook' },
    { name: 'commitmentId', label: 'Cuenta para', type: 'select', options: commits, value: v.commitmentId || '' },
    { name: 'angle', label: 'Ángulo', value: v.angle || '', placeholder: 'beneficio · urgencia · prueba social' },
    { name: 'status', label: 'Estado', type: 'select', options: flowOf(v), value: v.status || flowOf(v)[0] },
    { name: 'dueDate', label: 'Fecha de entrega', type: 'date', value: v.dueDate || '' },
    { name: 'vaultNote', label: 'Nota en el vault', value: v.vaultNote || '', width: 2, hint: 'Archivo dentro de AdsSuite\\ o Ads\\ donde vive el copy completo.' },
    { name: 'notes', label: 'Notas', type: 'textarea', rows: 3, width: 2, value: v.notes || '' },
  ];
}

App.actions['piece-new'] = (el) => {
  const prod = byId('productions', el.dataset.id);
  openForm({
    title: `Nueva pieza — ${clientName(prod.clientId)}`,
    wide: true,
    fields: pieceFields(null, prod),
    onSubmit: async (v) => {
      await api.create('pieces', { ...v, clientId: prod.clientId, productionId: prod.id });
      toast('Pieza registrada');
    },
  });
};

App.actions['piece-edit'] = (el) => {
  const p = byId('pieces', el.dataset.id);
  const prod = byId('productions', p.productionId) || { commitments: [] };
  openForm({
    title: p.title,
    wide: true,
    fields: pieceFields(p, prod),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('pieces', p.id);
        toast('Pieza eliminada');
      },
    },
    onSubmit: async (v) => {
      await api.update('pieces', p.id, v);
      toast('Pieza actualizada');
    },
  });
};

App.actions['piece-advance'] = async (el) => {
  const p = byId('pieces', el.dataset.id);
  const next = nextStatus(p);
  if (!next) return;
  await api.update('pieces', p.id, { status: next, publishedAt: next === 'publicado' ? today() : p.publishedAt || '' });
  await refresh();
  toast(`Pieza en ${next}`);
};

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

App.views.briefs = {
  title: 'Briefs',
  sub: 'La memoria de marca que leen los agentes antes de escribir una línea.',
  actions: () => btn('+ Brief', 'brief-new', { cls: 'btn-primary' }),
  render() {
    const briefs = App.state.briefs;
    const sinBrief = App.state.clients.filter((c) => c.status === 'activo' && !briefs.some((b) => b.clientId === c.id));

    const pendientes = sinBrief.length
      ? section(
          'Clientes activos sin brief',
          `<ul class="mini-list">${sinBrief
            .map((c) => `<li>${esc(c.name)} ${btn('Crear brief', 'brief-new', { data: { client: c.id }, small: true })}</li>`)
            .join('')}</ul>
           <p class="muted">Sin brief, el agente vuelve a preguntar todo en cada solicitud y el copy sale genérico.</p>`
        )
      : '';

    const cards = briefs.length
      ? briefs
          .map(
            (b) => `<article class="brief">
              <header>
                <h3>${esc(clientName(b.clientId))}</h3>
                <span class="brief-kind">${badge(b.kind === 'personal' ? 'marca personal' : b.kind === 'ambos' ? 'ads + personal' : 'ads', b.kind === 'ads' || !b.kind ? 'blue' : 'green')}</span>
                ${btn('Editar', 'brief-edit', { data: { id: b.id }, small: true })}
              </header>
              <dl>
                <dt>Marca</dt><dd>${esc(b.brand || '—')}</dd>
                <dt>Público</dt><dd>${esc(b.audience || '—')}</dd>
                <dt>Dolor</dt><dd>${esc(b.pain || '—')}</dd>
                <dt>Oferta</dt><dd>${esc(b.offer || '—')}</dd>
                ${b.kind && b.kind !== 'ads' ? `<dt>Posicionamiento</dt><dd>${esc(b.positioning || '—')}</dd><dt>Pilares</dt><dd>${(b.pillars || []).length ? esc((b.pillars || []).join(' · ')) : '—'}</dd>` : ''}
                <dt>Tono</dt><dd>${esc(b.tone || '—')}</dd>
                <dt>Restricciones</dt><dd>${(b.restrictions || []).length ? esc((b.restrictions || []).join(' · ')) : '—'}</dd>
              </dl>
              <footer class="muted">Agency\\Briefs\\${esc(b.clientId ? clientName(b.clientId) : '')}.md · idioma ${esc(b.language || 'español')}</footer>
            </article>`
          )
          .join('')
      : emptyState('Sin briefs todavía.');

    return `${pendientes}<div class="briefs-grid">${cards}</div>`;
  },
};

function briefFields(b, clientId) {
  const v = b || {};
  return [
    { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), value: v.clientId || clientId || '', required: true },
    { name: 'language', label: 'Idioma del copy', type: 'select', options: ['español', 'inglés', 'portugués'], value: v.language || 'español' },
    { name: 'brand', label: 'Marca (una línea)', value: v.brand || '', required: true, width: 2, placeholder: 'Qué hace la empresa, en una frase' },
    { name: 'audience', label: 'Público objetivo', type: 'textarea', rows: 2, width: 2, value: v.audience || '', required: true },
    { name: 'pain', label: 'Dolor principal', type: 'textarea', rows: 2, width: 2, value: v.pain || '', hint: 'En las palabras del cliente, no en las tuyas.' },
    { name: 'offer', label: 'Oferta específica', type: 'textarea', rows: 2, width: 2, value: v.offer || '', required: true },
    { name: 'objective', label: 'Objetivo', type: 'select', options: ['trafico', 'leads', 'ventas', 'awareness'], value: v.objective || 'leads' },
    { name: 'cta', label: 'CTA preferido', value: v.cta || '', placeholder: 'Ej: Más información' },
    { name: 'tone', label: 'Tono de voz', value: v.tone || '', width: 2 },
    { name: 'differentiators', label: 'Diferenciadores', type: 'lines', rows: 4, width: 2, value: v.differentiators || [] },
    { name: 'restrictions', label: 'Restricciones y claims prohibidos', type: 'lines', rows: 4, width: 2, value: v.restrictions || [], hint: 'Palabras vetadas, compliance del sector, promesas que no se pueden hacer.' },
    { name: 'landing', label: 'Landing / destino', value: v.landing || '', width: 2 },
    { name: 'kind', label: 'Para qué se usa', type: 'select', options: [{ value: 'ads', label: 'Solo anuncios' }, { value: 'personal', label: 'Solo marca personal' }, { value: 'ambos', label: 'Anuncios y marca personal' }], value: v.kind || 'ads', hint: 'Define qué agente lo lee.' },
    { name: 'videoFormats', label: 'Formatos de video', value: v.videoFormats || '', placeholder: 'Reels 9:16, YouTube largo…' },
    { name: 'positioning', label: 'Posicionamiento', type: 'textarea', rows: 2, width: 2, value: v.positioning || '', hint: 'En una frase: para quién es referente y en qué. Es lo que evita el contenido genérico.' },
    { name: 'pillars', label: 'Pilares de contenido', type: 'lines', rows: 4, width: 2, value: v.pillars || [], hint: '3 a 5 temas de los que siempre habla. Uno por línea.' },
    { name: 'proof', label: 'Pruebas y credenciales', type: 'textarea', rows: 3, width: 2, value: v.proof || '', hint: 'Resultados, cifras e historias reales que puede contar. El agente no inventa ninguna: usa solo lo que esté aquí.' },
    { name: 'notes', label: 'Notas', type: 'textarea', rows: 3, width: 2, value: v.notes || '' },
  ];
}

App.actions['brief-new'] = (el) =>
  openForm({
    title: 'Nuevo brief',
    wide: true,
    intro: 'Se guarda en <code>Agency\\Briefs\\</code>; el agente de anuncios lo lee de ahí antes de generar.',
    fields: briefFields(null, el && el.dataset.client),
    onSubmit: async (v) => {
      await api.create('briefs', v);
      toast('Brief guardado en el vault');
    },
  });

App.actions['brief-edit'] = (el) => {
  const b = byId('briefs', el.dataset.id);
  openForm({
    title: `Brief — ${clientName(b.clientId)}`,
    wide: true,
    fields: briefFields(b),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('briefs', b.id);
        toast('Brief eliminado');
      },
    },
    onSubmit: async (v) => {
      await api.update('briefs', b.id, v);
      toast('Brief actualizado');
    },
  });
};

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------

App.views.reportes = {
  title: 'Reportes',
  sub: 'El cliente que no ve resultados se los inventa. Mismo día, todos los meses.',
  actions: () => btn('+ Reporte', 'report-new', { cls: 'btn-primary' }),
  render() {
    const rows = App.state.reports
      .slice()
      .sort((a, b) => (a.month < b.month ? 1 : -1))
      .map((r) => {
        const cumpl = (r.delivery || []).reduce((s, d) => s + Math.min(d.done, d.target), 0);
        const total = (r.delivery || []).reduce((s, d) => s + Number(d.target || 0), 0);
        return {
          cells: [
            `<a class="link" data-act="report-open" data-id="${r.id}">${esc(monthLabel(r.month))}</a>`,
            esc(clientName(r.clientId)),
            total ? `${cumpl}/${total}` : '—',
            badge(r.status === 'enviado' ? 'enviada' : 'borrador'),
            r.sentAt ? esc(fmtDate(r.sentAt)) : '—',
            btn('Abrir', 'report-open', { data: { id: r.id }, small: true }),
          ],
        };
      });
    return table(
      [{ label: 'Mes' }, { label: 'Cliente' }, { label: 'Cumplimiento' }, { label: 'Estado' }, { label: 'Enviado' }, { label: '' }],
      rows,
      'Sin reportes. Se generan desde el mes de producción con un clic.'
    );
  },
};

App.actions['report-new'] = (el) => {
  const preClient = el && el.dataset.client;
  const preMonth = el && el.dataset.month;
  if (preClient && preMonth) {
    return api.action(`/api/clients/${preClient}/report`, { month: preMonth }).then(async () => {
      await refresh();
      toast('Reporte generado en borrador');
      go('reportes');
    });
  }
  return openForm({
    title: 'Generar reporte mensual',
    intro: 'Trae el cumplimiento de entregables del mes; los resultados los cargas tú desde las plataformas.',
    fields: [
      { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), required: true },
      { name: 'month', label: 'Mes', value: currentMonth(), required: true },
    ],
    submitLabel: 'Generar',
    onSubmit: async (v) => {
      await api.action(`/api/clients/${v.clientId}/report`, { month: v.month });
      toast('Reporte generado en borrador');
    },
  });
};

function reportDocHTML(r) {
  const c = byId('clients', r.clientId) || {};
  const delivery = (r.delivery || []).length
    ? `<table class="doc-items">
        <thead><tr><th>Entregable comprometido</th><th class="num">Meta</th><th class="num">Entregado</th></tr></thead>
        <tbody>${r.delivery
          .map(
            (d) => `<tr><td>${esc(d.label)}</td><td class="num">${esc(d.target)}</td><td class="num">${esc(d.done)}${
              d.done >= d.target ? '' : ' ⚠'
            }</td></tr>`
          )
          .join('')}</tbody>
      </table>`
    : '<p>Sin entregables registrados para este mes.</p>';

  const metrics = (r.metrics || []).filter((m) => m.value !== '' && m.value !== undefined);
  const metricsHTML = metrics.length
    ? `<table class="doc-items">
        <thead><tr><th>Métrica</th><th class="num">Este mes</th><th class="num">Mes anterior</th><th>Nota</th></tr></thead>
        <tbody>${metrics
          .map((m) => `<tr><td>${esc(m.label)}</td><td class="num">${esc(m.value)}</td><td class="num">${esc(m.previous || '—')}</td><td>${esc(m.note || '')}</td></tr>`)
          .join('')}</tbody>
      </table>`
    : '<p>Sin métricas cargadas.</p>';

  return `<article class="doc">
    <header class="doc-head">
      ${companyHeaderHTML()}
      <div class="doc-meta">
        <h1>Reporte</h1>
        <strong>${esc(monthLabel(r.month))}</strong>
        <span>${esc(c.name || '')}</span>
      </div>
    </header>
    <h2 class="doc-title">Cumplimiento de entregables</h2>
    ${delivery}
    <h2 class="doc-title" style="margin-top:28px">Resultados</h2>
    ${metricsHTML}
    ${r.highlights ? `<section class="doc-terms"><h3>Lo que funcionó</h3>${r.highlights.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</section>` : ''}
    ${r.nextMonth ? `<section class="doc-terms"><h3>Plan del próximo mes</h3>${r.nextMonth.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</section>` : ''}
    <footer class="doc-foot"><p>${esc(App.state.settings.company.tradeName || '')} · reporte de ${esc(monthLabel(r.month))}</p></footer>
  </article>`;
}

App.actions['report-open'] = (el) => {
  const r = byId('reports', el.dataset.id);
  const actions = [
    btn('Cargar resultados', 'report-edit', { data: { id: r.id }, cls: 'btn-primary' }),
    btn('Imprimir / PDF', 'report-print', { data: { id: r.id } }),
    btn('Guardar para enviar', 'report-send', { data: { id: r.id } }),
    r.status !== 'enviado' ? btn('Marcar enviado', 'report-sent', { data: { id: r.id } }) : '',
  ].join('');
  openPanel(`Reporte ${monthLabel(r.month)} — ${clientName(r.clientId)}`, reportDocHTML(r), actions);
};

App.actions['report-print'] = (el) => printDocument(reportDocHTML(byId('reports', el.dataset.id)));

App.actions['report-sent'] = async (el) => {
  await api.update('reports', el.dataset.id, { status: 'enviado', sentAt: today() });
  closeModal();
  toast('Reporte marcado como enviado');
  await refresh();
};

App.actions['report-edit'] = (el) => {
  const r = byId('reports', el.dataset.id);
  const metrics = r.metrics || [];
  const fields = [];
  metrics.forEach((m, i) => {
    fields.push({ name: `m${i}_label`, label: `Métrica ${i + 1}`, value: m.label || '' });
    fields.push({ name: `m${i}_value`, label: 'Este mes', value: m.value || '' });
    fields.push({ name: `m${i}_previous`, label: 'Mes anterior', value: m.previous || '' });
    fields.push({ name: `m${i}_note`, label: 'Nota', value: m.note || '' });
  });
  fields.push({ name: 'highlights', label: 'Lo que funcionó', type: 'textarea', rows: 4, width: 2, value: r.highlights || '' });
  fields.push({ name: 'nextMonth', label: 'Plan del próximo mes', type: 'textarea', rows: 4, width: 2, value: r.nextMonth || '' });

  openForm({
    title: `Resultados — ${monthLabel(r.month)}`,
    wide: true,
    intro: 'Los números salen de Meta Ads / Google Ads; el sistema no se conecta a las plataformas.',
    fields,
    onSubmit: async (v) => {
      const updated = metrics.map((m, i) => ({
        label: v[`m${i}_label`],
        value: v[`m${i}_value`],
        previous: v[`m${i}_previous`],
        note: v[`m${i}_note`],
      }));
      await api.update('reports', r.id, { metrics: updated, highlights: v.highlights, nextMonth: v.nextMonth });
      toast('Reporte actualizado');
    },
  });
};
