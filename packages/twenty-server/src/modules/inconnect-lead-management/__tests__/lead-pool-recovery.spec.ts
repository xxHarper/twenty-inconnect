import { ForbiddenException } from '@nestjs/common';

import { GraphQLError } from 'graphql';

import { convertGraphQLErrorToBaseGraphQLError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { LeadPoolService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool.service';
import { makeAuthorityHarness } from './lead-pool-authority.fixtures';
import {
  actor,
  makePoolHarness,
  originId,
  poolId,
  poolInput,
  recipientId,
} from './lead-pool.fixtures';

it('proves an invalid preview absent under lock and a successful rollback before publishing a correlated correction signal', async () => {
  const harness = makePoolHarness(1);
  const input = {
    ...poolInput(1),
    mode: 'MANUAL_QUOTAS',
    quotas: [{ recipientId, quantity: 2 }],
  };
  let rejected!: GraphQLError;
  try {
    await harness.service.preview(actor, input);
  } catch (error) {
    rejected = error as GraphQLError;
  }
  expect(rejected).toBeInstanceOf(GraphQLError);
  expect(rejected.extensions.leadPoolPreview).toEqual({
    outcome: 'REJECTED',
    reason: 'VALIDATION',
    intentionId: input.intentionId,
  });
  // The actual metadata error conversion must preserve the explicit proof.
  expect(
    convertGraphQLErrorToBaseGraphQLError(rejected).extensions.leadPoolPreview,
  ).toEqual(rejected.extensions.leadPoolPreview);
  expect(harness.operations().size).toBe(0);
  expect(harness.writes()).toBe(0);
  expect(harness.sql.some(({ query }) => query === 'ROLLBACK')).toBe(true);
  expect(
    harness.sql.some(({ query }) => query.includes('pg_advisory_xact_lock')),
  ).toBe(true);
  const corrected = await harness.service.preview(actor, {
    ...input,
    quotas: [{ recipientId, quantity: 1 }],
  });
  expect(corrected.status).toBe('PREVIEW');
});

it('signals a permission rejection only when absence and rollback are confirmed', async () => {
  const harness = makePoolHarness(1);
  harness.resolve.mockRejectedValueOnce(
    new ForbiddenException('Current permission denied'),
  );
  await expect(
    harness.service.preview(actor, poolInput(1)),
  ).rejects.toMatchObject({
    extensions: {
      leadPoolPreview: { outcome: 'REJECTED', reason: 'PERMISSION' },
    },
  });
  expect(harness.operations().size).toBe(0);
  const original = await harness.service.preview(actor, poolInput(1));
  harness.resolve.mockRejectedValueOnce(
    new ForbiddenException('Current permission denied'),
  );
  await expect(
    harness.service.preview(actor, poolInput(1)),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(harness.operations().size).toBe(1);
  expect(
    (await harness.service.result(actor, { operationId: original.id })).id,
  ).toBe(original.id);
});

it('never converts a persisted preview with a lost response into an absent operation', async () => {
  const harness = makePoolHarness(1);
  harness.loseCommit();
  await expect(harness.service.preview(actor, poolInput(1))).rejects.toThrow(
    'commit',
  );
  expect(harness.operations().size).toBe(1);
  const recovered = await harness.service.preview(actor, poolInput(1));
  expect(recovered.intentionId).toBe(poolInput(1).intentionId);
  expect(harness.operations().size).toBe(1);
  expect(harness.writes()).toBe(0);
});

it('does not publish definitive absence if the rollback cannot be confirmed', async () => {
  const harness = makePoolHarness(1);
  jest
    .spyOn(harness.store, 'transaction')
    .mockImplementationOnce(async (_auth, _callback, _onConfirmedRollback) => {
      throw new ForbiddenException('Uncertain transaction');
    });
  await expect(
    harness.service.preview(actor, poolInput(1)),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

it.each([
  'active',
  'deleted',
  'blank label',
  'member read',
  'member name',
] as const)(
  'recovers original destinations with real current authority: %s',
  async (condition) => {
    const harness = makePoolHarness(1);
    const authority = makeAuthorityHarness();
    const service = new LeadPoolService(
      authority.service,
      harness.queries,
      harness.store,
      {} as never,
    );
    const preview = await service.preview(actor, poolInput(1));
    expect(preview.recipients).toEqual([
      {
        id: recipientId,
        label: 'Ejecutivo Autorizado',
        assignable: true,
        quantity: 1,
      },
    ]);
    if (condition === 'deleted')
      authority.members?.getAssignableWorkspaceMemberProfiles.mockResolvedValue(
        [],
      );
    if (condition === 'blank label') {
      authority.profile.firstName = '';
      authority.profile.lastName = '';
    }
    if (condition === 'member read')
      authority.maps.rolesPermissions[authority.roleId][
        authority.targetId
      ].canReadObjectRecords = false;
    if (condition === 'member name')
      authority.maps.rolesPermissions[authority.roleId][
        authority.targetId
      ].restrictedFields[poolId(80)] = { canRead: false };
    const recovered = await service.result(actor, { operationId: preview.id });
    expect(recovered.selected).toBe(1);
    expect(recovered.recipients[0].id).toBe(recipientId);
    expect(recovered.canExecute).toBe(condition === 'active');
    expect(recovered.recipients[0].label).toBe(
      condition === 'active' ? 'Ejecutivo Autorizado' : null,
    );
    if (condition !== 'active')
      await expect(
        service.execute(actor, { operationId: preview.id, expectedVersion: 0 }),
      ).rejects.toThrow();
    expect(harness.writes()).toBe(0);
  },
);

it('identifies each of multiple original destinations and keeps them distinct from later form choices', async () => {
  const harness = makePoolHarness(2);
  const preview = await harness.service.preview(actor, {
    ...poolInput(2),
    mode: 'EVEN',
    recipientIds: [recipientId, poolId(21)],
  });
  harness.authority.recipients.push({
    id: poolId(22),
    label: 'New form option',
  });
  const result = await harness.service.result(actor, {
    operationId: preview.id,
  });
  expect(result.recipients).toEqual([
    { id: recipientId, label: 'Ejecutivo A', assignable: true, quantity: 1 },
    { id: poolId(21), label: 'Ejecutivo B', assignable: true, quantity: 1 },
  ]);
  expect(result.canExecute).toBe(true);
});

it('never exposes operation destinations to another actor or workspace', async () => {
  const harness = makePoolHarness(1);
  const preview = await harness.service.preview(actor, poolInput(1));
  for (const auth of [
    { ...actor, workspace: { ...actor.workspace, id: poolId(999) } },
    { ...actor, user: { ...actor.user, id: poolId(999) } },
  ]) {
    await expect(
      harness.service.result(auth, { operationId: preview.id }),
    ).rejects.toThrow();
  }
  expect(
    (await harness.service.result(actor, { operationId: preview.id })).objectId,
  ).toBe(originId);
});

it('does not claim absence when an intention belongs to the same user under a previous membership', async () => {
  const harness = makePoolHarness(1);
  await harness.service.preview(actor, poolInput(1));
  const row = [...harness.operations().values()][0];
  row.actorMemberId = poolId(999);
  harness.resolve.mockRejectedValueOnce(new ForbiddenException('Denied'));
  await expect(
    harness.service.preview(actor, poolInput(1)),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(harness.operations().size).toBe(1);
});
