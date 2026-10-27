/* El ledger de marketing: memoria de lo que se produjo y de lo que pasó después.
 *
 * Hasta ahora el sistema producía a ciegas. Las skills escribían notas en el
 * vault —copy, guiones, listas de prospección— y ninguna volvía a leerlas. No
 * había forma de responder la única pregunta que importa: de todo lo que
 * publicamos, ¿qué funcionó? Cada campaña arrancaba desde cero, repitiendo
 * ángulos que ya habían fracasado porque nadie llevaba la cuenta.
 *
 * Este archivo es la parte computable de la respuesta. No decide nada por sí
 * solo: agrupa resultados por las dimensiones que importan (canal, ángulo,
 * gancho, nicho), los compara contra su propia base y —esto es lo central—
 * **se niega a concluir cuando no hay evidencia suficiente**.
 *
 * Esa negativa es el diseño, no una limitación. Un sistema que siempre
 * encuentra un ganador con doce envíos no está aprendiendo: está leyendo ruido
 * y convirtiéndolo en doctrina. Es más caro que no aprender nada, porque el
 * error queda escrito en el playbook y gobierna las decisiones siguientes.
 *
 * Corre sin servidor y sin estado global: recibe `state` y devuelve datos.
 */

const CANALES = ['outbound', 'meta-ads', 'google-ads', 'seo', 'organico'];

const TIPOS_ASSET = [
  'ad-copy',
  'video-script',
  'video-audit',
  'email',
  'seo-article',
  'organic-post',
];

const ESTADOS_ASSET = ['generado', 'aprobado', 'rechazado', 'publicado', 'pausado', 'retirado'];

/* Por dónde puede pasar una pieza. El grafo existe para que la vista de
 * Despacho no pueda producir estados imposibles —publicar algo rechazado,
 * revivir algo retirado— y para que el retro pueda confiar en que un
 * `publicado` estuvo de verdad en la calle. */
const TRANSICIONES = {
  generado: ['aprobado', 'rechazado'],
  aprobado: ['publicado', 'rechazado'],
  rechazado: [],
  publicado: ['pausado', 'retirado'],
  pausado: ['publicado', 'retirado'],
  retirado: [],
};

// Las dimensiones sobre las que el retro puede aprender.
const DIMENSIONES = ['angulo', 'gancho', 'tipo', 'canal', 'nicho', 'variante'];

const ESTADOS_PATRON = ['candidato', 'promovido', 'degradado', 'cementerio'];

/* Cuánta evidencia hace falta antes de que un patrón pueda promoverse.
 *
 * Los umbrales no son estadística formal —no hay potencia ni intervalos aquí—
 * sino el piso por debajo del cual sabemos que la conclusión sería ridícula.
 * Es deliberadamente conservador: el costo de promover un patrón falso (queda
 * en el playbook y contamina todo lo que se genere después) es mucho mayor que
 * el de esperar una semana más de datos. */
const N_MINIMO = {
  outbound: { campo: 'enviados', minimo: 30 },
  'meta-ads': { campo: 'impresiones', minimo: 1000 },
  'google-ads': { campo: 'impresiones', minimo: 1000 },
  seo: { campo: 'impresiones', minimo: 1000 },
  organico: { campo: 'impresiones', minimo: 1000 },
};

// Piso transversal: sin cinco leads no hay nada que interpretar, dé el canal lo
// que dé en impresiones.
const LEADS_MINIMOS = 5;

/* Ventana de vigencia de un patrón. Lo que funcionaba hace cuatro meses en
 * anuncios de med spa probablemente ya está quemado: el mercado vio el ángulo,
 * la competencia lo copió, o la plataforma cambió el algoritmo. Un patrón que
 * no se revalida dentro de la ventana deja de gobernar. */
const VENTANA_DIAS = 90;

/* Contadores que se suman al agregar varios resultados. Todo lo demás —CTR,
 * CPL, tasas— se deriva DESPUÉS de sumar, nunca promediando promedios: el
 * promedio de dos CTR con volúmenes distintos no es el CTR del conjunto, y esa
 * confusión es la forma más común de concluir al revés. */
