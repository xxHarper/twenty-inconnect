# INCONNECT Messaging — CRM context, manual linking y Settings

Contrato vigente preservado del AGENTS original; reorganización documental del 2026-10-27.
Consultar [estado canónico](INCONNECT_PROJECT_STATUS.md) para aceptación, instalación y activación.
Este contrato no autoriza infraestructura, inspección PostgreSQL ni cambios Git.
Las rutas en código se expresan desde la raíz del repositorio. Las evidencias de
validación citadas son históricas, no ejecuciones de esta reorganización.

Contrato backend/frontend de lectura viva, presentación configurable y enlace
humano confirmado. No concede autoridad de edición CRM, unlink/relink, cambio de
anchor, resolución de relaciones ni realtime CRM. El enlace no conduce atención.
[Autoridad común](INCONNECT_MESSAGING_AUTHORITY_CONTRACT.md) y
[F13 automático](INCONNECT_F13_AND_ORM_CONTRACT.md) siguen siendo dominios distintos.

## Contract: Dynamic CRM Conversation Context

The secure runtime flow is:

    conversationId
    -> authorize Conversation
    -> derive configured anchor
    -> linkedRecordObjectMetadataId + linkedRecordId
    -> live metadata
    -> Twenty standard object and field permissions
    -> INCONNECT Record Access
    -> configured readable fields
    -> safe normalized context DTO

The context system is generic and anchor-driven. Never hardcode Lead, Folio ISO, phone, email, stage, phase, owner, or physical schema/table/column names. Lead and Folio ISO may be locally configured objects, but they are never product authority.

The public query is `inconnectMessagingConversationContext(conversationId)`. The client supplies only `conversationId`; workspace, record ID, ObjectMetadata, FieldMetadata, schema, table, and physical columns are derived server-side. Unauthorized or cross-workspace Conversation IDs retain the existing non-disclosing null/not-found behavior. A linked Conversation also returns that safe behavior if current Conversation authorization fails, Record Access is revoked, the anchor record disappears, or the final scoped query returns no row; never disclose that a forbidden record exists.

Public context states are `UNASSIGNED` and `LINKED`. An authorized `UNASSIGNED` Conversation has both linked-record fields null and the runtime `inconnectMessagingConversationContext` query returns null object/record data with an empty field list. That runtime query performs no candidate search, matching, auto-link, or record creation. Fase 12A provides a separate, explicit TRIAGE candidate-search API for a human linking workflow; F13 provides a separate post-persistence background auto-link path. Neither changes runtime-context read semantics.

Runtime context requires an authenticated Workspace, a valid human Workspace Member, `INCONNECT_MESSAGING`, current Conversation authorization, Twenty standard object read permission, current Twenty field read permission, and INCONNECT Record Access. `ContextField` is only a presentation allowlist and never grants record or field access. Configured fields are filtered for the current actor on every request; unreadable fields are neither selected nor returned and have no revealing placeholder. Actor-specific readable fields are never persisted in ContextField.

Authorization is retained on the actual dynamic CRM record query through `applyReadScopeToQueryBuilder`; a prior Conversation check is not a substitute. The workspace schema is derived server-side, the table comes from validated ObjectMetadata through Twenty helpers, columns come from live configured and readable FieldMetadata, and the record UUID is parameterized. Client-controlled strings never become SQL identifiers. One record-value query retrieves all readable configured values; there is no per-field value query.

`recordLabel` uses only `ObjectMetadata.labelIdentifierFieldMetadataId` when that Field is supported and readable by the current actor. It may be selected for this purpose even when it is not configured as a ContextField. If it is absent, unsupported, or unreadable, `recordLabel` is null; there is no fallback to another text field, phone, email, record ID, or arbitrary configured Field.

Safe runtime field DTOs expose only `fieldMetadataId`, label, `valueKind`, `displayValue`, and ordinal. The context summary may expose state, `objectMetadataId`, a safe object label, `recordId`, and `recordLabel`. It never exposes a raw entity or record JSON, physical schema/table/column identifiers, Record Access decisions or owner scopes, provider metadata, or private metadata internals.

Supported mappings are centralized:

