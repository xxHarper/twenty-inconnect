# INCONNECT — inventario y matriz de preservación de AGENTS.md

Fecha: 2026-10-27. Modernización documental; no producto, auditoría nueva, SQL,
infraestructura ni Git writes. La raíz exige consultar contratos antes de editar.

## Preflight e integridad del original

- Rama `feature/inconnect-lead-management`; HEAD
  `f164bf937a5260983778dbca8a3a8e833b2e1bde`.
- Worktree sin cambios tracked/untracked y staging vacío al inicio.
- MVP integrado registrado en ese commit; AGENTS tracked y contenido idéntico a
  HEAD antes de editar: **248,493 bytes / 2,067 líneas**.
- SHA-256 original:
  `168d38ff8cba14400e15e22b408e1275f50409721c139bd096648c4bbb88782d`.
- Recuperación íntegra read-only:
  `git show f164bf937a5260983778dbca8a3a8e833b2e1bde:AGENTS.md`.
  No se depende de que HEAD siga apuntando a ese commit tras futuros commits.
- Se leyó el original completo, incluidas líneas 1921–2067. El archivo original
  temporal se usó para comparación literal y segmentación; no se movió el
  monolito a otro documento. Los contratos se separaron por responsabilidades.

## Descubrimiento real y presupuesto de instrucciones

Se inspeccionaron, sin revelar otras claves de configuración:
`CODEX_HOME=/mnt/c/Users/Lenovo/.codex`, su `config.toml`, AGENTS global y posibles
overrides, padres del workspace y configuración `.codex` del proyecto. No hay
`project_doc_max_bytes`, fallback filenames ni profile explícitos en la
configuración accesible; AGENTS global está vacío y no se encontró override
global/de ancestros/proyecto. No se modificó configuración global ni local.