const CRUDOS = [
  'impresiones',
  'clics',
  'gasto',
  'leads',
  'enviados',
  'respuestas',
  'reuniones',
  'cierres',
  'ingresos',
];

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// División que devuelve null en vez de Infinity o NaN. Un CPL de "infinito"
// pintado en un tablero se lee como un número real y arruina la comparación;
// un hueco se lee como lo que es: todavía no se sabe.
function tasa(numerador, denominador) {
  const d = num(denominador);
  if (d <= 0) return null;
  return num(numerador) / d;
}

function crudosVacios() {
  const m = {};
  CRUDOS.forEach((k) => {
    m[k] = 0;
  });
  return m;
}

/* Suma una lista de outcomes en un solo bloque de contadores. */
function sumar(outcomes) {
  const m = crudosVacios();
  (outcomes || []).forEach((o) => {
    const fuente = (o && o.m) || {};
    CRUDOS.forEach((k) => {
      m[k] += num(fuente[k]);
    });
  });
  return m;
}

/* Deriva las tasas a partir de los contadores ya sumados. */
function derivar(m) {
  const base = m || crudosVacios();
  // La tasa de reunión se mide contra el denominador que el canal tenga: en
  // outbound son envíos, en pauta son leads. Mezclarlos daría una cifra que no
  // significa nada en ninguno de los dos mundos.
  const denomReunion = base.enviados > 0 ? base.enviados : base.leads;
  return {
    ...base,
    ctr: tasa(base.clics, base.impresiones),
    cpl: tasa(base.gasto, base.leads),
    cpa: tasa(base.gasto, base.cierres),
    tasaRespuesta: tasa(base.respuestas, base.enviados),
    tasaReunion: tasa(base.reuniones, denomReunion),
    tasaCierre: tasa(base.cierres, base.reuniones),
    roas: tasa(base.ingresos, base.gasto),
  };
}

/* Métricas consolidadas de una sola pieza, sumando todos sus outcomes. */
function metricasDeAsset(state, assetId) {
  const outcomes = (state.outcomes || []).filter((o) => o.assetId === assetId);
  return derivar(sumar(outcomes));
}

// ---------------------------------------------------------------------------
// Evidencia: el guardrail
// ---------------------------------------------------------------------------

/* ¿Alcanza la evidencia para concluir algo sobre este grupo?
 *
 * Devuelve el veredicto Y el motivo, siempre. Quien llama necesita poder
 * escribir en el playbook "no se promovió porque solo hubo 12 envíos de 30",
 * que es una frase útil; "no se promovió" a secas no lo es. */
function evidenciaSuficiente(canal, m) {
  const metricas = m || crudosVacios();
  const regla = N_MINIMO[canal];

  if (!regla) {
    return { suficiente: false, motivo: `canal desconocido: "${canal}"`, n: 0, minimo: 0 };
  }

  const n = num(metricas[regla.campo]);
  if (n < regla.minimo) {
    return {
      suficiente: false,
      motivo: `${n} ${regla.campo} de ${regla.minimo} mínimos`,
      n,
      minimo: regla.minimo,
      campo: regla.campo,
    };
  }

  /* El piso de leads aplica solo cuando el canal ya produjo alguno. Un canal
   * con volumen y cero leads no es "poca evidencia": es un resultado, y uno
   * muy informativo —significa que no convierte— así que tiene que poder
   * concluirse y degradarse. */
  const leads = num(metricas.leads);
  if (leads > 0 && leads < LEADS_MINIMOS) {
    return {
      suficiente: false,
      motivo: `${leads} lead(s) de ${LEADS_MINIMOS} mínimos`,
      n,
      minimo: regla.minimo,
      campo: regla.campo,
    };
  }

  return { suficiente: true, motivo: `${n} ${regla.campo}`, n, minimo: regla.minimo, campo: regla.campo };
}

// ---------------------------------------------------------------------------
// Agregación por dimensión
// ---------------------------------------------------------------------------

function enVentana(fecha, desde, hasta) {
  if (!fecha) return false;
  const f = String(fecha).slice(0, 10);
  if (desde && f < desde) return false;
  if (hasta && f > hasta) return false;
  return true;
}

