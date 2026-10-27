/* El siguiente paso: que nunca haya que decidir qué hacer.
 *
 * Agency OS tenía 23 pantallas y ningún criterio. Abrirla obligaba a elegir
 * primero entre 23 puertas y solo después a trabajar, y esa decisión —pequeña,
 * repetida, sin recompensa— es la que hace que un sistema se deje de usar. Con
 * 100 auditorías pendientes el problema empeora: ver 100 paraliza; ver una, no.
 *
 * Este archivo resuelve las dos mitades del mismo problema:
 *
 *   - MODO MAZO (en Hoy): una sola tarjeta a pantalla completa con el
 *     movimiento que toca. Se hace, se despacha, entra la siguiente. Nunca se
 *     ven las 100.
 *   - BARRA PERMANENTE (en el resto): una franja fija que siempre nombra el
 *     siguiente movimiento y lo ejecuta en un clic, estés en Facturas o en
 *     Ajustes. El hilo no se pierde por haber ido a mirar otra cosa.
 *
 * Todo sale de `App.state`, que ya viaja completo en cada refresco: la barra no
 * hace peticiones propias, así que funciona en cualquier vista sin esperar.
 */

// ---------------------------------------------------------------------------
// El orden del día
// ---------------------------------------------------------------------------

/* La prioridad no es negociable y va escrita aquí una sola vez.
 *
 * Manda lo que tiene una persona esperando del otro lado —una llamada que ya
 * pasó sin registrar, un mensaje vencido— sobre lo que solo espera en una
 * lista. Después va lo que produce oportunidades nuevas (grabar auditorías),
 * porque es lo único que llena el embudo, y de último el dinero ya facturado:
 * cobrar importa, pero una factura vencida un día más no cambia el negocio, y
 * un embudo vacío sí. */
const ORDEN = ['llamada', 'mensaje', 'auditoria', 'despacho', 'cobro'];

function hoyISO() {
  return new Date().toLocaleDateString('sv');
}

