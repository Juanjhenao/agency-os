/* El reloj: lo que el sistema hace solo, todos los días.
 *
 * Hasta ahora nada corría si Juanjo no lo disparaba. Cada automatización era un
 * botón que había que ir a oprimir, y las reglas del playbook —cerrar secuencias
 * agotadas, marcar facturas en mora, llamar antes de la renovación— vivían en un
 * documento en vez de en la máquina.
 *
 * Dos aclaraciones honestas sobre el alcance:
 *
 *   1. Esto corre mientras el servidor corra. No es un servicio en la nube. Si
 *      el computador está apagado, el parte del día no se escribe — pero al
 *      prender, el reloj ve que el día quedó pendiente y lo ejecuta. Nada se
 *      pierde por apagar el equipo, solo se atrasa.
 *
 *   2. Solo hace lo que no tiene consecuencia hacia afuera. Cierra secuencias,
 *      marca moras, abre el mes de producción y escribe el parte. NO manda
 *      correos ni emite facturas por su cuenta: eso sale del sistema hacia un
 *      cliente y lo aprueba una persona.
 */

const fs = require('fs');
const path = require('path');
const { today, nowISO, nowLocal, addDays, daysUntil } = require('./dates');

const CADA = 10 * 60 * 1000; // Revisa cada 10 minutos si el día ya corrió.

// ---------------------------------------------------------------------------
// Las tareas
// ---------------------------------------------------------------------------

/* Facturas cuyo vencimiento ya pasó. La mora no es un estado que aparezca solo:
 * si nadie la marca, la cartera se ve sana mientras el dinero no llega. */
function marcarMoras(state) {
  const cambiadas = [];
  state.invoices.forEach((inv) => {
    if (inv.status !== 'enviada') return;
    if (daysUntil(inv.dueDate) >= 0) return;
    inv.status = 'vencida';
    inv.updatedAt = nowISO();
    cambiadas.push(inv.number);
  });
  return cambiadas;
}

/* Suscripciones que se renuevan pronto. La regla del playbook es llamar 15 días
 * antes del corte, no después — porque después ya es una conversación de
 * retención, que es mucho más difícil que una de renovación. */
function avisarRenovaciones(state, dias) {
  const limite = Number(dias || 15);
  return state.subscriptions
    .filter((s) => s.status === 'activa')
    .map((s) => ({ sub: s, faltan: daysUntil(s.nextInvoiceDate) }))
    .filter((x) => x.faltan !== null && x.faltan >= 0 && x.faltan <= limite)
    .map((x) => ({
      cliente: (state.clients.find((c) => c.id === x.sub.clientId) || {}).name || '—',
      faltan: x.faltan,
      monto: x.sub.amount,
      moneda: x.sub.currency,
    }));
}

/* Propuestas que pasaron su vigencia. Una propuesta "enviada" desde hace tres
 * semanas no está viva: está vencida, y mientras diga "enviada" infla el
 * pipeline ponderado y ensucia la única cifra que sirve para decidir. */
function vencerPropuestas(state) {
  const vencidas = [];
  (state.proposals || []).forEach((p) => {
    if (p.status !== 'enviada' || !p.validUntil) return;
    if (daysUntil(p.validUntil) >= 0) return;
    p.status = 'vencida';
    p.updatedAt = nowISO();
    vencidas.push(p.number || p.id);
  });
  return vencidas;
}

/* Prospectos sin un solo dato de contacto. Entran así de los lotes —un nombre
 * que no llevaba teléfono, ni correo, ni web, ni Instagram— y como nunca se les
 * puede grabar nada se quedan arriba de la lista de grabación empujando hacia
 * abajo a los que sí sirven. Se descartan solos después del período de gracia,
 * por si el dato iba a llegar a mano. */
function descartarSinContacto(state, deps, dias) {
  const gracia = Number(dias === undefined ? 3 : dias);
  const limite = addDays(today(), -gracia);
  const descartados = [];

  (state.deals || []).forEach((deal) => {
    if (!deal.audit || ['grabada', 'descartada'].includes(deal.audit.status)) return;
    if (!['nuevo', 'contactado'].includes(deal.stage)) return;
    if (String(deal.createdAt || '').slice(0, 10) > limite) return;
    const c = (state.clients || []).find((x) => x.id === deal.clientId) || {};
    const tieneAlgo = [c.phone, c.email, c.website, c.instagram].some((v) => String(v || '').trim());
    if (tieneAlgo) return;

    if (deps && typeof deps.cancelPending === 'function') deps.cancelPending(state, deal.id, 'sin datos de contacto');
    deal.stage = 'perdido';
    deal.probability = 0;
    deal.lostReason = 'Sin datos de contacto';
    deal.nextAction = 'Descartado';
    deal.nextActionDate = '';
    deal.discardedAt = nowISO();
    deal.audit = { ...deal.audit, status: 'descartada' };
    deal.updatedAt = nowISO();
    if (c.status === 'lead') {
      c.status = 'perdido';
      c.updatedAt = nowISO();
    }
    descartados.push(c.name || deal.title);
  });

  return descartados;
}

