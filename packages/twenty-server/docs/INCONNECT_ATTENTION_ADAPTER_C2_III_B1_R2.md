# INCONNECT — C2-III-B1-R2: emisión inbound T1

> Lectura vigente, 2026-10-27: este documento conserva la entrega de su fase.
> Las etiquetas de revisión pendiente y recomendaciones de siguiente fase son
> históricas; consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para los
> checkpoints posteriores hasta R4 y [guardrails](INCONNECT_ATTENTION_GUARDRAILS.md).
> Sus contratos técnicos y gates físicos permanecen; ninguna fase ni instalación
> se autoriza por esta reconciliación documental.

Fecha: 2026-10-22. **Implementación SOURCE-ONLY, apagada por defecto y pendiente
de auditoría independiente. Entrega delimitada: emisión directa TLS preparada;
proxy, revocación integral, restore operativo y admisión recuperable pendientes.**
No se declara B1 completada, T2 implementada ni Messaging/atención activados.

La revisión independiente de la entrega original emitió **REQUIRES REMEDIATION**
por P2-SCHEMA-01. La remediación focal se registra en §17; R2 sigue pendiente de
una nueva auditoría independiente y no se declara aceptada.

## 1. Preflight y decisión T1

Git read-only: `feature/inconnect-lead-management`, HEAD
`f01a6a63c9faa81195cc9338b0552bac0153f4ff`, árbol inicialmente limpio y staging
vacío. HEAD es el checkpoint R1: documento y tres archivos de pruebas; su padre
es B1 `2013c098f3`, precedido por III-A `9454c3f0cf`, II `fea20f6015`, I-B
`f143422f59` e I-A `bf25dcd36e`. Se leyeron íntegramente AGENTS.md y los siete
documentos C2/DESIGN, I-A, I-B, II, III-A, B1 y R1. Se contrastaron los productores,
controller, provider/registry, routing, Receipt, claim/recovery, exportador,
fuentes de importación/restauración, configuración/proxy y comandos existentes.
AutoCreateAuthority se inspeccionó exclusivamente por su patrón WeakMap; ninguna
autoridad CRM se importa o reutiliza.

T1 confía en backend desplegado y operadores autorizados de PostgreSQL/restore.
Protege la frontera pública y el uso accidental de APIs de aplicación mediante
verificación real y capacidad privada; protege historia/duplicados y consistencia
mediante contratos de código y DDL preparado. Un componente con SQL arbitrario y
las credenciales del backend puede insertar una fila v1 válida de forma sintética.
Un backend comprometido puede alterar el verificador; un administrador puede
retirar triggers. Esos ataques están excluidos. **No hay separación SQL T2.**

Se descarta la propuesta B original de cuatro versiones y otro digest. Sólo hay
un discriminador integer nullable, sin secreto nuevo ni hash adicional.

## 2. Factibilidad y arquitectura de emisión

```text
Request real capturado por controller
→ copia antes de await → routing backend único/ENABLED y descifrado existente
→ política directa TLS v1 → verificador SDK Twilio existente
→ normalizador Twilio existente → snapshot privado inmutable y capacidad
→ transacción de recepción READ COMMITTED
→ verificar instalación física → Configuration SHARE → revalidar conexión
→ INSERT explícito con v1 / conflicto atómico sin UPDATE
→ lectura nueva y validación del original → revalidar conexión → COMMIT
→ enqueue existente, sólo receiptId → recovery legacy posterior
```

El orden protegido se prepara sólo para `attentionTrackingMode=DISABLED`.
DISABLED aquí mantiene atención apagada; no convierte una recepción en no firmada.
PREPARING, SUSPENDED y ENABLED rechazan esta ruta antes del INSERT: R2 no instala
un worker tracked. No hay permiso para iniciar el rollout mediante ese gate.

La capacidad no se obtiene de un objeto literal ni de un Receipt: su identidad
se consulta en un WeakMap privado. Sus valores son strings y números congelados,
incluyendo scope, versión de contrato, origen/URL verificados, ciphertext/versión
de credencial, routing, hash, fecha y JSON
normalizado. Mutar el request o el resultado del normalizador después no cambia
el snapshot. El persister protegido no recibe hecho/scope/versión sustitutos.
Una llamada al persister legacy no referencia la nueva columna. Un original NULL
permanece NULL incluso ante una nueva petición válida. Estas propiedades no
necesitan modificar contratos aceptados ni ejecutar infraestructura.

## 3. Capacidad runtime y frontera de código

`verifyTwilioWebhook` extrae el recorrido que antes residía en ingress: mantiene
un solo autenticador y normalizador. Usa registry/routing y los métodos reales
`validateWebhookSignature`/`normalizeWebhook`; sólo un proveedor instancia del
Twilio existente es elegible para emitir. Las pruebas positivas no sustituyen
la verificación por `true`.

