# DEMO-A5 · Presentación ejecutiva

La portada enlaza cinco interfaces de Twenty INCONNECT con datos ficticios. Las acciones se resuelven en memoria. La colección hereda de A4 la política CSP, el rechazo de GraphQL sin mock y el aislamiento de las historias.

## Ensayo y presentación

1. En WSL2, ejecuta el arranque desde cualquier directorio.

   ```bash
   bash /home/alberto/projects/twenty-inconnect/packages/twenty-front/.storybook-demo-a5/serve.sh
   ```

2. En Chrome de Windows, abre [Presentación → Inicio](http://127.0.0.1:6006/?path=/story/inconnect-presentacion--inicio). Sigue los enlaces numerados o usa la barra lateral.
3. Para repetir una acción, recarga la historia. Si quieres seguir el orden original, vuelve a **Presentación → Recorrido ejecutivo → Inicio** en la barra lateral. Consulta el [guion de diez minutos](GUION.md).
4. Detén el servidor con `Ctrl+C` en la terminal que lo inició.

El servidor escucha exclusivamente en `127.0.0.1:6006`. Si el puerto está ocupado, identifica el proceso con `ss -ltnp 'sport = :6006'` en WSL2. En Windows puedes consultar `Get-NetTCPConnection -LocalPort 6006 -State Listen` desde PowerShell. Si es una instancia anterior de Storybook, usa `Ctrl+C` en su terminal antes de volver a iniciar. Para otro proceso, coordina su cierre con quien lo inició.

Conserva el build A5 y el respaldo A4 en la máquina de presentación. Abre la portada y las cinco historias en un ensayo con Internet desconectado, manteniendo activo el acceso local de Windows a WSL2. Para presentar basta el build estático y el runtime local de WSL2. Las fuentes, estilos, imágenes de las historias y mocks necesarios se sirven localmente.

## Respaldo A4

Detén A5 y sirve el build A4 original con el mismo script.

```bash
bash /home/alberto/projects/twenty-inconnect/packages/twenty-front/.storybook-demo-a5/serve.sh a4
```

En A4, comienza por [Commercial Teams](http://127.0.0.1:6006/?path=/story/pages-settings-security-commercial-teams--demo) y sigue el guion desde la barra lateral. Los builds se sirven por turnos en el mismo puerto.

## Reconstruir A5 en WSL2

Esta operación requiere las dependencias Linux ya instaladas. Usa una compilación sin red y escribe sólo en la salida de A5.

```bash
cd /home/alberto/projects/twenty-inconnect
. "$HOME/.nvm/nvm.sh"
nvm use
demo_out="$PWD/.cache/demo-a5-executive/validated-storybook"
cd packages/twenty-front
env NODE_ENV=production STORYBOOK_SCOPE=inconnect-commercial-teams \
  STORYBOOK_DISABLE_TELEMETRY=1 STORYBOOK_ENABLE_CRASH_REPORTS=0 \
  REACT_APP_SERVER_BASE_URL=http://127.0.0.1:65534 VITE_HOST=127.0.0.1 \
  SSL_CERT_PATH= SSL_KEY_PATH= ANALYZE=false NODE_OPTIONS=--max-old-space-size=4096 \
  unshare -Urn ../../node_modules/.bin/storybook build --test \
    --config-dir .storybook-demo-a5 --disable-telemetry --output-dir "$demo_out"
```

[Inventario y comandos Git para revisión manual](GIT.md)