/* Llamadas cuya fecha ya pasó y siguen figurando como agendadas. Sin el
 * resultado registrado no existe tasa de asistencia ni de conversión — y esos
 * dos números son los que dicen si el problema está en agendar o en vender. */
function reunionesSinResultado(state) {
  return (state.deals || [])
    .filter((d) => d.meeting && d.meeting.at && ['agendada', 'reagendada'].includes(d.meeting.status))
    .filter((d) => String(d.meeting.at).slice(0, 10) < today())
    .map((d) => ({
      cliente: ((state.clients || []).find((c) => c.id === d.clientId) || {}).name || d.title,
      cuando: String(d.meeting.at).slice(0, 16).replace('T', ' '),
      dias: -daysUntil(String(d.meeting.at).slice(0, 10)),
    }))
    .sort((a, b) => b.dias - a.dias);
}

/* Clientes activos sin ninguna pieza entregada este mes. Es la señal temprana
 * de churn: el cliente que deja de recibir trabajo deja de renovar dos meses
 * después, y para entonces ya no hay nada que hacer. */
function detectarRiesgo(state) {
  const mes = today().slice(0, 7);
  return state.clients
    .filter((c) => c.status === 'activo')
    .map((c) => {
      const prod = (state.productions || []).find((p) => p.clientId === c.id && p.month === mes);
      if (!prod) return { cliente: c.name, motivo: 'sin mes de producción abierto' };
      const piezas = (state.pieces || []).filter((p) => p.productionId === prod.id);
      const listas = piezas.filter((p) => ['aprobado', 'publicado', 'editado'].includes(p.status));
      if (!piezas.length) return { cliente: c.name, motivo: 'mes abierto sin ninguna pieza' };
      if (!listas.length && daysUntil(`${mes}-15`) < 0) {
        return { cliente: c.name, motivo: `${piezas.length} piezas y ninguna entregada, y ya pasó mitad de mes` };
      }
      return null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// El parte del día
// ---------------------------------------------------------------------------

function escribirParte(dir, fecha, contenido) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${fecha}.md`), contenido, 'utf8');
}

function armarParte(state, resultado, deps) {
  const s = state.settings;
  const cola = deps.queueFor(state);
  const atrasados = cola.filter((t) => t.late > 0);
  const porGrabar = deps.recordingList(state);
  const bandeja = deps.outboxPendientes;
  const cartera = state.invoices.filter((i) => i.status === 'enviada' || i.status === 'vencida');
  const enMora = cartera.filter((i) => daysUntil(i.dueDate) < 0);

  const lineas = [
    '---',
    'tipo: parte-diario',
    `fecha: ${resultado.fecha}`,
    `generado: ${nowLocal()}`,
    '---',
    '',
    `# Parte del ${resultado.fecha}`,
    '',
  ];

  /* Cómo cerró ayer va primero, antes de la lista de pendientes. El parte
   * empezaba con lo que se debe; empezar por lo que se hizo cambia con qué
   * ánimo se lee el resto. */
  const cerrado = resultado.diaCerrado;
  if (cerrado && cerrado.fecha) {
    lineas.push(
      '## Cómo cerró ayer',
      '',
      cerrado.cumplida
        ? `- Meta cumplida (${cerrado.pct}%) · **+${cerrado.xp} XP** · racha viva`
        : `- Meta al ${cerrado.pct}% · **+${cerrado.xp} XP** · la racha se cortó`,
      ''
    );
  }

  lineas.push(
    '## Lo que te espera hoy',
    '',
    `- **${porGrabar.length}** auditoría(s) por grabar (meta diaria: ${s.outbound.dailyGoal})`,
    `- **${cola.length}** mensaje(s) por mandar${atrasados.length ? ` — ${atrasados.length} atrasado(s)` : ''}`,
    `- **${bandeja}** en la bandeja de salida`,
    `- **${cartera.length}** factura(s) por cobrar${enMora.length ? `, ${enMora.length} en mora` : ''}`,
    ''
  );

  if (resultado.reuniones.length) {
    lineas.push('## Llamadas de hoy', '');
    resultado.reuniones.forEach((r) => lineas.push(`- ${r.hora} — **${r.cliente}**`));
    lineas.push('');
  }

  if ((resultado.sinResultado || []).length) {
    lineas.push('## Llamadas sin resultado registrado', '');
    resultado.sinResultado.forEach((r) =>
      lineas.push(`- **${r.cliente}** — ${r.cuando} (hace ${r.dias} día(s)). Sin esto no hay tasa de asistencia.`)
    );
    lineas.push('');
  }

  if (resultado.moras.length) {
    lineas.push('## Facturas que pasaron a mora', '', ...resultado.moras.map((n) => `- ${n}`), '');
  }

  if (resultado.renovaciones.length) {
    lineas.push('## Renovaciones cerca', '');
    resultado.renovaciones.forEach((r) =>
      lineas.push(`- **${r.cliente}** en ${r.faltan} día(s) — ${r.monto} ${r.moneda}. Llamar antes, no después.`)
    );
    lineas.push('');
  }

  if (resultado.riesgo.length) {
    lineas.push('## Clientes en riesgo', '');
    resultado.riesgo.forEach((r) => lineas.push(`- **${r.cliente}**: ${r.motivo}`));
    lineas.push('');
  }

  if (resultado.cerrados.length) {
    lineas.push(
      '## Secuencias agotadas (pasaron a perdido, recontacto en 90 días)',
      '',
      ...resultado.cerrados.map((t) => `- ${t}`),
      ''
    );
  }

  const mantenimiento = [];
  if ((resultado.propuestasVencidas || []).length) {
    mantenimiento.push(`- ${resultado.propuestasVencidas.length} propuesta(s) pasaron a vencida: ${resultado.propuestasVencidas.join(', ')}`);
  }
  if ((resultado.sinContacto || []).length) {
    mantenimiento.push(`- ${resultado.sinContacto.length} prospecto(s) descartado(s) por no tener ningún dato de contacto: ${resultado.sinContacto.join(', ')}`);
  }
  if ((resultado.mesAbierto || []).length) {
    mantenimiento.push(`- Mes de producción abierto para: ${resultado.mesAbierto.join(', ')}`);
  }
  if ((resultado.importadas || []).length) {
    mantenimiento.push(`- Importado del vault: ${resultado.importadas.join(' · ')}`);
  }
  if ((resultado.reportes || []).length) {
    mantenimiento.push(`- Borrador de reporte listo para: ${resultado.reportes.join(', ')}`);
  }
  if ((resultado.facturas || []).length) {
    mantenimiento.push(`- Factura(s) generada(s): ${resultado.facturas.join(' · ')}`);
  }
  if (resultado.espejos.length) {
    mantenimiento.push(`- ${resultado.espejos.length} espejo(s) huérfano(s) movidos a \`.respaldos\``);
  }
  if (mantenimiento.length) lineas.push('## Mantenimiento', '', ...mantenimiento, '');

  return lineas.join('\n');
}

// ---------------------------------------------------------------------------
// La corrida
// ---------------------------------------------------------------------------

/* Qué tareas corre el reloj. Todo lo que solo reordena datos propios viene
 * encendido; lo que emite un documento con consecutivo — la factura — viene
 * apagado, porque numerar factura es un acto contable y esa decisión no la toma
 * un temporizador. */
const TAREAS_POR_DEFECTO = {
  vencerPropuestas: true,
  limpiarProspectos: true,
  abrirMes: true,
  importarVault: true,
  reportes: true,
  facturarBorradores: false,
  // Deja escrito el resultado del dia anterior. Sin esto no hay racha: un
  // conteo recalculado sobre el estado de hoy cambiaria el pasado cada vez que
  // se ajusta la meta, y una racha que se reescribe no se siente ganada.
  cerrarDia: true,
};

function tareasDe(state) {
  return { ...TAREAS_POR_DEFECTO, ...((state.settings.reloj || {}).tareas || {}) };
}

// Llama a una dependencia opcional. El reloj se prueba sin servidor, así que
// nada puede reventar porque una dependencia no venga en el paquete.
function opcional(deps, nombre, ...args) {
  const fn = deps && deps[nombre];
  return typeof fn === 'function' ? fn(...args) : [];
}

/* Ejecuta el día. Es idempotente: si ya corrió hoy no vuelve a correr, y si el
 * computador estuvo apagado tres días, al prender corre una vez y se pone al
 * día — no intenta reconstruir los días perdidos, porque un parte de anteayer
 * no le sirve a nadie. */
function correrDia(state, deps, opts) {
  const o = opts || {};
  const fecha = o.fecha || today();
  const cfg = state.settings.reloj || {};
  const tareas = tareasDe(state);

  const moras = marcarMoras(state);
  const cerrados = deps.sweepExhausted(state);
  const renovaciones = avisarRenovaciones(state, cfg.avisoRenovacionDias);
  const riesgo = detectarRiesgo(state);
  const espejos = deps.limpiarEspejos(state);

  const propuestasVencidas = tareas.vencerPropuestas ? vencerPropuestas(state) : [];
  const sinContacto = tareas.limpiarProspectos ? descartarSinContacto(state, deps, cfg.graciaSinContactoDias) : [];
  const sinResultado = reunionesSinResultado(state);

  // Lo mecánico de producción: abrir el mes, recoger lo que dejaron los agentes
  // en el vault y armar el borrador de reporte cuando el mes va terminando.
  const mesAbierto = tareas.abrirMes ? opcional(deps, 'abrirMes', state, fecha.slice(0, 7)) : [];
  const importadas = tareas.importarVault ? opcional(deps, 'importarVault', state, fecha.slice(0, 7)) : [];
  const reportes = tareas.reportes && Number(fecha.slice(8, 10)) >= 28 ? opcional(deps, 'generarReportes', state, fecha.slice(0, 7)) : [];
  const facturas = tareas.facturarBorradores ? opcional(deps, 'facturarVencidas', state) : [];

  /* Cierra el dia ANTERIOR, no el de hoy: hoy todavia se esta jugando y
   * escribir su resultado a las 8 de la manana lo daria por perdido antes de
   * empezar. El de ayer ya no puede cambiar. */
  const diaCerrado = tareas.cerrarDia ? opcional(deps, 'cerrarDia', state, addDays(fecha, -1)) : null;

  const reuniones = state.deals
    .filter((d) => d.meeting && d.meeting.at && String(d.meeting.at).slice(0, 10) === fecha && d.meeting.status !== 'cancelada')
    .map((d) => ({
      cliente: (state.clients.find((c) => c.id === d.clientId) || {}).name || d.title,
      hora: String(d.meeting.at).slice(11, 16) || '—',
    }))
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const resultado = {
    fecha,
    moras,
    cerrados,
    renovaciones,
    riesgo,
    espejos,
    reuniones,
    propuestasVencidas,
    sinContacto,
    sinResultado,
    mesAbierto,
    importadas,
    reportes,
    facturas,
    diaCerrado,
  };

  state.settings.reloj.ultimaCorrida = fecha;
  state.settings.reloj.ultimaCorridaAt = nowISO();

  return resultado;
}

/* Arranca el reloj. Revisa cada 10 minutos si al día de hoy le falta su
 * corrida; cuando le falta y ya pasó la hora configurada, corre. */
function arrancar(deps) {
  const tic = () => {
    try {
      const state = deps.readState();
      const cfg = state.settings.reloj;
      if (!cfg.activo) return;
      if (cfg.ultimaCorrida === today()) return;

      const hora = Number(String(cfg.hora || '08:00').slice(0, 2));
      if (new Date().getHours() < hora) return;

      const resultado = correrDia(state, deps);
      deps.writeState(state);
      const parte = armarParte(state, resultado, { ...deps, outboxPendientes: deps.contarBandeja() });
      escribirParte(deps.parteDir, resultado.fecha, parte);
      console.log(`[agency-os] Parte del día ${resultado.fecha} listo.`);
    } catch (err) {
      console.error('[agency-os] El reloj falló:', err.message);
    }
  };

  tic();
  const timer = setInterval(tic, CADA);
  timer.unref(); // Que el reloj no impida cerrar el proceso.
  return timer;
}

module.exports = {
  arrancar,
  correrDia,
  armarParte,
  escribirParte,
  marcarMoras,
  avisarRenovaciones,
  detectarRiesgo,
  vencerPropuestas,
  descartarSinContacto,
  reunionesSinResultado,
  tareasDe,
  TAREAS_POR_DEFECTO,
};
