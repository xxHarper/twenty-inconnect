# Twenty INCONNECT — estado canónico del proyecto

Checkpoint del **2026-11-10**, America/Mexico_City. Checkout de aquel registro en
`feature/inconnect-lead-management`, HEAD
`6b30325a2e3c06be23c2c6740cf397f694efdd8a`, índice vacío y sin cambios en
archivos versionados. El único archivo sin seguimiento era
`packages/twenty-docker/inconnect-staging/__pycache__/test_prepare_staging_build.cpython-314.pyc`.
Se revisaron fuentes, commits y registros existentes en modo lectura, sin
repetir pruebas ni inspeccionar servicios o infraestructura.

Este documento reemplaza las etiquetas de estado anteriores cuando existe
la evidencia aquí identificada. Los contratos técnicos permanecen obligatorios;
una aceptación nunca levanta gates de ejecución. «Fuente implementada»,
«ACCEPTED SOURCE-ONLY», «demostración visual», «validación física de desarrollo»,
«instalado en un entorno», «activado» y «desplegado» son afirmaciones distintas.
La evidencia física describe el entorno y el momento de su comprobación.

## Checkpoint del 10 de noviembre de 2026

### INSTALL-F1 · corrección SOURCE-ONLY

El commit `24deec2f970d1d0369beb4c331b8e185c67cccd9` corrige en fuente la
colisión entre la creación de la tabla de metadata por TypeORM y la migración
Core histórica que crea esa misma tabla. El tramo histórico usa un DataSource
temporal sin entidades y conserva una transacción por migración. Fast/Slow
conserva su runner. Los registros locales en `.cache/install-f1-20261105/`
acreditan cinco suites focales y 46 pruebas aprobadas con transporte de
PostgreSQL simulado, incluido el caso de regresión con el ejecutor real de
TypeORM. También registran lint focal y de diff, typecheck, formato y whitespace.
Quedan pendientes la comprobación física del SQLSTATE 42P07 y la validación del
bootstrap completo. El Store del distribuidor sigue como propuesta SQL inerte
sin vía de instalación autorizada bajo los gates vigentes. [INSTALL-F1](INCONNECT_INSTALL_F1.md)

### STAGING-S0 · Compose preparado en fuente

El commit `51ead3881fa18ccc0feb1d0afe8e1dd46483c27a` añade el Compose de
staging. Con entradas válidas y sin perfiles seleccionados, el arranque
predeterminado selecciona cero servicios. Si se selecciona la aplicación, su
perfil `staging-app-blocked` sustituye el entrypoint por una salida con error
y vacía el comando. Esta barrera es explícita e independiente de los flags de
migración y cron. S0 acredita configuración en fuente. [Diseño S0](../../twenty-docker/inconnect-staging/README.md)

### STAGING-S1 · servicios de datos en Proxmox

Según el reporte del checkpoint S1, en la VM Proxmox existente se iniciaron y
comprobaron físicamente PostgreSQL y Redis de staging. El reporte describe una
red Docker interna, sin puertos publicados para los almacenes, y configuración
dedicada y aislada de los servicios productivos. El Compose respalda ese
diseño. La evidencia operativa se atribuye al reporte histórico facilitado para
esta sincronización. El estado actual de los contenedores y el perímetro
efectivo de la VM quedan sin comprobación en esta revisión.

### STAGING-S2 y STAGING-S2-R1 · entradas del build

- **S2.** El commit `e499bb29c08a363745ef9a8dc2d675834ca62df5` prepara
  el contexto del fork fijado a `51ead3881fa18ccc0feb1d0afe8e1dd46483c27a`
  y la receta de build. El registro local
  `.cache/inconnect-staging-s2-20261105.4sBFm3/final-static.log` corresponde
  a S2 inicial y documenta la revisión estática de la receta y del contexto.
- **S2-R1.** El commit `8c5fc5bacdaba2699d48c606b1ea251d68d641e1` corrige
  las continuaciones del bloque APK en el Dockerfile generado e incluye una
  [prueba de regresión](../../twenty-docker/inconnect-staging/test_prepare_staging_build.py).
  La corrección y la prueba constan en fuente. La validación estática de R1
  fue reportada en la entrega. El registro local identificado para S2
  precede a esa corrección.