- `TEXT`, `UUID`, `FULL_NAME` -> `TEXT`
- `NUMBER`, `NUMERIC` -> `NUMBER`
- `BOOLEAN` -> `BOOLEAN`
- `DATE` -> `DATE`
- `DATE_TIME` -> `DATE_TIME`
- `EMAILS` -> `EMAIL`
- `PHONES` -> `PHONE`
- `LINKS` -> `URL`
- `SELECT`, `RATING` -> `SELECT`
- `MULTI_SELECT` -> `MULTI_SELECT`

Normalization uses Twenty's actual composite shapes. `FULL_NAME` becomes deterministic safe text and never `String(object)`; EMAILS exposes only the primary safe email; PHONES only the primary calling code plus number; LINKS only the primary URL; SELECT and RATING use safe configured option labels; MULTI_SELECT uses deterministic ordered labels. Null and empty inputs have safe null behavior, and HTML is never presentation authority.

`RELATION` and `MORPH_RELATION` are unsupported ContextFields. They are absent from candidates, rejected by replacement validation, never dynamically joined, and never expose related IDs. There is not yet a generic OSS relation resolver that preserves standard permissions, target-object Record Access, and workspace isolation simultaneously; owner relations are not special-cased. Related Folio ISO or child lists, Activities, Tasks, and arbitrary relations are not implemented, and no Lead-specific related query exists.

Context values are live reads. Messaging stores neither a CRM value snapshot nor actor-specific field-access results. PostgreSQL CRM records, live metadata, and current permissions remain authority. The runtime context query remains read-only for CRM records and itself performs no matching, linking, or creation. Editing CRM fields, owner/stage/phase changes, unlink, and relink are not implemented. The private F13C create executor is never invoked by the context query. F12 human linking changes only the Messaging Conversation linkage tuple plus operational Outbox; the separate F13C.2B post-persistence path may create exactly one authorized CRM record for a ready `NO_MATCH` and then link it atomically. Configuration mutations change presentation, phone-identity, or auto-create administrative configuration only. No generic CRM-object realtime/SSE was introduced; existing Messaging realtime remains the delivery mechanism, and live CRM-context realtime requires separate design.

Context configuration management exposes `inconnectMessagingContextConfiguration` and `replaceInconnectMessagingContextConfiguration(fieldMetadataIds)`. The management query returns the current ordered configuration, safe supported candidates, and a minimal safe anchor summary, never CRM values or physical metadata. Candidates belong to the same workspace and exact configured anchor, use a supported type, and have deterministic ordering without product-specific priority.

Replacement input is only an ordered list of FieldMetadata IDs. The server derives workspace, object, ordinal, and physical identity; an empty list is valid and no default fields are auto-selected. Management requires an authenticated Workspace, a valid human Workspace Member, `MANAGE_INCONNECT_MESSAGING`, the existing settings/permission guard, and service-level revalidation. Manage permission does not imply Conversation access, send, or CRM record read.

Replacement locks the workspace-singleton MessagingConfiguration with `pessimistic_write`, validates the complete input before persistence, then deletes and inserts transactionally with server-generated ordinals. Concurrent valid writers serialize on the singleton row; the last valid serialized replacement wins. This is not optimistic revision control.

## Contract: Secure Manual CRM Linking Backend

Fase 12A implements the backend security and transaction foundation for explicit human linking. It does not itself include frontend behavior; the implemented Fase 12B UI consumes this backend without changing its authority. The backend contract flow is:

    authorized UNASSIGNED Conversation
    -> explicit human candidate search
    -> human chooses one candidate
    -> atomic authorized link
    -> LINKED Conversation

Candidate results are explicit text-search results for human selection, never automatic matches. This manual API performs no phone/email matching, confidence scoring, or sender-derived lookup, and it never creates a CRM record. F13B originally added exact configured-phone auto-link for an existing `UNIQUE` record; the separate current F13C.2B inbound Outbox path additionally permits conditional ready `NO_MATCH` create/link without changing these manual semantics.

The public metadata GraphQL surface is:

- `inconnectMessagingConversationLinkCandidates(conversationId, search, paging)`
- `linkInconnectMessagingConversation(conversationId, recordId)`

