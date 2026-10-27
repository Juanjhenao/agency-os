/* La regla de acceso, probada por separado porque es la que protege el resto.
 *
 * El caso que importa no es el obvio (alguien en la red pidiendo la API), sino
 * el silencioso: cuando el sistema se publica con un tunel, `cloudflared` corre
 * en esta misma maquina, asi que todo el trafico de internet llega desde
 * 127.0.0.1. Si "loopback" bastara para entrar, publicar el formulario de
 * captacion abriria el CRM entero al mundo.
 */

const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

let fallas = 0;
function ok(label, cond, extra) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fallas += 1;
}

// Simula una peticion: direccion del socket + cabeceras.
function pedir(socketIp, headers) {
  const h = headers || {};
  return {
    socket: { remoteAddress: socketIp },
    get: (name) => h[String(name).toLowerCase()],
    path: '/api/state',
    query: {},
  };
}

// --- Quien es "local" -------------------------------------------------------
ok('el navegador de este computador entra', auth.isLocal(pedir('127.0.0.1')));
ok('IPv6 loopback tambien entra', auth.isLocal(pedir('::1')));
ok('loopback mapeado a IPv6 tambien entra', auth.isLocal(pedir('::ffff:127.0.0.1')));

ok('un equipo de la misma red NO es local', !auth.isLocal(pedir('192.168.1.44')));
ok('una IP publica NO es local', !auth.isLocal(pedir('203.0.113.9')));

// El ataque que motiva todo esto.
ok(
  'no se puede fingir ser local con X-Forwarded-For',
  !auth.isLocal(pedir('192.168.1.44', { 'x-forwarded-for': '127.0.0.1' }))
);
ok(
  'el trafico por tunel NO cuenta como local aunque el socket sea loopback',
  !auth.isLocal(pedir('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }))
);
ok(
  'tambien lo detecta por la cabecera de Cloudflare',
  !auth.isLocal(pedir('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' }))
);
ok(
  'tambien lo detecta por x-forwarded-proto',
  !auth.isLocal(pedir('127.0.0.1', { 'x-forwarded-proto': 'https' }))
);

// --- Que rutas son publicas -------------------------------------------------
ok('el formulario de captacion es publico', auth.isPublicPath('/aplicar'));
ok('los documentos compartidos son publicos', auth.isPublicPath('/d/abc123'));
ok('aceptar un documento es publico', auth.isPublicPath('/d/abc123/accept'));
ok('la API del formulario es publica', auth.isPublicPath('/api/public/apply'));

ok('el estado NO es publico', !auth.isPublicPath('/api/state'));
ok('los clientes NO son publicos', !auth.isPublicPath('/api/clients'));
ok('la aplicacion NO es publica', !auth.isPublicPath('/index.html'));
ok('la raiz NO es publica', !auth.isPublicPath('/'));

// --- El guardia -------------------------------------------------------------
function correrGuardia(req, key) {
  const g = auth.guard(() => key);
  let paso = false;
  let estado = 0;
  const res = {
    status(c) {
      estado = c;
      return res;
    },
    json() {
      return res;
    },
    type() {
      return res;
    },
    send() {
      return res;
    },
    set() {
      return res;
    },
  };
  g(req, res, () => {
    paso = true;
  });
  return { paso, estado };
}

const LLAVE = 'llave-de-prueba';

ok('deja pasar al navegador local sin llave', correrGuardia(pedir('127.0.0.1'), LLAVE).paso);

const deFuera = pedir('192.168.1.44');
ok('bloquea a un equipo de la red sin llave', correrGuardia(deFuera, LLAVE).estado === 401);

const conLlave = pedir('192.168.1.44', { 'x-agency-key': LLAVE });
ok('deja pasar de fuera con la llave correcta', correrGuardia(conLlave, LLAVE).paso);

const llaveMala = pedir('192.168.1.44', { 'x-agency-key': 'otra-cosa' });
ok('bloquea con llave equivocada', correrGuardia(llaveMala, LLAVE).estado === 401);

// Llave de otra longitud: la comparacion en tiempo constante no puede reventar.
const llaveCorta = pedir('192.168.1.44', { 'x-agency-key': 'x' });
ok('no revienta con una llave de otro largo', correrGuardia(llaveCorta, LLAVE).estado === 401);

const tunel = pedir('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' });
ok('bloquea al visitante del tunel que pide la API', correrGuardia(tunel, LLAVE).estado === 401);

const tunelPublico = { ...pedir('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }), path: '/d/abc123' };
ok('pero SI le deja abrir su documento', correrGuardia(tunelPublico, LLAVE).paso);

// --- El limite de peticiones ------------------------------------------------
const limitar = auth.rateLimiter({ windowMs: 60000, max: 3 });
function golpear(ip) {
  let bloqueado = false;
  const res = {
    status() {
      bloqueado = true;
      return res;
    },
    json() {
      return res;
    },
    set() {
      return res;
    },
  };
  limitar({ ip, socket: { remoteAddress: ip }, get: () => undefined }, res, () => {});
  return bloqueado;
}

ok('deja pasar las primeras', !golpear('203.0.113.1') && !golpear('203.0.113.1') && !golpear('203.0.113.1'));
ok('bloquea al pasarse del limite', golpear('203.0.113.1'));
ok('el limite es por IP, no global', !golpear('203.0.113.2'));

console.log(`\n${fallas ? `${fallas} FALLA(S)` : 'Todo en verde'}`);
process.exit(fallas ? 1 : 0);
