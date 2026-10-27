# INCONNECT Messaging — Favorite, Unread, Pending y realtime

Contrato vigente preservado del AGENTS original; reorganización documental del 2026-10-27.
Consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para aceptación, instalación y activación.
Este contrato no autoriza infraestructura, inspección PostgreSQL ni cambios Git.
Las rutas en código se expresan desde la raíz del repositorio. Las evidencias de
validación citadas son históricas, no ejecuciones de esta reorganización.

Favorite/Unread son personales; Pending es compartido. La ruta manual legacy y
la nueva unidad causal R4 no son equivalentes. El estado fuente/operativo y las
reglas aprobadas por revisión/epoch se definen en
[Attention](INCONNECT_ATTENTION_GUARDRAILS.md) y [estado](INCONNECT_PROJECT_STATUS.md).
«Not integrated» en el contrato histórico significa que no hay integración
operativa liberada: existe la composición inbound R4 SOURCE-ONLY dormante.
No activar el worker ni sustituir el booleano legacy por este documento.

## Contract: Conversation Work State

`ConversationMemberState` is durable personal state with `id`, `workspaceId`, `conversationId`, `workspaceMemberId`, `favorite`, the tuple `lastReadMessageCreatedAt + lastReadMessageId`, `manualUnread`, `createdAt`, and `updatedAt`. Its logical identity is unique by workspace + Conversation + Workspace Member. Favorite and Unread are personal; they are never global Conversation fields. `Conversation.pendingAt` is shared Conversation state: null means not pending and non-null means pending.

Pending in the current product code is manual. Automatic inbound renewal and revision-covered HUMAN DELIVERED/READ closure are approved in the source-only attention domain, but are not integrated; see INCONNECT_PROJECT_STATUS.md and INCONNECT_ATTENTION_GUARDRAILS.md. Current Pending is not activated automatically by inbound activity, cleared automatically by a reply, or derived from unread, owner, Record Access, or Commercial Teams. `setInconnectMessagingConversationPending(conversationId, pending)` locks and updates the Conversation and, only for a real state transition, persists `CONVERSATION_PENDING_CHANGED` in the durable Outbox in the same transaction. Publication is requested after commit. A same-value mutation is a no-op, and changing Pending does not require `SEND_INCONNECT_MESSAGING`.

`MessagingConfiguration.workStateTrackingBaselineAt` is a PostgreSQL/server-owned rollout timestamp. When a Workspace Member has no personal read cursor, it is the effective read baseline: historical inbound before the baseline is read by default, while inbound persisted after the baseline is unread. There is no Conversation × Workspace Member backfill, and listing Conversations never creates `ConversationMemberState` rows.

Unread is derived, not a persisted simple boolean:

    isUnread = manualUnread
      OR EXISTS INBOUND Message newer than the effective arrival cursor/baseline

Only `INBOUND` Messages participate. `OUTBOUND` Messages never create unread, PostgreSQL Message history remains authority, and new inbound processing does not fan out writes to a personal-state row for every possible recipient. This avoids NxM writes, stale authorization snapshots, and coupling inbound persistence to personal-state fanout.

The normal new-inbound path is `persist inbound Message -> existing MESSAGE_CREATED hint -> authorized client refetch -> server compares the current member's arrival cursor/baseline -> isUnread may become true`. The realtime hint triggers a safe refetch; it is not personal-state authority.

Message display chronology and personal unread arrival order are deliberately independent:

- Message history/display uses `COALESCE(effectiveInboundAt, createdAt), id` to represent the effective/provider-facing chat chronology.
- Read/unread uses the server-owned arrival tuple `Message.createdAt, Message.id` to represent when the Message reached and was persisted by this server.

Never unify these orders. A delayed inbound may have `createdAt` after the current read cursor but an older `effectiveInboundAt`, so it may appear earlier in visual history while still becoming unread. For example, after reading through M10, a later-arriving M11 with `M11.createdAt > M10.createdAt` and `M11.effectiveInboundAt < M10.effectiveInboundAt` is unread; mark-all-read then advances to M11 by arrival order. This is intentional behavior.

The durable personal cursor is `(lastReadMessageCreatedAt, lastReadMessageId)` and represents exactly `(Message.createdAt, Message.id)`. The UUID is only a deterministic tie-break when two Messages have equal `createdAt`; it carries no chronological meaning. Cursor advancement is monotonic, so a stale Mark Read cannot move it backward.

