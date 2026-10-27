/* Aritmetica de dinero, en un solo lugar.
 *
 * Estos calculos aparecen en propuestas, facturas, suscripciones, reportes,
 * finanzas y ahora tambien en las paginas publicas de aceptacion y pago. Tenerlos
 * duplicados es la forma mas facil de que el total que ve el cliente no sea el
 * que ve el sistema. Todo lo que cuente plata pasa por aqui.
 */

function lineTotal(item) {
  return Number(item.qty || 0) * Number(item.unitPrice || 0);
}

function computeTotals(doc) {
  const subtotal = (doc.items || []).reduce((sum, it) => sum + lineTotal(it), 0);
  const discount = Number(doc.discount || 0);
  const base = Math.max(subtotal - discount, 0);
  const tax = base * (Number(doc.taxRate || 0) / 100);
  const withholding = Number(doc.withholding || 0);
  const total = base + tax - withholding;
  return { subtotal, discount, base, tax, withholding, total };
}

function money(amount, currency) {
  const cur = currency || 'COP';
  const decimals = cur === 'COP' ? 0 : 2;
  return `${Number(amount || 0).toLocaleString('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${cur}`;
}

// Consolida cualquier moneda a pesos para poder sumar peras con manzanas.
function toCop(amount, currency, fx) {
  const f = fx || {};
  const n = Number(amount || 0);
  if (currency === 'USD') return n * Number(f.usdToCop || 4000);
  if (currency === 'MXN') return (n / Number(f.usdToMxn || 18)) * Number(f.usdToCop || 4000);
  return n;
}

module.exports = { lineTotal, computeTotals, money, toCop };
