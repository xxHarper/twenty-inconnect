# INCONNECT — C2-III-B1-R1: procedencia durable inbound y URL/proxy

Fecha: 2026-10-22. **SOURCE-ONLY — preflight y decisión de diseño; admisión
recuperable BLOQUEADA por falta de procedencia acreditable.** No se declara
C2-III-B1 completada. La propuesta de almacenamiento/ingreso de este documento
requiere autorización y revisión posteriores; no se implementa ni activa.

## 1. Resultado y base comprobada

Git exclusivamente read-only: rama `feature/inconnect-lead-management`, HEAD
`2013c098f36b5edb57a47b70f91cea159df3a133`, árbol inicialmente limpio, staging
vacío. HEAD registra exactamente los ocho archivos del checkpoint inicial B1:
`feat(inconnect): add inert signed inbound attention adapter and preflight`.
Los padres incluyen III-A `9454c3f0cf`, II `fea20f6015`, I-B `f143422f59` e
I-A `bf25dcd36e`. No hay trabajo ajeno que reemplazar.

Se contrastaron AGENTS.md, los seis documentos obligatorios C2/I-A/I-B/II/III-A/
B1, sus implementaciones y el ingreso/worker reales. La revisión anterior sigue
disponible en `/tmp/c2-b1-independent/REVIEW.md`, con el veredicto exacto
**ACCEPTED SOURCE-ONLY — INERT ADAPTER AND PREFLIGHT ONLY**. Sus límites de
procedencia, origen/puerto, duplicados y revocación se reproducen aquí. Las
aceptaciones comunicadas por el usuario prevalecen sobre etiquetas históricas
pendientes; no se reescriben esos documentos.

**Decisión:** A no queda sustentada por las garantías actuales; C no ofrece otro
mecanismo equivalente. Se propone B, atestación mínima versionada junto con una
frontera de emisión restringida y conservación inmutable del hecho admitido.
El cambio necesario alcanza ingreso/persistencia y un contrato durable nuevo,
fuera del alcance autorizado. Por ello **no se añade una función que admita un
Receipt por su mera existencia**, ni una callback que entregue BACKEND sin
evidencia. Sólo se añaden pruebas del bloqueo y este documento.

Esto no demuestra un bypass HTTP público actual: la única llamada operativa
encontrada al persister procede del ingress firmado. Demuestra que esa topología
normal y las restricciones existentes no permiten certificar la procedencia de
una fila arbitraria recuperada después de reiniciar, incluyendo importaciones e
historia. Tampoco se acusa de falsos a todos los Receipts históricos.

## 2. Inventario de productores, mutaciones y herramientas

Las rutas siguientes son relativas a `src/modules/inconnect-messaging/`, salvo
cuando se indica lo contrario. Se buscaron símbolos de la entidad/servicio,
nombre físico y SQL en todo el repositorio; no se inspeccionó Enterprise RLS.
Inventario de referencias en `/tmp/c2-b1-r1-all-references.txt` y
`/tmp/c2-b1-r1-receipt-references.txt`. Es un inventario de fuente, sin consulta
del catálogo, roles, grants, procesos o datos de PostgreSQL.

| Productor/ruta | Validaciones reales y alcance |
| --- | --- |
| `controllers/inconnect-messaging-webhook.controller.ts`, inbound/status/status con Message | Exige rawBody, parámetros string/array de strings; construye URL desde protocol/host/originalUrl. Los tres endpoints convergen en el mismo ingress. Guards públicos no son autenticación Twilio. |
| `services/inconnect-messaging-webhook-ingress.service.ts:acceptTwilioWhatsappWebhook` | Registry TWILIO/WHATSAPP; routing backend; descifra en workspace resuelto; valida firma mediante proveedor/SDK reales; normaliza después; llama persister. Único caller operativo localizado. También puede persistir STATUS_CALLBACK o UNSUPPORTED; no todo Receipt es inbound admisible. |
| `services/inconnect-messaging-webhook-receipt.service.ts:persistAndRequestProcessing` | Método público del provider Nest. Recibe workspace/conexión/hecho normalizado/rawBody/fecha del caller. Calcula SHA-256, INSERT orIgnore, busca conexión/kind/key y compara hash. No recibe ni comprueba firma, URL, autenticador, normalizador/versiones o correspondencia rawBody↔hecho. Una invocación directa puede escribir la misma proyección sin autenticación. No hay endpoint público para ello. |
| Repository/EntityManager/QueryBuilder de `WebhookReceiptEntity` | La entidad se registra en TypeOrmModule del módulo y puede obtenerse desde DataSource/manager. No tiene campos de procedencia, flags de inmutabilidad ni un insert guard de autenticación. No se encontró otro productor de negocio explícito; eso no prohíbe un insert interno/raw equivalente. |
| Tests de Receipt/processing y fixtures B1 | Construyen filas sintéticas, invocan persister sin firma y simulan repositorios. No son datos productivos ni evidencia de autenticación. FakeProvider no está registrado automáticamente y no fue encontrado como productor operativo de Receipt. |
| `src/database/commands/workspace-export/workspace-export.service.ts` | Enumera metadata core con workspaceId y produce SQL COPY/INSERT de filas. WebhookReceipt es elegible; el archivo exportado puede representar una fila equivalente al restaurarlo. Exportar no inserta ni prueba una importación ejecutada. No se encontró un importador específico que vuelva a autenticar estos Receipts. Restauración/SQL administrativo no dejan en la fila una distinción de procedencia. No se ejecutó export/import. |
| Fast transport spine `1788982508902` y webhook projection `1789040000000` | Fuentes DDL/índices, sin emisión de una atestación. Las pruebas de comandos existentes usan mocks; no se ejecutó UP/DOWN. |
| Slow webhook backfill `1789040000001` | Sólo rellena tiempos inbound de Message y lastInboundAt de Conversation y valida un CHECK. No crea ni autentica Receipt; no se ejecutó. |
| C2-I-B `1792540800000` y helpers comprometidos | Añaden integridad de atención y protección limitada de correlación de callbacks. No crean procedencia durable del Receipt. No se modifican. |

