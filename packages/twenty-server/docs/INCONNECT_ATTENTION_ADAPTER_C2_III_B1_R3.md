# INCONNECT — C2-III-B1-R3: admisión inbound durable recuperable

Fecha: 2026-10-23. **Implementación SOURCE-ONLY privada e inerte, pendiente de
revisión independiente. No completa B1 ni habilita atención automática.**

## 1. Preflight y factibilidad

Git exclusivamente read-only: rama `feature/inconnect-lead-management`, HEAD
`b28bc9f4b8`, checkpoint `feat(inconnect): add source-only authenticated inbound
receipt contract`, árbol limpio y staging vacío antes de trabajar. R2 y su
corrección P2-SCHEMA-01 están registrados en ese commit. La aceptación
independiente final de R2 comunicada por el usuario prevalece sobre sus etiquetas
documentales históricas pendientes. No se reescriben documentos aceptados.

Se leyeron AGENTS.md y los contratos C2, I-A/B, II, III-A, B1/R1/R2 y se
contrastaron con las fuentes reales: inbound firmado, reader/writer, C1/reducer,
ingress/capacidad/persister/lector R2, entidades Receipt/Message/Conversation/
ProviderConnection/Configuration, procesamiento/claim/recovery, media y fuentes
de los comandos 1792540800000 y 1792666800000. No se inspecciona Enterprise RLS
ni se aplica un workflow syncable. No había errores conocidos pendientes
reportados por el checkpoint aceptado; la validación actual se registra abajo.

**Factibilidad:** la normalización v1 conserva una proyección determinista de
Message: body literal, tipo, providerMessageId, metadata completa y tiempos de
servidor/proveedor/efectivo con su source. También conserva la intención de media.
No requiere rawBody, petición HTTP, token histórico, otra firma o nueva capacidad.
No se identificó una incompatibilidad que exija cambiar contratos aceptados.

| Clase | Hechos / responsabilidad |
| --- | --- |
| A — disponibles en la unidad caller-owned | Message causal ya insertado/resuelto, attachments de intención y epoch de origen; transacción activa; transporte ya reclamó el lease. Ningún UUID suministrado acredita esos hechos por sí solo. |
| B — consultas legítimas de esta colaboración | Catálogo R2, versión durable scoped mediante lector R2, Receipt bajo UPDATE y relectura nueva, lease con reloj DB, conexión/configuración actual, routing único y correlación completa C/S/Message/Conversation; facts/gate/READY/originales exclusivamente por C2-II. |
| C — requieren locks previos del caller | Configuration SHARE → Conversation UPDATE → validar Epoch → Receipt UPDATE, todos ANTES del INSERT Message/attachments. Reobtener locks no demuestra ni repara un orden anterior incorrecto. |
| D — integración posterior | Caller operativo, lifecycle de nueva Conversation/Epoch, configuración instalada/aceptada físicamente, finalización scoped del Receipt, Outbox inbound, commit/reconciliación, publicación y media post-commit, revocación global, custodia/restore y corte/drenaje. |

Las categorías C/D son precondiciones y bloqueos de integración, no booleanos de
atestación añadidos a la API ni garantías certificadas por mocks.

## 2. Modelo T1 y procedencia durable

`ingressContractVersion = 1` es la afirmación del backend confiable fijada por
R2: política DIRECT_TLS_V1, routing/SDK reales, normalizador congelado y
persistencia íntegra/inmutable del hecho. R3 no emite ni promueve versiones.
La única versión proviene de `readReceiptIngressContract` sobre el Receipt
exacto persistido. PRE_DDL, NULL histórico, ausente, valores inválidos y versiones
desconocidas no admiten atención. Ninguna fecha de corte acredita v1.

Se reutiliza además `RECEIPT_INGRESS_SCHEMA_SQL`, incluida la corrección de
`tgattr` vacío y `tgqual IS NULL`. Sólo installed/compatible ambos verdaderos
permiten continuar. Error SQL, cardinalidad vacía/múltiple o envelope incompleto
rechazan. El detector conserva sus límites R2: no valida cuerpos alterados por
un administrador ni prueba instalación/ejecución física de triggers. No se llama
UP/DOWN ni el Fast Command para satisfacer pruebas.