`AuthenticatedInboundCapability` tiene una marca de compilación; la autoridad
real es la identidad de objeto en el WeakMap, no esa marca. No existe
`issue(snapshot)`, `trusted`, `authenticated`, UUID/digest de autorización ni
operación para acreditar una fila anterior. La clave vacía y su snapshot son
congelados. El consumo retira la clave antes de cualquier SQL: un error obliga
al ingreso a verificar nuevamente una petición real; no deja capacidad parcial
reutilizable. Los duplicados siguen usando la identidad persistida original.

`persistAuthenticatedInbound` inicia únicamente la transacción corta de recepción,
no la unidad causal de atención. El helper DML exportado también exige la
capacidad auténtica; no acepta un snapshot arbitrario. Las exportaciones de
módulos internos no son aislamiento contra código backend malicioso bajo T1.

## 4. Contrato durable cerrado v1

`WebhookReceipt.ingressContractVersion`: integer NULL, sin default ni backfill.
`1` afirma que este backend T1 verificó un inbound conforme a este contrato:

- TWILIO/WHATSAPP, routing backend único y conexión habilitada; credenciales del
  workspace, sin scope controlado por formulario.
- Política exacta de §5; SDK real existente sobre URL preservada y todos los
  parámetros escalares, incluidos desconocidos.
- Normalizador actual `TwilioWhatsappMessagingProvider.normalizeInbound`:
  MessageSid/idempotencyKey; From normalizado/waId; cuerpo/tipo; timestamps
  SERVER/PROVIDER; attachments ordenados y providerMetadata. Texto Unicode,
  CONTACT, LOCATION y media conservan sus contratos existentes.
- Hecho durable completo congelado desde INSERT y política de duplicados de §8.

Un cambio incompatible del verificador, SDK, política, normalizador, semántica de
campos o duplicados requiere revisión y otra versión; no se declara v1 por
conveniencia. Las regresiones existentes de Twilio/media y los vectores nuevos
son parte de la revisión de compatibilidad; no se duplica el normalizador.

Decoder estricto: PRE_DDL, LEGACY (NULL), SUPPORTED (número 1), UNKNOWN_VERSION
(entero positivo distinto) e INVALID (string, ausente instalado, booleano, etc.).
No acepta coerción. `readReceiptIngressContract` es una proyección inerte scoped
por Receipt/workspace/conexión con `to_jsonb`, segura antes de columna instalada.
SQL fallido, cardinalidad o envelope incompleto no se convierten en LEGACY.
**Esta función sólo lee versión; no admite atención ni certifica el hecho completo.**

No se persisten URL, firma, authToken, rawBody, ciphertext de credenciales ni otro
digest nuevo. El request y rawBody sólo permanecen transitoriamente en memoria.
El hash existente conserva SHA-256(rawBody UTF-8), sin significado criptográfico
adicional de autoridad. `attentionRevision`, xid8 y versiones C1 siguen intactos.

## 5. Política URL/proxy verificable y límite de despliegue

Única modalidad preparada: `DIRECT_TLS_V1`. Requiere origen backend explícito
HTTPS canónico, host DNS ASCII exacto y puerto exacto. El origen no admite path,
query, fragmento o userinfo. La representación sin puerto 443 debe coincidir
exactamente: no se aprovecha la tolerancia del SDK que elimina puertos.
Un puerto no estándar sólo puede ser admitido si consta explícitamente en origen,
Host y URL efectivos concordantes.

El controller captura `socket.encrypted`, Host crudo, presencia/multiplicidad de
Host, `originalUrl` y validez UTF-8 del Buffer antes de convertirlo. Cualquier
Forwarded/X-Forwarded-* o ausencia de TLS directo excluye v1. No se utiliza un
header público para declarar proxy confiable. URL efectiva y request-target deben
coincidir exactamente con el origen configurado y el path inbound con routingKey
backend codificado una vez. Query, incluso `?` vacío, path reescrito y slash extra
no son elegibles.

El form debe ser URL-encoded con UTF-8. Se decodifica una vez con rechazo de
percent inválido/UTF-8 inválido; se rechazan claves duplicadas después de decode,
claves anidadas/array y nombres con segunda interpretación percent. Se exige
igualdad exacta con el parser recibido. No se quitan campos desconocidos antes
de la firma ni se aplica NFC u otra normalización Unicode. Los valores percent
literales se conservan como tales después de una sola decodificación.

