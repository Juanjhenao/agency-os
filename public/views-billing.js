/* Agency OS — vistas de facturación: propuestas, contratos, suscripciones, facturas, finanzas y ajustes. */

// ---------------------------------------------------------------------------
// Panel genérico (documento + acciones), reutiliza el DOM del modal
// ---------------------------------------------------------------------------

function openPanel(title, html, actionsHTML) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal').className = 'modal modal-wide';
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-foot').innerHTML = `${actionsHTML || ''}<span class="spacer"></span>${btn('Cerrar', 'modal-close')}`;
  mostrarModal();
  modalSubmit = null;
}

// ---------------------------------------------------------------------------
// Enlace público del documento
// ---------------------------------------------------------------------------

/* Un documento con enlace deja de ser un PDF adjunto y pasa a ser algo que el
 * cliente abre en el teléfono, lee y acepta. De paso queda el registro de
 * cuándo lo abrió: saber que la propuesta se abrió tres veces ayer cambia por
 * completo el mensaje de seguimiento. */

const SHARE_LABEL = { proposals: 'propuesta', contracts: 'contrato', invoices: 'factura' };

function shareButton(col, doc) {
  const activo = doc.share && doc.share.token && !doc.share.revokedAt;
  return btn(activo ? 'Ver enlace' : 'Crear enlace', 'doc-share', { data: { col, id: doc.id }, cls: activo ? 'btn-ghost' : 'btn-primary' });
}

function shareBanner(doc) {
  if (!doc.share || !doc.share.token) return '';
  const views = (doc.share.views || []).length;
  const last = views ? (doc.share.views[views - 1] || {}).at : '';
  const a = doc.acceptance;

  if (doc.share.revokedAt) {
    return `<div class="share-bar muted">Enlace desactivado el ${esc(fmtDate(doc.share.revokedAt))}.</div>`;
  }

  const visto = views
    ? `Abierto ${views} ${views === 1 ? 'vez' : 'veces'}${last ? ` · última: ${esc(new Date(last).toLocaleString('es-CO'))}` : ''}`
    : 'Todavía sin abrir';

  const firma = a
    ? `<strong class="ok">Aceptado por ${esc(a.name)}</strong> el ${esc(new Date(a.at).toLocaleString('es-CO'))} desde ${esc(a.ip)} · huella ${esc(String(a.documentHash).slice(0, 16))}…`
    : visto;

  return `<div class="share-bar">${firma}</div>`;
}

App.actions['doc-share'] = async (el) => {
  const { col, id } = el.dataset;
  const r = await api.action(`/api/${col}/${id}/share`);
  const base = (App.state.runtime && App.state.runtime.publicBaseUrl) || '';
  const local = base.includes('localhost') || base.includes('127.0.0.1');

  openPanel(
    `Enlace de la ${SHARE_LABEL[col] || 'documento'}`,
    `<p>Este es el enlace que se le manda al cliente. Lo abre, lo lee y lo ${col === 'contracts' ? 'firma' : col === 'invoices' ? 'paga' : 'acepta'} sin imprimir nada.</p>
     <pre class="msg-body">${esc(r.url)}</pre>
     ${
       local
         ? `<p class="muted warn">Ese enlace solo funciona en este computador. Para mandárselo a un cliente hay que publicar el servidor (Cloudflare Tunnel, ngrok o un dominio propio) y poner esa dirección en Ajustes → Enlaces públicos.</p>`
         : `<p class="muted">Registra cada apertura. Si no lo abre en 48 horas, el problema es el mensaje con el que lo mandaste, no el documento.</p>`
     }`,
    `${btn('Copiar enlace', 'doc-share-copy', { data: { url: r.url }, cls: 'btn-primary' })}
     ${btn('Desactivar', 'doc-unshare', { data: { col, id } })}`
  );
  await refresh();
};

App.actions['doc-share-copy'] = (el) => copyText(el.dataset.url, 'Enlace copiado');

App.actions['doc-unshare'] = async (el) => {
  await api.action(`/api/${el.dataset.col}/${el.dataset.id}/unshare`);
  closeModal();
  toast('Enlace desactivado');
  await refresh();
};

// Markdown mínimo para el cuerpo de los contratos.
function mdToHTML(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  let inTable = false;
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (inTable && !isRow) {
      out.push('</table>');
      inTable = false;
    }
    if (isRow) {
      const cells = line.trim().slice(1, -1).split('|');
      if (/^[\s|:-]+$/.test(line)) return; // separador
      if (!inTable) {
        out.push('<table class="doc-table">');
        inTable = true;
      }
      out.push(`<tr>${cells.map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`);
      return;
    }
    if (!line.trim()) return;
    if (line.startsWith('### ')) out.push(`<h4>${inline(line.slice(4))}</h4>`);
    else if (line.startsWith('## ')) out.push(`<h3>${inline(line.slice(3))}</h3>`);
    else if (line.startsWith('# ')) out.push(`<h2>${inline(line.slice(2))}</h2>`);
    else if (line.trim() === '---') out.push('<hr>');
    else if (/^\s+-\s/.test(line)) out.push(`<p class="doc-bullet">•&nbsp; ${inline(line.replace(/^\s+-\s/, ''))}</p>`);
    else out.push(`<p>${inline(line)}</p>`);
  });
  if (inTable) out.push('</table>');
  return out.join('\n');
}

function docTotalsHTML(doc) {
  const t = computeTotals(doc);
  const taxLabel = (App.state.settings.invoicing.taxLabel || {})[doc.currency] || 'Impuesto';
  const rows = [[`Subtotal`, fmtMoney(t.subtotal, doc.currency)]];
  if (t.discount) rows.push(['Descuento', `-${fmtMoney(t.discount, doc.currency)}`]);
  if (t.tax) rows.push([`${taxLabel} ${doc.taxRate}%`, fmtMoney(t.tax, doc.currency)]);
  if (t.withholding) rows.push(['Retención', `-${fmtMoney(t.withholding, doc.currency)}`]);
  return `<table class="doc-totals">
    ${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join('')}
    <tr class="grand"><td>Total</td><td class="num">${esc(fmtMoney(t.total, doc.currency))}</td></tr>
  </table>`;
}