V1 no resiste un escritor SQL malicioso con las credenciales del backend ni un
operador que copie v1 o retire guards. Eso pertenece a T2, fuera del modelo.
T1 exige backend y operadores/restore confiables. Un hash no autentica: aquí
`payloadHash` sólo se valida como SHA-256 hexadecimal conservado y se referencia
en auditoría; no se reconstruye contenido a partir de él.

## 3. Contrato privado e inventario

Entrada `DurableInboundAttentionInput`: QueryRunner original, S completo
(`workspaceId`, `providerConnectionId`, `conversationId`, `trackingEpochId`),
receiptId, messageId y leaseToken ya reclamado. Se capturan los valores antes
del primer await. No recibe actor, HUMAN, resultado C1, estado objetivo,
versión, request, trusted/authenticated, plan, facts ni marcador xid8.

Todos los TypeScript siguientes son nuevos bajo
`src/modules/inconnect-messaging/attention-adapter/inbound/durable/`:

| Archivo | Responsabilidad |
| --- | --- |
| durable-inbound.types.ts | Contrato explícito backend de referencias a contrastar |
| durable-inbound-sql.ts | Lock Receipt y SELECT de correlación parametrizados |
| decode-durable-inbound-fact.ts | Decoder estricto de normalización v1 y correlación completa |
| admit-durable-inbound.ts | Catálogo/versión/lease/hecho, admisión BACKEND derivada |
| prepare-durable-inbound-attention-write.ts | Entrada privada, composición III-A y excepción que exige abortar |
| __tests__/durable-inbound.fixtures.ts | Emisión R2 real con I/O simulado, serialización y script estricto de runner |
| __tests__/durable-inbound.spec.ts | Transiciones/originales, correlación, versiones/gates y rechazos |
| __tests__/durable-inbound-failures.spec.ts | SQL, sesión, cardinalidad, locks emitidos y abort obligatorio |
| __tests__/durable-inbound-media.spec.ts | Proyección de contenido/media v1 y lifecycle separado |
| __tests__/durable-inbound-source.spec.ts | Frontera inerte, SQL y binding privado |

Se crea además este documento: **11 archivos nuevos; ningún archivo existente
modificado**. Sin barrel público, decorador, provider registrado o caller
operativo. No cambian C2-I-A/B/II/III-A, C1/reducer, entidades/comandos, R2,
controller/ingress/persister activos, worker/claim/recovery, Outbox publisher,
Send/Dispatch/callbacks, Pending manual, AGENTS.md, frontend, Record Access,
Commercial Teams ni distribución de Leads.

## 4. Correlación del hecho congelado

El decoder v1 usa objetos estrictos; rechaza campos faltantes/extras, normalizer
versions adicionales, tipos/nullability incorrectos y metadata parcial. No llama
al normalizador actual ni a una versión futura. No duplica un normalizador: lee
el resultado persistido de la versión aprobada y contrasta su proyección.

| Hecho | Contraste |
| --- | --- |
| Receipt | ID/workspace/conexión exactos, INBOUND_MESSAGE, key igual a providerMessageId normalizado, hash válido, firstReceivedAt concordante, PROCESSING, token exacto, attempts positivo y processedAt NULL |
| Conexión | ID/workspace exactos de la Conversation y Receipt, TWILIO/WHATSAPP, ENABLED, routing no vacío y único; credentialsVersion positiva y credenciales configuradas con formato enc:v2, sin extraer/descifrar el ciphertext |
| Conversation | C completo, externalAddressNormalized igual al hecho, puntero al epoch esperado |
| Message | ID/C/S exactos, origen no NULL igual al epoch actual; INBOUND, sendMode/outboundState NULL, providerMessageId, tipo, cuerpo literal y providerMetadata completos iguales al hecho |
| Timestamps | firstReceivedAt/serverReceivedAt, providerOccurredAt nullable, effectiveInboundAt y timestampSource concordantes; SERVER/PROVIDER según presencia del instante de proveedor |
| Media | Intención v1 íntegra, ordinal consecutivo, tipo/MIME/filename, metadata.media y waId interno concordantes; attachments persistidos por Message/workspace/conexión con la misma proyección de intención |

