/* Documentos con enlace publico: ver, aceptar, firmar y pagar.
 *
 * Antes, cerrar significaba imprimir a PDF, adjuntar, esperar a que el cliente
 * imprimiera, firmara, escaneara y devolviera. Nadie en Estados Unidos hace eso
 * por un servicio de 1.800 al mes; el ciclo de firma era el paso mas lento del
 * cierre y el que mas negocios enfria.
 *
 * Ahora cada propuesta, contrato y factura tiene un enlace propio. El cliente lo
 * abre en el telefono, lo lee, escribe su nombre y acepta. Y de paso el sistema
 * sabe cuando lo abrio y cuantas veces — que es exactamente lo que hay que saber
 * antes de escribir el seguimiento.
 *
 * Sobre la validez de la firma: lo que se guarda es el paquete de evidencia que
 * pide la ley ESIGN/UETA para una firma electronica simple — quien acepto, con
 * que correo, desde que direccion IP, en que momento exacto, sobre que texto
 * (guardado como huella SHA-256, para poder probar despues que el documento no
 * cambio). Para contratos de este tamano es el estandar de la industria. No
 * reemplaza a un notario ni a una firma digital certificada.
 */

const crypto = require('crypto');
const { nowISO, today } = require('./dates');
const { computeTotals, money } = require('./money');

const SHAREABLE = {
  proposals: { label: 'Propuesta', accept: 'aceptar' },
  contracts: { label: 'Contrato', accept: 'firmar' },
  invoices: { label: 'Factura', accept: 'pagar' },
};

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

function hashOf(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/* Un documento solo tiene enlace si se pidio explicitamente. No se generan por
 * adelantado: un token que existe es un token que puede filtrarse. */
function ensureShare(doc) {
  if (!doc.share || !doc.share.token) {
    doc.share = { token: newToken(), createdAt: nowISO(), views: [] };
  }
  return doc.share;
}

function revokeShare(doc) {
  if (doc.share) doc.share.revokedAt = nowISO();
  return doc;
}

function publicUrl(settings, token) {
  const base = String((settings && settings.publicBaseUrl) || '').replace(/\/+$/, '');
  return `${base || 'http://localhost:4180'}/d/${token}`;
}

function findByToken(state, token) {
  for (const collection of Object.keys(SHAREABLE)) {
    const doc = (state[collection] || []).find((d) => d.share && d.share.token === token);
    if (doc) return { collection, doc };
  }
  return null;
}

function clientIp(req) {
  const fwd = req.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : '').trim() || req.ip || req.socket.remoteAddress || '';
}

/* Registra la apertura. Se guardan las ultimas 50 y se ignoran las repetidas en
 * menos de dos minutos, para que recargar la pagina no infle el contador. */
function logView(doc, req) {
  const share = ensureShare(doc);
  share.views = share.views || [];
  const last = share.views[share.views.length - 1];
  const now = Date.now();
  if (last && now - new Date(last.at).getTime() < 120000) return share;
  share.views.push({ at: nowISO(), ip: clientIp(req), ua: String(req.get('user-agent') || '').slice(0, 160) });
  if (share.views.length > 50) share.views = share.views.slice(-50);
  return share;
}

// ---------------------------------------------------------------------------
// Aceptacion
// ---------------------------------------------------------------------------

function documentText(collection, doc) {
  if (collection === 'contracts') return doc.body || '';
  return JSON.stringify({ number: doc.number, items: doc.items, totals: computeTotals(doc) });
}

