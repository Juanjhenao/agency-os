/* Agency OS — núcleo: estado, API, helpers y componentes de UI. */

const App = {
  state: null,
  view: 'panel',
  views: {},
  ctx: {}, // filtros/selección por vista
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Error de servidor');
  }
  return res.json();
}

const api = {
  state: () => req('GET', '/api/state'),
  create: (col, data) => req('POST', `/api/${col}`, data),
  update: (col, id, data) => req('PUT', `/api/${col}/${id}`, data),
  remove: (col, id) => req('DELETE', `/api/${col}/${id}`),
  settings: (s) => req('PUT', '/api/settings', s),
  onboardingTemplate: (steps) => req('PUT', '/api/onboarding-template', { steps }),
  action: (path, body) => req('POST', path, body || {}),
  // Lecturas que no son el estado completo: el tablero de marketing se calcula
  // en el servidor y no cabe en /api/state.
  get: (path) => req('GET', path),
};

async function refresh() {
  App.state = await api.state();
  render();
  /* La celebración va después de pintar, comparando el estado nuevo contra el
   * anterior. Colgarla de cada manejador de clic habría dejado muda toda la
   * parte del sistema que corre sola —el reloj, los agentes— que es justo
   * hacia donde va este producto. Así festeja igual lo que hace Juanjo y lo
   * que aparece solo. */
  if (typeof celebrarCambios === 'function') celebrarCambios(App.state.juego);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months || 0));
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

// Días desde hoy hasta la fecha (negativo = ya pasó).
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const a = new Date(`${today()}T00:00:00`);
  const b = new Date(`${dateStr}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function fmtMoney(amount, currency) {
  const cur = currency || 'COP';
  const dec = cur === 'COP' ? 0 : 2;
  return `${Number(amount || 0).toLocaleString('es-CO', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })} ${cur}`;
}

function fmtShort(amount, currency) {
  const n = Number(amount || 0);
  const cur = currency || 'COP';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B ${cur}`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M ${cur}`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K ${cur}`;
  return fmtMoney(n, cur);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Convierte cualquier moneda a COP para poder consolidar.
function toCop(amount, currency) {
  const fx = App.state.settings.fx || {};
  const n = Number(amount || 0);
  if (currency === 'USD') return n * Number(fx.usdToCop || 4000);
  if (currency === 'MXN') return (n / Number(fx.usdToMxn || 18)) * Number(fx.usdToCop || 4000);
  return n;
}

function lineTotal(it) {
  return Number(it.qty || 0) * Number(it.unitPrice || 0);
}

function computeTotals(doc) {
  const subtotal = (doc.items || []).reduce((s, it) => s + lineTotal(it), 0);
  const discount = Number(doc.discount || 0);
  const base = Math.max(subtotal - discount, 0);
  const tax = base * (Number(doc.taxRate || 0) / 100);
  const withholding = Number(doc.withholding || 0);
  return { subtotal, discount, base, tax, withholding, total: base + tax - withholding };
}

function byId(col, id) {
  return (App.state[col] || []).find((x) => x.id === id) || null;
}

function clientName(id) {
  const c = byId('clients', id);
  return c ? c.name : '—';
}

function clientOptions(includeEmpty) {
  const opts = App.state.clients
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name }));
  return includeEmpty ? [{ value: '', label: '— sin cliente —' }].concat(opts) : opts;
}

