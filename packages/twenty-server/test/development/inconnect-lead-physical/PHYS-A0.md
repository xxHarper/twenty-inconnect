# PHYS-A0 — plan mínimo pendiente de autorización y ejecución

Fecha: 2026-10-27. Objetivo exclusivo: acreditar perímetro, lifecycle y un cluster
vacío desechable. **No ejecutar con el código PHYS-P1 actual:** faltan adaptadores
live y observadores confiables. Los comparadores puros no son un supervisor.
No hay flag para saltar esta limitación; una implementación posterior revisada
y autorización humana específica son necesarias. PG0/PG1/C5/exact-upgrade siguen
BLOCKED; no se autoriza ni necesita su ejecución para revisar este plan.

## 0. Revisión previa y autorización de preparación live

Fijar commit/hash del arnés revisado, run UUID, boot ID actual, presupuesto de
memoria/procesos/tiempo, raíz exclusiva, herramientas y versiones Linux. Inventario
de fuentes y worktree por Git READ-ONLY. No instalar dependencias ni alterar
configuración global, montajes WSL, servicios habituales o secretos.

Antes de cargas reales se necesita implementar/revisar el adaptador live:
adquisición exclusiva de recursos, observación kernel completa y fresca, registros
por operación, identidad de proceso y contención de todos sus descendientes.
El artefacto independiente nace del supervisor, no de inputs de la aplicación.
No representar la aprobación humana con un boolean en JSON o variable FORCE.

Autorización requerida: **preparar/revisar adaptador live para A0**, todavía sin
namespaces ni PostgreSQL. No es implícita en la aprobación SOURCE-ONLY de P1.

## 1. Cargas inocuas: perímetro, sin bases ni servicios

Tras autorización específica de probes, verificar namespaces privados user/net/
mount/PID, UID mapping, procfs, runtime mounts y sus identidades frente al host.
Crear sólo recursos de prueba bajo la raíz exclusiva registrada. Acreditar:

- Loopback privado, sin NIC/ruta externa IPv4/IPv6, host/Windows, forwarding,
  veth ni proxy; sockets abstractos y pathname del host inalcanzables.
- HOME, dotenv, pgpass/service files, secretos, sockets y datos PostgreSQL del
  host ocultos; ningún montaje del repositorio que exponga dotenv. Probar con
  canarios inocuos controlados y tablas kernel, sin conexión ni paquetes a default.
- Entorno real de cada hijo exactamente permitido; sin PG*, Redis*, loaders,
  credenciales o rutas heredadas del shell. No imprimir valores sensibles.
- Sin cambios en montajes/red del padre; no confundir exit 0 de true con prueba
  del perímetro ni la existencia de bwrap/unshare con capacidad disponible.

Artefactos: namespace IDs, proceso/PID/start ticks/ejecutable, mapas de montajes,
interfaces/rutas/listeners, pruebas positivas/negativas y estado del padre.
Fallar si falta autoridad kernel, completitud o alguna barrera indispensable.

Autorización requerida: **crear namespaces y ejecutar únicamente probes inocuos**,
con recursos y límites enumerados; sin initdb, PostgreSQL, Redis ni SQL.

## 2. Lifecycle y limpieza con recursos inocuos

Ejecutar por separado salida normal, timeout y SIGTERM del supervisor; después,
con nueva autorización de fallo controlado, muerte abrupta de procesos propios
y recuperación del guardian. Acreditar propagación, ausencia de huérfanos y
recuperación de ownership sin PID reuse. No matar procesos ajenos. Ninguna prueba
debe provocar un reinicio WSL ni usar cargas OOM para medir límites.

Registrar creación de cada recurso y ejecutable: run/boot, PID/start ticks,
device/inode/mount, padre y fase. Ante muerte parcial, incertidumbre o inventario
incompleto, preservar recursos y detener; no cleanup por suposición.

La eliminación futura exige handles seguros/no-follow, árbol completo propio,
ausencia de montajes ajenos, cierre de conexiones/procesos y evidencia estable.
No `pkill`, señales por nombre, glob, flush Redis compartido ni rm -rf por path.
No remover la evidencia con los recursos. Verificar ausencia de recursos propios
restantes y estado del padre después de cleanup. Un MATCH puro no la autoriza.

Autorización requerida: **pruebas lifecycle y limpieza exclusivamente de recursos
inocuos identificados**; distinguir la autorización de fallos abruptos.

## 3. Condiciones para permitir initdb