PostgreSQL `timestamptz` preserves microseconds while JavaScript `Date` preserves only milliseconds. The read cursor must therefore never perform `SELECT Message.createdAt -> JavaScript Date -> persist timestamp`. Mark Read selects and persists the exact `Message.createdAt + Message.id` tuple directly inside PostgreSQL. JavaScript does not transport the cursor timestamp, preventing an already-read Message from remaining newer than its own truncated cursor.

`markInconnectMessagingConversationRead(conversationId, throughMessageId?)` has two modes:

- With `throughMessageId`, the Message must belong to the same workspace and Conversation and be `INBOUND`; PostgreSQL supplies its exact arrival tuple, and the cursor can only advance.
- Without `throughMessageId`, it means “mark all currently existing inbound Messages as read”; PostgreSQL selects `ORDER BY Message.createdAt DESC, Message.id DESC LIMIT 1` and persists that tuple exactly. If no inbound exists, it clears `manualUnread` without fabricating a cursor.

`markInconnectMessagingConversationUnread(conversationId)` sets `manualUnread = true` without rewinding either cursor component. Mark Read advances the cursor monotonically and clears `manualUnread`. Thus a manual-unread cursor at M10 remains unread through a later M11, and Mark Read through M11 produces cursor M11 with `manualUnread = false`, read unless a newer inbound exists.

Favorite is exclusively personal. Without `ConversationMemberState`, `isFavorite` is false. `setInconnectMessagingConversationFavorite` operates only on the authenticated Workspace Member; clients never submit `workspaceMemberId`, there is no global Favorite or admin override, and APIs never expose who else favorited a Conversation.

Favorite, Mark Read, Mark Unread, and Pending require an authenticated human Workspace Member, `INCONNECT_MESSAGING`, and current Conversation authorization. The existing `TRIAGE_INCONNECT_MESSAGING` contract applies to unassigned Conversations. These work-state operations do not require `SEND_INCONNECT_MESSAGING`; personal identity always comes from the auth context, and system context is not a human shortcut.

Physically, `ConversationMemberState` has a Workspace FK and a composite Conversation + workspace FK. It intentionally has no physical FK to Workspace Member because Workspace Members live in dynamic per-workspace schemas. Workspace Member validity is a runtime-only invariant enforced through centralized authorization. A removed member may leave an orphan personal-state row; it cannot become another member's state, block the Conversation, or be read through another actor. Explicit orphan-state GC may be added later.

Conversation queries resolve authorization, current-member state, search, and the `ALL | UNREAD | FAVORITES | PENDING` predicate in SQL before count, ordering, and pagination. Favorite and Unread always use only the authenticated Workspace Member; filters accept no member ID. Never fetch a page and post-filter work state in memory or the frontend. The physical model supports this with unique workspace + Conversation + member identity, a current-member Favorite lookup index, a Message unread index on workspace + Conversation + direction + createdAt + id, and the direct `Conversation.pendingAt` predicate; there is no per-Conversation N+1 personal-state query.

The authorized Message connection exposes nullable `readThroughMessageId` for conservative automatic read. It is an opaque, read-only, server-derived Message UUID scoped by the authorized workspace and Conversation. The server selects only `INBOUND` Messages using arrival order `Message.createdAt DESC, Message.id DESC`; it never exposes the cursor timestamp, `manualUnread`, `ConversationMemberState`, Workspace Member identity, or a provider/effective timestamp as read authority.

`readThroughMessageId` is snapshot-safe: the latest relevant arrival inbound is returned only when that Message is part of the slice actually returned by the current authorized Message page. A row fetched only as the pagination lookahead for `hasNextPage` is not presented and cannot become the target. If the newest arrival inbound is outside the current visual page, the field is null, the Conversation remains unread, and automatic read must not run. If a delayed inbound is present in the returned slice, it may be the target even when provider/effective display chronology places it behind visually newer Messages; clients must never choose `edges[0]` as a substitute for arrival semantics.

The Fast Instance Command `2-32-instance-command-fast-1790006024000-add-inconnect-messaging-conversation-work-state.ts` adds the `ConversationMemberState` table, `Conversation.pendingAt`, `MessagingConfiguration.workStateTrackingBaselineAt`, and their work-state indexes and constraints. Real disposable-PostgreSQL validation established PRE-9 compatibility, rollout-baseline behavior, no NxM state backfill, entity/schema parity, Favorite uniqueness, workspace/Conversation FK enforcement, the read-cursor tuple check, Pending state, successful real `up` and `down`, valid PRE-9 restoration, and no required Slow Command. This does not assert execution in production.