function accept(state, collection, doc, data, req) {
  const name = String(data.name || '').trim();
  const email = String(data.email || '').trim();
  if (!name) throw new Error('Falta el nombre de quien acepta.');
  if (!data.agree) throw new Error('Falta marcar la casilla de aceptacion.');

  doc.acceptance = {
    name,
    email,
    role: String(data.role || '').trim(),
    at: nowISO(),
    date: today(),
    ip: clientIp(req),
    userAgent: String(req.get('user-agent') || '').slice(0, 300),
    documentHash: hashOf(documentText(collection, doc)),
    statement:
      collection === 'contracts'
        ? 'Declaro que he leido el contrato completo, que tengo facultad para obligar a la empresa y que acepto su contenido. Esta aceptacion electronica tiene el mismo efecto que una firma manuscrita.'
        : 'Declaro que acepto esta propuesta en los terminos, alcance y precio indicados.',
  };

  if (collection === 'proposals') {
    doc.status = 'aceptada';
    doc.acceptedDate = today();
  }
  if (collection === 'contracts') {
    doc.status = 'firmado';
    doc.signedDate = today();
    doc.signedBy = name;
  }
  doc.updatedAt = nowISO();
  return doc.acceptance;
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

/* El enlace de pago que le corresponde a un documento. Puede venir puesto a
 * mano en el documento, o salir del catalogo de enlaces de Ajustes buscando el
 * que coincida en moneda y monto. */
function paymentLinkFor(settings, doc) {
  if (doc.paymentLink) return { url: doc.paymentLink, label: 'Pagar ahora' };
  const links = ((settings.payments || {}).links || []).filter((l) => l.url);
  if (!links.length) return null;
  const total = computeTotals(doc).total;
  const exact = links.find(
    (l) => l.currency === doc.currency && Math.abs(Number(l.amount || 0) - total) < 0.5
  );
  const byCurrency = links.find((l) => l.currency === doc.currency && !Number(l.amount));
  const chosen = exact || byCurrency;
  return chosen ? { url: chosen.url, label: chosen.label || 'Pagar ahora' } : null;
}

// ---------------------------------------------------------------------------
// La pagina
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

const PAGE_CSS = `
:root{--ink:#15201c;--muted:#5d6b65;--line:#dfe5e0;--paper:#fff;--bg:#f4f6f3;--accent:#0e5c46;--accent-ink:#fff;--warn:#8c6410}
@media (prefers-color-scheme:dark){:root{--ink:#e6ebe7;--muted:#9aa8a1;--line:#27312d;--paper:#141b19;--bg:#0d1211;--accent:#57c39c;--accent-ink:#08120f;--warn:#d6a44a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px 16px 80px}
.sheet{max-width:760px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:clamp(20px,5vw,44px)}
.top{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:20px;margin-bottom:24px}
.co strong{display:block;font-size:1.05rem}
.co span{display:block;color:var(--muted);font-size:.85rem}
.meta{text-align:right}
.meta h1{margin:0;font-size:1.35rem;letter-spacing:-.02em}
.meta b{display:block;font-family:ui-monospace,Consolas,monospace;font-size:1.05rem;margin:4px 0}
.meta span{display:block;color:var(--muted);font-size:.85rem}
.to{background:var(--bg);border-radius:4px;padding:14px 16px;margin-bottom:24px}
.to em{font-style:normal;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:4px}
h2.title{font-size:1.3rem;letter-spacing:-.02em;margin:0 0 12px}
table{width:100%;border-collapse:collapse;margin:20px 0;font-size:.95rem}
th{text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tot{margin-left:auto;max-width:340px}
.tot div{display:flex;justify-content:space-between;gap:20px;padding:5px 10px;font-variant-numeric:tabular-nums}
.tot div.grand{border-top:2px solid var(--ink);margin-top:6px;padding-top:12px;font-size:1.15rem;font-weight:700}
.clauses{white-space:pre-wrap;font-size:.93rem;border-top:1px solid var(--line);padding-top:20px;margin-top:8px;max-height:none}
.box{border:1px solid var(--line);border-radius:6px;padding:20px;margin-top:28px;background:var(--bg)}
.box h3{margin:0 0 6px;font-size:1.05rem}
.box p.sub{margin:0 0 16px;color:var(--muted);font-size:.9rem}
label{display:block;font-size:.8rem;color:var(--muted);margin:12px 0 4px;text-transform:uppercase;letter-spacing:.06em}
input[type=text],input[type=email]{width:100%;padding:11px 12px;font-size:1rem;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:var(--ink)}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.check{display:flex;gap:10px;align-items:flex-start;margin:18px 0;font-size:.9rem;text-transform:none;letter-spacing:0;color:var(--ink)}
.check input{margin-top:4px;width:18px;height:18px;flex:none}
.btn{display:inline-block;width:100%;text-align:center;background:var(--accent);color:var(--accent-ink);border:0;border-radius:4px;padding:15px 20px;font-size:1.02rem;font-weight:650;cursor:pointer;text-decoration:none}
.btn.pay{margin-top:4px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.done{border-left:4px solid var(--accent);background:var(--bg);padding:18px 20px;border-radius:4px;margin-top:28px}
.done h3{margin:0 0 8px;color:var(--accent)}
.done dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:.85rem}
.done dt{color:var(--muted)}
.done dd{margin:0;word-break:break-all;font-variant-numeric:tabular-nums}
.err{background:#f7e3e0;color:#9a2f24;border-radius:4px;padding:12px 14px;margin-top:16px;font-size:.9rem}
@media (prefers-color-scheme:dark){.err{background:#33201d;color:#e0705f}}
.foot{max-width:760px;margin:20px auto 0;color:var(--muted);font-size:.78rem;text-align:center}
.bank{font-size:.88rem;color:var(--muted);margin-top:14px}
`;

function shell(title, inner) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>${inner}</body></html>`;
}

function itemsTable(doc) {
  const rows = (doc.items || [])
    .map(
      (it) => `<tr>
        <td><strong>${esc(it.description || '')}</strong>${it.detail ? `<br><span style="color:var(--muted);font-size:.85rem">${esc(it.detail)}</span>` : ''}</td>
        <td class="n">${esc(it.qty ?? 1)}</td>
        <td class="n">${esc(money(it.unitPrice, doc.currency))}</td>
        <td class="n">${esc(money(Number(it.qty || 0) * Number(it.unitPrice || 0), doc.currency))}</td>
      </tr>`
    )
    .join('');
  if (!rows) return '';
  return `<table><thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Valor</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function totalsBlock(doc) {
  const t = computeTotals(doc);
  const s = doc.currency;
  return `<div class="tot">
    <div><span>Subtotal</span><span>${esc(money(t.subtotal, s))}</span></div>
    ${t.discount ? `<div><span>Descuento</span><span>-${esc(money(t.discount, s))}</span></div>` : ''}
    ${t.tax ? `<div><span>Impuesto (${esc(doc.taxRate)}%)</span><span>${esc(money(t.tax, s))}</span></div>` : ''}
    ${t.withholding ? `<div><span>Retencion</span><span>-${esc(money(t.withholding, s))}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${esc(money(t.total, s))}</span></div>
  </div>`;
}

function acceptedBlock(doc, kindLabel) {
  const a = doc.acceptance;
  return `<div class="done">
    <h3>${kindLabel === 'Contrato' ? 'Contrato firmado' : 'Propuesta aceptada'}</h3>
    <dl>
      <dt>Por</dt><dd>${esc(a.name)}${a.role ? ` — ${esc(a.role)}` : ''}</dd>
      ${a.email ? `<dt>Correo</dt><dd>${esc(a.email)}</dd>` : ''}
      <dt>Fecha</dt><dd>${esc(new Date(a.at).toLocaleString('es-CO'))}</dd>
      <dt>Desde</dt><dd>${esc(a.ip)}</dd>
      <dt>Huella</dt><dd>${esc(String(a.documentHash).slice(0, 32))}…</dd>
    </dl>
  </div>`;
}

function acceptForm(collection, doc, error) {
  const isContract = collection === 'contracts';
  return `<form class="box" method="post" action="/d/${esc(doc.share.token)}/accept">
    <h3>${isContract ? 'Firmar el contrato' : 'Aceptar la propuesta'}</h3>
    <p class="sub">${
      isContract
        ? 'Al firmar aqui queda constancia de quien acepto, desde donde y sobre que texto exacto. Tiene el mismo efecto que una firma a mano.'
        : 'Aceptar no genera cobro todavia: es la confirmacion del alcance y el precio para poder emitir el contrato.'
    }</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <label for="f-name">Nombre completo</label>
    <input id="f-name" type="text" name="name" required autocomplete="name">
    <label for="f-role">Cargo</label>
    <input id="f-role" type="text" name="role" autocomplete="organization-title" placeholder="Ej: propietario, gerente">
    <label for="f-email">Correo</label>
    <input id="f-email" type="email" name="email" autocomplete="email">
    <label class="check"><input type="checkbox" name="agree" value="1" required>
      ${
        isContract
          ? 'He leido el contrato completo, tengo facultad para obligar a la empresa y acepto su contenido.'
          : 'Acepto esta propuesta en el alcance, los terminos y el precio indicados.'
      }
    </label>
    <button class="btn" type="submit">${isContract ? 'Firmar contrato' : 'Aceptar propuesta'}</button>
  </form>`;
}

function payBlock(settings, doc) {
  const link = paymentLinkFor(settings, doc);
  const bank = doc.currency === 'COP' ? settings.banking.copDetails : settings.banking.usdDetails;
  const total = money(computeTotals(doc).total, doc.currency);
  return `<div class="box">
    <h3>Pagar</h3>
    <p class="sub">Total a pagar: <strong>${esc(total)}</strong>${doc.dueDate ? ` · vence el ${esc(fmtDate(doc.dueDate))}` : ''}</p>
    ${link ? `<a class="btn pay" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)} · ${esc(total)}</a>` : ''}
    ${bank ? `<p class="bank">${link ? 'O por transferencia: ' : 'Transferencia: '}${esc(bank)}</p>` : ''}
  </div>`;
}

function renderPublic(state, collection, doc, opts) {
  const o = opts || {};
  const s = state.settings;
  const kind = SHAREABLE[collection];
  const client = state.clients.find((c) => c.id === doc.clientId) || {};
  const co = s.company;

  const head = `<div class="top">
    <div class="co">
      <strong>${esc(co.legalName || co.tradeName)}</strong>
      ${co.taxId ? `<span>${esc(co.taxIdLabel)} ${esc(co.taxId)}</span>` : ''}
      ${co.email ? `<span>${esc(co.email)}</span>` : ''}
      ${co.phone ? `<span>${esc(co.phone)}</span>` : ''}
    </div>
    <div class="meta">
      <h1>${esc(kind.label)}</h1>
      <b>${esc(doc.number || '')}</b>
      ${doc.issueDate ? `<span>${esc(fmtDate(doc.issueDate))}</span>` : ''}
      ${doc.validUntil ? `<span>Valida hasta ${esc(fmtDate(doc.validUntil))}</span>` : ''}
      ${doc.dueDate ? `<span>Vence ${esc(fmtDate(doc.dueDate))}</span>` : ''}
    </div>
  </div>`;

  const to = `<div class="to">
    <em>Para</em>
    <strong>${esc(client.legalName || client.name || '')}</strong>
    ${client.contactName ? `<div>At.: ${esc(client.contactName)}</div>` : ''}
    ${client.email ? `<div>${esc(client.email)}</div>` : ''}
  </div>`;

  let cuerpo = '';
  if (collection === 'contracts') {
    cuerpo = `<h2 class="title">${esc(doc.title || `Contrato ${doc.number}`)}</h2>
      <div class="clauses">${esc(doc.body || '')}</div>`;
  } else {
    cuerpo = `${doc.title ? `<h2 class="title">${esc(doc.title)}</h2>` : ''}
      ${doc.summary ? `<p>${esc(doc.summary)}</p>` : ''}
      ${itemsTable(doc)}
      ${totalsBlock(doc)}
      ${doc.terms ? `<div class="clauses">${esc(doc.terms)}</div>` : ''}`;
  }

  let accion = '';
  if (collection === 'invoices') {
    accion = payBlock(s, doc);
  } else if (doc.acceptance) {
    accion = acceptedBlock(doc, kind.label);
    // Una propuesta aceptada que ya tiene enlace de pago puede cobrarse de una.
    if (collection === 'proposals' && paymentLinkFor(s, doc)) accion += payBlock(s, doc);
  } else if (doc.share && doc.share.revokedAt) {
    accion = `<div class="box"><h3>Este enlace ya no esta activo</h3><p class="sub">Escribenos y te enviamos uno nuevo.</p></div>`;
  } else {
    accion = acceptForm(collection, doc, o.error);
  }

  const foot = `<p class="foot">${esc(s.invoicing.footerNote || '')}</p>`;

  return shell(
    `${kind.label} ${doc.number || ''} · ${co.tradeName || 'Agency OS'}`,
    `<div class="sheet">${head}${to}${cuerpo}${accion}</div>${foot}`
  );
}

function renderNotFound() {
  return shell(
    'Documento no disponible',
    `<div class="sheet"><h2 class="title">Este enlace no existe o fue desactivado</h2>
     <p style="color:var(--muted)">Si te lo enviaron hace poco, pide uno nuevo — es posible que el documento se haya reemplazado por una version actualizada.</p></div>`
  );
}

module.exports = {
  SHAREABLE,
  ensureShare,
  revokeShare,
  publicUrl,
  findByToken,
  logView,
  accept,
  paymentLinkFor,
  renderPublic,
  renderNotFound,
  hashOf,
  clientIp,
};
