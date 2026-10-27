# PHYS-A0 — primera autorización física: PROBE_ONLY, sin PostgreSQL

Actualización PHYS-P2, 2026-10-27. Base de preparación: checkpoint P1
`0fc4a3114dde9f1b6c57c76948b562de0dfe3ada`. Este plan sustituye la secuencia
anterior que incluía cluster vacío dentro de A0. **La primera autorización no
incluye initdb, PostgreSQL, Redis, SQL, fixture ni servidores.**

El adaptador de [PHYS-P2](./PHYS-P2.md) está implementado para revisión SOURCE-ONLY;
ambas entradas nativas siguen BLOCKED. No ejecutarlo ni cambiar guardas sólo
porque los tests pasen. PG0/PG1/C5/exact-upgrade permanecen intactos y bloqueados.

## 1. Autorización humana y revisión previas

Una autorización futura debe nombrar PROBE_ONLY, commit y hashes revisados,
UUID/boot ID, raíz privada exclusiva, directorio de evidencia en .cache,
probes exactos, límites, cancelación/señales permitidas y retención de recursos.
No basta un manifiesto, variable, flag FORCE ni éxito de un probe anterior.
Revisar y vincular expresamente la entrada física; P2 no entrega una CLI activada.

El catálogo admite BOUNDARY y LIFECYCLE_WAIT. Cada caso declara terminación
esperada: normal, timeout, cancelación o interrupción. No se acepta un comando
arbitrario ni un binario elegido por manifiesto. La prueba de muerte abrupta
requiere autorización adicional específica; no está habilitada automáticamente.

## 2. Preflight, sin conexiones al host

Git READ-ONLY: rama/HEAD/worktree, hashes de fuentes y script revisado; boot ID
y recursos actuales. No tocar cambios ajenos ni reutilizar una raíz previa.
Validar runtime Linux, propietarios, permisos, ausencia de symlinks y estabilidad
de los descriptores. Node fija el programa por hash y descriptor heredado; no lo
obtiene de una ruta del manifiesto. El protocolo y salida están acotados.

Comprobar las capacidades requeridas antes del lanzamiento: pidfd, límites,
namespaces user/net/mount/PID y visibilidad de procesos. Los probes sólo podrán
acreditar esas capacidades físicamente bajo esta autorización futura. Si faltan,
UNVERIFIED/BLOCKED, sin fallback a host networking, kill numérico o permisos root.
Presencia de bwrap/unshare o probes históricos no prueba aislamiento actual.

## 3. BOUNDARY: carga inocua predefinida

Crear únicamente la raíz registrada y evidencia privada. Preparar canary y
script propio, con archivos exclusivos/no-follow y permisos privados. El montaje
/lm es de lectura; HOME vacío, /tmp y /run privados, procfs privado. Runtime
explícito /usr,/lib,/lib64 sujeto a revisión; sin montaje de /, /home, /etc,
repositorio, dotenv, sockets o datos PostgreSQL habituales.

Verificar namespaces distintos del controlador; interfaces sólo lo, sin rutas
externas IPv4/IPv6 ni sockets Unix importados. No contactar default ni Internet:
la denegación se prueba con estado kernel, mounts/FDs y canarios controlados,
sin enviar paquetes a destinos reales. No concluir que un puerto distinto basta.
Verificar canary positivo y ausencia de rutas de host/credenciales habituales.

Registrar observaciones antes/después del controlador y del payload, correlación
de proceso y namespaces, estado y exit. No imprimir secretos ni volcar entornos
heredados. El supervisor resume mountinfo con hash y sockets con conteo para
no publicar rutas ajenas. Conservar observaciones estructuradas en evidencia
.cache, además de los archivos propios de la raíz /tmp.

Una comparación igual no demuestra que el collector sea confiable. Revisar
fuentes, namespace/montaje/UID real y completitud del observador con evidencia
independiente; no usar booleans JSON como aceptación del perímetro.

## 4. Lifecycle sin PostgreSQL