/* Agrupa las piezas por una dimensión y consolida los resultados de cada grupo.
 *
 * Solo entran piezas que estuvieron publicadas: una pieza que nunca salió no
 * tiene nada que enseñar sobre el mercado. Las rechazadas se analizan aparte
 * (`motivosDeRechazo`), porque enseñan sobre otra cosa —el criterio de Juanjo—
 * y mezclarlas contaminaría ambas lecturas. */
function agrupar(state, opts) {
  const o = opts || {};
  const dimension = o.dimension || 'angulo';
  const assets = (state.assets || []).filter((a) => {
    if (!['publicado', 'pausado', 'retirado'].includes(a.estado)) return false;
    if (o.canal && a.canal !== o.canal) return false;
    if (o.nicho && a.nicho !== o.nicho) return false;
    if (o.campaignId && a.campaignId !== o.campaignId) return false;
    if ((o.desde || o.hasta) && !enVentana(a.publicadoAt, o.desde, o.hasta)) return false;
    return true;
  });

  const porId = new Map();
  assets.forEach((a) => porId.set(a.id, a));

  const outcomes = (state.outcomes || []).filter((oc) => porId.has(oc.assetId));

  const grupos = new Map();
  assets.forEach((a) => {
    const valor = String(a[dimension] || '').trim() || '(sin definir)';
    if (!grupos.has(valor)) {
      grupos.set(valor, { valor, dimension, assets: [], outcomes: [], canales: new Set() });
    }
    const g = grupos.get(valor);
    g.assets.push(a.id);
    g.canales.add(a.canal);
  });

  outcomes.forEach((oc) => {
    const a = porId.get(oc.assetId);
    const valor = String(a[dimension] || '').trim() || '(sin definir)';
    grupos.get(valor).outcomes.push(oc);
  });

  return Array.from(grupos.values()).map((g) => {
    const m = derivar(sumar(g.outcomes));
    // Un grupo con piezas de varios canales no puede evaluarse con un solo
    // umbral. Se marca y el retro lo separa antes de concluir.
    const canal = g.canales.size === 1 ? Array.from(g.canales)[0] : null;
    return {
      dimension,
      valor: g.valor,
      canal,
      canales: Array.from(g.canales),
      assets: g.assets,
      piezas: g.assets.length,
      m,
      evidencia: canal
        ? evidenciaSuficiente(canal, m)
        : { suficiente: false, motivo: `mezcla ${g.canales.size} canales; separar antes de concluir`, n: 0, minimo: 0 },
    };
  });
}

/* La base contra la que se compara un grupo: el consolidado de todo lo demás
 * del mismo universo. Comparar contra el total (que incluye al propio grupo)
 * diluye la diferencia y hace que nada parezca destacar nunca. */
function baselineDe(grupos, valorExcluido) {
  const otros = grupos.filter((g) => g.valor !== valorExcluido);
  const m = crudosVacios();
  otros.forEach((g) => {
    CRUDOS.forEach((k) => {
      m[k] += num(g.m[k]);
    });
  });
  return derivar(m);
}

/* Compara cada grupo contra su base y ordena por desempeño.
 *
 * `mayorEsMejor` importa: en tasa de respuesta sí, en CPL exactamente al revés.
 * Tenerlo explícito evita el error de premiar el costo más alto. */
const MAYOR_ES_MEJOR = {
  ctr: true,
  cpl: false,
  cpa: false,
  tasaRespuesta: true,
  tasaReunion: true,
  tasaCierre: true,
  roas: true,
  leads: true,
  reuniones: true,
  cierres: true,
  ingresos: true,
};

function comparar(grupos, metrica) {
  const mejorArriba = MAYOR_ES_MEJOR[metrica] !== false;

  /* `valorMetrica` y `baseline`, no `valor`: el grupo ya usa `valor` para el
   * valor de la dimensión ("dolor", "urgencia"), y llamar igual a la cifra de
   * la métrica lo pisaba — el consumidor recibía 0.2 donde esperaba el nombre
   * del ángulo. Los nombres son ademas los mismos que la coleccion `patterns`,
   * asi que el retro puede escribir el patron con lo que sale de aqui. */
  const filas = grupos.map((g) => {
    const base = baselineDe(grupos, g.valor);
    const valorMetrica = g.m[metrica];
    const baseline = base[metrica];
    let delta = null;
    if (valorMetrica !== null && baseline !== null && baseline !== 0) {
      delta = (valorMetrica - baseline) / Math.abs(baseline);
      if (!mejorArriba) delta = -delta; // Un CPL más bajo es un delta positivo.
    }
    return { ...g, metrica, valorMetrica, baseline, delta, mejorArriba };
  });

  return filas.sort((a, b) => {
    // Lo que no se puede medir va al final, siempre. Un null ordenado como
    // cero se cuela entre los resultados reales y se lee como un dato.
    if (a.delta === null && b.delta === null) return b.piezas - a.piezas;
    if (a.delta === null) return 1;
    if (b.delta === null) return -1;
    return b.delta - a.delta;
  });
}