function docItemsHTML(doc) {
  return `<table class="doc-items">
    <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Valor unitario</th><th class="num">Total</th></tr></thead>
    <tbody>${(doc.items || [])
      .map(
        (it) => `<tr>
          <td>${esc(it.description || '')}${it.detail ? `<br><small>${esc(it.detail)}</small>` : ''}</td>
          <td class="num">${esc(it.qty || 0)}</td>
          <td class="num">${esc(fmtMoney(it.unitPrice, doc.currency))}</td>
          <td class="num">${esc(fmtMoney(lineTotal(it), doc.currency))}</td>
        </tr>`
      )
      .join('')}</tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// Propuestas
// ---------------------------------------------------------------------------

App.views.propuestas = {
  title: 'Propuestas',
  sub: 'De la reunión a la propuesta el mismo día. Vigencia corta, decisión rápida.',
  actions: () => btn('+ Propuesta', 'proposal-new', { cls: 'btn-primary' }),
  render() {
    const rows = sortBy(App.state.proposals, 'createdAt', 'desc').map((p) => {
      const vence = p.validUntil ? daysUntil(p.validUntil) : null;
      return {
        cells: [
          `<a class="link" data-act="proposal-open" data-id="${p.id}">${esc(p.number)}</a>`,
          esc(clientName(p.clientId)),
          esc(p.title || '—'),
          badge(p.status),
          esc(fmtDate(p.issueDate)),
          p.validUntil
            ? `${esc(fmtDate(p.validUntil))}${vence < 0 && p.status === 'enviada' ? ' <span class="warn">vencida</span>' : ''}`
            : '—',
          esc(fmtMoney(computeTotals(p).total, p.currency)),
        ],
      };
    });
    return table(
      [
        { label: 'Número' },
        { label: 'Cliente' },
        { label: 'Título' },
        { label: 'Estado' },
        { label: 'Emisión' },
        { label: 'Vigencia' },
        { label: 'Total', align: 'right' },
      ],
      rows,
      'Sin propuestas. La propuesta se genera en 2 minutos desde el catálogo de servicios.'
    );
  },
};

function proposalFields(p, clientId) {
  const v = p || {};
  const s = App.state.settings;
  const cur = v.currency || 'COP';
  return [
    { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), value: v.clientId || clientId || '', required: true },
    { name: 'title', label: 'Título', value: v.title || '', required: true, placeholder: 'Ej: Sistema de ads con IA' },
    { name: 'currency', label: 'Moneda', type: 'select', options: ['COP', 'USD', 'MXN'], value: cur },
    { name: 'taxRate', label: 'Impuesto %', type: 'number', value: v.taxRate ?? (s.invoicing.taxRate[cur] || 0) },
    { name: 'issueDate', label: 'Fecha', type: 'date', value: v.issueDate || today() },
    { name: 'validUntil', label: 'Válida hasta', type: 'date', value: v.validUntil || addDays(today(), 7) },
    { name: 'summary', label: 'Resumen / diagnóstico', type: 'textarea', rows: 3, width: 2, value: v.summary || '', hint: 'El dolor del cliente en sus palabras. Esto es lo que hace que la propuesta se lea.' },
    { name: 'items', label: 'Alcance y precios', type: 'items', value: v.items || [], width: 2 },
    { name: 'discount', label: 'Descuento', type: 'number', value: v.discount || 0 },
    { name: 'status', label: 'Estado', type: 'select', options: ['borrador', 'enviada', 'aceptada', 'rechazada'], value: v.status || 'borrador' },
    {
      name: 'terms',
      label: 'Condiciones',
      type: 'textarea',
      rows: 4,
      width: 2,
      value: v.terms || `Forma de pago: mes anticipado / 50% anticipo en proyectos.\nVigencia de esta propuesta: 7 días calendario.\nLa inversión publicitaria no está incluida y la asume el cliente directamente.`,
    },
  ];
}

App.actions['proposal-new'] = (el) =>
  openForm({
    title: 'Nueva propuesta',
    wide: true,
    fields: proposalFields(null, el && el.dataset.client),
    submitLabel: 'Crear propuesta',
    onSubmit: async (v) => {
      await api.create('proposals', v);
      toast('Propuesta creada');
    },
  });

App.actions['proposal-edit'] = (el) => {
  const p = byId('proposals', el.dataset.id);
  openForm({
    title: `Editar ${p.number}`,
    wide: true,
    fields: proposalFields(p),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('proposals', p.id);
        toast('Propuesta eliminada');
      },
    },
    onSubmit: async (v) => {
      await api.update('proposals', p.id, v);
      toast('Propuesta actualizada');
    },
  });
};

function proposalDocHTML(p) {
  const c = byId('clients', p.clientId) || {};
  return `<article class="doc">
    <header class="doc-head">
      ${companyHeaderHTML()}
      <div class="doc-meta">
        <h1>Propuesta</h1>
        <strong>${esc(p.number)}</strong>
        <span>Fecha: ${esc(fmtDate(p.issueDate))}</span>
        ${p.validUntil ? `<span>Válida hasta: ${esc(fmtDate(p.validUntil))}</span>` : ''}
      </div>
    </header>
    <section class="doc-to">
      <span>Preparada para</span>
      <strong>${esc(c.legalName || c.name || '—')}</strong>
      ${c.taxId ? `<span>${esc(c.taxIdLabel || 'NIT')} ${esc(c.taxId)}</span>` : ''}
      ${c.contactName ? `<span>At.: ${esc(c.contactName)}</span>` : ''}
      ${c.email ? `<span>${esc(c.email)}</span>` : ''}
    </section>
    <h2 class="doc-title">${esc(p.title || '')}</h2>
    ${p.summary ? `<p class="doc-summary">${esc(p.summary)}</p>` : ''}
    ${docItemsHTML(p)}
    ${docTotalsHTML(p)}
    ${p.terms ? `<section class="doc-terms"><h3>Condiciones</h3>${p.terms.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</section>` : ''}
    <footer class="doc-foot"><p>${esc(App.state.settings.banking.notes || '')}</p></footer>
  </article>`;
}

App.actions['proposal-open'] = (el) => {
  const p = byId('proposals', el.dataset.id);
  const actions = [
    btn('Editar', 'proposal-edit', { data: { id: p.id } }),
    btn('Imprimir / PDF', 'proposal-print', { data: { id: p.id } }),
    shareButton('proposals', p),
    p.status === 'borrador' ? btn('Marcar enviada', 'proposal-sent', { data: { id: p.id }, cls: 'btn-primary' }) : '',
    p.status === 'enviada' ? btn('Aceptada', 'proposal-accept', { data: { id: p.id }, cls: 'btn-primary' }) : '',
    p.status === 'enviada' ? btn('Rechazada', 'proposal-reject', { data: { id: p.id } }) : '',
    p.status === 'aceptada' ? btn('Generar contrato', 'proposal-to-contract', { data: { id: p.id }, cls: 'btn-primary' }) : '',
  ].join('');
  openPanel(`Propuesta ${p.number}`, `${shareBanner(p)}${proposalDocHTML(p)}`, actions);
};

App.actions['proposal-print'] = (el) => printDocument(proposalDocHTML(byId('proposals', el.dataset.id)));

App.actions['proposal-sent'] = async (el) => {
  await api.update('proposals', el.dataset.id, { status: 'enviada', sentAt: new Date().toISOString() });
  closeModal();
  toast('Propuesta marcada como enviada');
  await refresh();
};

App.actions['proposal-reject'] = (el) =>
  openForm({
    title: 'Propuesta rechazada',
    fields: [{ name: 'lostReason', label: 'Motivo', type: 'textarea', rows: 3, width: 2, hint: 'El motivo es lo único que vuelve útil un no.' }],
    submitLabel: 'Registrar',
    onSubmit: async (v) => {
      await api.update('proposals', el.dataset.id, { status: 'rechazada', lostReason: v.lostReason, decidedAt: today() });
      toast('Registrado. Recontactar en 90 días.');
    },
  });

App.actions['proposal-accept'] = async (el) => {
  await api.update('proposals', el.dataset.id, { status: 'aceptada', decidedAt: today() });
  closeModal();
  toast('Propuesta aceptada. Genera el contrato desde aquí.');
  await refresh();
};

App.actions['proposal-to-contract'] = async (el) => {
  const c = await api.action(`/api/proposals/${el.dataset.id}/to-contract`);
  closeModal();
  await refresh();
  toast(`Contrato ${c.number} generado en borrador`);
  go('contratos');
};

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

App.views.contratos = {
  title: 'Contratos',
  sub: 'Plantillas de agencia listas. Revisión legal una vez, reúso mil veces.',
  actions: () => btn('+ Contrato', 'contract-new', { cls: 'btn-primary' }),
  render() {
    const rows = sortBy(App.state.contracts, 'createdAt', 'desc').map((c) => ({
      cells: [
        `<a class="link" data-act="contract-open" data-id="${c.id}">${esc(c.number)}</a>`,
        esc(clientName(c.clientId)),
        esc(c.type),
        badge(c.status),
        esc(fmtDate(c.startDate)),
        esc(c.jurisdiction),
        esc(fmtMoney(c.monthlyFee, c.currency)),
      ],
    }));
    return `${table(
      [
        { label: 'Número' },
        { label: 'Cliente' },
        { label: 'Modalidad' },
        { label: 'Estado' },
        { label: 'Inicio' },
        { label: 'Jurisdicción' },
        { label: 'Valor', align: 'right' },
      ],
      rows,
      'Sin contratos. Se generan solos desde una propuesta aceptada.'
    )}
    <p class="disclaimer">Las plantillas son un punto de partida estándar de industria, no asesoría legal. Antes del primer contrato grande, que un abogado revise el texto una vez.</p>`;
  },
};

function contractFields(c) {
  const v = c || {};
  return [
    { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), value: v.clientId || '', required: true },
    { name: 'type', label: 'Modalidad', type: 'select', options: [{ value: 'retainer', label: 'Retainer mensual' }, { value: 'suscripcion', label: 'Suscripción' }, { value: 'proyecto', label: 'Proyecto' }], value: v.type || 'retainer' },
    { name: 'jurisdiction', label: 'Jurisdicción', type: 'select', options: [{ value: 'CO', label: 'Colombia' }, { value: 'US', label: 'EE.UU. / internacional' }, { value: 'MX', label: 'México' }], value: v.jurisdiction || 'CO' },
    { name: 'currency', label: 'Moneda', type: 'select', options: ['COP', 'USD', 'MXN'], value: v.currency || 'COP' },
    { name: 'monthlyFee', label: 'Valor mensual / total', type: 'number', value: v.monthlyFee || 0 },
    { name: 'startDate', label: 'Inicio', type: 'date', value: v.startDate || today() },
    { name: 'termMonths', label: 'Duración inicial (meses)', type: 'number', value: v.termMonths ?? 3 },
    { name: 'noticeDays', label: 'Aviso de terminación (días)', type: 'number', value: v.noticeDays ?? 30 },
    { name: 'billingDay', label: 'Día de facturación', type: 'number', value: v.billingDay ?? 1 },
    { name: 'paymentTermsDays', label: 'Plazo de pago (días)', type: 'number', value: v.paymentTermsDays ?? App.state.settings.invoicing.defaultTermsDays },
    { name: 'slaHours', label: 'SLA de respuesta (horas)', type: 'number', value: v.slaHours ?? 24 },
    { name: 'status', label: 'Estado', type: 'select', options: ['borrador', 'enviado', 'firmado', 'terminado'], value: v.status || 'borrador' },
    { name: 'scope', label: 'Alcance', type: 'lines', rows: 6, width: 2, value: v.scope || [], hint: 'Uno por línea. Lo que no esté aquí, no está contratado.' },
  ];
}

App.actions['contract-new'] = () =>
  openForm({
    title: 'Nuevo contrato',
    wide: true,
    fields: contractFields(null),
    submitLabel: 'Generar contrato',
    onSubmit: async (v) => {
      await api.create('contracts', v);
      toast('Contrato generado');
    },
  });

App.actions['contract-edit'] = (el) => {
  const c = byId('contracts', el.dataset.id);
  openForm({
    title: `Editar ${c.number}`,
    wide: true,
    intro: 'Al guardar se regenera el texto del contrato desde la plantilla.',
    fields: contractFields(c),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('contracts', c.id);
        toast('Contrato eliminado');
      },
    },
    onSubmit: async (v) => {
      await api.update('contracts', c.id, v);
      await api.action(`/api/contracts/${c.id}/regenerate`);
      toast('Contrato actualizado');
    },
  });
};

function contractDocHTML(c) {
  return `<article class="doc doc-contract">${mdToHTML(c.body)}</article>`;
}

App.actions['contract-open'] = (el) => {
  const c = byId('contracts', el.dataset.id);
  const hasSub = App.state.subscriptions.some((s) => s.contractId === c.id);
  const actions = [
    btn('Editar', 'contract-edit', { data: { id: c.id } }),
    btn('Imprimir / PDF', 'contract-print', { data: { id: c.id } }),
    btn('Guardar para enviar', 'contract-send', { data: { id: c.id } }),
    btn('Editar texto', 'contract-body', { data: { id: c.id } }),
    shareButton('contracts', c),
    c.status !== 'firmado' ? btn('Marcar firmado', 'contract-sign', { data: { id: c.id }, cls: 'btn-primary' }) : '',
    c.status === 'firmado' && !hasSub && c.type !== 'proyecto'
      ? btn('Activar suscripción', 'contract-to-sub', { data: { id: c.id }, cls: 'btn-primary' })
      : '',
  ].join('');
  openPanel(`Contrato ${c.number}`, `${shareBanner(c)}${contractDocHTML(c)}`, actions);
};

App.actions['contract-print'] = (el) => printDocument(contractDocHTML(byId('contracts', el.dataset.id)));

App.actions['contract-body'] = (el) => {
  const c = byId('contracts', el.dataset.id);
  openForm({
    title: `Texto de ${c.number}`,
    wide: true,
    intro: 'Edición manual del clausulado. Al guardar aquí no se regenera desde la plantilla.',
    fields: [{ name: 'body', type: 'textarea', rows: 24, width: 2, value: c.body || '' }],
    onSubmit: async (v) => {
      await api.update('contracts', c.id, { body: v.body });
      toast('Texto actualizado');
    },
  });
};

App.actions['contract-sign'] = (el) =>
  openForm({
    title: 'Registrar firma',
    fields: [
      { name: 'signedAt', label: 'Fecha de firma', type: 'date', value: today(), required: true },
      { name: 'signedBy', label: 'Firmó por el cliente', value: '' },
    ],
    submitLabel: 'Marcar firmado',
    onSubmit: async (v) => {
      await api.update('contracts', el.dataset.id, { status: 'firmado', signedAt: v.signedAt, signedBy: v.signedBy });
      toast('Contrato firmado. Ahora activa la suscripción.');
    },
  });

App.actions['contract-to-sub'] = async (el) => {
  await api.action(`/api/contracts/${el.dataset.id}/to-subscription`);
  closeModal();
  await refresh();
  toast('Suscripción activa');
  go('suscripciones');
};

// ---------------------------------------------------------------------------
// Suscripciones
// ---------------------------------------------------------------------------

App.views.suscripciones = {
  title: 'Suscripciones',
  sub: 'El ingreso recurrente: lo único que hace predecible una agencia.',
  actions: () => btn('+ Suscripción', 'sub-new', { cls: 'btn-primary' }),
  render() {
    const subs = App.state.subscriptions;
    const mrr = mrrCop();
    const rows = sortBy(subs, 'nextInvoiceDate').map((s) => {
      const d = daysUntil(s.nextInvoiceDate);
      return {
        cells: [
          esc(clientName(s.clientId)),
          esc(s.planName),
          badge(s.status),
          esc(fmtMoney(s.amount, s.currency)),
          `${esc(fmtDate(s.nextInvoiceDate))}${s.status === 'activa' && d <= 0 ? ' <span class="warn">toca facturar</span>' : ''}`,
          [
            s.status === 'activa' ? btn('Facturar', 'sub-invoice', { data: { id: s.id }, small: true, cls: 'btn-primary' }) : '',
            btn('Editar', 'sub-edit', { data: { id: s.id }, small: true }),
          ].join(' '),
        ],
      };
    });
    return `<div class="kpi-row">
        ${kpi('MRR consolidado', fmtShort(mrr, 'COP'), `${subs.filter((s) => s.status === 'activa').length} activas`, 'green')}
        ${kpi('ARR proyectado', fmtShort(mrr * 12, 'COP'), 'si todo se mantiene', 'blue')}
        ${kpi('Ticket promedio', subs.length ? fmtShort(mrr / Math.max(1, subs.filter((s) => s.status === 'activa').length), 'COP') : '—', 'por cliente/mes', '')}
      </div>
      ${table(
        [{ label: 'Cliente' }, { label: 'Plan' }, { label: 'Estado' }, { label: 'Valor/mes', align: 'right' }, { label: 'Próxima factura' }, { label: '' }],
        rows,
        'Sin suscripciones. Se activan desde un contrato firmado.'
      )}`;
  },
};

function subFields(s) {
  const v = s || {};
  return [
    { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), value: v.clientId || '', required: true },
    { name: 'planName', label: 'Plan', value: v.planName || 'Retainer mensual', required: true },
    { name: 'amount', label: 'Valor mensual', type: 'number', value: v.amount || 0, required: true },
    { name: 'currency', label: 'Moneda', type: 'select', options: ['COP', 'USD', 'MXN'], value: v.currency || 'COP' },
    { name: 'billingDay', label: 'Día de corte', type: 'number', value: v.billingDay ?? 1 },
    { name: 'status', label: 'Estado', type: 'select', options: ['activa', 'pausada', 'cancelada'], value: v.status || 'activa' },
    { name: 'startDate', label: 'Inicio', type: 'date', value: v.startDate || today() },
    { name: 'nextInvoiceDate', label: 'Próxima factura', type: 'date', value: v.nextInvoiceDate || today() },
  ];
}

App.actions['sub-new'] = () =>
  openForm({
    title: 'Nueva suscripción',
    wide: true,
    fields: subFields(null),
    onSubmit: async (v) => {
      await api.create('subscriptions', v);
      toast('Suscripción creada');
    },
  });

App.actions['sub-edit'] = (el) => {
  const s = byId('subscriptions', el.dataset.id);
  openForm({
    title: `Suscripción — ${clientName(s.clientId)}`,
    wide: true,
    fields: subFields(s),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('subscriptions', s.id);
        toast('Suscripción eliminada');
      },
    },
    onSubmit: async (v) => {
      await api.update('subscriptions', s.id, v);
      toast('Suscripción actualizada');
    },
  });
};

App.actions['sub-invoice'] = async (el) => {
  const r = await api.action(`/api/subscriptions/${el.dataset.id}/invoice`);
  await refresh();
  toast(`Factura ${r.invoice.number} generada en borrador`);
  go('facturas');
};

// ---------------------------------------------------------------------------
// Facturas
// ---------------------------------------------------------------------------

App.views.facturas = {
  title: 'Facturas',
  sub: 'Consecutivo, impuestos y cartera. Lo que no se factura no existe.',
  actions: () => btn('+ Factura', 'invoice-new', { cls: 'btn-primary' }),
  render() {
    const invs = sortBy(App.state.invoices, 'issueDate', 'desc');
    const cobrado = App.state.invoices
      .filter((i) => i.status === 'pagada')
      .reduce((s, i) => s + toCop(computeTotals(i).total, i.currency), 0);
    const overdue = overdueInvoices();

    const rows = invs.map((i) => {
      const d = daysUntil(i.dueDate);
      const late = (i.status === 'enviada' || i.status === 'vencida') && d < 0;
      return {
        cells: [
          `<a class="link" data-act="invoice-open" data-id="${i.id}">${esc(i.number)}</a>`,
          esc(clientName(i.clientId)),
          esc(fmtDate(i.issueDate)),
          `${esc(fmtDate(i.dueDate))}${late ? ` <span class="warn">${-d}d mora</span>` : ''}`,
          badge(late && i.status !== 'pagada' ? 'vencida' : i.status),
          esc(fmtMoney(computeTotals(i).total, i.currency)),
          [
            i.status === 'borrador' ? btn('Enviar', 'invoice-send', { data: { id: i.id }, small: true }) : '',
            i.status !== 'pagada' && i.status !== 'anulada' ? btn('Pagada', 'invoice-paid', { data: { id: i.id }, small: true, cls: 'btn-primary' }) : '',
          ].join(' '),
        ],
      };
    });

    return `<div class="kpi-row">
        ${kpi('Por cobrar', fmtShort(receivableCop(), 'COP'), `${App.state.invoices.filter((i) => i.status === 'enviada').length} enviadas`, overdue.length ? 'red' : '')}
        ${kpi('En mora', fmtShort(overdue.reduce((s, i) => s + toCop(computeTotals(i).total, i.currency), 0), 'COP'), `${overdue.length} factura(s)`, overdue.length ? 'red' : '')}
        ${kpi('Cobrado histórico', fmtShort(cobrado, 'COP'), 'facturas pagadas', 'green')}
      </div>
      ${table(
        [{ label: 'Número' }, { label: 'Cliente' }, { label: 'Emisión' }, { label: 'Vence' }, { label: 'Estado' }, { label: 'Total', align: 'right' }, { label: '' }],
        rows,
        'Sin facturas todavía.'
      )}
      <p class="disclaimer">${esc(App.state.settings.invoicing.footerNote || '')}</p>`;
  },
};

function invoiceFields(i) {
  const v = i || {};
  const s = App.state.settings;
  const cur = v.currency || 'COP';
  return [
    { name: 'clientId', label: 'Cliente', type: 'select', options: clientOptions(true), value: v.clientId || '', required: true },
    { name: 'currency', label: 'Moneda', type: 'select', options: ['COP', 'USD', 'MXN'], value: cur },
    { name: 'issueDate', label: 'Emisión', type: 'date', value: v.issueDate || today(), required: true },
    { name: 'dueDate', label: 'Vence', type: 'date', value: v.dueDate || addDays(today(), s.invoicing.defaultTermsDays), required: true },
    { name: 'items', label: 'Conceptos', type: 'items', value: v.items || [], width: 2 },
    { name: 'discount', label: 'Descuento', type: 'number', value: v.discount || 0 },
    { name: 'taxRate', label: 'Impuesto %', type: 'number', value: v.taxRate ?? (s.invoicing.taxRate[cur] || 0) },
    { name: 'withholding', label: 'Retención', type: 'number', value: v.withholding || 0, hint: 'Valor absoluto que descuenta el cliente.' },
    { name: 'status', label: 'Estado', type: 'select', options: ['borrador', 'enviada', 'pagada', 'anulada'], value: v.status || 'borrador' },
    {
      name: 'paymentLink',
      label: 'Enlace de pago',
      value: v.paymentLink || '',
      width: 2,
      hint: 'Si lo dejas vacío, se usa el del catálogo de Ajustes → Cobro que coincida en moneda y monto.',
    },
    { name: 'notes', label: 'Notas', type: 'textarea', rows: 3, width: 2, value: v.notes || '' },
  ];
}

/* El enlace de pago que le toca a un documento: el suyo propio, o el del
 * catálogo que coincida en moneda y monto. Es la misma regla que aplica el
 * servidor en la página pública, para que el cliente y tú vean lo mismo. */
function paymentLinkFor(doc) {
  if (doc.paymentLink) return { url: doc.paymentLink, label: 'Pagar ahora' };
  const links = ((App.state.settings.payments || {}).links || []).filter((l) => l.url);
  const total = computeTotals(doc).total;
  const exact = links.find((l) => l.currency === doc.currency && Math.abs(Number(l.amount || 0) - total) < 0.5);
  const general = links.find((l) => l.currency === doc.currency && !Number(l.amount));
  const chosen = exact || general;
  return chosen ? { url: chosen.url, label: chosen.label || 'Pagar ahora' } : null;
}

App.actions['invoice-new'] = () =>
  openForm({
    title: 'Nueva factura',
    wide: true,
    fields: invoiceFields(null),
    submitLabel: 'Emitir',
    onSubmit: async (v) => {
      const inv = await api.create('invoices', v);
      toast(`Factura ${inv.number} creada`);
    },
  });

App.actions['invoice-edit'] = (el) => {
  const i = byId('invoices', el.dataset.id);
  openForm({
    title: `Editar ${i.number}`,
    wide: true,
    fields: invoiceFields(i),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('invoices', i.id);
        toast('Factura eliminada');
      },
    },
    onSubmit: async (v) => {
      await api.update('invoices', i.id, v);
      toast('Factura actualizada');
    },
  });
};

function invoiceDocHTML(i) {
  const c = byId('clients', i.clientId) || {};
  const s = App.state.settings;
  const bank = i.currency === 'COP' ? s.banking.copDetails : s.banking.usdDetails;
  const pay = paymentLinkFor(i);
  return `<article class="doc">
    <header class="doc-head">
      ${companyHeaderHTML()}
      <div class="doc-meta">
        <h1>Factura</h1>
        <strong>${esc(i.number)}</strong>
        <span>Emisión: ${esc(fmtDate(i.issueDate))}</span>
        <span>Vence: ${esc(fmtDate(i.dueDate))}</span>
      </div>
    </header>
    <section class="doc-to">
      <span>Facturar a</span>
      <strong>${esc(c.legalName || c.name || '—')}</strong>
      ${c.taxId ? `<span>${esc(c.taxIdLabel || 'NIT')} ${esc(c.taxId)}</span>` : ''}
      ${c.address ? `<span>${esc(c.address)}</span>` : ''}
      ${c.email ? `<span>${esc(c.email)}</span>` : ''}
    </section>
    ${docItemsHTML(i)}
    ${docTotalsHTML(i)}
    <section class="doc-pay">
      <h3>Forma de pago</h3>
      ${pay ? `<p class="doc-paylink"><strong>Pagar con tarjeta:</strong> ${esc(pay.url)}</p>` : ''}
      <p>${esc(bank || '')}</p>
      <p>${esc(s.invoicing.withholdingNote || '')}</p>
      ${i.notes ? `<p>${esc(i.notes)}</p>` : ''}
    </section>
    <footer class="doc-foot"><p>${esc(s.invoicing.footerNote || '')}</p></footer>
  </article>`;
}

App.actions['invoice-open'] = (el) => {
  const i = byId('invoices', el.dataset.id);
  const actions = [
    btn('Editar', 'invoice-edit', { data: { id: i.id } }),
    btn('Imprimir / PDF', 'invoice-print', { data: { id: i.id } }),
    shareButton('invoices', i),
    i.status === 'borrador' ? btn('Marcar enviada', 'invoice-send', { data: { id: i.id }, cls: 'btn-primary' }) : '',
    i.status !== 'pagada' && i.status !== 'anulada' ? btn('Registrar pago', 'invoice-paid', { data: { id: i.id }, cls: 'btn-primary' }) : '',
  ].join('');
  openPanel(`Factura ${i.number}`, `${shareBanner(i)}${invoiceDocHTML(i)}`, actions);
};

App.actions['invoice-print'] = (el) => printDocument(invoiceDocHTML(byId('invoices', el.dataset.id)));

App.actions['invoice-send'] = async (el) => {
  await api.update('invoices', el.dataset.id, { status: 'enviada', sentAt: new Date().toISOString() });
  closeModal();
  toast('Factura marcada como enviada');
  await refresh();
};

App.actions['invoice-paid'] = (el) => {
  const i = byId('invoices', el.dataset.id);
  openForm({
    title: `Registrar pago — ${i.number}`,
    fields: [
      { name: 'paidAt', label: 'Fecha de pago', type: 'date', value: today(), required: true },
      { name: 'paymentMethod', label: 'Medio', type: 'select', options: ['transferencia', 'PSE', 'Wise', 'Payoneer', 'efectivo', 'otro'], value: 'transferencia' },
    ],
    submitLabel: 'Registrar pago',
    onSubmit: async (v) => {
      await api.update('invoices', i.id, { status: 'pagada', paidAt: v.paidAt, paymentMethod: v.paymentMethod });
      toast('Pago registrado');
    },
  });
};

// ---------------------------------------------------------------------------
// Finanzas
// ---------------------------------------------------------------------------

App.views.finanzas = {
  title: 'Finanzas',
  sub: 'Consolidado en COP con la tasa de cambio de Ajustes.',
  actions: () => btn('+ Gasto', 'expense-new', { cls: 'btn-primary' }),
  render() {
    const months = [];
    for (let k = 5; k >= 0; k -= 1) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - k);
      months.push(d.toISOString().slice(0, 7));
    }

    const rows = months.map((m) => {
      const facturado = App.state.invoices
        .filter((i) => (i.issueDate || '').slice(0, 7) === m && i.status !== 'anulada')
        .reduce((s, i) => s + toCop(computeTotals(i).total, i.currency), 0);
      const cobrado = App.state.invoices
        .filter((i) => i.status === 'pagada' && (i.paidAt || '').slice(0, 7) === m)
        .reduce((s, i) => s + toCop(computeTotals(i).total, i.currency), 0);
      const gastos = App.state.expenses
        .filter((e) => (e.date || '').slice(0, 7) === m)
        .reduce((s, e) => s + toCop(e.amount, e.currency), 0);
      return { m, facturado, cobrado, gastos, neto: cobrado - gastos };
    });

    const mesActual = rows[rows.length - 1] || { cobrado: 0, gastos: 0, neto: 0 };
    const margen = mesActual.cobrado ? Math.round((mesActual.neto / mesActual.cobrado) * 100) : 0;

    const tableRows = rows.map((r) => ({
      cells: [
        esc(r.m),
        esc(fmtShort(r.facturado, 'COP')),
        esc(fmtShort(r.cobrado, 'COP')),
        esc(fmtShort(r.gastos, 'COP')),
        `<strong class="${r.neto >= 0 ? 'ok' : 'warn'}">${esc(fmtShort(r.neto, 'COP'))}</strong>`,
      ],
    }));

    const expenses = sortBy(App.state.expenses, 'date', 'desc')
      .slice(0, 20)
      .map((e) => ({
        cells: [
          esc(fmtDate(e.date)),
          esc(e.concept || '—'),
          esc(e.category || '—'),
          esc(fmtMoney(e.amount, e.currency)),
          btn('Editar', 'expense-edit', { data: { id: e.id }, small: true }),
        ],
      }));

    return `<div class="kpi-row">
        ${kpi('MRR', fmtShort(mrrCop(), 'COP'), 'ingreso recurrente', 'green')}
        ${kpi('Cobrado este mes', fmtShort(mesActual.cobrado, 'COP'), '', '')}
        ${kpi('Gastos del mes', fmtShort(mesActual.gastos, 'COP'), '', '')}
        ${kpi('Margen del mes', `${margen}%`, fmtShort(mesActual.neto, 'COP'), margen >= 50 ? 'green' : margen >= 25 ? 'amber' : 'red')}
      </div>
      ${section(
        'Últimos 6 meses',
        table(
          [{ label: 'Mes' }, { label: 'Facturado', align: 'right' }, { label: 'Cobrado', align: 'right' }, { label: 'Gastos', align: 'right' }, { label: 'Neto', align: 'right' }],
          tableRows
        )
      )}
      ${section(
        'Gastos recientes',
        table([{ label: 'Fecha' }, { label: 'Concepto' }, { label: 'Categoría' }, { label: 'Valor', align: 'right' }, { label: '' }], expenses, 'Sin gastos registrados.')
      )}`;
  },
};

function expenseFields(e) {
  const v = e || {};
  return [
    { name: 'date', label: 'Fecha', type: 'date', value: v.date || today(), required: true },
    { name: 'concept', label: 'Concepto', value: v.concept || '', required: true },
    { name: 'category', label: 'Categoría', type: 'select', options: ['herramientas', 'freelance', 'publicidad', 'impuestos', 'servicios', 'otro'], value: v.category || 'herramientas' },
    { name: 'amount', label: 'Valor', type: 'number', value: v.amount || 0, required: true },
    { name: 'currency', label: 'Moneda', type: 'select', options: ['COP', 'USD', 'MXN'], value: v.currency || 'COP' },
    { name: 'recurring', label: 'Recurrente', type: 'checkbox', checkLabel: 'Se repite cada mes', value: !!v.recurring },
  ];
}

App.actions['expense-new'] = () =>
  openForm({
    title: 'Nuevo gasto',
    wide: true,
    fields: expenseFields(null),
    onSubmit: async (v) => {
      await api.create('expenses', v);
      toast('Gasto registrado');
    },
  });

App.actions['expense-edit'] = (el) => {
  const e = byId('expenses', el.dataset.id);
  openForm({
    title: 'Editar gasto',
    wide: true,
    fields: expenseFields(e),
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('expenses', e.id);
        toast('Gasto eliminado');
      },
    },
    onSubmit: async (v) => {
      await api.update('expenses', e.id, v);
      toast('Gasto actualizado');
    },
  });
};

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

App.views.ajustes = {
  title: 'Ajustes',
  sub: 'Estos datos aparecen en cada factura, propuesta y contrato.',
  actions: () => '',
  render() {
    const s = App.state.settings;
    const c = s.company;
    const grid = (pairs) => `<div class="detail-grid">${pairs.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v || '—')}</strong></div>`).join('')}</div>`;

    return `<div class="cols-2">
      ${section(
        'Empresa',
        grid([
          ['Nombre comercial', c.tradeName],
          ['Razón social', c.legalName],
          [c.taxIdLabel, c.taxId],
          ['Dirección', [c.address, c.city, c.country].filter(Boolean).join(', ')],
          ['Email', c.email],
          ['Teléfono', c.phone],
          ['Web', c.website],
          ['Firma', `${c.signerName || '—'} · ${c.signerRole || ''}`],
        ]),
        btn('Editar', 'settings-company', { small: true })
      )}
      ${section(
        'Facturación',
        grid([
          ['Series', `COP: ${s.series.COP} · USD: ${s.series.USD} · MXN: ${s.series.MXN}`],
          ['Próximo consecutivo', `COP ${s.counters.invoice.COP} · USD ${s.counters.invoice.USD} · MXN ${s.counters.invoice.MXN}`],
          ['Plazo de pago', `${s.invoicing.defaultTermsDays} días`],
          ['Impuesto por defecto', `COP ${s.invoicing.taxRate.COP}% · USD ${s.invoicing.taxRate.USD}% · MXN ${s.invoicing.taxRate.MXN}%`],
        ]),
        btn('Editar', 'settings-invoicing', { small: true })
      )}
      ${section(
        'Cobro',
        grid([
          ['Datos COP', s.banking.copDetails],
          ['Datos USD', s.banking.usdDetails],
          ['Nota', s.banking.notes],
        ]),
        btn('Editar', 'settings-banking', { small: true })
      )}
      ${section(
        'Metas y tasa de cambio',
        grid([
          ['Contactos nuevos/día', String(s.goals.dailyProspects)],
          ['Meta de MRR', fmtMoney(s.goals.targetMrrCop, 'COP')],
          ['USD → COP', String(s.fx.usdToCop)],
          ['USD → MXN', String(s.fx.usdToMxn)],
        ]),
        btn('Editar', 'settings-goals', { small: true })
      )}
      ${relojSection(s)}
      ${paymentLinksSection(s)}
      ${mailSection(s)}
      ${outboundSection(s)}
      ${accessSection(s)}
    </div>
    ${section(
      'Dónde viven los datos',
      `<p class="muted">Todo se guarda en tu vault de Obsidian:</p>
       <ul class="mini-list">
        <li><code>Agency\\agency-os.json</code> — base de datos completa</li>
        <li><code>Agency\\Clientes\\</code> · <code>Propuestas\\</code> · <code>Contratos\\</code> · <code>Facturas\\</code> — espejo en markdown de cada documento</li>
       </ul>
       <p class="muted">Los espejos se reescriben solos cada vez que guardas algo aquí; edítalos en Obsidian solo para leer o enlazar.</p>`
    )}`;
  },
};