Después del caso normal, ejecutar únicamente los casos nombrados en la
aprobación: LIFECYCLE_WAIT, deadline, cancelación por pipe e interrupción propia.
Node no señaliza PIDs; el controlador fija pidfd de su hijo Popen no recolectado,
comprueba identidad y envía TERM, luego KILL sólo al mismo descriptor si hace falta.
Sin pidfd o ante identidad perdida, preservar y detener; nunca kill por PID/nombre.

No confundir exit de bwrap con desaparición de todos los hijos. Exigir inspección
completa del namespace y ausencia de supervivientes. Una lectura denegada de
/proc, proceso no observado o inventario incompleto da UNVERIFIED. No excluir
procesos por UID para fabricar una prueba de ausencia.

La muerte del padre Node cierra su pipe; la interrupción del controlador solicita
terminación. --die-with-parent y la muerte del init del namespace son mecanismos
candidatos, no garantías WSL aceptadas. Muerte abrupta del controlador puede
impedir evidencia terminal: UNVERIFIED y recursos preservados. Recuperación
independiente/guardian no se declara operativa; no relanzar ni reconstruir una
señal a partir de un PID almacenado. Acreditar esa ruta por separado antes de
aceptar protección ante muerte abrupta.

Los límites RLIMIT del controlador/hijos no equivalen a un presupuesto agregado
cgroup aceptado. Acreditar su efecto real, conteo de descendientes y tiempo;
si el presupuesto exigido no puede garantizarse, detener el caso. No probar con
OOM ni provocar reinicio WSL.

## 5. PASS, FAIL, UNVERIFIED y conservación

- PASS: caso autorizado y esperado, identidad/boot/orden de evidencia coherentes,
  barreras acreditadas, salida/terminación esperada, árbol realmente vacío,
  host sin cambios atribuibles y evidencia durable completa antes/después.
- FAIL: evidencia completa acredita una desviación, por ejemplo acceso visible
  al host o terminación diferente a la esperada. No continuar con otro caso.
- UNVERIFIED: evidencia perdida/incompleta/no confiable, reinicio, fallo de
  adquisición, capacidades/visibilidad insuficientes, cierre no acreditado o
  autoridad perdida. Ausencia de error no sustituye PASS.

Los tests de P2 simulan estos resultados; no son PASS físicos de A0. No hay
limpieza automática en P2: root y evidencia se preservan incluso tras PASS.
La eliminación futura requiere autorización propia, inventario y handles
no-follow actuales, quiescencia y propietario acreditados. No rm recursivo,
pkill/killall, flush compartido o mount/unmount global. Si no se acredita,
no borrar. Cerrar sólo descriptores propios no es limpieza física del árbol.

Ante reboot detener toda reanudación automática; comparar boot ID y evidencia
antes de cualquier decisión humana posterior. No reutilizar PID/inode antiguos.
Si WSL limita aislamiento/pidfd/visibilidad, recomendar únicamente corregir la
capacidad concreta mediante una ruta revisada aparte, sin tocar el bind mount
WSL ni default, sin elevar privilegios o instalar componentes automáticamente.

## 6. Capacidades posteriores, sin promoción automática

| Capacidad         | Alcance futuro                         | Autorización actual                 |
| ----------------- | -------------------------------------- | ----------------------------------- |
| PROBE_ONLY        | Probes inocuos y lifecycle nombrados   | SOURCE-ONLY; ejecución pendiente    |
| POSTGRES_INIT     | initdb y control-data de cluster nuevo | No implementada ni autorizada en P2 |
| POSTGRES_CONNECT  | Postmaster e identidad SQL del cluster | No implementada ni autorizada en P2 |
| FIXTURE_AND_TESTS | Schema/fixture/transacciones           | No implementada ni autorizada en P2 |

Aceptar PROBE_ONLY no habilita ninguna fila siguiente. El inventario de fixture
P1 permanece histórico/intacto; P2 no amplía ni instala Core/Workspace. Los 50
Leads ficticios EVEN 25/25 continúan como meta posterior, sin autorización nueva.