Los tiempos normalizados v1 conservan el ISO UTC de milisegundos que produjo
Date.toISOString en R2. El SELECT solicita texto UTC con seis decimales, finito y
en rango C2 0001–9999; el comparador aceptado conserva microsegundos con BigInt.
`.000000` y `.000` representan el mismo instante; una desviación de un microsegundo en
Message se rechaza. No hay round-trip Date en R3 ni normalización de body:
vacío, espacios, saltos, emoji y Unicode se comparan exactamente.

`Conversation.waId` es mutable por inbounds posteriores: no puede sustituir la
identidad estable externalAddressNormalized ni exigirse igual para un replay
viejo. El waId original sí permanece en el hecho y su providerMetadata; ésta se
compara íntegra contra Message. LOCATION conserva metadata estructurada.

La autoridad histórica sobre routing está ligada por v1 a ProviderConnection.id;
R2 no persistió URL/routingKey/ciphertext histórico. R3 no inventa esos datos ni
afirma compararlos. Comprueba el routing **actual** de esa fila, no un routing
elegido por caller. El único count fuera del workspace es un punto exacto por
provider/channel/routing de esa conexión para detectar ambigüedad global, como
el routing real; no consulta permisos globales ni usa repositorios de autoridad
ajenos al runner. No deduce configuración actual desde headers, To, AccountSid
o credenciales históricas que no fueron persistidas como autoridad independiente.

## 5. Media y attachments

El hecho v1 conserva providerMediaLocator original, incluso NULL si la recepción
carecía de metadata suficiente. No se descarga ni se valida por red. Attachment
puede pasar a PROCESSING/AVAILABLE/FAILED/EXPIRED, retirar el locator y adquirir
File/MIME detectado/bytes/availableAt sin cambiar la intención causal.

R3 compara ordinal/type/declaredMimeType/safeFilename, no los campos de descarga
o FileStorage. El SELECT no devuelve el locator vivo, lease de Attachment o
estado de descarga. No exige AVAILABLE para admitir inbound, ni considera un
fallo MIME razón para borrar el hecho recibido. Attachments faltantes/extra o
intención contradictoria rechazan; el caller deberá haberlos insertado antes de
esta colaboración. La completitud física de ese conjunto y concurrencia con su
lifecycle requieren el caller y aceptación PostgreSQL posteriores. No se ofrece
backfill ni redacción histórica implícita para facilitar replays.

## 6. Composición con C2-II / III-A / C1

`prepareDurableInboundAttentionWrite` construye exclusivamente INBOUND_RECEIVED,
con eventKey estable por receiptId; llama al `prepareAttentionWrite` real con
el mismo runner y causa. III-A llama a C2-II, que valida sesión, gate ENABLED,
Epoch READY y origen Message, adquiere locks comunes, relee estado/facts y
reconstruye C1. III-A evalúa C1/reducer reales y solicita la admisión privada.

La admisión exige runner/scope/evento/Message/eventKey exactos. Después de validar
catálogo, Receipt lock, versión R2 y hecho devuelve sólo BACKEND, actor null,
fingerprint del dominio y referencias derivadas:

```text
eventKey: ["whatsapp-inbound-v1", Receipt.id]
effectKey: ["INBOUND", Message.id]                         (C1/domain)
fingerprint: ["INBOUND_RECEIVED", Message.id]             (C1/domain)
authenticationReference: ["durable-inbound-t1-v1", Receipt.id, payloadHash]
correlationReference: ["inbound-cause-v1", Receipt.id, Message.id, providerMessageId]
```

No se llama firma, Twilio, Redis o cola. El nombre durable de la referencia
evita atribuir una firma nueva a una lectura histórica. La referencia almacenada
no permite admitir otro intento por sí sola. No autentica humanos ni concede
permisos Messaging/CRM/Record Access.