| Mutación localizada | Campos que escribe / garantía real |
| --- | --- |
| Persister INSERT | workspaceId, providerConnectionId, eventKind, key, hash, firstReceivedAt, normalizedMetadata y estado inicial/lease/attempt/error/processedAt. Id/createdAt/updatedAt son técnicos. En duplicate no actualiza el original. |
| `claimReceipt` | Transacción corta, Receipt FOR UPDATE; omite PROCESSED/FAILED y lease PROCESSING aún vigente; random lease, cinco minutos, incrementa attemptCount, limpia error, `save(receipt)`. No acredita autenticación. |
| Transacción `processReceipt` | Receipt FOR UPDATE por id/workspace/PROCESSING/token; conexión actual TWILIO/WHATSAPP/ENABLED; parsea metadata con Zod. Finaliza por id/token a PROCESSED, borra lease/error, fecha servidor. No vuelve a verificar firma. |
| `releaseOrFailReceipt` | id/workspace/PROCESSING/token; RECEIVED o FAILED, limpia lease y guarda categoría segura. No altera el hecho intencionalmente. |
| `retryFailedReceipt` | FAILED→RECEIVED por id, limpia lease/error, vuelve a enqueue. Método interno público sin caller operativo adicional localizado; no es aprobación de origen ni API humana nueva. |
| Recovery cron/job | SELECT RECEIVED o PROCESSING con vencimiento <= reloj, lote 100 por firstReceivedAt; sólo enqueue `{receiptId}`. No autentica, bloquea o modifica metadata. |
| Repository/raw SQL/restauración | Las restricciones actuales no hacen inmutables todos los campos sensibles. Debe inventariarse y excluirse de emisión de autoridad futura; no se ejecuta aquí. |

**Inmutabilidad real:** el camino normal no actualiza key/hash/normalización/fecha
original. Eso es disciplina de código, no una restricción general de la fila.
`im_at_webhook_guard` sólo actúa BEFORE UPDATE: protege id/workspace/conexión/kind
cuando existe StatusEvent enlazado a Effect de atención. No cubre INSERT ni
DELETE, ni key/hash/normalizedMetadata/firstReceivedAt, ni el inbound sin ese
enlace. Los marcadores xid8 de Message/StatusEvent/ledger prueban participación
transaccional, no quién autenticó el Receipt. Un hash sin clave tampoco lo prueba.

## 3. Cadena de confianza, recovery y causalidad actuales

```text
HTTP -> routing único/ENABLED -> credenciales workspace -> SDK valida firma
     -> normalización -> transacción INSERT Receipt/igualdad hash -> COMMIT
     -> enqueue receiptId (fallo recuperable) -> ACK de recepción

recovery -> receiptId -> claim corto/COMMIT
         -> transacción Receipt lock -> conexión ENABLED -> parse metadata
         -> Conversation/Message/Attachments/Outbox -> PROCESSED -> COMMIT
         -> publicación/media posteriores
```

La FK existente Receipt `(providerConnectionId, workspaceId)`→ProviderConnection
`(id, workspaceId)` y la UNIQUE conexión/kind/key aportan scope e idempotencia.
No acreditan firma ni pertenencia a Conversation. `processingState` tiene cuatro
valores; CHECK de lease sólo exige nulabilidad pareja, no que PROCESSING implique
lease válido. attemptCount >= 0 no constituye autoridad.

Inbound liga Conversation por workspace/conexión/externalAddressNormalized;
Message por workspace/conexión/providerMessageId/dirección. Las FKs compuestas
Message→Conversation conservan C. No hay FK directa inbound Receipt→Message ni
Receipt→Conversation: hay que contrastar el hecho completo, no sólo el SID.
El worker legacy devuelve sin nueva Outbox si encuentra Message duplicado y no
reconstruye su contenido contra Receipt como lo hace B1 firmado. Ese atajo no
se puede trasladar al caller tracked sin validación adicional.

Recovery conserva id, scope, hash, normalización y estado; no conserva URL,
firma, rawBody o parámetros originales. Enqueue después del commit fallido no
borra la recepción: el cron la reentrega. El job no transporta autenticación y
no debe ampliarse para hacerlo. Tras reinicio no existe una operación inversa
de normalización/hash que recupere la petición firmada.

El worker actual comprueba token/estado bajo lock, pero no incluye vencimiento
en esa segunda lectura ni verifica affected de finalización. Su SELECT de
ProviderConnection no toma lock de revocación. Son diferencias de composición
que el caller futuro debe resolver; no se corrigen dentro de servicios activos.

PROCESSED no se reclama otra vez; recovery ordinario no lo selecciona. Una
reentrega HTTP todavía puede enqueue ese id, conservando el original; el guard
de processReceipt lo descarta. Esto no prueba que ya exista un original de
atención: un PROCESSED legacy puede carecer de epoch/ledger por diseño.

## 4. Comparación A/B/C y bloqueo exacto

