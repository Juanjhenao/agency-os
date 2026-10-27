/* La calculadora: cuánto hay que facturar para que la cuenta cierre.
 *
 * Finanzas ya existía, pero mira hacia atrás: consolida lo que se facturó, se
 * cobró y se gastó. Eso sirve para saber cómo fue el mes, no para decidir. La
 * pregunta que de verdad se hace un dueño es la contraria y nadie la
 * respondía: con estos gastos y este precio, ¿cuánto tengo que vender?
 *
 * Y hay una segunda pregunta que casi ninguna herramienta junta, porque separa
 * la empresa de la persona como si fueran dos mundos: ¿cuánto tiene que
 * facturar la empresa para que, después de sus propios gastos y de impuestos,
 * a mí me quede lo que necesito para vivir? Ese número —el punto de equilibrio
 * real— es el que decide si un negocio aguanta, y es el que calcula el botón
 * de gastos personales.
 *
 * La fórmula, escrita una vez para que se pueda auditar:
 *
 *     (F − G) · (1 − t) = P     →     F = G + P / (1 − t)
 *
 * donde F es facturación, G gastos de empresa, t la tasa de impuestos sobre la
 * utilidad y P lo que la persona necesita sacar. El impuesto se aplica sobre
 * la utilidad, no sobre la facturación: cobrarlo sobre lo bruto es el error
 * que hace que estos cálculos den de menos.
 */

const CALC_FREQ = [
  { value: 'mes', label: 'al mes' },
  { value: 'anio', label: 'al año' },
  { value: 'unico', label: 'una vez' },
];

function calc() {
  const c = (App.state.settings && App.state.settings.calculadora) || {};
  return {
    moneda: c.moneda || 'COP',
    impuestoPct: Number(c.impuestoPct || 0),
    ticketPromedio: Number(c.ticketPromedio || 0),
    personalVisible: !!c.personalVisible,
    ingresos: Array.isArray(c.ingresos) ? c.ingresos : [],
    gastosEmpresa: Array.isArray(c.gastosEmpresa) ? c.gastosEmpresa : [],
    gastosPersonales: Array.isArray(c.gastosPersonales) ? c.gastosPersonales : [],
  };
}

/* Todo se normaliza a valor MENSUAL antes de sumar. Mezclar un arriendo
 * mensual con un seguro anual y un equipo comprado una vez es el error que
 * hace que la cuenta parezca sana: lo anual se divide, y lo de una sola vez no
 * entra en el corrido del mes pero se muestra aparte, porque igual hay que
 * pagarlo. */
function aMensual(linea) {
  const monto = Number(linea.monto || 0);
  const enCop = toCop(monto, linea.moneda || 'COP');
  if (linea.frecuencia === 'anio') return enCop / 12;
  if (linea.frecuencia === 'unico') return 0;
  return enCop;
}

function sumaMensual(lineas) {
  return (lineas || []).reduce((s, l) => s + aMensual(l), 0);
}

function sumaUnica(lineas) {
  return (lineas || []).filter((l) => l.frecuencia === 'unico').reduce((s, l) => s + toCop(Number(l.monto || 0), l.moneda || 'COP'), 0);
}

function calcResultado() {
  const c = calc();
  const t = Math.min(0.95, Math.max(0, c.impuestoPct / 100));

  const ingreso = sumaMensual(c.ingresos);
  const gastoEmpresa = sumaMensual(c.gastosEmpresa);
  const gastoPersonal = c.personalVisible ? sumaMensual(c.gastosPersonales) : 0;

  const utilidadBruta = ingreso - gastoEmpresa;
  const impuesto = utilidadBruta > 0 ? utilidadBruta * t : 0;
  const utilidadNeta = utilidadBruta - impuesto;
  const margen = ingreso ? utilidadNeta / ingreso : 0;

  // Facturación mínima para no perder plata en la empresa.
  const equilibrioEmpresa = gastoEmpresa;
  // Facturación mínima para que además alcance para vivir. F = G + P/(1−t)
  const equilibrioTotal = gastoEmpresa + (t < 1 ? gastoPersonal / (1 - t) : gastoPersonal);

  const sobra = utilidadNeta - gastoPersonal;
  const faltaFacturar = Math.max(0, equilibrioTotal - ingreso);

  return {
    ...c,
    ingreso,
    gastoEmpresa,
    gastoPersonal,
    utilidadBruta,
    impuesto,
    utilidadNeta,
    margen,
    equilibrioEmpresa,
    equilibrioTotal,
    sobra,
    faltaFacturar,
    unicos: sumaUnica(c.ingresos) - sumaUnica(c.gastosEmpresa) - (c.personalVisible ? sumaUnica(c.gastosPersonales) : 0),
    // Cuántos clientes faltan, si sabemos cuánto paga uno. Traducir la brecha a
    // clientes es lo que la vuelve accionable: "faltan $4.2M" no se puede
    // trabajar; "faltan 3 clientes" sí.
    clientesFaltantes: c.ticketPromedio > 0 ? Math.ceil(faltaFacturar / c.ticketPromedio) : null,
  };
}

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------