// ---------------------------------------------------------------------------
// Experimentos
// ---------------------------------------------------------------------------

/* Evalúa un experimento declarado. Devuelve el veredicto o la razón por la que
 * todavía no hay veredicto — nunca un ganador inventado.
 *
 * El experimento se declara ANTES de producir (hipótesis, métrica y n mínimo
 * fijados de antemano). Esa disciplina es lo que separa un test de una
 * racionalización: si se elige la métrica después de ver los datos, siempre
 * hay una métrica con la que se ganó. */
function evaluarExperimento(state, exp) {
  if (!exp) return null;
  const metrica = exp.metrica || 'tasaRespuesta';
  const mejorArriba = MAYOR_ES_MEJOR[metrica] !== false;

  const brazos = (exp.variantes || []).map((assetId) => {
    const asset = (state.assets || []).find((a) => a.id === assetId) || {};
    const m = metricasDeAsset(state, assetId);
    return {
      assetId,
      etiqueta: asset.variante || asset.titulo || assetId,
      canal: asset.canal,
      m,
      valor: m[metrica],
      evidencia: evidenciaSuficiente(asset.canal, m),
    };
  });

  if (brazos.length < 2) {
    return { estado: 'corriendo', veredicto: 'un experimento necesita al menos dos variantes', brazos };
  }

  const flojos = brazos.filter((b) => !b.evidencia.suficiente);
  if (flojos.length) {
    return {
      estado: 'corriendo',
      veredicto: `sin evidencia suficiente: ${flojos.map((b) => `${b.etiqueta} (${b.evidencia.motivo})`).join(', ')}`,
      brazos,
    };
  }

  const medibles = brazos.filter((b) => b.valor !== null);
  if (medibles.length < 2) {
    return { estado: 'corriendo', veredicto: `"${metrica}" no es calculable en todas las variantes`, brazos };
  }

  const ordenados = medibles
    .slice()
    .sort((a, b) => (mejorArriba ? b.valor - a.valor : a.valor - b.valor));
  const ganador = ordenados[0];
  const segundo = ordenados[1];

  let delta = null;
  if (segundo.valor !== 0) delta = Math.abs((ganador.valor - segundo.valor) / segundo.valor);

  /* Menos de 10% de diferencia entre el primero y el segundo, con estos
   * volúmenes, es empate. Declarar ganador ahí es exactamente el ruido que
   * este módulo existe para no escribir en el playbook. */
  if (delta !== null && delta < 0.1) {
    return {
      estado: 'concluido',
      veredicto: `empate: ${(delta * 100).toFixed(1)}% de diferencia, por debajo del 10% que se considera decisivo`,
      ganador: '',
      delta,
      brazos,
    };
  }

  return {
    estado: 'concluido',
    veredicto: `gana "${ganador.etiqueta}" en ${metrica} por ${((delta || 0) * 100).toFixed(1)}%`,
    ganador: ganador.assetId,
    delta,
    brazos,
  };
}

// ---------------------------------------------------------------------------
// Vigencia de los patrones
// ---------------------------------------------------------------------------

/* Un patrón que no se revalida dentro de la ventana caduca. No se borra: pasa
 * a `degradado` con la razón escrita. Nada sale del ledger nunca —el
 * cementerio es lo que impide volver a aprender lo mismo dentro de tres
 * meses— pero deja de gobernar la generación. */
function patronesVencidos(state, hoy) {
  const limite = new Date(`${hoy}T00:00:00`);
  limite.setDate(limite.getDate() - VENTANA_DIAS);
  const corte = limite.toLocaleDateString('sv');

  return (state.patterns || []).filter((p) => {
    if (p.estado !== 'promovido') return false;
    const ultima = String(p.revisadoAt || p.hasta || '').slice(0, 10);
    return !ultima || ultima < corte;
  });
}