Candidate-search clients supply only Conversation ID, search text, and paging. Link clients supply only Conversation ID and record ID. Clients never supply workspace, ObjectMetadata, schema, table, physical Field, owner, Record Access scope, or Provider Connection. Both operations derive the target object exclusively from `MessagingConfiguration.anchorObjectMetadataId` plus live workspace metadata; there is no client object selector. Never hardcode Lead, Folio ISO, Contact, phone, email, stage, phase, owner, schema, table, or column in this path.

Candidate search is not a general CRM search API. It is valid only for a currently authorized `UNASSIGNED` Conversation and requires an authenticated Workspace, a valid human Workspace Member, `INCONNECT_MESSAGING`, `TRIAGE_INCONNECT_MESSAGING`, current Conversation authorization, Twenty standard READ permission on the configured anchor, current readable-field permissions, and INCONNECT Record Access. It does not require `SEND_INCONNECT_MESSAGING` or `MANAGE_INCONNECT_MESSAGING`; system context is not a human shortcut. Knowing a Conversation UUID grants nothing, and an already-linked Conversation is not a candidate-search session.

The search strategy is deliberately narrow. Generic Twenty Search is not reused because its `searchVector` may contain fields unreadable to the actor. Search uses only the live `ObjectMetadata.labelIdentifierFieldMetadataId` when that Field belongs to the exact configured anchor, is currently readable, and has type `TEXT`. If no safe readable canonical TEXT label exists, the candidate result is empty. There is no fallback to phone, email, another configured Field, record ID, an arbitrary TEXT Field, or another generic search surface. Search trims and compacts whitespace; blank search returns empty without querying candidates. Non-blank search uses parameterized `ILIKE` and escapes `%`, `_`, and backslash; search text is never interpolated into SQL.

The safe candidate DTO exposes only:

- `recordId`
- nullable `recordLabel`, resolved by the same readable canonical-label rule as runtime context
- ordered `fields[]` containing only `fieldMetadataId`, label, `valueKind`, `displayValue`, and ordinal

Candidate display fields are configured ContextFields intersected with the actor's currently readable Fields and use the existing safe Fase 10A normalization. Configuration grants no permission; unreadable configured Fields are omitted completely. Candidate output never contains a raw CRM row, workspace ID, owner scope, policy result, schema/table/column name, raw metadata entity, or provider information. A missing canonical label remains null and never falls back to record ID, phone, email, the first ContextField, or another TEXT Field. There is no separate linking-field configuration.

Authorization remains inside the final candidate SQL before count, cursor, ordering, and pagination. The QueryBuilder contains the authenticated workspace schema, validated dynamic anchor table, `deletedAt IS NULL`, the parameterized canonical-label predicate, `applyReadScopeToQueryBuilder`, and deterministic ordering. Never fetch candidates and post-filter Record Access in memory or in the frontend.

Dynamic physical-table candidate QueryBuilders use `.from(qualifiedTableName, alias)` rather than a TypeORM Entity alias. They must not use TypeORM `getCount()`, which requires `mainAlias.metadata` and fails for that alias. The current implementation clones the already-authorized QueryBuilder before paging, replaces its selection with `COUNT(1) AS count`, and executes `getRawOne()`. The clone retains search and Record Access predicates and has no cursor, `ORDER BY`, `LIMIT`, or `OFFSET`; never reconstruct Record Access in a second count query. The PostgreSQL count must be present, integer, non-negative, and `Number.isSafeInteger`-compatible before entering the GraphQL DTO.

Paging uses an opaque cursor based on canonical label plus record ID, ordered by canonical label ascending then record ID ascending. Total authorized count is computed before cursor pagination. A non-empty search performs one authorized count query plus one page query, with no per-candidate query; blank search performs no candidate query.

The link mutation requires an authenticated Workspace, a valid human Workspace Member, `INCONNECT_MESSAGING`, `TRIAGE_INCONNECT_MESSAGING`, and current authorization to the `UNASSIGNED` Conversation. It does not require SEND or MANAGE. The exact target additionally requires current Twenty standard object-read permission and INCONNECT Record Access. A prior candidate result grants no capability: the supplied record ID is always reauthorized at mutation time, protecting against ownership or Record Access changes, deletion, a wrong-object or cross-workspace UUID, and fabricated identifiers.