// ---------------------------------------------------------------------------
// Ajustes nuevos: cobro, correo, prospección y acceso
// ---------------------------------------------------------------------------

/* Los enlaces de pago se pegan tal como los entrega la pasarela. Deliberadamente
 * no hay integración por API: un enlace pegado cobra igual de rápido, no exige
 * claves guardadas en el vault y se puede cambiar de proveedor sin tocar código. */
function paymentLinksSection(s) {
  const links = (s.payments || {}).links || [];
  const rows = links.map((l) => ({
    cells: [
      esc(l.label || '—'),
      l.amount ? esc(fmtMoney(l.amount, l.currency)) : `<span class="muted">cualquier monto ${esc(l.currency)}</span>`,
      `<span class="muted">${esc(String(l.url).slice(0, 46))}${String(l.url).length > 46 ? '…' : ''}</span>`,
      btn('Editar', 'paylink-edit', { data: { id: l.id }, small: true }),
    ],
  }));

  return section(
    'Cobro con tarjeta',
    links.length
      ? table([{ label: 'Concepto' }, { label: 'Monto' }, { label: 'Enlace' }, { label: '' }], rows)
      : emptyState('Sin enlaces de pago. Sin uno, cada cierre en Estados Unidos agrega de una a tres semanas al cobro.'),
    btn('+ Enlace', 'paylink-new', { small: true, cls: 'btn-primary' })
  );
}

