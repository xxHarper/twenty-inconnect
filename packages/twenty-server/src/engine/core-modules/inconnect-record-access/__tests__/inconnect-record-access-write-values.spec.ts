import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { assertInconnectRecordAccessOperationSupported } from 'src/engine/core-modules/inconnect-record-access/utils/assert-inconnect-record-access-operation-supported.util';
import {
  applyInconnectRecordAccessToCreateValues,
  doesInconnectCreateRequireDefaultOwnerResolution,
  validateInconnectRecordAccessUpdateValues,
} from 'src/engine/core-modules/inconnect-record-access/utils/apply-inconnect-record-access-to-write-values.util';

const SCOTT_WORKSPACE_MEMBER_ID = 'scott-workspace-member-id';
const TIM_WORKSPACE_MEMBER_ID = 'tim-workspace-member-id';
const HISTORICAL_WORKSPACE_MEMBER_ID = 'historical-workspace-member-id';
const OUTSIDE_TEAM_WORKSPACE_MEMBER_ID = 'outside-team-workspace-member-id';
const SUPERVISOR_WORKSPACE_MEMBER_ID = 'supervisor-workspace-member-id';
const SUPERVISOR_ROLE_ID = 'supervisor-role-id';

const executiveDecision: InconnectRecordAccessDecision = {
  kind: 'owner-workspace-member-ids',
  ownerFieldMetadataId: 'owner-field-id',
  ownerFieldName: 'propietarioDeLead',
  ownerJoinColumnName: 'propietarioDeLeadId',
  authenticatedWorkspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
  recordScopeOwnerWorkspaceMemberIds: [SCOTT_WORKSPACE_MEMBER_ID],
  assignableOwnerWorkspaceMemberIds: [SCOTT_WORKSPACE_MEMBER_ID],
  createPolicy: 'denied',
  ownerTransferPolicy: 'denied',
  ownerRequirement: 'required',
  missingOwnerPolicy: 'requireExplicit',
  sourceRecordEffect: 'ownRecords',
};

const coordinatorDecision: InconnectRecordAccessDecision = {
  ...executiveDecision,
  recordScopeOwnerWorkspaceMemberIds: [
    SCOTT_WORKSPACE_MEMBER_ID,
    TIM_WORKSPACE_MEMBER_ID,
    HISTORICAL_WORKSPACE_MEMBER_ID,
  ],
  sourceRecordEffect: 'ownAndTeamRecords',
};

const coordinatorAssignableDecision: InconnectRecordAccessDecision = {
  ...coordinatorDecision,
  missingOwnerPolicy: 'self',
  assignableOwnerWorkspaceMemberIds: [
    SCOTT_WORKSPACE_MEMBER_ID,
    TIM_WORKSPACE_MEMBER_ID,
  ],
  createPolicy: 'assignableOwners',
  ownerTransferPolicy: 'assignableOwners',
};

const defaultOwnerDecision: InconnectRecordAccessDecision = {
  ...executiveDecision,
  createPolicy: 'defaultOwner',
  missingOwnerPolicy: 'self',
};

const allRecordsStandardDecision: InconnectRecordAccessDecision = {
  kind: 'all-records',
  ownerFieldMetadataId: 'owner-field-id',
  ownerFieldName: 'propietarioDeLead',
  ownerJoinColumnName: 'propietarioDeLeadId',
  authenticatedWorkspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
  assignableOwnerWorkspaceMemberIds: [SCOTT_WORKSPACE_MEMBER_ID],
  createPolicy: 'standardPermissionsOnly',
  ownerTransferPolicy: 'standardPermissionsOnly',
  ownerRequirement: 'required',
  missingOwnerPolicy: 'requireExplicit',
  sourceRecordEffect: 'allRecords',
};

const singleRoleDefaultDecision: InconnectRecordAccessDecision = {
  ...allRecordsStandardDecision,
  missingOwnerPolicy: 'singleActiveMemberOfRole',
  defaultOwnerRoleId: SUPERVISOR_ROLE_ID,
};