The transaction is:

    authenticate human
    -> begin transaction
    -> lock Conversation FOR UPDATE
    -> reread linkage and reevaluate Conversation authorization after the lock
    -> derive the current configured anchor
    -> reauthorize the exact target through the final Record Access-scoped query
    -> lock target FOR SHARE
    -> update the complete linked tuple
    -> persist CONVERSATION_LINKED OutboxEvent
    -> commit
    -> request publication after commit

No provider call occurs inside the transaction. Conversation `FOR UPDATE` / `pessimistic_write` serializes competing humans linking the same unassigned Conversation. After the winner commits, a loser rereads the linked state and cannot overwrite it; there is no last-write-wins relinking. Target `FOR SHARE` / `pessimistic_read` remains on the exact Record Access-scoped authorization query and protects the target-authorization-to-link-commit interval from an incompatible target write.

A retry of the same configured anchor plus record ID is idempotent when the actor remains currently authorized: it returns the current `LINKED` state, performs no second Conversation update, and emits no second `CONVERSATION_LINKED` event. A request for a different target never overwrites. It returns `CONVERSATION_ALREADY_LINKED` / conflict when current authorization remains, or the existing non-disclosing not-found behavior when it does not. Unlink and relink are not implemented.

Record Access denied, missing/deleted, wrong-object, and cross-workspace targets fail with not-found or equivalent non-disclosing behavior. The Conversation remains unassigned and no transition event is created. The linked tuple invariant remains physical and application-level: `linkedRecordObjectMetadataId` and `linkedRecordId` are both null or both present. The server derives the ObjectMetadata ID from the current configured anchor; the client supplies only record ID.

Linking changes only `Conversation.linkedRecordObjectMetadataId`, `Conversation.linkedRecordId`, and operational Outbox. It does not modify target owner, stage, phase, another CRM Field, relations, Tasks, Activities, or Folios. It also does not change Favorite, Unread, `manualUnread`, read cursor, Pending, `lastInboundAt`, WhatsApp session state, or provider state; Pending remains independent and manual.

A real transition persists exactly one `CONVERSATION_LINKED` Outbox event in the same transaction. Publication is requested only after commit. Public/member realtime continues to expose the existing `CONVERSATION_UPDATED` hint after current-recipient reauthorization. An unassigned triage viewer who loses access after linking is not entitled to the post-link hint and converges through an ordinary authorized list refetch or reconnect.

Once linked, existing runtime authorization and context rules apply. Fase 12A itself adds no frontend context-refresh lifecycle. The implemented Fase 12B UI owns explicit post-Link list, detail, and context refresh while rendering `LINKED` only from backend authority. There is still no Unlink or Relink action.

Fase 12A required no Entity, table, column, Fast Command, Slow Command, migration, or other schema change. It uses the existing Conversation linked tuple and Outbox architecture.

## Contract: Visible Manual CRM Linking UI

Secure Manual CRM Linking is implemented end to end. The visible flow is:

    authorized selected UNASSIGNED Conversation
    -> existing CRM Context surface
    -> explicit Link CRM record action
    -> SEARCH
    -> explicit user-submitted candidate query
    -> one human-selected candidate
    -> CONFIRM
    -> explicit Link action
    -> linkInconnectMessagingConversation
    -> backend-authoritative list/detail/context refresh
    -> LINKED CRM Context

Selection alone never links, and confirmation is mandatory. The frontend may show the Link action for an authorized selected `UNASSIGNED` Conversation, but it does not reconstruct TRIAGE authorization. Candidate search and Link remain subject to backend `INCONNECT_MESSAGING + TRIAGE_INCONNECT_MESSAGING + current Conversation/CRM authorization`; backend standard permissions and INCONNECT Record Access remain final authority.

Linking lives inside the existing CRM Context experience. On viewports wider than 1100 px it uses the existing third CRM Context pane. At 1100 px or narrower it uses the existing fullscreen CRM Context modal. There is no nested linking modal. The selected chat and composer remain mounted while linking is opened, searched, confirmed, canceled, or completed.

For `UNASSIGNED`, the normal panel displays `No CRM record linked.` and exposes `Link CRM record`. Entering linking changes that same Context surface to local `SEARCH`, `CONFIRM`, or `LINKING` state. Normal CRM Context remains outside linking mode. Linking state is Conversation-scoped, non-durable component state: it is not Jotai global authority, `localStorage`, or `sessionStorage`. Switching Conversation immediately clears its draft, submitted search, candidates, selection, confirmation, errors, and linking state.

