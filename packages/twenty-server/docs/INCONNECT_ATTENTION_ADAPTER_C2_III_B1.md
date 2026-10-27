# INCONNECT — C2-III-B1: inbound WhatsApp

> Lectura vigente, 2026-10-27: este documento conserva la entrega de su fase.
> Las etiquetas de revisión pendiente y recomendaciones de siguiente fase son
> históricas; consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para los
> checkpoints posteriores hasta R4 y [guardrails](INCONNECT_ATTENTION_GUARDRAILS.md).
> Sus contratos técnicos y gates físicos permanecen; ninguna fase ni instalación
> se autoriza por esta reconciliación documental.

Fecha: 2026-10-22. **Entrega limitada SOURCE-ONLY: adaptador privado inerte y
preflight documentado. Integración operativa detenida; pendiente de revisión
independiente. No se declara la fase aceptada ni la ruta runtime completada.**

## 1. Preflight y decisión de alcance

Inspección Git exclusivamente read-only: rama
`feature/inconnect-lead-management`, HEAD
`9454c3f0cf1c9bcecf0604d6148c58008035bd04`, árbol limpio y staging vacío.
HEAD contiene `feat(inconnect): add source-only transactional attention writer`;
sus antecedentes inmediatos son C2-II `fea20f6015`, C2-I-B `f143422f59` y
C2-I-A `bf25dcd36e`. Las aceptaciones independientes comunicadas por el usuario
prevalecen sobre las etiquetas históricas de los documentos anteriores.

Se contrastaron AGENTS.md, C2 y documentos I-A/I-B/II/III-A, dominio/C1,
reader/writer, entidades, Fast Command 1792540800000 y guards con el ingreso,
routing, procesamiento, Receipt, media, Outbox, jobs y F13 reales. No se aplica
un workflow syncable ni se consulta Enterprise RLS.

El preflight **no habilita conectar el worker existente**. Se usa la alternativa
expresamente permitida en el alcance: conservar los servicios operativos y
entregar una colaboración inerte que compone el writer real con autenticación
real cuando la petición firmada sigue disponible y el agregado ya está preparado.
No es otro procesador de inbox, un mecanismo de activación ni un reemplazo de
la ruta productiva.

### Límites reproducibles que impiden declarar la integración completa

1. **Conversation nueva sin lifecycle autorizado.** El ingreso puede crear una
   Conversation, pero no crea Epoch. Bajo ENABLED, su primer INSERT Message sin
   epoch es rechazado por `im_at_message_guard`; con un UUID inventado tampoco
   satisface Epoch READY/FKs/ciclo. C2 §10.1 permite preparar una Conversation
   nueva junto al primer hecho, pero requiere implementar ese lifecycle. Esta
   tarea excluye bootstrap/activación y el adaptador no los implementa. No se
   elimina el guard, adopta un epoch ajeno ni usa Message sintético.
2. **Entrega durable de admisión al worker sin implementar.** El ingreso real
   verifica la firma antes de crear Receipt. Sin embargo, Receipt conserva
   hash/normalización, no rawBody, firma ni URL firmada; el job recibe sólo
   receiptId. Después de un reinicio no se puede reconstruir la petición para
   este verificador. Esto no prueba que los Receipts actuales sean falsos: su
   creación normal sí procede del ingreso verificado. Falta implementar y
   revisar cómo transferir esa autoridad al nuevo caller de atención durante
   recuperación, sin sustituirla por un booleano de confianza. No se añade
   subrepticiamente un nuevo contrato de almacenamiento/autenticación.
3. **Consumidor de atención pendiente.** `toRealtimeEventType()` no reconoce
   CONVERSATION_ATTENTION_CHANGED. `publishEvent()` termina ese evento como
   FAILED/UNSUPPORTED_OUTBOX_EVENT. Emitirlo por la ruta activa sería una
   integración incompleta. Su adaptación no se mezcla aquí con otros writers.
4. **Corte de escritores y aceptación física pendientes.** Send, callbacks,
   Dispatch y Pending booleano siguen sin protocolo integrado. El booleano tiene
   un no-op que un trigger no puede rechazar. Un gate ENABLED no demuestra
   despliegue/drenaje, esquema íntegro ni aceptación PostgreSQL. Este trabajo
   no introduce un flag, endpoint o procedimiento alternativo para habilitarlo.

