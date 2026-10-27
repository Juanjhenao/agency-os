/* La aritmetica de la calculadora.
 *
 * El archivo vive en el navegador y depende de App y de toCop, asi que se
 * carga en un contexto con esos dos globales fingidos. Vale la pena el
 * andamiaje: la formula del punto de equilibrio es la unica parte del sistema
 * donde un error no se ve —da un numero plausible— y donde equivocarse por
 * debajo hace creer que un negocio aguanta cuando no.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallas = 0;
function ok(label, cond, extra) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${label}${extra !== undefined ? ` — ${extra}` : ''}`);
  if (!cond) fallas += 1;
}

// --- Contexto minimo -------------------------------------------------------

const ctx = {
  App: { state: { settings: {}, expenses: [] }, views: {}, actions: {}, ctx: {} },
  // Todo en COP para que la prueba mida la formula y no la conversion.
  toCop: (monto, moneda) => (moneda === 'USD' ? Number(monto) * 4000 : Number(monto)),
  fmtShort: (n) => String(Math.round(n)),
  esc: (s) => String(s),
  kpi: () => '',
  section: () => '',
  btn: () => '',
  toast: () => {},
  render: () => {},
  confirmAction: () => {},
  mrrCop: () => 0,
  api: { settings: () => Promise.resolve({}) },
  document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
  setTimeout: () => 0,
  clearTimeout: () => {},
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'views-calculadora.js'), 'utf8'), ctx);

function conf(c) {
  ctx.App.state.settings.calculadora = {
    moneda: 'COP',
    impuestoPct: 0,
    ticketPromedio: 0,
    personalVisible: false,
    ingresos: [],
    gastosEmpresa: [],
    gastosPersonales: [],
    ...c,
  };
  return ctx.calcResultado();
}

const l = (monto, frecuencia, moneda) => ({ id: `x${Math.random()}`, concepto: 'x', monto, frecuencia: frecuencia || 'mes', moneda: moneda || 'COP' });

// --- 1. Normalizacion a mensual -------------------------------------------

ok('lo anual se divide entre 12', conf({ gastosEmpresa: [l(1200, 'anio')] }).gastoEmpresa === 100);
ok('lo mensual entra tal cual', conf({ gastosEmpresa: [l(500, 'mes')] }).gastoEmpresa === 500);

/* Lo de una sola vez NO entra en el corrido del mes: meterlo inflaria el gasto
 * recurrente y subiria el punto de equilibrio de forma permanente por una
 * compra que no se repite. Se reporta aparte. */
const unico = conf({ gastosEmpresa: [l(3000, 'unico'), l(500, 'mes')] });
ok('lo de una sola vez no entra en el mes', unico.gastoEmpresa === 500, `${unico.gastoEmpresa}`);
ok('pero se reporta aparte', unico.unicos === -3000, `${unico.unicos}`);

ok('convierte de moneda antes de sumar', conf({ ingresos: [l(1, 'mes', 'USD')] }).ingreso === 4000);

// --- 2. Utilidad e impuestos ----------------------------------------------

const base = conf({ ingresos: [l(10000)], gastosEmpresa: [l(4000)] });
ok('utilidad = ingresos - gastos', base.utilidadBruta === 6000);
ok('sin impuesto, la neta es la bruta', base.utilidadNeta === 6000);
ok('el margen se mide sobre el ingreso', Math.abs(base.margen - 0.6) < 1e-9, base.margen);

/* El impuesto va sobre la utilidad, no sobre lo facturado. Cobrarlo sobre lo
 * bruto —el error comun— daria 10000*0.3 = 3000 y dejaria 3000 en vez de 4200. */
const conImp = conf({ ingresos: [l(10000)], gastosEmpresa: [l(4000)], impuestoPct: 30 });
ok('el impuesto se aplica sobre la utilidad, no sobre la facturacion', conImp.impuesto === 1800, `${conImp.impuesto}`);
ok('la utilidad neta descuenta el impuesto', conImp.utilidadNeta === 4200, `${conImp.utilidadNeta}`);

