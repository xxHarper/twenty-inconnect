import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.32.0', 1790793305700)
export class AddInconnectMessagingAutomationPrincipalFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD "automationUserWorkspaceId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" ADD CONSTRAINT "FK_INCONNECT_MSG_CONFIG_AUTOMATION_USER_WORKSPACE" FOREIGN KEY ("automationUserWorkspaceId") REFERENCES "core"."userWorkspace"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP CONSTRAINT "FK_INCONNECT_MSG_CONFIG_AUTOMATION_USER_WORKSPACE"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."inconnectMessagingConfiguration" DROP COLUMN "automationUserWorkspaceId"',
    );
  }
}