Sólo tras aceptación física explícita de 1–2: raíz nueva exclusiva sin symlinks,
ownership/modes privados, hashes de binarios y runtime acreditados, entorno
vacío permitido, contención y límites efectivos. Sin procesos/recursos sobrantes
de otra ejecución. Identidad conocida del cluster excluido desde evidencia offline
confiable; no consultar default ni acceder a sus archivos sin autorización propia.

Generar credencial nueva privada; nunca credenciales administrativas habituales.
initdb inicializa únicamente `/lm/data`, cuyo montaje enlaza la raíz registrada.
Obtener y fijar system identifier y control-data hash mediante pg_controldata
offline **antes** del primer SQL. Debe diferir del cluster excluido. Si falta
evidencia independiente, detener; no copiar el identificador desde la sesión SQL.

Autorización requerida: **ejecutar initdb y pg_controldata exclusivamente sobre
la raíz nueva del ensayo**, crear sólo ese cluster y sus secretos. Sin schema
Twenty, DDL del distribuidor, roles adicionales ni datos CRM.

## 4. Cluster vacío e identidad SQL

Autorizar separadamente postmaster en primer plano supervisado, loopback/puerto
privados y socket `/lm/socket`. Acreditar PID/start ticks/ejecutable, namespaces y
data directory por OS; completar el manifiesto desde esas observaciones.

Conectar únicamente al cluster nuevo, base inicial postgres y rol exclusivo.
Antes de cualquier futura escritura verificar current_database, current_user,
session_user, inet_server_addr/port, data_directory, server_version_num,
pg_postmaster_start_time, pg_control_system system_identifier, backend PID/start.
El usuario de A0 no es una credencial de aplicación ni se reutiliza en B–D sin
revisar privilegios. Comparar con el manifiesto offline y correlación kernel,
preservando system identifier como string y precisión de timestamps.

Fijar cada conexión real, no sólo una conexión de inspección. Cualquier reemplazo
del cliente/runner, cambio de PID/start, boot, manifest o perímetro detiene el caso.
No ejecutar SQL ante identidad UNKNOWN. La conexión de observación requiere su
propia autorización read-only sobre el cluster desechable.

Artefactos: inventario sólo de postgres/template0/template1, sesión correlacionada,
catálogos vacíos de aplicación, listeners exactos y ausencia de acceso al host.
No crear todavía una base de aplicación ni Roles, workspace, Leads o Store.
La comparación application se ensayará físicamente en A1 tras autorización nueva.

Autorización requerida: **arrancar/parar sólo este PostgreSQL y consultar su
identidad read-only**. No Redis, Nest, frontend, workers, extensiones ni migraciones.

## 5. Comprobación de configuración y cierre A0

Comprobar como datos la configuración futura Core/Raw/Workspace/réplica y ambas
URLs Redis, con dotenv inaccesible y sin defaults de pg. PG_DATABASE_URL y
PG_DATABASE_REPLICA_URL deben ser explícitas; mismo destino aislado. Redis tendrá
su instancia exclusiva en una fase posterior. No arrancarlo para completar A0.

No importar el bootstrap de Twenty para inspeccionar opciones: puede abrir pools
e instalar extensiones antes del primer SQL del harness. El adaptador futuro debe
capturar opciones y verificar permisos/barrier antes de initialize. La configuración
de prueba prohíbe synchronize, migrationsRun, dropSchema e installExtensions.
El esquema de efectivo de P1 no es evidencia de que el producto ya lo cumple.

Cerrar conexiones, detener postmaster y acreditar quiescencia del árbol. Limpiar
sólo recursos inventariados bajo autorización de cleanup; conservar evidencia en
`.cache/lead-physical-<run-id>/` ignorado. Si hubo respuesta incierta, preservar.

Paradas obligatorias: reboot, evidencia incompleta/no confiable, UID/ns/proceso/
cluster/connection distintos, symlink/mount inesperado, límite no efectivo,
presión de recursos, timeout, secretos en logs, proceso huérfano, necesidad de
default/Internet o de un gate bloqueado. No elevar límites, fallback, reparación,
reintento, relanzamiento o limpieza automáticos.

Aceptar A0 sólo con evidencia de kernel/lifecycle/cluster y revisión humana,
sin afirmar aceptación del fixture ni del MVP. Después se podrá **preparar A1**:
resolver los bloqueos del inventario, revisar schema/fixture e instalación del
Store. A0 no autoriza A1 ni el reparto final de 50 ficticios EVEN 25/25.
