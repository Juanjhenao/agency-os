/* Agency OS — Marketing OS: campañas, despacho y tablero.
 *
 * El Despacho es la pantalla que justifica todo lo demás. El sistema produce
 * solo —el estratega decide la semana, la cola genera, el reloj mide— y todo
 * eso desemboca aquí, en una sola bandeja donde una persona aprueba o rechaza.
 *
 * Dos decisiones de diseño que no son cosméticas:
 *
 *   1. Cada pieza muestra su hipótesis y la versión del playbook que la
 *      produjo. Aprobar sin ver por qué se escribió así es firmar en blanco, y
 *      convierte la revisión en un trámite.
 *
 *   2. Rechazar exige motivo. Es la señal de entrenamiento más barata del
 *      sistema: cinco palabras que corrigen el criterio antes de que algo
 *      salga a la calle y cueste dinero.
 */

const MK_CANALES = {
  outbound: 'Outbound',
  'meta-ads': 'Meta Ads',
  'google-ads': 'Google Ads',
  seo: 'SEO',
  organico: 'Orgánico',
};

const MK_TIPOS = {
  'ad-copy': 'Copy de anuncio',
  'video-script': 'Guion de video',
  'video-audit': 'Auditoría en video',
  email: 'Correo',
  'seo-article': 'Artículo SEO',
  'organic-post': 'Publicación',
};

const MK_TONE = {
  generado: 'amber',
  aprobado: 'blue',
  rechazado: 'red',
  publicado: 'green',
  pausado: 'amber',
  retirado: 'gray',
};

// Qué se puede hacer con una pieza según dónde esté. Espeja el grafo de
// lib/marketing.js: la interfaz no ofrece botones que el servidor va a negar.
const MK_ACCIONES = {
  generado: ['aprobar', 'rechazar'],
  aprobado: ['publicar', 'rechazar'],
  publicado: ['pausar', 'retirar'],
  pausado: ['publicar', 'retirar'],
  rechazado: [],
  retirado: [],
};

function mkCanal(c) {
  return MK_CANALES[c] || c || '—';
}

function mkTipo(t) {
  return MK_TIPOS[t] || t || '—';
}

function mkCampaign(id) {
  const c = (App.state.campaigns || []).find((x) => x.id === id);
  return c ? c.name : '—';
}

function mkAssets(filtro) {
  return (App.state.assets || []).filter(filtro || (() => true));
}

