import { type ObjectsPermissions } from 'twenty-shared/types';
import {
  InsertQueryBuilder,
  type InsertResult,
  type ObjectLiteral,
  type QueryRunner,
} from 'typeorm';

import { type FeatureFlagMap } from 'src/engine/core-modules/feature-flag/interfaces/feature-flag-map.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { WorkspaceInsertQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-insert-query-builder';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_WORKSPACE_MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const SUPERVISOR_WORKSPACE_MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const EXPLICIT_OWNER_WORKSPACE_MEMBER_ID =
  '55555555-5555-4555-8555-555555555555';
const FIRST_RECORD_ID = '66666666-6666-4666-8666-666666666666';
const SECOND_RECORD_ID = '77777777-7777-4777-8777-777777777777';
const WORKSPACE_SCHEMA = 'workspace_11111111-1111-4111-8111-111111111111';

const decision: InconnectRecordAccessDecision = {
  kind: 'all-records',
  ownerFieldMetadataId: 'owner-field-id',
  ownerFieldName: 'propietarioDeLead',
  ownerJoinColumnName: 'propietarioDeLeadId',
  authenticatedWorkspaceMemberId: ADMIN_WORKSPACE_MEMBER_ID,
  assignableOwnerWorkspaceMemberIds: [ADMIN_WORKSPACE_MEMBER_ID],
  createPolicy: 'standardPermissionsOnly',
  ownerTransferPolicy: 'standardPermissionsOnly',
  ownerRequirement: 'required',
  missingOwnerPolicy: 'singleActiveMemberOfRole',
  defaultOwnerRoleId: ROLE_ID,
  sourceRecordEffect: 'allRecords',
};

type TestableInsertBuilder = {
  executeInsertWithInconnectOwnerIntegrity: (
    resolvedDecision: InconnectRecordAccessDecision,
  ) => Promise<InsertResult>;
  executeInsertReturningCompleteRows: (
    resolvedDecision: InconnectRecordAccessDecision,
  ) => Promise<InsertResult>;
  getCompleteRowsFromInsertResult: (result: InsertResult) => ObjectLiteral[];
  projectCompleteRowsToCallerReturning: (rawResult: unknown) => ObjectLiteral[];
  expressionMap: {
    returning: string[] | '*';
    valuesSet: ObjectLiteral | ObjectLiteral[];
  };
};

const buildQueryRunner = ({
  candidateIds,
  transactionActive = false,
}: {
  candidateIds: string[];
  transactionActive?: boolean;
}): QueryRunner => {
  let isTransactionActive = transactionActive;

  return {
    get isTransactionActive() {
      return isTransactionActive;
    },
    startTransaction: jest.fn(async () => {
      isTransactionActive = true;
    }),
    commitTransaction: jest.fn(async () => {
      isTransactionActive = false;
    }),
    rollbackTransaction: jest.fn(async () => {
      isTransactionActive = false;
    }),
    release: jest.fn(),
    query: jest
      .fn()
      .mockResolvedValueOnce([{ id: ROLE_ID }])
      .mockResolvedValueOnce(candidateIds.map((id) => ({ id }))),
  } as unknown as QueryRunner;
};

const buildBuilder = ({
  valuesSet,
  queryRunner,
}: {
  valuesSet: ObjectLiteral | ObjectLiteral[];
  queryRunner: QueryRunner;
}): TestableInsertBuilder => {
  const expressionMap = {
    returning: ['id'],
    valuesSet,
    mainAlias: {
      metadata: {
        schema: WORKSPACE_SCHEMA,
      },
    },
  };
  const sourceQueryBuilder = {
    connection: {},
    queryRunner,
    expressionMap: {
      clone: () => expressionMap,
    },
  } as unknown as InsertQueryBuilder<ObjectLiteral>;
  const builder = new WorkspaceInsertQueryBuilder(
    sourceQueryBuilder,
    {} as ObjectsPermissions,
    { workspaceId: WORKSPACE_ID } as WorkspaceInternalContext,
    false,
    {
      type: 'user',
      workspace: { id: WORKSPACE_ID },
      workspaceMemberId: ADMIN_WORKSPACE_MEMBER_ID,
    } as WorkspaceAuthContext,
    {} as FeatureFlagMap,
  );

  Object.defineProperty(builder, 'validateRLSPredicatesForInsert', {
    value: jest.fn(),
  });

  return builder as unknown as TestableInsertBuilder;
};

