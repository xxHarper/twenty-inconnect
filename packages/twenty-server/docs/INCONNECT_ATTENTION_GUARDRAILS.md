# INCONNECT — Shared Attention: reglas aprobadas y guardrails

Reconciliación: 2026-10-27. Reglas obligatorias; leer con
[estado canónico](INCONNECT_PROJECT_STATUS.md). C2-I-A/I-B/II/III-A y B1/R1–R4
existen en fuente. R4 está ACCEPTED SOURCE-ONLY según checkpoint
`0c5936907b61ff1989ffac566e9fb6e036bb6d26`; no significa B1 terminado ni worker
tracked activado. El runtime legacy conserva Pending manual. Send/Dispatch,
callbacks de cierre y nueva API manual por intención/revisión no están integrados
operativamente. Ninguna fase posterior se inicia con esta documentación.

La decisión DELIVERED/READ ya está aprobada. El literal de dominio
`PROPOSED_DELIVERED_OR_READ` permanece por compatibilidad y
`approvedAttentionSuccessPolicy()` aplica la decisión; no reabrirla ni elegir
UNDECIDED para runtime. Los rótulos de propuesta/revisión antiguos son históricos.

## Política de negocio aprobada

### Approved WhatsApp attention business and domain contract

- A new unique inbound opens or renews shared PENDING and increments its revision.
- Reading affects only personal Unread/read state; it never confirms shared attention.
- Only valid, authenticated, correlated DELIVERED or READ evidence for a HUMAN response may automatically close its still-current covered revision.
- QUEUED, SENDING, ACCEPTED, SENT, FAILED and UNKNOWN never justify automatic closure.
- A template manually sent by an authenticated executive can be HUMAN. TEMPLATE is format, never provenance; AUTOMATION and LEGACY_UNKNOWN never automatically close attention.
- Response provenance and coverage are frozen at intention acceptance. An old confirmation cannot close a revision opened later; retries never broaden coverage.
- A human can explicitly mark Pending or Attended using an idempotent intention and observed revision. Manual Pending may renew from an older view; manual Attended requires the current revision. Deduplication preserves the earlier intention rather than creating another renewal.
- Callbacks must be authenticated, exactly correlated and deduplicated. Current human authorization remains mandatory wherever the operation requires it; historical attribution grants no current access.

### Lead Management and Attention Adapter Rules

- Keep pure distribution evaluation separate from transactional execution. A preview/plan grants no owner-transfer authority; revalidate origin, selection, recipients, Roles, permissions, Record Access, Owner Integrity and current state before any authorized execution.
- Distribution must not change Folio ISO or WhatsApp Conversations as a side effect. Distribution permissions grant no implicit Messaging content access; aggregate attention-category authority requires separate approval.
- Classify MESSAGE_PENDING only from authoritative shared attention linked by exact workspace/object/record identity. Never use personal Unread, phone matching or a Lead boolean; incomplete tracking must return NOT_READY, never enable classification or silently fall back to NORMAL.
- Use the accepted C2 design for persistence details. Do not create a parallel Messaging pipeline, delivery service, permission model or ledger authority; preserve the existing outbound state machine as transport authority.
- Never turn SQL errors, timeouts, incomplete reads, missing required dependents or corruption into authoritative absence/null. A false absence of both Receipt and Effect can turn DUPLICATE into APPLIED; TypeScript brands and C1 local validation cannot prove query completeness.
- PostgreSQL is the future ledger authority. Redis, caches, realtime hints and BullMQ are never authoritative ledger reads or idempotency guarantees.
- Serialize every attention-ledger writer on the common Conversation lock, including intent registration, IGNORED effects and aliases that do not increment attentionRevision. Replan and reread after acquiring the lock on the same active caller-owned primary transaction; revision-only CAS is insufficient.
- Preserve canonical identities, fingerprints and each receipt/alias's own original result. IGNORED stays consumed; CONFLICT reserves no domain keys. Retain keys and referenced originals while replay is admitted; do not invent TTL or purge procedures.
- Keep response provenance, actor, Message, content, format and covered revision immutable across retries. Never infer HUMAN from historical Messages, SENT, TEMPLATE or callbacks; derive and preserve Message's origin epoch rather than treating an old epoch's fact as new.
- Reauthorize current human operations and realtime recipients through existing Messaging and Record Access authority. Authenticate, correlate and deduplicate provider evidence; an authorityReference string or historical attribution is not a capability.
- Once an aggregate is prepared, fence legacy pendingAt writers as required by C2, including before ENABLED; after activation, reject the legacy boolean API even before its same-value no-op. Keep pendingAt/status coherent and preserve historical Pending at bootstrap without replaying legacy Messages.
- Atomicity claims cover the PostgreSQL transaction only: causal Message changes, attention, intention, ledger, audit and Outbox as applicable. PostgreSQL and Twilio are not atomic together; submit and publish after commit through existing durable mechanisms, preserving UNKNOWN on ambiguous submit.
- Accepted designs, source tests and local commits never imply executed migrations, physical acceptance, deployment or activation. C2-I-A está implementada en fuente y superada como siguiente fase por los checkpoints posteriores; ninguna fase empieza automáticamente.

