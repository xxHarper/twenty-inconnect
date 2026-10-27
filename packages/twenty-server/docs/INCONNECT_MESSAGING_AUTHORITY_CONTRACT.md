# INCONNECT Messaging — persistencia, autorización y API

Contrato vigente preservado del AGENTS original; reorganización documental del 2026-10-27.
Consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para aceptación, instalación y activación.
Este contrato no autoriza infraestructura, inspección PostgreSQL ni cambios Git.
Las rutas en código se expresan desde la raíz del repositorio. Las evidencias de
validación citadas son históricas, no ejecuciones de esta reorganización.

El contrato base manual sigue siendo la ruta operativa existente. La composición
tracked inbound R4 está implementada y aceptada SOURCE-ONLY, pero sin cutover
ni worker registrado/activado. La frase histórica «manual Pending only» describe
la ruta legacy, no la inexistencia de R4 en fuente. Leer
[Attention](INCONNECT_ATTENTION_GUARDRAILS.md),
[Work state](INCONNECT_MESSAGING_WORK_STATE_CONTRACT.md),
[CRM context](INCONNECT_MESSAGING_CRM_CONTEXT_CONTRACT.md),
[Delivery](INCONNECT_MESSAGING_DELIVERY_CONTRACT.md) y
[F13](INCONNECT_F13_AND_ORM_CONTRACT.md) según la operación.

## INCONNECT Messaging

Backend: `packages/twenty-server/src/modules/inconnect-messaging/`. Frontend: `packages/twenty-front/src/modules/inconnect-messaging/` and `packages/twenty-front/src/pages/inconnect-messaging/`.

INCONNECT Messaging is a provider-neutral native Twenty feature with durable inbound processing, secure rich-media ingestion, authorized reads and file access, secure realtime, a secure outbound media backend, a secure dynamic CRM Conversation context backend, a visible runtime context panel, visible secure manual CRM linking, a native CRM context configuration UI in Settings, and a functional Messaging frontend. CRM Context is implemented end to end, including visual administration of its ordered presentation fields at Settings -> Messaging -> CRM context. The native inbox supports inbound and outbound Messaging, text free-form, templates, attachments/media, a secure composer, server-backed All/Unread/Favorites/Pending views, personal Favorite and Unread, shared Pending, manual Read/Unread, safe automatic read, and a visible dynamic CRM Conversation context experience. For an authorized selected `UNASSIGNED` Conversation, that context experience provides an explicit Link action, secure candidate search, single selection, confirmation, and backend-authoritative post-Link context refresh. The selected Conversation displays context and linking in a desktop third pane or a narrow/mobile fullscreen modal. Runtime reads use `inconnectMessagingConversationContext`; explicit linking uses `inconnectMessagingConversationLinkCandidates` and `linkInconnectMessagingConversation`; Settings management uses `inconnectMessagingContextConfiguration` and `replaceInconnectMessagingContextConfiguration`. These are distinct authorization domains and must never be conflated. Immediate personal cross-device realtime is not part of this capability. It is not a Twenty App and must not reuse `modules/messaging` email functionality as the WhatsApp domain. Twilio remains behind the provider port; provider-specific concepts must not become domain authority.

## Contract: Persistence Foundation

The following TypeORM entities and dedicated `core` tables are implemented:

- `InconnectMessagingConfigurationEntity` / `core.inconnectMessagingConfiguration`
- `InconnectMessagingProviderConnectionEntity` / `core.inconnectMessagingProviderConnection`
- `InconnectMessagingConversationEntity` / `core.inconnectMessagingConversation`
- `InconnectMessagingMessageEntity` / `core.inconnectMessagingMessage`
- `InconnectMessagingDispatchAttemptEntity` / `core.inconnectMessagingDispatchAttempt`
- `InconnectMessagingWebhookReceiptEntity` / `core.inconnectMessagingWebhookReceipt`
- `InconnectMessagingProviderStatusEventEntity` / `core.inconnectMessagingProviderStatusEvent`
- `InconnectMessagingOutboxEventEntity` / `core.inconnectMessagingOutboxEvent`
- `InconnectMessagingAttachmentEntity` / `core.inconnectMessagingAttachment`
- `InconnectMessagingOutboundUploadEntity` / `core.inconnectMessagingOutboundUpload`
- `InconnectMessagingConversationMemberStateEntity` / `core.inconnectMessagingConversationMemberState`
- `InconnectMessagingContextFieldEntity` / `core.inconnectMessagingContextField`
- `InconnectMessagingPhoneIdentityFieldEntity` / `core.inconnectMessagingPhoneIdentityField`