/* El reloj corre mientras el servidor corra. No es un servicio en la nube y no
 * conviene fingir que lo es: si el computador está apagado, el parte no se
 * escribe — pero al prender, el reloj ve que el día quedó pendiente y lo corre. */
function relojSection(s) {
  const r = s.reloj || {};
  const t = r.tareas || {};
  const corrioHoy = r.ultimaCorrida === today();
  const activas = ['vencerPropuestas', 'limpiarProspectos', 'abrirMes', 'importarVault', 'reportes', 'facturarBorradores'].filter(
    (k) => t[k] === true || (t[k] === undefined && k !== 'facturarBorradores')
  ).length;
  return section(
    'Lo que corre solo cada día',
    `<div class="detail-grid">
      <div><span>Estado</span><strong class="${r.activo ? 'ok' : 'warn'}">${r.activo ? 'Activo' : 'Apagado'}</strong></div>
      <div><span>Hora</span><strong>${esc(r.hora || '08:00')}</strong></div>
      <div><span>Última corrida</span><strong class="${corrioHoy ? 'ok' : ''}">${r.ultimaCorrida ? esc(fmtDate(r.ultimaCorrida)) : 'nunca'}</strong></div>
      <div><span>Aviso de renovación</span><strong>${esc(String(r.avisoRenovacionDias || 15))} días antes</strong></div>
      <div><span>Tareas encendidas</span><strong>${activas} de 6 opcionales</strong></div>
      <div><span>Gracia sin contacto</span><strong>${esc(String(r.graciaSinContactoDias ?? 3))} días</strong></div>
     </div>
     <p class="muted">Siempre: cierra secuencias agotadas, marca facturas en mora, avisa de renovaciones y clientes en riesgo, limpia espejos huérfanos y escribe el parte en <code>Agency\\Partes\\</code>. Además, lo que dejes encendido abajo. Los correos y las propuestas siguen esperando tu aprobación: eso sale hacia un cliente.</p>
     <p class="muted">La lista completa, con lo que hace cada tarea, está en <strong>Automatizaciones</strong>.</p>`,
    `${btn('Correr ahora', 'reloj-correr', { small: true, cls: 'btn-primary' })} ${btn('Editar', 'settings-reloj', { small: true })}`
  );
}