Opening linking mode performs zero candidate queries. Search occurs only when the human submits the Search form by button or Enter. Blank or whitespace-only search is disabled/no-op and never returns all records. Search input draft and submitted search identity are distinct; editing the visible draft invalidates results from an older submitted value so they cannot remain selectable as if they matched the new text.

Never derive or prefill the manual candidate search from WhatsApp sender, phone, email, `waId`, `externalAddressNormalized`, Message content, or CRM heuristics. The F12 UI does no automatic identity matching, confidence scoring, automatic lookup, or auto-selection. F13 auto-link is a separate post-persistence background path and does not reuse or silently drive this human search UI.

Candidate queries use `fetchPolicy: network-only` and `nextFetchPolicy: network-only`. Candidate data is live authorization-sensitive CRM data; Apollo cache and `previousData` are never candidate authorization authority. Results and pagination are bound to `conversationId + submitted search + request generation`. If Search A returns after Search B, A cannot replace B. If Conversation A changes to B, late A query, `fetchMore`, or mutation completions cannot populate or alter B.

Candidate presentation uses only the backend DTO: nullable `recordLabel` plus ordered `fields[]`. A null label renders localized `Unlabeled record`; it never falls back to `recordId`, phone, email, first ContextField, object label, or search text. Raw record UUID is mutation input, never visible customer identity. Fields preserve backend order, label, and `displayValue`; null uses safe `—` / accessible `No value` semantics. Values are plain text only: the frontend does not normalize again, alphabetize, prioritize phone/email, create `mailto:`/`tel:`/URL navigation, or render HTML/Markdown. It performs no second CRM query, metadata query, per-candidate query, per-field query, owner reconstruction, or object reconstruction.

Candidate selection is accessible single-choice/radio-style state. Selecting another candidate replaces the prior selection and performs zero mutations. `CONFIRM` displays the same backend-safe candidate data and neutral consequence copy, including that changing or removing the link is not currently available. It never implies that CRM fields will be modified.

Cursor pagination exposes Load more and preserves the current `conversationId + submitted search`. The frontend does not re-sort or post-filter candidates. Conversation/search changes reset paging, and stale `fetchMore` results cannot merge into the current identity.

The Link mutation sends only `conversationId` and the selected opaque `recordId`. It never sends workspace, ObjectMetadata, schema, table, Field identity, owner, candidate values, or Record Access scope. While it is in flight, Link is disabled, an honest Linking state is visible, and a synchronous guard prevents duplicate submit; backend locking and idempotency remain final authority.

The frontend never marks a Conversation `LINKED` optimistically and never promotes candidate values into runtime CRM Context. For a successful Link on the same selected Conversation it clears linking state, refetches the active authorized Conversation list while preserving search and `ALL | UNREAD | FAVORITES | PENDING` work state, refetches selected detail, and explicitly refreshes CRM Context. Selected detail remains independent of current list membership and is not closed merely because the row leaves the current filter/search. `LINKED` is rendered only from the backend context response.

Ordinary `CONVERSATION_UPDATED` remains list/detail invalidation and does not globally invalidate CRM Context. Fase 12B refreshes context only as a direct consequence of local successful Link or already-linked conflict reconciliation. Pending, Favorite, and general Conversation events do not become CRM invalidation, and no CRM realtime, polling, or new subscription was introduced.

Stale target `NOT_FOUND` never claims success or discloses whether a hidden record exists; the selected candidate/current results are invalidated as implemented and another explicit authorized search remains possible. `CONVERSATION_ALREADY_LINKED` exits stale linking state, refetches list/detail/context, shows neutral localized already-linked feedback, and never overwrites or automatically retries another target. `NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`, or safe unavailable/null responses clear sensitive candidate/context state through the existing lost-access lifecycle; the narrow/mobile Context surface closes when that lifecycle requires it.

Linking does not change Favorite, Unread, `manualUnread`, `readThroughMessageId`, the read cursor, Pending, or automatic-read behavior. It does not reset same-Conversation draft text, selected template, attachment/upload state, `clientUploadId`, or `clientRequestId`/send intention. A late Link completion from Conversation A cannot change B, populate or close B context, clear B composer, select A, or show A candidate data.