- **Preparación reportada en Proxmox.** Se transfirió el contexto corregido
  y se verificó su SHA-256. Se descargaron las imágenes Node y BuildKit fijadas
  por digest y un conjunto de 26 paquetes APK. Se reportaron verificación de
  integridad y firmas de los paquetes y una simulación offline de instalación
  satisfactoria. Estos resultados proceden del reporte facilitado para esta
  sincronización. Los manifiestos y registros de Proxmox correspondientes
  quedan sin cotejo local.
- **Pendiente.** El build de la imagen de Twenty sigue sin ejecutarse según
  el checkpoint. Queda por verificar la aprobación del snapshot APK, cerrar
  los manifiestos definitivos y confirmar la preparación completa del builder.
  La descarga y la verificación reportadas acreditan sólo la preparación
  descrita. La aprobación del snapshot y la reproducibilidad del build
  requieren evidencia propia. El checkpoint de staging registra que Nest y
  el worker siguen sin arrancar y que el bootstrap, las migraciones y la
  instalación del Store siguen sin ejecutarse. [Procedimiento S2](../../twenty-docker/inconnect-staging/STAGING-S2.md)

### DEMO-A1–A5 · demostración visual con Storybook

El commit `6b30325a2e3c06be23c2c6740cf397f694efdd8a` contiene las 26 rutas del
[inventario de la demo](../../twenty-front/.storybook-demo-a5/GIT.md). Incluye
las configuraciones y las historias nuevas. El editor estándar de Roles ya
estaba versionado. Los registros preexistentes `.cache/demo-*/browser*.log`
documentan la compilación estática probada en Chrome de Windows y el recorrido
de los componentes reales con datos ficticios y operaciones simuladas con
Apollo/MSW. Los builds estáticos y los registros son artefactos locales.

| Etapa | Interfaz o recorrido validado en Chrome |
| --- | --- |
| DEMO-A1 | Commercial Teams. Editor, coordinación y membresías de ejemplo. |
| DEMO-A2 | Record Access y editor estándar de Roles de Twenty. |
| DEMO-A3 | INCONNECT Messaging. Bandeja, historial, estados y contexto CRM. |
| DEMO-A4 | INCONNECT Lead Management. Selección, vista previa y estado de almacenamiento no disponible. |
| DEMO-A5 | Portada ejecutiva navegable con las cinco interfaces anteriores. |

En A4 y A5, la vista previa EVEN de 50 Leads ficticios mostró un reparto
**25/25**, **40 propietarios conservados**, **10 cambios propuestos** y
**0 registros procesados**. La confirmación estuvo deshabilitada. Lead Management
sigue **ACCEPTED SOURCE-ONLY**. Las pruebas de Storybook acreditan el recorrido
visual y las interacciones simuladas. Quedan fuera de su alcance la persistencia
en PostgreSQL, el enforcement de Record Access en el backend, los envíos por
Twilio, las transferencias reales de propietarios, la instalación de F13 y
del Store y el arranque funcional del CRM completo. [Guía](../../twenty-front/.storybook-demo-a5/README.md) ·
[Guion ejecutivo](../../twenty-front/.storybook-demo-a5/GUION.md)

## Resumen por módulo