`main.ts` ya permite TLS mediante SSL_KEY_PATH/SSL_CERT_PATH; su existencia no
prueba su configuración en ningún despliegue. No se cambia TRUST_PROXY,
SERVER_URL, TLS ni red. `INBOUND_INGRESS_POLICY` es un token backend opcional
**sin provider registrado**; no hay variable ambiental nueva ni hostname de
producción inventado. Registrar la política requiere otra composición revisada.
Un despliegue que termine TLS en proxy queda fuera de v1 hasta justificar y
codificar su política de preservación de URL/topología. Un fixture no aporta esa
evidencia. Sin política suficiente continúa la recepción legacy autenticada por
su contrato vigente y no se emite v1.

## 6. Revocación y escritores inventariados

El routing existente lee conexión/credenciales habilitadas. La ruta nueva toma
Configuration SHARE y revalida identidad, routing único, ENABLED, ciphertext y
credentialsVersion antes de INSERT y antes de devolver la transacción. Cambios
visibles o rotación intercalada rechazan la recepción protegida. Esto no serializa
un escritor ajeno al protocolo ni afirma conocer revocación remota en Twilio.
La firma válida al recibir y la habilitación actual para procesar son hechos
separados; rotar después no borra la versión durable histórica.

Inventario de fuente por entidad/nombre físico, sin inspección de catálogo:

| Ruta | Escritura / límite |
| --- | --- |
| Fast transport spine 1788982508902 | Crea/drop de tabla/índices/FKs; no protocolo de gestión |
| ExportWorkspaceService | Lee/exporta todas las columnas; SQL administrativo puede recrearlas |
| Routing, send, dispatch, provider-context, media, webhook-processing | Lectores de ProviderConnection; no servicio administrativo de mutación encontrado |
| Repositorios/raw SQL/provisioning/restore de operadores | Escritores privilegiados posibles; sin garantía de participación en gate |
| Nuevo `prepareProviderConnectionDisable` | Preparación inerte caller-owned: Configuration FOR UPDATE → UPDATE conexión scoped |

No se encontró una API de gestión de ProviderConnection a la que aplicar un
cambio completo; no se modifican tooling de provisioning/restauración ni rutas
administrativas ajenas. La operación inerte valida el runner con la sesión C2-II,
no toma Conversation ni posee connect/commit/rollback. Sus tests comprueban el
orden emitido, no bloqueo real.

**Bloqueo conservado:** todos los cambios de estado/routing/identidad/credencial,
incluidos operadores y provisioning, deberán adoptar gate-first. El procesamiento
futuro conserva Configuration SHARE → revalidación de conexión → demás locks.
Una prueba documenta revocación después de la última SELECT por un escritor no
participante: la recepción todavía puede confirmar. No se presenta doble SELECT
como solución ni esta operación disable aislada como protocolo completo.

## 7. SQL aditivo, registro y disponibilidad

Nuevo Fast Command `1792666800000`, clase
`AddInconnectMessagingIngressContractFastInstanceCommand`, versión 2.32.0,
registrado una vez en `instance-commands.constant.ts`. Timestamp único posterior
al ledger; no se modifica `1792540800000` ni sus helpers. UP: columna nullable,
CHECK de versión conocida, dos funciones y dos triggers. DOWN retira exactamente
esos objetos, conserva Receipts/ledger y pierde el discriminador. No es rollback
operativo ni reautentica datos. No se invoca UP/DOWN, generator o runner.

El mapping usa WasIntroducedInUpgrade con el step completo y
select:false/insert:false/update:false, sin default, inicializador ni relación
nueva. Las consultas ORM ordinarias y RETURNING implícito no nombran la columna;
se comprueba con metadata y generación SQL TypeORM reales, sin initialize.

Antes de la escritura protegida, pg_attribute detecta presencia y tipo integer
nullable sin default. Si está presente exige también las dos identidades de
triggers habilitados, tipos de evento y funciones correspondientes y el CHECK
validado en catálogo. La remediación §17 añade que ambos triggers tengan `tgattr`
vacío y `tgqual IS NULL`. Una forma incompatible falla; no se degrada a pre-DDL.
No se verifican cuerpos completos ni se promete detectar sabotaje privilegiado.
Con ausencia genuina sólo se retorna al persister legacy, que no menciona la
columna. Un error SQL/configuración no produce fallback. La instalación completa,
semántica de catálogo y comportamiento de los guards necesitan prueba física.

## 8. Duplicados e historia

INSERT explícito parametrizado: versión literal 1 desde código, nunca argumento
de cliente. ON CONFLICT sobre conexión/kind/key hace DO NOTHING; una sentencia
nueva READ COMMITTED lee el original con SHARE. Se comprueban scope, kind, key,
hash, versión y normalizedMetadata completo. La fecha de llegada pertenece al
original: sólo el comparador en memoria ajusta serverReceivedAt y, si corresponde,
effectiveInboundAt al primer instante; no se modifica la fila ni renormaliza
historia para acreditar autoridad.

