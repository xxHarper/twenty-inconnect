# INCONNECT Lead Management — Fase 1B-1A

Fecha: 2026-10-19. Rama: `feature/inconnect-lead-management`.
HEAD de entrada: `cb7271ca0c7107f7fb3ae1d02b9d2a8ffbc58993`.
Preflight: worktree limpio, sin staging. Git utilizado exclusivamente en lectura.

Implementado y validado **SOURCE-ONLY**: motor puro de planificación TypeScript.
No está registrado en Nest ni conectado a ningún flujo de ejecución. No transfiere
Owners, concede permisos, consulta infraestructura ni cambia Messaging.
No se inició Fase 1B-1B. PG0, PG1 y exact-upgrade continúan bloqueados.

## Entrada y salida

Entrada pública: `buildLeadDistributionPlan(input, limits)`, exportada por
`src/modules/inconnect-lead-management/distribution/index.ts`.

| Contrato | Contenido |
| --- | --- |
| `LeadDistributionScope` | `workspaceId + objectMetadataId`: un único ámbito por plan |
| `LeadIdentity` | Tupla canónica `workspaceId + objectMetadataId + recordId` |
| `LeadDistributionSelection` | `recordId`, `currentOwnerWorkspaceMemberId: UUID \| null`, `category` |
| `LeadDistributionRecipient` | `workspaceMemberId` del destinatario seleccionado |
| `LeadCategory` | Exclusivamente `NORMAL \| MESSAGE_PENDING`, un valor por Lead |
| `LeadDistributionInput` | Unión discriminada por `SINGLE \| EVEN \| MANUAL_QUOTAS` |
| `LeadRecipientQuota` | Destinatario y cantidades explícitas para ambas categorías |
| `LeadDistributionLimits` | `maxLeads`, `maxRecipients`, obligatorios y sin defaults |
| `PlannedLead` | Identidad completa, categoría y Owner esperado, incluso para restantes |
| `PlannedLeadAssignment` | Añade `recipientWorkspaceMemberId` al Lead planificado |
| `LeadDistributionPlan` | Cambios, conservados, restantes, contadores globales, por categoría y destinatario |

Los UUID se validan con la dependencia OSS `uuid` existente y se normalizan a
minúsculas. Los IDs son exclusivamente identidades lógicas: el motor no contiene
nombres de objetos, tablas, campos físicos, usuarios ni referencias a fixtures
operativos. Validar la sintaxis de un UUID no comprueba su existencia, workspace,
tipo de objeto ni elegibilidad; esas comprobaciones corresponden al futuro caller.

La validación runtime es estricta con Zod: rechaza propiedades ajenas al contrato,
Owners omitidos, categorías inválidas/ambiguas, UUID inválidos y duplicados incluso
si difieren en mayúsculas o categoría. La selección comparte el ámbito declarado;
el caller debe garantizar que cada registro pertenece realmente a ese ámbito.
Los tipos de entrada y salida son readonly. Se copian los objetos de entrada;
el resultado no comparte referencias mutables con ellos. No se congela el resultado
en runtime ni se presenta como un artefacto firmado o una capacidad de escritura.

## Modalidades y conjuntos vacíos

| Modalidad | Regla |
| --- | --- |
| `SINGLE` | Exactamente un destinatario, incluso con cero Leads. Distribuye toda la selección. |
| `EVEN`, `balanceBy: TOTAL` | Cuotas totales floor/ceil por destinatario sobre la selección completa. |
| `EVEN`, `balanceBy: CATEGORY` | Cuotas floor/ceil independientes por categoría, sin compensar cantidades entre categorías. |
| `MANUAL_QUOTAS` | Exactamente una cuota por destinatario seleccionado, con ambas categorías explícitas. Puede consumir sólo parte del conjunto. |

EVEN requiere elegir explícitamente TOTAL o CATEGORY. TOTAL no promete equilibrio
por categoría. CATEGORY puede producir diferencias de hasta dos Leads en los
totales entre destinatarios porque hay dos residuos independientes; no modifica
las cuotas de una categoría para corregir el total. El equilibrio se calcula sobre
la selección, sin consultar ni balancear la cartera histórica de cada ejecutivo.

