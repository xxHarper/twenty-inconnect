# Inventario para conservar DEMO-A1–A5

El inventario contiene 26 rutas. Incluye la configuración y los archivos fuente de las demos, sus instrucciones y el arranque A5. El editor estándar de Roles y los componentes productivos ya están en HEAD.

## Comandos para revisión manual

Ejecuta estos comandos personalmente desde WSL2. Primero revisa el estado y confirma que el índice esté vacío. La lista explícita permite conservar las demos en un commit sin arrastrar archivos de staging o temporales.

```bash
cd /home/alberto/projects/twenty-inconnect
git status --short --untracked-files=all
git diff --cached --name-status

git add -- \
  packages/twenty-front/.storybook-demo-a2/main.ts \
  packages/twenty-front/.storybook-demo-a2/preview.tsx \
  packages/twenty-front/.storybook-demo-a3/README.md \
  packages/twenty-front/.storybook-demo-a3/main.ts \
  packages/twenty-front/.storybook-demo-a3/preview.ts \
  packages/twenty-front/.storybook-demo-a4/README.md \
  packages/twenty-front/.storybook-demo-a4/main.ts \
  packages/twenty-front/.storybook-demo-a4/preview.ts \
  packages/twenty-front/.storybook-demo-a5/GIT.md \
  packages/twenty-front/.storybook-demo-a5/GUION.md \
  packages/twenty-front/.storybook-demo-a5/Presentation.stories.tsx \
  packages/twenty-front/.storybook-demo-a5/README.md \
  packages/twenty-front/.storybook-demo-a5/main.ts \
  packages/twenty-front/.storybook-demo-a5/preview.ts \
  packages/twenty-front/.storybook-demo-a5/serve.sh \
  packages/twenty-front/.storybook/main.ts \
  packages/twenty-front/src/pages/inconnect-lead-management/__stories__/InconnectLeadManagement.stories.tsx \
  packages/twenty-front/src/pages/inconnect-lead-management/__stories__/createLeadPoolStoryClient.ts \
  packages/twenty-front/src/pages/inconnect-lead-management/__stories__/demoLeadPoolPlanner.d.ts \
  packages/twenty-front/src/pages/inconnect-messaging/__stories__/InconnectMessaging.stories.tsx \
  packages/twenty-front/src/pages/inconnect-messaging/__stories__/createMessagingStoryClient.ts \
  packages/twenty-front/src/pages/inconnect-messaging/__stories__/messagingStoryFixtures.ts \
  packages/twenty-front/src/pages/settings/security/__stories__/SettingsCommercialTeams.stories.tsx \
  packages/twenty-front/src/pages/settings/security/__stories__/SettingsRecordAccess.stories.tsx \
  packages/twenty-front/src/pages/settings/security/__stories__/createCommercialTeamsStoryClient.ts \
  packages/twenty-front/src/pages/settings/security/__stories__/createRecordAccessStoryClient.ts

git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git diff --cached

# Después de comprobar que el índice contiene exclusivamente estas 26 rutas.
git commit -m "chore(demo): preserve Twenty INCONNECT executive Storybook"
```

## Artefactos locales que se conservan fuera del commit

- Los builds estáticos A1–A5 y los archivos de validación bajo `.cache/demo-*/`, incluidos inventarios SHA-256, logs, JSON de Jest, scripts de comprobación y los arranques temporales anteriores. A5 tiene su propio arranque versionable en la lista.
- Las capturas y perfiles temporales de Chrome en la carpeta local de visualizaciones. Las capturas son respaldo para la presentación.
- El `__pycache__` preexistente de `packages/twenty-docker/inconnect-staging/`, los archivos de entorno y las dependencias instaladas.