The linking UI uses a semantic heading, labeled search input, Enter-submit form, loading/error/no-results semantics, keyboard-operable single selection with visible and accessible selected state, Back/Cancel, and disabled/busy Link behavior. State is never color-only. All visible copy uses Lingui/current localization conventions and generic `CRM record` language; frontend logic never hardcodes Lead, Folio ISO, Contact, phone, email, owner, stage, or phase.

The normal network shape is: open linking `0` candidate requests; submit Search `1` candidate query; Load more `1` additional candidate query; Select `0`; open Confirmation `0`; confirm Link `1` mutation; success performs authorized list, detail, and context refresh. There is no polling, new subscription, candidate N+1, field N+1, or CRM metadata query.

The frontend consumes generated metadata contracts:

- `InconnectMessagingConversationLinkCandidatesDocument`
- `InconnectMessagingConversationLinkCandidatesQuery`
- `InconnectMessagingConversationLinkCandidatesQueryVariables`
- `LinkInconnectMessagingConversationDocument`
- `LinkInconnectMessagingConversationMutation`
- `LinkInconnectMessagingConversationMutationVariables`

It maintains no parallel handwritten `Pick<Mutation>` or args contract. Metadata codegen succeeded against the real local `/metadata` endpoint. The checkpoint generated diff added 19 lines and removed none: only the expected candidate-query and Link-mutation variables/results and TypedDocumentNodes, with no unrelated mass regeneration or manual generated-file edit. The exact line count is validation evidence, not a permanent architecture invariant.

Fase 12B consumed Fase 12A as-is and required no backend source, Entity, schema, migration, Fast Command, Slow Command, Instance Command, or PostgreSQL write.

## Contract: CRM Context Configuration Settings

CRM context presentation fields are administered natively at Settings -> Messaging -> CRM context. The routes are `/settings/messaging` and `/settings/messaging/crm-context`; the parent route redirects to the CRM context editor. This administration is deliberately separate from Settings -> Security. `SettingsPath.Messaging` and `SettingsPath.MessagingCrmContext` represent those routes.

Navigation and direct-route access require `MANAGE_INCONNECT_MESSAGING`. `INCONNECT_MESSAGING`, `SEND_INCONNECT_MESSAGING`, and `TRIAGE_INCONNECT_MESSAGING` are not equivalent management authority, and the backend remains final authority. Management permission grants neither Conversation read nor runtime CRM context access, CRM record access, send, or triage.

Settings consumes only `inconnectMessagingContextConfiguration` for its safe anchor summary, current ordered fields, authorized supported candidates, and `maximumFieldCount`. It performs no generic ObjectMetadata or FieldMetadata query, CRM record query, raw metadata reconstruction, or frontend supported-type filtering; the backend candidate list is authority. The configured anchor is shown only through its safe label and is informational/read-only. There is no object selector, anchor change, or MessagingConfiguration creation/deletion, and the UI never hardcodes Lead or another CRM object.

The editor keeps server-confirmed ordered FieldMetadata IDs and a separate local ordered draft. Dirty comparison is order-sensitive, so `[A, B]` differs from `[B, A]`. Add appends an authorized candidate, deduplicates by `fieldMetadataId`, and changes only the draft. Remove changes only the draft, makes the Field available again when it remains an authorized candidate, and never deletes FieldMetadata or modifies CRM data. Available fields are backend candidates minus selected IDs, partitioned by ID rather than label; no candidate search is currently needed, though local label search over the already-authorized candidates may be added if the list grows.

Ordering uses accessible Move Up and Move Down controls; no drag/drop dependency was introduced. Add, Remove, and reorder make zero network calls and never autosave. The client submits the ordered FieldMetadata ID list itself and never submits ordinal values. Selected fields render in effective draft order, while field-specific Add, Remove, Move Up, and Move Down labels keep the controls keyboard-operable.

`maximumFieldCount` comes from the management API and is currently 20. At the limit, the frontend disables another Add and explains the maximum while still allowing Remove and reorder. The backend remains maximum-field correctness authority; never hardcode 20 as frontend authorization or validation authority.