| Módulo | Fuente / aceptación acreditada | Evidencia física e instalación por entorno | Pendiente / bloqueado |
| --- | --- | --- | --- |
| Record Access / Owner Integrity | Implementado: políticas, SQL ORM v1/v2, Owner, persistencia, modos ENV/transition/database, caches y Settings. Hardening de eventos/Owner: `cb7271ca0c` (2026-10-16); fuente presente en HEAD. | Baseline histórico local `database` del 2026-08-24. DEV-LOCAL-R1 validó Lead con Admin `MANAGED` revisión `1`, en `transition` y con Owner explícito. | Superficies no soportadas siguen denegadas. El alcance físico del 18 de noviembre se limita a DEV-LOCAL-R1. |
| Commercial Teams | Implementado bajo Record Access: administración, membresía, atomic move, cache endurecido y Settings. Contrato conservado del checkpoint histórico. | Baseline local reportado el 2026-08-24; no es aceptación física universal ni inspección actual. | No cambiar Roles por membresía; no rediseño ni despliegue nuevo. |
| Lead Management | **ACCEPTED SOURCE-ONLY — INCONNECT LEAD MANAGEMENT INTEGRATED MVP**, aceptación independiente 2026-10-27, commit `f164bf937a`. | CRUD del Lead base verificado en Chrome en DEV-LOCAL-R1. Para el Distribuidor siguen pendientes el Store, la validación física integral y la activación. | NORMAL/MESSAGE_PENDING NOT_READY; TODOS deshabilitado. |
| Messaging base | Fuente integrada: persistencia, autorización, inbox, manual Pending, Favorite/Unread, media, Send, templates, realtime, context/Settings y linking manual. | Pruebas históricas de desarrollo/disposable de comandos, work-state, context y linking; ver contratos y evidencia histórica. No se inspeccionó instalación actual. | Límites funcionales en backlog; ningún despliegue nuevo acreditado. |
| WhatsApp Attention | Dominio/C1/C2 y capas I-A/I-B/II/III-A/B1/R1–R4 implementadas en fuente. R4 **ACCEPTED SOURCE-ONLY** según commit `0c5936907b` del 2026-10-26. | Gate B registró el Fast del ledger en DEV-LOCAL-R1 con Attention `DISABLED`. Sigue pendiente la aceptación física del comportamiento del ledger/R4. | Worker tracked sin registro/cutover/activación; B1 no completada operacionalmente, B2/C no iniciadas. |
| F13A/B, F13C.2B | Implementado; resolución exacta y create/link normalmente autorizado. | F13B.3 smoke local `default` reportado 2026-09-29. F13C.2B aceptado en PostgreSQL descartable el 2026-10-12. Gate B registró 5698/5700 en DEV-LOCAL-R1 con auto-create desactivado. | F13C.3 conserva sus gates operativos. La ejecución de 5698/5700 en `default` o producción queda sin acreditar. |
| PG0/PG1, Stage C5, exact-upgrade | Tooling PG0 y lifecycle inerte committed; aceptación de fuente lifecycle reconciliada el 2026-10-14/15. | Probes inocuos de namespaces no equivalen a aceptación física PostgreSQL/lifecycle. | **BLOCKED**: ejecución física PG0/PG1, Stage C5 y executor operativo. Sin adaptador live ni aceptación kernel de lifecycle. |
| Telephony REQ-TEL-001 | VOICE-V0-R2 implementado en fuente. | VOICE-V0-R1 instalado y probado en Chrome en DEV-LOCAL-R1. La API comprobada devolvió 404 para el estado R2. | Instalar R2, autorizar la activación y la primera llamada por separado. [Backlog](INCONNECT_PRODUCT_BACKLOG.md) |

## Lead Management integrado — aceptación del 27 de octubre

**ACCEPTED SOURCE-ONLY — INCONNECT LEAD MANAGEMENT INTEGRATED MVP.**

Evidencia contrastada sin reabrir auditorías:

- Commit `f164bf937a5260983778dbca8a3a8e833b2e1bde`, título
  `feat(inconnect): add accepted source-only lead management MVP`.
- [Contrato integrado](INCONNECT_LEAD_MANAGEMENT_INTEGRATED_MVP.md), entrega y
  remediaciones F1–F5/N1/N2. Las etiquetas «pendiente de auditoría» describen
  entregas previas al cierre, no el estado vigente.
- Cierre independiente local preexistente:
  [CIERRE.md](../../../.cache/lead-n1-n2-closure-audit-20261027/CIERRE.md),
  [final-integrity.json](../../../.cache/lead-n1-n2-closure-audit-20261027/final-integrity.json)
  y [evidence-verification.json](../../../.cache/lead-n1-n2-closure-audit-20261027/evidence-verification.json).
  Son evidencia ignorada/local, no requisito de disponibilidad para otro clon.
  Se verificaron **42 hashes** de su inventario contra los archivos del commit,
  sin discrepancias. El veredicto y sus límites quedan persistidos aquí; no se
  ejecutaron sus pruebas otra vez.