III-A conserva sus checks causales, marcadores xid8 server-owned y persistencia
única de Effect/Audit/AttentionReceipt/Conversation/Outbox; R3 no hace DML. Para
un Effect inbound nuevo Message debe ser creación de esa misma unidad. UPDATE
técnico no satisface creación; NULL histórico no adquiere epoch. No se altera el
writer para acomodar fixtures ni se añade otro reducer/lector de ledger.

## 7. QueryRunner, locks y lease

Se hereda el contrato real C2-II/III-A: runner ya conectado, master PostgreSQL
inicializado, transacción activa exclusiva de profundidad 1; mismo manager,
DataSource y conexión física; READ COMMITTED/read-write/primario, row_security
off, presupuestos positivos, PID/xid8 exactos estables. R3 añade controles de
sesión alrededor de su lectura y del lector R2 mediante el manager original.
No cambia opciones de sesión ni crea/conecta/abre/confirma/revierte/libera otro
runner. Una Conversation/un evento por unidad, sin batch/savepoints.

El caller ya debe tener Configuration SHARE → Conversation UPDATE → Epoch
validado → Receipt UPDATE **antes** de INSERT Message/attachments. C2-II
reobtiene los locks comunes; admisión reobtiene Receipt UPDATE. Tras resolver
ese lock se hace una nueva lectura de versión/hecho y se evalúa leaseExpiresAt
contra clock_timestamp DB. III-A vuelve a comprobar ownership/lease y bloquea
Message antes del ledger. No se reclama ni extiende lease aquí.

El orden emitido y espera controlada se prueban sin DB. No es posible observar
retrospectivamente el orden anterior del caller a partir de UUIDs/flags del
runner. No se ofrece un flag alreadyLocked. Un lock tardío no repara una
inversión; el caller operativo sigue bloqueado hasta diseñarse/revisarse.

Vigencia se verifica en esas sentencias: el reloj no queda congelado hasta
commit. El caller deberá revalidarla también al finalizar Receipt, mantener
su lock y exigir affected=1 por id/workspace/conexión/PROCESSING/token. Takeover,
esperas y vencimiento entre checks/commit requieren una política física
aceptada. PREPARED no certifica esa finalización ni ownership futuro.

## 8. Idempotencia, originales e historia

El evento conserva las identidades anteriores, sin randomizar una clave para
obtener APPLIED. Inbound nuevo abre/renueva PENDING con incremento BigInt exacto;
PENDING→PENDING no sustituye el inicio pendingAt, que controla el writer/guard.
Replay es DUPLICATE y alias conserva DUPLICATE propio separado de APPLIED
canónico, sin nuevo Effect o cambio de revisión. Se devuelve la salida real
III-A con originales completos separados; no se recalculan contra estado vivo.

En el reducer aprobado no existe un inbound nuevo legítimo IGNORED: siempre es
APPLIED. Un original inbound falsificado IGNORED se rechaza por los decoders
reales, y una colisión con un Receipt de otro efecto produce CONFLICT. Los
canónicos IGNORED válidos de otras clases se conservan y prueban en las
regresiones III-A/II/I-A/C1/reducer; no se fabricó un inbound IGNORED para hacer
pasar una prueba imposible. Las pruebas de alias ejercitan historia C1 compatible
ya proporcionada; no autorizan al transporte Twilio a eludir su UNIQUE ni a
crear un segundo Receipt del mismo providerMessageId.

PROCESSED, FAILED o RECEIVED no se convierten en PROCESSING. El adaptador exige
un lease actual de la ruta de transporte, incluso para replays admitidos. Un
PROCESSED histórico requiere otro contrato de reconciliación de commit ambiguo
del futuro caller; R3 lo rechaza sin falsificar lease ni tocar historia. Legacy
NULL se conserva fuera de admisión, sin promover versiones/epoch por UPDATE.

## 9. Errores, rollback y compatibilidad