| Resultado | Conducta |
| --- | --- |
| NEW_V1 | INSERT nuevo y versión en la misma unidad; retorno/enqueue después del commit |
| DUPLICATE_V1 | Mismo id, hecho, fecha y versión; no nueva recepción/autoridad |
| DUPLICATE_LEGACY | Original NULL validado, conservado sin promoción |
| PRE_DDL | Persister legacy sin columna; ninguna versión ficticia |
| Hash distinto | PAYLOAD_CONFLICT; no overwrite ni nueva identidad |
| Versión desconocida, scope/hecho contradictorio | Rechazo; no enqueue ni fallback |

PROCESSED conserva su estado; no se simula PROCESSING ni lease. Recovery sigue
transportando sólo receiptId. La versión puede releerse después de reiniciar sin
la capacidad ni el token antiguo; aún falta implementar admisión recuperable con
el resto de precondiciones. Historia NULL, incluso pendiente, nunca recibe v1
por fecha de corte, backfill, import o retry.

## 9. Inmutabilidad y lifecycle

BEFORE INSERT valida forma mínima v1: inbound, hash hexadecimal, objeto normalizado,
kind/key/providerMessageId concordantes, fecha finita y recepción concordante.
**No autentica el INSERT.** La autenticación reside en backend T1.

BEFORE UPDATE compara OLD/NEW mediante IS DISTINCT FROM sobre id, workspaceId,
providerConnectionId, eventKind, idempotencyKey, payloadHash, firstReceivedAt,
normalizedMetadata e ingressContractVersion. Incluye filas NULL; prohíbe promoción,
sustitución de versión y cualquier alteración del hecho. Lease, estado, attemptCount,
error, processedAt y updatedAt técnico legítimo siguen permitidos.

DELETE y TRUNCATE se rechazan para todas las identidades retenidas, incluidas
NULL; no se abre delete/reinsert para ganar otra identidad confiable. Esto puede
bloquear cascadas del borrado de workspace: purga/retención requieren procedimiento
separado. No hay purga ni modificación de cascadas/FKs en esta entrega. Backup de
lectura no se ve afectado.

El BEFORE UPDATE anterior TR_IM_AT_WEBHOOK_WRITE ordena antes que
TR_IM_INGRESS_RECEIPT_WRITE por nombre. Ambos retornan NEW sin reescribir los
campos técnicos; el nuevo no sustituye la protección de correlación anterior.
No existen aquí triggers de autenticación ni claims de serialización derivados
sólo de ese orden. Replication-role, DISABLE TRIGGER, DROP/ALTER, restauraciones
privilegiadas y cambio de funciones pueden eludirlos; T1 exige operadores confiables.

## 10. Import/export/restore y cuarentena pendiente

El exportador real enumera metadata core con workspaceId y ejecuta SELECT *;
las columnas de sus INSERT proceden de Object.keys de la fila, incluso select:false.
Con esquema instalado exporta ingressContractVersion, sin borrarlo silenciosamente.
Antes del DDL no inventa la columna. Los helpers reales de formato conservan
integer 1/NULL. También exporta un SET session_replication_role='replica': la
reimportación administrativa puede deshabilitar guards. No hay importador específico
de Receipt que reautentique o cuarentene esas filas. El tooling exact-upgrade
inspeccionado sólo lista el archivo pg_restore en su preflight; no se usa ni
modifica y sus gates continúan bloqueados. Las importaciones CRM normales no
constituyen recepción Twilio.

| Operación privilegiada | Obligación previa a reanudar consumidores |
| --- | --- |
| Backup confiable | Conservar versión y hecho completos; registrar origen, integridad, esquema y cadena de custodia fuera de este discriminador |
| Datos de otro origen | No readmitir v1 copiado como nueva recepción. Excluir o redactar explícitamente autoridad en una transformación revisada del import; conservar el backup original |
| Restore completo autorizado | Validar custodia, versión de aplicación/DDL, configuración, conexiones, scopes, ledger/originales y trabajo pendiente antes de habilitar entradas/jobs |
| Restore parcial | Cuarentena: no presume completitud de C1 ni correspondencia Receipt/Message/epoch/Outbox; no reanudar trabajos por sólo ver v1 |
| Otro cluster | Validar custodia completa; los marcadores xid8 C2 no tienen identidad global entre clusters. No usar v1 para salvar ese problema |
| Receipts pendientes / leases / jobs existentes | Mantener consumidores detenidos/aislados y revisar recuperación; jobs antiguos pueden reanudarse sin transportar ni inspeccionar la versión |
| Historia C1 incompleta | NOT_READY; no reconstruir ausencia, epoch, hechos o originales desde v1 |