function sortBy(arr, key, dir) {
  const d = dir === 'desc' ? -1 : 1;
  return arr.slice().sort((a, b) => {
    const av = a[key] === undefined || a[key] === null ? '' : a[key];
    const bv = b[key] === undefined || b[key] === null ? '' : b[key];
    if (av < bv) return -1 * d;
    if (av > bv) return 1 * d;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Estados visuales
// ---------------------------------------------------------------------------

const STATUS_TONE = {
  borrador: 'gray',
  enviada: 'blue',
  enviado: 'blue',
  aceptada: 'green',
  rechazada: 'red',
  vencida: 'red',
  pagada: 'green',
  anulada: 'gray',
  firmado: 'green',
  terminado: 'gray',
  activa: 'green',
  activo: 'green',
  pausada: 'amber',
  pausado: 'amber',
  cancelada: 'red',
  lead: 'blue',
  prospecto: 'blue',
  perdido: 'red',
  ganado: 'green',
};

function badge(text, tone) {
  const t = tone || STATUS_TONE[String(text).toLowerCase()] || 'gray';
  return `<span class="badge badge-${t}">${esc(text)}</span>`;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function toast(message, tone) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast toast-${tone || 'ok'}`;
  el.textContent = message;
  wrap.appendChild(el);
  // Un error que solo se ve se pierde cuando la vista está en otro sitio de la
  // pantalla. `juego.js` puede no estar cargado (las pruebas cargan core suelto).
  if (tone === 'error' && typeof sonidoErrorUI === 'function') sonidoErrorUI();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ---------------------------------------------------------------------------
// Modal + formularios
// ---------------------------------------------------------------------------

let modalSubmit = null;
let modalItems = [];

/* Movimiento del modal.
 *
 * Tres reglas que vienen del diseño de interfaces fluidas de Apple, y que aquí
 * cambian cosas concretas:
 *
 *   1. Toda animación tiene que poder interrumpirse. Si cierras el panel y lo
 *      vuelves a abrir antes de que termine de irse, no se espera a que acabe:
 *      arranca desde donde está en pantalla en ese instante.
 *   2. Por eso se anima desde el valor *presentado* (lo que se ve ahora), nunca
 *      desde el valor lógico. Arrancar del valor lógico produce el salto.
 *   3. Entra y sale por el mismo camino, anclado al botón que lo abrió.
 *
 * Se usa la Web Animations API en vez de una transición CSS porque una
 * transición no se puede agarrar a mitad de vuelo; `animate()` sí, y además
 * deja leer el estado real del elemento antes de reemplazarla.
 */

const MODAL_ABRE_MS = 340;
const MODAL_CIERRA_MS = 200;
let modalGen = 0; // Ignora el final de una animación que ya quedó vieja.

function puedeAnimar(el) {
  return Boolean(el) && typeof el.animate === 'function' && typeof getComputedStyle === 'function';
}

// Reducir movimiento no es quitar la respuesta: es cambiarla por un cruce de
// opacidad que no desplaza nada.
function menosMovimiento() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Reemplaza lo que esté corriendo, arrancando desde lo que se ve ahora mismo.
function animarDesdeLoVisible(el, hasta, ms) {
  if (!puedeAnimar(el)) return null;
  const ahora = getComputedStyle(el);
  const suave = menosMovimiento();
  const desde = suave
    ? { opacity: ahora.opacity }
    : { transform: ahora.transform === 'none' ? 'none' : ahora.transform, opacity: ahora.opacity };
  const meta = suave ? { opacity: hasta.opacity } : hasta;
  el.getAnimations().forEach((a) => a.cancel());
  const easing = suave ? 'ease-out' : getComputedStyle(document.documentElement).getPropertyValue('--spring-snappy').trim() || 'ease-out';
  return el.animate([desde, meta], { duration: suave ? 140 : ms, easing, fill: 'both' });
}

/* Ancla el panel al punto donde se hizo el último clic. Un menú o un panel que
 * nace del botón que lo pidió hace obvia la relación entre los dos; uno que
 * nace del centro de la pantalla la esconde. */
function anclarModal(modal) {
  const p = App.ctx.pressPoint;
  if (!p || !modal.getBoundingClientRect || !modal.style) return;
  const caja = modal.getBoundingClientRect();
  if (!caja.width || !caja.height) return;
  const x = Math.max(0, Math.min(100, ((p.x - caja.left) / caja.width) * 100));
  const y = Math.max(0, Math.min(100, ((p.y - caja.top) / caja.height) * 100));
  modal.style.setProperty('--origin-x', `${x.toFixed(1)}%`);
  modal.style.setProperty('--origin-y', `${y.toFixed(1)}%`);
}

/* Abre la superficie. El material no aparece por opacidad: crece y se
 * materializa a la vez, para que se lea como algo que llega y no como algo que
 * se enciende. */
function mostrarModal() {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  modalGen += 1;
  backdrop.hidden = false;

  // Sin motor de animación (navegador viejo, o el DOM de las pruebas) el panel
  // tiene que quedar visible igual: la animación es la mejora, no el mecanismo.
  if (!puedeAnimar(modal)) {
    if (modal.style) {
      modal.style.opacity = '1';
      modal.style.transform = 'none';
    }
    if (backdrop.style) backdrop.style.opacity = '1';
    return;
  }

  anclarModal(modal);
  animarDesdeLoVisible(backdrop, { opacity: 1 }, 180);
  animarDesdeLoVisible(modal, { transform: 'scale(1) translateY(0)', opacity: 1 }, MODAL_ABRE_MS);
}

function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const gen = (modalGen += 1);

  // El estado se limpia de inmediato: que el panel siga en pantalla 300ms más
  // no puede significar que un Enter tardío vuelva a guardar.
  modalSubmit = null;
  modalItems = [];
  App.ctx.modalDanger = null;

  const terminar = () => {
    if (gen !== modalGen) return; // Lo volvieron a abrir mientras se iba.
    backdrop.hidden = true;
    document.getElementById('modal-body').innerHTML = '';
    document.getElementById('modal-foot').innerHTML = '';
  };

  const salida = animarDesdeLoVisible(modal, { transform: 'scale(0.96) translateY(-6px)', opacity: 0 }, MODAL_CIERRA_MS);
  animarDesdeLoVisible(backdrop, { opacity: 0 }, MODAL_CIERRA_MS);
  if (!salida) return terminar();
  salida.addEventListener('finish', terminar);
}

function fieldHTML(f) {
  const val = f.value === undefined || f.value === null ? '' : f.value;
  const width = f.width ? ` style="grid-column: span ${f.width}"` : '';
  const req = f.required ? ' required' : '';
  let input = '';

  if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" rows="${f.rows || 4}"${req} placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || [])
      .map((o) => {
        const ov = typeof o === 'string' ? o : o.value;
        const ol = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(ov)}"${String(ov) === String(val) ? ' selected' : ''}>${esc(ol)}</option>`;
      })
      .join('');
    input = `<select name="${f.name}"${req}>${opts}</select>`;
  } else if (f.type === 'checkbox') {
    input = `<label class="check"><input type="checkbox" name="${f.name}"${val ? ' checked' : ''}> ${esc(f.checkLabel || '')}</label>`;
  } else if (f.type === 'lines') {
    const text = Array.isArray(val) ? val.join('\n') : val;
    input = `<textarea name="${f.name}" rows="${f.rows || 4}" data-lines="1" placeholder="${esc(f.placeholder || 'Una por línea')}">${esc(text)}</textarea>`;
  } else if (f.type === 'services') {
    const chosen = new Set(f.value || []);
    input = `<div class="svc-picker">${App.state.services
      .filter((s) => s.active !== false)
      .map(
        (s) => `<label class="svc-opt">
          <input type="checkbox" name="service:${s.id}"${chosen.has(s.id) ? ' checked' : ''}>
          <span><strong>${esc(s.name)}</strong><em>${esc(fmtMoney(s.priceCOP, 'COP'))} · ${esc(s.billing)}</em></span>
        </label>`
      )
      .join('')}</div>`;
  } else if (f.type === 'items') {
    modalItems = (f.value || []).map((it) => ({ ...it }));
    input = `<div class="items-editor" id="items-editor"></div>`;
  } else if (f.type === 'static') {
    input = `<div class="static-value">${f.html || esc(val)}</div>`;
  } else {
    const step = f.type === 'number' ? ' step="any"' : '';
    input = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}"${step}${req} placeholder="${esc(f.placeholder || '')}">`;
  }

  return `<div class="field"${width}>
    ${f.label ? `<label>${esc(f.label)}${f.required ? ' <i>*</i>' : ''}</label>` : ''}
    ${input}
    ${f.hint ? `<small>${esc(f.hint)}</small>` : ''}
  </div>`;
}

