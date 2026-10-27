# INCONNECT Messaging — proveedores, media, Send y Dispatch

Contrato vigente preservado del AGENTS original; reorganización documental del 2026-10-27.
Consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para aceptación, instalación y activación.
Este contrato no autoriza infraestructura, inspección PostgreSQL ni cambios Git.
Las rutas en código se expresan desde la raíz del repositorio. Las evidencias de
validación citadas son históricas, no ejecuciones de esta reorganización.

Contrato de transporte durable y seguridad de media.
[Autoridad humana](INCONNECT_MESSAGING_AUTHORITY_CONTRACT.md),
[Attention](INCONNECT_ATTENTION_GUARDRAILS.md) y
[F13](INCONNECT_F13_AND_ORM_CONTRACT.md) se componen sin nuevas capacidades
implícitas. Los detalles Twilio descritos pertenecen sólo a su adaptador actual.
La integración de intención/cobertura HUMAN en Send/Dispatch/callbacks no se
declara completada por la preparación inbound R4.

## Contract: Secure Outbound Upload Staging

The outbound upload backend follows:

    authenticated human
    -> createInconnectMessagingOutboundUpload
    -> actor/workspace-scoped Outbound Upload staging
    -> generic FileUploadService server-owned primitive
    -> FileStorage + FileEntity
    -> completeInconnectMessagingOutboundUpload
    -> verify actual stored size
    -> detect MIME from bytes
    -> content fingerprint
    -> Outbound Upload AVAILABLE

Creation and completion require an authenticated human Workspace Member with `INCONNECT_MESSAGING` and `SEND_INCONNECT_MESSAGING`. Knowing an upload ID is not authorization: every operation resolves the staging row for the current workspace + actor. Staging authorization never substitutes for current Conversation authorization, which is evaluated again at send time.

The raw `clientUploadId` is scoped by workspace + actor. The server derives deterministic staging and `FileEntity` identities so retries of the same upload intention reuse one logical upload; conflicting filename, type, or size metadata for that intention fails. Public clients never choose a `FileEntity` ID. Frontend/API callers receive only an opaque upload identity and a bounded upload capability.

Outbound staging expires after 24 hours, and expired uploads cannot be consumed. An `AVAILABLE` upload that is never sent remains private and actor-scoped but may leave its `FileEntity` and storage object until future explicit garbage collection or reconciliation; no automatic GC is implemented.

### Core File Upload Boundary

Twenty's `FileUploadService` exposes generic reusable server-owned create, refresh, and completion primitives. It does not know that INCONNECT Messaging exists. Core owns generic upload mechanics such as configured global size ceilings, pending `FileEntity` creation, upload capabilities, storage metadata verification, byte-based file detection, and temporary-file completion rules.

INCONNECT Messaging owns `FileFolder.InconnectMessaging` selection, logical media policy, MIME allowlists, media size limits, workspace/actor authorization, deterministic upload identity, and staging lifecycle. Permanent boundary: core provides generic file-upload primitives; feature modules own feature-specific upload policy. A public upload API must never expose the server-owned file-ID capability.

The frontend shares the feature-neutral `uploadFileToUrl` transport primitive extracted from the previous `useDirectFileUpload` transport. It uses the exact backend-provided upload URL with `PUT`, the `File` as the request body, the backend-provided `Content-Type`, the caller's `AbortSignal`, and `credentials: 'omit'`; non-successful HTTP responses retain the existing failure behavior. It does not derive a bucket/path, alter the upload authority, persist the URL, or contain INCONNECT, Messaging, WhatsApp, or Twilio logic. Existing Twenty `useDirectFileUpload` consumers retain their prior behavior. Shared upload transport must remain feature-neutral.

## Contract: Message and Media Content Taxonomy

The implemented provider-neutral Message types are `TEXT`, `IMAGE`, `STICKER`, `AUDIO`, `VIDEO`, `DOCUMENT`, `CONTACT`, and `LOCATION`.