// En perdida no se pagan impuestos: cobrarlos hundiria mas una cuenta ya roja.
const perdida = conf({ ingresos: [l(1000)], gastosEmpresa: [l(4000)], impuestoPct: 30 });
ok('en perdida no hay impuesto', perdida.impuesto === 0 && perdida.utilidadNeta === -3000, `${perdida.utilidadNeta}`);

// --- 3. El punto de equilibrio --------------------------------------------

// Sin gastos personales, basta con cubrir los de la empresa.
ok('equilibrio de empresa = sus gastos', conf({ gastosEmpresa: [l(4000)] }).equilibrioEmpresa === 4000);

/* Con gastos personales: F = G + P/(1-t).
 * G=4000, P=3500, t=0.30 → 4000 + 3500/0.7 = 4000 + 5000 = 9000. */
const total = conf({
  gastosEmpresa: [l(4000)],
  gastosPersonales: [l(3500)],
  personalVisible: true,
  impuestoPct: 30,
});
ok('equilibrio total aplica la formula F = G + P/(1-t)', total.equilibrioTotal === 9000, `${total.equilibrioTotal}`);

/* La comprobacion que importa: facturando exactamente el equilibrio, lo que
 * sobra tiene que dar cero. Si diera positivo o negativo, la formula estaria
 * mal y el numero que se muestra seria mentira. */
const enPunto = conf({
  ingresos: [l(9000)],
  gastosEmpresa: [l(4000)],
  gastosPersonales: [l(3500)],
  personalVisible: true,
  impuestoPct: 30,
});
ok('facturando el equilibrio exacto, no sobra ni falta', Math.abs(enPunto.sobra) < 1e-9, `${enPunto.sobra}`);
ok('y no falta facturar nada', enPunto.faltaFacturar === 0);

// Sin impuestos el equilibrio es la suma simple.
const sinImp = conf({ gastosEmpresa: [l(4000)], gastosPersonales: [l(3500)], personalVisible: true });
ok('sin impuestos, el equilibrio es la suma', sinImp.equilibrioTotal === 7500, `${sinImp.equilibrioTotal}`);

// Los gastos personales solo cuentan si el bloque esta abierto.
const oculto = conf({ gastosEmpresa: [l(4000)], gastosPersonales: [l(3500)], personalVisible: false });
ok('con el bloque cerrado, lo personal no altera la cuenta', oculto.gastoPersonal === 0 && oculto.equilibrioTotal === 4000);

// --- 4. Traducir la brecha a clientes -------------------------------------

const brecha = conf({
  ingresos: [l(5000)],
  gastosEmpresa: [l(4000)],
  gastosPersonales: [l(3500)],
  personalVisible: true,
  ticketPromedio: 1000,
});
ok('calcula cuanto falta facturar', brecha.faltaFacturar === 2500, `${brecha.faltaFacturar}`);
ok('y lo traduce a clientes, redondeando hacia arriba', brecha.clientesFaltantes === 3, `${brecha.clientesFaltantes}`);

/* Medio cliente no existe: 2.5 tiene que subir a 3. Redondear hacia abajo
 * dejaria la meta corta justo por el margen que falta. */
ok('sin ticket promedio no inventa el numero de clientes', conf({ ticketPromedio: 0 }).clientesFaltantes === null);

// --- 5. Bordes -------------------------------------------------------------

ok('todo vacio no revienta ni divide por cero', conf({}).margen === 0 && conf({}).utilidadNeta === 0);
const extremo = conf({ gastosEmpresa: [l(100)], gastosPersonales: [l(100)], personalVisible: true, impuestoPct: 200 });
ok('un impuesto absurdo se topa y no da infinito', Number.isFinite(extremo.equilibrioTotal), `${extremo.equilibrioTotal}`);

console.log(`\n${fallas ? `${fallas} FALLA(S)` : 'Todo en verde'}`);
process.exit(fallas ? 1 : 0);
