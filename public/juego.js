/* La capa que hace que trabajar aquí se sienta.
 *
 * Agency OS no tenía una sola respuesta al esfuerzo: grabar la auditoría
 * número 1 de 100 no producía nada — ni un sonido, ni una barra que avanzara,
 * ni un contador. El trabajo no tenía eco, y un trabajo sin eco se abandona.
 *
 * Todo lo de este archivo es respuesta al acto, no decoración: suena cuando
 * pasa algo, celebra cuando el hito es real y se calla cuando no. Un sistema
 * que celebra todo enseña a ignorar la celebración en una semana.
 *
 * El motor de audio y el confeti vienen del habit-tracker, donde ya llevan
 * meses probados contra el uso de una persona de verdad. Se portan en vez de
 * reinventarse: la escala pentatónica, los volúmenes y las curvas de gain ya
 * están afinados y sonar distinto aquí sería empezar de cero sin razón.
 */

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sonidoActivo() {
  const cfg = App.state && App.state.settings && App.state.settings.juego;
  return !cfg || cfg.sonido !== false;
}

// Un único AudioContext: los navegadores limitan cuántos se pueden abrir.
let audioCtx = null;
function actx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tocar(notas, { tipo = 'sine', volumen = 0.18, duracion = 0.25, paso = 0.09 } = {}) {
  if (!sonidoActivo()) return;
  let ac;
  try {
    ac = actx();
  } catch (err) {
    return; // Sin audio disponible la aplicación sigue funcionando igual.
  }
  const now = ac.currentTime;
  notas.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = tipo;
    osc.frequency.value = freq;
    const inicio = now + i * paso;
    gain.gain.setValueAtTime(0, inicio);
    gain.gain.linearRampToValueAtTime(volumen, inicio + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, inicio + duracion);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(inicio);
    osc.stop(inicio + duracion);
  });
}

/* Escala pentatónica: cada tipo de logro suena en su propio grado, así una
 * jornada de trabajo forma una melodía en vez de un pitido repetido. Los
 * eventos que valen más plata suenan más arriba, sin que nadie lo explique. */
const PENTATONICA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];

const SONIDO_EVENTO = {
  auditoria: () => tocar([PENTATONICA[0], PENTATONICA[2]], { duracion: 0.22, paso: 0.07, volumen: 0.16 }),
  mensaje: () => tocar([PENTATONICA[1]], { duracion: 0.14, paso: 0, volumen: 0.11 }),
  piezaAprobada: () => tocar([PENTATONICA[2], PENTATONICA[4]], { duracion: 0.2, paso: 0.06, volumen: 0.14 }),
  piezaPublicada: () => tocar([PENTATONICA[3], PENTATONICA[5]], { duracion: 0.22, paso: 0.06, volumen: 0.15 }),
  respuesta: () => tocar([659.25, 783.99, 987.77], { tipo: 'triangle', duracion: 0.26, paso: 0.08, volumen: 0.18 }),
  reunionAgendada: () => tocar([523.25, 659.25, 783.99, 1046.5], { tipo: 'triangle', duracion: 0.3, paso: 0.09, volumen: 0.19 }),
  reunionRealizada: () => tocar([587.33, 739.99, 880, 1174.66], { tipo: 'triangle', duracion: 0.3, paso: 0.09, volumen: 0.19 }),
  propuestaEnviada: () => tocar([659.25, 830.61, 1046.5], { duracion: 0.2, paso: 0.055, volumen: 0.14 }),
  propuestaAceptada: () => tocar([523.25, 659.25, 783.99, 1046.5, 1318.51], { tipo: 'triangle', duracion: 0.34, paso: 0.11, volumen: 0.2 }),
  clienteGanado: () => tocar([392, 523.25, 659.25, 783.99, 1046.5, 1318.51], { tipo: 'triangle', duracion: 0.5, paso: 0.1, volumen: 0.24 }),
  facturaPagada: () => tocar([440, 554.37, 659.25, 880], { tipo: 'triangle', duracion: 0.34, paso: 0.09, volumen: 0.2 }),
};

