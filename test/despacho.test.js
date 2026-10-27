/* El Despacho contra el servidor corriendo: el recorrido completo de una pieza
 * desde que un agente la crea hasta que sale, y todos los atajos que NO debe
 * permitir.
 *
 * Corre contra el vault real como el resto de la suite, asi que todo lo que
 * crea va marcado con ZZTEST y se borra al final.
 *
 * La mitad de las verificaciones son negativas. El Despacho es la unica
 * frontera humana del Marketing OS: si se pudiera saltar —publicando directo,
 * reviviendo lo retirado, rechazando sin motivo— dejaria de ser una revision y
 * pasaria a ser un adorno sobre un sistema que en realidad publica solo.
 */

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
  return { status: res.status, body: json };
}

const MARCA = 'ZZTEST';

(async () => {
  const creados = { campaigns: [], assets: [], outcomes: [] };

  // --- La campana ----------------------------------------------------------
  const camp = await call('POST', '/api/campaigns', {
    name: `${MARCA} Auditoria med spas`,
    canal: 'meta-ads',
    nicho: 'medspa',
    objetivo: 'reuniones',
    presupuestoMes: '1.200',
    currency: 'USD',
    estado: 'activa',
  });
  ok('crea la campana', camp.status === 200, camp.body.id);
  ok('normaliza el presupuesto con punto de miles', camp.body.presupuestoMes === 1200, camp.body.presupuestoMes);
  creados.campaigns.push(camp.body.id);

  const malCanal = await call('POST', '/api/campaigns', { name: `${MARCA} mala`, canal: 'telepatia' });
  ok('rechaza un canal inventado', malCanal.status === 400, malCanal.body.error);

  // --- La pieza ------------------------------------------------------------
  /* Se crea sin `estado` a proposito: asi es como la va a crear un agente
   * despues de generar su entregable, y tiene que nacer en Despacho. */
  const pieza = await call('POST', '/api/assets', {
    campaignId: camp.body.id,
    canal: 'meta-ads',
    tipo: 'ad-copy',
    titulo: `${MARCA} Variante dolor`,
    angulo: 'dolor',
    gancho: 'pagas por leads que no contestan',
    variante: 'A',
    nicho: 'medspa',
    hipotesis: 'el dolor del lead que no contesta pesa mas que el beneficio',
    playbookVersion: 'v1',
    rutaVault: 'AdsSuite\\ZZTEST.md',
  });
  ok('un agente puede registrar su pieza', pieza.status === 200);
  ok('nace en Despacho, no publicada', pieza.body.estado === 'generado', pieza.body.estado);
  creados.assets.push(pieza.body.id);
  const A = pieza.body.id;

  // --- Lo que el Despacho NO permite --------------------------------------

  const saltoDirecto = await call('PUT', `/api/assets/${A}`, { estado: 'publicado' });
  ok('no se puede saltar de generado a publicado por el CRUD', saltoDirecto.status === 400, saltoDirecto.body.error);

  const saltoRuta = await call('POST', `/api/marketing/despacho/${A}/publicar`, { externalRef: 'x' });
  ok('ni por la ruta de publicar', saltoRuta.status === 400, saltoRuta.body.error);

  const sinMotivo = await call('POST', `/api/marketing/despacho/${A}/rechazar`, { motivo: '   ' });
  ok('rechazar exige motivo', sinMotivo.status === 400, sinMotivo.body.error);

  const fantasma = await call('POST', '/api/marketing/despacho/no-existe/aprobar');
  ok('una pieza inexistente da 404, no 500', fantasma.status === 404, fantasma.status);

  // --- El recorrido bueno --------------------------------------------------

  const aprobada = await call('POST', `/api/marketing/despacho/${A}/aprobar`);
  ok('aprueba', aprobada.status === 200 && aprobada.body.estado === 'aprobado');

  const publicada = await call('POST', `/api/marketing/despacho/${A}/publicar`, { externalRef: '23847_zztest' });
  ok('publica', publicada.status === 200 && publicada.body.asset.estado === 'publicado');
  ok('guarda el amarre con las metricas', publicada.body.asset.externalRef === '23847_zztest');
  ok('fecha la salida', !!publicada.body.asset.publicadoAt, publicada.body.asset.publicadoAt);

  const pausada = await call('POST', `/api/marketing/despacho/${A}/pausar`);
  ok('pausa lo publicado', pausada.body.estado === 'pausado');
  const republicada = await call('POST', `/api/marketing/despacho/${A}/publicar`, {});
  ok('lo pausado puede volver', republicada.body.asset.estado === 'publicado');

  // --- Una pieza rechazada, que es la senal de entrenamiento ---------------

  const piezaB = await call('POST', '/api/assets', {
    campaignId: camp.body.id,
    canal: 'meta-ads',
    tipo: 'ad-copy',
    titulo: `${MARCA} Variante garantia`,
    angulo: 'garantia',
    variante: 'B',
  });
  creados.assets.push(piezaB.body.id);
  const B = piezaB.body.id;

  const rechazada = await call('POST', `/api/marketing/despacho/${B}/rechazar`, { motivo: 'promete resultados' });
  ok('rechaza con motivo', rechazada.body.estado === 'rechazado' && rechazada.body.motivoRechazo === 'promete resultados');

  const revivir = await call('POST', `/api/marketing/despacho/${B}/aprobar`);
  ok('lo rechazado es final: no se puede aprobar despues', revivir.status === 400, revivir.body.error);

  // --- Resultados y tablero ------------------------------------------------

  const oc = await call('POST', '/api/outcomes', {
    assetId: A,
    campaignId: camp.body.id,
    fecha: '2026-08-14',
    fuente: 'meta-csv',
    m: { impresiones: '12,400', clics: '310', gasto: '$ 240,50', leads: 22 },
  });
  ok('ingiere metricas con formato de CSV', oc.status === 200 && oc.body.m.impresiones === 12400, oc.body.m.impresiones);
  ok('y el dinero con coma decimal', oc.body.m.gasto === 240.5, oc.body.m.gasto);
  creados.outcomes.push(oc.body.id);

  const negativa = await call('POST', '/api/outcomes', { assetId: A, m: { leads: -5 } });
  ok('una metrica negativa no entra', negativa.status === 400, negativa.body.error);

  const tab = await call('GET', '/api/marketing/tablero?metrica=ctr');
  ok('el tablero responde', tab.status === 200);
  ok('cuenta el rechazo como senal', tab.body.rechazos.total >= 1, `${tab.body.rechazos.total}`);
  const meta = tab.body.porCanal.find((c) => c.canal === 'meta-ads');
  ok('el canal ve la pieza publicada', meta && meta.publicadas >= 1, meta && meta.publicadas);

  const grupoDolor = (tab.body.dimensiones.angulo || []).find((g) => g.valor === 'dolor');
  ok('agrupa por angulo', !!grupoDolor, grupoDolor && grupoDolor.valor);
  ok(
    'conserva el nombre del angulo y la cifra por separado',
    grupoDolor && typeof grupoDolor.valor === 'string' && typeof grupoDolor.valorMetrica === 'number',
    grupoDolor && `${grupoDolor.valor} / ${grupoDolor.valorMetrica}`
  );

  // --- Limpieza ------------------------------------------------------------
  for (const id of creados.outcomes) await call('DELETE', `/api/outcomes/${id}`);
  for (const id of creados.assets) await call('DELETE', `/api/assets/${id}`);
  for (const id of creados.campaigns) await call('DELETE', `/api/campaigns/${id}`);

  const st = (await call('GET', '/api/state')).body;
  ok('la limpieza no deja rastro', (st.assets || []).filter((a) => a.titulo && a.titulo.startsWith(MARCA)).length === 0);
  ok('ni campanas de prueba', (st.campaigns || []).filter((c) => c.name.startsWith(MARCA)).length === 0);

  console.log(`\n${fallas ? `${fallas} FALLA(S)` : 'Todo en verde'}`);
  process.exit(fallas ? 1 : 0);
})();
