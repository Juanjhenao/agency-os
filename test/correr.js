/* Corre las tres pruebas: levanta el servidor en un puerto aparte, las ejecuta
 * en orden y lo apaga. `npm test`.
 *
 * Las pruebas trabajan contra el vault real porque ese es el unico entorno que
 * existe — no hay base de datos de pruebas. Por eso todo lo que crean va
 * marcado con `ZZTEST` y se borra al final, y por eso cada escritura del
 * servidor deja respaldo en `Agency\.respaldos\`.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const PORT = process.env.TEST_PORT || 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

const PRUEBAS = [
  ['Acceso — quien entra y quien no', 'acceso.test.js'],
  ['Dinero — totales, impuestos y consecutivos', 'dinero.test.js'],
  ['Reloj — lo que corre solo cada dia', 'reloj.test.js'],
  ['Unidades — secuenciador, prospeccion y documentos', 'unidades.test.js'],
  ['Marketing — ledger, evidencia y veredictos', 'marketing.test.js'],
  ['Juego — XP derivado, meta del dia y racha', 'juego.test.js'],
  ['Calculadora — punto de equilibrio e impuestos', 'calculadora.test.js'],
  ['API — el ciclo completo contra el servidor', 'api.test.js'],
  ['Despacho — la frontera humana del Marketing OS', 'despacho.test.js'],
  ['Interfaz — todas las vistas se pintan', 'interfaz.test.js'],
];

async function esperarServidor(intentos) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/state`);
      if (res.ok) return true;
    } catch (err) {
      // Todavia no levanta.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

(async () => {
  console.log(`\nLevantando el servidor de pruebas en ${BASE}…`);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let salida = '';
  server.stdout.on('data', (d) => (salida += d));
  server.stderr.on('data', (d) => (salida += d));

  if (!(await esperarServidor(20))) {
    console.error('El servidor no levanto. Salida:\n', salida);
    server.kill();
    process.exit(1);
  }

  let fallos = 0;
  for (const [titulo, archivo] of PRUEBAS) {
    console.log(`\n── ${titulo} ${'─'.repeat(Math.max(0, 56 - titulo.length))}`);
    const r = spawnSync(process.execPath, [path.join(__dirname, archivo)], {
      stdio: 'inherit',
      env: { ...process.env, TEST_BASE: BASE },
    });
    if (r.status !== 0) fallos += 1;
  }

  server.kill();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(fallos ? `${fallos} archivo(s) de prueba con fallas` : 'Todo en verde.');
  process.exit(fallos ? 1 : 0);
})();
