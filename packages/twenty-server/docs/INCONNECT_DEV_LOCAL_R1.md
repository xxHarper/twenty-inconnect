# DEV-LOCAL-R1 · recuperación del CRM en WSL2

## Cierre del 18 de noviembre de 2026

Gate A dejó PostgreSQL 18.6 y Redis 8.10.0 dedicados. Gate B completó el
bootstrap de DEV-LOCAL-R1 con 182 Legacy, 127 Fast y 33 Slow, con F13 auto-create
desactivado y Attention `DISABLED`. Gate C dejó API y Vite accesibles en
loopback y acreditó el flujo real del Lead en Chrome. Worker y cron quedaron
inactivos. El [checkpoint canónico](INCONNECT_PROJECT_STATUS.md#checkpoint-del-18-de-noviembre-de-2026)
registra los resultados de C-LEAD-UX y Voice. Para el entorno existente, usar la
[referencia de operación](INCONNECT_OPERATIONS_AND_UPGRADES.md#dev-local-r1--operación-del-crm-real)
con autorización específica.

El diagnóstico, los comandos de creación de Gate A y la secuencia posterior
que siguen conservan la propuesta original como evidencia histórica. Gate D
quedó sin iniciar en este entorno.

Diagnóstico de fuente del 18 de noviembre de 2026. Rama
`feature/inconnect-lead-management`, HEAD `272f44a90c71aa339585b04d6bc748f6a1ce76f8`.
El checkout ya tenía 20 archivos versionados modificados, 30 sin seguimiento
y cero cambios en el índice. La propuesta original de la primera operación
física estaba pendiente de aprobación en ese momento.

## Diagnóstico

- Ubuntu 26.04 LTS x86-64, kernel WSL2 `6.18.33.2-microsoft-standard-WSL2`.
  Checkout en `/home/alberto/projects/twenty-inconnect`, sobre ext4. El destino
  propuesto está fuera del checkout, bajo `/home/alberto`, en el mount `/` ext4.
- El shell inicial carecía de Node y Yarn en `PATH`. El Node Linux instalado
  en `/home/alberto/.nvm/versions/node/v24.16.0/bin` reportó `v24.16.0`. Yarn
  del checkout reportó `4.13.0`. Cargaron los bindings Linux de Nx, SWC,
  Rollup, esbuild y sharp. Hay artefactos `dist` preexistentes cuya vigencia
  para el código actual queda pendiente de comprobar. PostgreSQL `18.6` y Redis
  `8.10.0` están disponibles como binarios Linux.
- La tabla de sockets de WSL mostró listeners en `5432` y `6379`. Los puertos
  candidatos `55432`, `56379`, `33000` y `33001` carecían de listener en esa
  lectura. Windows y el modo de red WSL quedaron sin verificar porque falló
  la interoperabilidad en el sandbox. Se comprobó la ausencia del destino en
  el sistema de archivos.
- La comprobación estática clasificó `PG_DATABASE_URL` de `twenty-server/.env`
  como referencia al `default` local protegido. `REDIS_URL` en ese archivo y
  en `.env.test` selecciona el Redis local compartido. `.env.test` también
  define otra referencia PostgreSQL local. En esos archivos están ausentes
  `PG_DATABASE_REPLICA_URL` y `REDIS_QUEUE_URL`. El frontend define
  `REACT_APP_SERVER_BASE_URL` para el proxy habitual. En el entorno de proceso
  examinado estaban ausentes las variables de conexión de la aplicación y
  presentes `HTTP_PROXY`, `HTTPS_PROXY` y `NO_PROXY`.
- Nest, los DataSources directos y Vite conservan la precedencia de variables
  explícitas. Para la ejecución dedicada se necesita un entorno de proceso
  privado con destinos fijados para PostgreSQL, cualquier réplica, Redis y
  Redis de colas, una clave de aplicación propia y configuración de proveedores
  y storage separada. Las credenciales de esta recuperación viven fuera del
  repositorio.
- `yarn start` lanza frontend y backend y, al detectar el puerto 3000, lanza el
  worker. `setup-dev-env.sh` inspecciona servicios compartidos, puede arrancarlos,
  crear bases y tocar `.env`. `database:init` y `database:init:prod` agregan
  `run-instance-commands`, que ejecuta el tramo histórico y los Fast registrados
  de la secuencia, incluidos F13 `1790793305698` y `1790793305700` y Attention
  `1792540800000`. El flag `--include-slow` sólo controla los Slow.

Referencias de fuente [scripts raíz](../../../package.json),
[targets del backend](../project.json), [Vite](../../twenty-front/vite.config.ts),
[setup de desarrollo](../../twenty-utils/setup-dev-env.sh),
[runner agregado](../src/database/commands/run-instance-commands.command.ts) e
[INSTALL-F1](INCONNECT_INSTALL_F1.md).

| Archivo presente | Variables relevantes presentes |
| --- | --- |
| `twenty-server/.env` | `APP_SECRET`, `FRONTEND_URL`, `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS`, `NODE_ENV`, `PG_DATABASE_URL`, `REDIS_URL` |
| `twenty-server/.env.test` | `APP_SECRET`, `FRONTEND_URL`, `IS_IMAP_SMTP_CALDAV_ENABLED`, `IS_IMAP_SMTP_CALDAV_CONNECTION_TEST_ENABLED`, `IS_MULTIWORKSPACE_ENABLED`, `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS`, `IS_WORKSPACE_CREATION_V2_ENABLED`, `PG_DATABASE_URL`, `REDIS_URL`, `SENTRY_DSN`, `TELEMETRY_ENABLED` |
| `twenty-front/.env` | `REACT_APP_SERVER_BASE_URL`, `VITE_BUILD_SOURCEMAP` |

No aparecieron archivos `.env` en la raíz ni archivos `.env.local` o
`.env.development*` en los dos paquetes.

## Gate A · autorización pendiente

La ruta más corta con las herramientas presentes es arrancar los binarios
nativos como `alberto` (UID 1000) en WSL2. El directorio nuevo
`/home/alberto/twenty-inconnect-dev-local-r1` tendrá permisos `0700`, un
`PGDATA` nuevo, almacenamiento Redis AOF propio, credenciales independientes,
un socket Redis privado y logs propios. Los procesos TCP escucharán
exclusivamente en `127.0.0.1`. El destino queda fuera de los roots de
escritura actuales de Codex y requiere aprobación del sandbox para escribirlo.

| Componente | Destino | Identidad de comprobación |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:55432`, `postgres/` bajo el directorio dedicado | Rol inicial `dev_local_r1_admin`, base de mantenimiento `postgres` del clúster nuevo y `system_identifier` igual en disco y vía SQL |
| Redis | `127.0.0.1:56379`, `redis/` bajo el directorio dedicado | ACL `dev_local_r1_admin`, el mismo `run_id` vía socket privado y TCP, directorio y AOF verificados |

La creación de `PGDATA`, las bases de sistema de `initdb`, las credenciales y
los archivos AOF se conserva en disco. Arrancar los dos procesos es reversible
mediante parada limpia. Gate A incluye únicamente el `SELECT` de identidad
del clúster recién creado y las consultas de identidad de su Redis. La base
de aplicación propuesta `twenty_inconnect_dev_local_r1` corresponde a Gate B.

### Preflight de Windows

La tabla de sockets de Windows no pudo leerse desde el sandbox. Si se dispone
de un shell de Windows, estos comandos permiten detectar reservas y reglas de
reenvío existentes. Tomar una coincidencia en un puerto candidato como motivo
para revisar la selección antes de ocuparlo. Gate C deberá comprobar desde
Windows el acceso al frontend por `http://localhost:33001` y el funcionamiento
del proxy de Vite hacia Nest dentro de WSL.

```powershell
Get-NetTCPConnection -State Listen -ErrorAction Stop |
  Where-Object { $_.LocalPort -in 55432,56379,33000,33001 } |
  Select-Object LocalAddress,LocalPort
netsh interface portproxy show all
```

### Creación, arranque y verificación propuestos

Ejecutar sólo tras la aprobación explícita. El preflight Linux vuelve a
comprobar el directorio, mount, usuario, herramientas y puertos en la misma
sesión que arrancaría los procesos. Ante un fallo, conservar los archivos y
examinar los logs privados con filtrado antes de reintentar.

```bash
/usr/bin/env -i HOME=/home/alberto PATH=/usr/bin:/bin LC_ALL=C \
  /bin/bash --noprofile --norc <<'DEV_LOCAL_R1_GATE_A'
set -Eeuo pipefail
umask 077
root=/home/alberto/twenty-inconnect-dev-local-r1
pg=/usr/lib/postgresql/18/bin
trap 'printf "Gate A interrumpido en línea %s. Conserva el estado y revisa los logs privados.\n" "$LINENO" >&2' ERR

[[ "$(id -u):$(id -un)" == 1000:alberto ]]
[[ "$(uname -r)" == *microsoft*WSL2* ]]
[[ "$(realpath -e "$HOME")" == "$HOME" ]]
[[ "$(findmnt -n -o TARGET -T "$HOME")" == / ]]
[[ "$(findmnt -n -o FSTYPE -T "$HOME")" == ext4 ]]
[[ ! -e "$root" && ! -L "$root" ]]
[[ -x "$pg/initdb" && -x "$pg/postgres" && -x "$pg/pg_ctl" ]]
[[ -x "$pg/pg_controldata" && -x "$pg/psql" ]]
[[ -x /usr/bin/redis-server && -x /usr/bin/redis-cli ]]
ports='( sport = :55432 or sport = :56379 )'
listeners=$(ss -Hltn "$ports")
[[ -z "$listeners" ]]

mkdir -m 0700 -- "$root"
mkdir -m 0700 -- "$root/redis" "$root/run" "$root/credentials"
openssl rand -hex 32 > "$root/credentials/postgres"
openssl rand -hex 32 > "$root/credentials/redis"

"$pg/initdb" -D "$root/postgres" --username=dev_local_r1_admin \
  --pwfile="$root/credentials/postgres" --auth=scram-sha-256 \
  --encoding=UTF8 --locale=C.UTF-8 --no-instructions --no-clean \
  >> "$root/gate-a.log" 2>&1
cat >> "$root/postgres/postgresql.conf" <<'POSTGRES'
listen_addresses = '127.0.0.1'
port = 55432
unix_socket_directories = ''
POSTGRES

redis_hash=$(printf '%s' "$(<"$root/credentials/redis")" | sha256sum)
printf 'user default off\nuser dev_local_r1_admin on #%s ~* &* +@all\n' \
  "${redis_hash%% *}" > "$root/redis.acl"
cat > "$root/redis.conf" <<REDIS
bind 127.0.0.1
port 56379
protected-mode yes
daemonize yes
pidfile $root/run/redis.pid
unixsocket $root/run/redis.sock
unixsocketperm 700
dir $root/redis
appendonly yes
appendfsync everysec
aclfile $root/redis.acl
logfile $root/redis.log
REDIS

"$pg/pg_ctl" -D "$root/postgres" -l "$root/postgres.log" -w -t 30 start \
  >> "$root/gate-a.log" 2>&1
/usr/bin/redis-server "$root/redis.conf" >> "$root/gate-a.log" 2>&1

for attempt in {1..25}; do
  [[ -S "$root/run/redis.sock" && -s "$root/run/redis.pid" ]] && break
  sleep 0.2
done
[[ -S "$root/run/redis.sock" ]]
read -r pg_pid < "$root/postgres/postmaster.pid"
read -r redis_pid < "$root/run/redis.pid"
[[ "$pg_pid" =~ ^[0-9]+$ && "$redis_pid" =~ ^[0-9]+$ ]]
listeners=$(ss -Hlptn "$ports")
[[ "$(awk '{print $4}' <<< "$listeners" | sort)" == $'127.0.0.1:55432\n127.0.0.1:56379' ]]
awk -v pg_pid="$pg_pid" -v redis_pid="$redis_pid" '
  $4 == "127.0.0.1:55432" && index($0, ",pid=" pg_pid ",") { pg = 1 }
  $4 == "127.0.0.1:56379" && index($0, ",pid=" redis_pid ",") { redis = 1 }
  END { exit !(pg && redis) }
' <<< "$listeners"

expected_pg_id=$("$pg/pg_controldata" "$root/postgres" |
  awk -F ': *' '$1 == "Database system identifier" {print $2}')
[[ "$expected_pg_id" =~ ^[0-9]+$ ]]
pg_target=$(PGCONNECT_TIMEOUT=3 PGPASSWORD="$(<"$root/credentials/postgres")" \
  timeout 8 "$pg/psql" -X -w -h 127.0.0.1 -p 55432 -U dev_local_r1_admin \
  -d postgres -qAt -v ON_ERROR_STOP=1 -c \
  "SELECT system_identifier, current_database(), current_user, host(inet_server_addr()), inet_server_port(), current_setting('data_directory') FROM pg_control_system()" \
  2>> "$root/gate-a.log")
[[ "$pg_target" == "$expected_pg_id|postgres|dev_local_r1_admin|127.0.0.1|55432|$root/postgres" ]]

redis_check() {
  REDISCLI_AUTH="$(<"$root/credentials/redis")" timeout 5 /usr/bin/redis-cli \
    --raw -e --user dev_local_r1_admin "$@" 2>> "$root/gate-a.log"
}
local_redis_id=$(redis_check -s "$root/run/redis.sock" INFO server |
  tr -d '\r' | awk -F: '$1 == "run_id" {print $2}')
tcp_redis_id=$(redis_check -h 127.0.0.1 -p 56379 INFO server |
  tr -d '\r' | awk -F: '$1 == "run_id" {print $2}')
[[ "$local_redis_id" =~ ^[[:xdigit:]]{40}$ && "$local_redis_id" == "$tcp_redis_id" ]]
[[ "$(redis_check -s "$root/run/redis.sock" CONFIG GET dir)" == $'dir\n'"$root/redis" ]]
[[ "$(redis_check -s "$root/run/redis.sock" CONFIG GET appendonly)" == $'appendonly\nyes' ]]
[[ "$(redis_check -h 127.0.0.1 -p 56379 PING)" == PONG ]]
listeners=$(ss -Hltn "$ports" | awk '{print $4}' | sort)
[[ "$listeners" == $'127.0.0.1:55432\n127.0.0.1:56379' ]]
printf 'pg_system_identifier=%s\nredis_run_id=%s\n' "$expected_pg_id" "$local_redis_id" \
  > "$root/verified-identity"
printf '%s\n' 'Gate A: identidades, autenticación, persistencia configurada y sockets WSL verificados.'
DEV_LOCAL_R1_GATE_A
```

El criterio de éxito es completar todos los checks y registrar la identidad
de los dos procesos dedicados. La persistencia del CRM se comprueba más
adelante con escritura, recarga y lectura del mismo Lead real.

### Parada limpia de Gate A

Detener Twenty primero si posteriormente se autorizó su arranque. Los
comandos de parada apuntan al socket privado y al `PGDATA` propio. Conservar
logs, credenciales y datos al detener. Si un stop falla, revisar qué listener
queda y el log dedicado antes de cualquier señal adicional. PostgreSQL se
detiene sólo si su identidad autenticada coincide con el disco dedicado.

```bash
/usr/bin/env -i HOME=/home/alberto PATH=/usr/bin:/bin LC_ALL=C \
  /bin/bash --noprofile --norc <<'DEV_LOCAL_R1_STOP'
set -uo pipefail
root=/home/alberto/twenty-inconnect-dev-local-r1
pg=/usr/lib/postgresql/18/bin
[[ "$(id -u):$(id -un)" == 1000:alberto ]] || exit 1
[[ -d "$root" && ! -L "$root" && -O "$root" ]] || exit 1
result=0
if [[ -S "$root/run/redis.sock" ]]; then
  REDISCLI_AUTH="$(<"$root/credentials/redis")" timeout 30 /usr/bin/redis-cli \
    -s "$root/run/redis.sock" --user dev_local_r1_admin -e SHUTDOWN SAVE \
    >> "$root/gate-a.log" 2>&1 || result=1
fi
if [[ -d "$root/postgres" && ! -L "$root/postgres" && -f "$root/postgres/postmaster.pid" ]]; then
  if expected=$("$pg/pg_controldata" "$root/postgres" 2>> "$root/gate-a.log" |
      awk -F ': *' '$1 == "Database system identifier" {print $2}') &&
    [[ "$expected" =~ ^[0-9]+$ ]] &&
    actual=$(PGCONNECT_TIMEOUT=3 PGPASSWORD="$(<"$root/credentials/postgres")" \
      timeout 8 "$pg/psql" -X -w -h 127.0.0.1 -p 55432 -U dev_local_r1_admin \
      -d postgres -qAt -v ON_ERROR_STOP=1 -c \
      "SELECT system_identifier, current_setting('data_directory') FROM pg_control_system()" \
      2>> "$root/gate-a.log") && [[ "$actual" == "$expected|$root/postgres" ]]; then
    "$pg/pg_ctl" -D "$root/postgres" -m fast -w -t 30 stop \
      >> "$root/gate-a.log" 2>&1 || result=1
  else
    result=1
  fi
fi
ss -Hltn '( sport = :55432 or sport = :56379 )' | awk '{print $4}'
exit "$result"
DEV_LOCAL_R1_STOP
```

## Secuencia posterior

1. **Gate B · esquema.** Usar la identidad registrada en A y una base de
   aplicación y un rol propios. Revisar el inventario exacto Legacy/Fast/Slow,
   sus dependencias, tracking y efectos antes de proponer el comando de
   bootstrap. El tramo de INSTALL-F1 corrige la colisión histórica en fuente.
   Falta acreditar una ruta operativa aprobable para Core y CRM básico sin
   activar la cadena agregada. Si su esquema exige una migración reservada,
   pedir autorización individual y conservar la barrera de arranque. El
   Store del Distribuidor sigue en SQL propuesto.
2. **Gate C · aplicación.** Arrancar React/Vite con HMR y Nest en watch por
   separado. Fijar `REACT_APP_SERVER_BASE_URL` al backend dedicado, validar
   `FRONTEND_URL`, `SERVER_URL`, CORS y cookies con el origen de Windows. Vite
   admite `--host 127.0.0.1 --strictPort`. Nest actualmente recibe sólo
   `NODE_PORT` en `app.listen`, así que la escucha HTTP de Gate C requiere
   resolver el bind o acordar su aislamiento antes de autorizar el comando.
   Usar el entrypoint de API y omitir el registro explícito de cron. Bootstrap
   del workspace y cambios de datos comerciales entran en la autorización de
   sus acciones correspondientes. Preparar configuración local de storage y
   autenticación, con telemetría, integraciones externas y proveedores fuera
   del recorrido de prueba.
3. **Gate D · worker.** La inicialización del workspace se llama directamente
   desde Nest. La instalación de apps preinstaladas y la generación de SDK
   se encolan aparte. Comprobar login, workspace y CRUD primero sin consumidor.
   Si un job resulta imprescindible, identificar su cola, efectos y parada
   antes de solicitar su habilitación independiente.
4. **Leads.** Si falta el objeto, crearlo mediante metadata oficial bajo
   autorización de configuración. Resolver Owner, Roles, usuario y políticas
   con las identidades vivas del workspace. Probar con Admin o Supervisor
   autorizado por Twenty e INCONNECT, con Owner válido. Tras crear y editar,
   recargar y reconsultar el mismo ID desde el CRM, y comprobar la denegación
   aplicable con un usuario legítimo de alcance restringido. La creación por
   Ejecutivo sigue denegada por contrato. El Distribuidor queda para otra etapa.

PHYS-A0 sigue NO-GO. PG0/PG1, Stage C5 y exact-upgrade operativo siguen
bloqueados. Cada gate operativo requiere autorización específica.