These are core operational or operational-configuration tables, not workspace objects. `ContextField` is ordered presentation configuration: it is not syncable metadata, a Record Access policy, or a copy of CRM data. PostgreSQL is the operational authority: do not introduce dual-write authority. The persistence spine supplies durable-inbox and transactional-outbox records, idempotency keys, leases, `DispatchAttempt` audit, checks, and workspace-isolated composite foreign keys. Twilio webhook receipt processing and inbox recovery, inbound media ingestion and recovery, outbound WhatsApp dispatch, realtime outbox publishing, and their BullMQ workers are implemented. BullMQ is at-least-once transport and must never become authority.

An Attachment has the durable logical identity `Message + ordinal`, a provider-neutral attachment type, and one of the ingestion states `PENDING`, `PROCESSING`, `AVAILABLE`, `FAILED`, or `EXPIRED`. It stores an opaque server-only provider media locator only while needed for ingestion, an optional workspace-isolated `FileEntity` reference, lease and attempt data, and safe presentation metadata. Composite foreign keys prevent its Message, workspace, and Provider Connection from diverging and require a referenced File to belong to the same workspace. A File cannot be deleted while an Attachment references it; Message deletion cascades its Attachments.

An Outbound Upload is actor/workspace-scoped staging with states `CREATING`, `PENDING`, `AVAILABLE`, and `CONSUMED`. It persists workspace, uploading Workspace Member, actor-scoped `clientUploadId`, provider-neutral media type, safe filename, size, workspace-local `FileEntity`, detected MIME, durable content fingerprint, expiration, and optional consumed Message/timestamp. Idempotency is unique by workspace + actor + `clientUploadId`; composite references keep File and consumed Message in the same workspace. PostgreSQL remains staging and consumption authority.

`MessagingConfiguration` selects the anchor through a real workspace-local `ObjectMetadata` reference. A `Conversation` references the CRM record with:

    workspaceId
    linkedRecordObjectMetadataId
    linkedRecordId

The linked tuple is either fully null or fully present, and a composite FK requires its ObjectMetadata to match the configured workspace anchor. Runtime authority must not come from physical names, schema names, a hardcoded `lead`, an owner column, or a universal identifier. Dynamic table and owner details come from live metadata.

`Message.providerConnectionId` is persisted because provider message identity is connection-scoped. Its composite FK `(conversationId, providerConnectionId, workspaceId)` to `Conversation` prevents the Message connection or workspace from diverging from its Conversation. Retry lineage is also connection/workspace constrained.

`MessagingConfiguration` is a singleton per workspace. Its real identity is `workspaceId`; it has no independent `id`. `ContextField` must never introduce or persist an artificial `messagingConfigurationId`. Its persisted fields are `id`, `workspaceId`, `objectMetadataId`, `fieldMetadataId`, `ordinal`, `createdAt`, and `updatedAt`, and the workspace singleton is the logical configuration identity.

The same singleton now persists the F13C tuple `autoCreateEnabled`, `autoCreateAnchorObjectMetadataId`, `autoCreateOwnerStrategy`, `autoCreateOwnerRoleId`, and `autoCreateLabelPolicy`, plus the server-owned `automationUserWorkspaceId` reference. These are configuration and principal references on the existing entity, not a new standalone syncable entity. The auto-create anchor snapshot must continue matching the live `anchorObjectMetadataId`; workspace isolation and metadata authority remain unchanged.

The physical configuration/anchor FK is `(ContextField.workspaceId, ContextField.objectMetadataId) -> (MessagingConfiguration.workspaceId, MessagingConfiguration.anchorObjectMetadataId)`. It guarantees that every configured field belongs to the same workspace and the exact configured Messaging anchor; another object in the same workspace is not valid. The physical metadata FK is `(ContextField.fieldMetadataId, ContextField.objectMetadataId, ContextField.workspaceId) -> (FieldMetadata.id, FieldMetadata.objectMetadataId, FieldMetadata.workspaceId)`, so a configured Field must belong to that exact object and workspace. Uniqueness is `(workspaceId, fieldMetadataId)` and `(workspaceId, ordinal)`, with `ordinal >= 0`; ordering is deterministic. The application maximum is 20 configured fields and is intentionally not a PostgreSQL maximum check.

`ContextField` cascades from Workspace, the MessagingConfiguration anchor relation, and FieldMetadata. Presentation rows cannot remain as cross-workspace or cross-object orphans. Removing presentation configuration never deletes or rewrites CRM record data.

### Messaging Authorization

`InconnectMessagingAuthorizationService` is the centralized authority for human Messaging operations, including the implemented outbound send and secure manual linking backend. It composes:

    authenticated Workspace
    AND valid authenticated Workspace Member
    AND Messaging functional permission
    AND Twenty standard object permission
    AND INCONNECT Record Access
    AND resource-specific authorization

