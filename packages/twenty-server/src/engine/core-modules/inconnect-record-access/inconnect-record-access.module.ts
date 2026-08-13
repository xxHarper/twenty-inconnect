import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { InconnectCommercialTeamMembershipEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team-membership.entity';
import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { InconnectCommercialTeamService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team.service';
import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { WorkspaceInconnectTeamAccessMapsCacheService } from 'src/engine/core-modules/inconnect-record-access/services/workspace-inconnect-team-access-maps-cache.service';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

@Module({
  imports: [
    TypeORMModule,
    TypeOrmModule.forFeature([
      InconnectCommercialTeamEntity,
      InconnectCommercialTeamMembershipEntity,
    ]),
    WorkspaceCacheModule,
  ],
  providers: [
    InconnectRecordAccessService,
    InconnectCommercialTeamService,
    InconnectWorkspaceMemberService,
    WorkspaceInconnectTeamAccessMapsCacheService,
  ],
  exports: [InconnectRecordAccessService, InconnectCommercialTeamService],
})
export class InconnectRecordAccessModule {}