An empty configuration is valid and may be saved as `fieldMetadataIds: []`. There is no forced default or forced canonical-label ContextField. When the management DTO identifies the canonical label Field, Settings may mark it informationally, but removing it from ContextField configuration remains valid. Runtime `recordLabel` is resolved independently by the backend, and the runtime panel continues to render its safe object/record summary and zero-field state.

Save calls `replaceInconnectMessagingContextConfiguration(fieldMetadataIds)` as one atomic full-set replacement. The frontend sends only ordered FieldMetadata IDs: never workspace ID, object metadata ID, ordinal, record ID, physical Field name, schema, table, or column. There is no optimistic configuration authority. After mutation success, Settings refetches `inconnectMessagingContextConfiguration`; only the normalized server result replaces both confirmed baseline and local draft, only then does dirty become false, and server order wins.

A mutation failure preserves the local draft, presents a safe error, permits retry or Reload, and never claims persistence. Reload refetches current server configuration and candidates and adopts that authority. Stale or invalid FieldMetadata may be rejected by the backend and is never force-saved by the frontend. Save and Cancel are disabled when draft equals baseline; Cancel restores the last server-confirmed order. There is no custom unsaved-navigation blocker because the repository has no standard reusable Settings pattern for it.

The management query uses `fetchPolicy: network-only` and currently needs no `nextFetchPolicy` override. Re-entering or remounting Settings performs a new backend-authoritative query; Apollo cache is not configuration authority. Reload and the post-Save flow both use `configurationQuery.refetch()`.

Management access loss follows protected Settings behavior. The protected route prevents unauthorized entry, safe query failures do not render configuration, and mutation authorization loss clears local management state and exits the protected page. Management state must never remain visible indefinitely after authorization loss.

Settings manages metadata and presentation configuration only. It never queries or previews customer names, phone numbers, emails, stages, or other CRM record values merely because the actor can manage Messaging. Safe metadata labels do not grant record read. The runtime panel remains unchanged and separate: saving Settings does not push configuration to another open Messaging page or tab, and there is no cross-page context-configuration realtime. Runtime observes the configuration on a future authorized context query, re-entry, or reconnect according to its existing lifecycle.

The page uses semantic headings, ordered and unordered field lists, field-specific action labels, keyboard-operable ordering, an announced maximum-field state, and no color-only state. New visible copy uses Lingui. Normal network shape is one management query on page load, zero calls for Add/Remove/reorder, one replacement mutation on Save, and one management refetch after Save; there is no autosave, polling, subscription, or per-field query.

This Settings capability consumes the existing CRM context management contract. It required no `twenty-server` change, entity change, Fast or Slow Command, migration, database schema change, or runtime-panel change.

## Contract: Dynamic CRM Conversation Context Panel

The selected Conversation has a visible, read-only dynamic CRM context experience. The frontend consumes exclusively `inconnectMessagingConversationContext(conversationId)` and supplies only `conversationId`. It does not issue a second generic CRM-record query or reconstruct workspace, record authorization, ObjectMetadata, FieldMetadata, permissions, Record Access, or context-field selection. The secure Fase 10A backend remains the sole context authority.

The panel is generic and renders only the safe context DTO. It has no knowledge of Lead, Folio ISO, phone/celular, email/correo, stage/etapa, phase/fase, owner, API field names, or physical schema/table/column names. Never branch on an object identity, Field name, or product-specific Field label in this frontend path.

On viewports wider than 1100 px, context renders as a third pane with responsive width `clamp(280px, 26vw, 360px)`, its own header area, and independently scrolling content; the Conversation list and chat remain usable. The pane is fixed/responsive, not resizable. At 1100 px or narrower, the UI does not attempt to show all three panes simultaneously. The selected Conversation header exposes the accessible `Show CRM context` action, which opens the context in Twenty's existing fullscreen modal. Closing it returns to the same selected chat; the Conversation and composer remain mounted, preserving draft and composer state.

Context is queried only for the currently selected Conversation: one request per selected-Conversation load or authorized refetch. There is no per-row query, list prefetch, per-field query, or second generic CRM read. With no selected Conversation, there is no context query or stale context display.