Architecturally, `down` removes `ConversationMemberState`, Pending schema, the work-state baseline, and only the Fase 9 indexes, while Messages and Conversations remain. Loss of Favorite, Unread, and Pending state on downgrade is intentional. Persisted `CONVERSATION_PENDING_CHANGED` Outbox rows may remain valid because Outbox `eventType` has no physical allowlist constraint; no downgrade migration defect was found.

## Contract: Realtime Outbox and Subscription

Realtime publishing follows:

    domain transaction -> OutboxEvent PENDING -> COMMIT -> immediate enqueue
    -> BullMQ publishing job -> authorized member-scoped fanout -> Redis PubSub

The outbox publisher, BullMQ job, immediate enqueue after successful commit, member-scoped fanout, and at-least-once retry are implemented. Enqueue, processing, or publishing failure leaves durable PostgreSQL authority for retry by the one-minute recovery cron. That cron is a recovery fallback, not the normal publication path. An event with zero authorized recipients can complete without inventing recipients.

The dedicated metadata GraphQL subscription is `onInconnectMessagingEvent` on `INCONNECT_MESSAGING:{workspaceId}:{workspaceMemberId}`. Inbound, outbound, media-readiness, and shared Conversation activity use the provider-neutral `MESSAGE_CREATED`, `MESSAGE_STATUS_CHANGED`, `MESSAGE_UPDATED`, and `CONVERSATION_UPDATED` hints with `eventId`, `eventType`, `conversationId`, optional `messageId`, and `occurredAt`; `MESSAGE_UPDATED` covers changes such as media ingestion completion or failure.

Shared Pending follows `Conversation.pendingAt transition -> CONVERSATION_PENDING_CHANGED OutboxEvent -> durable outbox -> current authorized recipients -> member-scoped Redis channel -> CONVERSATION_UPDATED -> authorized refetch`. Its hint identifies the event and Conversation, with `messageId` null or absent. It never contains Workspace Member identity, Favorite, `manualUnread`, or a read cursor. There is no workspace-wide publication or parallel outbound/file realtime channel. Hints contain no body, template details, address, location, file URL, bytes, MIME details, provider locator, CRM data, provider metadata, credentials, or raw webhook payload. The server enumerates candidate members and reauthorizes each recipient against current Conversation access before publishing; clients cannot choose workspace/member IDs and there is no system bypass. Revocation before publication prevents delivery.

PostgreSQL and the authorized Read API remain authority. Redis realtime is not a data store; duplicate hints are harmless, and reconnect triggers authorized API refetch rather than client-side historical replay. Never use generic object SSE or a workspace-wide stream as a Messaging authorization shortcut.

The inbox treats realtime as list-membership invalidation, not state authority. `MESSAGE_CREATED` refetches the current authorized Conversation list and, for the selected Conversation, its current detail/Messages; this allows a previously absent row to enter `UNREAD` only after the backend derives it. `CONVERSATION_UPDATED` refetches the current list and selected detail so shared Pending membership can change. `MESSAGE_STATUS_CHANGED` and `MESSAGE_UPDATED` retain their localized selected-detail/Message refresh behavior. Reconnect refetches the current authorized list and selected detail. All list refetches preserve active search and `workState`; they must not fall back to `ALL` or an empty search.

Immediate cross-tab/device synchronization for personal Favorite and direct read/unread mutations is not implemented. This is distinct from a new inbound `MESSAGE_CREATED` hint causing an authorized refetch whose server-derived result may become unread. Never invent a shared personal-state broadcast.

## Contract: Native Messaging Frontend

Twenty has a native Messaging navigation entry and route. Navigation visibility uses `INCONNECT_MESSAGING`, while backend authorization still decides which Conversations and Messages are returned. The inbox has a Conversation list, backend-authorized search, cursor pagination, selection, and Message history with older-message loading. It renders inbound and outbound bubbles, text, structured locations, authorized lazy image previews, visual stickers, authorized audio and supported video playback, document filename/type/size with authorized open/download, and safe vCard/contact presentation with download. `PENDING` media shows processing state; `FAILED`, `EXPIRED`, unavailable, and legacy media without an Attachment show a safe unavailable state. It also renders persisted outbound states and durable template audit details, handles desktop and narrow screens, loading/empty/error states, and lost access by clearing previously visible Conversation content. `MESSAGE_UPDATED` and other realtime hints, plus reconnect, cause localized authorized refetches.

The selected Conversation includes the dynamic CRM context UI described above: a desktop third pane on viewports wider than 1100 px and Twenty's fullscreen context modal on narrower/mobile layouts. Both forms use the same selected-Conversation-only secure query and keep the chat/composer lifecycle independent from context visibility. For an authorized `UNASSIGNED` Conversation, the same surface provides the explicit `Link CRM record` action, manual Search, safe candidate list, single selection, mandatory confirmation, authorized Link, and backend-authoritative context refresh without nesting another modal.

