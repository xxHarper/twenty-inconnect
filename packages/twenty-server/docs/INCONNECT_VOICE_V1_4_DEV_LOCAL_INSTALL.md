# Voice V1.4 en DEV-LOCAL-R1 — instalación y piloto

La operación vigente de Inbound y Outbound utiliza los
[controles persistentes de Voice V2](INCONNECT_VOICE_V2_DEV_LOCAL_INSTALL.md#controles-persistentes).
Los comandos de este documento registran la operación de V1.4.

## Modo persistente de desarrollo

El 26 de noviembre de 2026 el operador autorizó mantener Voice Outbound
habilitado en DEV-LOCAL-R1 durante el desarrollo, hasta solicitar su
desactivación. Este modo conserva un único operador, México como único
país admitido y `5514552571` como único destino autorizado. Las llamadas
se confirman manualmente con **Place call** en Twenty. El observador y
las ventanas individuales pasan a ser herramientas de diagnóstico
opcionales. La autorización se limita a este entorno de desarrollo.
PHYS-A0 sigue **NO-GO**.

Desde WSL, con los servicios dedicados ya arrancados:

```bash
voice_dev=/home/alberto/projects/twenty-inconnect/.cache/inconnect-voice-v1.4/sync-pilot/voice-dev.py
python3 "$voice_dev" status
python3 "$voice_dev" enable
python3 "$voice_dev" disable
```

`status` coteja `app.env` y el proceso en 33000, comprueba NestJS,
Nginx, Cloudflare y la TwiML App mediante lectura, y devuelve el estado
autenticado del operador seleccionado. `enable` verifica el destino,
la sincronización, el rechazo de callbacks sin firma y la ausencia de
llamadas activas. Persiste el flag y reinicia solo NestJS si corresponde.
Comprueba por lookup que el destino se puede marcar en el escenario
vigente, sin generar una intención de llamada. `disable` comprueba
ausencia de llamadas activas, persiste `false` y reinicia solo NestJS
si corresponde. El reinicio arranca con los límites de DEV-LOCAL-R1 y
con el valor persistente. Las herramientas históricas que fuerzan
Outbound a `false` quedan reservadas para sus procedimientos de cierre.

Después de reiniciar la computadora, ejecutar `status` antes de marcar.
Si NestJS arrancó con `false` y la configuración sigue habilitada, usar
`enable` tras verificar que el Quick Tunnel y la TwiML App coincidan.
Un hostname nuevo requiere la autorización específica para actualizar
la URL de `app.env` y `VoiceUrl` por POST. El comando de desarrollo
consulta Twilio únicamente mediante GET.

### Resultado del cierre del 26 de noviembre de 2026

Voice Test realizó una llamada manual al destino aprobado. El backend
registró `finished` / `answered` con 18 s confirmados y dos tramos,
`browser` y `destination`. `objectMetadataId` y `recordId` quedaron
nulos. Recents autenticado de Voice Test devolvió esa misma llamada,
resultado y duración. El inventario de Leads coincidió con el respaldo
y los nueve intentos anteriores conservaron sus asociaciones y tramos.

`finish-test` deshabilitó la salida, restauró el teléfono principal a
`5514552571` mediante Twenty y devolvió el selector al administrador
original. Después reanudó Outbound persistente con el administrador.
El archivo y el proceso de Nest quedaron en `true`, el estado autenticado
devolvió HTTP 200 `ready` y el lookup devolvió una coincidencia con
marcación vinculada disponible. Se verificaron 10 intentos, 20 tramos,
364 s confirmados y cero llamadas activas. Calls y Recents del
administrador mostraron los nueve intentos vinculados. La llamada del
piloto siguió persistida sin asociación, aislada de ese historial.

El administrador confirmó la remarcación manual desde **Recents → Redial
→ Place call**. El intento quedó `finished` / `answered`, con 8 s de
conexión confirmada y los tramos `browser` y `destination` correlacionados
como padre e hijo. El destino se conectó a las 11:06:10, hora de Ciudad
de México. PostgreSQL confirmó ambos identificadores del Lead original.
Calls y Recents autenticados devolvieron el mismo resultado y duración.
Al cierre se verificaron 11 intentos, 22 tramos, 372 s confirmados y
cero llamadas activas. La llamada sin Lead sigue persistida por separado.
Outbound permanece en `true` en el archivo y en Nest, con HTTP 200 `ready`
para el administrador original. Voice V1.4 queda funcionalmente validado
en DEV-LOCAL-R1. Sigue pendiente la recepción remota de DTMF. Las llamadas
vinculadas permanecen en Calls según los permisos cuando un cambio del
teléfono del Lead impide su coincidencia histórica en Recents.

### Prueba temporal sin Lead

Se cerró la ventana supervisada de Redial. El API del administrador
original devolvió HTTP 200 `disabled`, con nueve intentos, 18 tramos,
346 s confirmados y cero llamadas activas. La última llamada persistida
fue la llamada vinculada de 42 s. Aquella ventana cerró sin un intento
nuevo. La remarcación se acreditó después en el modo persistente.

Con Outbound deshabilitado se verificó que Voice Test es el único
miembro de `Voice Pilot — DEV`, con `DIAL_INCONNECT_VOICE` y
`READ_UNLINKED_INCONNECT_VOICE_HISTORY` como permisos independientes y
Lead en `ownRecords` bajo MANAGED. Tras descartar conflicto y triggers
externos, Twenty recibió solo el cambio temporal del teléfono principal
del Lead a `5514552572`. La búsqueda autorizada del destino `5514552571`
devolvió cero coincidencias. Se sustituyó el selector por Voice Test
y se conservaron las llamadas históricas. El respaldo privado está en
`/home/alberto/twenty-inconnect-dev-local-r1/voice-v14-development/`.

Outbound quedó en `true` tanto en `app.env` como en el proceso dedicado
de NestJS. Cloudflare devolvió 200 en `/ready`. La TwiML App de desarrollo
coincidió con la URL dedicada y el método POST. TwiML y call-progress
rechazaron las peticiones públicas sin firma con 403. El administrador
original recibió 403 en Phone Access con el selector de Voice Test.

Para obtener una comprobación autenticada del piloto desde WSL, ejecutar
`python3 "$voice_dev" authenticate-pilot` y escribir su contraseña en la
terminal local. El comando conserva por hasta 15 minutos una referencia
privada de sesión para las comprobaciones y deja la evidencia sin
credenciales. El uso habitual de Twenty solo requiere iniciar sesión en
el navegador con el operador seleccionado.

Para la prueba manual, usar **Phone → Keypad** como Voice Test y marcar
solo `5514552571`. Comprobar el intento en **Recents** al colgar. El dato
temporal `5514552572` queda fuera de la autorización de llamadas y
mensajes. Tras la prueba, ejecutar `python3 "$voice_dev" finish-test`
para verificar el historial, deshabilitar temporalmente la salida y
restaurar el teléfono y el selector originales. Ese comando comprueba
la restauración con Outbound `disabled` y, si al iniciarlo el modo
persistente estaba habilitado, lo reanuda para el administrador original.

## Inventario exacto y commit manual de Voice V1.4

El alcance contiene 55 archivos, 37 versionados con cambios y 18 nuevos.
Incluye los permisos y su metadata, los dos upgrades, el instalador V1.4,
Phone en la navegación y su proveedor global, las correcciones de
integración, UI/UX Polish, pruebas focalizadas y documentación. El índice
estaba vacío y `HEAD` era `809b685245` al preparar estas instrucciones.
El trabajo local de STAGING-S2-R2, PHYS-P2 y `.codex` queda fuera de la lista.
Los respaldos, sesiones y herramientas del piloto bajo `.cache` o el
directorio operativo de WSL permanecen locales.

Desde WSL, revisar primero que el índice siga vacío y que la rama sea
`feature/inconnect-lead-management`. Luego preparar exactamente estas rutas.

```bash
cd /home/alberto/projects/twenty-inconnect
git status --short --branch
git diff --cached --name-only
git add -- \
  packages/twenty-front/src/generated-metadata/graphql.ts \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceCallHistory.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceCallProvider.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceGlobalSoftphone.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceKeypad.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/VoicePhoneNavigationItem.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceRecents.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceSoftphone.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceSoftphoneView.styles.ts \
  packages/twenty-front/src/modules/inconnect-voice/components/VoiceSoftphoneView.tsx \
  packages/twenty-front/src/modules/inconnect-voice/components/__tests__/VoiceCallProvider.test.tsx \
  packages/twenty-front/src/modules/inconnect-voice/contexts/VoiceCallContext.ts \
  packages/twenty-front/src/modules/inconnect-voice/hooks/useLeadVoiceCall.ts \
  packages/twenty-front/src/modules/inconnect-voice/hooks/useVoiceDialLookup.ts \
  packages/twenty-front/src/modules/inconnect-voice/hooks/useVoiceProviderProgress.ts \
  packages/twenty-front/src/modules/inconnect-voice/utils/formatVoiceDuration.ts \
  packages/twenty-front/src/modules/inconnect-voice/utils/voiceApi.ts \
  packages/twenty-front/src/modules/navigation/components/MainNavigationDrawerScrollableItems.tsx \
  packages/twenty-front/src/modules/settings/roles/role-permissions/permission-flags/components/SettingsRolePermissionsSettingsTableHeader.tsx \
  packages/twenty-front/src/modules/settings/roles/role-permissions/permission-flags/components/SettingsRolePermissionsSettingsTableRow.tsx \
  packages/twenty-front/src/modules/settings/roles/role-permissions/permission-flags/components/SettingsRolePermissionsToolSection.tsx \
  packages/twenty-front/src/modules/settings/roles/role-permissions/permission-flags/hooks/useActionRolePermissionFlagConfig.ts \
  packages/twenty-front/src/modules/settings/roles/role-permissions/permission-flags/types/SettingsRolePermissionsSettingPermission.ts \
  packages/twenty-front/src/modules/ui/layout/page/components/DefaultLayout.tsx \
  packages/twenty-server/docs/INCONNECT_PRODUCT_BACKLOG.md \
  packages/twenty-server/docs/INCONNECT_PROJECT_STATUS.md \
  packages/twenty-server/docs/INCONNECT_VOICE_V1_3.md \
  packages/twenty-server/docs/INCONNECT_VOICE_V1_4.md \
  packages/twenty-server/docs/INCONNECT_VOICE_V1_4_DEV_LOCAL_INSTALL.md \
  packages/twenty-server/src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795608000000-add-inconnect-voice-manual-dial.ts \
  packages/twenty-server/src/database/commands/upgrade-version-command/2-32/2-32-upgrade-version-command.module.ts \
  packages/twenty-server/src/database/commands/upgrade-version-command/2-32/2-32-workspace-command-1795608000001-refresh-voice-permission-flags.command.ts \
  packages/twenty-server/src/database/commands/upgrade-version-command/instance-commands.constant.ts \
  packages/twenty-server/src/database/commands/upgrade-version-command/workspace-command-provider.module.ts \
  packages/twenty-server/src/database/scripts/inconnect-voice-v14/install.ts \
  packages/twenty-server/src/database/scripts/inconnect-voice-v14/refresh.ts \
  packages/twenty-server/src/database/scripts/inconnect-voice-v14/voice-v14-install.spec.ts \
  packages/twenty-server/src/database/scripts/inconnect-voice-v14/voice-v14-install.ts \
  packages/twenty-server/src/engine/metadata-modules/permission-flag/constants/standard-permission-flag-definitions.constant.ts \
  packages/twenty-server/src/engine/metadata-modules/permissions/__tests__/inconnect-messaging-permission-flags.spec.ts \
  packages/twenty-server/src/engine/metadata-modules/permissions/constants/tool-permission-flags.ts \
  packages/twenty-server/src/engine/metadata-modules/permissions/permissions.service.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice-call.store.spec.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice-call.store.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice-config.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice-dial-number.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice-directory.service.spec.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice-directory.service.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice-v14-upgrade.spec.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice.controller.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice.module.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice.service.ts \
  packages/twenty-server/src/modules/inconnect-voice/inconnect-voice.spec.ts \
  packages/twenty-shared/src/constants/PermissionFlagType.ts \
  packages/twenty-shared/src/constants/SystemPermissionFlag.ts
git diff --cached --check
git diff --cached --name-status
```

Tras comprobar que el índice contiene las 55 rutas de la lista, hacer el
commit y push manuales.

```bash
git commit -m "feat(voice): add global dialer and recent calls in v1.4"
git push origin HEAD:refs/heads/feature/inconnect-lead-management
```


## Evidencia histórica de la ventana supervisada del marcador global

El operador aprobó el refinamiento visual en Twenty. El preflight de
la ventana final confirmó NestJS, el marcador actual en Vite y el
mismo Quick Tunnel sincronizado, con readiness HTTP 200 y TwiML sin
firma HTTP 403. El administrador original confirmó HTTP 200 autenticado
`disabled`. En solo lectura se verificaron 8 intentos, 16 tramos,
304 s confirmados y cero llamadas activas. Calls y Recents coinciden
con los 8 intentos existentes.

El observador reutiliza la sesión interactiva de WSL y guarda esta
ventana separada de la evidencia anterior. Cuando el operador confirme
que está preparado, lo ejecuta en su terminal con este comando.

```bash
python3 /home/alberto/projects/twenty-inconnect/.cache/inconnect-voice-v1.4/sync-pilot/observe-v14-final.py
```

Mantener la terminal abierta y esperar la confirmación `READY`. La
primera llamada parte de **Phone → Keypad** desde fuera del Lead, tras
la coincidencia automática. La segunda parte de **Redial**, que debe
precargar el número y volver a resolverlo. Cada llamada se inicia
mediante **Place call**. El observador compara Calls y Recents y solicita
el cierre al registrar los dos intentos finalizados. Pulsar Enter en
la terminal permite cerrar antes. Tras el cierre se comprueban por
separado Outbound `false`, HTTP 200 `disabled`, asociación, tramos y
duraciones de los intentos nuevos. Audio, navegación y controles se
registran según la observación directa del operador.

### Resultado de la primera ventana y condición para continuar

El 26 de noviembre la ventana registró una llamada contestada con
42 s confirmados. El intento está asociado al Lead original, con un
tramo de navegador y otro de destino. Se verificó su persistencia en
Calls y Recents al cierre. El total quedó en nueve intentos, 18 tramos,
346 s confirmados y cero llamadas activas. El cierre devolvió HTTP 200
autenticado `disabled`. El operador indicó que omitió la segunda llamada.

El preflight posterior encontró el Lead legible, con un teléfono
principal que ya no coincide con el destino aprobado. El lookup exacto
devolvió cero coincidencias y Recents cero filas. El historial vinculado
permanece en Calls. Hace falta restaurar el teléfono aprobado antes de
repetir el preflight de la remarcación. Outbound sigue deshabilitado.

### Procedimiento histórico de la ventana sin Lead

El procedimiento supervisado anterior contemplaba una edición temporal del teléfono principal del
Lead de prueba a `5514552572`, o vaciarlo si lo admite el modelo, y la
sustitución temporal del selector a Voice Test. La preparación operativa
queda condicionada a dos llamadas vinculadas finalizadas y al cierre
autenticado con Outbound `false`. El único destino para la llamada real
sigue siendo `5514552571`.

1. Guardar en privado el compuesto telefónico original y el `app.env`
   con su hash y selector. Confirmar la identidad del Lead y que el
   teléfono original coincide con el destino aprobado. Comprobar la
   unicidad del valor temporal frente a los índices aplicables, incluidas
   filas borradas lógicamente si el índice las cubre. Revisar los
   workflows y webhooks activos que podrían reaccionar a la edición del
   Lead. Un conflicto o automatización de salida bloquea la edición.
2. Con el administrador original, aplicar y releer el único cambio
   telefónico mediante Twenty. Comprobar el conjunto vacío de coincidencias
   activas del número aprobado desde su sesión autorizada. Conservar el
   inventario anterior de Leads y de llamadas vinculadas como referencia.
3. Con Outbound `false`, sustituir solamente el selector por el
   `UserWorkspace.id` de Voice Test, `c7737570-d93e-434f-84ad-518d47742344`,
   y reiniciar solo NestJS. Verificar con su sesión que Phone está
   autorizado y comprobar los grants independientes de marcación libre
   e historial sin vínculo. La búsqueda debe devolver cero coincidencias
   visibles en el alcance `ownRecords`.
4. Con el observador autenticado como Voice Test, confirmar `READY`.
   El operador usa Phone y confirma una sola llamada manual al destino
   aprobado. Verificar audio y cronómetro con su observación directa, y
   confirmar en el backend el resultado, Recents y los dos IDs CRM nulos.
   Comparar el inventario de Leads para descartar creación durante la prueba.
5. Cerrar la salida y confirmar HTTP 200 `disabled`. Restaurar el
   teléfono principal mediante Twenty y el selector original
   `860b41e6-d169-4505-a1e5-0de9af6586fb`, incluso si falla la prueba.
   Confirmar el `app.env` original, las asociaciones históricas, la nueva
   llamada sin vínculo y cero llamadas activas. El historial no vinculado
   se comprueba con la sesión piloto antes de restaurar el selector y
   con la evidencia persistente de solo lectura después del cierre.

## Recuperación de DEV-LOCAL-R1 del 26 de noviembre de 2026

Tras un nuevo arranque de WSL se recuperaron PostgreSQL 55432, Redis
56379, NestJS 33000, Vite 33001 y Nginx 34080. Se usó la variante de
arranque que verifica el hash del filtro de callbacks de Nginx y el
identificador del clúster dedicado. Twenty está disponible en
[Vite local](http://127.0.0.1:33001/). El `app.env` conserva el hash de
la ventana anterior, Nest ejecuta Voice Outbound en `false` y el
operador original recibió HTTP 200 autenticado `disabled`.

La transacción de solo lectura confirmó los cursores `1795608000000`
en instancia y `1795608000001` en workspace, ambos completados en el
primer intento. Se verificaron el esquema de V1.4 y el índice parcial
de exclusión. Se conservaron ocho intentos vinculados, 16 tramos y
304 s confirmados, con siete llamadas contestadas, un `no-answer` y
cero llamadas activas. Voice Test sigue como único miembro de
`Voice Pilot — DEV`, con ambos permisos explícitos y la política
`ownRecords` para Lead en modo MANAGED.

El nuevo Quick Tunnel apunta a `127.0.0.1:34080`. Tras recibir la
autorización específica se respaldaron las referencias anteriores y
se sincronizó el [endpoint TwiML actual](https://papua-retailers-traffic-absence.trycloudflare.com/auth/inconnect-voice/twiml)
en `INCONNECT_VOICE_URL` y en `VoiceUrl` de Twenty INCONNECT Voice DEV.
La actualización de Twilio usó POST y conservó el método POST de la app.
Se reinició solo NestJS. Después del reinicio se verificaron ambas
referencias, Nest saludable, Cloudflare readiness 200 y HTTPS válido.
Los callbacks devolvieron 405 a GET, 403 a POST sin firma y 404 a
rutas o parámetros fuera del filtro. El operador original recibió HTTP
200 autenticado `disabled`, con Outbound en `false` en archivo y proceso.
La recuperación y el resultado de sincronización están en
`.cache/inconnect-voice-v1.4/sync-pilot/recovery-2026-11-26/`.

## Corrección del acceso Phone y resultado de la ventana vinculada

El navegador real confirmó Click-to-Call, el diseño del softphone,
el cronómetro tras contestar y el teclado DTMF visible. La barra lateral
estaba fuera de `VoiceCallProvider`. `VoicePhoneNavigationItem` no recibía
su contexto y se ocultaba antes de pedir `phone-access`. El layout ahora
comparte un proveedor entre barra lateral y hoja de contenido. Phone se
mantiene debajo de Messaging y usa la activación nativa por clic. El
módulo transformado por Vite confirma la jerarquía y la API autenticada
del operador original devuelve `available: true` con Outbound `disabled`.

La ventana se cerró el 25 de noviembre de 2026 a las 16:22, hora de
Ciudad de México, con HTTP 200 autenticado `disabled` y el hash de
`app.env` intacto. Registró un intento, vinculado mediante Click-to-Call,
con resultado `answered` y 30 s confirmados. Al cierre el mismo intento
aparecía en Calls y Recents. Una comprobación posterior devolvió ocho
intentos y 304 s confirmados. La marcación global y la remarcación no se
validaron con llamadas reales durante esa ventana.

Voice Test (`voice-pilot-dev@inconnect.test`) es el único Workspace
Member de `Voice Pilot — DEV` y el rol es su única asignación. Se
verificaron los estados solo marcación, solo historial y ambos antes de
conservar los dos permisos. El rol tiene lectura estándar únicamente de
Lead y operaciones de escritura y eliminación denegadas. Record Access
permanece en MANAGED. La revisión 2 añade solo la regla `ownRecords`
de Lead para este rol, con creación y transferencia denegadas y caché
recalculada. Las demás políticas y propietarios se conservaron.

Twenty usaba Perfil como página de inicio cuando el piloto carecía de
objetos legibles. Con la lectura de Lead aplicada, iniciar en `/` o abrir
[/objects/leads](http://127.0.0.1:33001/objects/leads) tras recargar la
sesión. La lista puede estar vacía bajo `ownRecords`. El selector de
Voice sigue en el operador original y mantiene Phone fuera del piloto.

## Preparación previa del alta y la ventana vinculada

La invitación personal para `voice-pilot-dev@inconnect.test` se recuperó
mediante una transacción de solo lectura en el PostgreSQL dedicado, tras
comprobar clúster, puerto 55432, base, workspace, rol editable y
destinatario. El launcher quedó fuera del repositorio, en un directorio
privado con permisos `0700` y un archivo `0600`. En una ventana privada
del navegador, el operador abre el archivo, pulsa **Aceptar invitación
en Twenty DEV-LOCAL-R1**, elige su contraseña en el formulario de Twenty
y completa su perfil. El alta y los grants posteriores se documentan
en el resultado operativo anterior.

Para la ventana vinculada, Nest y Vite respondieron 200, Cloudflare
confirmó `/ready` y el webhook rechazó el POST sin firma. El observador
de V1.2 conserva su autenticación local y se adapta a comparar **Calls**
y **Recents** por el ID del intento. La preparación no inicia la espera
de autenticación. Cuando el operador original confirme que está listo,
abrir una terminal interactiva de WSL y ejecutar lo siguiente.

```bash
python3 /home/alberto/projects/twenty-inconnect/.cache/inconnect-voice-v1.4/sync-pilot/observe-v14.py
```

El operador introduce su correo y su contraseña con entrada oculta en
esa terminal. La supervisión se arma con el comando siguiente, únicamente
tras la confirmación del operador.

```bash
python3 /home/alberto/projects/twenty-inconnect/.cache/inconnect-voice-v1.4/sync-pilot/window-v14.py --operator-is-ready
```

Esperar `READY` antes de marcar. Desde una pantalla ajena a Leads,
abrir **Phone → Keypad**. Probar la escritura y el pegado del número
aprobado y esperar la búsqueda automática. Comprobar que el único Lead
queda seleccionado. Pulsar **Place call** para confirmar la primera llamada.
Mientras esté activa, navegar y comprobar que Phone conserva el mismo
intento. Colgar y comprobar el nuevo intento en **Calls** y **Recents**.
Pulsar **Redial** junto al intento y verificar que precarga el campo
en **Keypad** y vuelve a resolverlo sin crear otro intento. Confirmar
**Place call** para la segunda llamada. Colgar y comprobar ambos
historiales. El supervisor restaura Outbound a `false` cuando observa
los dos intentos finalizados. Pulsar Enter en el observador permite
cerrar antes. El cierre exige HTTP 200 autenticado con `disabled`.

El selector `INCONNECT_VOICE_USER_WORKSPACE_ID` admite un único
`UserWorkspace.id`. El valor vigente es
`860b41e6-d169-4505-a1e5-0de9af6586fb`. El destino, el workspace y
el selector se conservaron. Después del alta se obtiene el ID exacto
del miembro piloto mediante Twenty. Con la prueba vinculada cerrada y
una autorización separada, guardar una copia privada de `app.env` y su
hash, sustituir únicamente el selector por el ID piloto, reiniciar
solo Nest y comprobar Phone y status `disabled` con ese usuario.
Durante la sustitución, el operador original pierde el acceso operativo
a Phone, lookup, Recents y Calls. El listado de solo historial vigente
carece de una excepción para el operador original. Se conserva su
autoría histórica. Tras la ventana
piloto, restaurar el selector original y verificar el hash y el status
autenticado `disabled` con el operador original.

En modo MANAGED, la falta de una regla de lectura deja el lookup con
HTTP 403 aunque se hayan concedido los permisos de Voice. La regla
`ownRecords` ya aplicada limita la lectura a los registros cuyo Owner
sea el nuevo miembro. La ventana sin Lead sigue pendiente del selector
temporal y del segundo destino controlado con autorización separada.

## Sincronización y preparación funcional del 25 de noviembre de 2026

`INCONNECT_VOICE_URL` en `app.env` y `VoiceUrl` en **Twenty INCONNECT
Voice DEV** quedaron sincronizados con el mismo [endpoint TwiML de
DEV-LOCAL-R1](https://typing-delivering-delayed-threatening.trycloudflare.com/auth/inconnect-voice/twiml).
La app conserva el método POST y los demás valores. Se respaldaron sus
valores anteriores y `app.env` en el directorio privado
`/home/alberto/twenty-inconnect-dev-local-r1/voice-v1.4-url-backup.7aqnqe5x`.
Se comprobó el cambio de una sola variable y se reinició solo NestJS.
Nest 33000 respondió HTTP 200 en `/healthz`. Cloudflared respondió HTTP
200 en `/ready`, registró una conexión activa y apuntó a Nginx dedicado
en `127.0.0.1:34080`. Las sondas públicas devolvieron 405 a GET, 403 a
POST sin firma en ambas rutas de callback y 404 a rutas o parámetros
fuera del filtro. Outbound permaneció en `false`.

En la sesión autenticada del operador actual, Phone Access devolvió
`available: true`. El teléfono del Lead de prueba, consultado en E.164
y formato nacional, devolvió la misma coincidencia exacta autorizada.
Con status `disabled`, ambas capacidades de llamada devolvieron `false`.
Calls y Recents respondieron 200 y Recents conservó siete llamadas
vinculadas y 274 s confirmados. Los catorce tramos corresponden al
control físico previo. La remarcación precarga el número según la
fuente. La herramienta de navegador no pudo verificar la URL de la
sesión de Edge, por lo que la prueba visual queda pendiente.

Twenty creó `Voice Pilot — DEV` como rol editable para usuarios humanos,
sin accesos globales. En esa etapa, su única invitación personal, para
`voice-pilot-dev@inconnect.test`, quedó pendiente en **Settings → Members
→ Invite**, con cero miembros y cero grants. El correo
se encoló para el logger local con el worker detenido. El listado
nativo verifica el destinatario y el rol sin mostrar el enlace personal.
El alta sin invitación está deshabilitada en esta instancia. La cuenta
administrativa, el selector de operador y Record Access se conservaron.
La evidencia operativa está en `.cache/inconnect-voice-v1.4/sync-pilot/`.

## Resultado físico del 25 de noviembre de 2026

**Instalado y refrescado en DEV-LOCAL-R1.** El build Linux completó y
el instalador ejecutó únicamente `--install 1795608000000` y
`--refresh 1795608000001`. El `--inspect` posterior devolvió
`installed`. El respaldo privado quedó en
`/home/alberto/twenty-inconnect-dev-local-r1/voice-v1.4-backup.Ygnx69`.
Se verificaron el catálogo, el snapshot registrado y el SHA-256 contra
el dump. Se conservó el artefacto previo de Nest para recuperación.

El control de preservación del instalador confirmó las huellas de las
filas existentes antes del commit. La lectura posterior confirmó
**7 llamadas, 14 tramos, 7 asociaciones, 274 s, 6 contestadas y un
`no-answer`**, con cero llamadas activas, asociaciones parciales o
grants de los dos flags nuevos. Ambas columnas CRM admiten NULL, el
check validado exige igualdad de nulabilidad, la FK compuesta se
conservó y los dos índices están válidos. La instancia quedó en
`1795608000000` y el workspace en `1795608000001`, ambos completados en
el primer intento. Se conservaron las filas previas de tracking.

Se reinició únicamente Nest para el build. PostgreSQL 55432 permaneció
en el clúster dedicado, Redis 56379 respondió `PONG`, Nest 33000 y Vite
33001 devolvieron HTTP 200, y Vite sirvió `VoiceGlobalSoftphone` sin
reinicio. Nginx 34080 mantuvo el filtro de rutas y métodos. El hash de
`app.env` quedó idéntico.

**Comprobación autenticada por API con el operador actual.** Status
de Voice devolvió HTTP 200 `disabled`. Phone Access devolvió HTTP 200
`available: true`. El lookup del único destino aprobado devolvió una
coincidencia autorizada y ambas capacidades de llamada en false.
Recents devolvió HTTP 200, siete llamadas propias vinculadas al mismo
Lead y 274 s confirmados. La prueba anónima de Phone Access devolvió
HTTP 403. El navegador cargó la pantalla de acceso del workspace sin
sesión. La presentación del Keypad y la remarcación quedan para la
validación visual. La ventana telefónica sigue pendiente de autorización.

**Quick Tunnel recuperado con hostname nuevo.** `/ready` devolvió HTTP
200 y el DNS público resolvió el hostname. Las sondas HTTPS mantuvieron
TLS y el hostname original usando la IP devuelta por el DNS público
cuando los resolvers locales aún no lo encontraban. Nginx devolvió 405
a GET en ambas rutas de Voice, 403 a los POST sin firma permitidos por
el filtro y 404 a rutas y query strings fuera de alcance. El valor
propuesto en esa etapa, sincronizado posteriormente, fue el siguiente.

```text
https://typing-delivering-delayed-threatening.trycloudflare.com/auth/inconnect-voice/twiml
```

Hasta la sincronización posterior, Nest, `app.env` y la TwiML App de
desarrollo coincidían en la URL anterior. La evidencia de instalación
se guardó en `.cache/inconnect-voice-v1.4/physical/`.

## Preflight previo a la instalación

**Preflight de solo lectura del 25 de noviembre de 2026.** PostgreSQL 18.6
en 55432 confirmó el clúster dedicado y siete llamadas, catorce tramos,
seis contestadas, un `no-answer` y 274 s confirmados. Las siete llamadas
están vinculadas. Hay cero asociaciones parciales y cero llamadas activas.
Las columnas CRM conservan `NOT NULL`, el índice de exclusión es válido
y las definiciones V1.4 están ausentes. Hay un workspace provisionado y
una aplicación estándar. V1.2 figura completada en instancia y workspace.
Ambos cursores efectivos siguen en el Slow de Messaging `1789040000001`
completado. El `--inspect` dedicado devolvió `ready`.

Redis en 56379 respondió `PONG` con las credenciales de aplicación.
Nest `/healthz` en 33000 y Vite en 33001 devolvieron HTTP 200. Nginx
en 34080 devolvió HTTP 405 al GET de TwiML, como indica su filtro de
método. El proceso Nest usa el `app.env` dedicado con salida, migraciones
automáticas y cron deshabilitados. El controlador compilado aún carece
de `manual-session`. La TwiML App de desarrollo devolvió HTTP 200 a la
lectura, con identidad correcta, método POST y la misma URL que Nest y
`app.env`. Cloudflared escucha en 32998, pero `/ready` devolvió HTTP 503
y las dos rutas públicas no devolvieron respuesta HTTP. La ventana
telefónica queda bloqueada hasta recuperar y verificar el túnel.

Voice V1.3 y UI Polish están en `809b685245`. La fuente funcional V1.4
fue aceptada por el operador con 94 pruebas focalizadas. La instalación
física, el refresco de metadata, la concesión de permisos y la ventana
telefónica requieren sus autorizaciones específicas.

La preparación verificó el plan offline, el preflight físico de solo
lectura y cinco pruebas nuevas del instalador con QueryRunner simulado.
Se reutiliza la evidencia de las 94 pruebas funcionales previas.

## Alcance exacto

1. `2.32.0_AddInconnectVoiceManualDialSlowInstanceCommand_1795608000000`
   quita `NOT NULL` de `objectMetadataId` y `recordId`, añade el check
   `("objectMetadataId" IS NULL) = ("recordId" IS NULL)` con nombre
   `CHK_inconnectVoiceCall_crmPair` e indexa
   `("workspaceId", "actorMemberId", "createdAt" DESC, id DESC)` como
   `IDX_inconnectVoiceCall_actorHistory`. Conserva la FK compuesta,
   las restricciones de tramos y el índice único parcial por actor.
   Inserta exclusivamente las dos definiciones de permisos estándar de
   V1.4 y confirma su aplicación y clave. [DDL y DML exacto](../src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1795608000000-add-inconnect-voice-manual-dial.ts)
2. Tras commit, `2.32.0_RefreshVoicePermissionFlagsCommand_1795608000001`
   invalida, recalcula y verifica el mapa de definiciones del único
   workspace. El runner nativo registra ese resultado por workspace.
   [Comando de cache](../src/database/commands/upgrade-version-command/2-32/2-32-workspace-command-1795608000001-refresh-voice-permission-flags.command.ts)

El instalador acotado reutiliza la identidad, las comprobaciones de
dependencias y de esquema V1.2, y el constructor nativo de tracking. Su
QueryRunner arranca con conexión de solo lectura y destino cerrado. En la
transacción de escritura revalida la misma conexión, exige clientes de
base desconectados, toma el advisory lock de Voice y bloquea las tablas
afectadas y dependencias. Comprueba versión, owner, unicidad de llave de
permisos, workspace, aplicación, esquema, tracking previo y cero llamadas
activas. Captura en privado un `pg_dump` del snapshot de la transacción
con catálogo verificado y SHA-256. Compara huellas de llamadas, tramos,
grants, tracking previo, índices y constraints antes del commit.
[Instalador específico](../src/database/scripts/inconnect-voice-v14/install.ts)

El commit añade solo dos filas completadas de instancia, una global y un
espejo en el workspace. El cursor de instancia avanza a `1795608000000`
y el de workspace primero a su espejo y luego a `1795608000001` cuando
se completa el refresco. El predecesor y el tracking histórico se
conservan. Un fallo del refresco se registra como fallo de ese paso y se
puede reintentar después de inspeccionar el estado. La instalación usa
solo estas dos operaciones de Voice.

## Comandos usados en la instalación

Desde WSL, abrir una ventana de mantenimiento autorizada. Conservar como
referencia el PID, los flags y el build de Nest, confirmar la identidad
de los servicios y parar por SIGTERM **solo el proceso de API dedicado
verificado**. Comprobar que el listener 33000 se libera y que el clúster
dedicado no tenga otros clientes. El instalador vuelve a verificarlo.
Mantener PostgreSQL, Redis, Nginx y Vite en sus servicios dedicados.

```bash
repo=/home/alberto/projects/twenty-inconnect
runtime=/home/alberto/twenty-inconnect-dev-local-r1
export PATH="/home/alberto/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin"
export NX_DAEMON=false NX_NO_CLOUD=true
cd "$repo"
umask 077
previous=$(mktemp -d "$runtime/voice-v1.4-backend.XXXXXXXX")
mv -- "$repo/packages/twenty-server/dist" "$previous/dist"
yarn nx run twenty-server:build --skip-nx-cache
test -s "$repo/packages/twenty-server/dist/main.js"
test -s "$repo/packages/twenty-server/dist/database/scripts/inconnect-voice-v14/install.js"
grep -q manual-session "$repo/packages/twenty-server/dist/modules/inconnect-voice/inconnect-voice.controller.js"
```

Si el build falla, restaurar el directorio reservado y el arranque
anterior. Con el artefacto comprobado, ejecutar tras autorización
del respaldo y tracking de instancia y del comando de metadata:

```bash
cd "$repo/packages/twenty-server"
installer=dist/database/scripts/inconnect-voice-v14/install.js
env -i PATH="$PATH" node "$installer" --inspect
env -i PATH="$PATH" node "$installer" --install 1795608000000
env -i PATH="$PATH" node "$installer" --refresh 1795608000001
env -i PATH="$PATH" node "$installer" --inspect
```

Esperar `ready`, `refresh-pending`, `installed`, `installed`. Si
se corta antes del commit, inspeccionar ausencia de cambios parciales.
Si el commit es incierto, ejecutar `--inspect` antes de reintentar.
El respaldo lógico privado queda bajo `$runtime/voice-v1.4-backup.*`.
El listado y hash comprueban el artefacto, y cualquier ejercicio real
de restauración exige autorización y destino aparte. Tras un commit,
recuperar servicio con el build anterior y salida deshabilitada, dejando
el esquema compatible y su tracking. Evaluar un `down` con autorización
propia si fuese imprescindible. El `down` rechaza grants existentes
y llamadas sin vínculo para proteger datos y permisos.

Con autorización de reinicio, arrancar la API dedicada en una terminal
independiente. Validar antes que el archivo privado mantiene sus URLs
de almacenamiento y proveedores aprobadas:

```bash
cd "$repo/packages/twenty-server"
env -i PATH="$PATH" NODE_HOST=127.0.0.1 NODE_PORT=33000 \
  PG_INSTALL_EXTENSIONS=false DISABLE_DB_MIGRATIONS=true \
  DISABLE_CRON_JOBS_REGISTRATION=true INCONNECT_VOICE_ENABLE_OUTBOUND=false \
  node --env-file="$runtime/app.env" dist/main.js
```

Mantener el Vite saludable y recargar el navegador. Si el build de
dependencias deja Vite sirviendo módulos antiguos y se autoriza su
reinicio, parar solo el proceso dedicado verificado y arrancar así:

```bash
cd "$repo/packages/twenty-front"
env -i PATH="$PATH" REACT_APP_SERVER_BASE_URL=http://127.0.0.1:33000 \
  ../../node_modules/.bin/vite --host 127.0.0.1 --port 33001 --strictPort
```

Confirmar `/healthz`, status de Voice autenticado `disabled`, Phone,
lookup y Recents vinculados antes de habilitar salida.

## Permisos y prueba mínima

**Phone y Recents vinculados** usan la autorización de Voice ya
configurada para el workspace y operador, miembro activo y permisos
CRM vigentes. Click-to-Call conserva su autorización. Los grants
independientes son `DIAL_INCONNECT_VOICE` para marcar sin Lead y
`READ_UNLINKED_INCONNECT_VOICE_HISTORY` para ver el historial propio
sin Lead. Roles administrativos y All Actions Access no los conceden.

El operador actual tiene un Role de sistema no editable y es su único
target. La edición de flags de roles no editables se rechaza en el
validador de Twenty. El procedimiento de grants requiere un Role
editable, exclusivo del operador y con su autoridad actual de Voice y
CRM ya comprobada. Tras aprobación, **Settings → Roles → Actions**,
activar solo los dos flags de V1.4 y comprobar cada uno por separado.
Si obtener ese Role exige cambiar la asignación actual o la política de
Record Access, detener el procedimiento y resolver esa autorización por
separado. [Validador de Role](../src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-role-permission-flag-validator.service.ts)

### Completar el operador Voice Pilot — DEV

1. En **Settings → Members → Invite**, comprobar la invitación
   existente y el rol asignado. Para obtener el enlace personal en esta
   instancia, usar el correo del logger si está disponible o autorizar la
   lectura puntual del token de esa invitación en el PostgreSQL dedicado,
   para usarlo en memoria en el alta nativa de Twenty. El enlace público
   del workspace sigue su propia asignación de roles.
2. Aceptar el enlace personal en una ventana privada, con el correo piloto,
   y completar el alta y el perfil. Tras el alta, iniciar sesión desde
   [Twenty local](http://127.0.0.1:33001/) con la credencial privada del
   piloto. En **Settings → Roles → Voice Pilot — DEV**, comprobar que la
   cuenta piloto sea el único miembro y que no haya agentes ni API keys.
   En permisos de objetos, habilitar solo lectura del Lead configurado y
   de sus campos de etiqueta y teléfono. En **Actions**, habilitar y
   verificar por separado **Dial without a Lead** y **Read personal
   unlinked Voice history**. Mantener excluidos los accesos de escritura
   y administración. El historial personal del operador actual queda
   asociado a su propia cuenta.
3. En **Settings → Security → Record Access**, revisar la regla de
   lectura para el nuevo ID de Role y el objeto Lead. En modo MANAGED,
   un Role nuevo carece de regla y la lectura queda denegada.
   `ownRecords` solo admite el Lead si ya pertenece al piloto.
   `ownAndTeamRecords` depende de un equipo válido que ya cubra al
   propietario. `allRecords` excede el alcance de un solo Lead.
   Si ninguna regla autorizable cubre el Lead actual sin cambios
   laterales, detenerse y pedir autorización para una política y alcance
   concretos. Preservar el propietario y el Role administrativo.
4. Tras autorización separada, apuntar el único
   `INCONNECT_VOICE_USER_WORKSPACE_ID` del piloto al nuevo
   UserWorkspace, conservar `INCONNECT_VOICE_ENABLE_OUTBOUND=false`,
   reiniciar solo Nest y probar login, lectura permitida,
   denegación fuera de alcance, Phone, lookup y Recents. El selector y
   los dos permisos se comprueban de manera independiente. Restaurar
   la configuración previa con Outbound deshabilitado al terminar.

### Sustitución temporal del destino

Con aprobación posterior del número controlado, operador y ventana,
guardar una copia privada con hash del `app.env` efectivo. Registrar
el valor anterior en esa copia privada. Con Outbound deshabilitado,
validar el E.164, el país permitido y la capacidad de recibir la llamada.
Sustituir únicamente `INCONNECT_VOICE_ALLOWED_DESTINATION`, reiniciar
Nest y comprobar status autenticado `disabled` y ausencia de
coincidencia visible. En la ventana telefónica posterior, el operador
confirma manualmente una sola llamada y verifica Recents y ambos IDs
nulos. Volver a deshabilitar Outbound, restaurar el valor anterior,
revalidar contra la copia y comprobar nuevamente status `disabled`,
el lookup original y ambas superficies de historial. La prueba
vinculada y la del destino temporal se ejecutan en ventanas separadas.

- **Ventana sin salida.** Con el operador actual y desde una pantalla
  ajena a Leads, abrir **Phone → Keypad**. Probar el teclado visual y el
  campo **Phone number**, y esperar la búsqueda automática del destino
  aprobado en formato nacional e internacional. Abrir **Recents**,
  confirmar el historial vinculado y pulsar **Redial**. Comprobar que
  regresa al Keypad, precarga el número y vuelve a resolverlo. **Place
  call** permanece inactivo con Outbound deshabilitado.
- **Ventana telefónica vinculada.** Con el operador actual y tras
  autorización de salida temporal, confirmar manualmente la llamada.
  Mientras está activa, abrir Phone y navegar a Messaging.
  Desde una segunda pestaña intentar click-to-call y conservar la
  respuesta de exclusión. Comprobar cronómetro de destino, audio, mute,
  DTMF cuando el destino pueda confirmarlo, minimización y colgado.
  Revisar Calls y Recents por resultado, duración y tramos. Cerrar
  verificando salida `disabled`.
- **Ventana sin Lead.** El único destino aprobado coincide actualmente
  con el Lead histórico. No sirve para acreditar una llamada sin
  asociación. La alternativa real es autorizar individualmente un
  segundo número de prueba controlado sin Lead visible y sustituir el
  único destino durante una ventana separada. Validar al operador y los
  dos grants antes de abrirla. Comprobar que la llamada queda en
  Recents propios con ambos IDs CRM nulos, y volver al valor anterior
  con salida deshabilitada. Mientras tanto, la evidencia de esa rama
  es la validación de fuente ya aceptada.

## Controles de destino y producción

La entrada usa F13 con MX predeterminado configurable, normaliza
`+521`, conserva prefijos explícitos y exige E.164 válido. Además exige
que el país esté permitido, el destino coincida con el único valor
aprobado y el tipo sea fijo o móvil. Emergencias, extensiones, USSD,
tarifa especial y números fuera del piloto quedan rechazados. El
lookup se limita a uno por segundo y la emisión manual a una cada
diez segundos por identidad, usando Redis. La intención cifrada de
45 s fija destino, actor y asociación. El SDK envía su ID opaco y el
callback firmado la consume una vez, revalida permisos, asociación y
destino, y reclama la reserva antes de generar el TwiML. El índice
parcial comparte exclusión con click-to-call. El tramo de destino tiene
límite de 300 s.

Para producción quedan por definir y acreditar cuotas acumuladas y de
gasto, alertas de fraude, política de destinos y países por entorno,
operación y observabilidad del perímetro y una revisión del límite para
todos los recorridos de salida. Los límites piloto de lookup y emisión
manual no son cuotas diarias ni aplican a click-to-call.
