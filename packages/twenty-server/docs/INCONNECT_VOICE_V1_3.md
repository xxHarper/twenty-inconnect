# INCONNECT Voice V1.3

**Cierre del 25 de noviembre de 2026.** Voice V1.3 queda cerrado con el
reporte del operador en DEV-LOCAL-R1 y la aprobación del diseño de UI Polish
tras revisar las capturas simuladas. Voice Outbound sigue en `DISABLED`.
PHYS-A0 sigue en **NO-GO**. El commit y push quedan a cargo del usuario.
[Estado canónico](INCONNECT_PROJECT_STATUS.md#checkpoint-del-25-de-noviembre-de-2026)

## Teclado y audio

El softphone global usa el `Device` y el `Call` del flujo saliente existente
con Twilio Voice SDK **2.19.0**. **Keypad** se habilita cuando el SDK indica
`open` y el progreso autorizado del intento original confirma `answered`
en el tramo al destino. Deshabilita los dígitos durante reconexión, colgado
y finalización. Cada pulsación válida llama una vez a `Call.sendDigits`.
Un error de envío se muestra en el teclado y permite volver a intentar.
El teclado sólo responde a sus controles enfocados o pulsados. La aplicación
omite los dígitos de la vista, el almacenamiento, el historial, los logs y
la telemetría. El logger del SDK queda en `silent` en memoria.
[Twilio Call](https://www.twilio.com/docs/voice/sdks/javascript/twiliocall)

**Audio** separa la preferencia que se aplicará al marcar del dispositivo
confirmado por el SDK durante la llamada. En reposo, abrir Audio enumera los
dispositivos que el navegador expone. **Allow microphone access** o **Place
call** solicitan permiso mediante interacción explícita y cierran el stream
de comprobación en cuanto se obtiene. Al marcar se valida la selección
contra el inventario del SDK. El navegador usa la entrada del sistema
si la preferencia de micrófono falta o dejó de estar disponible. Para la
salida se intenta la ruta predeterminada cuando la guardada ya no existe.
Durante la llamada se usan `setInputDevice` y `speakerDevices.set`; la
selección se confirma tras resolver la operación. Si falla un cambio, se
conserva la última ruta funcional o se intenta recuperar usando el dispositivo
anterior o uno disponible. Para seleccionar de nuevo, esperar a que termine
el cambio en curso para ese control.
[Twilio Device Audio](https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice/device-audio)

Con un cambio de inventario, el SDK actualiza su lista y gestiona el
micrófono activo. Si desaparece la salida seleccionada, se comprueba el
fallback mediante el SDK. El panel informa del cambio o de la falta de
dispositivo y mantiene la preferencia guardada para una llamada posterior.
La aplicación conserva mute durante un reemplazo de entrada y libera
las capturas al finalizar. El cambio de sesión o workspace elimina los
listeners y destruye el dispositivo. Si un cambio de audio sigue pendiente
al colgar, el dispositivo se retira para impedir que una captura tardía
afecte la siguiente llamada. Las preferencias contienen sólo
identificadores de micrófono y salida en el almacenamiento local del
navegador, con clave por usuario y workspace.
[Prácticas recomendadas de Twilio](https://www.twilio.com/docs/voice/sdks/javascript/best-practices)

La entrada requiere enumeración y selección de `deviceId`. La salida
requiere soporte de `setSinkId` y la capacidad reportada por Twilio. Si un
control es incompatible, el panel explica el uso del predeterminado del
sistema y el otro control sigue disponible cuando el navegador lo permite.
Los dispositivos y sus nombres dependen del permiso, del contexto seguro y
del navegador. La conexión analógica puede cambiar físicamente el audio
sin producir un evento de inventario. El reporte del piloto no identifica
versiones de navegador ni modelos de dispositivos para una matriz de
compatibilidad con hardware real.

Los controles son locales. El flujo de autorización y reserva, el Lead
original, el cronómetro de V1.2, la reconciliación y Calls siguen usando
las rutas existentes. La instalación de V1.3 requiere únicamente servir la
fuente frontend actualizada. El esquema, las migraciones, la configuración
de Twilio y el backend de V1.2 se reutilizan.
[Historial y contrato de Voice V1.2](INCONNECT_VOICE_V1_2.md)

## Validación de fuente

Pasaron 33 pruebas en cinco suites de Voice con navegador, API y SDK
simulados. Cubren DTMF, errores, continuidad del softphone al navegar,
selección y persistencia, permisos, incompatibilidad, desconexión,
silencio, limpieza y regresiones de historial. TypeScript, Oxlint con
tipos y Oxfmt pasaron en los diez archivos frontend del cambio. El
registro local está en `.cache/inconnect-voice-v1.3/`.

## Ventana supervisada del 25 de noviembre de 2026

A las 11:03, hora de Ciudad de México, Nest respondió HTTP 200 y Vite
sirvió los módulos de softphone, teclado y audio de V1.3. Cloudflare
respondió HTTP 200 en la comprobación de disponibilidad y el webhook
público rechazó la solicitud sin firma con HTTP 403. La lectura de la
TwiML App de desarrollo confirmó el mismo URL HTTPS y método POST.
Nest y `app.env` tenían Voice Outbound en `false` antes de abrir la ventana.

El operador se autenticó con el observador de V1.2. El endpoint de Voice
respondió HTTP 200 `ready` a las 11:04:57 y HTTP 200 `disabled` a las
11:11:05. Nest quedó saludable con Voice Outbound en `false` y el archivo
`app.env` conservó su hash. El registro local de preparación y cierre
está en `.cache/inconnect-voice-v1.3/dev-local-pilot/`.

El operador reportó una prueba satisfactoria en el navegador y confirmó que
Keypad y los selectores de audio se mostraron durante una llamada real.
Las pruebas con SDK simulado verifican el envío del dígito mediante
`Call.sendDigits`. La recepción en el destino no se acreditó. El reporte
disponible tampoco detalla resultados de cada cambio de dispositivo,
intentos ni duraciones del piloto. A las 11:18 se comprobó de nuevo que
Nest respondía HTTP 200 y que Voice Outbound seguía en `false` tanto en el
proceso como en `app.env`.

Al cierre de la entrega, a las 11:39:29, hora de Ciudad de México, se
confirmó de nuevo `false` en el proceso de Nest y en `app.env`. El hash de
la configuración coincidió con el registrado antes del piloto.

## Refinamiento visual

El panel flotante centra la identidad autorizada y destaca el cronómetro.
El estado conserva su texto junto a un indicador visual. El nombre largo se
trunca y su texto completo queda disponible con foco o puntero. Durante la
llamada, la fila conserva el orden **Mute**, **Keypad**, **Audio** y **Hang
up**. Keypad y Audio muestran su selección y alternan el contenido debajo
de la fila. El modo minimizado conserva Lead, estado, cronómetro, silencio
y colgado. La interfaz usa los tokens e iconos de Twenty en ambos temas.
El cronómetro, DTMF y el audio conservan sus fuentes y handlers existentes.

Abrir el HTML local en Chrome y elegir un estado en el menú superior.
En Storybook, la misma vista está en **Modules → Voice → Softphone** y
el control `colorScheme` cambia el tema. Ambas opciones usan datos ficticios
y permiten alternar paneles, silenciar, minimizar y colgar con handlers
locales. Reducir el viewport para comprobar el desplazamiento y el acceso
a **Hang up**. [Vista HTML local](../../../.cache/inconnect-voice-v1.3/ui-polish/voice-softphone-preview.html)
· [Historia de Storybook](../../twenty-front/src/modules/inconnect-voice/components/__stories__/VoiceSoftphone.stories.tsx)

Pasaron las ocho pruebas de la suite focalizada del softphone, TypeScript
y Oxfmt en el alcance modificado. Oxlint con tipos pasó en los siete
archivos que incluye la configuración del repositorio. En Chrome se
revisaron ambos temas y los estados activo, teclado abierto, audio abierto,
minimizado, reconexión y error. También se probó el tooltip con teclado y que
**Hang up** sigue visible a 320 × 230 px mientras se desplaza el teclado.
El usuario revisó las capturas de la vista simulada y aprobó el diseño.
Quedan pendientes la revisión de UI Polish durante una llamada real, la
recepción remota de DTMF y la compatibilidad con el hardware y los
navegadores que no se probaron.

La siguiente fase está implementada en fuente y conserva este diseño.
[Voice V1.4 — Phone y Recents](INCONNECT_VOICE_V1_4.md)

## Validación en DEV-LOCAL-R1

Realizar las llamadas sólo durante una ventana autorizada de salida, con
el miembro, Lead y destino aprobados. Usar un micrófono y una salida
alternativos detectables para el recorrido de conexión y desconexión. Si
se va a acreditar DTMF remoto, el destino aprobado debe poder confirmar
la recepción, por ejemplo con una respuesta de IVR.

1. Cargar el frontend de esta revisión antes del piloto. En el Lead
   autorizado, pulsar **Llamar** para abrir **Softphone** y abrir **Audio**.
   Verificar que abrir el panel y navegar por el CRM no inicia la captura.
2. Si faltan nombres o dispositivos, pulsar **Allow microphone access** y
   conceder permiso. Comprobar que el indicador de captura se apaga tras
   la comprobación. Elegir micrófono y salida, distintos del predeterminado
   si el navegador y el hardware los ofrecen.
3. Pulsar **Place call** una vez. Confirmar que **Keypad** sigue deshabilitado
   mientras se establece el tramo al destino.
4. Contestar en el destino autorizado y comprobar audio en ambos sentidos.
   Verificar en **Audio** las rutas activas y esperar **Destination answered**.
5. Abrir **Keypad** y enviar un dígito de prueba. Confirmar su efecto remoto
   antes del siguiente. Un tono local sólo acredita reproducción local.
   Sin un destino autorizado que reconozca los tonos, registrar la recepción
   remota como pendiente. Cerrar y volver a abrir el teclado.
6. Cambiar micrófono y salida desde **Audio**. Esperar el resultado de cada
   cambio y confirmar el dispositivo mostrado, audio bidireccional y
   continuidad del cronómetro.
7. Pulsar **Mute**. Cambiar el micrófono con el silencio activo y comprobar
   en el destino que sigue sin recibir voz. Pulsar **Unmute** y verificar
   que el audio vuelve.
8. Desconectar un dispositivo activo USB o Bluetooth. Verificar que la
   opción desaparece de la lista, que se comunica el fallback y que vuelve
   el audio por el dispositivo disponible. Conectarlo otra vez y verificar
   que reaparece.
9. Minimizar, navegar a otra pantalla de Twenty y expandir. Confirmar audio,
   cronómetro y Lead original.
10. Pulsar **Hang up**. Verificar que desaparece el teclado y se apaga el
    indicador de captura. En **Calls** del Lead original, esperar el resultado
    y duración confirmados y verificar que hay un solo intento nuevo.
11. Cerrar y reabrir el softphone e iniciar una segunda llamada autorizada.
    Verificar que aplica las preferencias disponibles. Colgar y cerrar la
    ventana de salida con el procedimiento operativo vigente.

Para comprobar permisos y compatibilidad sin otra llamada, rechazar el acceso
desde **Audio** y revisar el mensaje. Volver a permitirlo con los controles
del sitio. En un navegador que carezca de selección de salida, verificar
que sólo ese control se deshabilita y que la interfaz explica el predeterminado
del sistema. Registrar navegador, dispositivos y observaciones sin conservar
los dígitos introducidos.