No se identificó necesidad de modificar un contrato aceptado del ledger. Son
fronteras de composición/rollout pendientes, no un veredicto de defecto de C2.
En particular, la recepción durable anterior y un claim corto separado están
permitidos por C2/III-A; su existencia por sí sola no es incompatibilidad.

## 2. Topología actual: orden observado antes de cambios

Los servicios de esta sección **no se modifican**.

```text
Controller público / Twilio inbound
  -> parámetros y rawBody del servidor + URL efectiva + x-twilio-signature
  -> registry TWILIO/WHATSAPP
  -> routing por inboundRoutingKey: exactamente una conexión ENABLED
  -> descifrado de credenciales en su workspace
  -> validateWebhookSignature real
  -> normalización + SHA-256 del rawBody
  -> transacción recepción: INSERT Receipt orIgnore + SELECT + payloadHash igual
  -> COMMIT recepción -> enqueue recuperable -> HTTP 200

Worker processReceipt(receiptId)
  -> transacción claim: Receipt UPDATE lock + lease/attemptCount -> COMMIT
  -> transacción causal actual:
       Receipt UPDATE lock + comprobar lease
       -> buscar conexión activa del workspace
       -> validar normalizedMetadata
       -> Conversation INSERT orIgnore por identidad conexión/address
       -> SELECT Conversation ganadora por workspace/conexión/address
       -> Message INSERT orIgnore por conexión/providerMessageId
       -> SELECT Message inbound por workspace/conexión/providerMessageId
       -> si duplicado, no crear adjuntos ni otra Outbox
       -> si nuevo: Attachment por ordinal + UPDATE Conversation.lastInboundAt
       -> Outbox INBOUND_MESSAGE_RECEIVED
       -> Receipt PROCESSED, quitar lease -> COMMIT
  -> requestPublication + requestPendingAttachmentsForProviderMessage

Outbox publisher, después del inbound durable
  -> F13 attemptForInboundMessage -> transacción CRM/link separada
  -> hint MESSAGE_CREATED -> reautorizar cada destinatario -> Redis
```

La transacción causal no declara READ COMMITTED explícitamente ni toma
Configuration/Conversation antes de Receipt/Message. El UPDATE de Conversation
adquiere su lock implícito tarde. Con DDL C2 instalado el guard de INSERT Message
puede tomar Configuration/Conversation, pero después del Receipt: no corrige la
inversión del caller. No es válido añadir el writer al final de esa secuencia.

El ACK actual acredita **recepción durable del Receipt**, no Message/atención
terminados. Si enqueue falla, recovery reintenta. No se cambia ese contrato ni
se afirma un único commit desde HTTP hasta la proyección completa. En el diseño
futuro, el commit único requerido corresponde a la unidad causal de procesamiento,
no pretende deshacer commits anteriores de recepción/claim de transporte.

### Media y contenido

Se inspeccionaron normalización Twilio, Attachment, ingestion/recovery y FileStorage.
Texto/emoji permanecen TEXT; WEBP es STICKER en este proveedor; LOCATION guarda
contenido estructurado sin File/Attachment; CONTACT admite vCard. Message
conserva providerMessageId, tipo, cuerpo, metadata y tiempos de recepción.

El inbound persiste sólo la intención de adjunto PENDING o su fallo de metadata/
MIME. Después del commit, ingestion reclama Attachment, descarga mediante el
proveedor, valida bytes/MIME/tamaño, escribe FileEntity/FileStorage con identidad
determinista y finaliza Attachment + MEDIA_ATTACHMENT_UPDATED en otra unidad.
No hay que mover esas descargas al procesamiento transaccional de atención.
Outbound Upload staging tampoco se mueve ni modifica. Los riesgos de archivos
huérfanos y ausencia de backfill/GC conservan su contrato existente.

## 3. Secuencia causal propuesta y locks

Éste es el protocolo de composición pendiente, **no un nuevo servicio registrado**:

1. Ingreso autentica firma y resuelve routing backend. Conservar una frontera de
   autenticación recuperable y verificable para el procesamiento futuro.
2. Terminar cualquier claim corto de transporte. Sus locks no pueden sobrevivir
   al comienzo de la unidad causal. Prelecturas sólo localizan identidades.