const sonidoMeta = () => tocar([523.25, 659.25, 783.99, 1046.5, 1318.51], { tipo: 'triangle', volumen: 0.2, duracion: 0.34, paso: 0.11 });
const sonidoNivel = () => tocar([392, 523.25, 659.25, 783.99, 1046.5], { tipo: 'triangle', volumen: 0.22, duracion: 0.45, paso: 0.1 });
const sonidoLogro = () => tocar([659.25, 783.99, 987.77, 1318.51], { tipo: 'square', volumen: 0.09, duracion: 0.22 });

// Sonidos de interfaz. Van mucho más bajo que los de logro: son acuse de
// recibo, no celebración, y suenan decenas de veces por sesión.
const sonidoTic = () => tocar([880], { volumen: 0.05, duracion: 0.06, paso: 0 });
const sonidoAbrir = () => tocar([523.25, 659.25, 880], { tipo: 'triangle', volumen: 0.08, duracion: 0.15, paso: 0.045 });
const sonidoCerrar = () => tocar([659.25, 440], { volumen: 0.07, duracion: 0.13, paso: 0.05 });
const sonidoGuardar = () => tocar([659.25, 830.61, 1046.5], { volumen: 0.1, duracion: 0.2, paso: 0.055 });
const sonidoBorrar = () => tocar([233.08, 174.61], { tipo: 'sawtooth', volumen: 0.05, duracion: 0.17, paso: 0.06 });
const sonidoErrorUI = () => tocar([311.13, 233.08], { tipo: 'square', volumen: 0.06, duracion: 0.19, paso: 0.07 });

/* Qué suena al pulsar cada control. Lo específico va primero: gana el primer
 * selector que coincide. Un único oyente para toda la aplicación, porque las
 * vistas se repintan enteras y colgar el sonido en cada botón obligaría a
 * volver a atarlo en cada render. */
function sonidoDelControl(el) {
  if (el.closest('[data-act="mk-rechazar"], [data-act="modal-danger"], .btn-danger-ghost')) return sonidoBorrar();
  if (el.closest('[data-act="modal-submit"]')) return sonidoGuardar();
  if (el.closest('[data-act="modal-close"]')) return sonidoCerrar();
  if (el.closest('.nav-item')) return sonidoAbrir();
  if (el.closest('.btn-primary')) return sonidoAbrir();
  return sonidoTic();
}

let ultimoSonidoUI = 0;
document.addEventListener(
  'click',
  (e) => {
    const control = e.target.closest('button, .nav-item');
    if (!control || control.disabled) return;
    // Algunos clics disparan otro clic; sin esta ventana sonarían pisándose.
    const ahora = performance.now();
    if (ahora - ultimoSonidoUI < 90) return;
    ultimoSonidoUI = ahora;
    sonidoDelControl(control);
  },
  true
);

// ---------------------------------------------------------------------------
// Celebración visual
// ---------------------------------------------------------------------------

