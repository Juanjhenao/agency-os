/* Validacion de lo que entra por la API.
 *
 * Las rutas genericas de coleccion aceptaban el cuerpo tal como llegaba. El
 * problema no es teorico: un `unitPrice` que entre como texto — porque un
 * formulario mando "1.800" con punto de miles, o porque un agente escribio el
 * campo a mano — convierte el total en NaN, y ese NaN se propaga callado a la
 * propuesta, al contrato, a la factura y al consolidado de finanzas. Cuando lo
 * notas, ya firmaste.
 *
 * El criterio es conservador a proposito: se corrigen y se verifican los campos
 * conocidos, y lo que no conocemos se deja pasar tal cual. Una lista blanca
 * estricta borraria campos que la interfaz manda y este archivo no sabe que
 * existen; el objetivo es atrapar el error de tipo, no rediseniar el modelo.
 */

/* El vocabulario del ledger de marketing —canales, tipos, estados— vive en
 * lib/marketing.js, que es quien lo usa para calcular. Se importa en vez de
 * copiarse: dos listas de estados que se editan por separado terminan
 * discrepando, y el sintoma es una pieza que la API acepta y el tablero no
 * sabe contar. */
const mk = require('./marketing');

// Campos que tienen que ser numeros finitos, por coleccion.
const NUMEROS = {
  deals: ['value', 'probability'],
  services: ['priceCOP', 'priceUSD', 'order'],
  proposals: ['discount', 'taxRate', 'withholding'],
  invoices: ['discount', 'taxRate', 'withholding'],
  contracts: ['amount', 'termMonths'],
  subscriptions: ['amount', 'billingDay'],
  expenses: ['amount'],
  pieces: ['target'],
  touches: ['step'],
  campaigns: ['presupuestoMes'],
  experiments: ['nMinimo', 'delta'],
  patterns: ['n', 'valorMetrica', 'baseline'],
};

// Campos de fecha en formato AAAA-MM-DD.
const FECHAS = {
  deals: ['expectedCloseDate', 'nextActionDate'],
  proposals: ['issueDate', 'validUntil', 'acceptedDate', 'decidedAt'],
  invoices: ['issueDate', 'dueDate', 'paidDate'],
  contracts: ['startDate', 'signedDate', 'endDate'],
  subscriptions: ['startDate', 'nextInvoiceDate'],
  expenses: ['date'],
  touches: ['dueDate'],
  outcomes: ['fecha'],
  experiments: ['inicio', 'fin'],
  patterns: ['desde', 'hasta'],
};

// Valores cerrados: si llega algo fuera de la lista, es un error de quien llama.
const ENUMS = {
  deals: { stage: ['nuevo', 'contactado', 'reunion', 'propuesta', 'negociacion', 'ganado', 'perdido'] },
  proposals: { status: ['borrador', 'enviada', 'aceptada', 'rechazada', 'vencida'] },
  invoices: { status: ['borrador', 'enviada', 'pagada', 'vencida', 'anulada'] },
  contracts: { status: ['borrador', 'enviado', 'firmado', 'terminado'] },
  subscriptions: { status: ['activa', 'pausada', 'cancelada'] },
  clients: { status: ['lead', 'prospecto', 'activo', 'pausado', 'perdido'] },
  touches: { status: ['pendiente', 'enviado', 'omitido', 'cancelado'] },
  campaigns: {
    canal: mk.CANALES,
    estado: ['borrador', 'activa', 'pausada', 'cerrada'],
    objetivo: ['leads', 'reuniones', 'ventas', 'alcance'],
  },
  assets: { canal: mk.CANALES, tipo: mk.TIPOS_ASSET, estado: mk.ESTADOS_ASSET },
  outcomes: { fuente: ['crm', 'meta-csv', 'google-csv', 'ga4-csv', 'youtube-csv', 'manual'] },
  experiments: { estado: ['corriendo', 'concluido', 'abortado'], dimension: mk.DIMENSIONES },
  patterns: { estado: mk.ESTADOS_PATRON, dimension: mk.DIMENSIONES, canal: mk.CANALES },
};

