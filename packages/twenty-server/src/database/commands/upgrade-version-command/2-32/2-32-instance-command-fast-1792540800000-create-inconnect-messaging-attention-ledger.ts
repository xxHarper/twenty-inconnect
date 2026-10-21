import { type QueryRunner } from 'typeorm';

import { ATTENTION_LEDGER_ADMISSION_UP } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-admission';
import {
  ATTENTION_LEDGER_AGGREGATE_GUARDS,
  ATTENTION_LEDGER_AGGREGATE_GUARDS_DOWN,
} from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-aggregate';
import {
  ATTENTION_LEDGER_LINK_GUARDS,
  ATTENTION_LEDGER_LINK_GUARDS_DOWN,
} from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-links';
import { ATTENTION_LEDGER_RESULT_FUNCTION } from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-result';
import {
  ATTENTION_LEDGER_ROW_GUARDS,
  ATTENTION_LEDGER_ROW_GUARDS_DOWN,
} from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-row-guards';
import {
  ATTENTION_LEDGER_STRUCTURE_DOWN,
  ATTENTION_LEDGER_STRUCTURE_UP,
} from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-structure';
import {
  ATTENTION_LEDGER_TRIGGERS_DOWN,
  ATTENTION_LEDGER_TRIGGERS_UP,
} from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-triggers';
import {
  ATTENTION_LEDGER_VALUE_FUNCTIONS,
  ATTENTION_LEDGER_VALUE_FUNCTIONS_DOWN,
} from 'src/database/commands/upgrade-version-command/2-32/inconnect-attention-ledger-1792540800000/attention-ledger-values';
import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// These lists are inspectable without invoking either command method or a driver.
export const ATTENTION_LEDGER_UP: readonly string[] = [
  ...ATTENTION_LEDGER_STRUCTURE_UP,
  ...ATTENTION_LEDGER_VALUE_FUNCTIONS,
  ATTENTION_LEDGER_RESULT_FUNCTION,
  ...ATTENTION_LEDGER_ADMISSION_UP,
  ...ATTENTION_LEDGER_ROW_GUARDS,
  ...ATTENTION_LEDGER_LINK_GUARDS,
  ...ATTENTION_LEDGER_AGGREGATE_GUARDS,
  ...ATTENTION_LEDGER_TRIGGERS_UP,
];

// Down intentionally loses ledger history, but preserves pendingAt and Messages.
// It is a separately authorized destructive downgrade, never an activation rollback.
export const ATTENTION_LEDGER_DOWN: readonly string[] = [
  ...ATTENTION_LEDGER_TRIGGERS_DOWN,
  ...ATTENTION_LEDGER_AGGREGATE_GUARDS_DOWN,
  ...ATTENTION_LEDGER_LINK_GUARDS_DOWN,
  ...ATTENTION_LEDGER_ROW_GUARDS_DOWN,
  ...ATTENTION_LEDGER_STRUCTURE_DOWN,
  'DROP FUNCTION core.im_at_result_valid(jsonb,text,text,text,uuid,uuid,uuid)',
  ...ATTENTION_LEDGER_VALUE_FUNCTIONS_DOWN,
];

@RegisteredInstanceCommand('2.32.0', 1792540800000)
export class CreateInconnectMessagingAttentionLedgerFastInstanceCommand implements FastInstanceCommand {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of ATTENTION_LEDGER_UP) {
      await queryRunner.query(statement);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of ATTENTION_LEDGER_DOWN) {
      await queryRunner.query(statement);
    }
  }
}
