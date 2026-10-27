/* Agency OS — router, eventos y arranque. */

function go(view) {
  if (App.view !== view) App.ctx.clientId = null;
  App.view = view;
  render();
}

function updateSidebar() {
  const s = App.state;
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = n ? String(n) : '';
  };
  // En Hoy importa lo que está vencido o vence hoy: es la carga real del día.
  const hoy = today();
  set('count-hoy', (s.touches || []).filter((t) => t.status === 'pendiente' && t.dueDate <= hoy).length);
  set('count-prospeccion', s.deals.filter((d) => d.audit && d.audit.status !== 'grabada' && d.stage === 'nuevo').length);
  set('count-crm', s.deals.filter((d) => OPEN_STAGES.includes(d.stage)).length);
  // En la Ruta importa lo que llegó por formulario y nadie ha respondido.
  set('count-ruta', s.deals.filter((d) => d.application && d.stage === 'nuevo').length);
  set('count-clientes', s.clients.filter((c) => c.status === 'activo').length);
  set('count-propuestas', s.proposals.filter((p) => p.status === 'enviada').length);
  set('count-contratos', s.contracts.filter((c) => c.status !== 'firmado' && c.status !== 'terminado').length);
  set('count-suscripciones', s.subscriptions.filter((x) => x.status === 'activa').length);
  set('count-facturas', s.invoices.filter((i) => i.status === 'enviada' || i.status === 'vencida').length);
  set('count-produccion', s.pieces.filter((p) => !isDelivered(p)).length);
  set('count-reportes', s.reports.filter((r) => r.status !== 'enviado').length);
  set('count-automatizaciones', (s.jobs || []).filter((j) => j.status === 'pendiente').length);
  // En Despacho importa lo que espera decisión: generado o aprobado sin salir.
  set('count-despacho', (s.assets || []).filter((a) => a.estado === 'generado' || a.estado === 'aprobado').length);
  set('count-campanas', (s.campaigns || []).filter((c) => c.estado === 'activa').length);

  // La marca sale de Ajustes → Empresa: el sistema es de quien lo usa, así que
  // el nombre de arriba es el del negocio, no el del programa.
  const marca = s.settings.company.tradeName || 'Cyclone AI';
  document.getElementById('brand-name').textContent = marca;
  const mark = document.getElementById('brand-mark');
  if (mark) mark.textContent = marca.trim().charAt(0).toUpperCase() || 'C';
  document.title = `${marca} · Agency OS`;
  document.getElementById('mrr-mini-value').textContent = fmtShort(mrrCop(), 'COP');

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === App.view);
  });

  /* Si la vista activa vive en el segundo nivel, el cajón se abre solo. Sin
   * esto, entrar a Facturas desde un enlace dejaba la barra mostrando cuatro
   * botones y ninguno marcado: la aplicación parecía haberse perdido. */
  const resto = document.getElementById('nav-resto');
  if (resto && resto.querySelector(`.nav-item[data-view="${App.view}"]`)) App.ctx.navAbierto = true;
  if (resto) resto.hidden = !App.ctx.navAbierto;
  const mas = document.getElementById('nav-mas');
  if (mas) mas.classList.toggle('abierto', !!App.ctx.navAbierto);
}

App.actions['nav-toggle'] = () => {
  App.ctx.navAbierto = !App.ctx.navAbierto;
  updateSidebar();
};

function render() {
  const view = App.views[App.view] || App.views.panel;
  const host = document.getElementById('view');
  const cambioDeVista = App.ctx.pintada !== App.view;

  document.getElementById('view-title').textContent = view.title;
  document.getElementById('view-sub').textContent = view.sub || '';
  document.getElementById('topbar-actions').innerHTML = view.actions ? view.actions() : '';
  host.innerHTML = view.render();

  /* La entrada solo corre cuando de verdad cambiaste de pestaña. Repintar
   * después de guardar algo no es llegar a otro sitio: animarlo ahí sería
   * movimiento sin significado, y encima haría parpadear la tabla que acabas
   * de tocar. */
  if (cambioDeVista && host.classList) {
    host.classList.remove('entering');
    void host.offsetWidth; // reinicia la animación aunque sea la misma clase
    host.classList.add('entering');
  }
  App.ctx.pintada = App.view;

  updateSidebar();
  localStorage.setItem('agency-os-view', App.view);
}

// ---------------------------------------------------------------------------
// Eventos globales
// ---------------------------------------------------------------------------

/* De dónde nace lo que se abre.
 *
 * Se guarda en el `pointerdown`, no en el `click`: es el instante real de la
 * intención, y para entonces el panel todavía no existe. Con ese punto, el
 * modal crece desde el botón que lo pidió en vez de aparecer en el centro de
 * la pantalla como si no viniera de ninguna parte. */