function renderItemsEditor() {
  const box = document.getElementById('items-editor');
  if (!box) return;
  const cur = document.querySelector('[name="currency"]');
  const currency = cur ? cur.value : 'COP';
  const rows = modalItems
    .map(
      (it, i) => `<tr>
        <td><input value="${esc(it.description || '')}" data-item="${i}" data-key="description" placeholder="Concepto"></td>
        <td class="w-qty"><input type="number" step="any" value="${esc(it.qty ?? 1)}" data-item="${i}" data-key="qty"></td>
        <td class="w-price"><input type="number" step="any" value="${esc(it.unitPrice ?? 0)}" data-item="${i}" data-key="unitPrice"></td>
        <td class="w-total num">${esc(fmtMoney(lineTotal(it), currency))}</td>
        <td class="w-x"><button type="button" class="icon-btn" data-act="item-del" data-i="${i}">✕</button></td>
      </tr>`
    )
    .join('');

  const catalog = App.state.services
    .filter((s) => s.active !== false)
    .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
    .join('');

  const subtotal = modalItems.reduce((s, it) => s + lineTotal(it), 0);

  box.innerHTML = `
    <table class="items-table">
      <thead><tr><th>Concepto</th><th class="w-qty">Cant.</th><th class="w-price">Valor unit.</th><th class="w-total">Total</th><th class="w-x"></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">Sin líneas todavía</td></tr>'}</tbody>
    </table>
    <div class="items-bar">
      <select id="catalog-pick"><option value="">+ Agregar del catálogo…</option>${catalog}</select>
      <button type="button" class="btn btn-ghost" data-act="item-add">+ Línea vacía</button>
      <span class="items-subtotal">Subtotal: <strong>${esc(fmtMoney(subtotal, currency))}</strong></span>
    </div>`;
}