describe('INCONNECT operation policies for write values', () => {
  it('allows an executive normal update while create is denied', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: executiveDecision,
        valuesSet: { etapa: 'Contactado' },
      }),
    ).not.toThrow();

    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: executiveDecision,
        valuesSet: { name: 'Denied Lead' },
      }),
    ).toThrow(
      expect.objectContaining({
        code: InconnectRecordAccessExceptionCode.ACCESS_DENIED,
      }),
    );
  });

  it('denies every explicit owner write for an executive', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: executiveDecision,
        valuesSet: {
          propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
        },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('allows a coordinator normal Team-scoped update while create is denied', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: coordinatorDecision,
        valuesSet: { fase: 'Seguimiento' },
      }),
    ).not.toThrow();

    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: coordinatorDecision,
        valuesSet: { name: 'Denied Team Lead' },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it.each([
    ['inside the Team', TIM_WORKSPACE_MEMBER_ID],
    ['outside the Team', OUTSIDE_TEAM_WORKSPACE_MEMBER_ID],
  ])('denies coordinator owner transfer %s', (_case, ownerId) => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: coordinatorDecision,
        valuesSet: { propietarioDeLeadId: ownerId },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('defaultOwner injects self only when the client omits owner', () => {
    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: defaultOwnerDecision,
        valuesSet: { name: 'Self-owned Lead' },
      }),
    ).toEqual({
      name: 'Self-owned Lead',
      propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
    });

    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: defaultOwnerDecision,
        valuesSet: {
          propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
        },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('assignableOwners injects self for an ownerless create-many payload', () => {
    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: coordinatorAssignableDecision,
        valuesSet: [{ name: 'One' }, { name: 'Two' }],
      }),
    ).toEqual([
      { name: 'One', propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID },
      { name: 'Two', propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID },
    ]);
  });

  it('assignableOwners permits create and transfer within the assignable Team', () => {
    const valuesSet = {
      name: 'Executive Lead',
      propietarioDeLead: { id: TIM_WORKSPACE_MEMBER_ID },
    };

    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: coordinatorAssignableDecision,
        valuesSet,
      }),
    ).toEqual(valuesSet);

    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: coordinatorAssignableDecision,
        valuesSet: {
          fase: 'Seguimiento',
          propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).not.toThrow();
  });

  it.each([
    ['historical Team member', HISTORICAL_WORKSPACE_MEMBER_ID],
    ['outside Workspace Member', OUTSIDE_TEAM_WORKSPACE_MEMBER_ID],
    ['null owner', null],
  ])(
    'rejects non-assignable create and transfer destination: %s',
    (_case, id) => {
      expect(() =>
        applyInconnectRecordAccessToCreateValues({
          decision: coordinatorAssignableDecision,
          valuesSet: { propietarioDeLeadId: id },
        }),
      ).toThrow(InconnectRecordAccessException);

      expect(() =>
        validateInconnectRecordAccessUpdateValues({
          decision: coordinatorAssignableDecision,
          valuesSet: { propietarioDeLeadId: id },
        }),
      ).toThrow(InconnectRecordAccessException);
    },
  );

  it('rejects contradictory relation and join-column owner values', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: coordinatorAssignableDecision,
        valuesSet: {
          propietarioDeLead: { id: TIM_WORKSPACE_MEMBER_ID },
          propietarioDeLeadId: OUTSIDE_TEAM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('accepts a normalized nested connect only under assignableOwners', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: coordinatorAssignableDecision,
        valuesSet: {
          propietarioDeLead: null,
          propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).not.toThrow();
  });

  it('standardPermissionsOnly leaves create and transfer to Twenty permissions', () => {
    const createValues = {
      name: 'Admin Lead',
      propietarioDeLeadId: OUTSIDE_TEAM_WORKSPACE_MEMBER_ID,
    };

    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: allRecordsStandardDecision,
        valuesSet: createValues,
      }),
    ).toBe(createValues);

    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: allRecordsStandardDecision,
        valuesSet: {
          propietarioDeLeadId: OUTSIDE_TEAM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).not.toThrow();
  });

  it('proves allRecords does not determine the create policy', () => {
    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: {
          ...allRecordsStandardDecision,
          createPolicy: 'denied',
        },
        valuesSet: { name: 'Denied despite allRecords' },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('applies operation policies generically to a second managed object', () => {
    const folioDecision: InconnectRecordAccessDecision = {
      ...defaultOwnerDecision,
      ownerFieldMetadataId: 'folio-owner-field-id',
      ownerFieldName: 'propietarioDeFolioIso',
      ownerJoinColumnName: 'propietarioDeFolioIsoId',
    };

    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: folioDecision,
        valuesSet: { estado: 'Nuevo' },
      }),
    ).toEqual({
      estado: 'Nuevo',
      propietarioDeFolioIsoId: SCOTT_WORKSPACE_MEMBER_ID,
    });
  });

  it.each([
    ['Admin', singleRoleDefaultDecision],
    [
      'Supervisor',
      {
        ...singleRoleDefaultDecision,
        authenticatedWorkspaceMemberId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      },
    ],
  ] as const)(
    'injects the unique Supervisor default for an ownerless Lead created by %s',
    (_actor, decision) => {
      expect(
        doesInconnectCreateRequireDefaultOwnerResolution({
          decision,
          valuesSet: { name: 'Defaulted Lead' },
        }),
      ).toBe(true);
      expect(
        applyInconnectRecordAccessToCreateValues({
          decision,
          valuesSet: { name: 'Defaulted Lead' },
          resolvedDefaultOwnerWorkspaceMemberId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        }),
      ).toEqual({
        name: 'Defaulted Lead',
        propietarioDeLeadId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      });
    },
  );

  it('does not resolve or validate the default Role for an explicit owner', () => {
    const values = {
      name: 'Explicit Lead',
      propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID,
    };

    expect(
      doesInconnectCreateRequireDefaultOwnerResolution({
        decision: singleRoleDefaultDecision,
        valuesSet: values,
      }),
    ).toBe(false);
    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: singleRoleDefaultDecision,
        valuesSet: values,
      }),
    ).toBe(values);
  });

  it.each([
    ['join column', { propietarioDeLeadId: null }],
    ['relation field', { propietarioDeLead: null }],
  ])('denies explicit null owner through the %s', (_syntax, ownerValues) => {
    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: singleRoleDefaultDecision,
        valuesSet: ownerValues,
        resolvedDefaultOwnerWorkspaceMemberId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      }),
    ).toThrow(InconnectRecordAccessException);

    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: allRecordsStandardDecision,
        valuesSet: ownerValues,
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('denies contradictory owner representations even under standardPermissionsOnly', () => {
    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: allRecordsStandardDecision,
        valuesSet: {
          propietarioDeLead: { id: SCOTT_WORKSPACE_MEMBER_ID },
          propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('resolves create-many owners per record before any insert can run', () => {
    const values = [
      { name: 'A', propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID },
      { name: 'B' },
      { name: 'C', propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID },
    ];

    expect(
      doesInconnectCreateRequireDefaultOwnerResolution({
        decision: singleRoleDefaultDecision,
        valuesSet: values,
      }),
    ).toBe(true);
    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: singleRoleDefaultDecision,
        valuesSet: values,
        resolvedDefaultOwnerWorkspaceMemberId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      }),
    ).toEqual([
      { name: 'A', propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID },
      {
        name: 'B',
        propietarioDeLeadId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      },
      { name: 'C', propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID },
    ]);

    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: singleRoleDefaultDecision,
        valuesSet: [...values, { name: 'Invalid', propietarioDeLeadId: null }],
        resolvedDefaultOwnerWorkspaceMemberId: SUPERVISOR_WORKSPACE_MEMBER_ID,
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it.each(['Supervisor', 'Admin'])(
    'assigns self for ownerless Folio creation by %s under standardPermissionsOnly',
    () => {
      const folioDecision: InconnectRecordAccessDecision = {
        ...allRecordsStandardDecision,
        ownerFieldMetadataId: 'folio-owner-field-id',
        ownerFieldName: 'propietarioDeFolioIso',
        ownerJoinColumnName: 'propietarioDeFolioIsoId',
        missingOwnerPolicy: 'self',
      };
      const explicitValues = {
        estado: 'Nuevo',
        propietarioDeFolioIsoId: TIM_WORKSPACE_MEMBER_ID,
      };

      expect(
        applyInconnectRecordAccessToCreateValues({
          decision: folioDecision,
          valuesSet: { estado: 'Nuevo' },
        }),
      ).toEqual({
        estado: 'Nuevo',
        propietarioDeFolioIsoId: SCOTT_WORKSPACE_MEMBER_ID,
      });
      expect(
        applyInconnectRecordAccessToCreateValues({
          decision: folioDecision,
          valuesSet: explicitValues,
        }),
      ).toBe(explicitValues);
      expect(() =>
        applyInconnectRecordAccessToCreateValues({
          decision: folioDecision,
          valuesSet: { propietarioDeFolioIsoId: null },
        }),
      ).toThrow(InconnectRecordAccessException);
      expect(() =>
        validateInconnectRecordAccessUpdateValues({
          decision: folioDecision,
          valuesSet: { propietarioDeFolioIsoId: null },
        }),
      ).toThrow(InconnectRecordAccessException);
      expect(() =>
        validateInconnectRecordAccessUpdateValues({
          decision: folioDecision,
          valuesSet: {
            propietarioDeFolioIsoId: TIM_WORKSPACE_MEMBER_ID,
          },
        }),
      ).not.toThrow();
    },
  );

  it.each(['ownRecords', 'ownAndTeamRecords'] as const)(
    'keeps Folio defaultOwner scoped to self for %s',
    (sourceRecordEffect) => {
      const folioDecision: InconnectRecordAccessDecision = {
        ...defaultOwnerDecision,
        ownerFieldMetadataId: 'folio-owner-field-id',
        ownerFieldName: 'propietarioDeFolioIso',
        ownerJoinColumnName: 'propietarioDeFolioIsoId',
        sourceRecordEffect,
      };

      expect(
        applyInconnectRecordAccessToCreateValues({
          decision: folioDecision,
          valuesSet: { estado: 'Nuevo' },
        }),
      ).toEqual({
        estado: 'Nuevo',
        propietarioDeFolioIsoId: SCOTT_WORKSPACE_MEMBER_ID,
      });
      expect(() =>
        applyInconnectRecordAccessToCreateValues({
          decision: folioDecision,
          valuesSet: {
            propietarioDeFolioIsoId: SCOTT_WORKSPACE_MEMBER_ID,
          },
        }),
      ).toThrow(InconnectRecordAccessException);
    },
  );

  it.each([
    'upsert',
    'merge',
    'save',
    'remove',
    'softRemove',
    'recover',
  ] as const)(
    'keeps %s fail-closed for every managed decision',
    (operation) => {
      expect(() =>
        assertInconnectRecordAccessOperationSupported({
          decision: allRecordsStandardDecision,
          operation,
        }),
      ).toThrow(
        expect.objectContaining({
          code: InconnectRecordAccessExceptionCode.UNSUPPORTED_OPERATION,
        }),
      );
    },
  );

  it('does not restrict unsupported operations for an unmanaged object', () => {
    expect(() =>
      assertInconnectRecordAccessOperationSupported({
        decision: { kind: 'not-managed' },
        operation: 'upsert',
      }),
    ).not.toThrow();
  });

  it('preserves trusted system bypass for create and update', () => {
    const values = { propietarioDeLeadId: OUTSIDE_TEAM_WORKSPACE_MEMBER_ID };

    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: { kind: 'system-bypass' },
        valuesSet: values,
      }),
    ).toBe(values);
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: { kind: 'system-bypass' },
        valuesSet: values,
      }),
    ).not.toThrow();
  });
});
