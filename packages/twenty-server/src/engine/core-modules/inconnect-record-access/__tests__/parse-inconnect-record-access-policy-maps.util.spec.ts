import { type InconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';
import { parseInconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-record-access-policy-maps.util';

const MANAGED_OBJECT_ID = '00000000-0000-4000-8000-000000000001';
const OBJECT_METADATA_ID = '00000000-0000-4000-8000-000000000002';
const OWNER_FIELD_METADATA_ID = '00000000-0000-4000-8000-000000000003';
const POLICY_ID = '00000000-0000-4000-8000-000000000004';
const ROLE_ID = '00000000-0000-4000-8000-000000000005';

const validManagedPayload = (): Extract<
  InconnectRecordAccessPolicyMaps,
  { status: 'valid'; enforcementMode: 'MANAGED' }
> => ({
  version: 1,
  status: 'valid',
  enforcementMode: 'MANAGED',
  revision: '3',
  managedObjects: [
    {
      id: MANAGED_OBJECT_ID,
      objectMetadataId: OBJECT_METADATA_ID,
      ownerFieldMetadataId: OWNER_FIELD_METADATA_ID,
      ownerFieldName: 'owner',
      ownerJoinColumnName: 'ownerId',
      ownerRequirement: 'required',
      policies: [
        {
          id: POLICY_ID,
          roleId: ROLE_ID,
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
        },
      ],
    },
  ],
});

describe('parseInconnectRecordAccessPolicyMaps', () => {
  it('accepts versioned MANAGED, UNMANAGED and absent payloads', () => {
    expect(parseInconnectRecordAccessPolicyMaps(validManagedPayload())).toEqual(
      validManagedPayload(),
    );
    expect(
      parseInconnectRecordAccessPolicyMaps({
        version: 1,
        status: 'valid',
        enforcementMode: 'UNMANAGED',
        revision: '0',
      }),
    ).toEqual({
      version: 1,
      status: 'valid',
      enforcementMode: 'UNMANAGED',
      revision: '0',
    });
    expect(
      parseInconnectRecordAccessPolicyMaps({
        version: 1,
        status: 'absent',
      }),
    ).toEqual({ version: 1, status: 'absent' });
  });

  it.each([
    ['malformed value', 'broken'],
    [
      'contradictory absent payload',
      { version: 1, status: 'absent', managedObjects: [] },
    ],
    [
      'unknown managed payload property',
      { ...validManagedPayload(), unexpected: true },
    ],
    ['unknown version', { ...validManagedPayload(), version: 2 }],
    ['unknown status', { ...validManagedPayload(), status: 'unknown' }],
    ['invalid revision', { ...validManagedPayload(), revision: '-1' }],
    [
      'revision outside PostgreSQL bigint',
      { ...validManagedPayload(), revision: '9223372036854775808' },
    ],
    ['empty managed set', { ...validManagedPayload(), managedObjects: [] }],
    [
      'children below UNMANAGED',
      {
        version: 1,
        status: 'valid',
        enforcementMode: 'UNMANAGED',
        revision: '0',
        managedObjects: [],
      },
    ],
  ])('fails closed for %s', (_name, value) => {
    expect(parseInconnectRecordAccessPolicyMaps(value)).toMatchObject({
      version: 1,
      status: 'invalid',
      failureKind: 'corrupt',
    });
  });

  it.each([
    ['managed object UUID', 'id', 'invalid'],
    ['object UUID', 'objectMetadataId', 'invalid'],
    ['owner field UUID', 'ownerFieldMetadataId', 'invalid'],
    ['owner field name', 'ownerFieldName', ''],
    ['owner join column', 'ownerJoinColumnName', ''],
    ['owner requirement', 'ownerRequirement', 'unknown'],
    ['policies array', 'policies', 'invalid'],
  ])('rejects an invalid %s', (_name, property, value) => {
    const payload = validManagedPayload();

    Object.assign(payload.managedObjects[0], { [property]: value });

    expect(parseInconnectRecordAccessPolicyMaps(payload)).toMatchObject({
      status: 'invalid',
      failureKind: 'corrupt',
    });
  });

  it.each([
    ['policy UUID', 'id', 'invalid'],
    ['Role UUID', 'roleId', 'invalid'],
    ['record effect', 'recordEffect', 'unknown'],
    ['create policy', 'createPolicy', 'unknown'],
    ['owner transfer policy', 'ownerTransferPolicy', 'unknown'],
    ['missing owner policy', 'missingOwnerPolicy', 'unknown'],
    ['default Role UUID', 'defaultOwnerRoleId', 'invalid'],
  ])('rejects an invalid %s', (_name, property, value) => {
    const payload = validManagedPayload();

    Object.assign(payload.managedObjects[0].policies[0], {
      [property]: value,
    });

    expect(parseInconnectRecordAccessPolicyMaps(payload)).toMatchObject({
      status: 'invalid',
      failureKind: 'corrupt',
    });
  });

  it('rejects missing-owner/default-role and create-policy contradictions', () => {
    const missingDefault = validManagedPayload();
    const unexpectedDefault = validManagedPayload();
    const invalidCreate = validManagedPayload();

    missingDefault.managedObjects[0].policies[0].missingOwnerPolicy =
      'singleActiveMemberOfRole';
    unexpectedDefault.managedObjects[0].policies[0].defaultOwnerRoleId =
      ROLE_ID;
    invalidCreate.managedObjects[0].policies[0].createPolicy = 'defaultOwner';

    for (const payload of [missingDefault, unexpectedDefault, invalidCreate]) {
      expect(parseInconnectRecordAccessPolicyMaps(payload)).toMatchObject({
        status: 'invalid',
        failureKind: 'corrupt',
      });
    }
  });

  it('rejects duplicate managed objects, object metadata, policies and Role policies', () => {
    const duplicateManagedObject = validManagedPayload();
    const duplicatePolicy = validManagedPayload();

    duplicateManagedObject.managedObjects.push({
      ...duplicateManagedObject.managedObjects[0],
      policies: [],
    });
    duplicatePolicy.managedObjects[0].policies.push({
      ...duplicatePolicy.managedObjects[0].policies[0],
    });

    expect(
      parseInconnectRecordAccessPolicyMaps(duplicateManagedObject),
    ).toMatchObject({ status: 'invalid' });
    expect(parseInconnectRecordAccessPolicyMaps(duplicatePolicy)).toMatchObject(
      { status: 'invalid' },
    );
  });

  it('preserves an explicit invalid/recomputation-failed state', () => {
    expect(
      parseInconnectRecordAccessPolicyMaps({
        version: 1,
        status: 'invalid',
        reason: 'revoked',
        failureKind: 'recomputation-failed',
      }),
    ).toEqual({
      version: 1,
      status: 'invalid',
      reason: 'revoked',
      failureKind: 'recomputation-failed',
    });
  });
});
