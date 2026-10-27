/* Agency OS — automatizaciones: lo que corre solo y la cola de trabajos para los agentes. */

const JOB_LABELS = { 'ads-package': 'Paquete de anuncios', 'video-batch': 'Lote de videos' };
const JOB_TONE = { pendiente: 'amber', 'en-proceso': 'blue', hecho: 'green', error: 'red' };

function jobs() {
  return App.state.jobs || [];
}

App.views.automatizaciones = {
  title: 'Automatizaciones',
  sub: 'Un botón para lo mecánico; una cola para lo que necesita criterio.',
  actions: () => '',
  render() {
    const mes = currentMonth();
    const s = App.state;

    // Cuántos clientes tocaría cada acción, para no disparar a ciegas.
    const conSub = [...new Set(s.subscriptions.filter((x) => x.status === 'activa').map((x) => x.clientId))];
    const sinMes = conSub.filter((id) => !s.productions.some((p) => p.clientId === id && p.month === mes)).length;
    const porFacturar = s.subscriptions.filter((x) => x.status === 'activa' && daysUntil(x.nextInvoiceDate) <= 0).length;
    const prodsMes = s.productions.filter((p) => p.month === mes);
    const sinReporte = prodsMes.filter((p) => !s.reports.some((r) => r.clientId === p.clientId && r.month === mes)).length;

    // Ruido medible: prospectos imposibles de contactar y propuestas caducadas.
    const sinContacto = s.deals.filter((d) => {
      if (!d.audit || ['grabada', 'descartada'].includes(d.audit.status)) return false;
      if (!['nuevo', 'contactado'].includes(d.stage)) return false;
      const c = s.clients.find((x) => x.id === d.clientId) || {};
      return ![c.phone, c.email, c.website, c.instagram].some((v) => String(v || '').trim());
    }).length;
    const caducadas = s.proposals.filter((p) => p.status === 'enviada' && p.validUntil && daysUntil(p.validUntil) < 0).length;
    const basura = sinContacto + caducadas;

    const auto = [
      {
        act: 'auto-open-month',
        title: 'Abrir el mes de producción',
        desc: 'Crea el plan del mes para cada cliente con suscripción activa, con los compromisos ya derivados de su contrato.',
        count: sinMes,
        unit: 'cliente(s) sin mes abierto',
      },
      {
        act: 'auto-invoice',
        title: 'Facturar suscripciones vencidas',
        desc: 'Emite la factura del periodo de cada suscripción cuyo día de corte ya pasó, y avanza la fecha al mes siguiente.',
        count: porFacturar,
        unit: 'suscripción(es) por facturar',
      },
      {
        act: 'auto-import',
        title: 'Importar todo del vault',
        desc: 'Recorre AdsSuite\\ y Video\\ y registra como piezas del mes todo lo que hayan producido los agentes.',
        count: prodsMes.length,
        unit: 'mes(es) de producción abiertos',
      },
      {
        act: 'auto-reports',
        title: 'Generar reportes del mes',
        desc: 'Crea el borrador de reporte de cada cliente con producción, con el cumplimiento ya calculado.',
        count: sinReporte,
        unit: 'cliente(s) sin reporte',
      },
      {
        act: 'auto-clean',
        title: 'Limpiar el embudo',
        desc: 'Descarta los prospectos sin ningún dato de contacto y pasa a vencidas las propuestas que se les acabó la vigencia. Son los dos ruidos que hacen que la lista del día y el pipeline mientan.',
        count: basura,
        unit: 'registro(s) por limpiar',
      },
    ];

    const cards = auto
      .map(
        (a) => `<article class="auto-card ${a.count ? '' : 'idle'}">
          <div class="auto-body">
            <h3>${esc(a.title)}</h3>
            <p>${esc(a.desc)}</p>
            <span class="auto-count">${a.count} ${esc(a.unit)}</span>
          </div>
          ${btn('Ejecutar', a.act, { cls: a.count ? 'btn-primary' : 'btn-ghost', small: true })}
        </article>`
      )
      .join('');

    // --- Cola ---------------------------------------------------------------
    const list = jobs();
    const pendientes = list.filter((j) => j.status === 'pendiente');

    const rows = list.map((j) => ({
      cells: [
        esc(JOB_LABELS[j.type] || j.type),
        esc(j.client),
        esc(j.month),
        badge(j.status, JOB_TONE[j.status]),
        j.result ? `<small class="muted">${esc(j.result)}</small>` : esc(fmtDate((j.requestedAt || '').slice(0, 10))),
        [
          btn('Copiar instrucción', 'job-copy', { data: { id: j.id }, small: true }),
          j.status === 'pendiente' ? btn('Hecho', 'job-done', { data: { id: j.id }, small: true }) : '',
          btn('✕', 'job-del', { data: { id: j.id }, small: true }),
        ].join(' '),
      ],
    }));

    const cola = `${table(
      [{ label: 'Trabajo' }, { label: 'Cliente' }, { label: 'Mes' }, { label: 'Estado' }, { label: 'Solicitado / resultado' }, { label: '' }],
      rows,
      'La cola está vacía. Encola trabajos con los botones de arriba y luego pídeme procesarla.'
    )}
    ${
      pendientes.length
        ? `<div class="run-box">
            <div>
              <strong>${pendientes.length} trabajo(s) pendiente(s)</strong>
              <p class="muted">Dime esta frase en el chat y los ejecuto todos, uno por uno:</p>
              <code class="run-cmd" id="run-cmd">procesa la cola de producción de Agency OS</code>
            </div>
            ${btn('Copiar frase', 'queue-copy', { cls: 'btn-primary', small: true })}
          </div>`
        : ''
    }`;

    return `${relojTareasSection(s.settings)}

    ${section(
      'Corren solas — un clic y listo',
      `<div class="auto-grid">${cards}</div>
       <p class="muted">Estas no necesitan a nadie: las ejecuta el propio sistema con los datos que ya tiene.</p>`
    )}

    ${section(
      'Cola de trabajos para los agentes',
      cola,
      `${btn('+ Encolar anuncios de todos', 'queue-ads', { small: true })} ${btn('+ Encolar videos de todos', 'queue-video', { small: true })}`
    )}

    ${section(
      'Cómo funciona esto en realidad',
      `<p class="muted">Vale la pena que sepas exactamente dónde está la frontera, para no esperar magia que no existe:</p>
       <ul class="rules">
         <li><strong>Lo mecánico</strong> (abrir meses, facturar, importar, armar reportes) lo hace el servidor solo. Es cálculo sobre tus datos: el botón lo ejecuta al instante.</li>
         <li><strong>Lo que requiere escribir</strong> (copy, guiones, ángulos) lo hacen los agentes, que viven en Claude Code, no dentro de esta página web. Un botón aquí no puede hacer que Claude escriba.</li>
         <li>Por eso el botón <strong>encola</strong> el trabajo: escribe una nota en <code>Agency\\Cola\\</code> con la instrucción exacta y el cliente. Cuando me pidas procesar la cola, leo esas notas, ejecuto el agente que corresponda a cada una, guardo el resultado en el vault y marco el trabajo como hecho.</li>
         <li>Esa cola se puede <strong>programar</strong> para que corra sola a una hora fija, igual que tu digest diario de tareas. Pídemelo y lo dejo agendado.</li>
       </ul>
       <p class="muted">Ningún agente publica nada. Producen y guardan; publicar sigue siendo decisión tuya.</p>`
    )}`;
  },
};

