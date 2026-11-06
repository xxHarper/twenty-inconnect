# STAGING-S2 · Build de Twenty INCONNECT

Preparación de fuente, 5 de noviembre de 2026. La fuente de producto es
`51ead3881fa18ccc0feb1d0afe8e1dd46483c27a` (STAGING-S0), descendiente de
`24deec2f970d1d0369beb4c331b8e185c67cccd9` (INSTALL-F1). Las herramientas S2 se
registran por hash aparte. Las instrucciones de ejecución son para el operador
en una ventana de build e importación autorizada. Terminan con la imagen cargada
e inspeccionada, antes de crear contenedores de Twenty.

## Receta seleccionada

El [Dockerfile oficial del checkout](../twenty/Dockerfile) define el target
`twenty`. Su contexto tiene la estructura de la raíz del monorepo. S2 deriva
una receta de ese archivo en un directorio separado y conserva las compilaciones
Nx/Lingui, Nest/SWC y Vite, el punto de entrada y el contrato de runtime. Se
verifican los hashes de la receta upstream y de `yarn.lock` antes de derivarla.
Revisar la diferencia generada en cada cambio de SHA.

| Entrada o salida | Configuración |
| --- | --- |
| Base de las etapas alcanzables | `node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436`. Registrar el manifiesto de la plataforma efectiva. |
| Yarn | Release versionada `4.13.0`, SHA-256 `730e0619753d39754c9e7613c7e57f084ea18b3244f5ba9a5a60bd3da048450b`. La receta invoca esa release y usa el mismo ejecutable al llamar a `yarn` desde la imagen. |
| Dependencias JS | Lock SHA-256 `472cf6982919d1c7afe1fb54acebc9fe1d4fa14add05ddb806b01006e5a3e568`, parches del checkout y artefactos para Linux musl. El frontend usa React, Vite, Lingui, UI, Shared, SDK y el renderer. El backend usa Nest, TypeORM parcheado en 0.3.31, pg, Redis/BullMQ, Shared, Emails y Client SDK. |
| Dependencias de sistema | APK firmados para Alpine 3.23 y la arquitectura elegida. Se conservan los mínimos oficiales de curl, nghttp2-libs, libcrypto3, libssl3 y postgresql18-client, y el requisito de jq. La clausura exacta queda fijada por archivo y SHA-256. |
| Imagen final | `APP_VERSION=2.32.0` (versión Core), UID `1000`, `NODE_ENV=production`, `WORKDIR=/app/packages/twenty-server`. Incluye el backend compilado, frontend en `dist/front`, assets de Nest, dependencias de producción raíz y de cada workspace runtime, Yarn, parches y el script de upgrade referenciado por el package. Se conservan los source maps del backend. |

Se comprueba el workspace completo con `yarn install --immutable --mode=skip-build`.
Los tres `workspaces focus` (frontend, backend, producción) preservan la
selección oficial. El guard de Yarn compara los descriptores externos resueltos
en memoria y sus checksums con el lock. Para paquetes opcionales deshabilitados
por plataforma exige la resolución fijada y coteja el checksum cuando Yarn
reporta uno. `persistProject: false` explica por qué verificar sólo el hash del
lock antes y después de `focus` sería insuficiente. Las compilaciones Nx se
ejecutan sin red, con caché remota deshabilitada y sin aceptar `build/` del
host. El preflight completo y las herramientas de compilación quedan en
etapas intermedias. La receta de staging usa los APK del directorio aprobado
sin red, sin repositorio de fallback y con las firmas de la base.

La ruta del frontend carga `InconnectLeadManagementPage` y consume
`inconnectLeadPoolCatalog`. En el servidor, el motor de metadata importa
los módulos INCONNECT de Lead Management y Messaging. La compilación toma el
árbol de backend del mismo SHA. En ese árbol
`run-instance-commands.command.ts` llama a `runLegacyCoreMigrations`, que
crea un DataSource temporal sin entidades ni instalación de extensiones.
La receta comprueba presencia de ambos módulos, la llamada y el helper de
INSTALL-F1 y una operación del frontend en sus artefactos finales. También
comprueba Node, Yarn y Alpine y resuelve las dependencias directas críticas
desde el `WORKDIR` con `require.resolve`, sin importarlas. Estos
marcadores acreditan empaquetado y no prueban DI, permisos, instalación ni
ejecución. [INSTALL-F1](../../twenty-server/docs/INCONNECT_INSTALL_F1.md)

