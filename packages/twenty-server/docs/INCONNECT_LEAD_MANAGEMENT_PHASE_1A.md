# INCONNECT Lead Management — Fase 1A

Este documento conserva la evidencia histórica de 1A. La remediación 1A-R y
sus límites de publicación vigentes se documentan en
[INCONNECT_LEAD_MANAGEMENT_PHASE_1A_REMEDIATION.md](./INCONNECT_LEAD_MANAGEMENT_PHASE_1A_REMEDIATION.md).
Ese informe prevalece sobre las limitaciones de UUID, proyección y publicación
indicadas aquí. No inicia ni recomienda ejecutar 1B en este trabajo.

Fecha: 2026-10-16. Rama inspeccionada: `feature/inconnect-lead-management`.
Preparación y validación exclusivamente de código. No habilita despliegues ni
pruebas físicas. PG0, PG1 y exact-upgrade permanecen bloqueados.

## 1. Defectos reproducidos antes de corregir

La primera ejecución del arnés operativo, una vez completados sus dobles de
infraestructura, produjo **5 fallos y 1 pase** sobre el código original:

| Regresión | Comportamiento original observado en Jest |
| --- | --- |
| Owner anterior distinto al nuevo, filtro por Owner anterior y pérdida de alcance del actor | UPDATE devuelve una fila, pero el SELECT posterior no la encuentra; no se publican UPDATED/UPSERTED. |
| Materialización antes de comprobar el máximo | El selector no tiene `take`; el rechazo llega después de cargar todo el resultado simulado. |
| Restricción a las identidades de los snapshots previos | El SQL de UPDATE conserva el filtro original, pero no contiene los IDs capturados; puede admitir coincidencias posteriores. La carrera real no se ejecutó. |
| Máximo en `executeMany` | Se ejecutaron 201 mutaciones simuladas sin rechazo; el máximo común es 200. |
| Identidades duplicadas en `executeMany` | Dos entradas para el mismo ID ejecutaron dos UPDATE. No existía una semántica explícita para evitar escrituras repetidas. |

La duplicación confirmada fue de **mutaciones**, no una demostración de eventos
publicados dos veces. La corrección rechaza estos inputs con `INVALID_INPUT`;
es un endurecimiento explícito del contrato de `executeMany`, cubierto por tests.

El caso sin filas afectadas ya pasaba en el escenario inicial. No se presenta
como un defecto adicional descubierto.

## 2. Cambios por archivo

Rutas relativas a `packages/twenty-server/`:

- `src/engine/twenty-orm/repository/workspace-update-query-builder.ts`:
  limita la lectura previa a 201 entidades para detectar el exceso; restringe
  UPDATE a los IDs capturados, además del filtro original agrupado y los
  predicados de autorización; comprueba el máximo en ambas rutas; rechaza
  IDs duplicados y omite entradas sin snapshot autorizado en `executeMany`.
  Sustituye el SELECT posterior por columnas privadas del mismo RETURNING.
  Conserva la validación estándar de objeto/campos, Record Access y Owner
  Integrity, y los hooks comunes existentes.
- `src/engine/twenty-orm/utils/execute-update-with-event-snapshots.util.ts`:
  construye columnas privadas mediante metadatos y escape de identificadores;
  hidrata valores con el driver y `ColumnMetadata`; comprueba correspondencia
  de IDs, ausencia de duplicados, presencia de columnas y conteo de afectados.
  Separa snapshots internos del `raw` del llamador. El builder aplica el
  formateo lógico habitual, incluidos campos compuestos y relaciones.
- `src/engine/twenty-orm/repository/__tests__/workspace-update-query-builder.events.spec.ts`:
  34 regresiones sobre transferencias, eventos, permisos, alcance SQL, límites,
  resultados parciales, errores y rollback simulado. Incluye un caso que ejecuta
  el pipeline nativo de TypeORM con sólo su transporte SQL sustituido.