/* Se guarda con retardo: escribir en el vault en cada tecla castigaría el
 * disco y no aporta nada. Medio segundo después de dejar de teclear, basta. */
let calcTimer = null;
function calcGuardar() {
  clearTimeout(calcTimer);
  calcTimer = setTimeout(() => {
    api.settings({ calculadora: App.state.settings.calculadora }).catch((err) => toast(err.message, 'error'));
  }, 500);
}

function calcSet(cambios) {
  App.state.settings.calculadora = { ...calc(), ...cambios };
  calcGuardar();
}

function calcLineas(grupo) {
  return calc()[grupo] || [];
}

function calcNuevaLinea() {
  return { id: `l${Date.now()}${Math.round(Math.random() * 999)}`, concepto: '', monto: 0, moneda: calc().moneda, frecuencia: 'mes' };
}

// ---------------------------------------------------------------------------
// Pintado
// ---------------------------------------------------------------------------

function calcFilas(grupo, lineas) {
  if (!lineas.length) {
    return `<p class="calc-vacio">Sin líneas. Agrega la primera.</p>`;
  }
  return `<div class="calc-tabla">
    ${lineas
      .map(
        (l) => `<div class="calc-fila" data-linea="${esc(l.id)}">
          <input class="calc-concepto" type="text" value="${esc(l.concepto || '')}"
            placeholder="Concepto" data-act="calc-edit" data-grupo="${grupo}" data-id="${esc(l.id)}" data-campo="concepto">
          <input class="calc-monto num" type="number" step="any" value="${esc(l.monto || '')}"
            placeholder="0" data-act="calc-edit" data-grupo="${grupo}" data-id="${esc(l.id)}" data-campo="monto">
          <select class="calc-moneda" data-act="calc-edit" data-grupo="${grupo}" data-id="${esc(l.id)}" data-campo="moneda">
            ${['COP', 'USD', 'MXN'].map((m) => `<option value="${m}"${(l.moneda || 'COP') === m ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
          <select class="calc-freq" data-act="calc-edit" data-grupo="${grupo}" data-id="${esc(l.id)}" data-campo="frecuencia">
            ${CALC_FREQ.map((f) => `<option value="${f.value}"${(l.frecuencia || 'mes') === f.value ? ' selected' : ''}>${f.label}</option>`).join('')}
          </select>
          <span class="calc-mensual num">${l.frecuencia === 'unico' ? '—' : fmtShort(aMensual(l), 'COP')}</span>
          <button class="calc-quitar" data-act="calc-quitar" data-grupo="${grupo}" data-id="${esc(l.id)}" aria-label="Quitar línea">✕</button>
        </div>`
      )
      .join('')}
  </div>`;
}

function calcBloque(titulo, grupo, tono) {
  const lineas = calcLineas(grupo);
  const total = sumaMensual(lineas);
  return `<section class="card calc-bloque calc-${tono}">
    <header class="card-head">
      <h2>${esc(titulo)}</h2>
      <span class="calc-total num">${esc(fmtShort(total, 'COP'))}<em>/mes</em></span>
    </header>
    ${calcFilas(grupo, lineas)}
    <div class="calc-acciones">
      ${btn('+ Línea', 'calc-add', { small: true, data: { grupo } })}
      ${grupo === 'ingresos' ? btn('Traer mi MRR', 'calc-mrr', { small: true }) : ''}
      ${grupo === 'gastosEmpresa' ? btn('Traer gastos reales', 'calc-gastos', { small: true }) : ''}
    </div>
  </section>`;
}

/* El resultado se pinta en su propio nodo y se repinta solo a él.
 *
 * Volver a pintar la vista entera en cada tecla haría perder el foco del campo
 * que se está escribiendo — el error clásico de las calculadoras hechas con
 * re-render completo, y la razón por la que muchas se sienten rotas. */
function calcResultadoHTML() {
  const r = calcResultado();
  const sano = r.sobra >= 0;

  const linea = (label, valor, clase) =>
    `<li class="${clase || ''}"><span>${esc(label)}</span><strong class="num">${esc(valor)}</strong></li>`;

  const cuentaEmpresa = `<ul class="calc-cuenta">
    ${linea('Ingresos', fmtShort(r.ingreso, 'COP'))}
    ${linea('Gastos de empresa', `− ${fmtShort(r.gastoEmpresa, 'COP')}`)}
    ${linea('Utilidad antes de impuestos', fmtShort(r.utilidadBruta, 'COP'), 'sub')}
    ${r.impuestoPct ? linea(`Impuestos (${r.impuestoPct}%)`, `− ${fmtShort(r.impuesto, 'COP')}`) : ''}
    ${linea('Utilidad neta', fmtShort(r.utilidadNeta, 'COP'), 'fuerte')}
    ${r.personalVisible ? linea('Gastos personales', `− ${fmtShort(r.gastoPersonal, 'COP')}`) : ''}
    ${
      r.personalVisible
        ? linea(sano ? 'Te queda libre' : 'Te falta cada mes', fmtShort(Math.abs(r.sobra), 'COP'), sano ? 'fuerte ok' : 'fuerte mal')
        : ''
    }
  </ul>`;

  /* El veredicto en una frase. Un tablero de cifras obliga a interpretar; una
   * frase dice qué pasa. Es lo único que se lee cuando se abre con prisa. */
  let veredicto;
  if (!r.ingreso && !r.gastoEmpresa) {
    veredicto = `<p class="calc-veredicto neutro">Escribe tus ingresos y gastos arriba. El resultado se calcula solo.</p>`;
  } else if (!r.personalVisible) {
    veredicto =
      r.utilidadNeta >= 0
        ? `<p class="calc-veredicto ok">La empresa deja <strong>${esc(fmtShort(r.utilidadNeta, 'COP'))}</strong> al mes, un margen del <strong>${Math.round(r.margen * 100)}%</strong>.</p>`
        : `<p class="calc-veredicto mal">La empresa pierde <strong>${esc(fmtShort(-r.utilidadNeta, 'COP'))}</strong> al mes. Necesitas facturar <strong>${esc(fmtShort(r.equilibrioEmpresa, 'COP'))}</strong> solo para no perder.</p>`;
  } else if (sano) {
    veredicto = `<p class="calc-veredicto ok">Cubres la empresa y tu vida, y sobran <strong>${esc(fmtShort(r.sobra, 'COP'))}</strong> al mes.</p>`;
  } else {
    veredicto = `<p class="calc-veredicto mal">Te faltan <strong>${esc(fmtShort(-r.sobra, 'COP'))}</strong> al mes.
      Tendrías que facturar <strong>${esc(fmtShort(r.equilibrioTotal, 'COP'))}</strong>${
        r.clientesFaltantes ? ` — unos <strong>${r.clientesFaltantes} cliente(s) más</strong>` : ''
      }.</p>`;
  }

  const kpis = `<div class="kpi-row">
    ${kpi('Utilidad neta', fmtShort(r.utilidadNeta, 'COP'), 'al mes', r.utilidadNeta >= 0 ? 'green' : 'red')}
    ${kpi('Margen', `${Math.round(r.margen * 100)}%`, r.margen >= 0.5 ? 'sano' : r.margen >= 0.25 ? 'ajustado' : 'apretado', r.margen >= 0.5 ? 'green' : r.margen >= 0.25 ? 'amber' : 'red')}
    ${kpi(
      r.personalVisible ? 'Equilibrio total' : 'Equilibrio empresa',
      fmtShort(r.personalVisible ? r.equilibrioTotal : r.equilibrioEmpresa, 'COP'),
      'facturación mínima',
      'blue'
    )}
    ${
      r.personalVisible
        ? kpi(sano ? 'Libre' : 'Falta', fmtShort(Math.abs(r.sobra), 'COP'), sano ? 'después de todo' : 'cada mes', sano ? 'green' : 'red')
        : kpi('Ingresos', fmtShort(r.ingreso, 'COP'), 'al mes', '')
    }
  </div>`;

  const unicos = r.unicos
    ? `<p class="calc-unicos">Aparte del corrido mensual hay <strong>${esc(fmtShort(Math.abs(r.unicos), 'COP'))}</strong> ${
        r.unicos > 0 ? 'de entradas' : 'de salidas'
      } de una sola vez.</p>`
    : '';

  return `${kpis}
    ${section('El resultado', `${veredicto}${cuentaEmpresa}${unicos}`)}`;
}

// ---------------------------------------------------------------------------
// La vista
// ---------------------------------------------------------------------------

App.views.calculadora = {
  title: 'Calculadora',
  sub: 'Cuánto hay que facturar para que la cuenta cierre.',
  actions: () => {
    const c = calc();
    return `${btn(c.personalVisible ? 'Ocultar gastos personales' : '+ Gastos personales', 'calc-personal', {
      cls: c.personalVisible ? 'btn-ghost' : 'btn-primary',
    })} ${btn('Limpiar', 'calc-limpiar')}`;
  },
  render() {
    const c = calc();

    const ajustes = `<section class="card calc-ajustes">
      <header class="card-head"><h2>Supuestos</h2></header>
      <div class="calc-ajustes-grid">
        <label class="field">
          <span>Impuestos sobre la utilidad</span>
          <input type="number" step="any" min="0" max="95" value="${esc(c.impuestoPct)}"
            data-act="calc-ajuste" data-campo="impuestoPct">
          <small>% que se va en impuestos. Se aplica sobre la utilidad, no sobre lo facturado.</small>
        </label>
        <label class="field">
          <span>Lo que paga un cliente al mes</span>
          <input type="number" step="any" min="0" value="${esc(c.ticketPromedio)}"
            data-act="calc-ajuste" data-campo="ticketPromedio">
          <small>Sirve para traducir lo que falta a número de clientes.</small>
        </label>
      </div>
    </section>`;

    return `${calcBloque('Ingresos', 'ingresos', 'ingreso')}
      ${calcBloque('Gastos de la empresa', 'gastosEmpresa', 'gasto')}
      ${
        c.personalVisible
          ? calcBloque('Gastos personales', 'gastosPersonales', 'personal')
          : `<section class="card calc-invitacion">
              <p>¿Quieres saber cuánto tiene que facturar la empresa para que además te alcance a ti?</p>
              ${btn('+ Gastos personales', 'calc-personal', { cls: 'btn-primary' })}
            </section>`
      }
      ${ajustes}
      <div id="calc-resultado">${calcResultadoHTML()}</div>`;
  },
};

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

// Repinta solo el resultado: así el campo que se está escribiendo no pierde
// el foco ni el cursor de posición.
function calcRefrescar() {
  const nodo = document.getElementById('calc-resultado');
  if (nodo) nodo.innerHTML = calcResultadoHTML();
  document.querySelectorAll('.calc-bloque').forEach((bloque) => {
    const grupo = bloque.className.includes('calc-ingreso')
      ? 'ingresos'
      : bloque.className.includes('calc-gasto')
        ? 'gastosEmpresa'
        : 'gastosPersonales';
    const total = bloque.querySelector('.calc-total');
    if (total) total.innerHTML = `${esc(fmtShort(sumaMensual(calcLineas(grupo)), 'COP'))}<em>/mes</em>`;
  });
}

App.actions['calc-edit'] = (el) => {
  const { grupo, id, campo } = el.dataset;
  const lineas = calcLineas(grupo).map((l) =>
    l.id === id ? { ...l, [campo]: campo === 'monto' ? Number(el.value || 0) : el.value } : l
  );
  calcSet({ [grupo]: lineas });

  // La columna "al mes" de esta fila sí se actualiza en sitio.
  const fila = el.closest('.calc-fila');
  const linea = lineas.find((l) => l.id === id);
  const celda = fila && fila.querySelector('.calc-mensual');
  if (celda && linea) celda.textContent = linea.frecuencia === 'unico' ? '—' : fmtShort(aMensual(linea), 'COP');
  calcRefrescar();
};

App.actions['calc-ajuste'] = (el) => {
  calcSet({ [el.dataset.campo]: Number(el.value || 0) });
  calcRefrescar();
};

App.actions['calc-add'] = (el) => {
  const grupo = el.dataset.grupo;
  calcSet({ [grupo]: [...calcLineas(grupo), calcNuevaLinea()] });
  render();
  // El foco va al concepto recién creado: agregar una línea y tener que ir a
  // buscarla con el ratón rompe el ritmo de escribir una lista.
  const campos = document.querySelectorAll(`.calc-${grupo === 'ingresos' ? 'ingreso' : grupo === 'gastosEmpresa' ? 'gasto' : 'personal'} .calc-concepto`);
  if (campos.length) campos[campos.length - 1].focus();
};

App.actions['calc-quitar'] = (el) => {
  const { grupo, id } = el.dataset;
  calcSet({ [grupo]: calcLineas(grupo).filter((l) => l.id !== id) });
  render();
};

App.actions['calc-personal'] = () => {
  const c = calc();
  const abrir = !c.personalVisible;
  /* Al abrirlo por primera vez se siembran las categorías que casi nadie
   * recuerda de memoria pero paga todos los meses. Una lista en blanco invita
   * a olvidar la mitad, y una cuenta a la que le faltan tres gastos da un
   * resultado tranquilizador y falso. */
  const semilla =
    abrir && !c.gastosPersonales.length
      ? ['Arriendo o cuota', 'Mercado', 'Servicios', 'Transporte', 'Salud', 'Deudas', 'Ocio y gustos'].map((concepto, i) => ({
          id: `p${Date.now()}${i}`,
          concepto,
          monto: 0,
          moneda: c.moneda,
          frecuencia: 'mes',
        }))
      : c.gastosPersonales;

  calcSet({ personalVisible: abrir, gastosPersonales: semilla });
  render();
};

App.actions['calc-mrr'] = () => {
  const mrr = mrrCop();
  if (!mrr) return toast('Todavía no hay suscripciones activas de dónde sacar el MRR.', 'error');
  calcSet({
    ingresos: [
      ...calcLineas('ingresos'),
      { id: `i${Date.now()}`, concepto: 'MRR de suscripciones activas', monto: Math.round(mrr), moneda: 'COP', frecuencia: 'mes' },
    ],
  });
  render();
  toast('MRR traído desde tus suscripciones.', 'ok');
};

/* Trae el promedio real de los últimos tres meses cerrados, no el mes en
 * curso: un mes a medio andar siempre parece barato y sesga la cuenta hacia
 * abajo justo donde más caro sale equivocarse. */
App.actions['calc-gastos'] = () => {
  const meses = [];
  for (let k = 3; k >= 1; k -= 1) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - k);
    meses.push(d.toLocaleDateString('sv').slice(0, 7));
  }
  const delPeriodo = (App.state.expenses || []).filter((e) => meses.includes((e.date || '').slice(0, 7)));
  if (!delPeriodo.length) return toast('No hay gastos registrados en los últimos tres meses.', 'error');

  const promedio = delPeriodo.reduce((s, e) => s + toCop(e.amount, e.currency), 0) / meses.length;
  calcSet({
    gastosEmpresa: [
      ...calcLineas('gastosEmpresa'),
      { id: `g${Date.now()}`, concepto: `Promedio real (${meses[0]} a ${meses[meses.length - 1]})`, monto: Math.round(promedio), moneda: 'COP', frecuencia: 'mes' },
    ],
  });
  render();
  toast(`Promedio de ${delPeriodo.length} gasto(s) en 3 meses.`, 'ok');
};

App.actions['calc-limpiar'] = () => {
  confirmAction('Se borran todas las líneas de la calculadora. Los gastos registrados en Finanzas no se tocan.', async () => {
    calcSet({ ingresos: [], gastosEmpresa: [], gastosPersonales: [], personalVisible: false });
    render();
  }, 'Limpiar');
};