## Lugar del primer build

Construir en un host Linux nativo de la misma arquitectura que la VM y
transferir el archivo por un canal de transferencia aprobado. Usar un builder
dedicado con red de build aprobada, idealmente con al menos 16 GiB de RAM
disponibles para el trabajo. El heap del frontend admite hasta 8 GiB, además
de procesos Nx/Vite, dependencias nativas, Docker y cachés. La VM tiene 4
vCPU, ~12 GB totales y ~84 GB libres según el inventario previo a imágenes y
volúmenes. Comparte memoria y disco con los dos almacenes activos. El WSL
inspeccionado en S2 reportó 7.2 GiB totales, por lo que tampoco se recomienda
para el primer build con sus recursos actuales. Construir en la VM sólo
sería una opción bajo una autorización posterior, con presupuesto de
recursos y conectividad de build revisados. No se necesita conectividad de
build en la VM para la importación.

### 1. Preparar el contexto en el host de build

Requisitos del host de build: Bash, Git con el objeto del commit, Python 3.9+,
GNU tar y Docker con Buildx. Para obtener el código y las herramientas S2 en
otro host, el operador usa su canal aprobado de copia de fuente; el generador
necesita el objeto Git de origen disponible. Confirmar `uname -m` en la
consola de Proxmox antes de elegir la plataforma. Los ejemplos usan
`linux/amd64` para una VM `x86_64`; para `aarch64` se usa `linux/arm64` y se
requieren builder nativo, manifiesto y APK compatibles.

Ejecutar desde la raíz del checkout en una sesión Bash de build. Se puede
exportar `STAGING_S2_ARTIFACTS` a un directorio absoluto con espacio suficiente
fuera del checkout y de `/tmp` si éste es tmpfs.

```bash
set -euo pipefail
umask 077
sha=51ead3881fa18ccc0feb1d0afe8e1dd46483c27a
install_f1=24deec2f970d1d0369beb4c331b8e185c67cccd9
version=2.32.0
platform=linux/amd64
image="twenty-inconnect-staging:$sha"
case "$platform:$(uname -m)" in
  linux/amd64:x86_64|linux/arm64:aarch64) ;;
  *) echo 'El builder debe ser nativo para la plataforma elegida' >&2; exit 1 ;;
esac
s2=packages/twenty-docker/inconnect-staging
upstream_dockerfile=packages/twenty-docker/twenty/Dockerfile
git show -s --format='%H %s' "$sha" "$install_f1"
git merge-base --is-ancestor "$install_f1" "$sha"
git status --short
out=$(mktemp -d "${STAGING_S2_ARTIFACTS:-$HOME}/inconnect-s2.XXXXXX")
git show -s --format='%H %ct %s' "$sha" > "$out/source.txt"
epoch=$(git show -s --format=%ct "$sha")
sha256sum "$s2/prepare-staging-build.py" "$s2/staging-lock-guard.cjs" > "$out/tooling.sha256"
python3 "$s2/prepare-staging-build.py" "$out/context" | tee "$out/context.log"
diff -u "$out/context/$upstream_dockerfile" "$out/context/.staging-s2/Dockerfile" \
  > "$out/dockerfile.diff" || test "$?" -eq 1
(
  cd "$out/context"
  find . -type f -print | LC_ALL=C sort > "$out/context.paths"
  sha256sum yarn.lock "$upstream_dockerfile" .staging-s2/Dockerfile \
    .yarn/releases/yarn-4.13.0.cjs > "$out/inputs.sha256"
  tar --format=gnu --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner \
    -cf "$out/context.tar" .
)
sha256sum "$out/context.tar" > "$out/context.sha256"
printf 'Directorio de evidencia: %s\n' "$out"
```

Revisar `context.paths` y `dockerfile.diff` antes de seguir. El generador
selecciona fuente versionada de ocho paquetes, los manifiestos requeridos por
el lock completo y la configuración versionada del build. No lee el contenido
local del worktree para esos archivos. Filtra dotenv y corta ante entradas
sospechosas, enlaces o outputs inesperados. Las dos hojas CSS versionadas de
`twenty-ui/dist` se conservan como entradas upstream. La selección de contexto
hace innecesaria otra `.dockerignore`. El inventario y el diff también permiten
detectar archivos versionados con nombres inocuos que deban excluirse antes
de enviar el contexto al builder.

