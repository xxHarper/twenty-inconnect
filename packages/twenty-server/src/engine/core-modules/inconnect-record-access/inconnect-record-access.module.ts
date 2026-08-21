import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { InconnectRecordAccessImportEnvCommand } from 'src/engine/core-modules/inconnect-record-access/commands/inconnect-record-access-import-env.command';
import { InconnectCommercialTeamMembershipEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team-membership.entity';
import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { InconnectCommercialTeamService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team.service';
import { InconnectRecordAccessConfigurationCandidateService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration-candidate.service';
import { InconnectRecordAccessConfigurationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration.service';
import { InconnectRecordAccessEnvironmentImportService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-environment-import.service';
import { InconnectRecordAccessPolicySourceService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-policy-source.service';
import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { WorkspaceInconnectRecordAccessPolicyMapsCacheService } from 'src/engine/core-modules/inconnect-record-access/services/workspace-inconnect-record-access-policy-maps-cache.service';
import { WorkspaceInconnectTeamAccessMapsCacheService } from 'src/engine/core-modules/inconnect-record-access/services/workspace-inconnect-team-access-maps-cache.service';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

@Module({
  imports: [
    TypeORMModule,
    TypeOrmModule.forFeature([
      InconnectCommercialTeamEntity,
      InconnectCommercialTeamMembershipEntity,
      InconnectRecordAccessConfigurationEntity,
      InconnectRecordAccessManagedObjectEntity,
      InconnectRecordAccessPolicyEntity,
    ]),
    WorkspaceCacheModule,
  ],
  providers: [
    InconnectRecordAccessService,
    InconnectCommercialTeamService,
    InconnectWorkspaceMemberService,
    WorkspaceInconnectTeamAccessMapsCacheService,
    WorkspaceInconnectRecordAccessPolicyMapsCacheService,
    InconnectRecordAccessPolicySourceService,
    InconnectRecordAccessConfigurationCandidateService,
    InconnectRecordAccessConfigurationService,
    InconnectRecordAccessEnvironmentImportService,
    InconnectRecordAccessImportEnvCommand,
  ],
  exports: [
    InconnectRecordAccessService,
    InconnectCommercialTeamService,
    InconnectRecordAccessPolicySourceService,
    InconnectRecordAccessConfigurationService,
    InconnectRecordAccessEnvironmentImportService,
  ],
})
export class InconnectRecordAccessModule {}
