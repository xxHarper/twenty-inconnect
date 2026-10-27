# Twenty INCONNECT — estado canónico del proyecto

Fecha: **2026-10-27**, America/Mexico_City. Reconciliación documental, sin ejecución
ni auditoría nueva de producto. Verificación Git read-only: rama
`feature/inconnect-lead-management`, HEAD
`f164bf937a5260983778dbca8a3a8e833b2e1bde`; worktree limpio y staging vacío
antes de esta modernización. No se inspeccionó PostgreSQL ni otro entorno.

Este documento reemplaza las etiquetas de estado anteriores cuando existe
la evidencia aquí identificada. Los contratos técnicos permanecen obligatorios;
una aceptación nunca levanta gates de ejecución. «Fuente implementada»,
«ACCEPTED SOURCE-ONLY», «validación física de desarrollo», «instalado en un
entorno», «activado» y «desplegado» son afirmaciones distintas. Ausencia de
inspección actual no prueba ni instalación ni ausencia física.

## Resumen por módulo

| Módulo | Fuente / aceptación acreditada | Evidencia física e instalación por entorno | Pendiente / bloqueado |
| --- | --- | --- | --- |
| Record Access / Owner Integrity | Implementado: políticas, SQL ORM v1/v2, Owner, persistencia, modos ENV/transition/database, caches y Settings. Hardening de eventos/Owner: `cb7271ca0c` (2026-10-16); fuente presente en HEAD. | AGENTS histórico reporta comando de persistencia ejecutado/auditado en desarrollo y baseline local `database` verificado el 2026-08-24. No se revalidó entorno el 27 de octubre. | Ninguna instalación/activación/despliegue nuevo acreditado. Superficies no soportadas siguen denegadas. |
| Commercial Teams | Implementado bajo Record Access: administración, membresía, atomic move, cache endurecido y Settings. Contrato conservado del checkpoint histórico. | Baseline local reportado el 2026-08-24; no es aceptación física universal ni inspección actual. | No cambiar Roles por membresía; no rediseño ni despliegue nuevo. |
| Lead Management | **ACCEPTED SOURCE-ONLY — INCONNECT LEAD MANAGEMENT INTEGRATED MVP**, aceptación independiente 2026-10-27, commit `f164bf937a`. | PostgreSQL físico, DDL instalado, DI completa, HTTP y E2E navegador pendientes. No se declara instalación terminada. | NORMAL/MESSAGE_PENDING NOT_READY; TODOS deshabilitado. No activo/desplegado por esta aceptación. |
| Messaging base | Fuente integrada: persistencia, autorización, inbox, manual Pending, Favorite/Unread, media, Send, templates, realtime, context/Settings y linking manual. | Pruebas históricas de desarrollo/disposable de comandos, work-state, context y linking; ver contratos y evidencia histórica. No se inspeccionó instalación actual. | Límites funcionales en backlog; ningún despliegue nuevo acreditado. |
| WhatsApp Attention | Dominio/C1/C2 y capas I-A/I-B/II/III-A/B1/R1–R4 implementadas en fuente. R4 **ACCEPTED SOURCE-ONLY** según commit `0c5936907b` del 2026-10-26. | No aceptación PostgreSQL física del ledger/R4 ni instalación de su DDL acreditadas. | Worker tracked sin registro/cutover/activación; B1 no completada operacionalmente, B2/C no iniciadas. |
| F13A/B, F13C.2B | Implementado; resolución exacta y create/link normalmente autorizado. | F13B.3 smoke local `default` reportado 2026-09-29; F13C.2B aceptado físicamente en PostgreSQL disposable de desarrollo 2026-10-12. No son el mismo entorno ni prueba externa Twilio/Redis completa. | F13C.3 preparación/instalación por entorno pendiente; sin afirmación de 5698/5700 ejecutados en `default` o producción. |
| PG0/PG1, Stage C5, exact-upgrade | Tooling PG0 y lifecycle inerte committed; aceptación de fuente lifecycle reconciliada el 2026-10-14/15. | Probes inocuos de namespaces no equivalen a aceptación física PostgreSQL/lifecycle. | **BLOCKED**: ejecución física PG0/PG1, Stage C5 y executor operativo. Sin adaptador live ni aceptación kernel de lifecycle. |
| Telephony REQ-TEL-001 | Requisito confirmado de backlog. | Sin implementación/instalación/activación acreditada. | Diseño y desarrollo en tarea separada. |

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
(principal); registro no demuestra ejecución. Comprobar tracking por entorno
requiere inspección específicamente autorizada, no realizada aquí. C2-I-B añade en fuente el Fast 1792540800000 para el ledger;
no se acredita su ejecución/instalación física.

[Operaciones](INCONNECT_OPERATIONS_AND_UPGRADES.md),
[runner](INCONNECT_EXACT_INSTANCE_COMMAND_RUNNER.md) y
[harness](INCONNECT_EXACT_UPGRADE_PHYSICAL_HARNESS.md) mantienen PG0/PG1/C5 y
exact-upgrade BLOCKED. Commits de preparación: `bd4b762e35` y `3ae6090199`.
Quedan incompletas aceptación supervisor SIGTERM, propagación de muerte,
SIGKILL Stage D y guardian recovery; los probes históricos de namespaces y
cleanup no prueban aislamiento de un workload PostgreSQL. No modificar el
bind mount de reparación WSL ni normal `default`.

Persisten como follow-up separado el legacy setup SQLSTATE 42P07 y la duda
FilesFieldSync sobre transaction binding. No se corrigen ni se ejecuta setup para
investigarlos. Retención/purga/borrado de workspace no tienen autorización nueva.

## Uso y mantenimiento

Actualizar este estado con fecha, commit/documento y límites al aceptar una fase.
Mantener contratos separados del historial; las validaciones antiguas son evidencia
reportada, no reruns ni permiso de ejecución. La referencia histórica completa es
`git show f164bf937a5260983778dbca8a3a8e833b2e1bde:AGENTS.md`.
El mapa de contratos empieza en [AGENTS.md](../../../AGENTS.md); el inventario y
la [matriz de preservación](INCONNECT_DOCUMENTATION_PRESERVATION.md) explican la
migración sin depender de que el lector tenga los caches locales.