document.addEventListener('pointerdown', (ev) => {
  App.ctx.pressPoint = { x: ev.clientX, y: ev.clientY };
});

document.addEventListener('click', async (ev) => {
  const nav = ev.target.closest('.nav-item');
  if (nav) return go(nav.dataset.view);

  const target = ev.target.closest('[data-act]');
  if (!target) return;
  // Los inputs con data-act (checkboxes, selects) se atienden en 'change';
  // si también los atendiéramos aquí, la acción correría dos veces.
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
  const act = target.dataset.act;

  if (act === 'modal-close') return closeModal();
  if (act === 'modal-submit') return submitModal();
  if (act === 'modal-danger') {
    const fn = App.ctx.modalDanger;
    if (!fn) return;
    try {
      await fn();
      closeModal();
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  // Editor de líneas dentro del modal.
  if (act === 'item-add') {
    modalItems.push({ description: '', qty: 1, unitPrice: 0 });
    return renderItemsEditor();
  }
  if (act === 'item-del') {
    modalItems.splice(Number(target.dataset.i), 1);
    return renderItemsEditor();
  }

  const handler = App.actions[act];
  if (!handler) return;
  try {
    await handler(target, ev);
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset && el.dataset.item !== undefined) {
    const it = modalItems[Number(el.dataset.item)];
    if (!it) return;
    const key = el.dataset.key;
    it[key] = key === 'description' ? el.value : Number(el.value || 0);
    // Solo refrescamos los totales para no perder el foco mientras se escribe.
    const cur = document.querySelector('[name="currency"]');
    const currency = cur ? cur.value : 'COP';
    const row = el.closest('tr');
    if (row) row.querySelector('.w-total').textContent = fmtMoney(lineTotal(it), currency);
    const sub = document.querySelector('.items-subtotal strong');
    if (sub) sub.textContent = fmtMoney(modalItems.reduce((s, x) => s + lineTotal(x), 0), currency);
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;

  if (el.id === 'catalog-pick' && el.value) {
    const svc = byId('services', el.value);
    const cur = document.querySelector('[name="currency"]');
    const currency = cur ? cur.value : 'COP';
    const price = currency === 'USD' ? svc.priceUSD : currency === 'MXN' ? svc.priceUSD * (App.state.settings.fx.usdToMxn || 18) : svc.priceCOP;
    modalItems.push({
      description: svc.name,
      detail: (svc.deliverables || []).join(' · '),
      qty: 1,
      unitPrice: price,
      billing: svc.billing,
      serviceId: svc.id,
    });
    el.value = '';
    return renderItemsEditor();
  }

  // Cambiar la moneda recalcula el impuesto sugerido y repinta los totales.
  if (el.name === 'currency') {
    const tax = document.querySelector('[name="taxRate"]');
    if (tax) tax.value = App.state.settings.invoicing.taxRate[el.value] ?? 0;
    renderItemsEditor();
  }

  // El tipo de pieza define su flujo: al cambiarlo, cambian los estados posibles.
  if (el.name === 'type') {
    const status = document.querySelector('[name="status"]');
    const flow = flowOf({ type: el.value });
    if (status && flow) {
      const prev = status.value;
      status.innerHTML = flow.map((s) => `<option value="${s}">${s}</option>`).join('');
      status.value = flow.includes(prev) ? prev : flow[0];
    }
  }

  // Cambiar la etapa sugiere la probabilidad de esa etapa.
  if (el.name === 'stage') {
    const st = STAGES.find((s) => s.id === el.value);
    const prob = document.querySelector('[name="probability"]');
    if (st && prob) prob.value = st.prob;
  }

  const act = el.dataset && el.dataset.act;
  if (act && App.actions[act]) {
    try {
      await App.actions[act](el, ev);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

// Enter dentro del formulario del modal guarda, en vez de recargar la página.
document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (ev.target.id === 'modal-form' && modalSubmit) submitModal();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !document.getElementById('modal-backdrop').hidden) closeModal();
});

document.getElementById('modal-backdrop').addEventListener('mousedown', (ev) => {
  if (ev.target.id === 'modal-backdrop') closeModal();
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

(async function init() {
  try {
    App.state = await api.state();
    // Se abre en Hoy, no en Panel: la portada es la meta del dia, no el
    // consolidado. El Panel sigue existiendo para cuando toca mirar el negocio
    // entero, que es una vez por semana, no cada vez que se abre la app.
    App.view = localStorage.getItem('agency-os-view') || 'hoy';
    if (!App.views[App.view]) App.view = 'hoy';
    render();
  } catch (err) {
    document.getElementById('view').innerHTML = `<div class="empty"><p>No se pudo cargar el estado: ${esc(err.message)}</p></div>`;
  }
})();