- `src/engine/twenty-orm/utils/__tests__/execute-update-with-event-snapshots.util.spec.ts`:
  4 pruebas de nombres físicos, hidratación, fechas, precisión numérica, JSON,
  colisiones de alias y ausencia de RETURNING del llamador.
- `src/engine/api/common/common-query-runners/__tests__/common-update-many-query-runner.internal-write-provenance.spec.ts`:
  amplía el test existente a 2 casos; comprueba filtro original, procedencia de
  campos internos, una sola ejecución y devolución de `generatedMaps` sin refetch.
- Este documento registra resultados, límites y trabajo posterior.

`CommonUpdateManyQueryRunnerService.run` ya consume `generatedMaps` del UPDATE.
No se confirmó un defecto propio que justificara modificar su implementación.
Su carga opcional de relaciones continúa en el pipeline común autorizado.

El RETURNING original no se reemplaza por `*`: el builder añade columnas privadas
al SQL producido por TypeORM, incluidas sus columnas adicionales normales.
Los aliases internos se retiran del resultado público. Se conservan proyección
estrecha, `*`, expresión SQL con alias y proyección vacía. No se añade bypass ni
SELECT posterior, y no se concede una capacidad general de lectura.

Se mantiene un lote UPDATED y otro UPSERTED conforme al contrato existente;
son acciones distintas. Cada lote contiene una sola entrada por ID realmente
actualizado. El diff de Owner conserva los IDs anterior/nuevo y los nombres
lógicos `owner`/`ownerId` del fixture; producción deriva nombres de metadatos.

## 3. Validación ejecutada

Todos los tests son focales y sin conexión DB. `DataSource` sólo construye
metadatos en memoria; nunca se llama `initialize`. Los hooks Enterprise se
simulan como fronteras inertes en el nuevo arnés; no se usan para implementar
INCONNECT ni se modifica su código.

- Jest: **10 suites / 119 tests PASS**. Incluye las suites nuevas y las existentes
  de permisos estándar, procedencia interna, valores de escritura INCONNECT,
  predicados SQL de mutación, alcance SELECT INCONNECT, formato de eventos y
  buffer transaccional de eventos.
- Typecheck configurado del servidor: `tsgo -p tsconfig.json --noEmit`: **PASS**.
- Lint de rama: `nx run twenty-server:lint:diff-with-main`: **PASS**, sin dependencias de
  tareas y sin daemon. Esta tarea compara `main...HEAD`, por lo que se complementa
  con typed lint explícito de los cinco archivos TypeScript afectados: **PASS, 0 errores y 0 warnings**.
- `oxfmt --check` explícito de los cinco archivos TypeScript afectados: **PASS**.
- `git diff --check`: **PASS**; también se comprobó whitespace de los cuatro archivos nuevos mediante `git diff --no-index --check`.

Los resultados finales de typecheck, lint y formato se registran también en la
respuesta de entrega. Las pruebas de buffer comprueban publicación tras commit
simulado y descarte tras rollback; no demuestran rollback físico de filas.

## 4. Sospechas y límites pendientes

- **Concurrencia y snapshot before:** no se reprodujo una carrera PostgreSQL.
  El SELECT previo no adquiere locks. Otro escritor puede cambiar una fila
  capturada antes del UPDATE; el `before` puede quedar obsoleto. La restricción
  de IDs evita nuevas coincidencias fuera del lote, pero no resuelve esa carrera.
- **Autorización concurrente:** el alcance de Owner permanece en el mismo SQL
  de mutación. Cambios simultáneos de política, Teams o membresía requieren
  validación física específica; no se añadieron locks o políticas nuevas.
- **Transacción:** `executeMany` no adquiere atomicidad automáticamente. Si una
  sentencia posterior falla, la reversión de las anteriores depende de una
  transacción activa y del rollback de su propietario. También un error de
  formateo o de archivos posterior a una escritura requiere esa transacción.
- **Eventos:** las pruebas comprueban una emisión por acción/ID en memoria y
  el buffer existente. No existe aquí una nueva outbox ni garantía de entrega
  exactamente una vez ante caída de proceso, retry o fallo de un consumidor.