| Opción | Evaluación |
| --- | --- |
| A: Receipt como autoridad durable | Evitaría datos nuevos y revalidar tokens antiguos. Requeriría productores exclusivamente verificados, hecho inmutable y evidencia suficiente para incluir historia/importaciones. El persister sin autenticación y la mutabilidad observada impiden dar esas garantías ahora. Ni timestamp de corte, UUID, hash, lease, estado, FK o brand distinguen las dos proyecciones idénticas de la prueba. |
| B: atestación mínima versionada | Permite distinguir recepción emitida bajo un contrato revisado y fijar su normalización/URL, conservando receiptId. Requiere frontera de emisión restringida, emisión atómica y protección de campos, además del almacenamiento versionado. Recomendada como propuesta; un JSON/booleano elegido por caller no la implementa. |
| C: otra garantía existente | Cifrado de credenciales, Outbox, StatusEvent, AttentionAudit/xid8 y referencias firmadas en memoria no son un testigo independiente anterior al primer efecto inbound. No se localizó un mecanismo durable equivalente. Guardar petición en memoria no sobrevive al reinicio. |

**Bloqueo verificable:** desde los datos disponibles, un consumidor no puede
distinguir el Receipt de ingress autenticado de la misma proyección producida
directamente sin firma. Además, no puede saber si su hecho fue modificado o
restaurado. Para levantarlo hay que cambiar quién puede emitir esa prueba y
cómo queda ligada e inmutable en almacenamiento. R1 prohíbe cambiar esas rutas,
entidades y contratos aceptados. No hay colaboración durable segura que
implementar únicamente en el directorio privado con la evidencia actual.

El modelo no pretende resistir a un administrador que deshabilite constraints o
un proceso backend completamente comprometido. Incluso dentro de la frontera
normal de confianza falta el contrato que excluya productores no autenticados e
imports de la autoridad de atención. No se inventa una vulnerabilidad remota
para justificar una clave criptográfica nueva.

## 5. Propuesta mínima B para aprobación separada

**Propuesta de contrato, no DDL ni fuente implementada:** una única columna
nullable de atestación estructurada en el Receipt existente, sin default ni
backfill. Evitar segunda tabla/cola y secretos nuevos salvo evidencia posterior
de necesidad. Nombres físicos definitivos y command nuevo quedan por aprobar.

Contenido mínimo propuesto: versión del contrato de ingreso, versión del
verificador/productor, versión de política de URL/routing y versión del
normalizador, más digest de vinculación del hecho. El digest vincularía una
tupla versionada de receiptId, workspaceId, providerConnectionId, eventKind,
idempotencyKey, payloadHash, firstReceivedAt y normalización íntegra. Su encoding
debe fijarse antes de implementar: JSON canónico de datos, claves de objetos
ordenadas recursivamente, arrays en su orden original, UTF-8 sin normalización
Unicode, timestamps explícitos, rechazo de valores no representables. No es
eventKey/effectKey/fingerprint ni reemplaza sus bytes C1.

Ese digest detecta discrepancias; **no autentica por sí solo**. La garantía nace
de estas obligaciones conjuntas, todas pendientes:

1. Una frontera backend privada recibe la petición real, valida origen/proxy/
   pathname/parámetros y firma con el proveedor real; deriva scope/normalización
   por backend. Ningún caller entrega un hecho y `trusted=true` para emitirla.
2. El mismo paso persistente inserta Receipt y atestación atómicamente después
   de verificar. Refactorizar/restringir el persister genérico: llamarlo sin
   autenticación no puede producir una recepción apta para atención. No basta
   ocultar su export TypeScript.
3. Congelar identidad/scope/kind/key/hash/firstReceivedAt/normalización/atestación
   desde INSERT. Sólo lifecycle de procesamiento, lease, attempts/error y
   processedAt siguen mutables. Prohibir actualización NULL→atestación y
   promoción retroactiva de un duplicate no atestado. Conservación y delete/
   restore deben tener contrato explícito.
4. Auditar y restringir **todos** los escritores efectivos, incluidos SQL,
   restauraciones y herramientas administrativas. La propuesta de una columna
   no impide que un rol con INSERT arbitrario invente la atestación. Hace falta
   demostrar una frontera de escritura exclusiva del emisor, mediante
   restricciones/privilegios revisados y procedimiento de restore que no otorgue
   autoridad al contenido importado. Los grants reales no se han inspeccionado.
   Si la separación requerida no es viable bajo la autoridad actual de DB,
   detener el diseño y evaluar esa necesidad por separado; no añadir MAC por
   defecto ni afirmar que un trigger verifica una firma que nunca recibió.
5. Versiones y formato estrictamente decodificados por el consumidor durable.
   Parser de versión fijada para historia; ninguna actualización del proveedor
   renormaliza silenciosamente un Receipt. Una versión no soportada bloquea.

Una propiedad añadida arbitrariamente a normalizedMetadata no cumple esto:
cambia su contrato, no introduce un emisor exclusivo y el parser legacy Zod
puede descartar extras. El comparador firmado exige la normalización completa.
Se requiere revisión de compatibilidad, no usar un hueco JSON como migración
oculta. La columna propuesta tampoco queda aprobada por este documento.

No guardar authToken, firma Twilio, rawBody, credenciales descifradas ni otro
contenido de cliente. La normalización necesaria ya está en Receipt. No hace
falta retener el token antiguo para recuperar una recepción debidamente atestada.
credentialsVersion existente no prueba que el token histórico verificó nada.

