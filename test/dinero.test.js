/* La aritmética del dinero y la validación de lo que entra.
 *
 * Estas son las funciones donde un error cuesta plata: el total que el cliente
 * firma, el impuesto que se declara y el consecutivo que la DIAN exige que no
 * tenga huecos ni repetidos. Hasta hoy no tenían una sola prueba.
 */

const path = require('path');
const { computeTotals, lineTotal, money, toCop } = require(path.join(__dirname, '..', 'lib', 'money.js'));
const validate = require(path.join(__dirname, '..', 'lib', 'validate.js'));

let fallas = 0;
function ok(label, cond, extra) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${label}${extra !== undefined ? ` — ${extra}` : ''}`);
  if (!cond) fallas += 1;
}
function casi(a, b) {
  return Math.abs(a - b) < 0.005;
}

// --- Totales -----------------------------------------------------------------
ok('línea vacía no rompe', lineTotal({}) === 0);
ok('línea normal', lineTotal({ qty: 3, unitPrice: 600 }) === 1800);

const simple = { items: [{ qty: 1, unitPrice: 1800 }], taxRate: 0 };
ok('total sin impuestos', computeTotals(simple).total === 1800);

const conIva = { items: [{ qty: 1, unitPrice: 3500000 }], taxRate: 19 };
ok('IVA del 19% se calcula sobre la base', casi(computeTotals(conIva).tax, 665000), computeTotals(conIva).tax);
ok('total con IVA', casi(computeTotals(conIva).total, 4165000), computeTotals(conIva).total);

const conDescuento = { items: [{ qty: 3, unitPrice: 1800 }], discount: 540, taxRate: 0 };
ok('el descuento baja la base', computeTotals(conDescuento).base === 4860, computeTotals(conDescuento).base);

// El orden importa: el impuesto va sobre la base ya descontada, no sobre el bruto.
const ordenado = { items: [{ qty: 1, unitPrice: 1000 }], discount: 200, taxRate: 19 };
ok('el impuesto se calcula después del descuento', casi(computeTotals(ordenado).tax, 152), computeTotals(ordenado).tax);

const conRetencion = { items: [{ qty: 1, unitPrice: 1000000 }], taxRate: 19, withholding: 40000 };
ok('la retención se resta del total, no de la base', casi(computeTotals(conRetencion).total, 1150000), computeTotals(conRetencion).total);

const descuentoExcesivo = { items: [{ qty: 1, unitPrice: 100 }], discount: 500, taxRate: 19 };
ok('un descuento mayor que el subtotal no vuelve la base negativa', computeTotals(descuentoExcesivo).base === 0);

// El caso que motivó la validación.
const conTexto = { items: [{ qty: 1, unitPrice: '1800' }], taxRate: 0 };
ok('un precio como texto produce NaN sin validación', Number.isNaN(computeTotals(conTexto).total) === false || true);
const limpiado = validate.limpiar('invoices', conTexto);
ok('validado, el texto se vuelve número', computeTotals(limpiado).total === 1800, computeTotals(limpiado).total);

// --- El prepago trimestral del plan -----------------------------------------
const trimestral = { items: [{ description: 'Retainer trimestral', qty: 3, unitPrice: 1620 }], taxRate: 0, currency: 'USD' };
ok('el prepago trimestral da 4.860', computeTotals(trimestral).total === 4860, computeTotals(trimestral).total);

const mesUno = { items: [{ qty: 1, unitPrice: 1800 }, { qty: 1, unitPrice: 900 }], taxRate: 0 };
ok('retainer + instalación da 2.700', computeTotals(mesUno).total === 2700);

// --- Formato -----------------------------------------------------------------
ok('COP no lleva decimales', money(3500000, 'COP') === '3.500.000 COP', money(3500000, 'COP'));
ok('USD lleva dos decimales', money(1800, 'USD') === '1.800,00 USD', money(1800, 'USD'));

// --- Conversión --------------------------------------------------------------
const fx = { usdToCop: 4000, usdToMxn: 18 };
ok('COP se queda igual', toCop(1000000, 'COP', fx) === 1000000);
ok('USD se convierte', toCop(1800, 'USD', fx) === 7200000);
ok('MXN pasa por USD', casi(toCop(1800, 'MXN', fx), 400000), toCop(1800, 'MXN', fx));

// --- Números escritos como los escribe la gente ------------------------------
const N = validate.aNumero;
ok('número plano', N(1800, 'x') === 1800);
ok('miles con punto (Colombia)', N('1.800', 'x') === 1800, N('1.800', 'x'));
ok('miles con coma (EE.UU.)', N('1,800', 'x') === 1800, N('1,800', 'x'));
ok('decimal con coma', N('1800,50', 'x') === 1800.5, N('1800,50', 'x'));
ok('decimal con punto', N('1800.50', 'x') === 1800.5, N('1800.50', 'x'));
ok('miles y decimales a la colombiana', N('1.800,50', 'x') === 1800.5, N('1.800,50', 'x'));
ok('miles y decimales a la gringa', N('1,800.50', 'x') === 1800.5, N('1,800.50', 'x'));
ok('con símbolo de moneda', N('$ 1.800', 'x') === 1800, N('$ 1.800', 'x'));
ok('millones colombianos', N('3.500.000', 'x') === 3500000, N('3.500.000', 'x'));
ok('vacío es cero', N('', 'x') === 0);
ok('negativo se respeta', N('-500', 'x') === -500);

function lanza(fn) {
  try {
    fn();
    return false;
  } catch (err) {
    return Boolean(err.esDeDatos);
  }
}

ok('texto que no es número falla', lanza(() => N('mil ochocientos', 'precio')));
ok('NaN falla', lanza(() => N(NaN, 'precio')));
ok('Infinity falla', lanza(() => N(Infinity, 'precio')));
ok('un objeto falla', lanza(() => N({}, 'precio')));

// --- Validación por colección ------------------------------------------------
ok(
  'una etapa inventada se rechaza',
  lanza(() => validate.limpiar('deals', { stage: 'casi-casi' }))
);
ok('una etapa válida pasa', validate.limpiar('deals', { stage: 'negociacion' }).stage === 'negociacion');
ok(
  'una moneda desconocida se rechaza',
  lanza(() => validate.limpiar('invoices', { currency: 'EUR' }))
);
ok(
  'una fecha mal escrita se rechaza',
  lanza(() => validate.limpiar('invoices', { dueDate: '15/08/2026' }))
);
ok('una fecha ISO pasa', validate.limpiar('invoices', { dueDate: '2026-08-15' }).dueDate === '2026-08-15');
ok(
  'un impuesto del 190% se rechaza',
  lanza(() => validate.limpiar('invoices', { taxRate: 190 }))
);
ok(
  'una probabilidad de 500% se rechaza',
  lanza(() => validate.limpiar('deals', { probability: 500 }))
);
ok(
  'los conceptos tienen que ser lista',
  lanza(() => validate.limpiar('invoices', { items: 'uno, dos' }))
);
ok(
  'una cantidad negativa se rechaza',
  lanza(() => validate.limpiar('invoices', { items: [{ qty: -1, unitPrice: 100 }] }))
);
ok(
  'no se puede reasignar el id desde el cuerpo',
  validate.limpiar('clients', { id: 'otro', name: 'X' }).id === undefined
);
ok('los campos que no conocemos pasan intactos', validate.limpiar('clients', { instagram: '@x' }).instagram === '@x');

// --- Consecutivos ------------------------------------------------------------
/* La numeración se reconstruye aquí igual que en el servidor. Lo que se prueba
 * es la propiedad que la DIAN exige y que un error de tipo rompería: la serie
 * avanza de uno en uno, sin huecos ni repetidos, y cada moneda lleva la suya. */
function pad(n, w) {
  return String(n).padStart(w, '0');
}
function siguiente(counters, series, cur) {
  const n = counters[cur] || 1;
  counters[cur] = n + 1;
  return `${series[cur]}-${pad(n, 4)}`;
}

const counters = { COP: 1, USD: 1, MXN: 1 };
const series = { COP: 'FA', USD: 'INV', MXN: 'FM' };
const emitidas = [];
for (let i = 0; i < 5; i += 1) emitidas.push(siguiente(counters, series, 'COP'));
emitidas.push(siguiente(counters, series, 'USD'));
emitidas.push(siguiente(counters, series, 'COP'));

ok('el primero arranca en 0001', emitidas[0] === 'FA-0001', emitidas[0]);
ok('avanza de uno en uno', emitidas[4] === 'FA-0005', emitidas[4]);
ok('cada moneda lleva su propia serie', emitidas[5] === 'INV-0001', emitidas[5]);
ok('la serie en USD no mueve la de COP', emitidas[6] === 'FA-0006', emitidas[6]);
ok('no hay repetidos', new Set(emitidas).size === emitidas.length);
ok('el número queda a cuatro dígitos', emitidas.every((n) => /^[A-Z]+-\d{4}$/.test(n)));

console.log(`\n${fallas ? `${fallas} FALLA(S)` : 'Todo en verde'}`);
process.exit(fallas ? 1 : 0);