function pasosDelDia() {
  const s = App.state || {};
  const hoy = hoyISO();
  const pasos = [];

  // 1. Llamadas que ya ocurrieron y nadie registró qué pasó.
  (s.deals || []).forEach((d) => {
    if (!d.meeting || !d.meeting.at) return;
    if (d.meeting.closedAt || !['agendada', 'reagendada'].includes(d.meeting.status)) return;
    if (String(d.meeting.at).slice(0, 10) > hoy) return;
    pasos.push({
      tipo: 'llamada',
      id: `m-${d.id}`,
      titulo: clientName(d.clientId) || d.title,
      rotulo: 'Registrar la llamada',
      sub: `${String(d.meeting.at).slice(0, 10)} · ${String(d.meeting.at).slice(11, 16)}`,
      nota: 'Sin el resultado no hay tasa de asistencia ni de cierre.',
      primaria: { label: 'Registrar resultado', act: 'meeting-result', data: { id: d.id } },
      secundaria: { label: 'Abrir ficha', act: 'deal-edit', data: { id: d.id } },
    });
  });

  // 2. Mensajes cuyo día ya llegó.
  (s.touches || []).forEach((t) => {
    if (t.status !== 'pendiente' || !t.dueDate || t.dueDate > hoy) return;
    const atraso = Math.round((new Date(`${hoy}T00:00:00`) - new Date(`${t.dueDate}T00:00:00`)) / 86400000);
    pasos.push({
      tipo: 'mensaje',
      id: `t-${t.id}`,
      titulo: clientName(t.clientId) || t.sequenceName || 'Mensaje',
      rotulo: t.label || 'Mandar mensaje',
      sub: atraso > 0 ? `${atraso} día(s) de atraso` : 'vence hoy',
      urgente: atraso > 0,
      nota: t.subject || '',
      cuerpo: t.body || '',
      primaria: { label: 'Encolar', act: 'touch-queue', data: { id: t.id } },
      secundaria: { label: 'Ya lo mandé', act: 'touch-sent', data: { id: t.id } },
      terciaria: { label: 'Aplazar', act: 'touch-snooze', data: { id: t.id } },
    });
  });

  // 3. Auditorías por grabar: lo único que llena el embudo.
  (s.deals || []).forEach((d) => {
    if (!d.audit || d.audit.status === 'grabada' || d.stage !== 'nuevo') return;
    const c = (s.clients || []).find((x) => x.id === d.clientId) || {};
    const dias = Number(d.audit.creativeAgeDays || 0);
    pasos.push({
      tipo: 'auditoria',
      id: `a-${d.id}`,
      titulo: c.name || d.title,
      rotulo: 'Grabar la auditoría',
      sub: [c.city, dias ? `mismo creativo hace ${dias} días` : ''].filter(Boolean).join(' · '),
      // La señal de oro del playbook: más de 60 días sin rotar el creativo
      // significa que se les quemó, y ese es el gancho del primer mensaje.
      señal: dias >= 60 ? `${dias} días sin rotar el anuncio` : '',
      nota: d.audit.observation || '',
      enlace: d.audit.adLibraryUrl || '',
      primaria: { label: 'Ya la grabé', act: 'audit-log', data: { deal: d.id } },
      secundaria: { label: 'Ver guion', act: 'audit-script', data: { deal: d.id } },
      terciaria: { label: 'Descartar', act: 'audit-discard', data: { deal: d.id } },
    });
  });

  // 4. Piezas de marketing esperando decisión.
  (s.assets || []).forEach((a) => {
    if (a.estado !== 'generado') return;
    pasos.push({
      tipo: 'despacho',
      id: `d-${a.id}`,
      titulo: a.titulo || 'Pieza sin título',
      rotulo: 'Aprobar o rechazar',
      sub: [a.canal, a.angulo].filter(Boolean).join(' · '),
      nota: a.hipotesis || '',
      primaria: { label: 'Aprobar', act: 'mk-aprobar', data: { id: a.id } },
      secundaria: { label: 'Rechazar', act: 'mk-rechazar', data: { id: a.id } },
    });
  });

  // 5. Cartera vencida.
  (s.invoices || []).forEach((i) => {
    if (!['enviada', 'vencida'].includes(i.status) || !i.dueDate || i.dueDate >= hoy) return;
    pasos.push({
      tipo: 'cobro',
      id: `f-${i.id}`,
      titulo: clientName(i.clientId) || i.number,
      rotulo: `Cobrar ${i.number}`,
      sub: `venció el ${i.dueDate}`,
      urgente: true,
      primaria: { label: 'Abrir factura', act: 'invoice-open', data: { id: i.id } },
    });
  });

  return pasos.sort((a, b) => {
    const d = ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo);
    if (d !== 0) return d;
    // Dentro del mismo tipo, primero lo atrasado y después lo más caliente.
    if (!!b.urgente !== !!a.urgente) return b.urgente ? 1 : -1;
    return (b.señal ? 1 : 0) - (a.señal ? 1 : 0);
  });
}

// Cuál es EL siguiente. Se salta lo que se aplazó en esta sesión.
function siguientePaso() {
  const saltados = App.ctx.saltados || (App.ctx.saltados = new Set());
  const todos = pasosDelDia();
  return todos.find((p) => !saltados.has(p.id)) || null;
}

const ROTULO_TIPO = {
  llamada: 'Llamada',
  mensaje: 'Mensaje',
  auditoria: 'Auditoría',
  despacho: 'Despacho',
  cobro: 'Cobro',
};

// ---------------------------------------------------------------------------
// La barra permanente
// ---------------------------------------------------------------------------

function siguienteBar() {
  const p = siguientePaso();
  if (!p) {
    return `<div class="sig-bar sig-bar-vacia">
      <span class="sig-marca">▪</span>
      <span class="sig-txt">Nada pendiente. El día está hecho.</span>
    </div>`;
  }
  return `<div class="sig-bar${p.urgente ? ' urgente' : ''}" data-act="sig-ir">
    <span class="sig-marca">▶</span>
    <span class="sig-tipo">${esc(ROTULO_TIPO[p.tipo] || p.tipo)}</span>
    <span class="sig-txt"><strong>${esc(p.titulo)}</strong> — ${esc(p.rotulo)}</span>
    ${p.sub ? `<span class="sig-sub">${esc(p.sub)}</span>` : ''}
    <span class="sig-ir">Ir →</span>
  </div>`;
}

App.actions['sig-ir'] = () => go('hoy');

// ---------------------------------------------------------------------------
// El mazo
// ---------------------------------------------------------------------------