/* Lo que el reloj hace cada mañana sin que nadie oprima nada. Antes esta lista
 * vivía en Ajustes y en el README, así que la mitad de las automatizaciones
 * parecían no existir: si no se ven, es como si hubiera que hacerlas a mano. */
const TAREAS_RELOJ = [
  ['cerrarSecuencias', 'Cerrar secuencias agotadas', 'El que recibió los 5 toques y no contestó pasa a perdido con recontacto en 90 días.', true],
  ['moras', 'Marcar facturas en mora', 'La factura vencida cambia de estado sola; si no, la cartera se ve sana mientras el dinero no llega.', true],
  ['vencerPropuestas', 'Vencer propuestas caducadas', 'La propuesta que pasó su vigencia deja de contar como viva y de inflar el pipeline.'],
  ['limpiarProspectos', 'Descartar prospectos sin contacto', 'El que no tiene teléfono, correo, web ni Instagram sale de la lista de grabación después del período de gracia.'],
  ['abrirMes', 'Abrir el mes de producción', 'Cada cliente con suscripción activa amanece con su plan del mes y sus compromisos.'],
  ['importarVault', 'Importar lo que dejaron los agentes', 'Recorre AdsSuite\\ y Video\\ y registra las piezas nuevas como producción del mes.'],
  ['reportes', 'Armar los reportes del mes', 'Del día 28 en adelante, deja el borrador de cada cliente con el cumplimiento calculado.'],
  ['facturarBorradores', 'Facturar suscripciones vencidas', 'Emite la factura del período cuando llega el corte. Apagada por defecto: numerar una factura es un acto contable.'],
];