3. Usar un QueryRunner primario exclusivo, READ COMMITTED, profundidad 1, con
   presupuestos/sesión compatibles con C2-II. El caller controla todo su ciclo.
4. Configuration FOR SHARE; comprobar instalación/modo/versión antes de referir
   columnas nuevas. Rechazar preparación/suspensión y errores, sin fallback.
5. Resolver identidad completa de Conversation; bloquear la existente FOR UPDATE
   y releer. Para una nueva, INSERT por la UNIQUE conexión/address, leer la fila
   ganadora en una sentencia nueva y bloquearla por C antes de cualquier Message.
   Un SELECT vacío no bloquea una identidad inexistente. Validar siempre workspace,
   conexión y address de la ganadora; no retargetear un Message de otra Conversation.
6. Resolver/validar Epoch READY y puntero actual. Para nueva Conversation falta
   el lifecycle de baseline/puntero en la misma unidad; detener ese caso hasta
   implementarlo bajo autorización. Nunca bootstrap de historia implícito.
7. WebhookReceipt FOR UPDATE; volver a verificar scope, identidad y lease vigente.
   Puede ser una recepción durable anterior. PROCESSED es recuperación/replay,
   no permiso para crear de nuevo el Message o renovar atención.
8. Resolver Message durable por identidad de proveedor. Si nuevo, INSERT con
   epoch de origen y adjuntos causales; si existe, validar C, dirección, provider
   ID y epoch, sin reconstruir ni actualizar el origen NULL histórico.
9. Invocar el adaptador inerte/reader/writer sobre ese mismo runner. Deben haber
   existido los locks anteriores antes del INSERT Message. La admisión es de
   lectura/autenticación; no crea Message, Epoch ni otra transacción.
10. Writer: C2-II post-lock -> C1/reducer -> admisión -> comprobación causal ->
    Effect -> Audit -> AttentionReceipt -> Conversation/Outbox si cambió atención.
    Forzar constraints relevantes IMMEDIATE después de cerrar sus ciclos.
11. Registrar el Outbox inbound existente y finalizar Receipt con verificación
    de posesión/affected. Ante cualquier fallo lanzar y abortar toda la unidad.
12. COMMIT único causal. Sólo después pedir publicación/media; F13 permanece
    detrás de INBOUND_MESSAGE_RECEIVED. Un PREPARED no es un ACK durable.

Orden anterior: **Receipt → inserciones Conversation/Message → UPDATE Conversation**.
Orden exigido: **Configuration SHARE → Conversation UPDATE → Epoch validado →
Receipt UPDATE → Message UPDATE/INSERT → DispatchAttempt si correspondiera → ledger**.
Inbound no usa DispatchAttempt. No se modifica Dispatch/callbacks para fingir
que ya son compatibles. Se deben revisar también locks implícitos de FKs.

El adaptador no prueba que su caller adquirió correctamente locks antes de
insertar Message. III-A conserva esa precondición; reobtenerlos en C2-II no
repara una inversión previa. La nueva consulta de admisión sólo lee padres;
no toma otro mutex ni reconstruye facts del ledger. La lectura de conexión es
una revalidación dentro de la unidad, no una garantía ya probada de serialización
de revocación/rotación de credenciales frente a commit. Su coordinación futura
también debe revisarse antes de rollout.

## 4. Archivos nuevos y justificación inbound

Directorio privado `src/modules/inconnect-messaging/attention-adapter/inbound/`:

| Archivo | Relación concreta con inbound |
| --- | --- |
| inbound-attention-sql.ts | JOIN parametrizado de padres causales y routing, posterior a los locks comunes |
| admit-signed-inbound.ts | Verificador de formulario firmado, correlación y admisión BACKEND sin actor HUMAN |
| prepare-signed-inbound-attention-write.ts | Deriva evento inbound y compone writer real; lanza ante error para exigir rollback |
| __tests__/inbound-attention.fixtures.ts | Provider Twilio/registry reales; runner con script estricto de SQL/orden/parámetros |
| __tests__/signed-inbound-attention.spec.ts | Composición auténtica del verificador local con C2-II/III-A/C1/reducer |
| __tests__/legacy-inbound.fixtures.ts | Mocks estrictos de dependencias de processReceipt, sin reemplazar sus métodos |
| __tests__/legacy-inbound-boundary.spec.ts | Recorrido de processReceipt real, media/idempotencia/errores/commit |