Estos son requisitos de procedimiento, **no una cuarentena físicamente implementada**.
La fuente segura disponible aquí preserva backups, prohíbe promoción ordinaria y
rechaza versiones desconocidas; no puede distinguir un import privilegiado que
copió v1 sin custodia. Contrajemplo T1 explícito: restaurar SQL con v1 copiado y
reanudar consumidores sin revisión conserva ese número. El procedimiento debe
impedir esa readmisión; R2 no instala automáticamente esa barrera. No se ejecutó
export/import ni se alteraron respaldos.

## 11. Errores y commit

SQL/decoder/configuración/rotación fallidos rechazan la recepción protegida sin
enqueue ni retorno de autorización parcial. El wrapper transaction conserva
rollback/commit del servicio de recepción; las pruebas sólo simulan sus resultados.
Un fallo después de INSERT requiere rollback; un commit indeterminado no se afirma
revertido. Retry HTTP vuelve a verificar y usa la misma key; recovery existente
cubre commit confirmado y enqueue fallido. Una capacidad consumida no se resucita.

No se publica nada en esta ruta ni se crean Message, Epoch, ledger, Outbox o CRM.
Enqueue posterior usa la cola anterior; no se añade consumidor, cola ni publicador.
ACK HTTP sigue significando recepción durable, no atención terminada.

## 12. Inventario de archivos

Se modifican seis tracked, todos dentro del alcance: controller webhook,
providers/messaging-provider.ts (evidencia opcional de transporte), entidad
WebhookReceipt, ingress, receipt service y registro de comandos.

Se crean el nuevo command, este documento y once TypeScript bajo
`src/modules/inconnect-messaging/webhook-ingress/`:

- ingress-contract.ts; inbound-url-policy.ts; authenticated-inbound.ts.
- persist-authenticated-receipt.ts; read-receipt-ingress-contract.ts.
- prepare-provider-connection-mutation.ts.
- __tests__/authenticated-ingress.fixtures.ts; authenticated-ingress.spec.ts.
- __tests__/inbound-controller-policy.spec.ts; receipt-duplicates.spec.ts;
  receipt-ingress-source.spec.ts.

No cambian AGENTS.md, C2-I-A/B/II/III-A, reducer/C1, adaptador firmado, worker,
Send/Dispatch/callback processing, Pending manual, Outbox publisher, frontend,
Record Access, Commercial Teams ni fuentes Enterprise. El controller común
sólo añade captura de evidencia; status/unsupported permanecen legacy.

## 13. Validaciones SOURCE-ONLY

Node Linux v24.16.0. Resultados finales efectivamente ejecutados:

| Validación | Resultado |
| --- | --- |
| Cuatro suites R2 nuevas | **95 PASS**, incluidas en el total y reejecutadas focalmente |
| Total SOURCE-ONLY, lista explícita de 75 archivos | **75 suites / 1.235 PASS**, cero fallos/omisiones |
| Regresiones previas dentro del total | 71 suites / 1.140 PASS: Messaging/F13/media/transportes, C2-III-A/II/I-A/B, B1/R1, C1 y reducer |
| Typecheck completo twenty-server | tsgo --noEmit --incremental false, exit 0 |
| Typed lint explícito tracked | 6 TypeScript, cero errores/warnings |
| Typed lint explícito untracked | 12 TypeScript, cero errores/warnings |
| Formato explícito | 6 tracked + 12 untracked, PASS; configuración temporal permite upgrades |
| Diff lint Nx sin dependencias | PASS; formato de 503 archivos según exclusiones |
| Whitespace | git diff --check, cached y no-index de los 13 nuevos, PASS |

Evidencia: `/tmp/c2-r2-regressions-final.json` y `.log`,
`/tmp/c2-r2-focal-final.json` y `.log`, `/tmp/c2-r2-typecheck-final.log`,
`/tmp/c2-r2-lint-{tracked,untracked}.log`,
`/tmp/c2-r2-format-{tracked,untracked}.log` y `/tmp/c2-r2-diff-lint.log`.
La lista exacta de suites se conserva en `/tmp/c2-r2-regression-paths.json`;
ninguna termina en .postgres.spec.ts ni es integración/reset.

Jest ejecuta código real de ingress/controller/routing/proveedor/persister con
SDK Twilio local; dependencias SQL/cola/descifrado se simulan. Ninguna atestación
positiva depende de un fixture cuyo verificador devuelva simplemente true.

Las pruebas cubren firma/origen/puerto/path/query/form/encoding/Unicode, campos
desconocidos firmados, capacidad auténtica/falsa/scope/snapshot, legacy, NULL/v1,
conflictos, PROCESSED, rotación/revocación visible y brecha no serializada,
SQL/commit, pre-DDL/parcial, gates, versiones/reinicio, SQL/metadata/guards,
backup y ausencia de integración. Regresiones incluyen Receipt/ingress/routing/
Twilio/media/F13, C2-III-A/II/I-A, C1 y reducer, sin .postgres.spec.ts ni reset.

