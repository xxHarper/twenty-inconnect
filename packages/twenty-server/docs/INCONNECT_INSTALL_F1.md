# INSTALL-F1 — preparación SOURCE-ONLY

Base revisada el 5 de noviembre de 2026. Rama
`feature/inconnect-lead-management`, HEAD `1cbc6c3222683ef6e94f113378d9b617709bb01c`.
El MVP de Lead Management conserva su aceptación SOURCE-ONLY. Las pruebas de
esta fase sustituyen el transporte PostgreSQL en memoria.

## Bootstrap Core

Con TypeORM 0.3.31, `MigrationExecutor.executePendingMigrations()` pide al
constructor de esquema que cree la tabla de metadata antes de leer el historial
y antes de abrir la transacción de la primera migración. La columna
`normalizedName` de Commercial Team tiene `generatedType: 'STORED'` y hace que
el constructor intente crear `core._typeorm_generated_columns_and_materialized_views`.
`SetupMetadataTables1700140427984` emite después un `CREATE TABLE` incondicional
para la misma relación. La prueba pura reproduce la secuencia con el ejecutor
real de TypeORM y la migración histórica. El SQLSTATE 42P07 sigue sin verificación
física en INSTALL-F1.

`run-instance-commands` usa ahora un DataSource temporal sin entidades para su
tramo histórico. Conserva el destino y esquema de Core, las mismas migraciones
configuradas (incluida la selección de billing), ambos nombres de tablas de
TypeORM y una transacción por migración. La revisión de las migraciones
congeladas encontró únicamente llamadas a `queryRunner.query`. El DataSource
temporal utiliza un pool de una conexión, se cierra al salir y deshabilita
instalación automática de extensiones, sincronización, borrado y migración al
inicializarse. El tramo Fast/Slow sigue usando el runner normal.

Una instalación ya registrada conserva su historial. Si la relación existe y
la migración histórica sigue pendiente, el conflicto se propaga y exige una
reconciliación específica. La fase cubre la causa localizada del bootstrap
limpio, con aceptación PostgreSQL y de la cadena completa aún pendientes. Al
integrar upstream, repetir la regresión contra su versión de TypeORM y verificar
que las migraciones congeladas sigan siendo SQL directo.

## Store del distribuidor — propuesta inerte

La [propuesta SQL](../src/modules/inconnect-lead-management/sql/lead-pool-operation.proposed.sql)
sigue siendo la referencia de estructura. El Store exige una tabla ordinaria
con nueve columnas, PK UUID, FKs restrictivas a `core.workspace` y `core.user`,
checks del hash y del estado JSON, timestamps con `now()` y unicidad inmediata de
`(workspaceId, actorUserId, intentionId)`. El índice auxiliar por workspace,
actor y fecha forma parte del DDL y requiere verificación explícita al adoptar
una tabla existente. La comprobación `ready()` valida las restricciones y sus
índices únicos, pero no ese índice auxiliar. El miembro histórico se conserva
como dato de la operación y se exige junto con el workspace y el usuario en el
acceso a la fila. La unicidad de la intención excluye al miembro para que un
cambio de membresía no abra una segunda operación con la misma identidad.

**Bloqueo de registro.** El registro oficial carga `INSTANCE_COMMANDS` y
alimenta la secuencia por versión y tipo. En este checkout
`database:init:prod` llama a `run-instance-commands --force --include-slow` y
recorre los Fast/Slow pendientes. El entrypoint de la imagen, con migraciones
habilitadas, llama a esa inicialización si falta el esquema Core y después a
`upgrade`. En una base nueva la ruta agregada incluye los comandos F13
`1790793305698` / `1790793305700`, Attention `1792540800000` y otros comandos
ajenos al Store. El selector exacto admite sólo los dos comandos F13 y su
ejecución operativa está bloqueada. Un comando de versión futura pasaría a la
misma secuencia agregada cuando se publique esa versión. Falta una vía
oficialmente admitida para instalar sólo el Store bajo los gates vigentes.

La futura integración debe ejecutar el DDL y registrar la finalización en la
misma transacción del runner autorizado. Si la tabla existe, sólo se debe adoptar
tras verificar su contrato físico, incluyendo el índice auxiliar, y la
compatibilidad de los estados ya persistidos. Una divergencia bloquea el
comando. La existencia por nombre o un `IF NOT EXISTS` por sí solos no
acreditan compatibilidad. Reintentar después de un fallo exige verificar
tracking y estado físico. Los resultados, auditoría e identidades de intención
se conservan durante todo el periodo de replay, incluso tras vencer el preview.

Para el downgrade se propone que el futuro `down` rechace la reversión de
esquema sin emitir SQL. El comentario histórico de `DROP TABLE` en el borrador
describe una pérdida de datos y queda excluido de esta propuesta. Un rollback
de binario conserva tabla, índice, historial y tracking. Antes de autorizarlo
hay que revisar el lector de estados de la versión de destino y su cursor de
upgrades. No se aprueba purga, borrado de workspace ni restauración destructiva.

## Siguiente fase de preparación

Redactar un Compose de staging a partir del Compose y Dockerfile de este
checkout. Fijar la imagen del fork por SHA o digest para server y worker,
PostgreSQL y Redis con versiones revisadas, red privada, volúmenes y secretos
propios. Dejar server y worker fuera del arranque por defecto mientras se
revisa el paso de inicialización separado, con
`DISABLE_DB_MIGRATIONS=true` y `DISABLE_CRON_JOBS_REGISTRATION=true` en ambos.
Revisar explícitamente el inventario de comandos autorizados y los criterios de
éxito antes de habilitar el arranque. La mera presencia del esquema `core` no
prueba que el bootstrap haya terminado. PG0/PG1, C5 y exact-upgrade operativo
siguen bloqueados. La revisión y cualquier prueba física requieren una fase y
autorización separadas.