function mazo() {
  const p = siguientePaso();
  const pendientes = pasosDelDia().filter((x) => !(App.ctx.saltados || new Set()).has(x.id));
  const j = App.state.juego;
  const hoy = j ? j.hoy : null;

  if (!p) {
    const saltados = (App.ctx.saltados || new Set()).size;
    return `<section class="mazo mazo-vacio">
      <span class="mazo-sello">✓</span>
      <h2>${hoy && hoy.cumplida ? 'Día cerrado' : 'Nada pendiente'}</h2>
      <p>${
        saltados
          ? `Saltaste ${saltados}. Vuelven mañana, o recárgalos ahora.`
          : 'No queda nada que hacer hoy. Es una buena señal, no un hueco.'
      }</p>
      ${saltados ? btn('Recuperar los saltados', 'mazo-reset', { cls: 'btn-primary' }) : ''}
    </section>`;
  }

  const acciones = [p.primaria, p.secundaria, p.terciaria]
    .filter(Boolean)
    .map((a, i) =>
      btn(a.label, a.act, { cls: i === 0 ? 'btn-primary' : 'btn-ghost', data: a.data })
    )
    .join('');

  const restantes = pendientes.length;
  const hechoHoy = hoy ? hoy.partes.reduce((s, x) => s + Math.min(x.hecho, x.meta), 0) : 0;
  const metaHoy = hoy ? hoy.partes.reduce((s, x) => s + x.meta, 0) : 0;

  return `<section class="mazo">
    <header class="mazo-cab">
      <span class="mazo-cuenta">${hechoHoy} / ${metaHoy} de hoy</span>
      <span class="mazo-tipo">${esc(ROTULO_TIPO[p.tipo] || p.tipo)}</span>
      <span class="mazo-resto">${restantes} en la fila</span>
    </header>

    <div class="mazo-cuerpo">
      <p class="mazo-rotulo">${esc(p.rotulo)}</p>
      <h2 class="mazo-titulo">${esc(p.titulo)}</h2>
      ${p.sub ? `<p class="mazo-sub">${esc(p.sub)}</p>` : ''}
      ${p.señal ? `<p class="mazo-senal">${esc(p.señal)}</p>` : ''}
      ${p.nota ? `<p class="mazo-nota">${esc(p.nota)}</p>` : ''}
      ${p.cuerpo ? `<pre class="mazo-mensaje">${esc(p.cuerpo)}</pre>` : ''}
      ${
        p.enlace
          ? `<a class="mazo-enlace" href="${esc(p.enlace)}" target="_blank" rel="noopener">Abrir la Biblioteca de Anuncios ↗</a>`
          : ''
      }
    </div>

    <footer class="mazo-pie">
      <div class="mazo-acciones">${acciones}</div>
      ${btn('Saltar', 'mazo-saltar', { cls: 'btn-ghost', data: { id: p.id } })}
    </footer>

    <p class="mazo-teclas"><kbd>espacio</kbd> hacer · <kbd>→</kbd> saltar</p>
  </section>`;
}

App.actions['mazo-saltar'] = (el) => {
  if (!App.ctx.saltados) App.ctx.saltados = new Set();
  App.ctx.saltados.add(el.dataset.id);
  if (typeof sonidoSaltar === 'function') sonidoSaltar();
  render();
};

App.actions['mazo-reset'] = () => {
  App.ctx.saltados = new Set();
  render();
};

/* Atajos de teclado. Son lo que convierte el mazo en una herramienta de
 * verdad: con el ratón, cien auditorías son cien viajes de ida y vuelta a un
 * botón; con espacio y flecha, es una sola postura de la mano. */
document.addEventListener('keydown', (ev) => {
  if (App.view !== 'hoy') return;
  if (document.getElementById('modal-backdrop') && !document.getElementById('modal-backdrop').hidden) return;
  const t = ev.target;
  if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;

  const p = siguientePaso();
  if (!p) return;

  if (ev.code === 'Space') {
    ev.preventDefault();
    const boton = document.querySelector('.mazo-acciones .btn-primary');
    if (boton) boton.click();
  } else if (ev.key === 'ArrowRight') {
    ev.preventDefault();
    if (!App.ctx.saltados) App.ctx.saltados = new Set();
    App.ctx.saltados.add(p.id);
    if (typeof sonidoSaltar === 'function') sonidoSaltar();
    render();
  }
});
