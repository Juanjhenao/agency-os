# Agency OS

Sistema comercial de la agencia: CRM, catálogo de servicios, propuestas, contratos, suscripciones, facturación multi-moneda, onboarding y finanzas. Todo en una app web local, con los datos en tu vault de Obsidian.

## Arrancar

```bash
cd agency-os
npm install     # solo la primera vez
npm start
```

Abre **http://localhost:4180**. También puedes hacer doble clic en `iniciar.cmd`.

## Dónde viven los datos

Todo en `<vault>\Agency\`, donde `<vault>` es `~/Documents/Obsidian Vault` o la carpeta que indique la variable `OBSIDIAN_VAULT`:

| Ruta | Qué es |
|---|---|
| `agency-os.json` | Base de datos completa (única fuente de verdad) |
| `Clientes\*.md` | Ficha de cada cliente con frontmatter |
| `Propuestas\*.md` | Espejo de cada propuesta |
| `Contratos\*.md` | Clausulado completo de cada contrato |
| `Facturas\*.md` | Espejo de cada factura |

Los `.md` se reescriben solos cada vez que guardas algo en la app: sirven para leer, enlazar y buscar desde Obsidian, no para editar.

## El flujo completo

```
CRM → Propuesta → (aceptada) → Contrato → (firmado) → Suscripción → Factura mensual
                                                           ↓
                                                      Onboarding
```

Cada paso tiene un botón que genera el siguiente documento con los datos ya cargados: la propuesta aceptada genera el contrato, el contrato firmado activa la suscripción, y la suscripción genera la factura del mes.

## El día de trabajo

Toda la operación diaria cabe en una pestaña: **Hoy**.

```
Prospección → importas el lote → el sistema reparte la secuencia
                                          ↓
Hoy → grabas las auditorías → mandas los toques → registras las respuestas
                                          ↓
      Propuesta con enlace → el cliente acepta → contrato con enlace → firma
                                          ↓
                              Factura con enlace de pago
