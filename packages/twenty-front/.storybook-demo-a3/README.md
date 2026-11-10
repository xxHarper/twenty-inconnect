# DEMO-A3 · INCONNECT Messaging

La colección incluye la bandeja real de Messaging y las historias de Commercial Teams, Record Access y Roles de Twenty. El directorio de salida pertenece a DEMO-A3.

## Compilar desde WSL2

```bash
cd /home/alberto/projects/twenty-inconnect
. "$HOME/.nvm/nvm.sh"
nvm use
demo_out="$PWD/.cache/demo-a3-messaging/validated-storybook"
cd packages/twenty-front
env NODE_ENV=production STORYBOOK_SCOPE=inconnect-commercial-teams \
  STORYBOOK_DISABLE_TELEMETRY=1 STORYBOOK_ENABLE_CRASH_REPORTS=0 \
  REACT_APP_SERVER_BASE_URL=http://127.0.0.1:65534 \
  VITE_HOST=127.0.0.1 SSL_CERT_PATH= SSL_KEY_PATH= ANALYZE=false \
  NODE_OPTIONS=--max-old-space-size=4096 \
  unshare -Urn ../../node_modules/.bin/storybook build --test \
    --config-dir .storybook-demo-a3 --disable-telemetry --output-dir "$demo_out"
```

## Servir en loopback

```bash
cd /home/alberto/projects/twenty-inconnect
. "$HOME/.nvm/nvm.sh"
nvm use
node - "$PWD/.cache/demo-a3-messaging/validated-storybook" <<'NODE'
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

Abre [INCONNECT Messaging → Demo](http://127.0.0.1:6006/?path=/story/pages-inconnect-messaging--demo) en Windows. Usa `Ctrl+C` en la terminal WSL2 para detener el servidor.

## Recorrido de la demo

1. Abre All y localiza Comercio Demo · Norte. Verás el historial, una ficha ilustrativa incluida en la historia y el contexto del Lead ficticio.
2. Alterna Unread, Favorites y Pending. Los filtros y la búsqueda se combinan. Norte comienza como no leído y pasa a leído al abrirlo en una pestaña visible. Sur empieza como favorito y Centro como pendiente.
3. Usa los controles originales para cambiar Favorito, No leído y Pending. La lectura afecta al usuario simulado y Pending cambia manualmente.
4. Recarga la historia para restablecer las conversaciones y sus estados iniciales.

El composer refleja capacidades deshabilitadas. El historial y la ficha son ficticios. Apollo resuelve las operaciones en memoria. La colección A3 usa el reloj del navegador para que se ejecuten la búsqueda y las actualizaciones diferidas de la bandeja. El perfil de demo mantiene deshabilitada la conexión en tiempo real. La historia sólo incluye Leads vinculados de ejemplo. Quedan fuera el triage, la autorización del servidor y Attention R4.