function relojTareasSection(settings) {
  const r = settings.reloj || {};
  const t = r.tareas || {};
  const items = TAREAS_RELOJ.map(([key, titulo, desc, siempre]) => {
    const on = siempre || t[key] !== false;
    return `<li class="rule-row">
      <span class="badge badge-${on ? 'green' : 'gray'}">${on ? 'activa' : 'apagada'}</span>
      <span><strong>${esc(titulo)}</strong><br><small class="muted">${esc(desc)}</small></span>
    </li>`;
  }).join('');

  return section(
    `Lo que corre solo cada mañana${r.activo === false ? ' — APAGADO' : ''}`,
    `<p class="muted">A partir de las ${esc(r.hora || '08:00')}, sin abrir nada. Última corrida: ${
      r.ultimaCorrida ? esc(fmtDate(r.ultimaCorrida)) : 'nunca'
    }. Lo que sale hacia un cliente —correos, propuestas, facturas enviadas— sigue esperando tu aprobación.</p>
     <ul class="mini-list rule-list">${items}</ul>`,
    `${btn('Correr ahora', 'reloj-correr', { small: true, cls: 'btn-primary' })} ${btn('Configurar', 'settings-reloj', { small: true })}`
  );
}

// ---------------------------------------------------------------------------
// Acciones inmediatas
// ---------------------------------------------------------------------------

async function runAuto(path, body, describe) {
  const r = await api.action(path, body || { month: currentMonth() });
  await refresh();
  toast(describe(r), 'ok');
}

App.actions['auto-open-month'] = () =>
  runAuto('/api/automations/open-month', null, (r) =>
    r.abiertos.length ? `Mes abierto para: ${r.abiertos.join(', ')}` : 'Todos los clientes ya tenían el mes abierto'
  );

App.actions['auto-invoice'] = () =>
  runAuto('/api/automations/invoice-due', {}, (r) =>
    r.generadas.length
      ? `${r.generadas.length} factura(s): ${r.generadas.map((g) => `${g.numero} ${g.cliente}`).join(' · ')}`
      : 'Ninguna suscripción llegó a su fecha de corte'
  );

App.actions['auto-import'] = () =>
  runAuto('/api/automations/import-all', null, (r) =>
    r.total ? `${r.total} pieza(s) importada(s): ${r.detalle.map((d) => `${d.cliente} (${d.importadas})`).join(' · ')}` : 'Nada nuevo en el vault'
  );

App.actions['auto-reports'] = () =>
  runAuto('/api/automations/reports', null, (r) =>
    r.generados.length ? `Reporte generado para: ${r.generados.join(', ')}` : 'Todos los reportes del mes ya existían'
  );

App.actions['auto-clean'] = () =>
  runAuto('/api/automations/clean-prospects', { dias: 0 }, (r) =>
    r.descartados.length || r.vencidas.length
      ? `${r.descartados.length} prospecto(s) descartado(s) · ${r.vencidas.length} propuesta(s) vencida(s)`
      : 'El embudo ya estaba limpio'
  );

// ---------------------------------------------------------------------------
// Cola
// ---------------------------------------------------------------------------

async function enqueue(type) {
  const r = await api.action('/api/automations/queue-production', { month: currentMonth(), type });
  await refresh();
  if (!r.encolados.length) {
    toast(r.saltados.length ? `Nada encolado — ${r.saltados.join(' · ')}` : 'No hay clientes activos con brief', 'error');
    return;
  }
  toast(`Encolado para: ${r.encolados.join(', ')}${r.saltados.length ? ` · saltados: ${r.saltados.join(' · ')}` : ''}`);
}

App.actions['queue-ads'] = () => enqueue('ads-package');
App.actions['queue-video'] = () => enqueue('video-batch');

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (err) {
    toast('No se pudo copiar; selecciónalo a mano', 'error');
  }
}

App.actions['job-copy'] = (el) => {
  const j = jobs().find((x) => x.id === el.dataset.id);
  if (!j) return;
  copyText(j.prompt || `Genera el trabajo ${j.type} para ${j.client}`, 'Instrucción copiada — pégala en el chat');
};

App.actions['queue-copy'] = () => copyText('procesa la cola de producción de Agency OS', 'Frase copiada');

App.actions['job-done'] = async (el) => {
  await req('PUT', `/api/jobs/${el.dataset.id}`, { status: 'hecho' });
  await refresh();
  toast('Trabajo marcado como hecho');
};

App.actions['job-del'] = async (el) => {
  await req('DELETE', `/api/jobs/${el.dataset.id}`);
  await refresh();
  toast('Trabajo eliminado de la cola');
};
