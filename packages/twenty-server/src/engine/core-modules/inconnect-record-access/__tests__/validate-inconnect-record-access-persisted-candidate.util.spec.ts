import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import {
  createEightRulePersistedCandidateFixture,
  INCONNECT_PERSISTED_FIXTURE_IDS,
} from 'src/engine/core-modules/inconnect-record-access/__tests__/fixtures/inconnect-record-access-persisted-candidate.fixture';
import { type InconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { validateInconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/utils/validate-inconnect-record-access-persisted-candidate.util';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';

const expectErrorCode = (
  candidate: InconnectRecordAccessPersistedCandidate,
  code: string,
) => {
  const result = validateInconnectRecordAccessPersistedCandidate(candidate);

  expect(result.valid).toBe(false);
  expect(result.errors).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
};

describe('validateInconnectRecordAccessPersistedCandidate', () => {
  it('accepts the current two managed objects and eight Role policies', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    expect(candidate.managedObjects).toHaveLength(2);
    expect(candidate.policies).toHaveLength(8);
    expect(validateInconnectRecordAccessPersistedCandidate(candidate)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    ['enforcementMode', 'BROKEN'],
    ['revision', '-1'],
  ])('rejects an invalid configuration %s', (property, value) => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.configuration = {
      ...candidate.configuration,
      [property]: value,
    };

    expectErrorCode(candidate, 'INVALID_CONFIGURATION');
  });

  it('rejects an unknown policy enum', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.policies[0].recordEffect = 'unknown';

    expectErrorCode(candidate, 'INVALID_POLICY');
  });

  it('rejects duplicate managed objects', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.managedObjects = [
      ...candidate.managedObjects,
      {
        ...candidate.managedObjects[0],
        id: '00000000-0000-4000-8000-000000000099',
      },
    ];

    expectErrorCode(candidate, 'DUPLICATE_MANAGED_OBJECT');
  });

  it('rejects duplicate policies for the same Role and managed object', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.policies = [
      ...candidate.policies,
      {
        ...candidate.policies[0],
        id: '00000000-0000-4000-8000-000000000199',
      },
    ];

    expectErrorCode(candidate, 'DUPLICATE_POLICY');
  });

  it.each([
    [
      'managed object',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.managedObjects[0].workspaceId =
          INCONNECT_PERSISTED_FIXTURE_IDS.otherWorkspace;
      },
    ],
    [
      'Role',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.roles[0].workspaceId =
          INCONNECT_PERSISTED_FIXTURE_IDS.otherWorkspace;
      },
    ],
    [
      'ObjectMetadata',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.objects[0].workspaceId =
          INCONNECT_PERSISTED_FIXTURE_IDS.otherWorkspace;
      },
    ],
    [
      'FieldMetadata',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.fields[0].workspaceId =
          INCONNECT_PERSISTED_FIXTURE_IDS.otherWorkspace;
      },
    ],
    [
      'default Role',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        const supervisorRole = candidate.roles.find(
          ({ id }) => id === INCONNECT_PERSISTED_FIXTURE_IDS.supervisorRole,
        );

        expect(supervisorRole).toBeDefined();
        supervisorRole!.workspaceId =
          INCONNECT_PERSISTED_FIXTURE_IDS.otherWorkspace;
      },
    ],
  ])('rejects a %s workspace mismatch', (_name, mutateCandidate) => {
    const candidate = createEightRulePersistedCandidateFixture();

    mutateCandidate(candidate);

    expectErrorCode(candidate, 'WORKSPACE_MISMATCH');
  });

  it.each([
    [
      'Role',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.roles = candidate.roles.filter(
          ({ id }) => id !== INCONNECT_PERSISTED_FIXTURE_IDS.executiveRole,
        );
      },
    ],
    [
      'ObjectMetadata',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.objects = candidate.objects.filter(
          ({ id }) => id !== INCONNECT_PERSISTED_FIXTURE_IDS.leadObject,
        );
      },
    ],
    [
      'FieldMetadata',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.fields = candidate.fields.filter(
          ({ id }) => id !== INCONNECT_PERSISTED_FIXTURE_IDS.leadOwnerField,
        );
      },
    ],
    [
      'default Role',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.roles = candidate.roles.filter(
          ({ id }) => id !== INCONNECT_PERSISTED_FIXTURE_IDS.supervisorRole,
        );
      },
    ],
  ])('rejects a missing or deleted %s reference', (_name, mutateCandidate) => {
    const candidate = createEightRulePersistedCandidateFixture();

    mutateCandidate(candidate);

    expectErrorCode(candidate, 'MISSING_REFERENCE');
  });

  it.each([
    [
      'ObjectMetadata',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.objects[0].isActive = false;
      },
    ],
    [
      'FieldMetadata',
      (candidate: InconnectRecordAccessPersistedCandidate) => {
        candidate.fields[0].isActive = false;
      },
    ],
  ])('rejects inactive %s', (_name, mutateCandidate) => {
    const candidate = createEightRulePersistedCandidateFixture();

    mutateCandidate(candidate);

    expectErrorCode(candidate, 'INACTIVE_REFERENCE');
  });

  it('rejects an owner field belonging to another object', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.fields[0].objectMetadataId =
      INCONNECT_PERSISTED_FIXTURE_IDS.folioObject;

    expectErrorCode(candidate, 'INVALID_OWNER_FIELD');
  });

  it('rejects an owner field that is not a relation', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.fields[0].type = FieldMetadataType.TEXT;

    expectErrorCode(candidate, 'INVALID_OWNER_FIELD');
  });

  it('rejects an owner relation that is not MANY_TO_ONE', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.fields[0].settings = {
      relationType: RelationType.ONE_TO_MANY,
    };

    expectErrorCode(candidate, 'INVALID_OWNER_FIELD');
  });

  it('rejects an owner relation targeting an object other than workspaceMember', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.objects[2].universalIdentifier =
      STANDARD_OBJECTS.person.universalIdentifier;

    expectErrorCode(candidate, 'INVALID_OWNER_FIELD');
  });

  it('rejects a missing default Role when singleActiveMemberOfRole is configured', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.policies[2].defaultOwnerRoleId = null;

    expectErrorCode(candidate, 'INVALID_POLICY');
  });

  it('rejects a default Role when missing owner does not require one', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.policies[4].defaultOwnerRoleId =
      INCONNECT_PERSISTED_FIXTURE_IDS.supervisorRole;

    expectErrorCode(candidate, 'INVALID_POLICY');
  });

  it.each([
    ['denied create with self', 'denied', 'self'],
    [
      'defaultOwner create with requireExplicit',
      'defaultOwner',
      'requireExplicit',
    ],
    [
      'assignableOwners create with requireExplicit',
      'assignableOwners',
      'requireExplicit',
    ],
  ])('rejects %s', (_name, createPolicy, missingOwnerPolicy) => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.policies[0].createPolicy = createPolicy;
    candidate.policies[0].missingOwnerPolicy = missingOwnerPolicy;

    expectErrorCode(candidate, 'INVALID_POLICY');
  });

  it('allows a managed object with zero policies', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.managedObjects = [candidate.managedObjects[0]];
    candidate.policies = [];

    expect(validateInconnectRecordAccessPersistedCandidate(candidate)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects MANAGED with zero managed objects to keep activation explicit', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.managedObjects = [];
    candidate.policies = [];

    expectErrorCode(candidate, 'INVALID_CONFIGURATION');
  });

  it('accepts an empty UNMANAGED configuration at revision zero', () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.configuration.enforcementMode = 'UNMANAGED';
    candidate.configuration.revision = '0';
    candidate.managedObjects = [];
    candidate.policies = [];

    expect(validateInconnectRecordAccessPersistedCandidate(candidate)).toEqual({
      valid: true,
      errors: [],
    });
  });
});