Error de reader/SQL/decoder/admisión/writer falla cerrado. Los rechazos de
admisión producen AUTHORITY_REQUIRED; excepciones de la colaboración se traducen
por III-A en ADMISSION_FAILED; errores propios de reader/writer conservan sus
códigos seguros. No se filtran payload/SQL/credenciales/texto del driver.

Todo ok:false se transforma en `DurableInboundAttentionPreparationFailure` con
callerMustRollback=true. Un CONFLICT devuelto por III-A también lanza: incluso
si III-A preparó Audit aislado, el caller no puede confirmar una unidad causal
incompatible. Una excepción inesperada sigue rechazando la promesa. El caller
debe dejarla salir de su callback transaction y abortar; capturarla para devolver
normalmente o continuar DML viola el contrato. R3 no ejecuta COMMIT/ROLLBACK.

PREPARED sólo prepara; un fallo posterior o commit ambiguo no es éxito durable.
No hay ACK/enqueue/publicación/submit externos antes de commit. Message,
attachments, ledger/audit/estado/Outbox de atención, Outbox inbound y finalización
de Receipt deben pertenecer a la unidad causal única del caller futuro.

Pre-DDL atención/ingress, DISABLED, PREPARING, SUSPENDED, instalación parcial,
versiones desconocidas y Epoch no READY rechazan sin fallback legacy. Las rutas
operativas existentes permanecen intactas porque no existe wiring nuevo.
**R2 sigue emitiendo v1 únicamente durante DISABLED.** Poder releer ese hecho
no autoriza cambiar gate y procesarlo inmediatamente en ENABLED. Revisar esa
restricción de emisión y la política explícita de corte/drenaje es obligación
de una fase de rollout posterior; no se modifica aquí.

## 10. Revocación, restore y proxy: bloqueos retenidos

La conexión actualmente DISABLED o mal configurada se rechaza aunque la firma
histórica fuera válida. Rotar el token conservando configuración vigente no
requiere el token anterior para leer v1. No se consulta revocación remota de
Twilio por red. El backend tendrá que reflejarla mediante un cambio autorizado.

SELECT ENABLED prueba sólo lo visible entonces. Todas las mutaciones de
ProviderConnection —estado, routing, identidad, credenciales, provisioning y
operadores— deberán participar en gate-first (Configuration UPDATE) frente al
SHARE del procesamiento. Ese protocolo global está pendiente. Se incluye un
contrajemplo de revocación después del último SELECT por un escritor ajeno:
el componente aún puede devolver PREPARED. No se afirma serialización hasta
commit ni se intenta resolverla con un lock tardío de conexión.

Restore/import pueden copiar v1 y marcadores xid8; éstos no tienen identidad
global entre clusters. Custodia, cuarentena, completitud de ledger/originales,
coherencia Message/Epoch/Outbox, leases/jobs y versión de esquema deben validarse
antes de reanudar consumidores, conforme R2. No se implementa ni se presume
cuarentena física aquí. Un restore parcial no gana autoridad por conservar 1.

La policy DIRECT_TLS_V1 sigue sin registro operativo. TLS detrás de proxy,
preservación de URL/puerto/path/form, saneamiento forwarded y configuración de
despliegue requieren otra composición revisada. R3 usa sólo el hecho v1 ya
emitido: no convierte una fila legacy/proxy no acreditada en v1 ni configura
SERVER_URL/TRUST_PROXY/TLS. No ofrece una API pública para entregar un Receipt.

## 11. Validaciones SOURCE-ONLY

Node Linux v24.16.0. Resultados finales efectivamente ejecutados:

| Validación | Resultado |
| --- | --- |
| R3 nuevo | **4 suites / 140 PASS** (84 contrato/semántica, 31 fallos, 18 media, 7 fronteras) |
| Baseline R2 completo, incluido en el total | **76 suites / 1.284 PASS** |
| Conjunto único | **80 suites / 1.424 PASS**, cero fallos/omisiones |
| Regresiones incluidas | R2/P2-SCHEMA-01, B1/R1, C2-III-A/II/I-A/B, C1/reducer, Webhook/Receipt/ingress/Twilio, media, F13 y demás Messaging seleccionadas |
| Typecheck completo twenty-server | `tsgo --noEmit --incremental false`, exit 0 |
| Typed lint explícito de los diez TypeScript nuevos | Cero errores/warnings |
| Diff lint Nx, dependencias excluidas | PASS; typed lint 559 archivos, formato 516 según exclusiones |
| Formato explícito de los diez TypeScript | PASS |
| Whitespace | tracked/staging y los once nuevos por no-index, PASS |