The inbox exposes visible server-backed `ALL`, `UNREAD`, `FAVORITES`, and `PENDING` views. The frontend sends `workState` to `inconnectMessagingConversations`; search and work state compose in the authorized backend query. Changing work state starts the first page of the new filter instead of reusing another filter's cursor. Search preserves the active work state, `fetchMore` preserves search plus work state, and realtime/reconnect refetches reuse the active variables. Authorization, search, work-state predicates, count, ordering, and pagination execute in backend SQL. The frontend must never implement these views with `allConversations.filter(...)` or locally reorder Conversations by Favorite, Unread, or Pending.

Conversation rows use only backend-derived work state. `isUnread` drives non-color-only emphasis and an unread indicator and is never reconstructed from loaded Messages. `isFavorite` is personal and drives the visible favorite/star state. `isPending` is shared and drives the visible Pending badge/state; it is never inferred from unread, message direction, ownership, inbound activity, outbound activity, or replies. Dedicated empty states exist for each work-state view and for search-plus-filter with no matches; loading, error, and empty remain distinct. The accessible tab-like filter can scroll horizontally on narrow layouts rather than breaking the page. Work-state text uses Lingui, action labels reflect their current state, and pending mutations expose disabled/busy behavior.

The selected Conversation header exposes Add/Remove Favorite through `setInconnectMessagingConversationFavorite`, Mark/Clear Pending through `setInconnectMessagingConversationPending`, and manual Mark Read/Mark Unread. Favorite and read mutations never accept a Workspace Member ID. Pending remains shared and manual in this implemented UI/runtime; the approved source-only attention rules are not integrated, so no inbound, outbound, read, or reply rule currently sets or clears it automatically. Manual Mark Read calls `markInconnectMessagingConversationRead(conversationId)` without `throughMessageId`, meaning “mark all currently existing inbound Messages as read” on the server. Manual Mark Unread calls `markInconnectMessagingConversationUnread(conversationId)` without a cursor and relies on the durable backend `manualUnread` semantics. Mutations refetch authorized state rather than making frontend work state authoritative.

Automatic read is deliberately narrower than manual Mark Read. When an unread Conversation is selected, the frontend may call Mark Read only with the current server-derived `readThroughMessageId`; it never uses the no-argument mark-all mode, sends a timestamp, constructs an arrival tuple, or round-trips a PostgreSQL cursor through JavaScript. A `MESSAGE_CREATED` `messageId` is only a realtime hint and must never be passed directly as `throughMessageId`. The flow is `MESSAGE_CREATED -> authorized Conversation/Message refetch -> current Messages render -> server-provided readThroughMessageId -> optional automatic read`.

Automatic read runs only while `document.visibilityState === 'visible'` and the matching Conversation remains selected. A hidden tab may receive realtime and refetch, but new inbound remains unread and no automatic Mark Read starts. When visibility returns, the frontend evaluates the current authorized target rather than reusing a stale target captured before hiding. There is intentionally no global presence system.

Manual Mark Unread activates a Conversation-scoped, frontend-only suppression so an open Conversation is not immediately auto-read again. The suppression is not persisted in PostgreSQL or localStorage; it survives rerenders, Message refetches, realtime-style refreshes, list refetches, and changes to `readThroughMessageId`. It ends only after explicit manual Mark Read or after leaving/unmounting and later re-entering the Conversation. Backend `manualUnread` remains durable authority. Auto-read mutation lifecycle and identity guards are also Conversation-scoped: a late completion from Conversation A must not change Conversation B's guards, suppression, refetch context, or visible work state.

Message `fetchMore` merges visual edges and read-target metadata with different rules. Edges retain their cursor order and are deduplicated. If the accumulated connection has no safe target and an older visual page first presents the delayed relevant inbound, it may adopt that page's target. Once an accumulated safe `readThroughMessageId` exists, older-page metadata cannot replace it with null or an older arrival target. Message connection merging must preserve the newest/safest accumulated target rather than blindly adopting all metadata from the older page; this invariant is regression-tested.

Filtered list membership and selected detail are independent. After auto-read in `UNREAD`, unfavorite in `FAVORITES`, or Clear Pending in `PENDING`, the row may disappear following the authorized list refetch while the still-authorized selected detail remains open. The frontend must neither close the detail merely because filter membership changed nor reinsert a frontend-only row to keep it visible.