App.actions['reloj-correr'] = async () => {
  const r = await api.action('/api/reloj/correr', {});
  await refresh();
  openPanel(
    `Parte del ${r.fecha}`,
    `<pre class="msg-body">${esc(r.parte)}</pre>`,
    btn('Copiar', 'msg-copy-raw', { data: { text: r.parte }, cls: 'btn-primary' })
  );
};

App.actions['msg-copy-raw'] = (el) => copyText(el.dataset.text, 'Copiado');

App.actions['settings-reloj'] = () => {
  const s = App.state.settings;
  const r = s.reloj || {};
  const t = r.tareas || {};
  const on = (k, pordefecto) => (t[k] === undefined ? pordefecto : t[k]);
  openForm({
    title: 'Lo que corre solo',
    wide: true,
    intro:
      'Todo lo de aquí es cálculo sobre tus propios datos: nada sale hacia un cliente. Por eso puede correr sin preguntar. La única excepción es facturar, que viene apagada porque numerar una factura es un acto contable.',
    fields: [
      { name: 'activo', type: 'checkbox', value: r.activo !== false, checkLabel: 'Activado', width: 2 },
      { name: 'hora', label: 'A partir de qué hora', type: 'time', value: r.hora || '08:00' },
      { name: 'avisoRenovacionDias', label: 'Avisar renovación con', type: 'number', value: r.avisoRenovacionDias || 15, hint: 'Días de antelación.' },
      {
        name: 'graciaSinContactoDias',
        label: 'Gracia antes de descartar',
        type: 'number',
        value: r.graciaSinContactoDias ?? 3,
        hint: 'Días que espera un prospecto sin datos de contacto por si los completas a mano.',
      },
      { name: 'vencerPropuestas', type: 'checkbox', value: on('vencerPropuestas', true), checkLabel: 'Vencer las propuestas caducadas', width: 2 },
      { name: 'limpiarProspectos', type: 'checkbox', value: on('limpiarProspectos', true), checkLabel: 'Descartar los prospectos sin ningún dato de contacto', width: 2 },
      { name: 'abrirMes', type: 'checkbox', value: on('abrirMes', true), checkLabel: 'Abrir el mes de producción de los clientes activos', width: 2 },
      { name: 'importarVault', type: 'checkbox', value: on('importarVault', true), checkLabel: 'Importar del vault lo que produjeron los agentes', width: 2 },
      { name: 'reportes', type: 'checkbox', value: on('reportes', true), checkLabel: 'Armar los borradores de reporte del día 28 en adelante', width: 2 },
      {
        name: 'facturarBorradores',
        type: 'checkbox',
        value: on('facturarBorradores', false),
        checkLabel: 'Facturar las suscripciones cuyo corte ya pasó',
        width: 2,
      },
    ],
    onSubmit: async (v) => {
      const tareas = {
        vencerPropuestas: v.vencerPropuestas,
        limpiarProspectos: v.limpiarProspectos,
        abrirMes: v.abrirMes,
        importarVault: v.importarVault,
        reportes: v.reportes,
        facturarBorradores: v.facturarBorradores,
      };
      await api.settings({
        ...s,
        reloj: {
          ...r,
          activo: v.activo,
          hora: v.hora,
          avisoRenovacionDias: Number(v.avisoRenovacionDias),
          graciaSinContactoDias: Number(v.graciaSinContactoDias),
          tareas,
        },
      });
      toast('Reloj actualizado');
    },
  });
};