Ruta `/inconnect-lead-management`, navegación y pantalla «Distribuidor de Leads»
integradas en fuente. Selección de primeros 50 elegibles consultados al backend,
selección individual/por página explícita hasta 1,000 registros; lista inicial
50, lotes de 1–100 por confirmación (inicial 50). SINGLE, EVEN y MANUAL_QUOTAS
usan un pool explícito sin categorías; no se fabrica NORMAL para invocar el
motor categorizado 1B-1A. No balancea carteras históricas.

Preview backend persistido, confirmación humana, revalidación actual y
transferencia sólo mediante Common Update autorizado. Auditoría, intención
idempotente, expectedVersion, cancelación de pendientes y recuperación explícita
por UUID preservan resultados confirmados y respuesta incierta; cancelar no
revierte lotes anteriores. La recuperación de lectura fallida no crea por sí
sola incertidumbre de escritura ni libera otra intención pendiente.

Se acreditó descubrimiento SOURCE-ONLY de las seis operaciones metadata:
`inconnectLeadPoolCatalog`, `inconnectLeadPoolRecords`, `previewInconnectLeadPool`,
`inconnectLeadPoolOperation`, `executeInconnectLeadPool`, `cancelInconnectLeadPool`.
F1–F5 y N1/N2 cerrados SOURCE-ONLY. Descubrimiento/schema offline no demuestra DI
completa ni endpoint HTTP desplegado.

DDL de operaciones **propuesto**, no instalado por esta aceptación; no es comando
de upgrade registrado. Pruebas físicas PostgreSQL/Core+Workspace/locks/MVCC,
rollback/commit ambiguo, driver, eventos, DI/HTTP/E2E e instalación quedan
pendientes de autorización/aislamiento separados. NORMAL/MESSAGE_PENDING no
cuenta con clasificador operativo autorizado; **Repartir TODOS deshabilitado**.
No hay activación ni despliegue declarado, ni cambios laterales a Folio/Messaging.

## Messaging / Attention — reemplazo del checkpoint 2026-10-19

No se conserva C2-I-A como siguiente fase: los commits posteriores acreditan
implementación de [I-A](INCONNECT_ATTENTION_ADAPTER_C2_I_A.md) (`bf25dcd36e`),
[I-B](INCONNECT_ATTENTION_ADAPTER_C2_I_B.md) (`f143422f59`),
[II](INCONNECT_ATTENTION_ADAPTER_C2_II.md) (`fea20f6015`),
[III-A](INCONNECT_ATTENTION_ADAPTER_C2_III_A.md) (`9454c3f0cf`),
[B1](INCONNECT_ATTENTION_ADAPTER_C2_III_B1.md) /
[R1](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R1.md) (`2013c098f3`),
[R2](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R2.md) (`b28bc9f4b8`),
[R3](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R3.md) (`914df6578f`) y
[R4](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R4.md)
(`0c5936907b61ff1989ffac566e9fb6e036bb6d26`). Son checkpoints de fuente,
no migraciones ejecutadas. Los documentos sucesivos recogen aceptación
comunicada de los anteriores; para R4 el soporte persistente inspeccionado es
el commit que declara aceptación SOURCE-ONLY. No se encontró disponible su
informe independiente temporal en `/tmp`; no se inventa reproducción nueva.

R4 contiene unidad causal inbound completa preparada: Receipt durable v1,
Conversation/Epoch/Message/Attachments, writer/ledger/audit/Outbox y finalización
Receipt en una transacción primaria. PREPARED no equivale a COMMITTED. Un commit
incierto requiere reconciliación, no replay ciego. Existen barreras legacy y
compatibilidad Outbox, pero **el nuevo ejecutor no está registrado como worker
Nest/BullMQ ni liberado en ENABLED**. Esto supera «inbound sin composición de
atención en fuente», pero no acredita atención automática operativa.