[OpenAI Docs: descubrimiento AGENTS](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
documenta 32 KiB predeterminados combinados, descubrimiento raíz→cwd y prioridad
de override. [Referencia de configuración](https://learn.chatgpt.com/docs/config-file/config-reference)
describe project_doc_max_bytes. **32,768 bytes es el presupuesto predeterminado
inferido de archivos accesibles, no una lectura del estado interno efectivo de
la app**: overrides de lanzamiento/administrados no expuestos no se pueden
excluir. El mensaje de instrucciones recibido en este chat ya estaba truncado;
no se asumió que 248 KB se inyectaban íntegros. El nuevo mapa completo cabe bajo
el predeterminado; los contratos son lectura explícita obligatoria, no archivos
de instrucciones automáticamente concatenados.

AGENTS existentes fuera del área INCONNECT (sin cambios):

| Archivo | Bytes | Aplicabilidad |
| --- | ---: | --- |
| `packages/twenty-codex-plugin/AGENTS.md` | 5,285 | Sólo ese paquete |
| `packages/create-twenty-app/src/constants/template/AGENTS.md` | 4,660 | Template; no gobierna twenty-server/front |
| `packages/twenty-apps/public/last-contact/AGENTS.md` | 4,228 | Sólo esa app |
| `packages/twenty-apps/public/call-recorder/AGENTS.md` | 4,230 | Sólo esa app |
| `packages/twenty-apps/internal/twenty-partners/AGENTS.md` | 6,315 | Sólo esa app |

Se inventariaron rutas/tamaños de esos AGENTS, no se incorporaron reglas de apps
ajenas al ámbito. Ningún AGENTS anidado aplica a `twenty-server`/`twenty-front`;
no se creó uno. Raíz + mayor AGENTS existente quedan por debajo de 32 KiB.
No se garantiza un presupuesto administrado oculto menor: si cambia, debe
revisarse otra vez. Reglas críticas van primero y el mapa precede convenciones.

## Inventario A–G y decisiones

A = instrucciones permanentes; B = seguridad/arquitectura; C = contrato de módulo;
D = estado verificable; E = historia/evidencia; F = comando potencialmente
peligroso; G = backlog/requisito. Una sección puede tener varias clases.

Se contrastaron documentos existentes Lead 1A/remediación/R2/R3/1B-1A/MVP,
Attention dominio/C1/C2/I-A/I-B/II/III-A/B1/R1–R4, runner/harness/upgrades,
checkpoints Git y puntos de entrada de fuente relevantes en lectura. Ningún
contrato adicional de Record Access/Owner/Teams/context/media con ese detalle
existía en docs: se trasladaron los bloques técnicos conservados. El documento
mayor de contratos es CRM context, separado de autoridad, work-state y delivery.
No se creó un archivo técnico de 248 KB ni se ocultaron reglas sólo en Git.

- **Duplicados**: Working Rules repetía contratos detallados y prohibiciones.
  Se consolidó cada regla en su contrato y raíz; tablas siguientes acreditan
  correspondencia. No se quitó una prohibición por antigüedad.
- **Estado obsoleto**: 19 de octubre ya no es checkpoint vigente; C2-I-A pendiente
  y «sin executor distribuidor» se sustituyen por commits posteriores y límites
  SOURCE-ONLY. El motor categorizado puro sigue separado del MVP no categorizado.
- **Etiquetas de entrega**: MVP y R4 «pendiente/REQUIRES REMEDIATION» son previas
  a commits de aceptación; avisos fechados señalan estado canónico sin reescribir
  evidencia histórica. C2/README de dominio ya no reabren DELIVERED/READ aprobado.
- **Fuente vs operación**: R4 tiene composición inbound fuente, sin cutover;
  Pending manual legacy sigue vigente. No se afirma integración automática
  operativa, DDL instalado o B1 completada. Gate/SQL/errors no habilitan legacy.
- **Comandos**: ejemplos de start/reset/migrate/setup y Git writes pasan a OPS
  como referencias no autorizantes. Preflight/autorización/islamiento permanecen.
- **Historia**: conteos de tests, ramas pasadas, UUIDs de fixture y transcripciones
  no son reglas actuales. Git conserva el detalle completo; cada contrato técnico
  y limitación vigente tiene destino vivo. STATUS conserva evidencia relevante
  por entorno sin revalidación PostgreSQL.
- **Backlog**: telephony íntegra, clasificación agregada, TODOS, retención/GC,
  restore y demás límites siguen pendientes; no se autoriza ninguna fase.

## Matriz por secciones del original

Los números siempre son líneas del blob original, no de la raíz nueva.
Para bloques técnicos, «conservado» se sustenta en extracción del texto de esos
rangos a los destinos, con encabezados ajustados y avisos de estado. Para historia,
la justificación explica qué se consolida/supersede y dónde sigue el contrato.

| Rango original | Clase | Destino vigente | Tratamiento y autoridad |
| --- | --- | --- | --- |
| 1–22 | A/B | [ROOT] | Consolidada: prohibiciones al principio; sin excepciones de licencia/ejecución. |
| 23–72 | D/E | [STATUS] | Supersedida sólo la fase siguiente: commits C2-I-A a R4; no activación. |
| 73–100 | B/C/D | [MVP], [ATT] | Contrato preservado; ejecución MVP implementada SOURCE-ONLY, categorías aún sin autoridad. |
| 101–119 | B/C/D | [ATT], [STATUS] | Política aprobada preservada; integración inbound fuente R4 supera el rótulo anterior, sin cutover. |
| 120–133 | A/B | [ROOT], [OPS] | Prohibiciones y gates conservados; sin autorización física. |
| 134–224 | D/E/B | [OPS], [STATUS] | Checkpoint fechado histórico; gates siguen vigentes, no lifecycle físico. |
| 225–323 | A/F | [OPS] | Ejemplos trasladados, explícitamente NO AUTORIZANTES; Git sólo del usuario. |
| 324–451 | A | [ROOT], [OPS] | Convenciones conservadas; instrucciones de codegen/tests sólo para código autorizado. |
| 452–461 | D/E | [STATUS] | Handoff histórico supersedido en estado, no en contratos F13/manual. |
| 462–750 | B/C | [SEC] | Contrato conservado por ámbito, incluida política Owner/Teams/cache/Settings. |
| 751–798 | B/C | [AUTH] | Persistencia/identidades conservadas; instalación depende de evidencia por entorno. |
| 799–901 | B/C | [F13] | Contrato técnico conservado, incluida autoridad CREATE sin READ y manager original. |
| 902–907 | E | [STATUS], [F13] | Validación histórica archivada en Git; límites y contrato presentes, no nuevos PASS. |
| 908–938 | B/C | [F13] | Unidad CRM post-durabilidad y ramas/concurrencia conservadas. |
| 939–946 | D/E | [STATUS], [F13] | Aceptación física de desarrollo fechada, no despliegue; follow-ups preservados. |
| 947–996 | B/C | [F13] | Identidad canónica/transporte y autoridad humana/background separadas. |
| 997–1207 | B/C | [CTX] | Contrato completo de context/manual link/Settings conservado. |
| 1208–1258 | B/C | [WORK] | Cursor, baseline, Pending manual, invariantes y downgrade preservados. |
| 1259–1408 | B/C | [DELIVERY] | Upload/provider/media/dispatch conservados, sin red dentro de SQL. |
| 1409–1422 | B/C | [SEC] | Fachada pública y sus límites conservados; no raw cache/policies en consumidores. |
| 1423–1468 | B/C | [AUTH] | Autoridad humana/flags/no divulgación/read API conservados. |
| 1469–1518 | B/C | [DELIVERY] | Acceso a adjuntos, capacidades, sesiones, templates e idempotencia conservados. |
| 1519–1537 | B/C | [WORK] | Fanout member-scoped, refetch y ausencia de broadcast personal preservados. |
| 1538–1563 | B/C | [CTX] | Frontend context, privacidad A/B y límites de realtime preservados. |
| 1564–1585 | B/C | [WORK] | Inbox y work-state frontend preservados, incluido auto-read y merge. |
| 1586–1616 | B/C | [DELIVERY] | Composer y protección de intenciones/upload asíncrono preservados. |
| 1617–1661 | C/D/E | [AUTH] | API y DTO conservados; éxitos codegen citados son históricos. |
| 1662–1684 | C/F | [OPS] | Cadena base histórica preservada; nuevo comando C2 remite a I-B, sin instalación. |
| 1685–1738 | E | [STATUS], [OPS] | Conteos/logs antiguos no son reglas; Git archiva detalle, contratos y limitaciones siguen en destinos. |
| 1739–1758 | C/D/G | [BACKLOG], [STATUS] | Backlog preservado; R4 fuente distingue integración preparada de operativa. |
| 1759–1782 | A/B/E | [OPS] | Precedencia proceso/dotenv y aislamiento conservados; incidente es histórico. |
| 1783–1802 | G | [BACKLOG] | REQ-TEL-001 completo, explícitamente no implementado. |
| 1803–1866 | D/E | [STATUS], [SEC], [OPS] | IDs/demo/ramas previas no son autoridad actual; efectos de Roles y gates conservados. |
| 1867–1920 | A/B/F | [OPS] | Procedimiento de upgrade conservado; Git writes sólo usuario, DB/deploy gates separados. |
| 1921–1937 | A/B | [ROOT], [OPS] | Cada regla final revisada individualmente abajo. |
| 1938–1953 | B/C/D | [ATT] | Reglas preservadas; sólo C2-I-A pending se supersede por checkpoints. |
| 1954–2067 | B/C | [AUTH], [CTX], [WORK], [DELIVERY], [F13], [SEC], [OPS] | Cada regla Messaging revisada individualmente abajo; duplicados consolidados en contrato. |

### Índice exhaustivo de encabezados originales

No se consideran encabezados los comentarios dentro de ejemplos fenced.
Cada subsección hereda el contrato/destino del rango, y Working Rules se detalla
además regla por regla. Los checkpoints antiguos son evidencia fechada.

| Línea | Sección original | Clase | Destino |
| ---: | --- | --- | --- |
| 1 | AGENTS.md | A/B | [ROOT] |
| 11 | Project Overview | A/B | [ROOT] |
| 15 | INCONNECT Project Overrides | A/B | [ROOT] |
| 23 | Current INCONNECT Lead Management and WhatsApp Attention Checkpoint — 2026-10-19 | D/E | [STATUS] |
| 35 | Phase status and implementation boundary | D/E | [STATUS] |
| 73 | Lead Management functional contract and pending authority | B/C/D | [MVP], [ATT] |
| 101 | Approved WhatsApp attention business and domain contract | B/C/D | [ATT], [STATUS] |
| 120 | Operational boundary retained | A/B | [ROOT], [OPS] |
| 134 | Current INCONNECT Operational Checkpoint — 2026-10-14 | D/E/B | [OPS], [STATUS] |
| 142 | Product status and deployment boundary | D/E/B | [OPS], [STATUS] |
| 157 | Committed development preparation | D/E/B | [OPS], [STATUS] |
| 169 | PG1 isolation evidence and limits | D/E/B | [OPS], [STATUS] |
| 188 | F13C.3B1 lifecycle tooling — SOURCE-ONLY IMPLEMENTATION COMPLETE | D/E/B | [OPS], [STATUS] |
| 213 | Execution boundary | D/E/B | [OPS], [STATUS] |
| 225 | Key Commands | A/F | [OPS] |
| 229 | Development | A/F | [OPS] |
| 240 | Testing | A/F | [OPS] |
| 262 | Code Quality | A/F | [OPS] |
| 284 | Build | A/F | [OPS] |
| 292 | Database Operations | A/F | [OPS] |
| 306 | Database Inspection (Postgres MCP) | A/F | [OPS] |
| 317 | GraphQL | A/F | [OPS] |
| 324 | Architecture Overview | A | [ROOT], [OPS] |
| 326 | Tech Stack | A | [ROOT], [OPS] |
| 331 | Package Structure | A | [ROOT], [OPS] |
| 345 | Key Development Principles | A | [ROOT], [OPS] |
| 356 | Naming Conventions | A | [ROOT], [OPS] |
| 363 | File Structure | A | [ROOT], [OPS] |
| 369 | Comments | A | [ROOT], [OPS] |
| 375 | State Management | A | [ROOT], [OPS] |
| 381 | Backend Architecture | A | [ROOT], [OPS] |
| 388 | Database & Upgrade Commands | A | [ROOT], [OPS] |
| 400 | Utility Helpers | A | [ROOT], [OPS] |
| 404 | Development Workflow | A | [ROOT], [OPS] |
| 408 | Before Making Changes | A | [ROOT], [OPS] |
| 415 | Code Style Notes | A | [ROOT], [OPS] |
| 421 | Testing Strategy | A | [ROOT], [OPS] |
| 429 | Dev Environment Setup | A | [ROOT], [OPS] |
| 446 | Important Files | A | [ROOT], [OPS] |
| 452 | INCONNECT - Stable Project State / Handoff | D/E | [STATUS] |
| 462 | Purpose and Licensing Boundary | B/C | [SEC] |
| 483 | Completed Security Model | B/C | [SEC] |
| 516 | Completed SQL Enforcement | B/C | [SEC] |
| 555 | Operation Policies and Owner Integrity | B/C | [SEC] |
| 598 | Current Functional Policies | B/C | [SEC] |
| 600 | Lead | B/C | [SEC] |
| 607 | Folio ISO | B/C | [SEC] |
| 616 | Commercial Teams | B/C | [SEC] |
| 664 | Persisted Record Access Authority | B/C | [SEC] |
| 688 | Source Modes and Policy Cache | B/C | [SEC] |
| 692 | `env` (default) | B/C | [SEC] |
| 697 | `transition` | B/C | [SEC] |
| 703 | `database` | B/C | [SEC] |
| 727 | Record Access Settings | B/C | [SEC] |
| 751 | INCONNECT Messaging | B/C | [AUTH] |
| 757 | Implemented Persistence Foundation | B/C | [AUTH] |
| 799 | Implemented F13C Auto-Create and Transactional Inbound Orchestration | B/C | [F13] |
| 803 | Persisted Auto-Create Configuration | B/C | [F13] |
| 818 | Fail-Closed Structural Eligibility | B/C | [F13] |
| 822 | Caller-Owned Transaction and Write Receipt | B/C | [F13] |
| 837 | Technical Automation WorkspaceMember | B/C | [F13] |
| 863 | CREATE Is Not READ | B/C | [F13] |
| 867 | Exact Payload and Position Authority | B/C | [F13] |
| 873 | Private CRM Create Executor | B/C | [F13] |
| 877 | Generic INSERT Event Snapshot | B/C | [F13] |
| 902 | 2026-10-07 Physical and Regression Checkpoint | E | [STATUS], [F13] |
| 908 | Implemented F13C.2B Current Inbound Runtime | B/C | [F13] |
| 939 | 2026-10-12 F13C.2B Physical Acceptance Checkpoint | D/E | [STATUS], [F13] |
| 947 | Implemented Phone Identity Resolution and Automatic Existing-Record Linking | B/C | [F13] |
| 997 | Implemented Dynamic CRM Conversation Context | B/C | [CTX] |
| 1050 | Implemented Secure Manual CRM Linking Backend | B/C | [CTX] |
| 1117 | Implemented Visible Manual CRM Linking UI | B/C | [CTX] |
| 1178 | Implemented CRM Context Configuration Settings | B/C | [CTX] |
| 1208 | Implemented Conversation Work State | B/C | [WORK] |
| 1259 | Implemented Secure Outbound Upload Staging | B/C | [DELIVERY] |
| 1280 | Core File Upload Boundary | B/C | [DELIVERY] |
| 1288 | Implemented Message and Media Content Taxonomy | B/C | [DELIVERY] |
| 1298 | Durable Template Intent | B/C | [DELIVERY] |
| 1313 | Implemented Outbound State Machine | B/C | [DELIVERY] |
| 1328 | Implemented Provider Architecture | B/C | [DELIVERY] |
| 1342 | Implemented Twilio Inbound and Status Pipeline | B/C | [DELIVERY] |
| 1384 | Implemented Durable Outbound Dispatch | B/C | [DELIVERY] |
| 1409 | Implemented Security Foundation | B/C | [SEC] |
| 1411 | Public Record Access Facade | B/C | [SEC] |
| 1423 | Messaging Authorization | B/C | [AUTH] |
| 1442 | Permission Flags | B/C | [AUTH] |
| 1453 | Unassigned Conversations | B/C | [AUTH] |
| 1457 | Implemented Read API | B/C | [AUTH] |
| 1469 | Implemented Authorized Attachment Access | B/C | [DELIVERY] |
| 1489 | Implemented Human Send and Idempotency | B/C | [DELIVERY] |
| 1497 | Implemented WhatsApp Session Policy | B/C | [DELIVERY] |
| 1503 | Implemented Templates and Send Capabilities | B/C | [DELIVERY] |
| 1519 | Implemented Realtime Outbox and Subscription | B/C | [WORK] |
| 1538 | Implemented Dynamic CRM Conversation Context Panel | B/C | [CTX] |
| 1564 | Implemented Native Messaging Frontend | B/C | [WORK] |
| 1617 | Current Metadata GraphQL Surface | C/D/E | [AUTH] |
| 1662 | Messaging Instance Command Registration | C/F | [OPS] |
| 1685 | Validation Checkpoint | E | [STATUS], [OPS] |
| 1739 | Planned Boundaries | C/D/G | [BACKLOG], [STATUS] |
| 1759 | Local Development Runtime | A/B/E | [OPS] |
| 1763 | PostgreSQL Environment Precedence | A/B/E | [OPS] |
| 1779 | Historical Fase 12A Tooling Incident | A/B/E | [OPS] |
| 1783 | Product Backlog | G | [BACKLOG] |
| 1785 | REQ-TEL-001 — INCONNECT Telephony / Softphone | G | [BACKLOG] |
| 1803 | Local F13 Checkpoint (2026-09-29) | D/E | [STATUS], [SEC], [OPS] |
| 1809 | Local Apple Baseline | D/E | [STATUS], [SEC], [OPS] |
| 1838 | Local Git Checkpoint — 2026-10-15 | D/E | [STATUS], [SEC], [OPS] |
| 1849 | Repository Snapshot | D/E | [STATUS], [SEC], [OPS] |
| 1867 | INCONNECT Upstream Upgrade Procedure | A/B/F | [OPS] |
| 1921 | Working Rules | A/B | [ROOT], [OPS] |
| 1938 | Lead Management and Attention Adapter Rules | B/C/D | [ATT] |
| 1954 | Messaging Rules | B/C | [AUTH], [CTX], [WORK], [DELIVERY], [F13], [SEC], [OPS] |

## Revisión explícita de Working Rules y todas sus subsecciones

Cada fila identifica la regla original por línea e inicio textual. Las reglas
A/B permanecen obligatorias en ROOT/OPS; C se consolida en el contrato detallado
que ya especificaba su comportamiento. Se verificaron los calificadores y
prohibiciones, no sólo coincidencias de palabras. Sólo la fase pendiente de
1952 se supersede; su prohibición de inferir activación sigue intacta.

| Línea | Regla original (inicio) | Clase | Destino y evidencia |
| ---: | --- | --- | --- |
| 1923 | Work incrementally by explicitly authorized phase. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1924 | Before security-sensitive migrations, perform a read-only preflight and Entity-to-DDL audit. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1925 | Never run database:reset, setup/reset scripts, migrations, generators, or PostgreSQL writes without explicit authorizati… | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1926 | Do not modify local Roles, Workspace Members, Leads, Folios, Teams, memberships, or persisted policies without explicit au… | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1927 | Git is exclusively read-only for Codex under the rule at the top of this file; the user personally performs all Git writes… | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1928 | Preserve unrelated and pre-existing worktree changes. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1929 | Prefer focused tests plus relevant INCONNECT regressions over destructive suites. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1930 | In twenty-server, explicit process environment is authoritative over dotenv files; .env and .env.test are fallback o… | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1931 | Keep security predicates in SQL and fail closed at every unavailable/invalid authority boundary. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1932 | Do not broaden unsupported mutation/API paths or security scope silently. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1933 | Never hardcode demo workspace, user, Role, Object, Field, Lead, Folio, Team, or membership IDs in product code. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1934 | Report tests, typecheck/lint/format, git status --short, and git diff --stat at the end of implementation tasks. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1935 | If a requirement would change security architecture, schema, data, permissions, or authorized scope, stop and report the b… | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1936 | Never inspect or use Enterprise RLS as a shortcut. | A/B | [ROOT], [OPS] — Consolidada; prohibición/convención permanece explícita. |
| 1940 | Keep pure distribution evaluation separate from transactional execution. A preview/plan grants no owner-transfer authority… | B/C | [ATT], [MVP] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1941 | Distribution must not change Folio ISO or WhatsApp Conversations as a side effect. Distribution permissions grant no impli… | B/C | [ATT], [MVP] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1942 | Classify MESSAGE_PENDING only from authoritative shared attention linked by exact workspace/object/record identity. Never … | B/C | [ATT], [MVP] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1943 | Use the accepted C2 design for persistence details. Do not create a parallel Messaging pipeline, delivery service, permiss… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1944 | Never turn SQL errors, timeouts, incomplete reads, missing required dependents or corruption into authoritative absence/nu… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1945 | PostgreSQL is the future ledger authority. Redis, caches, realtime hints and BullMQ are never authoritative ledger reads o… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1946 | Serialize every attention-ledger writer on the common Conversation lock, including intent registration, IGNORED effects an… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1947 | Preserve canonical identities, fingerprints and each receipt/alias's own original result. IGNORED stays consumed; CONFLICT… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1948 | Keep response provenance, actor, Message, content, format and covered revision immutable across retries. Never infer HUMAN… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1949 | Reauthorize current human operations and realtime recipients through existing Messaging and Record Access authority. Authe… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1950 | Once an aggregate is prepared, fence legacy pendingAt writers as required by C2, including before ENABLED; after activatio… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1951 | Atomicity claims cover the PostgreSQL transaction only: causal Message changes, attention, intention, ledger, audit and Ou… | B/C | [ATT] — Conservada en guardrails; C2/R4 mantienen obligaciones de persistencia. |
| 1952 | Accepted designs, source tests and local commits never imply executed migrations, physical acceptance, deployment or activ… | B/D | [ATT], [STATUS] — Sólo pending I-A supersedido por commits; no inferir activación. |
| 1956 | Do not create parallel permission, owner, or Team systems for Messaging. | B/C | [AUTH], [SEC] — Autorización central y SQL; no bypass ni modelos paralelos. |
| 1957 | Human operations must go through InconnectMessagingAuthorizationService; do not add resolver/controller/repository short… | B/C | [AUTH], [SEC] — Autorización central y SQL; no bypass ni modelos paralelos. |
| 1958 | Consume Record Access only through InconnectRecordAccessAuthorizationService; Messaging must not consume raw policies, c… | B/C | [SEC], [AUTH] — Fachada pública; nunca raw políticas/Team/cache. |
| 1959 | Preserve fail-closed behavior and enforce list/count/search/pagination scope in backend SQL, never in memory or the frontend. | B/C | [AUTH], [SEC] — Autorización central y SQL; no bypass ni modelos paralelos. |
| 1960 | Favorite and Unread are personal to the authenticated Workspace Member; Pending is shared Conversation state. Never accept… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1961 | Unread uses server arrival order (Message.createdAt, Message.id) while display chronology independently uses effective/p… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1962 | Read cursor advancement is monotonic. Manual Unread sets manualUnread without rewinding the cursor, and Mark Read clears… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1963 | Historical inbound before workStateTrackingBaselineAt is read by default. New inbound derives unread from PostgreSQL wit… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1964 | Work-state predicates must execute with authorization and current-member identity in SQL before count, ordering, and pagin… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1965 | Work-state views must remain server-backed. The frontend must preserve active search and workState across pagination, re… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1966 | Automatic read may use only the server-derived readThroughMessageId for an inbound actually present in the authorized re… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1967 | Hidden tabs must not automatically mark new inbound read. Manual Mark Unread suppression is Conversation-scoped and epheme… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1968 | Fetching older Message pages must never replace an accumulated safe readThroughMessageId with null or an older target. S… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1969 | Shared Pending realtime may publish only the shared Conversation hint and must never include Workspace Member identity, Fa… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1970 | Personal Favorite/read state must never be broadcast through shared CONVERSATION_UPDATED; other tabs or devices converge… | B/C | [WORK] — Contrato backend/frontend conserva cursor, privacidad, filtros y realtime. |
| 1971 | Every Messaging Instance Command must be registered and discoverable by the normal upgrade runner; a command existing only… | A/C | [OPS] — Registro obligatorio, no basta archivo existente. |
| 1972 | Provider transport identity is not CRM canonical phone identity. Preserve externalAddressNormalized, waId, normalizeW… | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1973 | PhoneIdentityField and ContextField are separate configuration domains. PhoneIdentityField controls exact identity resolut… | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1974 | Human phone resolution must apply current standard object/Field permissions and INCONNECT Record Access. Background SYSTE… | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1975 | Inbound CRM orchestration must remain post-persistence and Outbox-driven. Durable WebhookReceipt, Conversation, Message, a… | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1976 | Automatic write authority requires a transaction-scoped workspace/anchor/canonical-phone advisory lock, Conversation FOR … | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1977 | The participating-worker advisory lock does not replace the unconditional physical PRIMARY-phone UNIQUE constraint. After … | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1978 | Every automatic link transition uses SYSTEM_PHONE_IDENTITY_RESOLUTION provenance, distinct from the technical Automation… | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1979 | Cross-DataSource Core QueryBuilders must use WorkspaceQueryRunnerCoreQueryBuilderService with the same active Workspace… | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1980 | Background matching grants no human access. All post-link human reads and realtime recipients must be reauthorized against… | B/C | [F13] — Identidad, locks, rol técnico, no relink, runner/manager y autorización actual. |
| 1981 | CRM context is derived from the Conversation's configured dynamic anchor; never hardcode Lead or another CRM object as con… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1982 | MessagingConfiguration is workspace-singleton by workspaceId; never invent a second configuration identity or persist … | B/C | [AUTH] — Singleton workspaceId y prohibición de messagingConfigurationId. |
| 1983 | ContextField stores only workspace/object/field/ordinal presentation configuration, never CRM values. Configuration is a p… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1984 | CRM context Settings navigation and direct-route management require MANAGE_INCONNECT_MESSAGING; ordinary Messaging, send… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1985 | CRM context Settings must consume only the management API for current fields, candidates, safe anchor summary, and maximu… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1986 | Context Settings editing uses server-confirmed ordered IDs plus an order-sensitive local draft. Add, Remove, and accessibl… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1987 | Context Settings Save performs one full-set replacement and sends only ordered FieldMetadata IDs. Never send workspace, ob… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1988 | After Settings Save, refetch the management configuration and adopt normalized server order before treating the draft as c… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1989 | Settings changes do not mutate the runtime panel or imply cross-page CRM/context realtime. Another open Messaging surface … | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1990 | Runtime context must apply current Twenty object permission, current field permission, and INCONNECT Record Access. The fi… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1991 | Runtime context clients supply only conversationId. Object, record, schema, table, and selected columns must derive serv… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1992 | Canonical recordLabel uses only readable labelIdentifierFieldMetadataId; never fall back to an arbitrary field or reco… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1993 | Manual CRM candidate search and linking require INCONNECT_MESSAGING plus TRIAGE_INCONNECT_MESSAGING; SEND and MANAGE n… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1994 | Candidate search is Conversation-scoped and valid only for a currently authorized UNASSIGNED Conversation. Never expose … | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1995 | Candidate and target objects always derive from the current MessagingConfiguration.anchorObjectMetadataId plus live meta… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1996 | Candidate search uses only a currently readable canonical TEXT label Field. Never silently search generic searchVector… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1997 | Candidate display values may include only readable configured ContextFields normalized through the existing safe context m… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1998 | Candidate authorization and Record Access predicates must remain in the final SQL before count, cursor, ordering, and pagi… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 1999 | Dynamic physical-table QueryBuilders must not use TypeORM getCount(). Clone the already-authorized QueryBuilder, select … | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2000 | A candidate result grants no capability. Reauthorize the exact record ID under current standard object permission and INCO… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2001 | Lock the Conversation FOR UPDATE before changing its linked tuple, reread and reevaluate after the lock, and never permi… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2002 | Same-target retry is idempotent and emits no duplicate transition. A different-target request never overwrites; unlink and… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2003 | Linking updates only the complete Conversation linked tuple plus operational Outbox. It must never modify target CRM owner… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2004 | Every real link transition persists exactly one CONVERSATION_LINKED Outbox event in its transaction. Publication occurs … | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2005 | Linking must not mutate Favorite, Unread, manualUnread, read cursor, Pending, lastInboundAt, WhatsApp session, or prov… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2006 | Manual linking UI may appear only for an authorized selected UNASSIGNED Conversation; the backend remains authorization … | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2007 | Opening linking mode performs no candidate query. Search requires explicit human form submission and must never derive fro… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2008 | Candidate data is authorization-sensitive network-only data. Bind results and paging to Conversation plus submitted-sear… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2009 | Candidate UI renders only backend recordLabel plus normalized ordered fields[]. Never display recordId as fallback i… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2010 | Candidate selection is single-choice and never mutates. Confirmation is mandatory, and the Link mutation sends only conve… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2011 | Never fabricate optimistic LINKED state or promote candidate values into runtime context. A successful local Link explic… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2012 | Ordinary CONVERSATION_UPDATED is not global CRM-context invalidation. Do not turn Pending, Favorite, or general Conversa… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2013 | Late search, fetchMore, or Link completion from Conversation A must not alter Conversation B. Switching Conversation imm… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2014 | Stale/inaccessible targets remain non-disclosing. An already-linked conflict revalidates list/detail/context without overw… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2015 | Linking state is local, Conversation-scoped, and non-durable; never persist it in Jotai authority, localStorage, or ses… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2016 | Linking UI must preserve Favorite, Unread, read cursor, Pending, automatic-read behavior, and same-Conversation composer/d… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2017 | Desktop linking uses the existing CRM third pane and narrow/mobile linking uses the existing fullscreen Context modal. Nev… | B/C | [CTX] — Contrato context/Settings/linking conserva SQL, DTO, lifecycle, confirmación y privacidad. |
| 2018 | Exact configured-phone matching, existing-UNIQUE linking, and conditional enabled/ready NO_MATCH create/link are imple… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2019 | The F13C Automation WorkspaceMember is a real technical principal using normal Twenty user authorization. It is distinct f… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2020 | AUTHORIZED CREATE does not imply CRM READ. The automation Role may create with canReadObjectRecords = false; ordinary CR… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2021 | F13C deliberate business input is exactly the current PRIMARY PHONES Field plus the metadata-derived Owner relation in c… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2022 | Canonical position is minimum normal system-required Create authority and is not part of the Messaging deliberate Field … | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2023 | The private F13C executor requires and revalidates its transaction-bound plan, starts no transaction, performs no link act… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2024 | CRM row, complete same-INSERT CREATED / UPSERTED event snapshots, Conversation linked tuple, and CONVERSATION_LINKED… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2025 | Principal, permission, Role, RoleTarget, Record Access, canonical position, PRIMARY, anchor, Owner, and physical-schema dr… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2026 | Workspace INSERT events must build their complete normalized CREATED and UPSERTED snapshots from internal rows returne… | B/C | [F13] — Contrato F13/INSERT conserva alcance exacto, no READ y atomicidad. |
| 2027 | RELATION and MORPH_RELATION remain unsupported until a generic resolver can preserve target-object standard permission… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2028 | The runtime inconnectMessagingConversationContext query for an UNASSIGNED Conversation performs no candidate search, m… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2029 | Context values are live read-only CRM reads. Never duplicate/cache record values or durable actor-specific readable fields… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2030 | The visible CRM context frontend must consume only inconnectMessagingConversationContext(conversationId) and supply only… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2031 | Query visible CRM context only for the selected Conversation. Never query per list row or configured Field, bulk-prefetch … | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2032 | Keep context rendering generic. Never branch on Lead, another object identity, a Field API name, or product-specific label… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2033 | A Conversation switch must synchronously clear the prior context. Bind results to the requested Conversation identity, and… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2034 | Context uses network-only and nextFetchPolicy: network-only; do not render Apollo previousData or any stale authoriz… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2035 | Treat UNASSIGNED as a neutral runtime-context result. The runtime inconnectMessagingConversationContext query must nev… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2036 | Render backend displayValue in server-returned Field order. Do not recreate CRM value normalization, alphabetize configu… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2037 | Messaging Message/Conversation realtime hints are not CRM-record invalidation. Do not add CRM polling or subscriptions; re… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2038 | Keep context tied to the selected authorized detail even when its row leaves a work-state/search result. Losing authorizat… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2039 | Opening, loading, or closing context must not mutate work state, auto-read behavior, draft, template, upload/attachment st… | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2040 | The runtime context panel is read-only. CRM writes and context-configuration Settings controls do not belong to it. | B/C | [CTX] — Contrato context conserva tipos, sólo lectura, identidad A/B y autoridad backend. |
| 2041 | Never hardcode Lead, schema, physical table, owner field, workspace, ObjectMetadata, Role, or Workspace Member identifiers. | B | [ROOT], [AUTH] — Identidad dinámica, sin hardcodes. |
| 2042 | Keep the domain provider-neutral and do not couple it to Twilio. | B/C | [AUTH] — Dominio neutral, PostgreSQL autoridad, no reutilizar email. |
| 2043 | PostgreSQL is operational authority. BullMQ may provide at-least-once transport but is never authority. | B/C | [AUTH] — Dominio neutral, PostgreSQL autoridad, no reutilizar email. |
| 2044 | Do not reuse email modules/messaging as the WhatsApp domain. | B/C | [AUTH] — Dominio neutral, PostgreSQL autoridad, no reutilizar email. |
| 2045 | Human send must always use InconnectMessagingAuthorizationService; never trust frontend session-window state or send cap… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2046 | Outbound staging is actor/workspace scoped and never substitutes for current Conversation authorization; reauthorize the C… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2047 | Public clients never choose server-owned FileEntity IDs. | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2048 | Keep core FileUploadService feature-neutral; INCONNECT owns its upload folder, logical type, MIME, size, actor authoriza… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2049 | Keep shared frontend upload transport feature-neutral; uploadFileToUrl must use only the exact backend capability and ca… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2050 | Never expose or accept a Twilio Content SID as frontend template identity; provider references remain server-side. | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2051 | clientUploadId identifies one selected-file upload intention: preserve it for retries of that intention and replace it f… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2052 | clientRequestId identifies one Message-send intention: preserve it for uncertain retries of the same send and replace it… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2053 | Stale asynchronous upload results must never mutate a newer upload intention or a different Conversation. Conversation swi… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2054 | Frontend media accept, size, and caption hints derive from safe server capabilities. Upload completion, send, session, MIM… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2055 | Send capabilities must use local provider capabilities and must never call the remote template catalog. canSendTemplate … | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2056 | Keep template mode and free-form outbound media separate until media templates receive an explicit design. | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2057 | Do not blindly retry ambiguous provider outcomes, including media submits; preserve UNKNOWN semantics and the conservati… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2058 | Template history must not depend on the current provider catalog. | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2059 | Do not create a parallel outbound pipeline for templates; free-form and templates converge on durable Message and Dispa… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2060 | Keep Messaging realtime member-scoped; reauthorize each recipient against current Conversation access before publishing a … | B/C | [WORK] — Recipient actual reautorizado; sólo hint member-scoped. |
| 2061 | A provider media URL is never a frontend or product download URL. Never expose it, and never fetch an arbitrary client-sup… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2062 | Inbound media must become durable through Twenty FileEntity/FileStorage; do not create a parallel Messaging storage syst… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2063 | Outbound media must converge on the existing durable Message + Attachment + DispatchAttempt pipeline; Attachment AV… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2064 | Do not authorize files from only workspaceId + fileId or workspaceId + attachmentId; always reauthorize the owning Con… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2065 | Keep Attachment creation, ingestion, and recovery idempotent and PostgreSQL-authoritative; BullMQ deduplication is not the… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2066 | Preserve LOCATION as structured content rather than an Attachment, and preserve normal Unicode/emoji as TEXT rather th… | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |
| 2067 | Legacy media metadata without an Attachment remains valid unless an explicit historical backfill is separately authorized. | B/C | [DELIVERY] — Contrato delivery conserva autoridad, seguridad media, idempotencia y pipelines existentes. |

Cobertura final: **139 reglas** identificadas, incluidas las de la línea final 2067; ninguna fila sin destino.

## Evidencia y límites de aceptación

MVP: se leyó el cierre independiente local, su veredicto e integridad sin ejecutar
ni reabrir la auditoría. Se compararon los 42 hashes de su inventario preflight
con el contenido del commit f164bf937a, sin diferencias; el reporte histórico
habla de 41 fuentes comprobadas en aquel cierre, no de este nuevo cotejo.
El estado canónico conserva el veredicto aun si desaparece el cache ignorado.
R4: commit 0c5936907b declara aceptación SOURCE-ONLY; su informe temporal de
auditoría no estaba disponible. Se atribuye la aceptación al checkpoint Git,
no a una reproducción independiente nueva. Esto no levanta ningún gate físico.

La revisión de conservación acredita correspondencia documental, no pruebas de
PostgreSQL, permisos instalados, drivers/locks reales ni topología de despliegue.
Configuración interna administrada y disponibilidad por entorno siguen sin
verificación directa. Consultar STATUS antes de inferir disponibilidad.

## Validaciones de esta modernización

El registro documental final, tamaños, inventario y resultados de comprobaciones
se incluyen abajo al cierre. Sólo se permiten archivos Markdown del proyecto.
No tests de producto, builds, codegen, DB, infraestructura ni Git writes.

[ROOT]: ../../../AGENTS.md
[STATUS]: INCONNECT_PROJECT_STATUS.md
[SEC]: INCONNECT_SECURITY_CONTRACT.md
[F13]: INCONNECT_F13_AND_ORM_CONTRACT.md
[AUTH]: INCONNECT_MESSAGING_AUTHORITY_CONTRACT.md
[CTX]: INCONNECT_MESSAGING_CRM_CONTEXT_CONTRACT.md
[WORK]: INCONNECT_MESSAGING_WORK_STATE_CONTRACT.md
[DELIVERY]: INCONNECT_MESSAGING_DELIVERY_CONTRACT.md
[OPS]: INCONNECT_OPERATIONS_AND_UPGRADES.md
[BACKLOG]: INCONNECT_PRODUCT_BACKLOG.md
[ATT]: INCONNECT_ATTENTION_GUARDRAILS.md
[MVP]: INCONNECT_LEAD_MANAGEMENT_INTEGRATED_MVP.md

## Registro final de validaciones — 2026-10-27

| Comprobación | Resultado y alcance |
| --- | --- |
| Preflight Git y checkpoint | PASS; rama/HEAD preservados, staging vacío; sólo lectura. |
| Recuperación original | PASS; git show del commit histórico conserva 248,493 bytes y el SHA-256 indicado. |
| Presupuesto raíz | PASS; 12,284 bytes (54 líneas), dentro de 12 KiB y de los 32 KiB predeterminados inferidos. |
| Presupuesto combinado existente | PASS; raíz + mayor AGENTS anidado + separador = 18,601 bytes; no se crearon AGENTS anidados. |
| Referencias locales | PASS; 148 destinos de enlaces inline/referencia existentes, resueltos desde el documento emisor. Sin fragmentos de anchor añadidos. |
| Conservación técnica literal | PASS; 30 bloques originales trasladados verificados por contenido completo, admitiendo sólo encabezados/enlaces/avisos documentados. |
| Working Rules | PASS; 139 reglas con destino y justificación, incluida la línea 2067. |
| Inventario de encabezados | PASS; 112 encabezados fuera de ejemplos fenced clasificados. |
| Documentos especializados existentes | PASS; 13 cuerpos originales idénticos al commit; únicamente aviso inicial de reconciliación añadido. |
| Aceptación MVP / checkpoint | PASS; cotejo read-only de 42 hashes de inventario contra el commit, sin divergencias; no reauditoría. |
| Consistencia de estado | Revisada: MVP/R4 SOURCE-ONLY; sin instalación/activación; I-A superada como fase siguiente; backlog y gates intactos. |
| Alcance de cambios | PASS; 25 Markdown propios: 14 modificados y 11 nuevos; sin producto/tests/config/SQL. |
| Whitespace tracked | git diff --check: exit 0. |
| Whitespace untracked | 11 git diff --no-index --check frente a /dev/null: sin diagnósticos; exit 1 indica archivo nuevo/diferente, no error de whitespace. |
| Revisión de diff completo | Raíz y añadidos revisados; todos los bloques trasladados cotejados, todos los avisos revisados y los cuerpos previos comprobados sin cambios. git diff --stat no incluye untracked; inventario siguiente sí. |
| Infraestructura / producto | No se ejecutaron tests de producto, builds, codegen, PostgreSQL, Redis, servidores, workers, DDL, migraciones, setup/reset ni proveedor. |

Las comprobaciones se ejecutaron secuencialmente en Python y Git read-only,
con salida/resultado de cierre conservados en este registro. Herramientas locales
temporales de esta sesión: `/tmp/validate-inconnect-docs.py` y
`/tmp/inconnect-documentary-validation-results.json`; no son contratos ni
requisitos del próximo chat. El chequeo inicial de untracked detectó una línea
vacía extra al final de OPS: se corrigió y el conjunto final pasó. No se atribuye
PASS a los intentos previos incompletos. No se reinició el entorno ni se relanzó producto.

### Comparación de tamaño e inventario

Raíz: **248,493 → 12,284 bytes**, reducción **95.06%**; **2,067 → 54 líneas**.
Las líneas de la raíz son párrafos/tablas, no una medida del presupuesto: cuenta
el tamaño UTF-8. Los nueve contratos/guardrails adicionales dividen áreas reales;
ninguno replica un monolito de 248 KB. La matriz es un inventario auditable,
no una segunda fuente de implementación técnica.

### Documentos nuevos

- `packages/twenty-server/docs/INCONNECT_ATTENTION_GUARDRAILS.md` — 8,084 bytes.
- `packages/twenty-server/docs/INCONNECT_DOCUMENTATION_PRESERVATION.md` — esta matriz e inventario; su tamaño cambia al registrar el cierre.
- `packages/twenty-server/docs/INCONNECT_F13_AND_ORM_CONTRACT.md` — 24,047 bytes.
- `packages/twenty-server/docs/INCONNECT_MESSAGING_AUTHORITY_CONTRACT.md` — 20,010 bytes.
- `packages/twenty-server/docs/INCONNECT_MESSAGING_CRM_CONTEXT_CONTRACT.md` — 39,142 bytes.
- `packages/twenty-server/docs/INCONNECT_MESSAGING_DELIVERY_CONTRACT.md` — 31,339 bytes.
- `packages/twenty-server/docs/INCONNECT_MESSAGING_WORK_STATE_CONTRACT.md` — 20,697 bytes.
- `packages/twenty-server/docs/INCONNECT_OPERATIONS_AND_UPGRADES.md` — 29,091 bytes.
- `packages/twenty-server/docs/INCONNECT_PRODUCT_BACKLOG.md` — 8,040 bytes.
- `packages/twenty-server/docs/INCONNECT_PROJECT_STATUS.md` — 12,107 bytes.
- `packages/twenty-server/docs/INCONNECT_SECURITY_CONTRACT.md` — 17,031 bytes.

### Documentos modificados

- `AGENTS.md` — 12,284 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_DESIGN.md` — 75,848 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_II.md` — 22,812 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_A.md` — 30,973 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1.md` — 28,565 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R1.md` — 43,581 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R2.md` — 35,847 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R3.md` — 27,122 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R4.md` — 79,160 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_I_A.md` — 26,144 bytes.
- `packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_I_B.md` — 46,741 bytes.
- `packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_INTEGRATED_MVP.md` — 67,005 bytes.
- `packages/twenty-server/src/modules/inconnect-messaging/attention-adapter/README.md` — 21,927 bytes.
- `packages/twenty-server/src/modules/inconnect-messaging/attention-domain/README.md` — 15,325 bytes.

### Git status --short al cierre documental

```text
 M AGENTS.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_DESIGN.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_II.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_A.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R1.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R2.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R3.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_III_B1_R4.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_I_A.md
 M packages/twenty-server/docs/INCONNECT_ATTENTION_ADAPTER_C2_I_B.md
 M packages/twenty-server/docs/INCONNECT_LEAD_MANAGEMENT_INTEGRATED_MVP.md
 M packages/twenty-server/src/modules/inconnect-messaging/attention-adapter/README.md
 M packages/twenty-server/src/modules/inconnect-messaging/attention-domain/README.md
?? packages/twenty-server/docs/INCONNECT_ATTENTION_GUARDRAILS.md
?? packages/twenty-server/docs/INCONNECT_DOCUMENTATION_PRESERVATION.md
?? packages/twenty-server/docs/INCONNECT_F13_AND_ORM_CONTRACT.md
?? packages/twenty-server/docs/INCONNECT_MESSAGING_AUTHORITY_CONTRACT.md
?? packages/twenty-server/docs/INCONNECT_MESSAGING_CRM_CONTEXT_CONTRACT.md
?? packages/twenty-server/docs/INCONNECT_MESSAGING_DELIVERY_CONTRACT.md
?? packages/twenty-server/docs/INCONNECT_MESSAGING_WORK_STATE_CONTRACT.md
?? packages/twenty-server/docs/INCONNECT_OPERATIONS_AND_UPGRADES.md
?? packages/twenty-server/docs/INCONNECT_PRODUCT_BACKLOG.md
?? packages/twenty-server/docs/INCONNECT_PROJECT_STATUS.md
?? packages/twenty-server/docs/INCONNECT_SECURITY_CONTRACT.md
```

### Riesgos y reglas sin representación

No se identificó una prohibición crítica del original sin destino vigente.
Las incertidumbres que permanecen se declaran, no se convierten en capacidades:
configuración efectiva interna de Codex no expuesta; disponibilidad física por
entorno no inspeccionada; informe temporal independiente R4 no disponible en
/tmp (aceptación atribuida al commit explícito); caches de auditoría MVP locales
ignorados y no garantizados en otros clones. Estos límites están reflejados en
STATUS y no autorizan inspección física, activación ni una nueva fase.

El usuario mantiene todos los Git writes. No se hizo commit ni staging.