EVEN con cero destinatarios deja toda la selección en `remaining`; con cero Leads
devuelve contadores cero. MANUAL_QUOTAS acepta destinatarios y cuotas vacíos y deja
todos los Leads restantes. SINGLE con cero destinatarios rechaza la entrada.
Más destinatarios que Leads es válido: algunos reciben cuota cero. Cuotas manuales
cero también son válidas. Cero Leads con una cuota positiva rechaza por exceso.

Cada cuota y límite debe ser un entero seguro no negativo. Se rechazan cantidades
fraccionarias, negativas, NaN, infinitas y sumas que excedan los disponibles de su
categoría. La comprobación de disponibilidad usa resta para evitar overflow.
No se completan cuotas de MESSAGE_PENDING con NORMAL, ni viceversa. Una cuota de
un destinatario no seleccionado, repetida o ausente invalida todo el plan.

Los límites son decisiones explícitas del caller, sin máximos propuestos convertidos
en constantes de producto. Se comprueba la longitud de cada array antes de validar
sus elementos. No son límites de bytes, tiempo de ejecución, volumen SQL ni tamaños
de chunks de la futura integración.

## Algoritmo, orden y minimización

Versión: `algorithmVersion: 1.0.0`. Orden: `CANONICAL_UUID_ASC`.
Primero se normalizan y ordenan Leads por recordId y destinatarios por UUID,
mediante comparación lexicográfica independiente de locale. Las listas finales de
cambios, conservados y restantes mantienen ese orden de Lead; los resúmenes de
destinatarios mantienen el orden de destinatario. La categoría conserva su valor.
El orden original de Leads, destinatarios y cuotas no influye en el plan.

1. SINGLE utiliza una cuota igual al tamaño del conjunto. MANUAL_QUOTAS utiliza
   las cantidades suministradas, independientemente para cada categoría.
2. EVEN calcula base `floor(N / R)` y residuo `N % R` en el grupo correspondiente.
   Las plazas adicionales favorecen a destinatarios que ya poseen más Leads que
   la base, porque cada plaza permite conservar un Owner adicional. Entre opciones
   de igual ganancia se desempata por UUID ascendente.
3. Se reservan primero todos los Leads cuyo Owner actual coincide con un
   destinatario y cuya cuota aún tiene espacio, en orden de Lead.
4. Los Leads no reservados llenan los déficits en orden de destinatario y Lead.
   El resto queda separado sin recibir destinatario.
5. Se construyen las tres particiones y sus contadores en una pasada final.

Para cuotas fijas, el máximo de Owners conservables es
`sum(min(leadsYaDelDestinatario, cuotaDelDestinatario))`. La reserva alcanza ese
máximo. En EVEN, cada plaza de residuo aumenta esa suma en uno exactamente cuando
el destinatario tiene más Leads propios que la base. Dar primero esas plazas a
los destinatarios que obtienen esa ganancia maximiza conservados entre todas las
cuotas equilibradas. En CATEGORY la prueba se aplica a cada categoría independiente.
En MANUAL_QUOTAS parcial se eligen primero los Leads conservables; no se impone un
prefijo de selección que obligue a transferir otros innecesariamente.

Para N Leads y R destinatarios, con dos categorías fijas: tiempo
**O(N log N + R log R)** y memoria adicional **O(N + R)**. La validación y asignación
son lineales; las ordenaciones dominan. No hay búsquedas anidadas por destinatario
y Lead en producción. Las búsquedas exhaustivas sólo existen en los tests.

`distributed = changed + unchanged`; `selected = distributed + remaining`.
`changes`, `unchanged` y `remaining` son disjuntos y cubren la selección completa.
Un Lead conservado ocupa cuota y cuenta como distribuido. Un restante no cuenta
como conservado aunque mantenga su Owner en la realidad. En el resumen de cada
destinatario, `selected = distributed` y `remaining = 0`: ese resumen sólo cuenta
los Leads que recibe; los restantes pertenecen al conjunto global.

Errores tipados mediante `LeadDistributionError.code`: `INVALID_INPUT`,
`INVALID_LIMITS`, `DUPLICATE_LEAD`, `DUPLICATE_RECIPIENT`, `INVALID_QUOTAS`,
`QUOTA_EXCEEDS_AVAILABLE`. No se devuelve un plan parcial ante errores.

## Pruebas y validación ejecutada

