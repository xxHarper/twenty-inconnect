import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource, type QueryRunner } from 'typeorm';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { normalizeVoiceDialNumber } from 'src/modules/inconnect-voice/inconnect-voice-dial-number';
import { InconnectVoiceDirectoryService } from 'src/modules/inconnect-voice/inconnect-voice-directory.service';

const workspaceId = 'workspace';
const config = {
  workspaceId,
  objectId: 'lead-object',
  fieldId: 'lead-phone',
  defaultCountry: 'MX',
} as InconnectVoiceConfig;
const actor = {
  type: 'user',
  workspace: { id: workspaceId, databaseSchema: 'workspace_test' },
  workspaceMemberId: 'member',
  userWorkspaceId: 'membership',
} as UserWorkspaceAuthContext;
const phone = normalizeVoiceDialNumber('55 1234 5678', config);
const map = <T extends { id: string }>(fields: T[]) => ({
  universalIdentifierById: Object.fromEntries(fields.map(({ id }) => [id, id])),
  byUniversalIdentifier: Object.fromEntries(
    fields.map((field) => [field.id, field]),
  ),
});

describe('Voice exact directory SQL without infrastructure', () => {
  const dataSource = new DataSource({ type: 'postgres' });
  const query = jest.fn();
  const permission = {
    canReadObjectRecords: true,
    restrictedFields: {} as Record<string, { canRead: boolean }>,
    rowLevelPermissionPredicates: [],
  };
  const cache = {
    getOrRecompute: jest.fn().mockResolvedValue({
      userWorkspaceRoleMap: { membership: 'role' },
      apiKeyRoleMap: {},
      rolesPermissions: { role: { [config.objectId]: permission } },
      flatObjectMetadataMaps: map([
        {
          id: config.objectId,
          nameSingular: 'salesLead',
          isActive: true,
          workspaceId,
          labelIdentifierFieldMetadataId: 'lead-label',
        },
      ]),
      flatFieldMetadataMaps: map([
        {
          id: config.fieldId,
          name: 'contactPhone',
          isActive: true,
          workspaceId,
          objectMetadataId: config.objectId,
          type: FieldMetadataType.PHONES,
        },
        {
          id: 'lead-label',
          name: 'displayName',
          isActive: true,
          workspaceId,
          objectMetadataId: config.objectId,
          type: FieldMetadataType.TEXT,
        },
      ]),
    }),
  };
  const recordAccess = {
    isAuthenticatedWorkspaceMemberValid: jest.fn().mockResolvedValue(true),
    applyOwnedReadScopeToQueryBuilder: jest.fn(({ queryBuilder }) => {
      queryBuilder.andWhere('"voiceLead"."liveOwner" = :requiredOwner', {
        requiredOwner: 'member',
      });
      return { kind: 'owner-scoped' };
    }),
    applyReadScopeToQueryBuilder: jest.fn(({ queryBuilder }) => {
      queryBuilder.andWhere('"voiceLead"."liveOwner" = :testPermittedOwner', {
        testPermittedOwner: 'member',
      });
      return { kind: 'owner-scoped' };
    }),
  };
  const directory = new InconnectVoiceDirectoryService(
    dataSource,
    cache as unknown as WorkspaceCacheService,
    recordAccess as unknown as InconnectRecordAccessAuthorizationService,
  );

  beforeEach(() => {
    permission.restrictedFields = {};
    permission.canReadObjectRecords = true;
    query.mockReset().mockResolvedValue({ records: [] });
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValue({
      query,
      release: jest.fn(),
    } as unknown as QueryRunner);
  });
  afterEach(() => jest.restoreAllMocks());

  it('applies metadata-derived exact phone and owner predicates before pagination', async () => {
    await expect(directory.lookup(actor, config, phone)).resolves.toEqual({
      candidates: [],
      next: null,
    });
    const [sql, parameters] = query.mock.calls[0];

    expect(sql).toContain('FROM "workspace_test"."_salesLead"');
    expect(sql).toContain('"voiceLead"."contactPhonePrimaryPhoneNumber"');
    expect(sql).toContain('"voiceLead"."displayName" AS "name"');
    expect(sql).toMatch(/"liveOwner" = \$\d+ ORDER BY .* LIMIT 11/);
    expect(parameters).toEqual(
      expect.arrayContaining([
        '+525512345678',
        '+5215512345678',
        '5512345678',
        'member',
      ]),
    );
    expect(sql).not.toContain('5512345678');
  });

  it('counts at most two exact matches before requiring the pilot to own the authorized Lead', async () => {
    const lead = await directory.query(actor, config, phone, true);
    const [sql, parameters] = lead.query
      .select(lead.id)
      .getQueryAndParameters();

    expect(sql).toMatch(
      /SELECT COUNT\(\*\) FROM \(SELECT [\s\S]* LIMIT 2\) AS exact_phone\) = 1/,
    );
    expect(sql).toMatch(
      /exact_phone\) = 1 AND "voiceLead"."liveOwner" = \$\d+/,
    );
    expect(parameters).toContain('member');
    expect(recordAccess.applyReadScopeToQueryBuilder).not.toHaveBeenCalled();
  });

  it('omits a restricted label and treats a restricted phone or row policy failure as a denial', async () => {
    permission.restrictedFields['lead-label'] = { canRead: false };
    await directory.lookup(actor, config, phone);
    expect(query.mock.calls[0][0]).toContain('NULL::text AS "name"');
    expect(query.mock.calls[0][0]).not.toContain('displayName');
    permission.restrictedFields[config.fieldId] = { canRead: false };
    await expect(directory.lookup(actor, config, phone)).rejects.toThrow(
      'Voice directory is unavailable',
    );
    permission.restrictedFields = {};
    recordAccess.applyReadScopeToQueryBuilder.mockReturnValueOnce({
      kind: 'denied',
    });
    await expect(directory.lookup(actor, config, phone)).rejects.toThrow(
      'Voice directory is unavailable',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('binds the current selected record in SQL and withholds unlinked dialing when any authorized match exists', async () => {
    const linked = await directory.dialCondition(
      actor,
      config,
      phone,
      'record',
    );
    const unlinked = await directory.dialCondition(actor, config, phone, null);

    expect(linked.sql).toContain('"voiceLead"."id" = call."recordId"');
    expect(unlinked.sql).toMatch(/^NOT EXISTS/);
    expect(unlinked.sql).toContain(
      '"voiceLead"."liveOwner" = :testPermittedOwner',
    );
    expect(unlinked.sql).not.toContain('call."recordId"');
  });
});