// Porcentaje legible, o un guion cuando no hay con qué calcularlo. Un cero
// pintado donde no hubo datos se lee como un resultado malo y no lo es.
function mkPct(v, decimales) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(decimales === undefined ? 1 : decimales)}%`;
}

function mkNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

function mkTarjeta(a) {
  const acciones = MK_ACCIONES[a.estado] || [];
  const botones = acciones
    .map((act) => {
      const cls = act === 'aprobar' || act === 'publicar' ? 'btn-primary' : 'btn-ghost';
      const label = { aprobar: 'Aprobar', rechazar: 'Rechazar', publicar: 'Publicar', pausar: 'Pausar', retirar: 'Retirar' }[act];
      return btn(label, `mk-${act}`, { cls, small: true, data: { id: a.id } });
    })
    .join(' ');

  const meta = [
    a.angulo ? `Ángulo: <strong>${esc(a.angulo)}</strong>` : '',
    a.gancho ? `Gancho: “${esc(a.gancho)}”` : '',
    a.variante ? `Variante ${esc(a.variante)}` : '',
    a.nicho ? esc(a.nicho) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `<article class="card mk-asset">
    <header class="card-head">
      <h2>${esc(a.titulo || 'Sin título')}</h2>
      ${badge(a.estado, MK_TONE[a.estado])}
    </header>
    <p class="mk-meta">${badge(mkCanal(a.canal), 'blue')} ${badge(mkTipo(a.tipo), 'gray')} ${meta}</p>
    ${a.hipotesis ? `<p class="mk-hipotesis"><span>Hipótesis</span> ${esc(a.hipotesis)}</p>` : ''}
    ${a.motivoRechazo ? `<p class="mk-rechazo"><span>Rechazada</span> ${esc(a.motivoRechazo)}</p>` : ''}
    <footer class="mk-foot">
      <span class="mk-origen">
        ${a.playbookVersion ? `playbook ${esc(a.playbookVersion)}` : 'sin playbook'}
        ${a.campaignId ? ` · ${esc(mkCampaign(a.campaignId))}` : ''}
        ${a.rutaVault ? ` · <code>${esc(a.rutaVault)}</code>` : ''}
      </span>
      <span class="mk-acciones">${botones}</span>
    </footer>
  </article>`;
}

App.views.despacho = {
  title: 'Despacho',
  sub: 'Lo que el sistema produjo solo. Nada sale sin pasar por aquí.',
  render() {
    const todas = App.state.assets || [];
    const pendientes = todas.filter((a) => a.estado === 'generado');
    const aprobadas = todas.filter((a) => a.estado === 'aprobado');
    const vivas = todas.filter((a) => a.estado === 'publicado');
    const rechazadas = todas.filter((a) => a.estado === 'rechazado');

    if (!todas.length) {
      return emptyState(
        'Todavía no hay piezas. Las produce la cola de producción a partir del plan semanal; aquí aparecen para que las apruebes.'
      );
    }

    const kpis = `<div class="kpi-row">
      ${kpi('Por revisar', String(pendientes.length), 'esperando tu decisión', pendientes.length ? 'amber' : '')}
      ${kpi('Listas para publicar', String(aprobadas.length), 'aprobadas, sin salir', aprobadas.length ? 'blue' : '')}
      ${kpi('En la calle', String(vivas.length), 'publicadas y midiéndose', vivas.length ? 'green' : '')}
      ${kpi('Rechazadas', String(rechazadas.length), 'con motivo, alimentan el retro', '')}
    </div>`;

    const bloque = (titulo, lista, vacio) =>
      section(titulo, lista.length ? `<div class="mk-grid">${lista.map(mkTarjeta).join('')}</div>` : emptyState(vacio));

    return `${kpis}
      ${bloque(`Por revisar (${pendientes.length})`, pendientes, 'Nada pendiente de revisión.')}
      ${bloque(`Listas para publicar (${aprobadas.length})`, aprobadas, 'Nada aprobado esperando salida.')}
      ${bloque(`En la calle (${vivas.length})`, vivas, 'Nada publicado todavía.')}`;
  },
};

App.actions['mk-aprobar'] = async (el) => {
  await api.action(`/api/marketing/despacho/${el.dataset.id}/aprobar`);
  toast('Aprobada. Ya se puede publicar.', 'ok');
  await refresh();
};

App.actions['mk-rechazar'] = (el) => {
  const asset = byId('assets', el.dataset.id) || {};
  openForm({
    title: 'Rechazar la pieza',
    intro:
      'El motivo es lo que el sistema aprende. Escríbelo como se lo dirías a quien la escribió: “promete resultados”, “muy largo”, “el gancho ya lo quemamos”.',
    fields: [{ name: 'motivo', label: `Por qué no sirve “${asset.titulo || 'esta pieza'}”`, type: 'textarea', required: true }],
    submitLabel: 'Rechazar',
    onSubmit: async (v) => {
      await api.action(`/api/marketing/despacho/${el.dataset.id}/rechazar`, { motivo: v.motivo });
      toast('Rechazada. El motivo entra al próximo retro.', 'ok');
    },
  });
};

App.actions['mk-publicar'] = (el) => {
  const asset = byId('assets', el.dataset.id) || {};

  // El outbound sale por la casa: se encola y lo despacha outbox-sender. No
  // hay id externo que pedir porque el id del mensaje ya es el amarre.
  if (asset.canal === 'outbound') {
    return confirmAction(
      `Se encola “${asset.titulo}” en la bandeja de salida. Sale cuando corras el envío, no ahora.`,
      async () => {
        const r = await api.action(`/api/marketing/despacho/${asset.id}/publicar`);
        toast(r.encolado ? `Encolada para ${r.encolado.para}.` : 'Publicada.', 'ok');
      },
      'Encolar'
    );
  }

  /* En pauta y en orgánico el sistema no publica: lo hace Juanjo en la
   * plataforma. Lo que sí exige es el id del anuncio o la URL, porque es el
   * único amarre posible con la fila del CSV de métricas que llegará después.
   * Sin ese id la pieza queda publicada y muda: nunca se sabrá qué hizo, y
   * una pieza que no se puede medir no le enseña nada al playbook. */
  openForm({
    title: 'Publicar la pieza',
    intro:
      'Publícala en la plataforma y pega aquí el identificador. Es lo que amarra esta pieza con las métricas del CSV; sin él, la pieza sale pero nunca se sabrá qué hizo.',
    fields: [
      {
        name: 'externalRef',
        label: asset.canal === 'seo' || asset.canal === 'organico' ? 'URL publicada' : 'ID del anuncio en la plataforma',
        required: true,
      },
    ],
    submitLabel: 'Marcar como publicada',
    onSubmit: async (v) => {
      await api.action(`/api/marketing/despacho/${asset.id}/publicar`, { externalRef: v.externalRef });
      toast('Publicada y amarrada. Las métricas la encontrarán.', 'ok');
    },
  });
};

App.actions['mk-pausar'] = async (el) => {
  await api.action(`/api/marketing/despacho/${el.dataset.id}/pausar`);
  toast('Pausada.', 'ok');
  await refresh();
};

App.actions['mk-retirar'] = (el) => {
  const asset = byId('assets', el.dataset.id) || {};
  confirmAction(
    `Retirar “${asset.titulo}”. Deja de estar en la calle, pero sus resultados siguen contando en el tablero.`,
    async () => {
      await api.action(`/api/marketing/despacho/${asset.id}/retirar`);
      toast('Retirada.', 'ok');
    },
    'Retirar'
  );
};

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

const MK_CAMPAIGN_FIELDS = (c) => [
  { name: 'name', label: 'Nombre', value: c.name || '', required: true },
  { name: 'canal', label: 'Canal', type: 'select', value: c.canal || 'outbound', options: Object.entries(MK_CANALES).map(([v, l]) => ({ value: v, label: l })) },
  {
    name: 'objetivo',
    label: 'Objetivo',
    type: 'select',
    value: c.objetivo || 'reuniones',
    options: ['leads', 'reuniones', 'ventas', 'alcance'].map((v) => ({ value: v, label: v })),
  },
  { name: 'nicho', label: 'Nicho', value: c.nicho || '' },
  { name: 'publico', label: 'Público', type: 'textarea', value: c.publico || '' },
  { name: 'oferta', label: 'Oferta', type: 'textarea', value: c.oferta || '' },
  { name: 'presupuestoMes', label: 'Presupuesto mensual', type: 'number', value: c.presupuestoMes || 0 },
  { name: 'currency', label: 'Moneda', type: 'select', value: c.currency || 'USD', options: ['USD', 'COP', 'MXN'].map((v) => ({ value: v, label: v })) },
  {
    name: 'estado',
    label: 'Estado',
    type: 'select',
    value: c.estado || 'borrador',
    options: ['borrador', 'activa', 'pausada', 'cerrada'].map((v) => ({ value: v, label: v })),
  },
];

App.views.campanas = {
  title: 'Campañas',
  sub: 'La apuesta: a quién, por dónde y con qué oferta.',
  actions: () => btn('+ Campaña', 'mk-campaign-new', { cls: 'btn-primary' }),
  render() {
    const campanas = (App.state.campaigns || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (!campanas.length) {
      return emptyState(
        'Sin campañas. Una campaña agrupa las piezas de un canal contra un público y una oferta: es la unidad sobre la que el tablero compara resultados.',
        btn('+ Campaña', 'mk-campaign-new', { cls: 'btn-primary' })
      );
    }

    const filas = campanas.map((c) => {
      const piezas = mkAssets((a) => a.campaignId === c.id);
      const vivas = piezas.filter((a) => a.estado === 'publicado').length;
      return {
        _attrs: ` data-act="mk-campaign-edit" data-id="${esc(c.id)}"`,
        cells: [
          esc(c.name),
          badge(mkCanal(c.canal), 'blue'),
          esc(c.nicho || '—'),
          esc(c.objetivo || '—'),
          `${piezas.length} (${vivas} en la calle)`,
          c.presupuestoMes ? fmtShort(c.presupuestoMes, c.currency) : '—',
          badge(c.estado, STATUS_TONE[c.estado] || 'gray'),
        ],
      };
    });

    return section(
      'Campañas',
      table(
        [
          { label: 'Campaña' },
          { label: 'Canal' },
          { label: 'Nicho' },
          { label: 'Objetivo' },
          { label: 'Piezas' },
          { label: 'Presupuesto', align: 'right' },
          { label: 'Estado' },
        ],
        filas
      )
    );
  },
};

App.actions['mk-campaign-new'] = () => {
  openForm({
    title: 'Nueva campaña',
    fields: MK_CAMPAIGN_FIELDS({}),
    onSubmit: async (v) => {
      await api.create('campaigns', v);
      toast('Campaña creada.', 'ok');
    },
  });
};

App.actions['mk-campaign-edit'] = (el) => {
  const c = byId('campaigns', el.dataset.id);
  if (!c) return;
  openForm({
    title: c.name,
    fields: MK_CAMPAIGN_FIELDS(c),
    onSubmit: async (v) => {
      await api.update('campaigns', c.id, v);
      toast('Campaña actualizada.', 'ok');
    },
    danger: {
      label: 'Eliminar',
      onClick: async () => {
        await api.remove('campaigns', c.id);
      },
    },
  });
};

// ---------------------------------------------------------------------------
// Tablero
// ---------------------------------------------------------------------------

const MK_METRICAS = [
  ['tasaRespuesta', 'Tasa de respuesta'],
  ['tasaReunion', 'Tasa de reunión'],
  ['ctr', 'CTR'],
  ['cpl', 'Costo por lead'],
  ['roas', 'ROAS'],
];

/* Pinta un grupo comparado contra su base. El delta es la cifra que importa:
 * "20% de respuesta" no dice nada sin saber contra qué. */
function mkFilaDimension(f) {
  const esPct = ['tasaRespuesta', 'tasaReunion', 'ctr'].includes(f.metrica);
  const valor = esPct ? mkPct(f.valorMetrica) : mkNum(f.valorMetrica);
  const base = esPct ? mkPct(f.baseline) : mkNum(f.baseline);

  let delta = '<span class="mk-delta mk-delta-nulo">sin comparar</span>';
  if (f.delta !== null && f.delta !== undefined) {
    const tono = f.delta > 0.1 ? 'bien' : f.delta < -0.1 ? 'mal' : 'igual';
    delta = `<span class="mk-delta mk-delta-${tono}">${f.delta > 0 ? '+' : ''}${(f.delta * 100).toFixed(0)}%</span>`;
  }

  /* Cuando la evidencia no alcanza se dice, en la misma fila. Un número sin
   * su volumen invita a concluir, y concluir con doce envíos es exactamente
   * como se fabrica una superstición que después gobierna el playbook. */
  const nota = f.evidencia && !f.evidencia.suficiente
    ? `<span class="mk-flojo" title="No alcanza para concluir">⚠ ${esc(f.evidencia.motivo)}</span>`
    : '';

  return {
    cells: [
      `${esc(f.valor)} ${nota}`,
      String(f.piezas),
      valor,
      base,
      delta,
    ],
  };
}

App.views.tablero = {
  title: 'Tablero',
  sub: 'Qué funcionó, con cuánta evidencia detrás.',
  actions: () =>
    `<select class="btn btn-ghost" data-act="mk-metrica">${MK_METRICAS.map(
      ([v, l]) => `<option value="${v}"${(App.ctx.mkMetrica || 'tasaRespuesta') === v ? ' selected' : ''}>${l}</option>`
    ).join('')}</select> ${btn('Actualizar', 'mk-tablero-cargar')}`,
  render() {
    const t = App.ctx.mkTablero;
    /* El tablero no viaja en /api/state: se calcula aparte. Se pide en el
     * primer pintado y se repinta al llegar. La bandera evita el bucle —
     * cargar llama a render, que volvería a cargar. */
    if (!t) {
      if (!App.ctx.mkCargando) {
        App.ctx.mkCargando = true;
        App.actions['mk-tablero-cargar']()
          .catch((err) => toast(err.message, 'error'))
          .finally(() => {
            App.ctx.mkCargando = false;
          });
      }
      return emptyState('Calculando el tablero…');
    }

    const m = t.total;
    const kpis = `<div class="kpi-row">
      ${kpi('Enviados', mkNum(m.enviados), 'mensajes de outbound', '')}
      ${kpi('Respuestas', mkNum(m.respuestas), mkPct(m.tasaRespuesta) + ' de tasa', m.respuestas ? 'green' : '')}
      ${kpi('Reuniones', mkNum(m.reuniones), mkPct(m.tasaReunion) + ' de los contactados', m.reuniones ? 'green' : '')}
      ${kpi('En Despacho', String(t.despacho), 'piezas esperando decisión', t.despacho ? 'amber' : '')}
    </div>`;

    const cols = [
      { label: 'Valor' },
      { label: 'Piezas', align: 'right' },
      { label: 'Resultado', align: 'right' },
      { label: 'Base', align: 'right' },
      { label: 'Diferencia', align: 'right' },
    ];

    const dims = ['angulo', 'gancho', 'tipo']
      .map((d) => {
        const filas = (t.dimensiones[d] || []).map(mkFilaDimension);
        const titulo = { angulo: 'Por ángulo', gancho: 'Por gancho', tipo: 'Por tipo de pieza' }[d];
        return section(titulo, table(cols, filas, 'Todavía no hay piezas publicadas con resultados.'));
      })
      .join('');

    const exps = t.experimentos.length
      ? section(
          'Experimentos corriendo',
          table(
            [{ label: 'Hipótesis' }, { label: 'Métrica' }, { label: 'Estado' }],
            t.experimentos.map((e) => ({
              cells: [esc(e.hipotesis || '—'), esc(e.metrica || '—'), esc((e.evaluacion && e.evaluacion.veredicto) || '—')],
            }))
          )
        )
      : '';

    const rechazos = t.rechazos.total
      ? section(
          `Por qué rechazas piezas (${t.rechazos.total})`,
          table(
            [{ label: 'Motivo' }, { label: 'Veces', align: 'right' }],
            t.rechazos.motivos.map((r) => ({ cells: [esc(r.motivo), String(r.veces)] }))
          )
        )
      : '';

    const canales = section(
      'Por canal',
      table(
        [{ label: 'Canal' }, { label: 'Piezas', align: 'right' }, { label: 'En la calle', align: 'right' }, { label: 'En Despacho', align: 'right' }, { label: 'Evidencia' }],
        t.porCanal.map((c) => ({
          cells: [
            mkCanal(c.canal),
            String(c.piezas),
            String(c.publicadas),
            String(c.enDespacho),
            c.evidencia.suficiente
              ? badge('suficiente', 'green')
              : `<span class="mk-flojo">${esc(c.evidencia.motivo)}</span>`,
          ],
        }))
      )
    );

    return `${kpis}${canales}${dims}${exps}${rechazos}`;
  },
};

App.actions['mk-tablero-cargar'] = async () => {
  const metrica = App.ctx.mkMetrica || 'tasaRespuesta';
  App.ctx.mkTablero = await api.get(`/api/marketing/tablero?metrica=${encodeURIComponent(metrica)}`);
  render();
};

App.actions['mk-metrica'] = async (el) => {
  App.ctx.mkMetrica = el.value;
  await App.actions['mk-tablero-cargar']();
};
