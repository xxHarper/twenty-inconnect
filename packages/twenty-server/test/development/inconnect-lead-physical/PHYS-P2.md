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

Remediación focal B1–B3 preparada el **2026-10-28**, exclusivamente SOURCE-ONLY.
Las entradas Node y Python continúan bloqueadas; no se ejecutó el mecanismo real.

El ejecutable inicial sigue siendo `/usr/bin/python3 -I -S`, ahora con `-c` y
un bootstrap fijo de `probe-bootstrap.ts`. No es un comando del manifiesto ni
un proceso auxiliar: reemplaza mediante exec el mismo proceso controlador.
Node abre la fuente conocida, valida hash y conserva abierto el snapshot
exclusivo 0600; comprueba sus bytes, inode/device y relación con el nombre. No
lo cierra y reabre para ejecutarlo. Esos permisos no se consideran inmutabilidad.
El FD concreto se hereda como 3, acompañado de hash, device, inode y tamaño.

El bootstrap usa sólo la biblioteca estándar Python: verifica otra vez el FD 3,
copia sus bytes a un memfd, aplica y consulta WRITE/GROW/SHRINK/SEAL, y verifica
hash/tamaño antes de duplicar ese mismo objeto sellado al FD 3. Comprueba su
identidad y sellos tras dup2 y sólo entonces ejecuta el supervisor por ese FD.
Sustitución posterior del pathname no cambia el objeto; modificación de la fuente
se vuelve a hashear y nunca concede ejecución de bytes distintos. Falta de memfd,
sellos o identidad impide exec del supervisor; no existe fallback al archivo.
La copia durable se conserva para evidencia y no es autoridad ejecutable.
Python y bwrap, sus bibliotecas, procfs y el comportamiento real de sellado
requieren revisión y comprobación física posterior, sin instalar dependencias.

Los argumentos de bwrap siguen siendo un catálogo fijo sin shell. `/lm/probe.py`
se copia desde el FD 3 sellado mediante `--ro-bind-data 3` a un montaje de
lectura privado; se fija su offset en cero antes de exec. No se pasa el memfd a
la resolución de pathname/realpath de `--ro-bind`. La copia documental mutable
no determina el payload. Compatibilidad y comportamiento del bwrap instalado
siguen pendientes de comprobación física, sin fallback de comando. Sólo UUID y probe validados ocupan las posiciones previstas.

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
fsync el evento en `.cache/lead-physical-<UUID>/controller.jsonl`, el directorio
que contiene el log y su padre, y sólo después responde ACK. Node mantiene handles
de directorio no-follow y crea entradas a través de `/proc/self/fd/<dirfd>`;
verifica inode/device, tipo, permisos y relaciones entre nombre y handle. El
snapshot también se sincroniza antes de esos directorios y antes del lanzamiento.
Los fallos invalidan la sesión sin retry: no se lanza ni se responde ACK tras
un error de durabilidad. Fallo de cierre se propaga como cierre no acreditado. ACK acredita persistencia del paso, no aprobación humana. Sin ACK,
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

Node sólo escribe CANCEL al pipe privado. Popen crea primero un Python que
lee exclusivamente el script sellado y espera una barrera por pipe. El writer
CLOEXEC pertenece sólo al controlador y no se hereda al hijo. El controlador
adquiere pidfd e identidad, persiste `process.json` con fsync de directorio y
publica RUNNING durable antes de escribir GO. El hijo sólo hace exec al bwrap
fijo tras GO completo, sellos válidos y deadline vigente. EOF, mensaje parcial,
error o timeout de barrera abortan sin ejecutar bwrap. La nueva rama prelaunch
usa la misma guarda Python incondicionalmente cerrada.

Ante error después de Popen, el controlador cierra primero la barrera y espera
acotadamente al hijo. Con pidfd/identidad vigentes puede finalizar mediante TERM
y escalada KILL sobre ese descriptor y recolectar. El paso Python → bwrap es
una transición de ejecutable explícitamente limitada, no un bypass de identidad.
Sin pidfd o identidad nunca señaliza por PID; conserva y declara UNVERIFIED si
EOF/deadline no permiten acreditar reap. Fallo de evidencia terminal no omite
esa finalización. `termination.json` registra reap/release cuando puede persistirse;
reap del hijo directo nunca equivale a árbol vacío. Fallos de cierre se propagan.

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
Pruebas Python estándar: bootstrap fijo compilado sin invocar su entrypoint y
funciones con syscalls/procesos simulados; sellos/hash/descriptor, barrera EOF/GO,
fallos posteriores a Popen, reap, evidencia terminal, TERM/KILL por pidfd,
PID reuse, falta de autoridad, ausencia de visibilidad y adquisición parcial. El proceso unittest no lanza procesos auxiliares ni payloads. Se ejecuta
con -B para no escribir pycache en fuentes. Importación no ejecuta guardas/IO.

Evidencia local ignorada: `.cache/lead-phys-p2-20261027/`, con comando, alcance,
hashes, stdout/stderr, exit, JSON Jest y boot/recursos antes/después. Los intentos
previos se conservan y no se suman dos veces. Una sola suite/check a la vez.
No instalar dependencias ni llamar servicios para completar validación.

[PHYS-A0.md](./PHYS-A0.md) delimita la autorización futura inicial sólo a probes
inocuos y lifecycle sin PostgreSQL. PASS/FAIL/UNVERIFIED físicos requieren evidencia
y revisión independientes; tests SOURCE-ONLY no conceden esa aceptación. La
preparación P2 termina sin ejecutar la ruta nativa, namespaces ni probes reales.