**3 suites / 76 tests PASS**, sin omitidos. Las pruebas cubren los trece grupos
solicitados: SINGLE individual/masivo, EVEN divisible/con residuo, categorías,
cuotas parciales y excesivas, Owners conservados, cambios mínimos, determinismo,
identidades inválidas/duplicadas, vacíos, más destinatarios que Leads, contadores,
categorías ambiguas y partición única de todos los Leads. Incluyen el ejemplo
20/5, 15/10 y 25/5 con 20 Leads restantes y arrays de entrada congelados.

El oráculo independiente enumera destinos posibles y compara contra el mínimo de
transferencias: **781 configuraciones TOTAL + 512 CATEGORY + 640 MANUAL_QUOTAS =
1,933 configuraciones** pequeñas. También comprueba aislamiento, Owners esperados,
categorías, destinatarios permitidos y consistencia de contadores. El argumento
anterior explica la propiedad general; la enumeración es evidencia finita.

| Comprobación | Resultado |
| --- | --- |
| Jest focal sin infraestructura | 3 suites / 76 tests PASS |
| Typecheck completo del servidor, `tsgo --noEmit --incremental false` | PASS |
| Typed lint directo de los 10 archivos TypeScript nuevos | PASS, 0 errores / 0 warnings |
| `nx run twenty-server:lint:diff-with-main --skip-nx-cache` | PASS |
| Formato focal | PASS |
| `git diff --check` y whitespace de todos los archivos nuevos | PASS |

El lint de rama compara `main...HEAD` y no cubre untracked; por eso se ejecutó
también lint directo. Nx emitió su aviso histórico de tarea flaky en el build de
reglas, pero el build y el target finalizaron con éxito. El typecheck ejecutó el
compilador configurado del servidor directamente, sin arrancar servicios ni
encadenar builds de aplicaciones. La primera ejecución de Jest encontró un error
del arnés en `it.each` con una fila vacía interpretada como callback `done`; se
corrigió el dato parametrizado y la ejecución final pasó completa.

Node local v24.16.0 añadido al PATH. Comandos principales desde la raíz:

```bash
node_modules/.bin/jest --config packages/twenty-server/jest.config.mjs --runInBand --runTestsByPath packages/twenty-server/src/modules/inconnect-lead-management/distribution/__tests__/build-lead-distribution-plan.spec.ts packages/twenty-server/src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution-validation.spec.ts packages/twenty-server/src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution-optimality.spec.ts
node_modules/.bin/tsgo -p packages/twenty-server/tsconfig.json --noEmit --incremental false
NX_DAEMON=false NX_ISOLATE_PLUGINS=false node_modules/.bin/nx run twenty-server:lint:diff-with-main --skip-nx-cache
node_modules/.bin/oxlint --type-aware -c packages/twenty-server/.oxlintrc.json packages/twenty-server/src/modules/inconnect-lead-management/distribution
git diff --check
```

El lint directo se ejecutó desde `packages/twenty-server` con su configuración
local. Logs temporales: `/tmp/inconnect-1b-1a-jest-final.log`,
`/tmp/inconnect-1b-1a-typecheck-final.log`, `/tmp/inconnect-1b-1a-lint-final.log`,
`/tmp/inconnect-1b-1a-diff-lint.log`, `/tmp/inconnect-1b-1a-format.log` y
`/tmp/inconnect-1b-1a-whitespace.log`.

## Contrato requerido para futura clasificación desde Messaging

Una futura capa backend autorizada debe entregar una selección deduplicada de un
único workspace/objeto, con UUID de registro, Owner observado explícito o null y
exactamente una categoría confiable por registro. Debe resolver autorización de
lectura, selección y clasificación, vigencia de metadatos y elegibilidad de los
destinatarios antes de invocar el motor. No debe aceptar una clasificación de un
cliente como si fuese autoridad del servidor. El motor valida estructura y
coherencia local; no puede certificar la procedencia autorizada de esos datos.

Semántica funcional confirmada para el futuro estado de atención:

- Un WhatsApp entrante marca la conversación pendiente de atención.
- Leer no cierra ese pendiente.
- Una respuesta humana exitosa lo cierra automáticamente; una automática no.
- El ejecutivo puede marcar pendiente manualmente y otro entrante vuelve a abrirlo.
- Unread personal y Pending compartido son conceptos distintos.