function openForm(opts) {
  document.getElementById('modal-title').textContent = opts.title;
  document.getElementById('modal').className = `modal ${opts.wide ? 'modal-wide' : ''}`;
  modalItems = [];
  document.getElementById('modal-body').innerHTML = `
    ${opts.intro ? `<p class="modal-intro">${opts.intro}</p>` : ''}
    <form id="modal-form" class="form-grid">${(opts.fields || []).map(fieldHTML).join('')}</form>`;
  document.getElementById('modal-foot').innerHTML = `
    ${opts.danger ? `<button class="btn btn-danger-ghost" data-act="modal-danger">${esc(opts.danger.label)}</button>` : ''}
    <span class="spacer"></span>
    <button class="btn btn-ghost" data-act="modal-close">Cancelar</button>
    <button class="btn btn-primary" data-act="modal-submit">${esc(opts.submitLabel || 'Guardar')}</button>`;
  mostrarModal();
  modalSubmit = opts.onSubmit;
  App.ctx.modalDanger = opts.danger ? opts.danger.onClick : null;
  renderItemsEditor();
  const first = document.querySelector('#modal-form input, #modal-form select, #modal-form textarea');
  if (first) first.focus();
}

function collectForm() {
  const form = document.getElementById('modal-form');
  const values = {};
  const services = [];
  Array.from(form.elements).forEach((el) => {
    if (!el.name) return;
    if (el.name.startsWith('service:')) {
      if (el.checked) services.push(el.name.slice(8));
      return;
    }
    if (el.type === 'checkbox') values[el.name] = el.checked;
    else if (el.dataset.lines) values[el.name] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (el.type === 'number') values[el.name] = el.value === '' ? 0 : Number(el.value);
    else values[el.name] = el.value;
  });
  if (document.getElementById('items-editor')) values.items = modalItems;
  if (document.querySelector('.svc-picker')) values.serviceIds = services;
  return values;
}

async function submitModal() {
  const form = document.getElementById('modal-form');
  if (form && !form.reportValidity()) return;
  const values = collectForm();
  try {
    await modalSubmit(values);
    closeModal();
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function confirmAction(message, onYes, yesLabel) {
  openForm({
    title: 'Confirmar',
    intro: esc(message),
    fields: [],
    submitLabel: yesLabel || 'Sí, continuar',
    onSubmit: onYes,
  });
}

// ---------------------------------------------------------------------------
// Tablas y bloques reutilizables
// ---------------------------------------------------------------------------

function table(cols, rows, emptyMsg) {
  if (!rows.length) return emptyState(emptyMsg || 'Nada por aquí todavía.');
  const head = cols.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr${r._attrs || ''}>${cols
          .map((c, i) => `<td class="${c.align === 'right' ? 'num' : ''}">${r.cells[i]}</td>`)
          .join('')}</tr>`
    )
    .join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function emptyState(msg, actionHTML) {
  return `<div class="empty"><p>${esc(msg)}</p>${actionHTML || ''}</div>`;
}

function kpi(label, value, sub, tone) {
  return `<div class="kpi ${tone ? `kpi-${tone}` : ''}">
    <span class="kpi-label">${esc(label)}</span>
    <strong class="kpi-value">${value}</strong>
    ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
  </div>`;
}

function section(title, contentHTML, actionHTML) {
  return `<section class="card">
    <header class="card-head"><h2>${esc(title)}</h2>${actionHTML || ''}</header>
    ${contentHTML}
  </section>`;
}

function btn(label, act, opts) {
  const o = opts || {};
  const data = Object.entries(o.data || {})
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join('');
  return `<button class="btn ${o.cls || 'btn-ghost'} ${o.small ? 'btn-sm' : ''}" data-act="${act}"${data}>${label}</button>`;
}

// ---------------------------------------------------------------------------
// Impresión
// ---------------------------------------------------------------------------

function printDocument(html) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  document.body.classList.add('printing');
  window.print();
  setTimeout(() => document.body.classList.remove('printing'), 500);
}

function companyHeaderHTML() {
  const c = App.state.settings.company;
  return `<div class="p-company">
    <strong>${esc(c.legalName || c.tradeName)}</strong>
    ${c.taxId ? `<span>${esc(c.taxIdLabel)} ${esc(c.taxId)}</span>` : ''}
    ${c.address ? `<span>${esc(c.address)}${c.city ? `, ${esc(c.city)}` : ''}</span>` : ''}
    ${c.email ? `<span>${esc(c.email)}</span>` : ''}
    ${c.phone ? `<span>${esc(c.phone)}</span>` : ''}
    ${c.website ? `<span>${esc(c.website)}</span>` : ''}
  </div>`;
}
