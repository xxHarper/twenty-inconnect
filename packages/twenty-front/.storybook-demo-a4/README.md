# DEMO-A4 · Distribuidor de Leads

Storybook reúne Commercial Teams, Record Access, Roles, INCONNECT Messaging y Lead Management. Las historias usan las pantallas del checkout y datos ficticios.

## Abrir en Windows

En WSL2, sirve el build estático en loopback.

```bash
bash /home/alberto/projects/twenty-inconnect/.cache/demo-a4-lead-management/serve.sh
```

En Chrome abre [Lead Management → Demo](http://127.0.0.1:6006/?path=/story/pages-inconnect-lead-management--demo). Usa `Ctrl+C` en WSL2 para detener el servidor.

## Recorrido

1. Selecciona **Leads · Equipo Demo** como origen y pulsa **Consultar Leads**.
2. Usa las casillas individuales, **Añadir esta página a la selección** o **Seleccionar primeros 50 elegibles**. Comprueba que el contador indique 50 seleccionados.
3. Elige **EVEN**, marca los dos ejecutivos y pulsa **Obtener vista previa**. El resultado propone **25 Leads por ejecutivo**, con **40 propietarios conservados, 10 cambios previstos y cero procesados**.
4. Para probar otra estrategia, pulsa **Cancelar registros pendientes** y **Nueva selección**. Vuelve a consultar y seleccionar los Leads. **SINGLE** permite proponer los 50 para un ejecutivo. En **MANUAL_QUOTAS** puedes probar 30/20 o dejar parte de la selección sin asignar.
5. Recarga para empezar de nuevo. La colección también incluye [Storage Unavailable](http://127.0.0.1:6006/?path=/story/pages-inconnect-lead-management--storage-unavailable), que presenta el aviso original y bloquea la vista previa.

El planificador puro del MVP calcula la propuesta con datos en memoria. La confirmación está deshabilitada y el mock rechaza la operación de ejecución. La cancelación y la consulta por identificador funcionan sólo en la sesión de Storybook. El MVP sigue **ACCEPTED SOURCE-ONLY**. La instalación del Store y la validación física de persistencia, autorización y transferencia siguen pendientes.

## Volver a compilar

Con las dependencias WSL ya instaladas, usa una compilación sin red y una salida propia de A4.

```bash
cd /home/alberto/projects/twenty-inconnect
. "$HOME/.nvm/nvm.sh"
nvm use
demo_out="$PWD/.cache/demo-a4-lead-management/validated-storybook"
cd packages/twenty-front
env NODE_ENV=production STORYBOOK_SCOPE=inconnect-commercial-teams \
  STORYBOOK_DISABLE_TELEMETRY=1 STORYBOOK_ENABLE_CRASH_REPORTS=0 \
  REACT_APP_SERVER_BASE_URL=http://127.0.0.1:65534 VITE_HOST=127.0.0.1 \
  SSL_CERT_PATH= SSL_KEY_PATH= ANALYZE=false NODE_OPTIONS=--max-old-space-size=4096 \
  unshare -Urn ../../node_modules/.bin/storybook build --test \
    --config-dir .storybook-demo-a4 --disable-telemetry --output-dir "$demo_out"
```

Si el script local de arranque no está disponible, sirve el mismo directorio estático con su política CSP.

```bash
cd /home/alberto/projects/twenty-inconnect
. "$HOME/.nvm/nvm.sh"
nvm use
node - "$PWD/.cache/demo-a4-lead-management/validated-storybook" <<'NODE'
const { readFileSync } = require('node:fs');
const { createServer } = require('http-server');
const root = process.argv[2];
const [, policy] = readFileSync(root + '/iframe.html', 'utf8')
  .match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
createServer({
  root,
  showDir: false,
  cache: -1,
  headers: { 'Content-Security-Policy': policy },
}).listen(6006, '127.0.0.1', () => console.log('Storybook http://127.0.0.1:6006'));
NODE
```