Esto exige autorización de fuentes operativas/persistencia, entidad y **un
command aditivo nuevo**, preservando `1792540800000` y todos sus helpers. Escribir
ese command, ejecutarlo y desplegar son autorizaciones distintas. Antes de
aprobar el esquema debe cerrarse la restricción del emisor del punto 4; agregar
sólo la columna dejaría exactamente el problema de autenticación sin resolver.

## 6. Contrato futuro de admisión recuperable

No existe implementación de este contrato en R1. Una vez acreditada la emisión
durable, una colaboración privada de sólo lectura podrá consumirla en la
frontera `admit` de III-A y devolver BACKEND/actor null. El adaptador firmado
actual se conserva íntegro: ambos derivan el mismo evento, usan C2-II/III-A y
C1/reducer, sin nueva máquina, receiver, cola o semántica idempotente.

| Requisito | Comprobación obligatoria futura |
| --- | --- |
| Runner | Mismo QueryRunner exclusivo/original manager/primario, READ COMMITTED, profundidad 1 y presupuestos C2-II; ninguna conexión/transacción/commit extra. |
| Scope | C y S esperados derivados por backend; coincidencia exacta workspace/conexión/Conversation/epoch. No aceptar UUID aislado o scope del formulario. |
| Recepción | Receipt exacto INBOUND_MESSAGE, atestación válida emitida por frontera aprobada, versión soportada y hecho inmutable concordante. No sintetizar request, firma ni Message. |
| Ownership | Receipt PROCESSING y token actual bajo FOR UPDATE; lease vigente comprobado con reloj DB después de esperar el lock; no RECEIVED/FAILED/PROCESSED como nueva aplicación. |
| Conexión/routing | ProviderConnection del mismo workspace TWILIO/WHATSAPP y actualmente ENABLED; ruta única exacta, política reconocida y revocación serializada según §9. |
| Message/Conversation | Id exacto, C exacto, INBOUND, providerMessageId, tipo/cuerpo/metadata y campos causales contra hecho congelado. Address/waId/tiempos/media según contrato normalizado; coincidencia sólo de SID es insuficiente. |
| Epoch | Message conserva su epoch de origen no nulo, igual al actual READY de esa Conversation; III-A exige creación de Message en la unidad para un efecto nuevo. NULL histórico/otro epoch no se adoptan. |
| Identidad | eventKey = JSON.stringify(['whatsapp-inbound-v1', WebhookReceipt.id]); effectKey/fingerprint v1 intactos desde Message y dominio. |
| Originales | C2-II consulta Receipt y Effect independientemente; replay/alias conservan originales separados de la decisión actual. No sustituir el original por el snapshot vivo. |
| Preparación | Rechazo exige rollback de la unidad causal completa; PREPARED nunca significa COMMITTED/ACK. Finalización y ambos Outbox permanecen en la unidad caller-owned. |

Los SELECT de correlación deben usar parámetros para todas las identidades,
sin SQL dinámico del payload, ni LIMIT que esconda duplicados ni SKIP LOCKED.
Partir del JOIN scoped B1, excluir credenciales del lector durable y añadir sólo
atestación/normalización versionada. C2-II sigue siendo el único lector de facts;
un JOIN vacío niega admisión, nunca demuestra ausencia del ledger.

Orden: Configuration SHARE → Conversation UPDATE → validar Epoch → Receipt
UPDATE → Message → ledger/audit/Outbox. El caller debe respetarlo **antes** de
INSERT Message; reacquirir locks dentro de III-A no repara inversiones previas.
El claim corto termina antes de esa unidad. No se propone cambiar C2-II/III-A.

Al finalizar, exigir UPDATE Receipt con scope/id/PROCESSING/token y affected=1,
comprobación actual del lease y transición atómica a PROCESSED. Mantener Receipt
lock hasta commit: un takeover no puede intercalarse. El vencimiento temporal
puede ocurrir entre el último check y el commit; no prometer que una SELECT
congela el reloj. La política debe fijar vigencia en adquisición/finalización y
la exclusión por lock, y probar carreras reales. El caller aprobado aún falta.

## 7. Historia, duplicados y rechazo

| Recepción | Tratamiento futuro exigido / límite actual |
| --- | --- |
| Anterior al contrato, pendiente | No inferir autenticación por createdAt ni hash. Sin evidencia backend independiente suficiente, no admitir atención. Propuesta C2: drenar legacy antes de ENABLED, bajo autorización de rollout. |
| Anterior al contrato, PROCESSED | Mantener clasificación/origen; no generar Message/Epoch/atención retroactivos. Un replay no es un inbound nuevo. |
| Nueva atestada, pendiente | Admitir sólo tras contrato completo, claim vigente y readiness; el ACK HTTP sigue siendo recepción durable. |
| Sobrevive reinicio / recovery | Volver a leer atestación y hecho inmutables desde primario; no depender de objeto en memoria, token antiguo, rawBody o payload BullMQ. Hoy falta esa prueba durable. |
| Duplicado de Receipt atestado | Conservar id y primer hecho/atestación; no renovar revisión por transporte. Diferente hash: conflicto existente, no overwrite. |
| Duplicado de Receipt no atestado | Una petición nueva válida no demuestra quién produjo ni si cambió el original. No promover la fila; requiere decisión explícita, no backfill implícito. |
| PROCESSED tracked | Reconciliar éxito/commit ambiguo por originales existentes en una unidad backend expresamente diseñada; no fingir PROCESSING ni fabricar lease para satisfacer III-A. No hay ese reconciliador en R1. |
| Conexión deshabilitada/revocada | Conserva recepción histórica; rechazar procesamiento actual. Rehabilitación/retry sólo mediante política revisada, sin ampliar autoridad humana. |
| Origen desconocido, sintético, importado/restaurado sin cadena verificable | No apto para atención. Ni UUID/hash/version suministrada por import lo convierten en autoridad. Restore necesita preservar/acreditar la cadena o excluir estos trabajos. |
| Metadata contradictoria o versión de normalizador desconocida | Error explícito, no renormalización con proveedor actual, no PENDING ni PROCESSED fingido. Revisión/recuperación autorizada. |
| Lease vigente/expirado | Vigente bajo lock puede continuar sólo con las otras pruebas. Expirado exige rollback y nuevo claim por transporte; nunca extenderlo dentro de admit. |

