# PHYS-P2 — adaptador PROBE_ONLY preparado SOURCE-ONLY

Fecha: 2026-10-27, America/Mexico_City. Checkpoint P1 y base de esta tarea:
`0fc4a3114dde9f1b6c57c76948b562de0dfe3ada`, rama
`feature/inconnect-lead-management`, worktree/staging inicialmente limpios.
El inventario de fixture P1 conserva su referencia histórica c67d3bd4dd y sus
44 hashes; no se amplió ni modificó. Producto, AGENTS y PG0/PG1 intactos.

## Archivos y separación de capacidades

Código nuevo en `probe-only/`:

- `probe-plan.ts`: petición estricta PROBE_ONLY y dos probes predefinidos,
  presupuesto acotado, rechazo del entorno heredado y entrada física bloqueada.
- `probe-lifecycle.ts`: máquina de estados, eventos correlacionados, secuencia,
  resultado y conservación. `probe-ownership.ts`: comparación pura de identidades;
  ninguna etiqueta de lease es autoridad kernel ni autoriza señales reales.
- `probe-session.ts`: protocolo con IO explícito simulado; no tiene defaults
  nativos. Exige evidencia durable previa, antes de ACK de adquisición, y terminal.
- `node-probe-adapter.ts`: implementación de filesystem y pipes a través de una
  frontera IO testeable, hash y descriptor de programa fijados, stdio explícito,
  entorno nuevo, salida acotada y log durable. No señales por PID ni borrado.
- `live-probe-entry.ts`: único binding Node nativo, bloqueado antes de cualquier
  IO. Sin CLI, registro Nest/Nx, lectura de argv/env al importar ni autoejecución.
- `probe-supervisor.py`: controlador nativo candidato, payloads fijos, root
  exclusivo/no-follow, bwrap, límites, pidfd, observación y retención. Su entrada
  --supervise también rechaza incondicionalmente durante P2.
- `probe_supervisor_test.py`: unidades con Popen, pidfd/señales, filesystem y
  límites simulados; no ejecuta controlador ni payload físicos.

Nuevas suites Jest `probe-lifecycle`, `probe-node-adapter`, `probe-import-safety`
y `probe-fixtures.ts`. Se actualizan únicamente README y PHYS-A0 del arnés.
La configuración dedicada de Jest P1 se conserva sin bootstrap compartido.

POSTGRES_INIT, POSTGRES_CONNECT y FIXTURE_AND_TESTS no están implementadas en
este adaptador. Se rechazan como capacidades desconocidas. No se importan los
candidatos PostgreSQL/Redis P1, ni drivers, dotenv, módulos Twenty o arneses PG0.
Un PASS de PROBE_ONLY no crea una autorización ni produce una fase siguiente.
Las dos guardas no se desactivan con JSON, flags, variables ni tests verdes.
Una revisión y nueva autorización humanas deberán resolver el binding físico.

## Perímetro y adquisición

El programa es siempre `/usr/bin/python3 -I -S /proc/self/fd/3 --supervise`;
Node abre únicamente el script conocido junto al módulo, rechaza symlinks y
permisos/propietarios ajenos en sus ancestros, compara el SHA-256 revisado y
ejecuta por descriptor un snapshot privado 0400 de esos bytes. Fijar sólo el
inode original no congelaría sus bytes ante una edición posterior. El manifiesto
no elige binario, ruta de script o comando.
Los argumentos de bwrap los construye el controlador con un catálogo fijo,
sin shell. Sólo UUID y probe validados entran en las posiciones previstas.

Entorno del controlador: LANG/LC_ALL=C. Entorno del payload: éstos más HOME
vacío y run ID propio. Sin PATH, PG*, Redis*, NODE_OPTIONS, preloads, dotenv,
pgpass, credenciales del shell o configuración administrativa habitual.
El ejecutable Python y el runtime de bwrap se deben revisar físicamente; hash
coherente de un manifiesto no acredita disponibilidad ni aislamiento.

El controlador crea sólo `/tmp/inconnect-lead-phys-<UUID>` mediante mkdir exclusivo
y directory fd no-follow. Registra inode/device, boot/run, canary, código y
observaciones; los ficheros se crean exclusivos a 0600 bajo root 0700. Ante
adquisición parcial se conserva el inventario disponible, nunca se reintenta
crear una raíz existente ni se borra para poder relanzar.

Antes de bwrap publica ACQUIRED con observación inicial; Node debe persistir y
fsync el evento en `.cache/lead-physical-<UUID>/controller.jsonl`, y sólo después
responde ACK. ACK acredita persistencia del paso, no aprobación humana. Sin ACK,
por deadline, EOF o cancelación, no se lanza el probe. También se persisten las
observaciones finales del controlador y payload. Fuente/protocolo están acotados;
logs omiten credenciales y no vuelcan entornos ni nombres de sockets ajenos.