- Normal Unicode, emoji, multi-codepoint emoji, and ZWJ sequences remain `TEXT`; there is no separate emoji Message type.
- `LOCATION` is structured provider-neutral inbound content and is not stored as a File or Attachment; outbound `LOCATION` is not implemented.
- `CONTACT` represents a vCard for safe presentation/download and supported outbound delivery. Supported normalization includes `text/vcard`, `text/x-vcard`, and `application/vcard`; it never auto-imports CRM data, creates a Lead, or changes ownership.
- `STICKER` is provider-neutral domain semantics. The Twilio WhatsApp adapter classifies `image/webp` as `STICKER` according to the documented contract for that specific provider/channel; never generalize WEBP-to-STICKER classification to future providers.
- Reactions are not implemented and must not be modeled as ordinary TEXT emoji. No stable reaction model exists.

### Durable Template Intent

`Message` stores provider-neutral template intent and historical audit through:

- `templateId`
- `templateProviderReference`
- `templateDisplayName`
- `templateLanguage`
- `templateVariables`
- `templateDefinitionFingerprint`

Outbound intent is classified provider-neutrally as `FREEFORM` or `TEMPLATE`. The frontend selects a local opaque `templateId`; `templateProviderReference` and the real provider identity remain server-side. A Message retains enough normalized template identity, display, language, variables, and definition fingerprint to interpret a historical send without depending on the current provider catalog.

The Fast Instance Command is `2-32-instance-command-fast-1789473600000-add-inconnect-messaging-template-intent.ts`. It was validated against an isolated disposable PostgreSQL database, not asserted as applied to production. Existing PRE-7B rows remain valid immediately after `up`, so no Slow Command or backfill is required. `down` converts existing `TEMPLATE` Messages to `FREEFORM` before dropping template metadata; this intentionally loses template classification and metadata but restores a valid PRE-7B schema.

## Contract: Outbound State Machine

