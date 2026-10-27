import { Module } from '@nestjs/common';

import { CoreCommonApiModule } from 'src/engine/api/common/core-common-api.module';
import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { LeadManagementResolver } from 'src/modules/inconnect-lead-management/lead-management.resolver';
import { LeadPoolAuthorityService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service';
import { LeadPoolQueryService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service';
import { LeadPoolStoreService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import { LeadPoolService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool.service';

@Module({
  imports: [
    CoreCommonApiModule,
    InconnectRecordAccessModule,
    WorkspaceCacheModule,
  ],
  providers: [
    LeadManagementResolver,
    LeadPoolAuthorityService,
    LeadPoolQueryService,
    LeadPoolStoreService,
    LeadPoolService,
  ],
})
export class LeadManagementModule {}