function mailSection(s) {
  const m = s.mail || {};
  const rt = (App.state.runtime && App.state.runtime.smtp) || { ready: false, reason: '' };
  return section(
    'Envío de correo',
    `<div class="detail-grid">
      <div><span>Remitente</span><strong>${esc(m.fromEmail || '—')}</strong></div>
      <div><span>Servidor</span><strong>${esc(m.smtp && m.smtp.host ? `${m.smtp.host}:${m.smtp.port}` : '—')}</strong></div>
      <div><span>Estado</span><strong class="${rt.ready ? 'ok' : 'warn'}">${rt.ready ? 'Envío automático activo' : 'Apagado'}</strong></div>
     </div>
     <p class="muted">${esc(rt.reason)}</p>
     <p class="muted">La contraseña nunca se guarda aquí: se lee de la variable de entorno <code>AGENCY_SMTP_PASS</code>, porque este archivo vive en el vault y el vault se sincroniza. Con Gmail hay que usar una contraseña de aplicación, no la de la cuenta.</p>`,
    btn('Editar', 'settings-mail', { small: true })
  );
}

function outboundSection(s) {
  const o = s.outbound || {};
  return section(
    'Prospección',
    `<div class="detail-grid">
      <div><span>Meta diaria</span><strong>${esc(String(o.dailyGoal || 10))} auditorías</strong></div>
      <div><span>Sector</span><strong>${esc(o.sector || '—')}</strong></div>
      <div><span>Link de agenda</span><strong>${esc(o.bookingUrl || '—')}</strong></div>
      <div><span>Caso de estudio</span><strong>${esc((o.caseStudy || '—').slice(0, 60))}</strong></div>
     </div>
     <p class="muted">Estos datos llenan las variables de los mensajes. Lo que quede vacío aparece como hueco en la cola del día y bloquea el envío — a propósito: es mejor ver el hueco que mandar un mensaje a medias.</p>`,
    btn('Editar', 'settings-outbound', { small: true })
  );
}

