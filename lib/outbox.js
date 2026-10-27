/* La bandeja de salida: donde el sistema deja de copiar y pegar y manda.
 *
 * Igual que la Cola de produccion, la bandeja vive como archivos markdown en el
 * vault y no dentro del JSON. Eso tiene una razon concreta: un mensaje que se va
 * a mandar a un cliente tiene que poder revisarse, corregirse y despacharse
 * aunque el servidor este apagado, y tiene que quedar como registro legible de
 * lo que se dijo y cuando.
 *
 * Tres formas de que un mensaje salga, en orden de automatismo:
 *
 *   1. SMTP — si hay credenciales configuradas, el servidor lo manda solo. Es
 *      el unico camino verdaderamente desatendido.
 *   2. Un agente — el skill `outbox-sender` lee los pendientes y los manda por
 *      la conexion de Gmail. Sirve cuando no quieres guardar una contrasena.
 *   3. Enlace de un clic — `wa.me` para WhatsApp y `mailto:` para correo, con
 *      el texto ya escrito. No es automatico, pero convierte tres minutos de
 *      copiar y pegar en un clic, y para WhatsApp no existe otra via legitima.
 *
 * La contrasena SMTP se lee de la variable de entorno `AGENCY_SMTP_PASS` y
 * nunca se guarda en el JSON: ese archivo vive en el vault, que se sincroniza.
 */

const fs = require('fs');
const path = require('path');
const { today, nowISO, nowLocal } = require('./dates');

let nodemailer = null;
try {
  // Opcional a proposito: sin la libreria, todo lo demas sigue funcionando.
  nodemailer = require('nodemailer');
} catch (err) {
  nodemailer = null;
}

const STATES = ['pendiente', 'enviado', 'error', 'cancelado'];

// ---------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------

function msgFile(dir, id) {
  return path.join(dir, `${id}.md`);
}

function esc(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\r?\n/g, ' ');
}

function writeMessage(dir, msg) {
  fs.mkdirSync(dir, { recursive: true });
  const fm = [
    '---',
    `id: ${esc(msg.id)}`,
    `estado: ${esc(msg.status)}`,
    `canal: ${esc(msg.channel)}`,
    `para: ${esc(msg.to)}`,
    `nombre: ${esc(msg.toName)}`,
    `asunto: ${esc(msg.subject)}`,
    `cliente: ${esc(msg.clientName)}`,
    `clientId: ${esc(msg.clientId)}`,
    `dealId: ${esc(msg.dealId)}`,
    `touchId: ${esc(msg.touchId)}`,
    `creado: ${esc(msg.createdAt)}`,
    `enviado: ${esc(msg.sentAt)}`,
    `error: ${esc(msg.error)}`,
    '---',
    '',
    msg.body || '',
    '',
  ].join('\n');
  fs.writeFileSync(msgFile(dir, msg.id), fm, 'utf8');
  return msg;
}

function parseMessage(raw, id) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  let body = raw;
  if (m) {
    m[1].split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i === -1) return;
      meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    body = m[2];
  }
  return {
    id: meta.id || id,
    status: meta.estado || 'pendiente',
    channel: meta.canal || 'email',
    to: meta.para || '',
    toName: meta.nombre || '',
    subject: meta.asunto || '',
    clientName: meta.cliente || '',
    clientId: meta.clientId || '',
    dealId: meta.dealId || '',
    touchId: meta.touchId || '',
    createdAt: meta.creado || '',
    sentAt: meta.enviado || '',
    error: meta.error || '',
    body: body.replace(/^\n+/, '').replace(/\n+$/, ''),
  };
}