Conversation-switch privacy is a permanent invariant. Request state is bound to `conversationId + refreshNonce`; when selection changes from A to B, A's label and values disappear synchronously and B shows its loading state. A late response for A is ignored and cannot populate B. Apollo uses `fetchPolicy: network-only` and `nextFetchPolicy: network-only`, does not render `previousData`, and returns loading with null context whenever request identity is stale or mismatched. Re-entering a Conversation performs a new authorized network read; Apollo cache is not context authority because CRM context is authorization-sensitive live data.

An SSE reconnect visually invalidates the current context, increments the context refresh nonce, and refetches only the currently selected Conversation with the same `conversationId`. Messaging realtime is not CRM realtime: `MESSAGE_CREATED`, `MESSAGE_UPDATED`, `MESSAGE_STATUS_CHANGED`, and `CONVERSATION_UPDATED` do not invalidate CRM context merely because they occurred. There is no CRM polling, generic-object SSE, CRM-field subscription, or workspace-wide CRM realtime. Current context refresh occurs through selection, re-entry, or reconnect; a Pending change is not CRM invalidation.

For `LINKED`, the panel renders the safe object label, canonical `recordLabel` when available, and configured fields in server-returned order. The raw `recordId` is not the primary visible identity. A null `recordLabel` displays the localized `Unlabeled record`; it never falls back to the record ID, first configured Field, phone, email, or object label. For `UNASSIGNED`, the panel displays the localized `No CRM record linked.` and exposes the explicit `Link CRM record` action. Entering linking mode replaces the same Context surface with the manual Fase 12B workflow; there is no nested modal. The runtime `inconnectMessagingConversationContext` query itself still performs no candidate search, create, matching, auto-link, linking mutation, or additional CRM lookup. Only explicit Search-form submission invokes the separate Fase 12A candidate query, and only explicit confirmed Link invokes its manual mutation; the F13 automatic exact-phone path runs separately after inbound persistence. After success, the panel explicitly refreshes backend-authoritative context. `LINKED` with an empty `fields` list is valid: the object/record summary remains and the panel displays `No context fields configured.` without fetching arbitrary fields or inferring defaults.

Each field renders its safe label and backend `displayValue` in backend order; ordinal/server order remains authority and the frontend does not alphabetize or prioritize fields. A null display value renders `—` with accessible `No value` semantics. Unauthorized fields are omitted by the backend and are not represented as null placeholders. Current safe value kinds are `TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `DATE_TIME`, `EMAIL`, `PHONE`, `URL`, `SELECT`, and `MULTI_SELECT`. `valueKind` remains safe metadata while `displayValue` is presentation authority. The frontend never recreates normalization for `FULL_NAME`, `EMAILS`, `PHONES`, `LINKS`, SELECT options, or MULTI_SELECT.

All context values render as plain text. The context path adds no `dangerouslySetInnerHTML`, Markdown or arbitrary HTML rendering, `mailto:` behavior, `tel:` behavior, URL navigation, or open-record navigation. EMAIL, PHONE, and URL values remain safe text.

Context loading has a dedicated skeleton announced with accessible status semantics and never leaves values from a previous Conversation visible. It is distinct from `UNASSIGNED`, zero configured fields, error, and unavailable states. An ordinary safe failure displays only the localized `CRM context is unavailable.` without backend or security detail. `NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`, and a safe null/unavailable result clear all context values and reuse the existing unavailable-Conversation flow as applicable. Losing selected-Conversation authorization clears the record label and every field value and closes an open narrow/mobile context modal without disclosing whether a CRM record exists.

Selected detail remains independent from active list membership. If an authorized selected Conversation leaves `UNREAD`, `FAVORITES`, or `PENDING`, or disappears from the current search result, its context remains attached to the open detail. Search or work-state changes alone do not clear context or reinsert a frontend-only row. Loading or showing context does not mutate `isUnread`, `readThroughMessageId`, manual Read/Unread, Favorite, Pending, or automatic-read behavior.

Opening or closing context does not reset draft text, template selection, upload/attachment state, or send intention. Accessibility uses a context region with an associated heading, accessible `Show CRM context` and `Close CRM context` actions, the existing fullscreen modal focus/Escape/close behavior, `dl`/`dt`/`dd` field semantics, an accessible null placeholder, and `role=status` for loading. New visible copy uses Lingui.