### 2. Verificar las dependencias externas y crear el builder

La VM de staging no participa en este paso. Se requieren tres entradas
operativas aprobadas:

- `STAGING_BUILDKIT_IMAGE` es la referencia completa con digest de la imagen
  del daemon BuildKit compatible con Buildx y con `rewrite-timestamp`.
- `STAGING_APK_DIR` es el directorio absoluto con los APK oficiales firmados
  de la clausura mínima para la base y arquitectura revisadas. Prepararlo
  en el entorno de adquisición, a partir de un snapshot de Alpine 3.23
  aprobado. Incluir dependencias transitivas requeridas que falten en la
  base y usar versiones compatibles con los mínimos del Dockerfile. Separar
  cualquier candidato de la clausura aprobada.
- `STAGING_APK_SUMS` es el archivo de checksums aprobado por un canal de
  confianza. Usa el formato de `LC_ALL=C sha256sum -- *.apk` dentro del
  directorio, en orden por nombre. Conservar el bundle, la procedencia del
  snapshot y este manifiesto para el siguiente build.

Para obtener candidatos en el entorno Alpine 3.23 autorizado, usar un
archivo de repositorios que apunte al snapshot aprobado. La descarga escribe
sólo en el directorio de candidatos. Cotejar versiones y firmas con el
snapshot, comparar con el inventario de la base y aprobar la clausura
necesaria antes de usarla como `STAGING_APK_DIR`.

```bash
: "${STAGING_ALPINE_SNAPSHOT_REPOS:?falta el archivo del snapshot aprobado}"
apk_candidate=$(mktemp -d)
apk --repositories-file "$STAGING_ALPINE_SNAPSHOT_REPOS" fetch --recursive \
  --output "$apk_candidate" 'curl>=8.20.0-r0' 'nghttp2-libs>=1.69.0-r0' \
  'libcrypto3>=3.5.7-r0' 'libssl3>=3.5.7-r0' 'postgresql18-client>=18.4-r0' jq
(cd "$apk_candidate"; export LC_ALL=C; sha256sum -- *.apk) > "$apk_candidate.sha256"
```

El registro autorizado de la base, el del daemon y el registro de Yarn
son entradas del host de build. La descarga JS está sujeta al lock y al guard
de checksum. Usar un entorno limpio de configuración de Docker, de proxy y de
registro. Usar endpoints aprobados y sin credenciales dentro del contexto,
argumentos, URLs o logs. `imagetools inspect --raw` consulta metadatos del
registro desde el host de build, sin cargar la imagen en el motor.

```bash
: "${STAGING_BUILDKIT_IMAGE:?falta referencia aprobada por digest}"
: "${STAGING_APK_DIR:?falta bundle APK aprobado}"
: "${STAGING_APK_SUMS:?falta manifiesto de checksums aprobado}"
[[ "$STAGING_BUILDKIT_IMAGE" =~ ^[a-zA-Z0-9._/:-]+@sha256:[a-f0-9]{64}$ ]]
mkdir "$out/apk"
(
  shopt -s nullglob
  files=("$STAGING_APK_DIR"/*.apk)
  test "${#files[@]}" -gt 0
  for apk in "${files[@]}"; do
    test -f "$apk" && test ! -L "$apk" || exit 1
    cp -- "$apk" "$out/apk/"
  done
)
(cd "$out/apk"; export LC_ALL=C; sha256sum -- *.apk) > "$out/apk.actual.sha256"
cmp "$STAGING_APK_SUMS" "$out/apk.actual.sha256"
cp "$out/apk.actual.sha256" "$out/apk/SHA256SUMS"

build_context=${STAGING_BUILD_DOCKER_CONTEXT:-default}
endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}' "$build_context")
[[ "$endpoint" == unix:///* ]]
docker_build=(docker --context "$build_context")
base=$(awk '$1=="FROM" && $4=="front-deps" {print $2}' "$out/context/$upstream_dockerfile")
"${docker_build[@]}" buildx imagetools inspect --raw "$base" > "$out/base.index.json"
python3 - "$out/base.index.json" "${base##*@}" "$platform" <<'PY' > "$out/base.platform-digest"
import hashlib
import json
from pathlib import Path
import sys
path, expected, platform = sys.argv[1:]
raw = Path(path).read_bytes()
if expected not in ('sha256:' + hashlib.sha256(data).hexdigest() for data in (raw, raw.removesuffix(b'\n'))):
    raise SystemExit('El índice de la base no corresponde al pin')
os, arch = platform.split('/')
entries = [m['digest'] for m in json.loads(raw)['manifests']
           if m.get('platform', {}).get('os') == os and
           m.get('platform', {}).get('architecture') == arch]
if len(entries) != 1:
    raise SystemExit('Se requiere un manifiesto inequívoco para la plataforma')
print(entries[0])
PY

builder="inconnect-${out##*.}"
cat > "$out/buildkitd.toml" <<'TOML'
[worker.oci]
  max-parallelism = 1
TOML
printf '%s %s\n' "$build_context" "$endpoint" | tee "$out/docker-context.txt"
"${docker_build[@]}" buildx version | tee "$out/buildx.version"
"${docker_build[@]}" version > "$out/docker.version"
printf '%s\n' "$STAGING_BUILDKIT_IMAGE" > "$out/buildkit-image.txt"
"${docker_build[@]}" buildx create --name "$builder" --driver docker-container \
  --driver-opt "image=$STAGING_BUILDKIT_IMAGE" --buildkitd-config "$out/buildkitd.toml" "$build_context"
"${docker_build[@]}" buildx inspect "$builder" --bootstrap | tee "$out/builder.txt"
df -h "$out" | tee "$out/space.before.txt"
```