function scan(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      try {
        return parseMessage(fs.readFileSync(path.join(dir, f), 'utf8'), f.replace(/\.md$/, ''));
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function read(dir, id) {
  const f = msgFile(dir, id);
  if (!fs.existsSync(f)) return null;
  return parseMessage(fs.readFileSync(f, 'utf8'), id);
}

function remove(dir, id) {
  const f = msgFile(dir, id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

function slug(text) {
  return String(text || 'mensaje')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'mensaje';
}

function queue(dir, data) {
  const id = `${today()}-${slug(data.clientName)}-${Math.random().toString(36).slice(2, 6)}`;
  const msg = {
    id,
    status: 'pendiente',
    channel: data.channel || 'email',
    to: data.to || '',
    toName: data.toName || '',
    subject: data.subject || '',
    clientName: data.clientName || '',
    clientId: data.clientId || '',
    dealId: data.dealId || '',
    touchId: data.touchId || '',
    createdAt: nowISO(),
    sentAt: '',
    error: '',
    body: data.body || '',
  };
  return writeMessage(dir, msg);
}

function markSent(dir, id, note) {
  const msg = read(dir, id);
  if (!msg) throw new Error('Mensaje no encontrado en la bandeja');
  msg.status = 'enviado';
  msg.sentAt = msg.sentAt || nowLocal();
  msg.error = note || '';
  return writeMessage(dir, msg);
}

function markError(dir, id, error) {
  const msg = read(dir, id);
  if (!msg) return null;
  msg.status = 'error';
  msg.error = String(error || '').slice(0, 300);
  return writeMessage(dir, msg);
}

// ---------------------------------------------------------------------------
// Enlaces de un clic
// ---------------------------------------------------------------------------

/* WhatsApp no tiene forma legitima de enviarse desde un script sin la API de
 * negocios. El enlace profundo es el sustituto honesto: abre el chat con el
 * mensaje ya escrito y solo queda darle enviar. */
function waLink(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text || '')}`;
}

function mailtoLink(to, subject, body) {
  if (!to) return '';
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

function smtpStatus(settings) {
  const mail = (settings && settings.mail) || {};
  const smtp = mail.smtp || {};
  if (!nodemailer) return { ready: false, reason: 'Falta la libreria nodemailer (npm install nodemailer).' };
  if (!smtp.host || !smtp.user) return { ready: false, reason: 'Falta configurar el servidor SMTP en Ajustes.' };
  if (!process.env.AGENCY_SMTP_PASS) {
    return { ready: false, reason: 'Falta la variable de entorno AGENCY_SMTP_PASS con la contrasena de aplicacion.' };
  }
  if (!mail.fromEmail) return { ready: false, reason: 'Falta el correo remitente en Ajustes.' };
  return { ready: true, reason: `Listo: ${smtp.user} via ${smtp.host}` };
}

function transport(settings) {
  const smtp = settings.mail.smtp;
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: Boolean(smtp.secure) || Number(smtp.port) === 465,
    auth: { user: smtp.user, pass: process.env.AGENCY_SMTP_PASS },
  });
}

/* Manda los correos pendientes. Los de WhatsApp no se tocan: no hay como, y
 * fingir que se mandaron seria peor que dejarlos visibles. */
async function sendPending(dir, settings, opts) {
  const o = opts || {};
  const status = smtpStatus(settings);
  if (!status.ready) return { ok: false, reason: status.reason, enviados: [], fallidos: [] };

  const pend = scan(dir).filter((m) => m.status === 'pendiente' && m.channel === 'email' && m.to);
  const lote = pend.slice(0, Number(o.limit || 25));
  if (!lote.length) return { ok: true, reason: 'No habia correos pendientes.', enviados: [], fallidos: [] };

  const tx = transport(settings);
  const mail = settings.mail;
  const from = mail.fromName ? `"${mail.fromName}" <${mail.fromEmail}>` : mail.fromEmail;
  const enviados = [];
  const fallidos = [];

  for (const msg of lote) {
    try {
      const text = mail.signature ? `${msg.body}\n\n${mail.signature}` : msg.body;
      await tx.sendMail({
        from,
        to: msg.to,
        subject: msg.subject || '(sin asunto)',
        text,
        replyTo: mail.replyTo || mail.fromEmail,
      });
      markSent(dir, msg.id, '');
      enviados.push({ id: msg.id, to: msg.to, cliente: msg.clientName, touchId: msg.touchId });
    } catch (err) {
      markError(dir, msg.id, err.message);
      fallidos.push({ id: msg.id, to: msg.to, error: err.message });
    }
  }

  tx.close();
  return { ok: true, reason: '', enviados, fallidos };
}

module.exports = {
  STATES,
  scan,
  read,
  queue,
  remove,
  markSent,
  markError,
  writeMessage,
  waLink,
  mailtoLink,
  smtpStatus,
  sendPending,
  hasNodemailer: () => Boolean(nodemailer),
};