Persisted outbound states are `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, and `UNKNOWN`.

The pure central authority is `resolveInconnectMessagingOutboundStateTransition` in `state-machine/outbound-message-state-machine.ts`. Its authoritative transition table rejects undeclared transitions and ignores duplicate or lower-progress callbacks.

- `LOCAL_PENDING` is UI-only and must never be persisted.
- `READ` never degrades and is terminal.
- `FAILED` is terminal and never reopens.
- `UNKNOWN` represents an ambiguous provider outcome and must not trigger blind automatic retry; a later definitive callback may resolve it.
- A future business retry creates a new `Message` linked through `retryOfMessageId`; it does not reopen the old Message.
- The Twilio adapter normalizes provider `UNDELIVERED` to `FAILED` while preserving provider status/error metadata.

The state machine is used by the operational dispatch pipeline. `providerRequestStartedAt` marks the conservative submit boundary: a crash or transport ambiguity after it may produce `UNKNOWN`. The system prefers a possible missed send over a possible duplicate send and never automatically retries an ambiguous provider outcome. A later definitive callback may resolve `UNKNOWN` only through an allowed state-machine transition.

## Contract: Provider Architecture

The current symbols are `InconnectMessagingProvider`, `InconnectMessagingProviderRegistry`, and `FakeInconnectMessagingProvider`.

- `(provider, channel)` identifies an adapter.
- Unknown combinations and duplicate registrations fail closed.
- The provider contract supports provider-neutral free-form text and media dispatch, template dispatch capability, and a normalized template catalog when the adapter supports them. Media capabilities declare supported logical types, supported MIME, maximum attachment count, and whether body/caption is supported.
- The inbound provider boundary can supply provider-neutral `IMAGE`, `STICKER`, `AUDIO`, `VIDEO`, `DOCUMENT`, and `CONTACT` attachments without exposing Twilio locator semantics to the domain or frontend. `LOCATION` remains structured content.
- The Fake Provider supports the dispatch and template cases needed by tests/development and is not registered automatically by `InconnectMessagingModule`.
- `TwilioWhatsappMessagingProvider` is registered by `InconnectMessagingModule` for inbound normalization, authenticated media retrieval, signed status callbacks, outbound free-form text/media dispatch, outbound template dispatch, and template catalog normalization.
- Provider account, sender, credentials, Content SIDs, and raw provider template payloads do not become public domain authority.

The current Twilio WhatsApp adapter accepts at most one outbound media item. Its own adapter-local capability supports `IMAGE` as JPEG/PNG, `STICKER` as WEBP, supported WhatsApp audio MIME, `VIDEO` as MP4, supported PDF/Office `DOCUMENT`, and vCard `CONTACT`. `IMAGE` may carry the current free-form body as a caption; the other currently supported media types do not. Unsupported type, MIME, count, or caption combinations fail closed. These are Twilio adapter constraints, not universal domain rules. Outbound `LOCATION` and rich/media templates are not implemented.

## Contract: Twilio Inbound and Status Pipeline

Public Twilio WhatsApp endpoints route only by the opaque `ProviderConnection.inboundRoutingKey`. They resolve exactly one enabled connection before decrypting its provider credential object with `SecretEncryptionService`; no webhook-supplied workspace identifier is authoritative. The Twilio adapter validates the effective proxy-aware request URL and form/body data with the official Twilio validator before any receipt or domain effect is written.

Validated events are normalized provider-neutrally and persisted idempotently in `WebhookReceipt`. The HTTP path commits PostgreSQL before requesting BullMQ processing. A recurring recovery scan re-enqueues `RECEIVED` receipts and expired `PROCESSING` leases, covering a successful DB commit followed by enqueue failure. Processing claims receipts with a lease and performs each domain effect, receipt completion, and `OutboxEvent` in one transaction.

Inbound senders are canonicalized within their Provider Connection. Processing creates or reuses one unassigned Conversation and creates one inbound Message per connection-scoped provider message ID. It normalizes the implemented Message taxonomy, records server/provider/effective timestamps, and advances `lastInboundAt` monotonically. The signed HTTP webhook never downloads media and never performs a network fetch inside a long SQL transaction.

Inbound media follows the durable pipeline:

    signed Twilio webhook
    -> durable WebhookReceipt
    -> Message + Attachment PENDING
    -> COMMIT
    -> BullMQ media ingestion
    -> authenticated Twilio media fetch
    -> MIME, size, and security validation
    -> FileStorage
    -> FileEntity
    -> Attachment AVAILABLE
    -> OutboxEvent
    -> MESSAGE_UPDATED
    -> authorized API refetch

Twilio `MediaUrl` values are opaque temporary ingestion locators, not product download URLs or historical storage. They are accepted only after normalization from a signed Twilio webhook and are never returned to the frontend. Media retrieval is HTTPS-only and fail-closed: it validates Twilio account, message, media, host, and path correlation; limits redirects to allowed Twilio/CDN destinations; does not forward credentials arbitrarily; and enforces timeout, maximum size, MIME verification, and SSRF protections. Never fetch an arbitrary URL supplied by a client or user.

The media policy requires provider-declared MIME, response MIME, detected file content, and logical attachment type to agree. The current maximum is 16 MiB. Unsupported, mismatched, or unsafe content fails closed; filename extensions are not authority, and active HTML/SVG is not accepted for inline media.

Successfully ingested media uses Twenty's existing `FileEntity`, `FileStorageService`, storage drivers, `FileFolder.InconnectMessaging`, `FileService`, and Content-Disposition helpers. There is no parallel INCONNECT storage system. `FileStorage`/`FileEntity` becomes durable media authority after successful ingestion; Twilio is not historical media storage.

Attachment creation is idempotent by `Message + ordinal`. File identity and storage path are deterministic, duplicate webhook/job processing does not create multiple logical Attachments, and recovery re-enqueues `PENDING` Attachments and expired `PROCESSING` leases. Temporary failures retry under a controlled maximum; terminally unavailable provider media can become `EXPIRED`. PostgreSQL state, not BullMQ job deduplication, is the correctness boundary.

PRE-8A Messages with historical media metadata but no Attachment remain valid. The current policy ingests new inbound media but does not automatically download or backfill historical Twilio media; legacy media without Attachment may remain unavailable or `UNKNOWN`. Any historical backfill requires separate explicit design and authorization, and no Fast migration performs network downloads.

The Fast Instance Command is `2-32-instance-command-fast-1789682400000-add-inconnect-messaging-inbound-attachments.ts`. It was validated by executing the real command against disposable PostgreSQL, not asserted as applied to production. Validation established that `up` accepts PRE-8A data, no Slow Command is required, the physical Attachment schema matches the entities, and the Message type constraint adds `STICKER` and `CONTACT`. `down` succeeds with POST-8A rows by converting `STICKER` to `IMAGE` and `CONTACT` to `DOCUMENT` before restoring the PRE-8A constraint; it removes the Attachment table but does not clean `FileEntity` or physical storage rows.

The current file lifecycle can leave orphan `FileEntity` or storage objects. Message deletion cascades Attachment deletion, but the File row and physical object may remain. A crash after a successful inbound storage write but before Attachment reaches `AVAILABLE` can leave bytes and/or a File row orphaned if later provider refetch is impossible. Outbound debt also includes abandoned `AVAILABLE` staging and `FileEntity`/storage that survive staging removal or the Outbound Upload Fast Command `down`. Deterministic identity prevents multiplication during ordinary retry but is not full garbage collection or reconciliation. A consumed Outbound Upload references its Message, and the current restrictive FK can prevent Message deletion while that staging row exists. Safe explicit GC/reconciliation is future work; do not add destructive cascade rules without a separate design.

Status callbacks resolve only an exact local outbound Message by workspace, Provider Connection, and provider message ID. Every accepted callback can produce a `ProviderStatusEvent`; projection changes use the existing outbound state machine, so duplicates and late lower-progress states do not degrade the Message. Missing local Messages remain durable and retryable until controlled operational failure. Webhook processing has no CRM-record, Lead, linking, ownership, or human-authorization capability.

A status callback can arrive before the provider SDK call returns. Correlation uses the opaque Provider Connection routing key, a signed local Message ID, workspace, Provider Connection, `OUTBOUND` direction, and the Twilio Message SID after signature validation. A late dispatcher response cannot degrade `DELIVERED` or `READ` back to `SENT`.

## Contract: Durable Outbound Dispatch

Human outbound dispatch follows one durable pipeline:

    authenticated human mutation
    -> InconnectMessagingAuthorizationService
    -> server-side send/session policy
    -> resolve and lock any actor-owned outbound staging
    -> transactional Message QUEUED + optional Attachment AVAILABLE
    -> mark staging CONSUMED + DispatchAttempt + OutboxEvent
    -> COMMIT
    -> immediate BullMQ enqueue
    -> durable claim
    -> provider-neutral text/template/media dispatch
    -> normalized result
    -> outbound state machine
    -> status callback progression
    -> realtime hint and authorized refetch

No Twilio call occurs inside the database transaction, and enqueue happens only after a successful commit. PostgreSQL remains authority. Recovery scans cover a lost post-commit enqueue, process restart, queued work, and expired leases without making BullMQ authoritative.

At send time the server authorizes the Conversation, revalidates the 24-hour free-form session when applicable, locks and resolves the current actor's staging rows, creates or reuses the idempotent Message, creates outbound `Attachment` rows already in `AVAILABLE`, marks staging `CONSUMED`, and records `DispatchAttempt` + `OutboxEvent` in the same transaction. After commit, `Message` + `Attachment` + `FileEntity` are historical authority; later reads and renders do not depend on the staging row.

Outbound Attachment `AVAILABLE` means only that durable validated media is ready for provider delivery. It does not mean the Message was sent. Message state remains independently `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, or `UNKNOWN`; provider delivery failure never reuses Attachment ingestion state. Media dispatch preserves the `providerRequestStartedAt` conservative boundary: an ambiguous submit becomes `UNKNOWN`, is never blindly retried, and may be resolved later only by a definitive callback allowed by the existing state machine.