```

**Hoy** muestra cuatro cosas y nada más: las llamadas agendadas, las auditorías que faltan por grabar, los mensajes que salen hoy y lo que quedó en la bandeja de salida. Cuando esas listas están vacías, el día está hecho.

## Lo que corre solo

Cada mañana, sin que abras nada:

| Siempre | Configurable en **Ajustes → Lo que corre solo** |
|---|---|
| Cierra las secuencias agotadas | Vence las propuestas que pasaron su vigencia |
| Marca las facturas en mora | Descarta los prospectos sin ningún dato de contacto |
| Avisa de renovaciones y clientes en riesgo | Abre el mes de producción de los clientes activos |
| Reclama las llamadas que pasaron sin resultado | Importa del vault lo que produjeron los agentes |
| Limpia espejos huérfanos y escribe el parte | Arma los borradores de reporte del día 28 en adelante |
| | Emite las facturas de suscripciones vencidas — **apagada** por defecto |

La lista completa, con lo que hace cada una, está dentro de la app en **Automatizaciones**.

El criterio de qué puede correr solo es uno: **nada que salga hacia un cliente**. Cerrar una secuencia, abrir un mes o recoger piezas del vault es cálculo sobre datos propios. Mandar un correo, una propuesta o una factura no, y por eso sigue esperando tu clic. Facturar viene apagada aunque no envíe nada, porque asignar un consecutivo es un acto contable y esa decisión no la toma un temporizador.

Corre mientras el servidor corra — no es un servicio en la nube. Si el computador está apagado, el parte no se escribe, pero al prender el reloj ve que el día quedó pendiente y lo ejecuta. Nada se pierde por apagar el equipo; solo se atrasa. Se configura en **Ajustes → Lo que corre solo**, con un botón para correrlo a mano.

## Agendar

Entre el "sí, hablemos" y la llamada efectiva se cae entre el 20 y el 30% de los que ya dijeron que sí. Por eso el botón **Agendar** de cada toque no solo guarda la fecha: cancela la secuencia de captación, programa la confirmación para hoy y el recordatorio para el día antes. La confirmación baja el ausentismo a la mitad.

Después de la llamada se registra el resultado — se hizo, no asistió, se movió, se canceló — porque sin eso no existe tasa de asistencia ni de conversión, y esos dos números son los que dicen si estás agendando mal o vendiendo mal.

Una llamada que ya pasó y sigue sin resultado **no desaparece de la pantalla**: se queda en Hoy marcada en rojo y el parte de la mañana la reclama, hasta que la cierres.

## Módulos

- **Hoy** — la pantalla de la mañana. Auditorías por grabar con su guion, la cola de toques con el texto ya resuelto, y la bandeja de salida. Cada toque trae sus botones: abrir WhatsApp con el mensaje escrito, encolar el correo, marcar enviado, o marcar que respondió (lo que detiene la secuencia). La lista de grabación se corta en la meta diaria pero no es una reja: **+ Negocio** mete uno suelto sin armar un lote, **Ver todas** muestra los que esperan, y **Descartar** saca el que no sirve —contacto errado, negocio sin datos reales, el que ya trabaja con otra agencia— cancelando su secuencia y dejando el motivo escrito.
- **Prospección** — pegas un lote de texto y sale convertido en clientes, oportunidades y toques programados. Reconoce las columnas aunque vengan desordenadas, rechaza lo que ya existe por nombre, dominio, teléfono o correo, y reparte la inscripción según la meta diaria para que no venzan 200 toques el mismo día. Abajo, el embudo real medido contra las conversiones sanas.
- **Panel** — MRR, pipeline ponderado, cartera, concentración de cliente y las acciones concretas de hoy.
- **Ruta** — el recorrido de extraño a cliente en 7 pasos, con cada prospecto ubicado en su paso y el siguiente botón obvio. Incluye el formulario público de captación (`/aplicar`) y la rúbrica de calificación automática.
- **CRM** — pipeline de 7 etapas. Toda oportunidad exige próxima acción con fecha; las atrasadas se marcan en rojo.
- **Diagnóstico** — el guion de la llamada de 30 minutos y el formulario que se llena durante ella. Un botón lo convierte en propuesta con el dolor y la solución ya escritos.
- **Mensajes** — la secuencia de 5 toques, los mensajes de cada paso del proceso y 7 objeciones con su respuesta. Todo con botón de copiar.
- **Clientes** — ficha 360 con oportunidades, propuestas, contratos, suscripciones, facturas y onboarding.
- **Servicios** — catálogo con precio en COP y USD, entregables y modalidad. Es la fuente de las líneas de propuestas y facturas.
- **Propuestas** — constructor con items del catálogo, impuestos, vigencia y vista imprimible.
- **Contratos** — plantillas de retainer, suscripción y proyecto para Colombia, EE.UU./internacional y México. Texto editable.
- **Suscripciones** — MRR, día de corte y generación de la factura del mes en un clic.
- **Facturas** — consecutivo por serie y moneda, IVA, retención, estados y control de mora.
- **Onboarding** — checklist estándar de 10 pasos por cliente, editable como plantilla.
- **Producción** — el mes de entregables por cliente: los compromisos salen solos de los entregables del catálogo ("20 piezas gráficas/mes" → meta 20). Cada pieza avanza por su propio flujo: copy y gráficas van borrador → en revisión → aprobado → publicado; los videos van idea → guion → grabado → editado → publicado. Botón **+ Marca personal** para abrir tu propio mes con el ritmo de 3 videos por semana.
- **Briefs** — la memoria de marca de cada cliente. Para anuncios: marca, público, dolor, oferta, tono, restricciones. Para marca personal: además posicionamiento, pilares de contenido, pruebas y credenciales, y formatos de video. El campo *Para qué se usa* define qué agente lo lee.
- **Reportes** — reporte mensual por cliente con el cumplimiento de entregables ya calculado, métricas que cargas tú y vista imprimible.
- **Automatizaciones** — la lista de lo que corre solo cada mañana con su estado, cinco acciones de un clic que ejecuta el propio servidor (abrir el mes de todos, facturar suscripciones vencidas, importar del vault, generar reportes, limpiar el embudo) y la cola de trabajos para los agentes.
- **Finanzas** — facturado / cobrado / gastos / neto por mes, consolidado en COP.
- **Guía** — el playbook operativo dentro de la app.
- **Ajustes** — datos fiscales, series, impuestos, datos bancarios, metas y tasa de cambio.

## Cómo se comporta la interfaz

Las decisiones de movimiento y material salen del enfoque de Apple para interfaces fluidas (*Designing Fluid Interfaces*, WWDC 2018). Lo que cambian, en concreto:

- **La respuesta vive en la pulsación, no en el soltar.** Botones, tarjetas y pestañas se hunden con el botón del ratón abajo, no cuando lo levantas. El retardo es de milisegundos, pero es exactamente donde se pierde la sensación de estar manipulando algo.
- **Curvas de spring reales, no `ease-out` disfrazado.** Están muestreadas de un spring críticamente amortiguado (ζ = 1) con la parametrización de Apple — damping ratio y *response*, no masa y rigidez. **Sin rebote a propósito:** el rebote imita la inercia de la mano, y aquí no hay un solo gesto, todo se dispara con un clic. Un panel que rebota después de un clic no se siente físico, solo se nota.
- **Todo se puede interrumpir.** Si cierras un panel y lo vuelves a abrir antes de que termine de irse, no espera: arranca desde donde está en pantalla en ese instante. Por eso las animaciones se hacen con la Web Animations API y no con transiciones CSS — una transición no se puede agarrar a mitad de vuelo.
- **Los paneles nacen del botón que los pidió.** El punto de la pulsación se guarda en el `pointerdown` y se convierte en el `transform-origin` del modal, así que la relación entre lo que oprimiste y lo que apareció no hay que explicarla. Y entra y sale por el mismo camino: lo que desaparece por un lado vuelve por ese lado.
- **La barra superior y la lateral son materiales translúcidos**, con el contenido pasando por debajo, no franjas opacas. Donde el contenido cruza la barra, el material se apaga de forma progresiva en vez de cortarse con una línea de 1px.
- **El tracking depende del tamaño.** No hay un `letter-spacing` bueno para todos: los títulos grandes van apretados y el texto pequeño va suelto. El interlineado va al revés.
- **Tres preferencias del sistema, no una.** `prefers-reduced-motion` cambia el desplazamiento por un cruce de opacidad pero **conserva la respuesta a la pulsación** — es información, no adorno. `prefers-reduced-transparency` vuelve sólidos los materiales. `prefers-contrast` sube el contraste y define los bordes.
- **El tamaño de letra respeta el navegador.** Los cuerpos de texto van en `rem`, así que la preferencia de tamaño de letra del sistema sí hace algo. Las medidas de caja siguen en px: con letra muy grande la interfaz se aprieta, no se rompe. Los documentos imprimibles se quedan en px a propósito — una propuesta tiene que salir siempre con la misma paginación.

## Cerrar sin imprimir nada

Propuestas, contratos y facturas tienen **enlace propio**. El cliente lo abre en el teléfono, lo lee y lo acepta ahí mismo.

- **Propuesta** — botón *Aceptar*. Al aceptar, la oportunidad sube a negociación y se detiene su secuencia de seguimiento.
- **Contrato** — botón *Firmar*. Se guarda quién firmó, con qué correo, desde qué IP, en qué momento y la huella SHA-256 del texto exacto que aceptó. Es el paquete de evidencia que pide la ley ESIGN/UETA para una firma electrónica simple. No reemplaza a un notario ni a una firma digital certificada.
- **Factura** — botón de pago con tarjeta, más los datos de transferencia como alternativa.

Cada enlace registra las aperturas. Saber que la propuesta se abrió tres veces ayer cambia por completo el mensaje de seguimiento; saber que no se ha abierto en 48 horas te dice que el problema es el mensaje con el que la mandaste, no el documento.

**Para que el cliente pueda abrirlos** el servidor tiene que ser alcanzable desde internet:

```bash
cloudflared tunnel --url http://localhost:4180
```

Pega la dirección que devuelve en **Ajustes → Enlaces públicos**. Sin eso, los enlaces apuntan a tu computador y solo funcionan ahí.

## Cobro con tarjeta

Los enlaces de pago se crean en Stripe (Payment Links), Wise o Payoneer y se pegan en **Ajustes → Cobro con tarjeta**. No hay integración por API a propósito: un enlace pegado cobra igual de rápido, no exige guardar claves en el vault y te deja cambiar de proveedor sin tocar código.

Una factura toma su enlace propio si lo tiene; si no, el del catálogo que coincida en moneda y monto. Un enlace con monto cero sirve como enlace general de esa moneda.

## Envío de mensajes

El sistema manda de tres formas, en orden de automatismo:

| Vía | Cuándo | Qué hace falta |
|---|---|---|
| **SMTP** | Los correos salen solos | Configurar el servidor en Ajustes y arrancar con `AGENCY_SMTP_PASS` |
| **Agente `outbox-sender`** | No quieres guardar una contraseña | La conexión de Gmail de Claude |
| **Enlace de un clic** | WhatsApp, siempre | Nada — abre el chat con el mensaje escrito |

Con Gmail: activa la verificación en dos pasos, crea una **contraseña de aplicación** y arranca así:

```bash
set AGENCY_SMTP_PASS=abcd efgh ijkl mnop
npm start
```

La contraseña nunca se guarda en `agency-os.json` — ese archivo vive en el vault y el vault se sincroniza.

WhatsApp no tiene forma legítima de enviarse desde un script sin la API de negocios. El enlace `wa.me` es el sustituto honesto: no es automático, pero convierte tres minutos de copiar y pegar en un clic.

La bandeja de salida vive como archivos markdown en `Agency\Outbox\`, igual que la cola de producción: se puede revisar, corregir y despachar aunque el servidor esté apagado, y queda como registro de lo que se dijo y cuándo.

## Quién puede entrar

El servidor escucha en toda la red, así que:

- **Desde este computador** entras sin nada. La regla exige que el socket sea realmente loopback *y* que la petición no traiga rastro de proxy — porque cuando publicas con un túnel, `cloudflared` corre aquí mismo y todo el tráfico de internet llegaría disfrazado de local.
- **Desde otro dispositivo** hace falta la llave (Ajustes → Enlaces públicos), en la cabecera `x-agency-key` o como `?k=LLAVE`.
- **Público siempre**: el formulario de captación (`/aplicar`) y los documentos compartidos (`/d/...`). Nada más, y con límite de peticiones.

## Cómo se conecta con los agentes de producción

Cuatro skills de Claude Code alimentan el módulo de Producción:

| Agente | Qué produce | Dónde escribe |
|---|---|---|
| `outbound-prospector` | Listas de prospectos investigados en la Biblioteca de Anuncios, con la observación específica de cada uno y el guion de su auditoría | El lote se pega en **Prospección** |
| `outbox-sender` | Despacha los correos pendientes por Gmail y avanza la secuencia | `Agency\Outbox\` |
| `enhanced-ads-suite` | 5 variantes de copy con ángulos diferenciados, guion de video ad de 15-30s, rúbrica de calificación de leads | `AdsSuite\` |
| `personal-brand-video` | Lote semanal de videos: 3 ganchos alternativos, guion por segundos, shot list, texto en pantalla, notas de edición y copy de publicación | `Video\` |

```
Agency OS → Briefs\<Marca>.md  ─(lo leen los agentes)→  AdsSuite\  ·  Video\
                                                              │
                            Producción → "Importar del vault" ─┘
