# INCONNECT — backlog y límites no implementados

Contrato vigente preservado del AGENTS original; reorganización documental del 2026-10-27.
Consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para aceptación, instalación y activación.
Este contrato no autoriza infraestructura, inspección PostgreSQL ni cambios Git.
Las rutas en código se expresan desde la raíz del repositorio. Las evidencias de
validación citadas son históricas, no ejecuciones de esta reorganización.

Fecha de reconciliación: 2026-10-27. Requisitos y exclusiones, no autorización
para iniciar producto. [Estado canónico](INCONNECT_PROJECT_STATUS.md) rige los
avances; las capacidades listadas como implementadas en el checkpoint histórico
son contratos de fuente, no disponibilidad por entorno. El inbound tracked R4
existe SOURCE-ONLY; la falta de integración automática significa falta de cutover
operativo y de integración completa outbound/manual, no falta de ese código.

Pendientes además: clasificación agregada autorizada NORMAL/MESSAGE_PENDING,
TODOS por filtro con materialización estable y escala/recuperación física,
instalación física del MVP, custodia/restore, retención/purga/borrado de workspace.
No inventar cascadas destructivas ni permisos agregados.


### Planned Boundaries

The complete Conversation work-state backend and visible inbox UX **ARE IMPLEMENTED**: durable `ConversationMemberState`, personal Favorite, personal derived Unread, shared manual Pending, rollout baseline, authorized SQL work-state filters, GraphQL work-state mutations, the shared Pending `CONVERSATION_UPDATED` hint, server-backed All/Unread/Favorites/Pending views, row indicators, visible Favorite/Pending/Read/Unread actions, manual-unread suppression, and snapshot-safe automatic read.

The outbound media backend **IS IMPLEMENTED**: secure actor/workspace-scoped staging, upload completion and validation, deterministic `FileStorage`/`FileEntity` preparation, transactional outbound Message + Attachment consumption, Twilio free-form media dispatch, and provider-media capability delivery.

The user-facing outbound attachment composer **IS IMPLEMENTED**: attachment button, accessible file picker, indeterminate upload/finalization state UX, Retry, Remove, local previews, and send-media UX for one capability-supported attachment. Replacement is explicit Remove plus a new selection; there is no separate multi-file replacement workflow.

The secure dynamic CRM Conversation context capability **IS IMPLEMENTED END TO END**: ContextField persistence, secure backend context read, management query/mutation, safe normalized values, standard object/field permission enforcement, a Record Access-scoped final CRM `SELECT`, selected-Conversation-only live reads, a desktop third pane, a narrow/mobile fullscreen modal, stale-context protection, native Settings field selection, accessible ordering, and atomic save/refetch. Messaging realtime remains intentionally separate from CRM realtime.

Secure Manual CRM Linking **IS IMPLEMENTED END TO END**. The Fase 12A backend provides Conversation-scoped candidate search, base Messaging plus TRIAGE authorization, server-derived dynamic anchor, canonical-readable-TEXT-label-only search, safe normalized candidate DTOs, SQL-scoped Record Access, authorized raw count and cursor pagination, atomic one-way `UNASSIGNED -> LINKED`, Conversation `FOR UPDATE`, target `FOR SHARE`, idempotent same-target retry, non-overwriting different-target conflict, and transactional `CONVERSATION_LINKED` Outbox persistence. The Fase 12B frontend provides the Link action, explicit human-submitted search, candidate list, single selection, mandatory confirmation, exact Link mutation, backend-authoritative context/list/detail refresh, stale-result protection, and responsive third-pane/fullscreen-Context UX.

Canonical phone identity, metadata-driven PhoneIdentityField configuration, secure human exact-phone resolution, narrow workspace-wide background resolution, inbound automatic linking to an existing exact `UNIQUE` CRM record, and conditional enabled/ready `NO_MATCH` create/link orchestration **ARE IMPLEMENTED**. The F13C path remains exact, metadata-derived, normally authorized, transaction-bound, and narrow; it adds neither fuzzy matching nor broad CRM system authority.

Still **NOT IMPLEMENTED**: unlink or relink; ambiguity ranking or confidence scoring; `additionalPhones` matching; email identity matching; sender-derived manual candidate search; CRM field editing; owner, stage, or phase changes beyond the exact create payload; anchor selection/change; CRM record preview in Settings; related lists or Folio ISO context; `RELATION`/`MORPH_RELATION` linking or context rendering; generic CRM realtime; cross-page context-configuration realtime; open-record navigation; Meta/Web provider wiring; AI/Agents integration; immediate cross-device realtime for personal Favorite/read mutations; runtime integration of the approved automatic Pending rules; per-filter numeric counts; drag/drop; clipboard image paste; microphone/voice recording; outbound `LOCATION`; rich/media templates; multi-attachment composer UX; reactions; historical media backfill; automatic `FileEntity`/FileStorage garbage collection or reconciliation; orphan personal-state GC; a dedicated provider-media TTL; template administration/editor; or creating, editing, or approving Twilio templates inside Twenty. The current picker only consumes supported provider-existing templates.

F13C.2B is complete and is no longer a planned boundary. Future work must not broaden its exact configured PRIMARY, independently resolved Owner, ordinary Automation principal, current readiness, one-way link, or transaction guarantees without a separately designed and validated security change. Deployment-specific migration, provisioning, activation, and operational E2E remain environment work rather than new product behavior.

Future Messaging automation may support `HUMAN_ONLY`, after-hours AI, AI-assisted, AI first-response, AI-managed, and human takeover modes. None is implemented. AI or automation must not bypass the Messaging send pipeline: future automated outbound must converge on the existing Message -> session policy -> idempotency -> DispatchAttempt -> Outbox -> provider -> status state machine. Durable actor attribution must distinguish human, system automation, and a future AI agent. `SYSTEM_PHONE_IDENTITY_RESOLUTION` is narrow deterministic system automation, not an AI authority or generic CRM bypass.

## Product Backlog

### REQ-TEL-001 — INCONNECT Telephony / Softphone

**USER-CONFIRMED REQUIREMENT. NOT IMPLEMENTED. DESIGN AND DEVELOPMENT RESERVED FOR A SEPARATE CONVERSATION/TASK.**

- Twilio voice telephony with a browser-based softphone embedded in Twenty; inbound and outbound calls; click-to-call directly from a CRM Lead.
- Transfer active calls between executives and coordinators; record calls where configured and permitted.
- Associate call activity with the matching Lead and show call count, duration, and available recordings in the corresponding CRM record.

Confirmed inbound routing:

- **A — Known caller with a matching Lead:** route to the Lead owner.
- **B — Known caller whose Lead owner is busy:** Round Robin among available executives in the owner's Commercial Team.
- **C — Unknown caller without a matching Lead:** Round Robin among available executives in the general eligible pool.

Ambiguous phone matches, no available agents, failed transfers, offline owners, and disconnected calls require design before implementation; no fallback behavior is specified.

Authorization, recording consent, retention, and Twilio Voice integration must each be evaluated separately. WhatsApp Messaging is implemented in development; telephony is not, and the existing Twilio WhatsApp adapter does not implement voice. Reuse existing INCONNECT concepts where appropriate, without assuming WhatsApp permission flags, Conversations, or provider transport apply to voice.