La ruta legacy mantiene Pending manual y su API boolean same-value no-op.
Favorite y Unread son independientes. La política aprobada exige inbound único
que abra/renueve PENDING y sólo evidencia autenticada/correlacionada HUMAN
DELIVERED/READ que cierre su revisión cubierta todavía vigente. Leer nunca
confirma atención; TEMPLATE es formato, no HUMAN. Intención/revisión/cobertura
congeladas y epoch/origen immutable impiden que callbacks antiguos cierren una
revisión nueva. [Guardrails completos](INCONNECT_ATTENTION_GUARDRAILS.md).

Send/Dispatch/callbacks y API manual por intención/revisión no están integrados
operativamente con ese cierre. No se autoriza clasificación agregada para el
distribuidor; requiere decisión separada sobre autoridad, múltiples Conversations
y tracking desconocido, ligado por workspace/object/record exactos. Unread,
teléfono y boolean Lead nunca sustituyen shared attention.

Bloqueos retenidos de R4: aceptación PostgreSQL física; cutover de emisión y
procesamiento v1/ENABLED y drenaje legacy; protocolo gate-first de todos los
writers ProviderConnection y revocación; coordinación outbound/manual;
custodia/restore, monitoreo y recuperación. Revisión de fuente aceptada no cierra
esos bloqueos ni inicia B2/C. PostgreSQL es la única autoridad de ledger;
Redis/caches/realtime/BullMQ nunca prueban completitud ni idempotencia.

## F13 y gates operativos retenidos

[F13/ORM](INCONNECT_F13_AND_ORM_CONTRACT.md) conserva `effectiveEnabled =
autoCreateEnabled && readiness === READY_FOR_RUNTIME`, autoridad técnica ordinaria,
Owner independiente y misma transacción Core/Workspace. UNIQUE existente enlaza;
NO_MATCH fresco crea sólo enabled/ready; inválido/ambiguo/not-ready queda sin
asignar; nunca relink. La aceptación física de desarrollo de 2026-10-12 no
establece instalación normal local ni despliegue.

Comandos F13 registrados 1790793305698 (configuración) **antes de** 1790793305700
(principal). C2-I-B registra el Fast 1792540800000 para el ledger. La ejecución
acreditada por Gate B se limita a DEV-LOCAL-R1, con F13 auto-create desactivado
y Attention `DISABLED`. Cualquier inspección de tracking requiere autorización
específica.

[Operaciones](INCONNECT_OPERATIONS_AND_UPGRADES.md),
[runner](INCONNECT_EXACT_INSTANCE_COMMAND_RUNNER.md) y
[harness](INCONNECT_EXACT_UPGRADE_PHYSICAL_HARNESS.md) mantienen PG0/PG1/C5 y
exact-upgrade BLOCKED. Commits de preparación: `bd4b762e35` y `3ae6090199`.
Quedan incompletas aceptación supervisor SIGTERM, propagación de muerte,
SIGKILL Stage D y guardian recovery; los probes históricos de namespaces y
cleanup no prueban aislamiento de un workload PostgreSQL. No modificar el
bind mount de reparación WSL ni normal `default`.

INSTALL-F1 corrigió en fuente la causa localizada del SQLSTATE 42P07 del setup
legacy. Gate B acreditó el bootstrap sin ese error en DEV-LOCAL-R1. La duda
FilesFieldSync sobre transaction binding sigue como seguimiento separado. Retención, purga y borrado
de workspace siguen sujetos a autorización separada.

## Uso y mantenimiento

Actualizar este estado con fecha, commit/documento y límites al aceptar una fase.
Mantener contratos separados del historial; las validaciones antiguas son evidencia
reportada, no reruns ni permiso de ejecución. La reconciliación del 2026-10-27
se basó en la rama `feature/inconnect-lead-management`, HEAD
`f164bf937a5260983778dbca8a3a8e833b2e1bde`, worktree limpio e índice vacío
antes de esa modernización. La referencia histórica completa es
`git show f164bf937a5260983778dbca8a3a8e833b2e1bde:AGENTS.md`.
El mapa de contratos empieza en [AGENTS.md](../../../AGENTS.md); el inventario y
la [matriz de preservación](INCONNECT_DOCUMENTATION_PRESERVATION.md) explican la
migración sin depender de que el lector tenga los caches locales.