Se añade además este documento. Total: **7 TypeScript y 1 Markdown nuevos**.
No se editan servicios, módulo, jobs, controller, APIs, frontend, entidades,
comando/guards, contratos aceptados, AGENTS.md, permisos ni Record Access.
No hay barrel público, decorador Nest, provider registrado o caller operativo.

## 5. Frontera de admisión implementada

`prepareSignedInboundAttentionWrite` captura petición, parámetros, scope y causa
antes del primer await. Sólo admite INBOUND_RECEIVED. La colaboración privada:

- Exige formulario URL-encoded. Reconstruye sus parámetros del rawBody y exige
  igualdad con los parámetros recibidos; hash y firma describen el mismo form.
- Liga el pathname de la URL firmada al routingKey del endpoint inbound real;
  no acepta la URL firmada de otra conexión aunque compartan authToken.
- Usa el mismo runner del writer, validando sesión antes y después del JOIN.
- JOIN exige C, epoch actual/origen Message, Receipt/lease, conexión del workspace
  y Message exacto. Requiere routing único, TWILIO/WHATSAPP y conexión ENABLED.
- Descifra las credenciales con SecretEncryptionService en el workspace de la
  fila y usa el `validateWebhookSignature` **real** del proveedor registrado.
  El cast de la marca EncryptedString sigue a la lectura de string; la marca no
  autentica nada: descifrado y verificación real son las comprobaciones efectivas.
- Recalcula SHA-256, normaliza mediante el proveedor real y compara todo el
  normalizedMetadata del Receipt, idempotencyKey, address de Conversation y
  provider ID/tipo/cuerpo/providerMetadata del Message. La normalización de retry
  conserva firstReceivedAt original del Receipt, no el reloj de la reentrega.
- Exige Receipt INBOUND_MESSAGE/PROCESSING, token y vencimiento comprobado en DB.
  El writer revalida y bloquea los padres causales según su contrato aceptado.

La admisión devuelve BACKEND, actor null y referencias derivadas de esa
comprobación. No interpreta payload.workspaceId, payload.actor o Unread como
autoridad. El inbound de proveedor no necesita impersonar un humano ni concede
acceso a contenido/CRM. Las operaciones humanas conservan su autorización
Messaging/Record Access; este componente no las implementa ni evita.

**Límite deliberado:** requiere petición firmada disponible en memoria. No
consume Receipt como prueba autosuficiente ni implementa recuperación del worker.
JSON webhooks y otros endpoints se rechazan en este componente; sus capacidades
legacy no cambian porque no se conecta a la ruta activa. Debe revisarse también
el contrato de URL efectiva del servidor/proxy antes de conectarlo. No hay
autenticación pública nueva, almacenamiento de secretos o capability exportada.

La admisión no certifica persistencia de los Attachments: el caller futuro aún
debe insertarlos y preservar su lifecycle existente junto al Message. Las pruebas
de normalización de media no se presentan como esa composición pendiente.

## 6. Identidades, originales y causas xid8

| Identidad | Derivación |
| --- | --- |
| eventKey | JSON exacto `["whatsapp-inbound-v1", WebhookReceipt.id]` |
| effectKey | C1/domain sin cambios: `["INBOUND", Message.id]` |
| fingerprint | C1/domain sin cambios: `["INBOUND_RECEIVED", Message.id]` |
| Scope | C completo y trackingEpochId contrastados contra origen Message/puntero/Epoch |
| authenticationReference | `["twilio-signature-v1", Receipt.id, SHA256(rawBody)]` |
| correlationReference | `["inbound-cause-v1", Receipt.id, Message.id, providerMessageId]` |

La referencia no contiene teléfono, cuerpo, firma ni credenciales y sólo se
construye después de verificar. Referencia almacenada no permite admitir otro
intento por sí sola. El transporte actual conserva UNIQUE de Receipt por
conexión/kind/idempotencyKey y Message por conexión/providerMessageId.

El wrapper no genera otro eventKey para reintentar. C1 conserva canónico y
original propio de alias separados, consume IGNORED, no reserva claves por
CONFLICT y no incrementa por replay. Inbound nuevo abre/renueva PENDING con
BigInt exacto; el pendingAt original se conserva por el writer/guard existente.
No hay otro reducer ni lógica de cierre desde inbound.