Estas transiciones **no se implementaron**. El motor no importa Messaging, consulta
Conversations ni recibe Unread como señal. No deriva MESSAGE_PENDING de una
notificación de lectura. La futura capa debe decidir explícitamente la agregación
por Lead cuando existan varias Conversations, ausencia de vínculo, información
desconocida o clasificación concurrente; aquí no se inventa ninguna regla. Una
categoría desconocida debe resolverse o rechazarse antes de planificar, nunca
convertirse silenciosamente a NORMAL ni contarse en dos categorías.

## Límites, riesgos y siguiente subfase recomendada

El plan representa únicamente el snapshot suministrado. No incluye expiración,
firma, persistencia, auditoría, idempotencia, transacciones, locks, ejecución de
transferencias o revalidación de cambios de Owner/categoría/destinatario. El Owner
esperado se conserva como dato para una futura comprobación de concurrencia,
pero esta fase no implementa dicha comprobación. Un plan jamás sustituye permisos
actuales de objeto/campo, Record Access ni Owner Integrity.

Pendientes: acordar máximos operativos y límites en bytes, contrato de agregación
de atención por Lead, vigencia de selección/previsualización, cambios concurrentes,
atomicidad del lote, reintentos, resultados parciales, chunks y auditoría. La
ordenación por UUID es determinista y puede favorecer los mismos IDs en empates;
no es rotación entre ejecuciones ni distribución inteligente. No se equilibra
cartera histórica. Cambiar el desempate o significado de cuotas requiere revisar
la versión del algoritmo. La validación física pendiente de 1A no se cierra aquí.

Siguiente paso recomendado, sujeto a una nueva solicitud: revisar y fijar el
contrato de selección autorizada, vigencia y concurrencia de la siguiente subfase
antes de integrar el ejecutor. Definir por separado la futura clasificación desde
Messaging. No se avanzó automáticamente a ninguna integración ni a 1B-1B.

No hubo cambios en Messaging/Pending, entidades, campos Lead, PostgreSQL, GraphQL,
jobs, workers, UI, Roles, permisos, Record Access o Enterprise RLS. No se consultó
ni reutilizó código Enterprise. No se iniciaron servidores, servicios, consumidores,
migraciones, init/reset ni pruebas físicas.

## Inventario y estado Git completo

Once archivos nuevos; ningún archivo existente modificado. Los diez TypeScript
están bajo `src/modules/inconnect-lead-management/distribution/`:

| Archivo | Propósito |
| --- | --- |
| `lead-distribution.types.ts` | Contratos readonly de entrada y previsualización |
| `lead-distribution-error.ts` | Códigos de error tipados |
| `normalize-lead-distribution-input.ts` | Validación estricta, canonicalización, límites y duplicados |
| `allocate-lead-quotas.ts` | Cuotas equitativas y asignación con conservación óptima |
| `build-lead-distribution-plan.ts` | Orquestación pura, particiones y contadores |
| `index.ts` | Exports públicos |
| `__tests__/lead-distribution.fixtures.ts` | Identidades sintéticas y helpers puros de test |
| `__tests__/build-lead-distribution-plan.spec.ts` | Casos funcionales |
| `__tests__/lead-distribution-validation.spec.ts` | Rechazos y fronteras de entrada |
| `__tests__/lead-distribution-optimality.spec.ts` | Oráculo exhaustivo y aislamiento |
| `docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1B_1A.md` | Este informe, fuera del directorio de código |

`git status --short --untracked-files=all`:

```text
?? packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_PHASE_1B_1A.md
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/__tests__/build-lead-distribution-plan.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution-optimality.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution-validation.spec.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution.fixtures.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/allocate-lead-quotas.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/build-lead-distribution-plan.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/index.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/lead-distribution-error.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/lead-distribution.types.ts
?? packages/twenty-server/src/modules/inconnect-lead-management/distribution/normalize-lead-distribution-input.ts
```

`git diff`, `git diff --stat` y `git diff --cached`: vacíos, porque todo el trabajo
es untracked. El diff completo que incluye los once archivos nuevos se entrega en
`/tmp/inconnect-1b-1a-final.diff`, obtenido con `git diff --no-index` contra
`/dev/null` para cada archivo; no usa ni modifica el índice. Estado íntegro y
estadísticas de ese patch: `/tmp/inconnect-1b-1a-git-status.txt`.
Estos artefactos y logs son temporales. No hubo ramas creadas, staging, commits,
push, merge, fetch ni otra operación que altere el estado Git.