function accessSection(s) {
  const base = (s.publicBaseUrl || '').trim();
  const local = !base || base.includes('localhost') || base.includes('127.0.0.1');
  return section(
    'Enlaces públicos y acceso',
    `<div class="detail-grid">
      <div><span>Dirección pública</span><strong>${esc(base || '—')}</strong></div>
      <div><span>Llave de acceso</span><strong>${esc(String(s.security.accessKey || '').slice(0, 8))}…</strong></div>
     </div>
     ${
       local
         ? `<p class="muted warn">Los enlaces de propuestas, contratos y facturas apuntan a este computador, así que solo funcionan aquí. Para que un cliente pueda abrirlos hay que publicar el servidor con un túnel y poner esa dirección aquí.</p>`
         : `<p class="muted">Los documentos compartidos y el formulario de captación son públicos; todo lo demás exige la llave. Desde este computador nunca se pide.</p>`
     }`,
    btn('Editar', 'settings-access', { small: true })
  );
}

App.actions['paylink-new'] = () =>
  openForm({
    title: 'Nuevo enlace de pago',
    intro: 'Créalo en Stripe (Payment Links), Wise o Payoneer y pega aquí la URL. Un enlace sin monto sirve como enlace general de esa moneda.',
    fields: [
      { name: 'label', label: 'Concepto', required: true, width: 2, placeholder: 'Ej: Sprint de 14 días' },
      { name: 'amount', label: 'Monto', type: 'number', value: 0, hint: 'Cero = cualquier monto.' },
      { name: 'currency', label: 'Moneda', type: 'select', options: ['USD', 'COP', 'MXN'], value: 'USD' },
      { name: 'url', label: 'URL del enlace', required: true, width: 2, placeholder: 'https://buy.stripe.com/…' },
    ],
    onSubmit: async (v) => {
      const s = App.state.settings;
      const links = ((s.payments || {}).links || []).concat([{ id: `pl${Date.now().toString(36)}`, ...v }]);
      await api.settings({ ...s, payments: { ...(s.payments || {}), links } });
      toast('Enlace guardado');
    },
  });

App.actions['paylink-edit'] = (el) => {
  const s = App.state.settings;
  const l = ((s.payments || {}).links || []).find((x) => x.id === el.dataset.id);
  if (!l) return;
  openForm({
    title: 'Enlace de pago',
    fields: [
      { name: 'label', label: 'Concepto', value: l.label, required: true, width: 2 },
      { name: 'amount', label: 'Monto', type: 'number', value: l.amount || 0 },
      { name: 'currency', label: 'Moneda', type: 'select', options: ['USD', 'COP', 'MXN'], value: l.currency },
      { name: 'url', label: 'URL del enlace', value: l.url, required: true, width: 2 },
    ],
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        const links = ((s.payments || {}).links || []).filter((x) => x.id !== l.id);
        await api.settings({ ...s, payments: { ...(s.payments || {}), links } });
        toast('Enlace eliminado');
      },
    },
    onSubmit: async (v) => {
      const links = ((s.payments || {}).links || []).map((x) => (x.id === l.id ? { ...x, ...v } : x));
      await api.settings({ ...s, payments: { ...(s.payments || {}), links } });
      toast('Enlace actualizado');
    },
  });
};

App.actions['settings-mail'] = () => {
  const s = App.state.settings;
  const m = s.mail || {};
  const smtp = m.smtp || {};
  openForm({
    title: 'Envío de correo',
    wide: true,
    intro: 'Con Gmail: activa la verificación en dos pasos, crea una contraseña de aplicación y arranca el servidor con <code>AGENCY_SMTP_PASS=esa-contraseña npm start</code>.',
    fields: [
      { name: 'fromName', label: 'Nombre del remitente', value: m.fromName || '' },
      { name: 'fromEmail', label: 'Correo del remitente', type: 'email', value: m.fromEmail || '' },
      { name: 'replyTo', label: 'Responder a', type: 'email', value: m.replyTo || '' },
      { name: 'host', label: 'Servidor SMTP', value: smtp.host || 'smtp.gmail.com' },
      { name: 'port', label: 'Puerto', type: 'number', value: smtp.port || 587 },
      { name: 'user', label: 'Usuario SMTP', value: smtp.user || '' },
      { name: 'signature', label: 'Firma', type: 'textarea', rows: 3, width: 2, value: m.signature || '' },
    ],
    onSubmit: async (v) => {
      await api.settings({
        ...s,
        mail: {
          fromName: v.fromName,
          fromEmail: v.fromEmail,
          replyTo: v.replyTo,
          signature: v.signature,
          smtp: { host: v.host, port: Number(v.port), user: v.user, secure: Number(v.port) === 465 },
        },
      });
      toast('Correo configurado');
    },
  });
};