Comandos principales desde `packages/twenty-server`, con
`PATH=/home/alberto/.nvm/versions/node/v24.16.0/bin:$PATH`:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --runTestsByPath <80 rutas explícitas> --json --outputFile /tmp/c2-r3-regressions.json
../../node_modules/.bin/tsgo --noEmit --incremental false
```

La lista explícita `/tmp/c2-r3-regression-paths.json` se pasó mediante subprocess
con argumentos estructurados, sin interpolar texto en shell. Desde raíz:
`oxlint --type-aware -c packages/twenty-server/.oxlintrc.json` y `oxfmt --check`
sobre el directorio durable nuevo; `NX_DAEMON=false NX_ISOLATE_PLUGINS=false`,
cachés/data en `/tmp/c2-r3-nx-*` para `nx run twenty-server:lint:diff-with-main
--excludeTaskDependencies`. El target Nx usa main...HEAD y no cubre untracked:
los diez TypeScript tienen además lint/formato explícitos. Markdown está excluido
de oxfmt y se revisó por estructura/whitespace, sin cambiar la configuración.

Evidencia: `/tmp/c2-r3-regressions.json` y `.log`,
`/tmp/c2-r3-typecheck.log`, `/tmp/c2-r3-lint.log`,
`/tmp/c2-r3-diff-lint.log`, `/tmp/c2-r3-format.log` y la lista de rutas anterior.
Las reejecuciones focales no se suman dos veces. La primera ampliación detectó
un error del test: se pasó el mapa ATTENTION_SLOTS_SQL en vez de su sentencia
NONE; se corrigió el fixture sin cambiar fuentes aceptadas. También se precisó
el caso de Message legacy para alterar el objeto message anidado, y se añadió
rechazo de configuración de credenciales ausente durante la revisión final.
La ejecución final usa los componentes y fuentes finales de esta entrega.

La lista de regresión parte de los 76 archivos explícitos de R2 y añade las
cuatro suites R3. No incluye .postgres.spec.ts, integración/reset, PG0/PG1/C5,
exact-upgrade, arranque de servicios ni conexión a DB. Los mocks verifican SQL,
parámetros, envelope, cardinalidad y orden; los errores del script quedan fuera
del catch productivo mediante comprobaciones finales para evitar falsos PASS.

La procedencia positiva ejecuta ingress/routing/SDK/capacidad/persister R2
reales, con firma HMAC local y sólo I/O simulado. El INSERT capturado se
serializa/relee; la API durable recibe únicamente referencias, runner y lease.
Reinstanciación de caller y rotación no necesitan petición/capacidad/token viejo.
El lease/SELECT de configuración son respuestas SQL simuladas, no una bandera
de fixture que pretenda autenticar una fila. Ningún mock demuestra procedencia
de una fila PostgreSQL arbitraria ni resistencia T2.

| Requisitos adversariales | Evidencia |
| --- | --- |
| 1–8: nuevo/recovery/reinstanciación/versiones/esquema | R2 real + serialización; rechazo NULL/desconocida/inválida/pre-DDL/parcial, cardinalidad/SQL; regresión P2-SCHEMA-01 |
| 9–13: scopes/identidades/epoch | JOIN parametrizado completo, decoder con referencias cruzadas, reader real y rechazo de origen NULL/otro epoch |
| 14–20: lease/estados/conexión/routing | DB-clock bajo lock/relectura, token/expiración/estados/configuración y routing ambiguo; revocación visible vs brecha tardía documentada |
| 21–28: metadata/contenido/timestamps/media | Decoder v1 estricto, bytes de body Unicode/espacios/vacío, precisión temporal y todos los tipos de media/intenciones, sin descarga |
| 29–37: APPLIED/renew/reopen/replay/alias/IGNORED/conflicto/originales/BigInt | Writer/reader/C1/reducer reales; original inbound IGNORED imposible rechazado; IGNORED válidos cubiertos por regresiones, sin inventar semántica |
| 38–44: errores/rollback/runner/locks/autoridad | Fallos en cada SELECT/DML/constraints, error tras writes rechaza callback, misma conexión/manager y secuencia/espera; no repositorios globales |
| 45–50: aislamiento de alcance/identidades | Sin transporte/segunda transacción/registro; fuentes aceptadas intactas; derivación estable y helper que rechaza eventKey arbitraria |

No se prueba con mocks: SQL ejecutable/resolución/planes/coste, catálogo instalado,
parser real de timestamps/envelopes, constraints/FKs/triggers/xid8 reales, locks
implícitos/esperas/deadlocks, MVCC/completitud concurrente, takeover de lease,
commit/rollback/caídas, roles/grants, revocación serializada, restore/custodia,
proxy desplegado o publicación efectiva. Se requiere aceptación PostgreSQL
física aislada específicamente autorizada; otro puerto/nombre no basta.

## 12. Obligaciones exactas del futuro caller y cierre

1. Resolver identidades backend, custody/restore y disponibilidad de esquema
   sin usar prelecturas como decisión; claim corto de transporte terminado.
2. Abrir y conservar la unidad exclusiva C2-II compatible y presupuestada;
   adquirir Configuration SHARE → Conversation UPDATE → validar READY → Receipt
   UPDATE antes de Message; integrar protocolo global de revocación gate-first.
3. Implementar/revisar lifecycle para nueva Conversation/Epoch; resolver ganador
   por UNIQUE y bloquearlo antes del primer Message. No inventar epoch ni
   rejuvenecer Message legacy; corte/drenaje y emisión R2 necesitan revisión.
4. Insertar/resolver Message causal y attachments correctos en la misma unidad,
   con guards diferidos inicialmente y marcadores xid8 de PostgreSQL, no del
   caller; invocar R3 sobre exactamente ese runner/S/Receipt/lease/Message.
5. Abortar la unidad completa ante cualquier fallo/conflicto. Completar Outbox
   inbound y Receipt PROCESSED scoped con lease/affected comprobados, sin cambiar
   originales; un solo evento de atención por Conversation/transacción superior.
6. Confirmar sólo la unidad completa. Implementar política acotada de retry y
   reconciliación separada de commit ambiguo/PROCESSED con las mismas identidades,
   sin simular PROCESSING. Nunca afirmar durable por PREPARED.
7. Adaptar/revisar el consumidor del tipo de Outbox de atención y fanout autorizado;
   publicación, media y F13 siguen después del commit. No insertar CRM en R3.
8. Probar caller real, todas sus rutas/fences y fallos; obtener revisión
   independiente SOURCE-ONLY y aceptación física aislada autorizada antes de
   planear despliegue/activación. Retención/purga siguen separadas.

No se inicia B1-R4, B2 ni C. No hubo Git writes/commit, SQL real/PostgreSQL,
Fast Commands/migraciones, setup/reset, servidores/workers/Redis, red Twilio,
tracking/Epoch reales, alteración de roles/grants/datos o despliegue.
PG0/PG1/Stage C5/exact-upgrade permanecen bloqueados.

Se recomienda auditoría independiente del binding durable T1, decoder v1 y
correlación completa, sesión/locks previos, lease, originales y fallos que exigen
abortar; las dependencias operativas y físicas anteriores siguen pendientes.

Git final: misma rama y HEAD del preflight, **once archivos untracked, ningún
tracked modificado y staging vacío**. `git diff --stat` y `git diff --cached
--stat` vacíos porque los archivos son nuevos, revisados con no-index sin añadir
al índice. El inventario anterior cubre todo el cambio. No se hizo commit.

**C2-III-B1-R3 SOURCE-ONLY, lista para revisión independiente.**