bwrap solicita user/net/PID/IPC/UTS privados y su mount namespace propio. Runtime
ro explícito, `/lm` ro desde el directory fd, procfs y /tmp,/run privados. No se
montan /, /home, /etc, el repo ni sockets/PGDATA del host. Payload exige canary
propio, ausencia de rutas habituales, ausencia de descriptores heredados extra,
namespace distinto del controlador, sólo lo y ausencia de rutas/sockets externos.
No abre sockets ni envía paquetes a default, Internet o proveedores.

## Máquina de estados, señales y cierre

PREPARING → ACQUIRING → ACQUIRED → LAUNCHING → RUNNING. Desde RUNNING: salida
normal, timeout, cancelación, interrupción, fallo parcial o pérdida del supervisor.
Fallos/loss pueden pasar por RECOVERING; sólo CLOSED con evidencia suficiente
permite un resultado verificado. Orden, run/boot, snapshots y causa esperada se
comprueban. EOF, gaps, reboot o persistencia fallida producen UNVERIFIED.
RECOVERING representa evidencia de recuperación, no un reattach automático.

Node sólo escribe CANCEL al pipe privado. El controlador abre pidfd de su hijo
Popen antes de recolectarlo, y conserva PID/start ticks/executable. Antes de TERM
comprueba esa identidad; una escalada KILL usa el mismo pidfd, nunca el número
PID ni un grupo inferido. Si falta pidfd, permisos o identidad, no hay fallback.
Que un proceso ya haya terminado tampoco autoriza señalizar su antiguo PID.

EOF del padre o señales TERM/INT propias solicitan terminación. La muerte abrupta
del controlador impide prometer propagación o cierre de todos sus hijos:
--die-with-parent y la muerte del init del namespace son mecanismos candidatos,
sin aceptación WSL. Un CLOSED del wrapper no basta: exigir árbol vacío mediante
visibilidad completa de namespaces. Cualquier /proc inaccesible da UNVERIFIED;
no se omiten otros UID para fabricar ausencia. Guardian independiente y recovery
ante SIGKILL siguen pendientes; no se reportan implementados/aceptados.

Memoria AS, NPROC, CPU, NOFILE, FSIZE y core dumps se acotan sólo en controlador
y descendientes; deadline monotónico y grace de señales acotada. No son límites
agregados de cgroup ni garantía contra todo bloqueo kernel/IO. Esas propiedades,
UID mapping, fork/exec de bwrap, cierre de FD, visibilidad de /proc, mounts y
propagación real requieren aceptación física; si son indispensables y faltan,
la ruta queda BLOCKED, sin elevar permisos ni modificar WSL automáticamente.

No existe eliminación nativa en P2. Cierra únicamente sus handles y conserva
root/evidencia incluso en PASS. `planProbeCleanup` nunca devuelve paths para
borrar ni PIDs para señalizar. Cleanup futuro necesita otra autorización e
inventario estable, handles actuales y árbol acreditado; un root/PID guardado
no lo permite. No se importó ni modificó lifecycle PG0/PG1.

## Validación y próximos pasos

Pruebas TypeScript: contratos, fase/command allowlist, argumentos exactos, IO
simulado, symlinks/permisos, adquisición parcial, ACK durable, protocolo acotado,
reboot, cancelación/timeout, identidad y pérdida/recuperación no acreditada.
Pruebas Python estándar: funciones con syscalls y procesos simulados, TERM/KILL
por pidfd, PID reuse, falta de autoridad, ausencia de visibilidad y adquisición
parcial. El proceso unittest no lanza procesos auxiliares ni payloads. Se ejecuta
con -B para no escribir pycache en fuentes. Importación no ejecuta guardas/IO.

Evidencia local ignorada: `.cache/lead-phys-p2-20261027/`, con comando, alcance,
hashes, stdout/stderr, exit, JSON Jest y boot/recursos antes/después. Los intentos
previos se conservan y no se suman dos veces. Una sola suite/check a la vez.
No instalar dependencias ni llamar servicios para completar validación.

[PHYS-A0.md](./PHYS-A0.md) delimita la autorización futura inicial sólo a probes
inocuos y lifecycle sin PostgreSQL. PASS/FAIL/UNVERIFIED físicos requieren evidencia
y revisión independientes; tests SOURCE-ONLY no conceden esa aceptación. La
preparación P2 termina sin ejecutar la ruta nativa, namespaces ni probes reales.
