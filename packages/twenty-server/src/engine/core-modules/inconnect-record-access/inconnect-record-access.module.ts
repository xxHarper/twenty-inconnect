import { Module } from '@nestjs/common';

import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';

@Module({
  providers: [InconnectRecordAccessService],
  exports: [InconnectRecordAccessService],
})
export class InconnectRecordAccessModule {}