// ---------------------------------------------------------------------------
// Lo que enseñan los rechazos
// ---------------------------------------------------------------------------

/* Por qué Juanjo rechaza piezas. Es la señal de entrenamiento más barata del
 * sistema —cinco palabras al oprimir un botón— y la única que corrige el
 * criterio antes de que algo salga a la calle y cueste dinero. */
function motivosDeRechazo(state, opts) {
  const o = opts || {};
  const rechazados = (state.assets || []).filter((a) => {
    if (a.estado !== 'rechazado') return false;
    if (o.canal && a.canal !== o.canal) return false;
    if ((o.desde || o.hasta) && !enVentana(String(a.updatedAt || '').slice(0, 10), o.desde, o.hasta)) return false;
    return true;
  });

  const porMotivo = new Map();
  rechazados.forEach((a) => {
    const motivo = String(a.motivoRechazo || '').trim() || '(sin motivo)';
    if (!porMotivo.has(motivo)) porMotivo.set(motivo, { motivo, veces: 0, assets: [] });
    const m = porMotivo.get(motivo);
    m.veces += 1;
    m.assets.push(a.id);
  });

  return {
    total: rechazados.length,
    motivos: Array.from(porMotivo.values()).sort((a, b) => b.veces - a.veces),
  };
}

// ---------------------------------------------------------------------------
// El tablero
// ---------------------------------------------------------------------------

/* La vista que consumen la pantalla de Tablero y el agente de retro. Una sola
 * función para las dos, a propósito: si la pantalla y el que aprende leyeran
 * cifras calculadas por caminos distintos, tarde o temprano discrepan y no hay
 * forma de saber cuál miente. */
function tablero(state, opts) {
  const o = opts || {};
  const metrica = o.metrica || 'tasaRespuesta';

  const total = derivar(
    sumar(
      (state.outcomes || []).filter((oc) => {
        if (!o.desde && !o.hasta) return true;
        return enVentana(oc.fecha, o.desde, o.hasta);
      })
    )
  );

  const porCanal = CANALES.map((canal) => {
    const grupos = agrupar(state, { ...o, canal, dimension: 'canal' });
    const m = derivar(sumar(grupos.flatMap((g) => g.outcomes || [])));
    const piezas = (state.assets || []).filter((a) => a.canal === canal);
    return {
      canal,
      piezas: piezas.length,
      publicadas: piezas.filter((a) => a.estado === 'publicado').length,
      enDespacho: piezas.filter((a) => ['generado', 'aprobado'].includes(a.estado)).length,
      m: grupos.length ? grupos[0].m : m,
      evidencia: evidenciaSuficiente(canal, grupos.length ? grupos[0].m : m),
    };
  });

  const dimensiones = {};
  ['angulo', 'gancho', 'tipo'].forEach((d) => {
    dimensiones[d] = comparar(agrupar(state, { ...o, dimension: d }), metrica);
  });

  const experimentos = (state.experiments || [])
    .filter((e) => e.estado === 'corriendo')
    .map((e) => ({ ...e, evaluacion: evaluarExperimento(state, e) }));

  return {
    metrica,
    ventana: { desde: o.desde || null, hasta: o.hasta || null },
    total,
    porCanal,
    dimensiones,
    experimentos,
    rechazos: motivosDeRechazo(state, o),
    despacho: (state.assets || []).filter((a) => ['generado', 'aprobado'].includes(a.estado)).length,
  };
}

module.exports = {
  CANALES,
  TIPOS_ASSET,
  ESTADOS_ASSET,
  TRANSICIONES,
  DIMENSIONES,
  ESTADOS_PATRON,
  N_MINIMO,
  LEADS_MINIMOS,
  VENTANA_DIAS,
  CRUDOS,
  MAYOR_ES_MEJOR,
  sumar,
  derivar,
  tasa,
  metricasDeAsset,
  evidenciaSuficiente,
  agrupar,
  baselineDe,
  comparar,
  evaluarExperimento,
  patronesVencidos,
  motivosDeRechazo,
  tablero,
};