App.actions['settings-outbound'] = () => {
  const s = App.state.settings;
  const o = s.outbound || {};
  openForm({
    title: 'Prospección',
    wide: true,
    fields: [
      { name: 'dailyGoal', label: 'Auditorías por día', type: 'number', value: o.dailyGoal || 10 },
      { name: 'sector', label: 'Sector', value: o.sector || '', placeholder: 'med spas' },
      { name: 'bookingUrl', label: 'Link de agenda', value: o.bookingUrl || '', width: 2, placeholder: 'https://cal.com/…' },
      {
        name: 'caseStudy',
        label: 'Caso de estudio (variable {{caso}})',
        type: 'textarea',
        rows: 2,
        width: 2,
        value: o.caseStudy || '',
        placeholder: 'Una frase con un número. Ej: a un med spa en Hialeah le bajamos el costo por consulta de 90 a 38 dólares en tres semanas.',
      },
      {
        name: 'angles',
        label: 'Ángulos por defecto del guion',
        type: 'textarea',
        rows: 3,
        width: 2,
        value: o.angles || '',
      },
    ],
    onSubmit: async (v) => {
      await api.settings({ ...s, outbound: { ...o, ...v, dailyGoal: Number(v.dailyGoal) } });
      toast('Prospección actualizada');
    },
  });
};

App.actions['settings-access'] = () => {
  const s = App.state.settings;
  openForm({
    title: 'Enlaces públicos y acceso',
    wide: true,
    intro: 'La dirección pública es la que ve el cliente en el enlace de sus documentos. Con un túnel de Cloudflare: <code>cloudflared tunnel --url http://localhost:4180</code> y pega aquí la dirección que te devuelve.',
    fields: [
      { name: 'publicBaseUrl', label: 'Dirección pública', value: s.publicBaseUrl || '', width: 2, placeholder: 'https://algo.trycloudflare.com' },
      {
        name: 'accessKey',
        label: 'Llave de acceso',
        value: s.security.accessKey || '',
        width: 2,
        hint: 'Necesaria para entrar desde otro dispositivo, con ?k=LLAVE. Desde este computador nunca se pide.',
      },
    ],
    onSubmit: async (v) => {
      await api.settings({ ...s, publicBaseUrl: v.publicBaseUrl, security: { ...s.security, accessKey: v.accessKey } });
      toast('Acceso actualizado');
    },
  });
};

App.actions['settings-company'] = () => {
  const c = App.state.settings.company;
  openForm({
    title: 'Datos de la empresa',
    wide: true,
    fields: [
      { name: 'tradeName', label: 'Nombre comercial', value: c.tradeName, required: true },
      { name: 'legalName', label: 'Razón social', value: c.legalName },
      { name: 'taxIdLabel', label: 'Tipo de ID', type: 'select', options: ['NIT', 'CC', 'RFC', 'EIN'], value: c.taxIdLabel },
      { name: 'taxId', label: 'Identificación', value: c.taxId },
      { name: 'address', label: 'Dirección', value: c.address, width: 2 },
      { name: 'city', label: 'Ciudad', value: c.city },
      { name: 'country', label: 'País', value: c.country },
      { name: 'email', label: 'Email', type: 'email', value: c.email },
      { name: 'phone', label: 'Teléfono', value: c.phone },
      { name: 'website', label: 'Web', value: c.website },
      { name: 'signerName', label: 'Quién firma', value: c.signerName },
      { name: 'signerRole', label: 'Cargo', value: c.signerRole },
    ],
    onSubmit: async (v) => {
      await api.settings({ company: v });
      toast('Datos actualizados');
    },
  });
};

App.actions['settings-invoicing'] = () => {
  const s = App.state.settings;
  openForm({
    title: 'Facturación',
    wide: true,
    intro: 'El consecutivo solo avanza; cámbialo únicamente si estás migrando de otro sistema.',
    fields: [
      { name: 'sCOP', label: 'Serie COP', value: s.series.COP },
      { name: 'sUSD', label: 'Serie USD', value: s.series.USD },
      { name: 'sMXN', label: 'Serie MXN', value: s.series.MXN },
      { name: 'nCOP', label: 'Próximo N.º COP', type: 'number', value: s.counters.invoice.COP },
      { name: 'nUSD', label: 'Próximo N.º USD', type: 'number', value: s.counters.invoice.USD },
      { name: 'nMXN', label: 'Próximo N.º MXN', type: 'number', value: s.counters.invoice.MXN },
      { name: 'termsDays', label: 'Plazo de pago (días)', type: 'number', value: s.invoicing.defaultTermsDays },
      { name: 'taxCOP', label: 'IVA COP %', type: 'number', value: s.invoicing.taxRate.COP },
      { name: 'taxUSD', label: 'Tax USD %', type: 'number', value: s.invoicing.taxRate.USD },
      { name: 'taxMXN', label: 'IVA MXN %', type: 'number', value: s.invoicing.taxRate.MXN },
      { name: 'withholdingNote', label: 'Nota de retención', type: 'textarea', rows: 2, width: 2, value: s.invoicing.withholdingNote },
      { name: 'footerNote', label: 'Pie de documento', type: 'textarea', rows: 2, width: 2, value: s.invoicing.footerNote },
    ],
    onSubmit: async (v) => {
      await api.settings({
        series: { COP: v.sCOP, USD: v.sUSD, MXN: v.sMXN },
        counters: { invoice: { COP: v.nCOP, USD: v.nUSD, MXN: v.nMXN }, proposal: s.counters.proposal, contract: s.counters.contract },
        invoicing: {
          defaultTermsDays: v.termsDays,
          taxRate: { COP: v.taxCOP, USD: v.taxUSD, MXN: v.taxMXN },
          taxLabel: s.invoicing.taxLabel,
          withholdingNote: v.withholdingNote,
          footerNote: v.footerNote,
        },
      });
      toast('Facturación actualizada');
    },
  });
};

App.actions['settings-banking'] = () => {
  const b = App.state.settings.banking;
  openForm({
    title: 'Datos de cobro',
    wide: true,
    fields: [
      { name: 'copDetails', label: 'Cuenta COP', type: 'textarea', rows: 2, width: 2, value: b.copDetails },
      { name: 'usdDetails', label: 'Cuenta USD', type: 'textarea', rows: 2, width: 2, value: b.usdDetails },
      { name: 'notes', label: 'Nota', type: 'textarea', rows: 2, width: 2, value: b.notes },
    ],
    onSubmit: async (v) => {
      await api.settings({ banking: v });
      toast('Datos de cobro actualizados');
    },
  });
};

App.actions['settings-goals'] = () => {
  const s = App.state.settings;
  openForm({
    title: 'Metas y tasa de cambio',
    wide: true,
    fields: [
      { name: 'dailyProspects', label: 'Contactos nuevos/día', type: 'number', value: s.goals.dailyProspects },
      { name: 'targetMrrCop', label: 'Meta de MRR (COP)', type: 'number', value: s.goals.targetMrrCop },
      { name: 'usdToCop', label: 'USD → COP', type: 'number', value: s.fx.usdToCop },
      { name: 'usdToMxn', label: 'USD → MXN', type: 'number', value: s.fx.usdToMxn },
    ],
    onSubmit: async (v) => {
      await api.settings({
        goals: { dailyProspects: v.dailyProspects, targetMrrCop: v.targetMrrCop },
        fx: { usdToCop: v.usdToCop, usdToMxn: v.usdToMxn },
      });
      toast('Ajustes actualizados');
    },
  });
};