La primera regresión extensa detectó un fallo introducido por structuredClone:
el SDK utiliza instanceof Array y, dentro de Jest, los arrays clonados por esa
primitiva pertenecen a otro realm. Se sustituyó por copia explícita de parámetros
y arrays; se conservó la prueba R1 y el orden/multiplicidad legacy, sin cambiar
la prohibición escalar v1. La regresión final completa pasó después de la corrección.
Typecheck detectó además inferencia de una marca privada en un const exportado;
se precisó el contrato de salida y se usó una declaración de función para el
helper. No se modificó ninguna fuente aceptada para resolver las validaciones.

Comandos principales desde twenty-server, con el Node Linux indicado en PATH:

```sh
../../node_modules/.bin/jest --config jest.config.mjs --runInBand --runTestsByPath <las 75 rutas de /tmp/c2-r2-regression-paths.json> --json --outputFile /tmp/c2-r2-regressions-final.json
../../node_modules/.bin/jest --config jest.config.mjs --runInBand src/modules/inconnect-messaging/webhook-ingress --json --outputFile /tmp/c2-r2-focal-final.json
../../node_modules/.bin/tsgo --noEmit --incremental false
```

La lista de 75 rutas se pasó mediante subprocess con argumentos estructurados,
sin interpolación del contenido a shell. Desde raíz: oxlint --type-aware con
-c packages/twenty-server/.oxlintrc.json, listas tracked/untracked separadas;
oxfmt --check con configuración temporal equivalente sin exclusión de upgrades;
NX_DAEMON=false NX_ISOLATE_PLUGINS=false y directorios de caché/data en /tmp para
`nx run twenty-server:lint:diff-with-main --excludeTaskDependencies`.
Ese target usa main...HEAD y no cubre el trabajo actual: los 18 TypeScript tienen
además checks explícitos. Markdown está excluido de oxfmt; se revisó estructura
y whitespace sin alterar la configuración del repositorio.

| Requisitos de pruebas del pedido | Evidencia / límite |
| --- | --- |
| 1–10, URL/form/firmas | Controller/Express y verificador Twilio reales; políticas negativas y Unicode positivo sin red |
| 11–15, capacidad/API | WeakMap real, falsificación/copia/snapshot/scope y persister legacy sin versión |
| 16–21, nuevos/duplicados/historia | INSERT emitido y original completo validado; no promoción ni cambio de PROCESSED |
| 22–27, conexión/errores | Disabled/rotación, intercalación visible, contraejemplo de brecha después de última SELECT, errores SQL/commit y no-promoción |
| 28–31, guards/backup | Metadata TypeORM real y SQL fuente: no ejecución de triggers, DELETE/TRUNCATE ni import real; formato de backup conserva versión |
| 32–36, compatibilidad/gates/reinicio | Pre-DDL/parcial, DISABLED/PREPARING/SUSPENDED/ENABLED, decoder y serialización/relectura de versión; sin admisión nueva |
| 37–40, fronteras | Transporte externo que lanza ante llamada, worker sin wiring, módulo sin policy provider y Git sin cambios C1/reader/writer/reducer; no tracking |

## 14. Garantías de fuente y bloqueos físicos

Se acreditan verificaciones/captura de código, bytes de inputs del verificador,
SQL parametrizado emitido, orden de llamadas, decoder, metadata/SQL ORM dormante,
no-promoción y ausencia de wiring nuevo por defecto. La comparación de fuente
no demuestra instalación ni ejecución real de constraints/triggers/cascadas.

No se acreditan mediante mocks: locks/revocación física, snapshots reales,
visibilidad ON CONFLICT con dos sesiones, row envelopes del driver PostgreSQL,
commit/rollback/caídas, catálogos/paridad instalada, DateStyle/encoding reales,
planes/coste, roles/grants, proxy/TLS desplegados, restore/custodia o cuarentena.
No se prueba resistencia T2. UP/DOWN, driver, constraints y todos esos casos
requieren aceptación PostgreSQL aislada específicamente autorizada.

## 15. Obligaciones para admisión recuperable y caller posterior

El futuro consumidor deberá combinar versión soportada con hecho íntegro y
scope exacto, Receipt PROCESSING/lease vigente bajo lock, conexión actualmente
habilitada, routing/configuración suficientes, Message causal concordante y su
epoch original, gate/epoch READY y facts completos del reader. V1 no autentica
humanos, no concede CRM ni sustituye permisos/Record Access.