Errores de procedencia/scope/versión/correlación/readiness: fallo cerrado sin
claves ledger nuevas, sin Message artificial y sin caer a legacy desde ENABLED.
Un fallo después de una escritura causal requiere rollback; no basta devolver
null y confirmar el Message. SQLSTATE/timeout/desconexión no son ausencia ni
duplicate. Conservar códigos seguros, sin SQL/payload/secretos en logs.

La futura ruta debe distinguir fallo recuperable de infraestructura/readiness y
evidencia insuficiente que requiere intervención; evitar retry infinito de una
fila no admisible. Puede usar estado/error/recovery existentes mediante un
contrato autorizado, sin segunda cola. R1 no cambia estados del worker legacy
ni declara que éstos ya implementen esa clasificación.

Pre-DDL/DISABLED conservan la ruta actual porque no se conecta código nuevo.
En el caller futuro, detectar instalación/gate antes de referir columnas nuevas;
PREPARING/SUSPENDED/ENABLED incompleto rechazan la unidad. DISABLED no concede
autenticación a ningún Receipt: sólo seleccionaría la ruta legacy autorizada
por el rollout, nunca sería fallback de un error de atención.

## 8. Contrato propuesto de URL pública, proxy y parámetros

**Precondición pendiente de despliegue:** configurar explícitamente el origen
externo autorizado y cómo se preserva el request-target hasta Nest. No se inventa
host productivo, no se modifica TRUST_PROXY y no se reemplaza por SERVER_URL.
Este último es una base general del servidor y puede diferir de la URL de
webhooks; su equivalencia requiere evidencia del despliegue.

El controller actual usa `${request.protocol}://${request.host}${request.originalUrl}`.
`main.ts` aplica TRUST_PROXY y body parser urlencoded extended. Default de
TRUST_PROXY: `loopback, linklocal, uniquelocal`. Los getters de Express instalado
pueden usar el primer X-Forwarded-Proto/Host si confían en el peer; no prueban
por sí solos que el proxy saneó el header. X-Forwarded-Port/Forwarded no son
usados explícitamente por ese controller. Nest no se inició en estas pruebas.

Política propuesta para el nuevo ingreso autenticado (pendiente de implementar):

1. Configuración backend versionada de origen HTTPS externo exacto, sin wildcard,
   userinfo, fragmento, path base implícito o valores obtenidos del payload.
   HTTP de desarrollo requiere excepción explícita aislada; no hereda aprobación
   de producción. Hostname DNS ASCII/IDNA canónico y puerto efectivo explícito
   en la configuración; comparar host de forma canónica, rechazando formas
   ambiguas, trailing dot/Unicode no aprobado y headers múltiples.
2. Puerto omitido y `:443` representan el mismo endpoint HTTPS si así lo fija
   la política; un no estándar sólo si está configurado exactamente. Preservar
   la representación externa real para el SDK. Su tolerancia al quitar puerto
   **no** autoriza `:8443` ni otro puerto.
3. Derivar protocolo/host de TLS directo o del proxy cuya IP/topología se confía
   de forma acotada. El último proxy debe eliminar/reemplazar headers forwarded
   del cliente, validar Host/SNI y bloquear acceso directo a Nest. Rechazar
   cadenas ambiguas/múltiples en la nueva frontera. No activar trust proxy=true
   ni conteo de hops sin verificar todos los caminos posibles.
4. Preservar request-target externo. El pathname debe ser exactamente
   `/webhooks/inconnect-messaging/twilio/whatsapp/{encodeURIComponent(routingKey)}/inbound`
   del routing backend resuelto; no doble decode, dot segments, slash codificado,
   redirecciones o prefijos reescritos sin contrato. Una firma para otro path
   con secreto compartido no elige esta conexión. El adaptador B1 ya contrasta
   pathname con routingKey, pero el ingress directo no lo hace por sí mismo.
5. Propuesta v1 conservadora: endpoint inbound sin query; rechazar query no
   vacía incluso bien firmada. Si un despliegue requiere query, aprobar versión
   que fije nombres/valores/duplicados y representación exacta conservada; no
   ordenar/reencodear ni descartar query al validar firma. El SDK actual tolera
   determinadas equivalencias `+`/`%20`; eso no define la política local.
6. Antes de normalizar, reconstruir formulario desde rawBody y exigir concordancia
   con parser. Propuesta v1: rechazar **todas** las claves duplicadas, iguales o
   distintas, incluso desconocidas, y formas de arrays/nesting de qs. Comparar
   nombres decodificados, de modo que `Body` y `%42ody` sean la misma clave.
   Rechazar encoding inválido UTF-8/percent y variantes ambiguas. Incluir todos
   los campos escalares desconocidos válidos en la validación Twilio; no una
   allowlist que omita campos firmados. No cambiar cuerpo Unicode ni aplicar NFC.