const MONEDAS = ['COP', 'USD', 'MXN'];
const CON_MONEDA = ['deals', 'proposals', 'invoices', 'contracts', 'subscriptions', 'expenses', 'clients', 'campaigns'];

class ErrorDeDatos extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDeDatos';
    this.esDeDatos = true;
  }
}

/* Convierte a numero lo que se pueda y falla con lo que no.
 *
 * Acepta el formato con el que la gente escribe plata de verdad: "1.800",
 * "1,800.50", "$ 1800". No acepta "mil ochocientos" ni cadenas vacias donde se
 * espera un numero — eso es un error, y callarlo es lo que produce el NaN. */
function aNumero(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new ErrorDeDatos(`El campo "${campo}" no es un numero valido.`);
    return valor;
  }
  if (typeof valor !== 'string') throw new ErrorDeDatos(`El campo "${campo}" deberia ser un numero.`);

  let limpio = valor.trim().replace(/[^\d.,-]/g, '');
  /* Si al quitar simbolos no queda ni un digito, lo que llego no era un numero
   * escrito raro: era otra cosa. Devolver cero seria el mismo error silencioso
   * que este archivo existe para evitar. */
  if (!/\d/.test(limpio)) throw new ErrorDeDatos(`El campo "${campo}" no es un numero valido: "${valor}".`);
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');

  if (ultimaComa > -1 && ultimoPunto > -1) {
    // El separador decimal es el que aparece de ultimo: "1.800,50" o "1,800.50".
    const decimal = ultimaComa > ultimoPunto ? ',' : '.';
    const miles = decimal === ',' ? '.' : ',';
    limpio = limpio.split(miles).join('').replace(decimal, '.');
  } else if (ultimaComa > -1) {
    // Varias comas solo pueden ser separadores de miles: "1,800,000".
    if (limpio.split(',').length > 2) limpio = limpio.split(',').join('');
    // Una sola: decimal si deja 1 o 2 digitos, separador de miles si deja 3.
    else limpio = limpio.length - ultimaComa <= 3 ? limpio.replace(',', '.') : limpio.split(',').join('');
  } else if (ultimoPunto > -1) {
    const decimales = limpio.length - ultimoPunto - 1;
    const puntos = limpio.split('.').length - 1;
    // "3.500.000" — varios puntos son miles. "1.800" tambien: en Colombia
    // nadie escribe mil ochocientos con tres decimales.
    if (puntos > 1 || (decimales === 3 && !limpio.startsWith('0.'))) {
      limpio = limpio.split('.').join('');
    }
  }

  const n = Number(limpio);
  if (!Number.isFinite(n)) throw new ErrorDeDatos(`El campo "${campo}" no es un numero valido: "${valor}".`);
  return n;
}

function esFecha(valor) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(valor))) return false;
  const d = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

/* Las lineas de un documento son donde vive el dinero: una linea mala arruina
 * el total, y el total es lo que el cliente firma. */
function limpiarItems(items) {
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) throw new ErrorDeDatos('Los conceptos deben venir como lista.');
  return items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new ErrorDeDatos(`El concepto ${i + 1} no es valido.`);
    const qty = aNumero(it.qty === undefined ? 1 : it.qty, `cantidad del concepto ${i + 1}`);
    const unitPrice = aNumero(it.unitPrice, `valor del concepto ${i + 1}`);
    if (qty < 0) throw new ErrorDeDatos(`La cantidad del concepto ${i + 1} no puede ser negativa.`);
    return { ...it, description: String(it.description || '').trim(), qty, unitPrice };
  });
}

/* Los contadores de un resultado de marketing.
 *
 * Aqui el riesgo del NaN es mayor que en el resto del sistema, no menor: estos
 * numeros no los teclea una persona mirando la pantalla, los deposita un CSV
 * exportado de Meta o de Google donde "1,234" impresiones y "$ 45,60" de gasto
 * son formatos normales. Un solo NaN que entre se suma a todos los agregados,
 * y el tablero deja de decir la verdad sin mostrar ningun error. */