Conservar Configuration SHARE → Conversation UPDATE → Epoch → Receipt UPDATE
→ Message → ledger; estos locks deben preceder INSERT Message. Reader/writer y
reducer aceptados no cambian. eventKey continúa por WebhookReceipt.id y effectKey/
fingerprint por Message conforme C1. Implementar lifecycle de Conversation/Epoch,
composición causal única, finalización scoped con affected, originales/replay y
commit ambiguo sigue pendiente. Tampoco se instala consumidor Outbox de atención.

## 16. Cierre de la entrega original y solicitud de revisión

Entrega R2 SOURCE-ONLY con emisión y contrato durable preparados, apagados por
defecto; proxy y protocolo integral de revocación/restore permanecen delimitados.
Se solicita auditoría independiente de la capacidad, contrato v1, política directa
TLS, compatibilidad pre-DDL, SQL/duplicados/inmutabilidad y límites T1.

Git final: misma rama y HEAD del preflight; **6 tracked modificados y 13 archivos
nuevos untracked**, staging vacío. `git diff --stat` tracked: 98 inserciones y
30 eliminaciones; no incluye los nuevos, inventariados y comprobados por separado.
No se añadió nada al índice. Los paths fuera de los seis tracked permitidos,
incluidos AGENTS.md, contratos/implementaciones aceptados y command 1792540800000,
permanecen sin modificaciones.

No se hizo commit ni Git write, conexión PostgreSQL/SQL real, Fast Command,
migración, setup/reset, red Twilio, servidores/workers/Redis, despliegue, tracking,
Epoch real o roles/grants. PG0, PG1, Stage C5 y exact-upgrade siguen bloqueados.
No se inicia R3, B2 ni C.

## 17. Remediación focal P2-SCHEMA-01 — 2026-10-22

El detector original admitía triggers con la misma identidad y máscara nominal,
pero limitados por `UPDATE OF` o `WHEN`. `tgtype` no representa esas restricciones;
omitir `tgattr` y `tgqual` producía falsa compatibilidad. El Fast Command
`1792666800000` ya crea correctamente los dos triggers sin esas cláusulas y no
se modifica.

La única modificación de producción está en `persist-authenticated-receipt.ts`,
en el WHERE común de `pg_trigger`, antes de las alternativas WRITE/TRUNCATE:

```sql
AND cardinality(tgattr::smallint[]) = 0
AND tgqual IS NULL
```

Se conservan tabla, nombre, función, máscara, habilitación O/A, exclusión de
triggers internos, columna integer nullable sin default y CHECK validado.
`UPDATE OF` deja elementos en `tgattr` y se rechaza. Cualquier `WHEN`, incluso
`WHEN (true)`, deja `tgqual` no NULL y se rechaza. El DDL nominal cumple ambas
condiciones. La contradicción sintética de columnas en un trigger TRUNCATE
también se rechaza; no se afirma que PostgreSQL permita crearla mediante DDL.