7. Tras estas comprobaciones independientes, usar el SDK real con URL externa
   preservada y parámetros exactos. Sólo entonces normalizar y emitir Receipt/
   atestación. Firma válida para otro hostname sigue denegada por política.
   Si no se puede demostrar origen externo confiable, rechazar emisión de la
   atestación y mantener integración de atención deshabilitada.

La firma Twilio de arrays ordena valores únicos: no certifica orden/multiplicidad.
El normalizador actual toma el primer valor. Las pruebas obtienen **la misma
firma** para Body=[first,second] y Body=[second,first], pero hechos distintos.
No se presenta como exploit contra un webhook escalar normal: muestra por qué
hay que aprobar esa semántica antes de emitir una atestación.

| Fixture `.example.test`, sólo pruebas | Observación actual | Política propuesta |
| --- | --- | --- |
| Origen esperado, HTTPS detrás de proxy confiado | Controller/SDK aceptan | Admitir sólo con despliegue acreditado |
| Peer no confiado + headers forwarded | Express los ignora; firma externa no coincide | Rechazar inconsistencia |
| Host foreign con firma propia válida | Controller/SDK aceptan | Denegar origen |
| Host cambiado sin nueva firma | Firma inválida | Denegar |
| Puerto :8443 con firma sin puerto | SDK acepta | Denegar salvo configuración exacta |
| RoutingKey route-1 con URL firmada route-2 | Ingress directo acepta; B1 firmado rechaza | Denegar antes de emitir |
| Query añadida sin firmar | Firma inválida | Denegar |
| Query firmada `%20` recibida como `+` | SDK acepta equivalencia | Denegar query en v1 |
| Body duplicado distinto/igual | SDK acepta semántica de conjunto | Denegar duplicados en v1 |
| Unicode y form espacio `%20`/`+` | Firma sobre valores decodificados; hash cambia por bytes | Preservar valores; hash sólo vincula recepción |