Las pruebas de aliases proporcionan un canónico histórico compatible para
comprobar recuperación de originales. **No significan que el transporte Twilio
actual pueda crear un segundo WebhookReceipt para el mismo providerMessageId**:
su UNIQUE lo impide. No se modifica esa identidad para fabricar aliases.

Message nuevo debe existir en esta unidad antes de reader/writer. Las FKs de
Effect a Message/Epoch son inmediatas; Effect→canónico y Conversation→Epoch
son ciclos diferidos que deben cerrarse. III-A comprueba
`core.im_at_own_write(attentionCreatedTransactionId)` de Message para efecto
inbound nuevo. PostgreSQL genera el xid8 completo por trigger. El adaptador no
escribe marcadores, no usa xmin, low32, Number/int64 ni un xid elegido por TS.
Un Message histórico NULL no adquiere un nuevo epoch mediante UPDATE.

## 7. Gates y compatibilidad

| Instalación | Ruta activa conservada | Adaptador inerte, si se invoca en pruebas |
| --- | --- | --- |
| A: pre-DDL | Legacy sin consultar atención; columnas ORM nuevas siguen dormantes | C2-II detecta columnas vía to_jsonb de Configuration y rechaza SCHEMA_NOT_INSTALLED antes de tablas nuevas |
| B: DDL + DISABLED | Legacy autorizado, sin Epoch requerido | TRACKING_DISABLED, sin lookup de tablas nuevas |
| C: PREPARING/SUSPENDED | No se introduce transición ni fallback nuevo; fences de agregado preparado dependen del esquema instalado | Rechazo temprano; no permiso para pasar al legacy |
| D: ENABLED + READY | No hay caller operativo de esta entrega; no está listo para activación | Sólo composición con mocks y precondiciones documentadas |

El wrapper no tiene retorno LEGACY ni catch que active otra ruta. Todo error del
reader/writer/admisión termina con excepción. Instalación parcial no produce
permiso legacy. `installed` del lector no certifica constraints físicos: se
requiere aceptación C2-IV y rollout posterior autorizado, además del gate.

## 8. Outbox, F13, errores y commit

El writer prepara CONVERSATION_ATTENTION_CHANGED sólo por attentionChanged, en
la tabla Outbox existente, aggregate CONVERSATION, payload `{ conversationId }`
y la clave `core.im_at_outbox_key(S,effectKey)` aprobada. No crea otro Outbox ni
publica. Audit precede UPDATE y su Outbox queda en la misma unidad.

El consumidor actual reconoce CONVERSATION_PENDING_CHANGED/CONVERSATION_LINKED
como CONVERSATION_UPDATED, pero **todavía no el tipo nuevo**. Antes de conectar
emisión debe adaptarse su allowlist, lookup scoped del aggregate y fanout con
reautorización de cada destinatario. No basta renombrar el evento del writer.
Este bloqueo permanece explícito y no se registra un consumidor alternativo.

F13 permanece detrás de INBOUND_MESSAGE_RECEIVED: UNIQUE exacto puede linkear;
NO_MATCH sólo crea con autoridad/principal/Owner/readiness vigentes; AMBIGUOUS
no crea/enlaza; ya linked no relinkea. Conserva su advisory lock, Conversation
lock y transacción CRM separada. Nada llama Create CRM durante el inbound ni
agrega permisos de clasificación de Leads.

Todo `ok:false` del writer se convierte en InboundAttentionPreparationFailure
con callerMustRollback y error seguro; una excepción también rechaza la promesa.
CONFLICT se rechaza como unidad causal, sin permitir aceptar un Message huérfano.
El caller no debe capturar la excepción y devolver normalmente desde una callback
transaction. El wrapper no abre/conecta/confirma/revierte/libera runners.

PREPARED conserva su nombre y significado; no es éxito durable. Finalización de
Receipt, Outbox inbound y COMMIT siguen siendo obligaciones del caller pendiente.
Errores después de Message/Audit/Outbox no autorizan confirmar los statements
anteriores. Las pruebas comprueban rechazo y cese, no que PostgreSQL los revirtió.