## Contract: Authorized Attachment Access

Every file request follows `Attachment -> Message -> Conversation -> InconnectMessagingAuthorizationService -> Twenty standard permission -> INCONNECT Record Access`. For an unassigned Conversation, the existing `INCONNECT_MESSAGING AND TRIAGE_INCONNECT_MESSAGING` contract applies. Never authorize from only `workspaceId + fileId` or `workspaceId + attachmentId`; knowing a UUID grants neither existence disclosure nor download access.

The file stream is opened only after current Conversation authorization succeeds. Missing, unavailable, unauthorized, revoked, and cross-workspace resources use the same not-found/non-disclosing behavior for an authenticated caller. Download responses use `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, safe filenames, and Twenty's existing Content-Disposition policy. Only allowlisted media can render inline; active HTML/SVG is not served inline.

Human and provider access are intentionally distinct:

    HUMAN: Attachment -> Message -> Conversation authorization -> FileEntity/FileStorage
    PROVIDER: expiring provider-media capability -> exact OUTBOUND AVAILABLE Attachment
              -> exact workspace FileEntity -> FileStorage stream

Twilio has no human session and cannot use the human attachment endpoint. Provider delivery therefore uses a server-generated, signed, expiring, attachment-bound, workspace-bound, exact-purpose capability with dedicated JWT type `INCONNECT_MESSAGING_PROVIDER_MEDIA`. It is valid only for an exact outbound `AVAILABLE` Attachment. It is not a human access token, workspace session, API key, GraphQL authentication token, or upload token and cannot authenticate a human.

The provider delivery route supports `GET`/`HEAD` for one exact outbound Attachment. It resolves the `FileEntity` server-side and serves only `FileFolder.InconnectMessaging`; it accepts no arbitrary file ID, path, workspace selection, or inbound Attachment, and invalid capabilities fail closed as not found. Provider access never makes FileStorage public, and provider URLs/tokens are never returned through normal frontend GraphQL DTOs.

The provider-media capability currently reuses `FILE_TOKEN_EXPIRES_IN`; the effective/default value validated at this checkpoint is one day. This is a non-blocking **FOLLOW-UP RECOMMENDED**: a dedicated provider-media TTL may later reduce exposure without changing normal Twenty signed-file flows. It is not a current security defect.

Once outbound staging is consumed, its Attachment uses the same authorized human file path as inbound media. Provider capability expiration does not affect historical Conversation access, and no separate outbound-media read API exists.

## Contract: Human Send and Idempotency

The metadata GraphQL mutation `sendInconnectMessagingMessage` reauthorizes the current human and Conversation on every request and accepts optional opaque `outboundUploadIds` for server-resolved media. The public client does not provide a `FileEntity` ID, storage path, authoritative MIME, provider URL/token, sender, or Provider Connection. The frontend creates one raw `clientRequestId` for each user send intention and preserves it across safe retries. The backend derives a scoped UUID v5 from workspace, actor, Conversation, and the raw client request ID. Outbound Messages with a non-null client request ID have unique protection on `(workspaceId, clientRequestId)`.

The normalized content, template identity, and template variables participate in `requestFingerprint`. For outbound media it also includes normalized media intent: body/caption, ordered upload/attachment identity, logical media type, and durable content fingerprint. The same `clientRequestId` with the same media intention returns the same logical Message; the same key with different media fails with `IDEMPOTENCY_KEY_CONFLICT`. Correctness never depends only on disabling the Send button or frontend debounce, and the frontend does not create a duplicate optimistic Message.

`clientRequestId` identifies one user send intention, independently from upload idempotency. An uncertain retry of the same send preserves it. Editing text/caption, changing an attachment, selecting or changing a template or its variables, or changing send mode creates a new send intention. A successful send clears the current send and upload composer state.

## Contract: WhatsApp Session Policy

Free-form text and media send authority is server-side. The WhatsApp session is open only when `0 <= now - lastInboundAt < 24 hours`; no inbound timestamp, exactly 24 hours, more than 24 hours, or a future/skewed timestamp is closed. The UI reflects this state but is not authority. Both the mutation and dispatcher reauthorize and revalidate before submit. An `AVAILABLE` outbound Attachment never bypasses the session policy.

If the session closes after queueing but before dispatch, Twilio is not called, the Message becomes `FAILED`, the `DispatchAttempt` becomes `FAILED_BEFORE_SUBMIT`, and the safe error is `SESSION_WINDOW_CLOSED`; there is no automatic retry.

## Contract: Templates and Send Capabilities

The provider-neutral template catalog and dispatch path support currently approved WhatsApp templates with compatible textual `twilio/text` content. Rich, card, list, and media templates remain unsupported and fail closed. Template selection uses a local opaque ID; the public domain and UI do not know the Content SID, provider account, sender, or credentials.

`InconnectMessagingAuthorizedProviderContextService` centralizes the shared internal provider-context resolution without duplicating authorization. It authorizes the Conversation for send, derives the Provider Connection server-side, verifies its workspace and enabled state, decrypts credentials server-side, resolves the provider/channel through the registry, and returns an internal provider context. The frontend cannot provide or select a Provider Connection or provider. This service performs no provider network I/O.

`inconnectMessagingSendCapabilities(conversationId)` uses that authorized context, local `provider.capabilities`, local `provider.outboundMediaCapabilities`, and server session policy. Its safe provider-neutral DTO includes `canSend`, `canSendFreeform`, `canSendTemplate`, session-window state, expiry, safe reason information, and media hints: `canSendMedia`, `maxMediaItems`, `mediaTypes`, per-type `mimeTypes`, `maxBytes`, and `captionSupported`. These are UX hints only; upload completion, the send mutation, and the dispatcher remain MIME, size, session, authorization, and send authority. The DTO exposes no provider name, Provider Connection, sender, Content SID, upload/provider-media URL or token, storage path, or `FileEntity` authority.

Send-capability resolution must not call `provider.listTemplates()` or depend on the Twilio Content API. `canSendTemplate` means that the resolved provider structurally supports template dispatch; it does not mean that at least one approved/selectable remote template currently exists. Actual current template availability comes from the authorized template catalog and picker. A remote catalog outage must not disable unrelated `canSendFreeform`, `canSendMedia`, media count/type/MIME/size/caption hints, or session capability resolution.

`inconnectMessagingTemplates(conversationId)` uses the same authorized provider context and then calls `provider.listTemplates()` to normalize, filter, and fingerprint current templates. It returns a safe normalized DTO containing concepts such as local template ID, display name, language, textual preview, and variable descriptors. It never returns Content SIDs or raw provider metadata, and only currently usable, approved, supported templates are selectable. A remote catalog outage may fail this template-specific query according to its contract, but cannot fail send-capability resolution. Template-specific validation and send may legitimately re-resolve the catalog; free-form and media capability resolution may not.

Template variables have normalized keys and deterministic values. Required variables must be present; extras, duplicates, missing values, and provider/template constraint violations are rejected. Normalized variables participate in the idempotency fingerprint. Arbitrary raw JSON is never forwarded directly to Twilio.

Before a template submit, the Twilio adapter resolves the exact server-side provider reference and uses the official Content API/Message Resource path. The worker re-resolves that identity and compares `templateDefinitionFingerprint`; a modified or revoked template fails closed and is never silently substituted.

The functional composer supports text free-form sends, a Send button, server-driven 24-hour-window UX, a template picker, dynamic variable inputs, a safe template preview, an attachment button, and a hidden accessible file picker. It supports one current attachment under the resolved provider capability, with `SELECTED`, `UPLOADING`, `FINALIZING`, `READY`, and `FAILED` lifecycle states, Retry, Remove/cancel, and explicit replacement by removing and selecting a new file. Uploading is an honest indeterminate state; no real percentage progress is claimed. Drag/drop and clipboard image paste are not implemented.

The outbound attachment flow is:

    select File
    -> generate clientUploadId
    -> createInconnectMessagingOutboundUpload
    -> use the exact backend upload capability
    -> PUT through feature-neutral uploadFileToUrl
    -> completeInconnectMessagingOutboundUpload
    -> backend validates stored bytes, MIME, and size
    -> READY
    -> sendInconnectMessagingMessage(outboundUploadIds)
    -> authorized Read API/realtime renders the persisted Message

The frontend never supplies a file ID, storage path, authoritative MIME, provider URL or provider-media token, sender, or Provider Connection. It creates one `clientUploadId` for one selected-file upload intention. Retry of that same intention, including upload or completion failure, preserves the ID; Remove plus a new selection/replacement creates a new ID. Conversation switch or authorization loss discards the old local upload intention. `clientUploadId` is upload idempotency and is distinct from `clientRequestId`, which is Message-send idempotency.

`IMAGE` and `STICKER` have a local visual preview; `AUDIO` and `VIDEO` use local browser playback when supported; `DOCUMENT` and `CONTACT` use a safe file representation. Object URLs are ephemeral and are revoked on Remove, replacement, successful send, Conversation switch/unmount, and authorization loss. Active PUT requests are aborted where possible. File bytes and object URLs are never persisted in localStorage or durable global state.

Late completion from an obsolete upload intention must never mutate the current composer. The current frontend uses an `AbortController`, aborted checks after asynchronous boundaries, and upload-intention identity guards. A late result from File A cannot replace File B after remove/replace, and a late upload from Conversation A cannot populate Conversation B. Attachment/upload state is Conversation-scoped; switching Conversation clears it, aborts the current PUT where possible, revokes previews, and never silently retargets staged media.

Caption/body support comes from provider media capabilities, not a universal frontend media-type rule. The current Twilio capability permits the current `IMAGE` caption behavior. Non-empty text with a media type that does not support captions blocks Send without silently erasing the draft.

Template and free-form outbound media are separate modes. Templates cannot send `outboundUploadIds`, media mode cannot retain template variables, and an existing attachment is not silently deleted when the template picker is opened or a template is selected; the user must explicitly resolve the conflict. Media templates are not implemented. Changing modes creates a new send intention.

When `canSendFreeform` is false, attachment selection and media Send are disabled while an existing attachment can still be removed; the template flow remains separate when available. If the session closes during upload or after the user initiates Send, the backend remains authority and safely returns `SESSION_WINDOW_CLOSED`; there is no automatic retry or media-to-template conversion. `NOT_FOUND`, `FORBIDDEN`, and `UNAUTHENTICATED` paths clear sensitive composer state, including previews, upload state, active requests, and the send intention, while preserving the existing unavailable-Conversation behavior.

The current safe Twilio capabilities expose outbound selection/upload/send for `IMAGE`, `STICKER`, audio files, `VIDEO`, `DOCUMENT`, and `CONTACT`/vCard. This does not include microphone voice recording, outbound `LOCATION`, or media templates. Successful media sends are not represented by a permanent optimistic local copy; they render through the existing authorized Message Read API, realtime hints, and Attachment descriptors/components.

The UI never controls Content SID, sender, Provider Connection, credentials, outbound state, session authority, storage paths, or provider media locators. The browser never loads Twilio `MediaUrl` directly, and media bytes are not persisted in localStorage or durable Jotai state. Messaging operations participate in metadata GraphQL codegen, and the frontend consumes generated metadata operation types rather than a parallel handwritten GraphQL contract.