```

Ninguno de los dos pregunta lo que ya está en el brief. Al importar, cada `### Variante N - Ángulo: X` entra como pieza de copy (estado *borrador*) y cada `### Video N - título` como pieza de video (estado *guion*), asignadas automáticamente al compromiso que les corresponde. Reimportar no duplica.

**El formato es un contrato:** si cambian el frontmatter (`client`, `date`, `platform`) o los encabezados de variante/video, la importación deja de reconocer las notas. Está documentado dentro de cada skill.

Los agentes escriben y planean; **no graban, no editan y no publican nada**.

## Dónde está la frontera de la automatización

Una página web no puede hacer que Claude escriba. Por eso el trabajo está partido en dos:

| | Quién lo hace | Cómo se dispara |
|---|---|---|
| Abrir meses, facturar, importar, armar reportes | El servidor, con tus propios datos | Botón en **Automatizaciones** — instantáneo |
| Copy, guiones, ángulos, calificación de leads | Los agentes, dentro de Claude Code | Botón que **encola** el trabajo en `Agency\Cola\` |

La cola son archivos markdown, no filas en una base de datos: el skill `production-queue` la procesa aunque el servidor esté apagado. Cada nota lleva la instrucción exacta y el cliente; al terminar, el agente marca `estado: hecho` y escribe la ruta del resultado.

Para vaciarla, dile a Claude: **"procesa la cola de producción de Agency OS"**. También se puede dejar programada a una hora fija, igual que el digest diario de tareas.

## Pruebas

```bash
npm test
```

Levanta el servidor en el puerto 4199, corre seis archivos —acceso, dinero, reloj, unidades, API e interfaz— y lo apaga. Cerca de 290 verificaciones que cubren los totales y consecutivos de facturación, el secuenciador, la agenda, la deduplicación de prospectos, el alta y el descarte de prospectos, las reglas del reloj, la aceptación de documentos, la regla de acceso, el borrado en cascada y que las 21 vistas pinten sin romperse.

Las pruebas trabajan contra el vault real porque no hay otro entorno. Todo lo que crean va marcado con `ZZTEST` y se borra al final; además, cada escritura del servidor deja copia en `Agency\.respaldos\` (se conservan las últimas 40).

## Imprimir en PDF

En propuestas, contratos y facturas: **Imprimir / PDF** → destino "Guardar como PDF". La hoja sale en formato claro, sin la interfaz.

## Cuidado con los datos

- **Cada escritura deja copia** en `Agency\.respaldos\` (se conservan las últimas 40). Es la única red bajo el archivo donde vive todo el negocio.
- **Lo que entra por la API se valida.** Un precio escrito "3.500.000" o "1,800.50" se entiende; "como quinientos" se rechaza con un error, en vez de convertirse en un `NaN` que se propaga callado hasta el total que firma el cliente.
- **Borrar un cliente con documentos exige confirmación** y arrastra todo lo suyo. La app pide escribir el nombre antes de dejarlo pasar.
- **Dos clientes con el mismo nombre** ya no se pisan el archivo del vault: el más antiguo conserva el nombre limpio y el otro lleva un sufijo.

## Antes de usarlo en serio

1. **Ajustes → Empresa**: razón social, NIT, dirección y quién firma. Sin esto, los documentos salen con espacios en blanco.
2. **Ajustes → Cobro**: números de cuenta reales.
3. **Servicios**: revisar precios.
4. **Contratos**: las plantillas son estándar de industria, no asesoría legal. Que un abogado revise el texto una vez antes del primer contrato grande.
5. **Facturación electrónica DIAN**: para clientes que la exijan, este documento debe replicarse en un proveedor tecnológico autorizado. Agency OS controla el consecutivo y la cartera, no reemplaza al proveedor.