## Contratos por capa y bloqueo operativo

- [Dominio puro](../src/modules/inconnect-messaging/attention-domain/README.md) y
  [adaptador C1](../src/modules/inconnect-messaging/attention-adapter/README.md).
- [Diseño C2](INCONNECT_ATTENTION_ADAPTER_C2_DESIGN.md),
  [filas/decoders I-A](INCONNECT_ATTENTION_ADAPTER_C2_I_A.md),
  [schema/guards I-B](INCONNECT_ATTENTION_ADAPTER_C2_I_B.md),
  [lector II](INCONNECT_ATTENTION_ADAPTER_C2_II.md),
  [writer III-A](INCONNECT_ATTENTION_ADAPTER_C2_III_A.md).
- [B1](INCONNECT_ATTENTION_ADAPTER_C2_III_B1.md),
  [R1](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R1.md),
  [R2 ingreso autenticado](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R2.md),
  [R3 admisión durable](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R3.md),
  [R4 unidad causal](INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R4.md).

Identidades: C = workspace/conversation/providerConnection; S añade trackingEpoch.
PostgreSQL es autoridad del ledger, sin claims de instalación física. I-B usa
marcadores causales xid8 de servidor; no fabricar marcadores/epochs/originales.
La lectura debe demostrar completitud y dependientes, no sólo marcas TypeScript.

R4 preserva Configuration SHARE -> Conversation UPDATE -> Receipt UPDATE ->
Message y ledger; un claim corto termina antes. El runner primario y manager
original son exclusivos. PREPARED no es COMMITTED: sólo commit confirmado lo es;
commit incierto requiere reconciliación primaria y no reejecución ciega.
El postcommit separa publicación, media y F13 sin cambiar sus autoridades.

ENABLED permanece cerrado en el worker operativo. La emisión v1 de R2 en
DISABLED y la escritura R3 que exige ENABLED requieren un cutover revisado, no
un cambio de constante. PREPARING/SUSPENDED/ENABLED sin ruta liberada pausan;
no consumen intentos como fallo de proveedor. Instalación parcial/corrupta o
error SQL nunca se interpreta como permiso para legacy.

Antes de activación: aceptación PostgreSQL física aislada; emisión/procesamiento
y drenaje legacy coordinados; todos los writers de conexión deben tomar
Configuration UPDATE antes de ProviderConnection, frente al SHARE del proceso;
coordinación outbound/manual; custodia/restore y monitoreo/recovery. No hay
serialización global frente a SQL privilegiado no participante ni prueba T2.
R4 no registra worker, no cambia TLS/proxy/origen ni crea otra cola. B2/C,
bootstrap histórico, clasificación Lead, retención y borrado siguen separados.