Referencias primarias consultadas: [Twilio Security](https://www.twilio.com/docs/usage/security#validating-requests)
para firma de URL/parámetros con SDK; [Express detrás de proxies](https://expressjs.com/en/guide/behind-proxies/)
para confianza y saneamiento de forwarded headers. Las tolerancias concretas se
contrastaron con `node_modules/twilio/lib/webhooks/webhooks.js` y los getters de
`node_modules/express/lib/request.js` instalados y pruebas locales; no se infieren
de una versión web distinta. No se contactó la API de Twilio.

## 9. Rotación, revocación y concurrencia

Recepción históricamente autenticada y permiso actual de procesamiento son dos
hechos separados. En la propuesta durable, rotar authToken no invalida una
atestación original; no se descifra ni verifica de nuevo con el token nuevo.
En el adaptador firmado existente sí se usa el token actual, por lo que una
petición antigua puede fallar tras rotación. Se conserva ese componente con su
precondición explícita; no se lo disfraza de recuperación durable.

La entidad sólo modela ENABLED/DISABLED; no existe literal REVOKED. Revocar en
el backend debe reflejarse en estado/configuración reconocidos. Revocar sólo
en Twilio no permite a una SELECT local conocerlo automáticamente; requiere
procedimiento operativo de deshabilitación, sin llamadas de red dentro de admit.
Una conexión sin configuración vigente suficiente debe fallar cerrado; conocer
la recepción histórica no convierte credenciales ausentes o estado corrupto en
readiness. La validación histórica propuesta no requiere descifrar el token viejo.

No se localizó servicio de gestión de ProviderConnection que ya serialice sus
cambios. Routing/worker/send leen lifecycleStatus y credenciales; DDL y tooling
administrativo no constituyen un protocolo de revocación. Una SELECT fresca de
ENABLED prueba lo visible en esa sentencia; no impide DISABLED antes del commit.

**Propuesta de serialización sin invertir el orden C2:** usar el gate existente
MessagingConfiguration como barrera común. Todas las rutas autorizadas de
disable/revoke, cambio de routing/identidad o credenciales deberán tomar primero
Configuration FOR UPDATE y después modificar ProviderConnection. El ingreso/
caller tracked mantiene Configuration FOR SHARE y relee conexión/routing después
de obtenerlo, hasta commit. Un revocador que ganó primero hace que la lectura
nueva rechace; uno que espera sólo puede confirmar después del procesamiento.
No agregar ProviderConnection lock tardío tras Message ni un mutex anterior
al gate. La ruta de revocación no toma Conversation en orden inverso.

Este protocolo requiere inventariar/cambiar todos los productores, incluidos
provisioning y SQL de administración; no está implementado ni probado físicamente.
El gate actual del writer no congela cambios de conexión cuyos escritores no
participan. Un último SELECT antes del commit sin esa barrera tampoco lo resuelve.
Sin la coordinación demostrada, el caller debe mantenerse bloqueado; no afirmar
revocación resuelta por revalidar dos veces. La UNIQUE global routing y sus
cambios bajo el protocolo deben verificarse físicamente, incluido movimiento
entre workspaces/restauración; no hardcodear identidades ni compartir scope.

## 10. Pruebas y propiedades demostradas

Se añaden exactamente tres TypeScript, todos bajo
`src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/`:

- `receipt-origin.fixtures.ts`: signer HMAC local independiente; registry/proveedor,
  routing/ingress/persister reales, sólo repositorios/transacción/cola/descifrado
  y acceso externo simulados. Captura la proyección INSERT real.
- `receipt-origin-preflight.spec.ts`: autenticación, contraejemplo de procedencia,
  serialización/reinicio, recovery, duplicados/historia/PROCESSED, rotación,
  disabled/ambigüedad y errores SQL/timeout sin enqueue.
- `inbound-url-proxy-preflight.spec.ts`: controller y getters Express reales sin
  listen; origen/headers/puertos/routing/query/duplicados/Unicode con SDK real.

Son pruebas de **preflight y límites actuales**, no una colaboración durable
implementada. No se falsean expectativas para declarar resueltos los casos cuyo
resultado seguro requiere el contrato nuevo. Ningún mock prueba procedencia de
una fila PostgreSQL concreta. El almacén del fixture captura valores/orIgnore
para un único evento de prueba; no emula constraints, MVCC, locks, grants,
restore o rollback de PostgreSQL.

| Requisito solicitado | Evidencia de fuente / pendiente |
| --- | --- |
| 1–3 ingress válido/inválido/Receipt autenticado | Nuevas pruebas ejecutan proveedor/registry/routing/ingress/persister reales. Se observa que un Receipt de ese recorrido está precedido por firma válida; no se generaliza a cualquier fila. |
| 4–5 recovery sin rawBody/reinicio | Serialización JSON de datos y nueva instancia de servicios; reenqueue sólo id, sin recuperar autoridad. Admisión durable positiva bloqueada. |
| 6–8 origen desconocido/falsificado/histórico | Contraejemplo de proyecciones indistinguibles y normalización sintética; recovery no promueve origen. Propuesta exige rechazo; no existe nuevo consumidor que ya lo aplique. |
| 9–10 duplicate/PROCESSED | Pruebas nuevas Receipt y regresiones processReceipt real; originales/estado permanecen. |
| 11–12 lease vigente/expirado | B1 firmado y causalidad III-A verifican token/vencimiento; recovery legacy consulta expirados. Durable positivo y takeover físico pendientes. |
| 13–18 scopes/Message/epoch/provider ID/metadata | Regresiones SQL/decode B1/reader/writer; JOIN sin padre deniega, otro origen no se adopta. Mock de JOIN no ejecuta aislamiento SQL real. |
| 19–21 disabled/rotación/ambigüedad | Nuevas pruebas y routing/worker existentes; recovery no verifica actualidad, ingreso sí. Serialización de revocación pendiente. |
| 22–26 host/path/duplicados/query/encoding/Unicode | Nueva suite controller/Express/SDK y arnés previo; observaciones y política propuesta separadas en §8. Rechazo de política nueva aún no implementado. |
| 27 causalidad/originales | Writer/reader/C1/reducer reales; canónico y alias conservan originales propios y decimales exactos. No nuevos IDs semánticos. |
| 28 error SQL/timeout | Errores inyectados en persister y regresiones B1/III-A/II; nunca éxito/ausencia. |
| 29–32 fallback/runner/red/integración | Wrapper firmado sin fallback/segundo runner; fixtures impiden provider/red; fuentes operativas y módulo intactos. No se ha creado un wrapper durable engañoso. |
| 33–35 PREPARED/rollback/pre-DDL/DISABLED | Regresiones B1/III-A/II/schema y legacy; contrato de caller conserva rollback obligatorio y distingue preparación de commit. No claim de aceptación física. |

Resultados finales y comandos se registran tras las validaciones en §12.

## 11. Obligaciones para completar el caller y límites de entrega

Antes de conectar atención al worker:

1. Aprobar e implementar emisión durable exclusiva, esquema/contrato de
   atestación y protección del hecho; probar writers alternativos/import/restore.
2. Aprobar origen/proxy/duplicados y configurar despliegue; adaptar ingreso
   activo bajo autorización separada. Fixtures no acreditan proxy desplegado.
3. Implementar coordinación de lifecycle/routing/revocación con el gate común
   y revisar locks implícitos de FKs; no sólo SELECT de conexión.
4. Implementar colaboración durable privada con las comprobaciones de §6;
   compartir frontera writer y las identidades del firmado, sin duplicar C1.
5. Implementar lifecycle de Conversation nueva/Epoch con baseline servidor y
   READY, ganador por UNIQUE y locks antes de Message. Insertar epoch mediante
   columnas explícitas porque el mapping dormante lo omite en INSERT ordinario.
   Bootstrap de historia sigue siendo operación autorizada separada.
6. Integrar Message/Attachments + atención/ledger/audit/Outbox de atención +
   INBOUND_MESSAGE_RECEIVED + PROCESSED en un commit causal; finalización scoped,
   ownership/affected comprobados. Claim corto separado y recovery/commit ambiguo
   con las mismas identidades; no fake lease o Message para reconciliar.
7. Adaptar consumidor Outbox al hint CONVERSATION_UPDATED con aggregate/scope
   y reautorización por destinatario antes de habilitar emisión operativa.
   Media/publicación y F13 continúan después del commit.
8. Probar caller real y fallos de cada paso, corte legacy y despliegue/drenaje.
   Revisión independiente SOURCE-ONLY y después aceptación física aislada
   autorizada: esquema, grants, FK/guards/xid8, leases/locks/revocación, rollback,
   caídas, unicidades y SQL/envelopes reales. Retención/purga son aparte.

Se mantiene íntegro el adaptador firmado B1, sin imports/callers operativos
nuevos. No se modifican controller, worker, servicios, módulos, flags, Send/
Dispatch/callbacks/Pending, entidades, comando/helpers, C2-I-A/B/II/III-A, C1,
reducer, Outbox publisher, frontend, permisos, Record Access, Teams o AGENTS.md.
Las únicas adiciones son tests y este documento. No se abre PostgreSQL ni se
ejecuta SQL real, migration/generator/Fast Command/setup/reset, infraestructura,
Twilio externo, bootstrap, tracking, deploy o Git write. PG0/PG1/C5/exact-upgrade
siguen bloqueados. No se inicia B1-R2, B2 ni C.

## 12. Validaciones y Git final

Validaciones efectivamente ejecutadas con Node Linux v24.16.0. No se abrió
ninguna conexión de infraestructura como parte de ellas.

| Grupo | Resultado |
| --- | --- |
| Dos suites nuevas de preflight | **28 PASS**: 15 procedencia/recovery + 13 URL/proxy |
| B1 firmado + processReceipt legacy | 2 suites / 66 PASS |
| C2-III-A | 4 suites / 95 PASS |
| C2-II | 3 suites / 101 PASS |
| C2-I-A | 3 suites / 126 PASS |
| C1 | 2 suites / 63 PASS |
| Reducer | 2 suites / 78 PASS |
| Schema/guards/xid8 | 3 suites / 67 PASS |
| Registro/persistencia/Pending | 3 suites / 31 PASS |
| Ingress/routing/Receipt/processing/Twilio/media/Outbox/F13 | 8 suites / 109 PASS |
| Conjunto de repositorio, incluidas nuevas | **32 suites / 764 PASS**, cero fallos/omisiones |
| Arnés anterior conservado en /tmp, reejecutado | **3 suites / 55 PASS**, cero fallos/omisiones |
| Total sin contar reejecuciones focales dos veces | **35 suites / 819 pruebas PASS** |
| Typecheck completo twenty-server | `tsgo --noEmit --incremental false`, exit 0 |
| Typed lint explícito del directorio B1 | 10 TypeScript, cero errores/warnings |
| Nx lint:diff-with-main sin dependencias | PASS; 542 archivos lint / 500 formato según exclusiones |
| Formato explícito B1 | 10 TypeScript PASS; Markdown excluido por configuración |
| Whitespace y Git | Tracked/staging y no-index de los cuatro nuevos; sin cambios de refs/índice |

Se inspeccionó el arnés anterior antes de reejecutarlo. Sus archivos originales
no se modificaron y la nueva salida quedó fuera de ese directorio. Esta
reejecución por el implementador no es una revisión independiente nueva. El
primer typecheck detectó inferencia recursiva en el builder de I/O nuevo; se
separó su inicialización de los mockImplementation y se repitió con éxito.
No se cambió ninguna fuente aceptada para resolverlo.

Comandos focales desde `packages/twenty-server`, con
`PATH=/home/alberto/.nvm/versions/node/v24.16.0/bin:$PATH`:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --cacheDirectory /tmp/c2-b1-r1-jest-cache --runTestsByPath src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/receipt-origin-preflight.spec.ts src/modules/inconnect-messaging/attention-adapter/inbound/__tests__/inbound-url-proxy-preflight.spec.ts --json --outputFile /tmp/c2-b1-r1-preflight.json
../../node_modules/.bin/jest --config /tmp/c2-b1-independent/jest.config.mjs --runInBand --json --outputFile /tmp/c2-b1-r1-independent-rerun.json
../../node_modules/.bin/tsgo --noEmit --incremental false
../../node_modules/.bin/oxlint --type-aware -c .oxlintrc.json src/modules/inconnect-messaging/attention-adapter/inbound
```

La regresión conjunta usó attention-adapter y attention-domain completos, las
cuatro suites de schema/guards/xid8/registro, persistencia/work-state y las ocho
suites operativas listadas arriba por archivo exacto `.spec.ts`. No incluyó
`.postgres.spec.ts`, integración/reset o arranque. El JSON de regresiones
conserva las 32 rutas exactas y resultados por caso.

Desde raíz se ejecutaron oxfmt explícito del directorio B1, `git diff --check`,
`git diff --cached --check` y `git diff --no-index --check /dev/null <archivo>`
para los cuatro nuevos. No-index devuelve 1 por diferencia y salida vacía cuando
no hay diagnóstico; no se añadió nada al índice. Markdown se revisó por
estructura/whitespace, sin alterar su exclusión. Diff lint:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_WORKSPACE_DATA_DIRECTORY=/tmp/c2-b1-r1-nx-data NX_CACHE_DIRECTORY=/tmp/c2-b1-r1-nx-cache node_modules/.bin/nx run twenty-server:lint:diff-with-main --excludeTaskDependencies
```

Ese target usa main...HEAD y no cubre untracked; los tres TypeScript nuevos sí
tienen typed lint/formato explícitos. Evidencia: `/tmp/c2-b1-r1-preflight.json`,
`/tmp/c2-b1-r1-regressions.json`, `/tmp/c2-b1-r1-independent-rerun.json` y logs
`/tmp/c2-b1-r1-{preflight,regressions,independent-rerun,typecheck,typed-lint,diff-lint}.log`.

Git final: misma rama/HEAD; exactamente **cuatro archivos untracked** (los tres
TypeScript de pruebas de §10 y este documento), cero modificaciones tracked,
staging vacío. `git diff --stat` y `git diff --cached --stat` vacíos; no representan
ausencia de adiciones, cuyo contenido se revisó con no-index. No se hizo commit.

Se recomienda revisión independiente de la suficiencia del contraejemplo y del
inventario, la frontera de emisión/restore de B, el contrato URL/proxy y la
serialización de revocación. **R1 termina delimitando con evidencia el bloqueo
de admisión durable.** Su implementación segura necesita autorización adicional
de ingreso/persistencia y contrato físico; no se declara B1 completada ni se
avanza automáticamente a otra subfase.