describe('WorkspaceInsertQueryBuilder INCONNECT owner integrity', () => {
  const insertResult: InsertResult = {
    identifiers: [{ id: 'record-id' }],
    generatedMaps: [],
    raw: [],
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('locks, resolves and inserts the default owner in one transaction', async () => {
    const queryRunner = buildQueryRunner({
      candidateIds: [SUPERVISOR_WORKSPACE_MEMBER_ID],
    });
    const builder = buildBuilder({
      valuesSet: [{ name: 'A' }, { name: 'B' }],
      queryRunner,
    });
    const executeSpy = jest
      .spyOn(InsertQueryBuilder.prototype, 'execute')
      .mockResolvedValue(insertResult);

    await expect(
      builder.executeInsertWithInconnectOwnerIntegrity(decision),
    ).resolves.toBe(insertResult);

    expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(builder.expressionMap.valuesSet).toEqual([
      {
        name: 'A',
        propietarioDeLeadId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      },
      {
        name: 'B',
        propietarioDeLeadId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      },
    ]);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(
      (queryRunner.commitTransaction as jest.Mock).mock.invocationCallOrder[0],
    ).toBeGreaterThan(executeSpy.mock.invocationCallOrder[0]);
  });

  it('reuses a caller-owned transaction without managing its lifecycle', async () => {
    const queryRunner = buildQueryRunner({
      candidateIds: [SUPERVISOR_WORKSPACE_MEMBER_ID],
      transactionActive: true,
    });
    const builder = buildBuilder({
      valuesSet: [{ name: 'Caller owned' }],
      queryRunner,
    });
    const executeSpy = jest
      .spyOn(InsertQueryBuilder.prototype, 'execute')
      .mockResolvedValue(insertResult);

    await expect(
      builder.executeInsertWithInconnectOwnerIntegrity(decision),
    ).resolves.toBe(insertResult);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).not.toHaveBeenCalled();
    expect(queryRunner.isTransactionActive).toBe(true);
  });

  it('rolls back before INSERT when the default Role has multiple active members', async () => {
    const queryRunner = buildQueryRunner({
      candidateIds: [
        SUPERVISOR_WORKSPACE_MEMBER_ID,
        EXPLICIT_OWNER_WORKSPACE_MEMBER_ID,
      ],
    });
    const builder = buildBuilder({
      valuesSet: { name: 'Ambiguous' },
      queryRunner,
    });
    const executeSpy = jest
      .spyOn(InsertQueryBuilder.prototype, 'execute')
      .mockResolvedValue(insertResult);

    await expect(
      builder.executeInsertWithInconnectOwnerIntegrity(decision),
    ).rejects.toEqual(
      expect.objectContaining({
        code: InconnectRecordAccessExceptionCode.ACCESS_DENIED,
      }) as InconnectRecordAccessException,
    );

    expect(executeSpy).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('does not resolve the default Role when every record has an explicit owner', async () => {
    const queryRunner = buildQueryRunner({
      candidateIds: [
        SUPERVISOR_WORKSPACE_MEMBER_ID,
        EXPLICIT_OWNER_WORKSPACE_MEMBER_ID,
      ],
    });
    const valuesSet = [
      {
        name: 'Explicit',
        propietarioDeLeadId: EXPLICIT_OWNER_WORKSPACE_MEMBER_ID,
      },
    ];
    const builder = buildBuilder({ valuesSet, queryRunner });
    const executeSpy = jest
      .spyOn(InsertQueryBuilder.prototype, 'execute')
      .mockResolvedValue(insertResult);

    await expect(
      builder.executeInsertWithInconnectOwnerIntegrity(decision),
    ).resolves.toBe(insertResult);

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(queryRunner.query).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(builder.expressionMap.valuesSet).toEqual(valuesSet);
  });

  it('rejects one null owner in create-many before INSERT', async () => {
    const queryRunner = buildQueryRunner({
      candidateIds: [SUPERVISOR_WORKSPACE_MEMBER_ID],
    });
    const builder = buildBuilder({
      valuesSet: [
        { name: 'Defaulted' },
        { name: 'Invalid', propietarioDeLeadId: null },
      ],
      queryRunner,
    });
    const executeSpy = jest
      .spyOn(InsertQueryBuilder.prototype, 'execute')
      .mockResolvedValue(insertResult);

    await expect(
      builder.executeInsertWithInconnectOwnerIntegrity(decision),
    ).rejects.toBeInstanceOf(InconnectRecordAccessException);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('widens only the SQL RETURNING projection and restores the caller projection', async () => {
    const queryRunner = buildQueryRunner({ candidateIds: [] });
    const builder = buildBuilder({
      valuesSet: { name: 'Narrow' },
      queryRunner,
    });
    const completeInsertResult: InsertResult = {
      identifiers: [{ id: FIRST_RECORD_ID }],
      generatedMaps: [{ id: FIRST_RECORD_ID, name: 'Narrow' }],
      raw: [{ id: FIRST_RECORD_ID, name: 'Narrow', privateField: 'secret' }],
    };
    const executeInsert = jest.fn().mockImplementation(async () => {
      expect(builder.expressionMap.returning).toBe('*');

      return completeInsertResult;
    });

    Object.defineProperty(builder, 'executeInsertWithInconnectOwnerIntegrity', {
      value: executeInsert,
    });

    await expect(
      builder.executeInsertReturningCompleteRows(decision),
    ).resolves.toBe(completeInsertResult);
    expect(builder.expressionMap.returning).toEqual(['id']);
    expect(
      builder.projectCompleteRowsToCallerReturning(completeInsertResult.raw),
    ).toEqual([{ id: FIRST_RECORD_ID }]);
  });

  it('restores the caller projection when INSERT fails', async () => {
    const queryRunner = buildQueryRunner({ candidateIds: [] });
    const builder = buildBuilder({
      valuesSet: { name: 'Failure' },
      queryRunner,
    });

    Object.defineProperty(builder, 'executeInsertWithInconnectOwnerIntegrity', {
      value: jest.fn().mockRejectedValue(new Error('insert failed')),
    });

    await expect(
      builder.executeInsertReturningCompleteRows(decision),
    ).rejects.toThrow('insert failed');
    expect(builder.expressionMap.returning).toEqual(['id']);
  });

  it('orders complete event rows by authoritative identifier order', () => {
    const queryRunner = buildQueryRunner({ candidateIds: [] });
    const builder = buildBuilder({ valuesSet: [], queryRunner });

    expect(
      builder.getCompleteRowsFromInsertResult({
        identifiers: [{ id: FIRST_RECORD_ID }, { id: SECOND_RECORD_ID }],
        generatedMaps: [],
        raw: [
          { id: SECOND_RECORD_ID, name: 'Second' },
          { id: FIRST_RECORD_ID, name: 'First' },
        ],
      }),
    ).toEqual([
      { id: FIRST_RECORD_ID, name: 'First' },
      { id: SECOND_RECORD_ID, name: 'Second' },
    ]);
  });

  it.each([
    [
      'missing row',
      {
        identifiers: [{ id: FIRST_RECORD_ID }, { id: SECOND_RECORD_ID }],
        generatedMaps: [],
        raw: [{ id: FIRST_RECORD_ID }],
      },
    ],
    [
      'unexpected row',
      {
        identifiers: [{ id: FIRST_RECORD_ID }],
        generatedMaps: [],
        raw: [{ id: FIRST_RECORD_ID }, { id: SECOND_RECORD_ID }],
      },
    ],
    [
      'duplicate returned ID',
      {
        identifiers: [{ id: FIRST_RECORD_ID }, { id: SECOND_RECORD_ID }],
        generatedMaps: [],
        raw: [{ id: FIRST_RECORD_ID }, { id: FIRST_RECORD_ID }],
      },
    ],
    [
      'duplicate authoritative ID',
      {
        identifiers: [{ id: FIRST_RECORD_ID }, { id: FIRST_RECORD_ID }],
        generatedMaps: [],
        raw: [{ id: FIRST_RECORD_ID }, { id: SECOND_RECORD_ID }],
      },
    ],
    [
      'invalid returned ID',
      {
        identifiers: [{ id: FIRST_RECORD_ID }],
        generatedMaps: [],
        raw: [{ id: 'caller-input-is-not-authority' }],
      },
    ],
    [
      'invalid authoritative ID',
      {
        identifiers: [{ id: 'caller-input-is-not-authority' }],
        generatedMaps: [],
        raw: [{ id: FIRST_RECORD_ID }],
      },
    ],
  ] satisfies Array<[string, InsertResult]>)(
    'fails closed for %s',
    (_label, result) => {
      const queryRunner = buildQueryRunner({ candidateIds: [] });
      const builder = buildBuilder({ valuesSet: [], queryRunner });

      expect(() => builder.getCompleteRowsFromInsertResult(result)).toThrow(
        expect.objectContaining({
          code: 'ORM_EVENT_DATA_CORRUPTED',
        }),
      );
    },
  );
});
