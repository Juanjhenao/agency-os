/* Fechas en hora local, no en UTC.
 *
 * `new Date().toISOString().slice(0,10)` devuelve la fecha en UTC. En Colombia
 * (UTC-5) eso significa que a partir de las 7 de la noche todo lo que se emite
 * sale fechado al dia siguiente: facturas, vencimientos, ids de la cola. Es un
 * error silencioso sobre documentos que son fiscales, asi que todas las fechas
 * del sistema pasan por aqui.
 *
 * `sv` (sueco) es el unico locale cuyo formato corto de fecha es ISO puro
 * (AAAA-MM-DD), asi que sirve para leer la fecha local sin armarla a mano.
 */

function today() {
  return new Date().toLocaleDateString('sv');
}

function nowISO() {
  return new Date().toISOString();
}

// Marca de tiempo legible en hora local, para bitacoras que lee una persona.
function nowLocal() {
  const d = new Date();
  return `${d.toLocaleDateString('sv')} ${d.toLocaleTimeString('sv').slice(0, 5)}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('sv');
}

function addMonths(dateStr, months) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months || 0));
  // Si el mes destino no tiene ese dia (31 -> febrero), cae al ultimo del mes.
  if (d.getDate() !== day) d.setDate(0);
  return d.toLocaleDateString('sv');
}

// Dias desde hoy hasta la fecha. Negativo = ya paso.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const a = new Date(`${today()}T00:00:00`);
  const b = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

module.exports = { today, nowISO, nowLocal, addDays, addMonths, daysUntil };