For a linked Conversation the chain is `Conversation -> configured dynamic anchor record -> Twenty standard permission -> INCONNECT Record Access`. Messaging has no parallel owner or Team. Knowing a Conversation UUID grants nothing; unauthorized direct lookup returns no Conversation to avoid existence disclosure. Human operations reject system contexts and permission-bypass role configurations.

A human send requires `INCONNECT_MESSAGING AND SEND_INCONNECT_MESSAGING AND current Conversation authorization`. Linked Conversations preserve Twenty standard permission **and** INCONNECT Record Access. Access to an unassigned Conversation requires `INCONNECT_MESSAGING AND TRIAGE_INCONNECT_MESSAGING`, and `SEND_INCONNECT_MESSAGING` is additionally required to send. `TRIAGE_INCONNECT_MESSAGING` and `MANAGE_INCONNECT_MESSAGING` never imply send. System context is not valid for the human send mutation.

Manual candidate search and link require `INCONNECT_MESSAGING AND TRIAGE_INCONNECT_MESSAGING` plus current Conversation authorization; neither SEND nor MANAGE is required or implied. Candidate search additionally applies current standard object/field read permissions and INCONNECT Record Access. Link reauthorizes the exact target under current standard object read permission and Record Access inside its transaction. A stale candidate is never authority.

`InconnectMessagingConversationQueryService` implements internal list, count, search, and pagination helpers. It applies workspace, permission, anchor, and correlated authorized-record `EXISTS` conditions in SQL before search results, counting, ordering, or pagination. Never fetch all Conversations and filter in memory or in the frontend.

### Permission Flags

All defaults are `false`:

- `INCONNECT_MESSAGING` — tool; enables the module but grants no universal Conversation access.
- `SEND_INCONNECT_MESSAGING` — tool; also requires access to the Conversation and, when linked, its anchor record.
- `TRIAGE_INCONNECT_MESSAGING` — tool; with the base flag permits access to unassigned Conversations only.
- `MANAGE_INCONNECT_MESSAGING` — settings; does not imply Read or Send.

`canAccessAllTools` and `canUpdateAllSettings` retain standard Twenty semantics; neither converts a functional flag into record authorization.

### Unassigned Conversations

A Conversation is unassigned only when both `linkedRecordObjectMetadataId` and `linkedRecordId` are null. Human access requires `INCONNECT_MESSAGING AND TRIAGE_INCONNECT_MESSAGING`. There is no Messaging owner or parallel Team. The native inbox labels authorized unassigned Conversations. Explicit manual candidate search, one-way `UNASSIGNED -> LINKED` mutation, and the visible manual linking UI are implemented. Separately, an inbound `UNASSIGNED` Conversation can transition automatically to `LINKED` when the configured F13 background resolver returns a usable exact `UNIQUE` record, or when a fresh `NO_MATCH` passes current enabled/ready F13C.2B authority and creates the exact receipt-linked record. `AMBIGUOUS`, `INVALID`, `DISABLED`, and disabled/not-ready `NO_MATCH` remain unassigned. Unlink, relink, sender-derived manual search, email matching, `additionalPhones` matching, and ambiguity ranking remain absent.

## Contract: Read API

The metadata GraphQL schema exposes `inconnectMessagingConversation(id)`, `inconnectMessagingConversations(search, workState, paging)`, and `inconnectMessagingMessages(conversationId, paging)`. Conversation work-state filtering supports `ALL`, `UNREAD`, `FAVORITES`, and `PENDING`. The authorized list provides edges, total count, search, and cursor pagination; Message history has deterministic newest-first cursor pagination. Responses use safe DTOs, never TypeORM entities or provider metadata.

`InconnectMessagingAuthorizationService` remains the authority. Linked Conversations require Twenty standard permission on the configured CRM anchor **and** INCONNECT Record Access. Unassigned Conversations require `INCONNECT_MESSAGING` **and** `TRIAGE_INCONNECT_MESSAGING`. Direct unauthorized Conversation lookup returns null/not found without existence disclosure, and Message access first authorizes its Conversation. Backend SQL applies authorization, current-member state, search, and work-state predicates before count, ordering, and pagination; the frontend does not reconstruct record access or post-filter results.

Conversation DTOs expose `isFavorite` and `isUnread` for the current actor and shared `isPending`. They never expose raw `ConversationMemberState`, `workspaceMemberId`, `manualUnread`, the read cursor, the tracking baseline, or favorited-by/read-by lists.

Authorized Message pagination additionally exposes nullable `readThroughMessageId`. It is returned only when the latest relevant inbound by server arrival order is actually included in the returned slice; null means that snapshot has no safe automatic-read target. It is an opaque target for the existing Mark Read mutation, not a personal read cursor or a replacement for backend unread authority.

