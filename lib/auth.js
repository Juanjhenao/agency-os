/* Llave del servidor y limite de peticiones.
 *
 * Agency OS escucha en todas las interfaces de red. Sin esto, cualquiera en el
 * mismo wifi entra a :4180 y lee y modifica el negocio entero. Y como ahora hay
 * rutas que tienen que ser publicas de verdad (el formulario de captacion y la
 * pagina de aceptacion de documentos), separar lo publico de lo privado dejo de
 * ser opcional.
 *
 * La regla es simple:
 *   - Desde el propio computador (loopback) se entra sin llave: eres tu.
 *   - Desde cualquier otra direccion hace falta la llave, en la cabecera
 *     `x-agency-key` o en `?k=`.
 *   - Las rutas publicas (`/aplicar`, `/d/...`, `/api/public/...`) nunca piden
 *     llave, pero pasan por el limite de peticiones.
 */

const crypto = require('crypto');

const PUBLIC_PREFIXES = ['/api/public/', '/d/', '/aplicar'];

// Cabeceras que solo aparecen cuando la peticion paso por un proxy o un tunel.
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip', 'forwarded'];

function newKey() {
  return crypto.randomBytes(24).toString('base64url');
}

/* "Viene de este computador" no se puede decidir mirando `req.ip`: con
 * `trust proxy` esa propiedad sale de una cabecera que cualquiera puede
 * escribir. Y tampoco basta con mirar el socket: cuando el sistema se publica
 * con un tunel, `cloudflared` corre en esta misma maquina y se conecta desde
 * 127.0.0.1, asi que TODO el trafico de internet llegaria disfrazado de local.
 *
 * Hacen falta las dos condiciones a la vez:
 *   - el socket es realmente loopback (eso no se puede falsificar), y
 *   - la peticion no trae rastro de haber pasado por un proxy.
 *
 * Un atacante en la misma red falla la primera. Un visitante por el tunel falla
 * la segunda. Tu navegador, abierto aqui mismo, cumple las dos. */
function isLocal(req) {
  const socketIp = (req.socket && req.socket.remoteAddress) || '';
  const loopback = socketIp === '::1' || socketIp === '127.0.0.1' || socketIp === '::ffff:127.0.0.1';
  if (!loopback) return false;
  return !PROXY_HEADERS.some((h) => req.get(h));
}

function isPublicPath(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

// Comparacion en tiempo constante: no filtra la llave a punta de medir latencia.
function sameKey(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* Contador por IP en memoria. No es una defensa contra un ataque serio: es lo
 * que impide que un bot llene el CRM de basura por el formulario publico. */
function rateLimiter({ windowMs = 60000, max = 30 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'desconocida';
    const entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count += 1;
      if (entry.count > max) {
        res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        return res.status(429).json({ error: 'Demasiadas peticiones. Intenta en un minuto.' });
      }
    }
    // Limpieza perezosa para que el mapa no crezca sin control.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    return next();
  };
}

function guard(getKey) {
  return (req, res, next) => {
    if (isPublicPath(req.path)) return next();
    if (isLocal(req)) return next();

    const key = getKey();
    if (!key) return next(); // Sin llave configurada no se bloquea nada.

    const given = req.get('x-agency-key') || req.query.k || '';
    if (sameKey(given, key)) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Falta la llave de acceso.' });
    }
    return res
      .status(401)
      .type('html')
      .send('<h1>Agency OS</h1><p>Este servidor esta protegido. Abrelo desde el computador donde corre, o agrega <code>?k=TU_LLAVE</code>.</p>');
  };
}

module.exports = { newKey, guard, rateLimiter, isLocal, isPublicPath };