Evidencia de remediación: `.cache/lead-phys-p2-b1-b3-remediation-20261027/`.
Conserva la auditoría y los contraejemplos originales sin modificarlos. Sus
aserciones de reproducción insegura ya no se satisfacen; las regresiones
permanentes vuelven a introducir los mismos ataques con los nuevos contratos
simulados y exigen rechazo/contención. Un mock no acredita sellado, EOF, fsync,
fork/exec ni límites reales del kernel/filesystem. PHYS-A0.0 sigue pendiente de
revisión independiente y autorización específica; no se declara físicamente listo.

## B2-R1 — checkpoint final de nombres/handles, 2026-10-28

La auditoría independiente mantuvo B1 y B3 CLOSED SOURCE-ONLY y B2 OPEN por
B2-R1. Esta corrección focal no modifica bootstrap, supervisor, barrera GO ni
sus pruebas Python. La aceptación física PHYS-A0.0 continúa BLOCKED.

Causa reproducida: durante el segundo parent.sync de ACQUIRED, el padre nombrado
.cache o el log controller.jsonl podían sustituirse por otro objeto regular del
mismo UID. La raíz seguía siendo válida bajo el FD del padre antiguo. Revalidar
sólo esa raíz después de fsync permitía ACK aunque la evidencia ya no estuviera
en el nombre acreditado; devolver UNVERIFIED después era demasiado tarde.

probe-evidence.ts ahora retiene un descriptor independiente del directorio del
repositorio, obtenido de la ubicación fija del adaptador. El padre .cache se
abre y comprueba respecto de ese ancla. Cada sync verifica ancestros y el ancla
nombrada, padre, raíz y log, con tipo, propietario/permisos, no-symlink y vínculos
de device/inode entre entradas y descriptores. Repite todo el conjunto después
de log.sync → root.sync → parent.sync. La ancla no es el propio padre antiguo.
Se conservan exclusividad, handles y orden durable; el nuevo handle también se
cierra conservadoramente. No se crean otros recursos operativos.

confirmAcquisition conserva await evidence.sync antes de escribir ACK; también
una invocación directa debe pasar el checkpoint completo. Cualquier discrepancia,
lectura incompleta o error invalida definitivamente la sesión, sin retry, ACK,
GO ni continuación autorizada hacia workload. El controlador simulado ya existe
en los ataques tardíos: no se confunde ese spawn previo con un workload liberado.

Se añaden doce regresiones Node: sustitución tardía de padre/log, checkpoint
positivo, errores finales de ancla/padre/raíz/log, drift tardío de tipo, UID,
permisos o symlink del log e invocación directa de confirmAcquisition sin bypass
ni recuperación automática. Ambas sustituciones alcanzaron los tres fsync y el
segundo checkpoint ACQUIRED antes de rechazarse. Las 28 aserciones Node previas
se conservan; el fixture común sólo añade la identidad/FD independiente del
repositorio, necesaria para el nuevo contrato de anclaje.

Las reproducciones originales del auditor permanecen intactas. Se ejecutaron
antes y después: el modelo original no representa el descriptor adicional y
su fallo temprano posterior no acredita cierre. Una copia documentada añade
únicamente el repositorio y el vínculo .cache al modelo independiente; conserva
la sustitución temporizada, objetos retenidos y asserts de alcance. Con ese
contrato válido, los asserts de ACK inseguro fallan en el ACK, y las verificaciones
de rechazo llegan al checkpoint y pasan. Evidencia propia, sin sobrescribir al
auditor: `.cache/lead-phys-p2-b2-r1-remediation-20261028/`.

### Límite preciso del checkpoint y condición física

La última revalidación acredita los objetos/vínculos observados después de fsync,
no inmutabilidad futura ni una transacción atómica sobre el namespace. Los FDs
siguen fijando los objetos abiertos y las operaciones relativas no se redirigen
al padre/log sustituidos. No impiden que otro actor con autoridad sobre los mismos
nombres o contenidos los cambie después de su comprobación, incluso en la ventana
entre el último check y la escritura de ACK al pipe. Los checks mismos son
secuenciales. Permisos 0700/0600 no excluyen a otro proceso del mismo UID ni root.

La reparación cierra los dos ataques temporizados dentro del fsync final. No
satisface una promesa de localización inmutable bajo un escritor adversarial
concurrente ilimitado. Para PHYS-A0.0 debe acreditarse control exclusivo de las
entradas y ancestros relevantes durante adquisición/checkpoint/ACK y recuperación
de evidencia, o una barrera efectiva de identidad/montajes que excluya a esos
escritores. Un JSON, un chmod o un lock meramente cooperativo no lo demuestran.
Si ese control no puede acreditarse, el contrato físico de ACK sigue sin autoridad
suficiente: UNVERIFIED/BLOCKED. No se añade un framework ni se levanta un gate.

El límite no se infiere sólo teóricamente: el modelo independiente con un escritor
inyectado al entrar en la escritura de ACK, después de la revalidación, conserva
ackSent=true y sólo después obtiene UNVERIFIED. Se registra como
`residual-window-model`, reproducción de una limitación y no PASS de seguridad.
No es el ataque B2-R1 dentro del fsync final; no se usa para afirmar que se haya
cerrado el contrato frente a escritores concurrentes sin restricción. Ese modelo
de amenaza sigue requiriendo la precondición física indicada, actualmente no
acreditada. No se declara B2 aceptado independientemente ni se autoriza A0.0.