No hay retry operativo nuevo. Commit ambiguo debe reconciliar por Receipt y
Message existentes y las mismas claves en otra unidad antes de responder éxito.
El servicio legacy conserva su tratamiento actual de fallos/release del Receipt;
la simulación de un commit rechazado no prueba reconciliación de un commit que
sí llegó al servidor. Ésta sigue pendiente para la composición nueva.

## 9. Validaciones y matriz de alcance

Herramientas exclusivamente de fuente, con Node Linux v24.16.0. HMAC/verificador
Twilio se ejecutan localmente sin SDK de red, cuenta ni llamada a Twilio. Se usan
el registry, proveedor, reader, writer, C1 y reducer reales; los scripts de runner
exigen SQL/parámetros/envelope/orden exactos. Las pruebas legacy invocan
processReceipt real y sus callbacks transaccionales sin espiar/reemplazar
claimReceipt, processInbound ni processStatus.

| Validación final ejecutada | Resultado |
| --- | --- |
| Nueva composición firmada | 1 suite / 49 PASS |
| Nuevo recorrido legacy real | 1 suite / 17 PASS |
| Regresión C2-III-A | 4 suites / 95 PASS |
| Regresión C2-II | 3 suites / 101 PASS |
| Regresión C2-I-A | 3 suites / 126 PASS |
| Regresión C1 / reducer | 2 / 63 y 2 / 78 PASS |
| Schema / guards / xid8 | 3 suites / 67 PASS |
| Registro / persistencia / work-state | 3 suites / 31 PASS |
| Otras regresiones Messaging seleccionadas | 8 suites / 109 PASS |
| Total conjunto final | **30 suites / 736 PASS**, cero fallos/omisiones |
| Typecheck completo twenty-server | tsgo --noEmit --incremental false: exit 0 |
| Typed lint explícito | 7 TypeScript, cero errores/warnings |
| Diff lint Nx | exit 0, formato de 493 archivos según exclusiones |
| Formato explícito / whitespace | 7 TypeScript; tracked y ocho nuevos comprobados |

Mocks no prueban instalación SQL, aislamiento, lock/rollback físico, entrega ni
publicación real. No se ejecutaron pruebas PostgreSQL ni se llamó UP/DOWN.
Las primeras iteraciones corrigieron fixtures: el gate compartido debía copiarse
antes de simular pre-DDL, y el script de un rechazo anterior al JOIN debía cortar
en ese punto. Typecheck detectó la marca EncryptedString exigida por descifrado;
se hace explícita tras comprobar el string, sin atribuirle autenticidad. Todas
las validaciones finales se ejecutaron después de esas correcciones.

| Requisito solicitado | Evidencia de esta entrega / frontera restante |
| --- | --- |
| 1–3 firmado, firma inválida, conexión ajena | Verificador real + rows/scope/routing negativos; regresiones de ingress/routing |
| 4–5 nueva/existente | processReceipt legacy real; nueva tracked detenida por lifecycle faltante |
| 6–9 duplicado/alias/renew/reopen | Writer real, originales separados y revisión grande; ruta legacy duplicada |
| 10–12 reader/writer/admit | Gates/errores/causalidad y fallo admisión; regresiones completas C2-II/III-A |
| 13–15 fallo tras Message/Audit/Outbox | Callbacks legacy rechazan tras writes; writer real falla por statement y exige rollback |
| 16 commit | Simulación de rechazo de commit legacy; commit/reconciliación nueva y física pendientes |
| 17 efectos post-commit | processReceipt real: publicación/media después del commit; adaptador sin efectos externos |
| 18 media | Todos los tipos legacy; firma/normalización real para image/audio/contact/location; ingestion existente regresada |
| 19 Receipt idempotente | Duplicado/PROCESSED en ruta real y regresiones Receipt |
| 20 F13 | Regresiones auto-link y publisher; sin mover CRM al inbound |
| 21 scope | JOIN exige S/Receipt/Message; consulta sin fila niega, regresiones C2 cruzadas |
| 22 xid8 | Mismos guards/causalidad writer; regresión schema/transaction-identity; sin ejecución de triggers |
| 23 revisión/audit/Outbox | Orden real writer y fallos intermedios; ninguna escritura propia de revisión |
| 24–27 gates/legacy/fallback | Legacy intacto, checks ORM previos regresados; componente corta antes de tablas nuevas y jamás vuelve a legacy |
| 28–30 locks/runner/rollback | Orden emitido, espera de promesa en lock, un runner y cero lifecycle propio; caller operativo pendiente |
| 31–32 decimal/originales | Cadena superior a int64 y canónico/alias/replay separados con writer real |
| Dos inbound concurrentes | Regresiones de historias/reader y espera controlada; no hay nuevo caller activo ni prueba física de serialización |
| Reintentos/proveedor después de persistencia | Regresiones Receipt/media y error post-commit legacy; no nueva reconciliación operativa |