Se consultaron las fuentes primarias de PostgreSQL:
[pg_trigger](https://www.postgresql.org/docs/16/catalog-pg-trigger.html),
[cardinality](https://www.postgresql.org/docs/16/functions-array.html),
[CREATE TRIGGER](https://www.postgresql.org/docs/16/sql-createtrigger.html),
[tipos de catálogo](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/include/catalog/pg_type.dat)
y [coerción de arrays](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/backend/parser/parse_coerce.c).
`tgattr` es `int2vector`, con elementos int2; el cast explícito a `smallint[]`
permite contar elementos. `cardinality` devuelve integer 0 para un array vacío,
independientemente de sus límites; no se compara texto con `'{}'` ni se interpreta
la serialización del vector. `tgqual` es `pg_node_tree` nullable: sólo NULL indica
ausencia de condición. El mock modela elementos numéricos y condición opaca; no
simula conversiones ni afirma haber obtenido resultados de un driver real.

Se revisaron los demás atributos del CREATE TRIGGER aprobado. Las máscaras 31/34
ya fijan BEFORE, eventos y granularidad ROW/STATEMENT. Un CONSTRAINT trigger exige
AFTER ROW, por lo que no puede introducir aplazamiento conservando esas máscaras;
REFERENCING de transition tables también requiere AFTER. Los cuerpos nominales
no consultan TG_ARGV/TG_NARGS: argumentos adicionales no abren una ruta para omitir
el guard. El origen de un clon (`tgparentid`) tampoco condiciona su ejecución.
No se identificó otro contraejemplo legal del mismo tipo que exigiera ampliar
esta corrección. Esto no certifica cuerpos alterados, corrupción privilegiada
del catálogo ni resistencia T2.

Las nuevas pruebas son `receipt-schema.spec.ts` y `receipt-schema.fixtures.ts`.
El runner coteja la forma SQL de catálogo y todos los parámetros de las consultas
admitidas. Calcula el resultado desde filas sintéticas de pg_attribute,
pg_trigger y pg_constraint; no recibe un booleano compatible prefijado. Su modelo
acotado interpreta las dos conjunciones nuevas para que retirarlas reproduzca la
admisión falsa. No es un parser SQL general ni un motor PostgreSQL.

| Requisitos adversariales del pedido | Cobertura focal |
| --- | --- |
| 1, 6 | Nominal con vector vacío/NULL y habilitación O/A; contraste literal de ambos CREATE TRIGGER |
| 2, 3 | WRITE UPDATE OF ingressContractVersion, normalizedMetadata y varias columnas |
| 4, 5 | WRITE WHEN false y otra condición, WHEN true |
| 7 | TRUNCATE con lista de columnas contradictoria y WHEN false/true |
| 8–11 | Cada trigger ausente, deshabilitado/replica, función, máscara, tabla, nombre o carácter interno incorrectos |
| 12 | CHECK ausente/no validado y clase, nombre o tabla incorrectos |
| 13 | Ausencia genuina de columna: PRE_DDL y SQL legacy sin versión |
| 14–16 | Instalación parcial, resultado vacío/múltiple/incompleto/tipos inválidos y excepción SQL |
| 17, 18 | Cada rechazo de catálogo comprueba cero INSERT, fallback, commit o enqueue |
| 19, 20 | Original NULL sin promoción; duplicado v1 conserva identidad, hecho e idempotencia |

La comparación antes/después usa una transformación Jest exclusivamente en la
caché local que retira las dos líneas de la fuente al compilarla en memoria.
No se restaura ni reescribe ningún archivo aprobado para simular el detector
original. Las ejecuciones comparativas no se suman como pruebas independientes.

Resultados efectivamente ejecutados con Node Linux v24.16.0:

| Validación de esta remediación | Resultado |
| --- | --- |
| Detector original, mismas 49 pruebas mediante transformación en memoria | **8 FAIL reproducidos / 41 PASS**; los ocho fallos son las variantes UPDATE OF/WHEN |
| Detector reparado, nueva suite focal | **49 PASS**, incluida en los totales siguientes |
| Cuatro suites R2 originales | **4 suites / 95 PASS** |
| Focal webhook-ingress, originales más nueva suite | **5 suites / 144 PASS** |
| Regresiones originales | **75 suites / 1.235 PASS**, sin omisiones ni regresiones |
| Total único, regresiones más nueva suite | **76 suites / 1.284 PASS**, cero fallos/omisiones |
| Typecheck completo twenty-server | `tsgo --noEmit --incremental false`, exit 0 |
| Typed lint de los tres TypeScript afectados | Cero errores/warnings |
| Formato explícito de esos tres archivos | PASS |
| Diff lint Nx sin dependencias | PASS: typed lint de 545 archivos; formato de 503 |
| Whitespace tracked, cached y los 15 untracked | PASS |

La regresión incluye B1/R1, C2-III-A/II/I-A/B, C1/reducer,
Webhook/Receipt/ingress, Twilio/routing y media/F13. No se ejecutan suites
`.postgres.spec.ts` ni integración/reset. Los 92 casos del arnés externo de la
auditoría anterior son evidencia histórica; no se suman al total de esta ejecución.

Evidencia local ignorada por Git en `node_modules/.cache/c2-schema-01/`:
`regression-paths.json`, `regressions.json`/`.log`, `r2-focal.json`/`.log`,
`original-tests.json`/`.log`, `original-transform.cjs`,
`original-jest.config.mjs`, `typecheck.log`, `typed-lint.log`, `format.log`,
`diff-lint.log` y `remediation.patch`. Se utilizó caché persistente después de
interrupciones que descartaron los archivos temporales en /tmp. El target Nx
usa main...HEAD; los archivos actuales tienen además validaciones explícitas.

Git final: `feature/inconnect-lead-management`, HEAD
`f01a6a63c9faa81195cc9338b0552bac0153f4ff`, staging vacío, los mismos seis tracked
modificados y **15 untracked** (los 13 originales más las dos nuevas fuentes de
pruebas). El diff tracked continúa en 98 inserciones/30 eliminaciones y no incluye
los untracked. El cambio de producción de esta remediación añade exactamente dos
líneas al detector; sólo se añaden esas dos fuentes de pruebas y se actualiza
este documento. Se conserva el resto del trabajo R2; no hay Git writes ni commit.

El alcance sigue siendo SOURCE-ONLY: no se conecta PostgreSQL, ejecuta SQL real,
aplica comandos, inicia servicios ni habilita tracking. Las limitaciones de
§14–15 y los gates operativos permanecen. Esta remediación queda sujeta a una
nueva revisión independiente focal; no acepta R2 ni inicia B1-R3.