- **RETURNING:** se obtiene el estado de la misma sentencia. Cambios posteriores
  por otras sentencias, callbacks o triggers que escriban de nuevo quedan fuera
  de ese snapshot. Los tipos físicos y triggers reales no fueron inspeccionados.
- **Coste:** se acota el número de entidades y de IDs mutados. No se garantiza
  un máximo de bytes por fila ni un coste SQL constante en filtros con JOIN.
  La presencia de JOIN y `take` puede generar más de una consulta de lectura.
- **Eventos de UPDATE sin cambio lógico:** se conserva el comportamiento actual
  del formateador; UPDATED puede omitirse sin diff, mientras UPSERTED sigue su
  contrato. No se cambia globalmente esa semántica en esta fase.

## 5. Lead, Folio ISO y Messaging

No se añade ninguna sincronización entre Owner de Lead y Owner de Folio ISO.
El cambio actúa sólo sobre el target del builder común; no modifica objetos,
Roles, Teams, políticas persistidas, entidades ni migraciones.

La inspección de la autorización de Messaging muestra dependencia de la lectura
actual del registro CRM enlazado. Una transferencia puede revocar acceso al
anterior Owner y otorgarlo a otro actor según su política. Se mantienen intactos
el vínculo CRM, estados de Conversation y permisos de Messaging.

Pendiente para otra fase: refresco del inbox/contexto ya abierto, convergencia
entre pestañas y dispositivos, destinatarios realtime tras transferencia y
consumidores genéricos de UPDATED/UPSERTED (automatizaciones, auditoría u otros).
Restaurar eventos antes perdidos puede activar consumidores existentes. No se
implementa realtime CRM ni eventos artificiales de Conversation en esta fase.

## 6. Validación física posterior — requiere autorización específica

En un target desechable con aislamiento previamente aceptado:

1. Ejecutar UPDATE filtrado por Owner anterior; comprobar propietario persistido,
   `affected`, proyección pública y snapshots normalizados, también cuando el
   actor pierde acceso al registro después de transferirlo.
2. Con dos conexiones coordinadas, cambiar Owner/datos entre SELECT y UPDATE;
   comprobar exclusiones por predicado, nuevas coincidencias fuera del lote y
   exactitud temporal del `before`. Resolver el contrato de locks/versionado
   antes de prometer auditoría exacta bajo concurrencia.
3. Validar 0, 200 y 201 coincidencias, planes/coste SQL y filtros con relaciones.
4. Probar commit, rollback y fallo intermedio de `executeMany` en el mismo runner;
   comprobar filas y eventos, errores posteriores al SQL y caída de proceso.
5. Validar RETURNING contra tipos reales, campos compuestos, defaults,
   columnas generadas y triggers existentes; comprobar permisos estándar,
   Record Access y Owner Integrity sin lecturas ni escrituras privilegiadas.
6. Comprobar aislamiento de Lead/Folio y visibilidad de conversaciones/contexto
   para anterior y nuevo Owner, sin alterar vínculos de Messaging.

Ninguna de estas acciones fue ejecutada. Este documento no autoriza PG0, PG1,
exact-upgrade, provisión, migraciones, workers o pruebas físicas.

## 7. Estado Git y recomendación Fase 1B

Preflight: rama correcta y worktree limpio. Resultado de esta fase: dos archivos
versionados modificados y cuatro archivos nuevos, todos sin staging. `git diff`
omite los archivos nuevos hasta que el usuario decida incorporarlos; se deben
revisar también desde `git status --short`.

No se ejecutaron add, commit, push ni otras operaciones Git que modifican estado.

Recomendar Fase 1B sólo después de revisar este resultado: definir primero el
contrato del lote (máximo, IDs únicos, selección estable, destinos autorizados,
atomicidad, resultados parciales, reintentos y auditoría concurrente). Reutilizar
el UPDATE común para asignación manual y distribución equitativa entre ejecutivos
seleccionados, con chunks explícitos cuando corresponda. La distribución
inteligente permanece fuera del MVP. No se inició Fase 1B.
