/* Prueba de la API completa contra el servidor corriendo. Importa dos
 * prospectos de prueba, recorre el ciclo entero y al final los borra, para no
 * dejar basura en la base real. */

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:4199';
let fallas = 0;

function ok(label, cond, extra) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${label}${extra !== undefined ? ` — ${extra}` : ''}`);
  if (!cond) fallas += 1;
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = { _raw: text };
  }
  return { status: res.status, body: json, text };
}

const MARCA = 'ZZTEST';

(async () => {
  // --- Importación ---------------------------------------------------------
  const lote = [
    'nombre\tciudad\ttelefono\temail\tcontacto\tdias',
    `${MARCA} Aurora Med Spa\tHialeah\t+1 786 555 9001\tzztest-aurora@ejemplo.com\tAna Restrepo\t95`,
    `${MARCA} Bella Skin\tKendall\t+1 305 555 9002\tzztest-bella@ejemplo.com\tLuisa Gomez\t20`,
  ].join('\n');

  const imp = await call('POST', '/api/prospecting/import', {
    text: lote,
    currency: 'USD',
    city: 'Miami',
    value: 1800,
    perDay: 1,
  });
  ok('importa el lote', imp.status === 200 && imp.body.importados === 2, JSON.stringify(imp.body).slice(0, 140));
  ok('los inscribe en la secuencia', imp.body.inscritos === 2);
  ok('los reparte en varios días', imp.body.dias === 2, `${imp.body.dias} día(s)`);

  // --- Estado ---------------------------------------------------------------
  let st = (await call('GET', '/api/state')).body;
  const mios = st.clients.filter((c) => c.name.startsWith(MARCA));
  const misDeals = st.deals.filter((d) => mios.some((c) => c.id === d.clientId));
  ok('crea los clientes', mios.length === 2);
  ok('crea las oportunidades con datos de auditoría', misDeals.every((d) => d.audit && d.audit.script));
  const misToques = st.touches.filter((t) => misDeals.some((d) => d.id === t.dealId));
  ok('crea 5 toques por prospecto', misToques.length === 10, `${misToques.length}`);

  // --- Lista de grabación ---------------------------------------------------
  // El limite va explicito: la lista del dia se corta en la meta diaria, y con
  // la base cargada de prospectos reales los de la prueba quedan fuera del
  // corte por ser los mas nuevos. Lo que se afirma es que entraron a la lista,
  // no en que posicion quedaron.
  const rec = await call('GET', '/api/prospecting/today?limit=500');
  ok('los pone en la lista de grabación', rec.body.lista.some((p) => p.name.startsWith(MARCA)));

  // --- Registrar la auditoría -----------------------------------------------
  const d0 = misDeals[0];
  const aud = await call('POST', `/api/deals/${d0.id}/audit`, {
    observation: 'Lleva 95 días con el mismo anuncio de botox.',
    idea: 'Separar el público de primera visita del de recompra.',
    videoUrl: 'https://loom.com/share/zztest',
    creativeAgeDays: 95,
  });
  ok('registra la auditoría', aud.status === 200 && aud.body.audit.status === 'grabada');

  // --- Cola del día ----------------------------------------------------------
  const cola = (await call('GET', '/api/touches/queue')).body;
  const mio = cola.hoy.find((t) => t.dealId === d0.id);
  ok('el toque 1 aparece en la cola de hoy', Boolean(mio));
  ok('sin variables sin llenar', mio && mio.missing.length === 0, mio ? mio.missing.join(',') : '');
  ok('el mensaje trae el enlace del video', mio && mio.body.includes('loom.com'));
  ok('el mensaje saluda por el nombre', mio && mio.body.includes('Ana'));

  // --- Encolar en la bandeja -------------------------------------------------
  const enc = await call('POST', '/api/outbox/queue-today', { touchIds: [mio.id] });
  ok('encola el mensaje', enc.body.encolados.length === 1, JSON.stringify(enc.body.bloqueados));
  const msgId = enc.body.encolados[0].id;

  st = (await call('GET', '/api/state')).body;
  const enBandeja = st.outbox.find((m) => m.id === msgId);
  ok('el mensaje queda en la bandeja', Boolean(enBandeja) && enBandeja.status === 'pendiente');
  ok('el mensaje conserva el destinatario', enBandeja.to.includes('786') || enBandeja.to.includes('@'), enBandeja.to);

  // --- Marcarlo enviado avanza la secuencia ---------------------------------
  await call('POST', `/api/outbox/${msgId}/sent`, {});
  st = (await call('GET', '/api/state')).body;
  const t1 = st.touches.find((t) => t.id === mio.id);
  const dealTrasEnvio = st.deals.find((d) => d.id === d0.id);
  ok('el toque queda enviado', t1.status === 'enviado');
  ok('la oportunidad pasa a contactado', dealTrasEnvio.stage === 'contactado', dealTrasEnvio.stage);
  ok('la próxima acción apunta al toque 2', dealTrasEnvio.nextAction.includes('Toque 2'), dealTrasEnvio.nextAction);

  // --- Validación de entrada -------------------------------------------------
  const precioTexto = await call('POST', '/api/proposals', {
    clientId: mios[1].id,
    title: `${MARCA} con precio escrito a la colombiana`,
    currency: 'COP',
    taxRate: 19,
    items: [{ description: 'Retainer', qty: '1', unitPrice: '3.500.000' }],
  });
  ok('acepta un precio escrito como "3.500.000"', precioTexto.status === 200);
  ok(
    'y lo guarda como número',
    precioTexto.body.items[0].unitPrice === 3500000,
    JSON.stringify(precioTexto.body.items[0])
  );
  await call('DELETE', `/api/proposals/${precioTexto.body.id}`);

  const basura = await call('POST', '/api/deals', { clientId: mios[1].id, title: 'X', value: 'como quinientos' });
  ok('rechaza un valor que no es número', basura.status === 400, `${basura.status} ${basura.body.error || ''}`);

  const etapaMala = await call('POST', '/api/deals', { clientId: mios[1].id, title: 'X', stage: 'casi-cerrado' });
  ok('rechaza una etapa inventada', etapaMala.status === 400);

  const fechaMala = await call('POST', '/api/invoices', { clientId: mios[1].id, dueDate: '15/08/2026', items: [] });
  ok('rechaza una fecha mal escrita', fechaMala.status === 400);

  // --- Agenda ------------------------------------------------------------------
  const d1 = misDeals[1];
  const cuando = `${new Date(Date.now() + 172800000).toLocaleDateString('sv')}T10:30`;
  const agendar = await call('POST', `/api/deals/${d1.id}/meeting`, { at: cuando, notes: 'Le duele el costo por consulta' });
  ok('agenda la llamada', agendar.status === 200, JSON.stringify(agendar.body).slice(0, 120));
  ok('programa confirmación y recordatorio', agendar.body.toques === 2, `${agendar.body.toques} toque(s)`);

  const sinFecha = await call('POST', `/api/deals/${d1.id}/meeting`, { at: 'mañana' });
  ok('rechaza una fecha de llamada inválida', sinFecha.status === 400);

  const ags = await call('GET', '/api/meetings');
  ok('la llamada aparece en la agenda', ags.body.lista.some((m) => m.dealId === d1.id));
  ok('con su hora', (ags.body.lista.find((m) => m.dealId === d1.id) || {}).hora === '10:30');

  st = (await call('GET', '/api/state')).body;
  const dealAgendado = st.deals.find((x) => x.id === d1.id);
  ok('la oportunidad sube a reunión', dealAgendado.stage === 'reunion', dealAgendado.stage);
  const captacionViva = st.touches.filter((t) => t.dealId === d1.id && t.status === 'pendiente' && t.sequenceId === 'seq-auditoria');
  ok('agendar detiene la secuencia de captación', captacionViva.length === 0, `${captacionViva.length} vivos`);

  const resultado = await call('POST', `/api/deals/${d1.id}/meeting-result`, { status: 'realizada', notes: 'Quiere arrancar ya' });
  ok('registra el resultado de la llamada', resultado.status === 200 && resultado.body.meeting.status === 'realizada');
  ok('y empuja a mandar la propuesta hoy', resultado.body.nextAction.includes('propuesta'), resultado.body.nextAction);
  ok('la oportunidad avanza a propuesta', resultado.body.stage === 'propuesta');

  // --- El reloj ----------------------------------------------------------------
  const corrida = await call('POST', '/api/reloj/correr', {});
  ok('el reloj corre a mano', corrida.status === 200 && corrida.body.fecha);
  ok('y escribe el parte', corrida.body.parte.includes('Lo que te espera hoy'));

  const parte = await call('GET', '/api/reloj/parte');
  ok('el parte queda guardado', parte.body.existe === true);

  // --- Documento público -----------------------------------------------------
  const prop = await call('POST', '/api/proposals', {
    clientId: mios[0].id,
    title: `${MARCA} Sprint de 14 días`,
    currency: 'USD',
    issueDate: new Date().toLocaleDateString('sv'),
    taxRate: 0,
    status: 'borrador',
    items: [{ description: 'Sprint de arranque', qty: 1, unitPrice: 900 }],
  });
  ok('crea la propuesta', prop.status === 200 && prop.body.number);

  const share = await call('POST', `/api/proposals/${prop.body.id}/share`);
  ok('genera el enlace público', share.status === 200 && share.body.url.includes('/d/'), share.body.url);
  const token = share.body.token;

  const page = await fetch(`${BASE}/d/${token}`);
  const html = await page.text();
  ok('la página pública abre sin llave', page.status === 200);
  ok('muestra el documento', html.includes('Sprint de 14') && /900[.,]00 USD/.test(html));
  ok('trae el formulario de aceptación', html.includes('Aceptar propuesta'));
  ok('no se indexa', html.includes('noindex'));

  st = (await call('GET', '/api/state')).body;
  const propGuardada = st.proposals.find((p) => p.id === prop.body.id);
  ok('registra la apertura', (propGuardada.share.views || []).length === 1);

  // Aceptación desde el formulario, como lo haría el navegador del cliente.
  const acc = await fetch(`${BASE}/d/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Ana Restrepo', role: 'Propietaria', email: 'ana@ejemplo.com', agree: '1' }).toString(),
  });
  const accHtml = await acc.text();
  ok('acepta desde el formulario', acc.status === 200 && accHtml.includes('Propuesta aceptada'));

  st = (await call('GET', '/api/state')).body;
  const aceptada = st.proposals.find((p) => p.id === prop.body.id);
  ok('la propuesta queda aceptada', aceptada.status === 'aceptada');
  ok('guarda quién aceptó', aceptada.acceptance.name === 'Ana Restrepo');
  ok('guarda la huella del documento', aceptada.acceptance.documentHash.length === 64);

  // Aceptar detiene la secuencia del cliente.
  const dealFinal = st.deals.find((d) => d.id === d0.id);
  const pendientes = st.touches.filter((t) => t.dealId === d0.id && t.status === 'pendiente');
  ok('aceptar detiene la secuencia', pendientes.length === 0, `${pendientes.length} pendientes`);
  ok('la oportunidad sube a negociación', dealFinal.stage === 'negociacion', dealFinal.stage);

  // --- Falta la aceptación sin marcar la casilla ------------------------------
  const prop2 = await call('POST', '/api/proposals', {
    clientId: mios[1].id,
    title: `${MARCA} Segunda`,
    currency: 'USD',
    issueDate: new Date().toLocaleDateString('sv'),
    taxRate: 0,
    items: [{ description: 'X', qty: 1, unitPrice: 100 }],
  });
  const share2 = await call('POST', `/api/proposals/${prop2.body.id}/share`);
  const sinCasilla = await fetch(`${BASE}/d/${share2.body.token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Alguien' }).toString(),
  });
  const sinHtml = await sinCasilla.text();
  ok('no acepta sin marcar la casilla', sinHtml.includes('casilla'));

  // --- Token inválido ---------------------------------------------------------
  const malo = await fetch(`${BASE}/d/token-que-no-existe`);
  ok('token inválido devuelve 404 limpio', malo.status === 404);

  // --- Cascada al borrar el cliente -------------------------------------------
  await call('DELETE', `/api/proposals/${prop2.body.id}`);
  await call('DELETE', `/api/outbox/${msgId}`);

  const deps = await call('GET', `/api/clients/${mios[0].id}/dependencies`);
  ok('sabe qué cuelga del cliente', Object.keys(deps.body.dependencias).length > 0, JSON.stringify(deps.body.dependencias));

  const sinCascada = await call('DELETE', `/api/clients/${mios[0].id}`);
  ok('no borra un cliente con documentos', sinCascada.status === 409, `${sinCascada.status}`);
  ok('y dice qué lo impide', Boolean(sinCascada.body.dependencias));

  st = (await call('GET', '/api/state')).body;
  ok('el cliente sigue ahí', st.clients.some((c) => c.id === mios[0].id));

  const conCascada = await call('DELETE', `/api/clients/${mios[0].id}?cascade=1`);
  ok('con cascada sí lo borra', conCascada.status === 200);

  st = (await call('GET', '/api/state')).body;
  ok('se lleva su propuesta', !st.proposals.some((p) => p.id === prop.body.id));
  ok('se lleva su oportunidad', !st.deals.some((d) => d.clientId === mios[0].id));
  ok('no deja toques colgando', !st.touches.some((t) => t.clientId === mios[0].id));

  // --- Agregar y descartar desde la lista de grabación ------------------------
  // Las dos salidas que faltaban: meter un negocio suelto sin armar un lote, y
  // sacar de la lista el que no sirve.
  const quick = await call('POST', '/api/prospecting/quick', {
    name: `${MARCA} Clinica Suelta`,
    city: 'Doral',
    phone: '+1 305 555 9100',
    contactName: 'Marta Diaz',
    currency: 'USD',
    value: 1800,
  });
  ok('agrega un negocio suelto', quick.status === 200 && quick.body.creados === 1, JSON.stringify(quick.body).slice(0, 120));
  ok('y lo inscribe en la secuencia', quick.body.inscritos === 1);

  const repetido = await call('POST', '/api/prospecting/quick', { name: `${MARCA} Clinica Suelta` });
  ok('no deja agregar dos veces el mismo negocio', repetido.status === 409, `${repetido.status}`);

  st = (await call('GET', '/api/state')).body;
  const suelto = st.clients.find((c) => c.name === `${MARCA} Clinica Suelta`);
  const dealSuelto = st.deals.find((d) => d.clientId === suelto.id);
  ok('el negocio suelto llega con su guion de auditoría', Boolean(dealSuelto.audit && dealSuelto.audit.script));

  const listaTodas = await call('GET', '/api/prospecting/today?limit=0');
  ok('la lista completa lo incluye', listaTodas.body.lista.some((p) => p.dealId === dealSuelto.id));
  ok('y dice cuántos esperan en total', listaTodas.body.total >= listaTodas.body.lista.length, `${listaTodas.body.total}`);

  const cortada = await call('GET', '/api/prospecting/today');
  ok('sin límite la corta en la meta diaria', cortada.body.lista.length <= cortada.body.meta, `${cortada.body.lista.length}/${cortada.body.meta}`);

  const desc = await call('POST', `/api/deals/${dealSuelto.id}/discard`, { reason: 'El contacto no sirve' });
  ok('descarta el prospecto', desc.status === 200 && desc.body.borrado === false);
  ok('y cancela lo que quedaba de su secuencia', desc.body.cancelados > 0, `${desc.body.cancelados} toque(s)`);

  st = (await call('GET', '/api/state')).body;
  const dealDesc = st.deals.find((d) => d.id === dealSuelto.id);
  ok('queda como perdido con motivo', dealDesc.stage === 'perdido' && dealDesc.lostReason.includes('contacto'), dealDesc.lostReason);
  ok('la auditoría queda descartada', dealDesc.audit.status === 'descartada');

  const trasDescartar = await call('GET', '/api/prospecting/today?limit=0');
  ok('sale de la lista de grabación', !trasDescartar.body.lista.some((p) => p.dealId === dealSuelto.id));

  // Sin ningún dato de contacto: la basura que entra con cualquier lote.
  const fantasma = await call('POST', '/api/prospecting/quick', { name: `${MARCA} Negocio Fantasma`, enroll: false });
  ok('acepta un negocio sin datos', fantasma.status === 200);
  const conteo = await call('GET', '/api/prospecting/today?limit=0');
  ok('lo cuenta como sin contacto', conteo.body.sinContacto >= 1, `${conteo.body.sinContacto}`);

  /* El barrido masivo (`/api/automations/clean-prospects`) no se dispara aquí a
   * propósito: estas pruebas corren contra el vault real, y ese endpoint tocaría
   * prospectos de verdad. La regla se prueba con estado sintético en
   * `reloj.test.js`; aquí solo se verifica que el conteo los ve. */
  st = (await call('GET', '/api/state')).body;
  const dealFantasma = st.deals.find((d) => d.title.startsWith(`${MARCA} Negocio Fantasma`));
  await call('POST', `/api/deals/${dealFantasma.id}/discard`, { purge: true });

  // Borrado total: para lo que nunca debió entrar.
  const basuraTotal = await call('POST', '/api/prospecting/quick', { name: `${MARCA} Duplicado Basura`, enroll: false });
  ok('crea el duplicado de prueba', basuraTotal.status === 200);
  st = (await call('GET', '/api/state')).body;
  const dealBasura = st.deals.find((d) => d.title.startsWith(`${MARCA} Duplicado Basura`));
  const purga = await call('POST', `/api/deals/${dealBasura.id}/discard`, { purge: true });
  ok('el borrado total no deja registro', purga.body.borrado === true);
  st = (await call('GET', '/api/state')).body;
  ok('se lleva la oportunidad', !st.deals.some((d) => d.id === dealBasura.id));
  ok('y el cliente que solo existía para eso', !st.clients.some((c) => c.name === `${MARCA} Duplicado Basura`));

  for (const c of st.clients.filter((x) => x.name.startsWith(MARCA))) {
    await call('DELETE', `/api/clients/${c.id}?cascade=1`);
  }

  // --- Limpieza ---------------------------------------------------------------
  st = (await call('GET', '/api/state')).body;
  for (const t of st.touches.filter((x) => misDeals.some((d) => d.id === x.dealId))) {
    await call('DELETE', `/api/touches/${t.id}`);
  }
  for (const d of misDeals) await call('DELETE', `/api/deals/${d.id}`);
  for (const c of mios) await call('DELETE', `/api/clients/${c.id}?cascade=1`);

  st = (await call('GET', '/api/state')).body;
  ok('la limpieza no deja rastro', st.clients.filter((c) => c.name.startsWith(MARCA)).length === 0);
  ok('no quedan toques huérfanos', st.touches.filter((t) => misDeals.some((d) => d.id === t.dealId)).length === 0);

  console.log(`\n${fallas ? `${fallas} FALLA(S)` : 'Todo en verde'}`);
  process.exit(fallas ? 1 : 0);
})();