### Comandos de fuente

Desde `packages/twenty-server`, con
`PATH=/home/alberto/.nvm/versions/node/v24.16.0/bin:$PATH`:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-iii-b1-jest-cache src/modules/inconnect-messaging/attention-adapter/inbound
../../node_modules/.bin/tsgo --noEmit --incremental false
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json src/modules/inconnect-messaging/attention-adapter/inbound
```

La regresión conjunta selecciona attention-adapter/attention-domain completos,
las suites Messaging de ingress, routing, receipt, processing, Twilio, media,
Outbox, inbound-auto-link, persistencia y work-state, además de schema, guards,
transaction-identity y registro del comando. Sólo `.spec.ts` de fuente elegidos
explícitamente: ninguna suite `.postgres.spec.ts` ni integración con reset.
Su JSON está en `/tmp/c2-iii-b1-jest-results.json` y logs en
`/tmp/c2-iii-b1-{inbound,regressions,typecheck,typed-lint,diff-lint}.log`.

Desde raíz se ejecutan oxfmt explícito del directorio nuevo, whitespace tracked
y no-index de nuevos, búsquedas de inactividad y Git read-only. Diff lint:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-iii-b1-nx-data NX_CACHE_DIRECTORY=/tmp/c2-iii-b1-nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
```

El rango main...HEAD de ese target excluye archivos nuevos: sus siete TypeScript
tienen typed lint/formato explícitos. Markdown está excluido de oxfmt y se revisa
por estructura/whitespace sin cambiar esa configuración.

## 10. Obligaciones posteriores y revisión independiente

Antes de completar la conexión inbound: resolver admisión recuperable, nueva
Conversation/lifecycle, composición de locks anterior al Message, único commit
causal y sus fallos/ambigüedad, consumidor compatible y pruebas del caller real.
No se presenta este componente aislado como cumplimiento de esos puntos.

C2-III-B2 conserva el contrato manual de intención/revisión, autorización humana
y rechazo del booleano antes del no-op. C2-III-C conserva Send/Dispatch/callbacks,
cobertura congelada, procedencia, admisión outbound y locks Message→Attempt.
No se inicia ninguna de esas fases automáticamente.

C2-IV requiere autorización e aislamiento físicos aceptados: instalación real,
driver/envelopes, SQL/constraints/FKs/guards/xid8, locks con dos sesiones y nuevas
Conversations concurrentes, revocación, commit/rollback/caídas y recuperación
ambigua. Preparar/desplegar/drain/bootstrap/activar necesita autorización posterior.
No se ejecuta PostgreSQL, Fast Command, migración/generador, setup/reset, servidor,
worker, Redis ni proveedor. PG0, PG1, Stage C5 y exact-upgrade siguen bloqueados.

Se solicita revisión independiente de **esta entrega inerte y del preflight**,
especialmente URL/routing/firma/hash, causalidad de padres, límites del caller,
originales, rechazo sin fallback y alcance pendiente. No se solicita ni presume
aceptación operativa. Sin commit y sin habilitar tracking.

## 11. Estado final Git y cierre

Misma rama y HEAD del preflight. **Ocho archivos untracked, cero modificaciones
tracked y staging vacío.** `git diff --stat` y `git diff --cached --stat` vacíos:
los nuevos se incluyen en el inventario/inspección no-index, sin añadirlos al
índice. Whitespace se comprueba también mediante
`git diff --no-index --check /dev/null <archivo>` para cada nuevo.
La búsqueda de referencias dentro de Messaging no encuentra callers fuera del
directorio privado nuevo. Los servicios activos y las fuentes aceptadas se
conservan intactos. Git sólo se utilizó en lectura; no se hace commit, no se
habilita tracking ni se continúa a B2/C.