Safe Message DTOs can include media descriptors containing an opaque Attachment ID, provider-neutral logical type, safe filename, MIME, size, ingestion/availability state, and an authorized same-origin access path. They never expose a Twilio media locator, storage key/path, credentials, or provider secret.

### Current Metadata GraphQL Surface

Relevant queries are:

- `inconnectMessagingConversation`
- `inconnectMessagingConversations` with `ALL | UNREAD | FAVORITES | PENDING` work-state filtering
- `inconnectMessagingMessages`
- `inconnectMessagingTemplates`
- `inconnectMessagingSendCapabilities`
- `inconnectMessagingConversationContext`
- `inconnectMessagingConversationLinkCandidates(conversationId, search, paging)`
- `inconnectMessagingContextConfiguration`
- `inconnectMessagingPhoneIdentityConfiguration`
- `inconnectMessagingAutoCreateConfiguration`

Conversation read/list DTOs expose `isFavorite`, `isUnread`, and `isPending`. The first two are personal to the current actor; Pending is shared. The Message connection additionally exposes nullable `readThroughMessageId`, an opaque, server-derived, snapshot-safe automatic-read target.

Mutations are:

- `createInconnectMessagingOutboundUpload`
- `completeInconnectMessagingOutboundUpload`
- `sendInconnectMessagingMessage`
- `setInconnectMessagingConversationFavorite`
- `markInconnectMessagingConversationRead`
- `markInconnectMessagingConversationUnread`
- `setInconnectMessagingConversationPending`
- `linkInconnectMessagingConversation(conversationId, recordId)`
- `replaceInconnectMessagingContextConfiguration`
- `replaceInconnectMessagingPhoneIdentityConfiguration(fields)`
- `replaceInconnectMessagingAutoCreateConfiguration(input)`

`sendInconnectMessagingMessage` accepts opaque `outboundUploadIds`. Public GraphQL does not expose or accept `FileEntity` IDs, storage paths, provider URLs/tokens, sender, Provider Connection, authoritative MIME, raw personal-state rows, member IDs for work-state operations, `manualUnread`, read cursors, or the tracking baseline. The subscription remains `onInconnectMessagingEvent`. Fase 9B metadata GraphQL codegen, including the work-state operations, DTO fields, and snapshot-safe `readThroughMessageId`, was regenerated and validated successfully, and the frontend continues to consume generated metadata types rather than a parallel handwritten contract.

Context GraphQL DTOs expose only safe presentation concepts: state, ObjectMetadata ID and safe label, record ID and canonical readable label, and ordered fields containing FieldMetadata ID, label, value kind, and display value. They expose no physical schema/table/column names, raw CRM JSON, Record Access decisions, owner scopes, provider data, or private metadata internals. Context management exposes safe candidate metadata and no CRM record values. Fase 10A metadata GraphQL codegen completed successfully.

Manual-link candidate search accepts only Conversation ID, search text, and paging. Manual Link accepts only Conversation ID and record ID. The server derives workspace, configured ObjectMetadata anchor, schema/table, physical fields, and authorization scope. Candidate DTOs expose only record ID, nullable canonical record label, and safely normalized readable configured fields; no TypeORM entity, raw CRM row, owner scope, policy result, provider identity, or physical metadata is public. The visible Fase 12B UI consumes `inconnectMessagingConversationLinkCandidates` and `linkInconnectMessagingConversation` through their generated metadata query/mutation variables, results, and typed documents. Metadata codegen succeeded against the real local metadata endpoint and added only those expected operation contracts; there is no parallel handwritten response/input contract. Unlink remains absent.

Fase 10B adds only frontend metadata-operation consumption of `inconnectMessagingConversationContext(conversationId)` and uses the generated metadata types/document. Frontend metadata codegen was regenerated successfully. Fase 10B did not add or change the backend GraphQL contract.

The CRM context Settings UI consumes `inconnectMessagingContextConfiguration` and `replaceInconnectMessagingContextConfiguration(fieldMetadataIds)` through generated metadata GraphQL types/documents. This frontend work added no backend GraphQL schema change. The generated metadata diff was audited: it added only the expected configuration-query and replacement-mutation variables/results and typed DocumentNodes, with no removed types or unrelated mass regeneration.

Phone Identity management uses `inconnectMessagingPhoneIdentityConfiguration` and `replaceInconnectMessagingPhoneIdentityConfiguration(fields)`. The configuration query includes safe eligible PHONES metadata in `availableFields`; there is no separate candidate query. Neither the human phone-resolution service nor the background resolver is exposed as a public GraphQL or REST search endpoint.

Send capabilities expose the safe provider-neutral media fields `canSendMedia`, `maxMediaItems`, `mediaTypes`, `mimeTypes`, `maxBytes`, and `captionSupported`. The final capabilities/catalog separation introduced no new GraphQL contract; 8B2 metadata codegen was regenerated successfully.
