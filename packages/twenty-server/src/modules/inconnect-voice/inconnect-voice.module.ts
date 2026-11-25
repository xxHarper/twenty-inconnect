import { Module } from '@nestjs/common';

import { CoreCommonApiModule } from 'src/engine/api/common/core-common-api.module';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { RedisClientModule } from 'src/engine/core-modules/redis-client/redis-client.module';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { InconnectVoiceDestinationService } from 'src/modules/inconnect-voice/inconnect-voice-destination.service';
import { InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { InconnectVoiceController } from 'src/modules/inconnect-voice/inconnect-voice.controller';
import { InconnectVoiceProviderService } from 'src/modules/inconnect-voice/inconnect-voice-provider.service';
import { InconnectVoiceService } from 'src/modules/inconnect-voice/inconnect-voice.service';

@Module({
  imports: [
    CoreCommonApiModule,
    TokenModule,
    InconnectRecordAccessModule,
    RedisClientModule,
    SecretEncryptionModule,
    WorkspaceCacheModule,
    WorkspaceCacheStorageModule,
  ],
  controllers: [InconnectVoiceController],
  providers: [
    InconnectVoiceDestinationService,
    InconnectVoiceService,
    InconnectVoiceCallStore,
    InconnectVoiceProviderService,
  ],
})
export class InconnectVoiceModule {}