Conservar la evidencia del builder y revisar la arquitectura y la versión
efectivas. Usar la imagen base y el daemon por digest. El índice de la base
identifica el conjunto y `base.platform-digest` identifica el miembro que
debe usar BuildKit. [BuildKit y paralelismo](https://docs.docker.com/build/buildkit/configure/) ·
[Driver docker-container](https://docs.docker.com/build/builders/drivers/docker-container/)

### 3. Construir y verificar el artefacto local

En la misma sesión Bash. El primer intento debe mostrar cuatro verificaciones
de lock (preflight completo y tres focus), el inventario instalado por APK,
la compilación de Vite y Nest y `STAGING-S2 compiled markers verified`.
La salida se exporta como un único tar importable por Docker, sin registry
push. El perfil de build no usa el Compose.

```bash
apk_sha=$(sha256sum "$out/apk.actual.sha256" | cut -d' ' -f1)
context_sha=$(sha256sum "$out/context.tar" | cut -d' ' -f1)
recipe_sha=$(sha256sum "$out/context/.staging-s2/Dockerfile" | cut -d' ' -f1)
base_digest=$(cat "$out/base.platform-digest")

set +e
"${docker_build[@]}" buildx build --builder "$builder" --platform "$platform" --no-cache \
  --target twenty --file .staging-s2/Dockerfile --progress plain \
  --build-context "staging-apk=$out/apk" \
  --build-arg "APP_VERSION=$version" --build-arg "SOURCE_DATE_EPOCH=$epoch" \
  --build-arg "STAGING_APK_SHA256=$apk_sha" \
  --label "org.opencontainers.image.source=https://github.com/xxHarper/twenty-inconnect" \
  --label "org.opencontainers.image.revision=$sha" \
  --label "org.opencontainers.image.version=$version" \
  --label "org.opencontainers.image.base.digest=$base_digest" \
  --label "io.inconnect.staging.context.sha256=$context_sha" \
  --label "io.inconnect.staging.recipe.sha256=$recipe_sha" \
  --label "io.inconnect.staging.apk.sha256=$apk_sha" \
  --tag "$image" --provenance=false --sbom=false \
  --metadata-file "$out/build-metadata.json" \
  --output "type=docker,oci-mediatypes=true,rewrite-timestamp=true,dest=$out/image.tar" \
  - < "$out/context.tar" 2>&1 | tee "$out/build.log"
build_status=("${PIPESTATUS[@]}")
set -e
printf '%s\n' "${build_status[@]}" > "$out/build.exit"
df -h "$out" | tee "$out/space.after.txt"
test "${build_status[0]}" -eq 0 && test "${build_status[1]}" -eq 0 || exit 1
test "$(grep -c 'STAGING-S2 lock verified: [0-9]' "$out/build.log")" -eq 4
grep -q 'STAGING-S2 compiled markers verified$' "$out/build.log"

python3 - "$out" "$sha" "$platform" "$base_digest" "$context_sha" "$recipe_sha" "$apk_sha" \
  <<'PY' > "$out/image.identity"
import hashlib
import json
from pathlib import Path
import sys
import tarfile

out, revision, platform, base, context, recipe, apk = sys.argv[1:]
out = Path(out)
metadata = json.loads((out / 'build-metadata.json').read_bytes())
digest = metadata['containerimage.digest']
image_id = metadata['containerimage.config.digest']

with tarfile.open(out / 'image.tar') as archive:
    members = {m.name.removeprefix('./'): m for m in archive.getmembers()}

    def read_json(name):
        return json.loads(archive.extractfile(members[name]).read())

    def read_blob(ref):
        algorithm, value = ref.split(':', 1)
        assert algorithm == 'sha256', ref
        content = archive.extractfile(members[f'blobs/sha256/{value}']).read()
        assert hashlib.sha256(content).hexdigest() == value, ref
        return json.loads(content)

    index = read_json('index.json')
    assert {m['digest'] for m in index['manifests']} == {digest}, index
    manifest = read_blob(digest)
    assert manifest['config']['digest'] == image_id, manifest['config']
    config = read_blob(image_id)
    assert f"{config['os']}/{config['architecture']}" == platform, config['architecture']
    runtime = config['config']
    labels = runtime['Labels']
    assert labels['org.opencontainers.image.source'] == 'https://github.com/xxHarper/twenty-inconnect'
    assert labels['org.opencontainers.image.revision'] == revision
    assert labels['org.opencontainers.image.base.digest'] == base
    assert labels['io.inconnect.staging.context.sha256'] == context
    assert labels['io.inconnect.staging.recipe.sha256'] == recipe
    assert labels['io.inconnect.staging.apk.sha256'] == apk
    assert runtime['Entrypoint'] == ['/app/entrypoint.sh']
    assert runtime['Cmd'] == ['node', 'dist/main']
    assert runtime['WorkingDir'] == '/app/packages/twenty-server'
    assert runtime['User'] == '1000'
    assert 'APP_VERSION=2.32.0' in runtime['Env']
    assert 'NODE_ENV=production' in runtime['Env']

print(revision)
print(platform)
print(image_id)
print(digest)
PY
cat "$out/image.identity"
(cd "$out"; sha256sum image.tar image.identity build-metadata.json > transfer.sha256)
```

Las cuatro líneas de `image.identity` son SHA Git, plataforma, ID de imagen
(hash del JSON de configuración) y digest del manifiesto OCI (hash del
manifiesto con descriptores de configuración y capas). El SHA-256 de
`image.tar` protege el archivo transferido. Un tag puede reasignarse y el
campo local `RepoDigests` puede quedar vacío después de una carga por tar.
Guardar el manifiesto en el archivo y la metadata de BuildKit como evidencia.
La disponibilidad de `repo:tag@sha256:…` en el motor para el Compose S0 es
un requisito separado de la futura fase de arranque. Los archivos de
evidencia, los digests de entradas y los timestamps normalizados preparan la
repetición. Acreditar igualdad binaria exige un segundo build limpio con las
mismas entradas y comparación de manifiestos.
[Exportadores de Docker](https://docs.docker.com/build/exporters/oci-docker/) ·
[Metadata de Buildx](https://docs.docker.com/reference/cli/docker/buildx/build/#metadata-file)

### 4. Transferir e inspeccionar en la VM

Copiar desde el host de build al medio de transferencia autorizado. Conservar
también `transfer.sha256` o su hash en un canal independiente. El directorio
de evidencia completo permanece en el host de build.

```bash
: "${STAGING_TRANSFER_DIR:?falta directorio del medio autorizado}"
cp -- "$out"/{image.tar,image.identity,build-metadata.json,transfer.sha256} "$STAGING_TRANSFER_DIR/"
```

En la consola de la VM, usar una sesión Bash y el directorio donde se recibieron
los archivos. Si el tag ya existe con otro ID, detenerse para conservarlo.

```bash
set -euo pipefail
: "${STAGING_RECEIVED_DIR:?falta el directorio de recepción}"
cd "$STAGING_RECEIVED_DIR"
sha256sum -c transfer.sha256
mapfile -t identity < image.identity
sha=51ead3881fa18ccc0feb1d0afe8e1dd46483c27a
test "${identity[0]}" = "$sha"
platform=${identity[1]}
expected_id=${identity[2]}
expected_digest=${identity[3]}
case "$platform:$(uname -m)" in
  linux/amd64:x86_64|linux/arm64:aarch64) ;;
  *) echo 'Plataforma incompatible' >&2; exit 1 ;;
esac
image="twenty-inconnect-staging:$sha"
df -h .
if existing=$(docker --context default image inspect --format '{{.Id}}' "$image" 2>/dev/null); then
  test "$existing" = "$expected_id"
fi
docker --context default image load --platform "$platform" --input image.tar
test "$(docker --context default image inspect --format '{{.Id}}' "$image")" = "$expected_id"
test "$(docker --context default image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = "$platform"
test "$(docker --context default image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$sha"
docker --context default image inspect --format 'ID={{.Id}} RepoDigests={{json .RepoDigests}} Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}} User={{.Config.User}}' "$image"
printf 'Digest del manifiesto en el archivo verificado: %s\n' "$expected_digest"
```

La coincidencia del archivo, ID, revisión y plataforma cierra la verificación
de importación. Detenerse aquí. [Docker image load](https://docs.docker.com/reference/cli/docker/image/load/)

## Punto de parada y recuperación

El entrypoint heredado consulta si existe `core` con `psql` si
`DISABLE_DB_MIGRATIONS` difiere de `true`. Puede ejecutar `database:init:prod`,
luego `cache:flush`, `upgrade` y otro `cache:flush`. El script puede continuar
tras avisos de error de caché, upgrade o registro de cron. Independientemente,
`DISABLE_CRON_JOBS_REGISTRATION=true` omite `cron:register:all`. El shell
termina con `exec "$@"` aun con las dos variables en `true`. Con el CMD oficial
eso ejecuta `node dist/main` e inicializa Nest, dependencias de aplicación,
sesiones, configuración del frontend y HTTP. El worker oficial usa otro CMD
con el mismo entrypoint. El override deliberado del [Compose S0](compose.staging.yml)
termina con `exit 1` y `command: []`. Mantener `staging-app-blocked` y todos
los gates de instalación y activación. Los almacenes existentes no forman
parte del build ni de la verificación.

| Si falla | Recuperación |
| --- | --- |
| Digest, contexto o plataforma | Parar, conservar evidencia y reconstruir el contexto en un directorio nuevo del mismo SHA. Revisar el pin con el operador si el registro no lo sirve. |
| Lock, checksum, APK o add-on musl | Conservar salida y etapa fallida. Revisar la release de Yarn, parches, clausura y firma del snapshot, arquitectura y acceso al registro aprobado. Si hay un cambio real de dependencia, requiere nueva revisión. No regenerar el lock ni aceptar un paquete sin la comprobación. |
| OOM, espacio o tiempo | Guardar salida e inventario del builder, repetir con más capacidad en un host separado. No hacer `prune` general, alterar volúmenes de staging ni arrancar la aplicación para probar. Usar un directorio nuevo para evitar confundir un tar parcial con uno completo. |
| Tar, metadata o ID discrepante | Conservar la imagen existente y la copia discrepante. Repetir transferencia del tar aprobado y validar el checksum antes de cargar de nuevo. |

INSTALL-F1 sigue siendo SOURCE-ONLY. El bootstrap, el CMD directo y el primer
HTTP, el worker/cron, F13, Attention, PG0/PG1, Stage C5, exact-upgrade, PHYS-P2 y
cualquier registro o instalación del Store LeadPool siguen fuera de esta fase.

## Evidencia de esta preparación

Se verificó el historial de Git en modo lectura, la materialización desde el
SHA de producto, los hashes, la carga del plugin con Yarn 4.13.0 y la sintaxis
del entrypoint oficial. Una prueba offline con un paquete cacheado verificó
`install --immutable` y `focus --production`, y detectó la eliminación
del checksum del lock. En el contexto completo, una prueba diagnóstica sin
red ni hardened mode pasó la validación de resolución inmutable y se detuvo
en Fetch por caché vacía. El build conserva hardened mode. El procedimiento de build y transferencia se entrega
para ejecución por el operador. Quedan pendientes la resolución física del
manifiesto de la base y del builder, la aprobación del bundle APK y el primer
build Linux musl, exportación y carga en la VM.
