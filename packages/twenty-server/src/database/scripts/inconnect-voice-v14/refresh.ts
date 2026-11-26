import { NestFactory } from '@nestjs/core';

import { VOICE_DEV_LOCAL_R1 } from 'src/database/scripts/inconnect-voice-v12/voice-v12-install';
import { requireVoiceInstall } from 'src/database/scripts/inconnect-voice-v12/voice-v12-schema';
import { VOICE_V14_REFRESH } from 'src/database/scripts/inconnect-voice-v14/voice-v14-install';

function requireLoopback(
  value: string | undefined,
  protocol: string,
  port: number,
  database?: string,
) {
  requireVoiceInstall(value, 'Missing dedicated connection URL');
  const url = new URL(value);
  requireVoiceInstall(
    (url.protocol === protocol ||
      (protocol === 'postgresql:' && url.protocol === 'postgres:')) &&
      url.hostname === '127.0.0.1' &&
      url.port === String(port) &&
      (!database || url.pathname === `/${database}`) &&
      !url.search &&
      !url.hash,
    'Dedicated connection URL differs',
  );
  return value;
}

export async function refreshVoiceV14(
  config: NodeJS.ProcessEnv,
  workspaceId: string,
) {
  const { database, port } = VOICE_DEV_LOCAL_R1;
  const primary = requireLoopback(
    config.PG_DATABASE_URL,
    'postgresql:',
    port,
    database,
  );
  const replica = requireLoopback(
    config.PG_DATABASE_REPLICA_URL ?? primary,
    'postgresql:',
    port,
    database,
  );
  const redis = requireLoopback(config.REDIS_URL, 'redis:', 56379);
  const queue = requireLoopback(
    config.REDIS_QUEUE_URL ?? redis,
    'redis:',
    56379,
  );
  Object.assign(process.env, config, {
    PG_DATABASE_URL: primary,
    PG_DATABASE_REPLICA_URL: replica,
    PG_INSTALL_EXTENSIONS: 'false',
    REDIS_URL: redis,
    REDIS_QUEUE_URL: queue,
    DISABLE_DB_MIGRATIONS: 'true',
    DISABLE_CRON_JOBS_REGISTRATION: 'true',
    INCONNECT_VOICE_ENABLE_OUTBOUND: 'false',
    APP_VERSION: '2.32.0',
  });

  const { CommandModule } = await import('src/command/command.module');
  const { RefreshVoicePermissionFlagsCommand } =
    await import('src/database/commands/upgrade-version-command/2-32/2-32-workspace-command-1795608000001-refresh-voice-permission-flags.command');
  const { WorkspaceCommandRunnerService } =
    await import('src/engine/core-modules/upgrade/services/workspace-command-runner.service');
  const { getRegisteredWorkspaceCommandMetadata } =
    await import('src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator');
  const metadata = getRegisteredWorkspaceCommandMetadata(
    RefreshVoicePermissionFlagsCommand,
  );
  requireVoiceInstall(
    metadata &&
      `${metadata.version}_${RefreshVoicePermissionFlagsCommand.name}_${metadata.timestamp}` ===
        VOICE_V14_REFRESH,
    'Unexpected Voice workspace command registration',
  );

  const context = await NestFactory.createApplicationContext(CommandModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await context.get(WorkspaceCommandRunnerService).runWorkspaceCommands({
      iteratorContext: { workspaceId, index: 0, total: 1 },
      options: { workspaceIds: [workspaceId] },
      workspaceCommands: [
        {
          name: VOICE_V14_REFRESH,
          command: context.get(RefreshVoicePermissionFlagsCommand),
        },
      ],
    });
  } finally {
    await context.close();
  }
}