function confeti(x, y, { grande = false, color = null } = {}) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const c = canvas.getContext('2d');
  const colores = color ? [color, '#ffffff', '#fbbf24'] : ['#7c8cff', '#34d399', '#fbbf24', '#f472b6', '#60a5fa'];
  const suave = reducedMotion();
  const cantidad = suave ? (grande ? 16 : 8) : (grande ? 140 : 42);
  const fuerza = grande ? 13 : 8;

  const particulas = Array.from({ length: cantidad }, () => ({
    x,
    y,
    vx: (Math.random() - 0.5) * fuerza,
    vy: Math.random() * -fuerza - 2,
    size: Math.random() * 6 + 3,
    color: colores[Math.floor(Math.random() * colores.length)],
    rot: Math.random() * 360,
    vr: (Math.random() - 0.5) * 12,
    vida: 64,
  }));

  function frame() {
    c.clearRect(0, 0, canvas.width, canvas.height);
    let vivas = false;
    for (const p of particulas) {
      if (p.vida <= 0) continue;
      vivas = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.32;
      p.vx *= 0.99;
      p.rot += p.vr;
      p.vida -= 1;
      c.save();
      c.translate(p.x, p.y);
      c.rotate((p.rot * Math.PI) / 180);
      c.fillStyle = p.color;
      c.globalAlpha = Math.max(p.vida / 64, 0);
      c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      c.restore();
    }
    if (vivas) requestAnimationFrame(frame);
    else c.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

// El número que sube desde donde ocurrió: el punto se siente ganado en el
// sitio donde se hizo el trabajo, no en una esquina de la pantalla.
function popupXP(x, y, texto, bonus) {
  const el = document.createElement('div');
  el.className = `xp-popup${bonus ? ' bonus' : ''}`;
  el.textContent = texto;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/* El cartel de hito. Solo para lo que de verdad cambia el negocio: subir de
 * nivel, cerrar la meta del día, conseguir un logro. */
function cartel(titulo, sub, icono) {
  const el = document.createElement('div');
  el.className = 'hito-cartel';
  el.innerHTML = `
    <span class="hito-icono">${icono || '★'}</span>
    <div><strong>${esc(titulo)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 400);
  }, 3200);
}

// ---------------------------------------------------------------------------
// La cabecera: lo que hiciste, antes de lo que debes
// ---------------------------------------------------------------------------

// Anillo de progreso. Un número suelto no da la sensación de "casi"; el arco
// incompleto sí, y esa sensación es la que hace terminar el día.
function anillo(pct, texto, sub) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const avance = Math.max(0, Math.min(100, pct)) / 100;
  return `<div class="anillo">
    <svg viewBox="0 0 80 80" aria-hidden="true">
      <circle class="anillo-base" cx="40" cy="40" r="${r}"></circle>
      <circle class="anillo-arco" cx="40" cy="40" r="${r}"
        stroke-dasharray="${circ.toFixed(1)}"
        stroke-dashoffset="${(circ * (1 - avance)).toFixed(1)}"></circle>
    </svg>
    <div class="anillo-centro"><strong>${esc(texto)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
  </div>`;
}

function juegoHeader() {
  const j = App.state.juego;
  if (!j) return '';

  const hoy = j.hoy;
  const partes = hoy.partes
    .map((p) => {
      const listo = p.hecho >= p.meta;
      const pct = p.meta ? Math.min(100, Math.round((p.hecho / p.meta) * 100)) : 100;
      return `<li class="meta-parte${listo ? ' listo' : ''}">
        <span class="meta-check">${listo ? '✓' : ''}</span>
        <span class="meta-label">${esc(p.label)}</span>
        <span class="meta-barra"><i style="width:${pct}%"></i></span>
        <span class="meta-cifra">${p.hecho}<em>/${p.meta}</em></span>
      </li>`;
    })
    .join('');

  /* La racha es la mecánica que más sostiene el hábito, así que se pinta
   * grande y primero. Cuando está en cero no se disfraza: decir "0 días" y
   * "empieza hoy" es más honesto —y más motivador— que esconder el contador. */
  const r = j.racha;
  const rachaBloque = `<div class="racha${r.actual > 0 ? ' viva' : ''}">
    <span class="racha-num">${r.actual}</span>
    <span class="racha-txt">${r.actual === 1 ? 'día seguido' : 'días seguidos'}</span>
    <span class="racha-sub">${r.actual === 0 ? 'empieza hoy' : `mejor: ${r.mejor}`}</span>
  </div>`;

  const n = j.nivel;
  const nivelBloque = `<div class="nivel">
    <div class="nivel-cab"><strong>Nivel ${n.nivel}</strong><span>${n.dentro} / ${n.necesita} XP</span></div>
    <span class="nivel-barra"><i style="width:${n.pct}%"></i></span>
    <span class="nivel-total">${j.xp.toLocaleString('es-CO')} XP en total</span>
  </div>`;

  const estado = hoy.vacia
    ? 'Sin trabajo pendiente hoy'
    : hoy.cumplida
      ? '¡Día cerrado!'
      : `${hoy.pct}% del día`;

  const reciente = (j.reciente || []).length
    ? `<ul class="reciente">${j.reciente
        .slice(0, 5)
        .map((e) => `<li><span class="rec-xp">+${e.xp}</span> ${esc(e.texto)} <em>${esc(e.fecha)}</em></li>`)
        .join('')}</ul>`
    : `<p class="reciente-vacio">Todavía no ha pasado nada. Graba la primera auditoría y esto se llena.</p>`;

  return `<section class="juego-cab${hoy.cumplida && !hoy.vacia ? ' cerrado' : ''}">
    <div class="juego-anillo">
      ${anillo(hoy.pct, `${hoy.pct}%`, estado === '¡Día cerrado!' ? 'cerrado' : 'de hoy')}
      ${rachaBloque}
    </div>
    <div class="juego-meta">
      <h2>La meta de hoy</h2>
      <ul class="meta-lista">${partes}</ul>
    </div>
    <div class="juego-nivel">
      ${nivelBloque}
      <h3>Lo último</h3>
      ${reciente}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Progreso: los logros
// ---------------------------------------------------------------------------

App.views.progreso = {
  title: 'Progreso',
  sub: 'Lo que llevas construido, no lo que falta.',
  render() {
    const j = App.state.juego;
    if (!j) return emptyState('El juego no está disponible.');

    const t = j.totales;
    const conseguidos = j.logros.filter((l) => l.conseguido).length;

    const kpis = `<div class="kpi-row">
      ${kpi('Nivel', String(j.nivel.nivel), `${j.xp.toLocaleString('es-CO')} XP`, 'blue')}
      ${kpi('Racha', `${j.racha.actual}d`, `mejor: ${j.racha.mejor}d`, j.racha.actual ? 'green' : '')}
      ${kpi('Logros', `${conseguidos}/${j.logros.length}`, 'conseguidos', conseguidos ? 'green' : '')}
      ${kpi('Días cumplidos', String(j.racha.diasCumplidos), 'desde el inicio', '')}
    </div>`;

    const embudo = section(
      'El embudo, de arriba a abajo',
      `<ul class="embudo">
        ${[
          ['Auditorías grabadas', t.auditorias],
          ['Mensajes enviados', t.mensajes],
          ['Respuestas', t.respuestas],
          ['Reuniones agendadas', t.reuniones],
          ['Reuniones hechas', t.reunionesHechas],
          ['Propuestas', t.propuestas],
          ['Clientes ganados', t.clientes],
        ]
          .map(
            ([label, valor]) =>
              `<li><span>${esc(label)}</span><strong>${valor}</strong></li>`
          )
          .join('')}
      </ul>`
    );

    const porGrupo = j.grupos
      .map((g) => {
        const items = j.logros.filter((l) => l.grupo === g.id);
        if (!items.length) return '';
        const tarjetas = items
          .map(
            (l) => `<div class="logro${l.conseguido ? ' hecho' : ''}" title="${esc(l.desc)}">
              <span class="logro-icono">${l.icon}</span>
              <strong>${esc(l.nombre)}</strong>
              <span class="logro-desc">${esc(l.desc)}</span>
              ${l.conseguido ? '<span class="logro-sello">conseguido</span>' : `<span class="logro-barra"><i style="width:${l.pct}%"></i></span><span class="logro-falta">${l.valor} / ${l.meta}</span>`}
            </div>`
          )
          .join('');
        return section(g.nombre, `<div class="logro-grid">${tarjetas}</div>`);
      })
      .join('');

    /* La tabla de puntos se muestra, no se esconde. Si el juego premia unas
     * cosas más que otras, quien lo usa tiene derecho a saber cuáles: un
     * marcador cuyas reglas no se ven se siente arbitrario y deja de motivar. */
    const tabla = section(
      'Cuánto vale cada cosa',
      `<p class="tabla-nota">Quinientos mensajes al vacío valen lo mismo que un cliente firmado. Esa proporción es a propósito.</p>
       <ul class="xp-tabla">${Object.entries(j.tabla)
         .sort((a, b) => b[1] - a[1])
         .map(([tipo, xp]) => `<li><span>${esc(ETIQUETAS_UI[tipo] || tipo)}</span><strong>${xp} XP</strong></li>`)
         .join('')}</ul>`
    );

    return `${kpis}${embudo}${porGrupo}${tabla}`;
  },
};

const ETIQUETAS_UI = {
  auditoria: 'Auditoría grabada',
  mensaje: 'Mensaje enviado',
  piezaAprobada: 'Pieza aprobada',
  piezaPublicada: 'Pieza publicada',
  respuesta: 'Respuesta recibida',
  reunionAgendada: 'Reunión agendada',
  reunionRealizada: 'Reunión realizada',
  propuestaEnviada: 'Propuesta enviada',
  propuestaAceptada: 'Propuesta aceptada',
  clienteGanado: 'Cliente ganado',
  facturaPagada: 'Factura pagada',
};

// ---------------------------------------------------------------------------
// Detección de lo que cambió
// ---------------------------------------------------------------------------

/* El juego no se dispara desde cada botón: se dispara comparando el estado
 * anterior con el nuevo después de cada refresco.
 *
 * Es lo que permite que celebre exactamente igual cuando la respuesta la
 * registra Juanjo a mano y cuando la trae el reloj o un agente. Colgar la
 * celebración de los manejadores de clic habría dejado mudo todo lo que el
 * sistema hace solo, que es justamente hacia donde va este producto.
 */
let juegoPrevio = null;

function centroPantalla() {
  return [window.innerWidth / 2, window.innerHeight * 0.4];
}

function celebrarCambios(nuevo) {
  if (!nuevo) return;

  // El primer pintado de la sesión no celebra nada: nadie acaba de hacerlo, y
  // festejar el historial completo al abrir sería ruido puro.
  if (!juegoPrevio) {
    juegoPrevio = nuevo;
    return;
  }
  const previo = juegoPrevio;
  juegoPrevio = nuevo;

  const [cx, cy] = centroPantalla();

  // 1. XP ganado desde el último refresco.
  const ganado = nuevo.xp - previo.xp;
  if (ganado > 0) {
    popupXP(cx, cy, `+${ganado} XP`, ganado >= 50);
    // Suena el evento más valioso de los que entraron, no todos a la vez: seis
    // sonidos encimados no se leen como seis logros, se leen como un error.
    const nuevos = (nuevo.reciente || []).filter(
      (e) => !(previo.reciente || []).some((p) => p.fecha === e.fecha && p.texto === e.texto)
    );
    const mejor = nuevos.sort((a, b) => b.xp - a.xp)[0];
    if (mejor && SONIDO_EVENTO[mejor.tipo]) SONIDO_EVENTO[mejor.tipo]();
    else sonidoTic();
    if (ganado >= 100) confeti(cx, cy, { grande: true });
  }

  // 2. Logros nuevos.
  const antes = new Set((previo.logros || []).filter((l) => l.conseguido).map((l) => l.id));
  const conseguidos = (nuevo.logros || []).filter((l) => l.conseguido && !antes.has(l.id));
  conseguidos.forEach((l, i) => {
    setTimeout(() => {
      cartel(l.nombre, l.desc, l.icon);
      sonidoLogro();
      confeti(cx, cy);
    }, i * 700);
  });

  // 3. Subida de nivel.
  if (nuevo.nivel.nivel > previo.nivel.nivel) {
    setTimeout(() => {
      cartel(`Nivel ${nuevo.nivel.nivel}`, 'El negocio subió de nivel', '✦');
      sonidoNivel();
      confeti(cx, cy, { grande: true });
    }, conseguidos.length * 700);
  }

  // 4. La meta del día, que es la única victoria diaria que existe.
  if (nuevo.hoy.cumplida && !previo.hoy.cumplida && !nuevo.hoy.vacia) {
    setTimeout(() => {
      cartel('Día cerrado', nuevo.racha.actual > 1 ? `Racha de ${nuevo.racha.actual} días` : 'Meta del día cumplida', '▲');
      sonidoMeta();
      confeti(cx, cy, { grande: true });
    }, (conseguidos.length + 1) * 700);
  }
}