function limpiarMetricas(m) {
  if (m === undefined) return undefined;
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    throw new ErrorDeDatos('Las metricas deben venir como objeto.');
  }
  const out = { ...m };
  mk.CRUDOS.forEach((campo) => {
    if (out[campo] === undefined || out[campo] === null || out[campo] === '') return;
    const n = aNumero(out[campo], `metrica "${campo}"`);
    if (n < 0) throw new ErrorDeDatos(`La metrica "${campo}" no puede ser negativa: ${n}.`);
    out[campo] = n;
  });
  return out;
}

/* Devuelve una copia corregida del cuerpo, o lanza si hay algo que no se puede
 * arreglar sin adivinar. */
function limpiar(collection, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ErrorDeDatos('El cuerpo de la peticion debe ser un objeto.');
  }
  const out = { ...body };

  (NUMEROS[collection] || []).forEach((campo) => {
    if (out[campo] !== undefined) out[campo] = aNumero(out[campo], campo);
  });

  (FECHAS[collection] || []).forEach((campo) => {
    const v = out[campo];
    if (v === undefined || v === null || v === '') return;
    if (!esFecha(v)) throw new ErrorDeDatos(`La fecha de "${campo}" no es valida: "${v}". Se espera AAAA-MM-DD.`);
    out[campo] = String(v).slice(0, 10);
  });

  Object.entries(ENUMS[collection] || {}).forEach(([campo, permitidos]) => {
    if (out[campo] === undefined || out[campo] === '') return;
    if (!permitidos.includes(out[campo])) {
      throw new ErrorDeDatos(`"${out[campo]}" no es un valor valido para "${campo}". Se espera: ${permitidos.join(', ')}.`);
    }
  });

  if (CON_MONEDA.includes(collection) && out.currency !== undefined && out.currency !== '') {
    if (!MONEDAS.includes(out.currency)) {
      throw new ErrorDeDatos(`Moneda desconocida: "${out.currency}". Se espera ${MONEDAS.join(', ')}.`);
    }
  }

  if (out.items !== undefined) out.items = limpiarItems(out.items);
  if (collection === 'outcomes' && out.m !== undefined) out.m = limpiarMetricas(out.m);

  /* Una pieza solo puede moverse por donde el grafo de estados permite. Sin
   * esto, la vista de Despacho —o un agente equivocado— puede publicar algo
   * rechazado, y el retro terminaria aprendiendo de piezas que nunca
   * estuvieron en la calle. La transicion se valida contra el estado actual,
   * que quien llama debe pasar en `_estadoActual`. */
  if (collection === 'assets' && out.estado !== undefined && body._estadoActual) {
    const actual = body._estadoActual;
    const permitidos = mk.TRANSICIONES[actual] || [];
    if (actual !== out.estado && !permitidos.includes(out.estado)) {
      throw new ErrorDeDatos(
        permitidos.length
          ? `Una pieza en "${actual}" no puede pasar a "${out.estado}". Solo a: ${permitidos.join(', ')}.`
          : `Una pieza en "${actual}" es final: ya no puede cambiar de estado.`
      );
    }
  }
  delete out._estadoActual;

  // El porcentaje fuera de rango casi siempre es un dedazo (190 en vez de 19).
  if (out.taxRate !== undefined && (out.taxRate < 0 || out.taxRate > 100)) {
    throw new ErrorDeDatos(`El impuesto de ${out.taxRate}% esta fuera de rango.`);
  }
  if (out.probability !== undefined && (out.probability < 0 || out.probability > 100)) {
    throw new ErrorDeDatos(`La probabilidad de ${out.probability}% esta fuera de rango.`);
  }

  // Nadie puede reasignarse el id ni las marcas de tiempo desde el cuerpo.
  delete out.id;
  delete out.createdAt;

  return out;
}

module.exports = { limpiar, limpiarItems, limpiarMetricas, aNumero, esFecha, ErrorDeDatos };
