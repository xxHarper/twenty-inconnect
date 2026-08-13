import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { assertInconnectRecordAccessOperationSupported } from 'src/engine/core-modules/inconnect-record-access/utils/assert-inconnect-record-access-operation-supported.util';
import {
  applyInconnectRecordAccessToCreateValues,
  validateInconnectRecordAccessUpdateValues,
} from 'src/engine/core-modules/inconnect-record-access/utils/apply-inconnect-record-access-to-write-values.util';

const SCOTT_WORKSPACE_MEMBER_ID = 'scott-workspace-member-id';
const TIM_WORKSPACE_MEMBER_ID = 'tim-workspace-member-id';
const HISTORICAL_WORKSPACE_MEMBER_ID = 'historical-workspace-member-id';
const OUTSIDE_TEAM_WORKSPACE_MEMBER_ID = 'outside-team-workspace-member-id';

const scopedDecision: InconnectRecordAccessDecision = {
  kind: 'owner-workspace-member-ids',
  ownerFieldMetadataId: 'owner-field-id',
  ownerFieldName: 'propietarioDeLead',
  ownerJoinColumnName: 'propietarioDeLeadId',
  authenticatedWorkspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
  recordScopeOwnerWorkspaceMemberIds: [SCOTT_WORKSPACE_MEMBER_ID],
  assignableOwnerWorkspaceMemberIds: [SCOTT_WORKSPACE_MEMBER_ID],
  sourceEffect: 'ownRecords',
};

const teamScopedDecision: InconnectRecordAccessDecision = {
  kind: 'owner-workspace-member-ids',
  ownerFieldMetadataId: 'owner-field-id',
  ownerFieldName: 'propietarioDeLead',
  ownerJoinColumnName: 'propietarioDeLeadId',
  authenticatedWorkspaceMemberId: SCOTT_WORKSPACE_MEMBER_ID,
  recordScopeOwnerWorkspaceMemberIds: [
    SCOTT_WORKSPACE_MEMBER_ID,
    TIM_WORKSPACE_MEMBER_ID,
    HISTORICAL_WORKSPACE_MEMBER_ID,
  ],
  assignableOwnerWorkspaceMemberIds: [
    SCOTT_WORKSPACE_MEMBER_ID,
    TIM_WORKSPACE_MEMBER_ID,
  ],
  sourceEffect: 'ownAndTeamRecords',
};

describe('INCONNECT record access write values', () => {
  it('assigns the authenticated Workspace Member when create omits owner', () => {
    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: scopedDecision,
        valuesSet: { name: 'Alberto Garcia' },
      }),
    ).toEqual({
      name: 'Alberto Garcia',
      propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
    });
  });

  it('assigns owner to every ownerless record in create many', () => {
    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: scopedDecision,
        valuesSet: [{ name: 'Lead one' }, { name: 'Lead two' }],
      }),
    ).toEqual([
      {
        name: 'Lead one',
        propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
      },
      {
        name: 'Lead two',
        propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
      },
    ]);
  });

  it('accepts an explicitly provided authenticated owner', () => {
    const valuesSet = {
      name: 'Alberto Garcia',
      propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
    };

    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: scopedDecision,
        valuesSet,
      }),
    ).toEqual(valuesSet);
  });

  it.each([
    ['another Workspace Member', TIM_WORKSPACE_MEMBER_ID],
    ['a null owner', null],
  ])('rejects create with %s', (_case, ownerWorkspaceMemberId) => {
    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: scopedDecision,
        valuesSet: {
          name: 'Unauthorized lead',
          propietarioDeLeadId: ownerWorkspaceMemberId,
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: InconnectRecordAccessExceptionCode.ACCESS_DENIED,
      }),
    );
  });

  it('rejects conflicting direct relation and join-column owner values', () => {
    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: scopedDecision,
        valuesSet: {
          name: 'Conflicting owner',
          propietarioDeLead: { id: TIM_WORKSPACE_MEMBER_ID },
          propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: InconnectRecordAccessExceptionCode.ACCESS_DENIED,
      }),
    );
  });

  it('rejects owner transfer after nested connect resolves to the join column', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: scopedDecision,
        valuesSet: {
          propietarioDeLead: null,
          propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('allows an update that does not change owner', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: scopedDecision,
        valuesSet: { etapa: 'Contactado' },
      }),
    ).not.toThrow();
  });

  it('allows setting the owner to the same member when standard field permissions allow it', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: scopedDecision,
        valuesSet: {
          propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
        },
      }),
    ).not.toThrow();
  });

  it('assigns the coordinator as owner when create omits owner', () => {
    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: teamScopedDecision,
        valuesSet: { name: 'Team Lead' },
      }),
    ).toEqual({
      name: 'Team Lead',
      propietarioDeLeadId: SCOTT_WORKSPACE_MEMBER_ID,
    });
  });

  it('allows coordinator create for an assignable Team member', () => {
    const valuesSet = {
      name: 'Executive Lead',
      propietarioDeLead: { id: TIM_WORKSPACE_MEMBER_ID },
    };

    expect(
      applyInconnectRecordAccessToCreateValues({
        decision: teamScopedDecision,
        valuesSet,
      }),
    ).toEqual(valuesSet);
  });

  it.each([
    ['historical Team member', HISTORICAL_WORKSPACE_MEMBER_ID],
    ['Workspace Member outside the Team', OUTSIDE_TEAM_WORKSPACE_MEMBER_ID],
    ['null owner', null],
  ])('rejects coordinator create for %s', (_case, ownerWorkspaceMemberId) => {
    expect(() =>
      applyInconnectRecordAccessToCreateValues({
        decision: teamScopedDecision,
        valuesSet: { propietarioDeLeadId: ownerWorkspaceMemberId },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('allows coordinator normal updates and transfers to an assignable Team member', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: teamScopedDecision,
        valuesSet: {
          fase: 'Seguimiento',
          propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).not.toThrow();
  });

  it('allows transfer after nested connect resolves to an assignable owner ID', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: teamScopedDecision,
        valuesSet: {
          propietarioDeLead: null,
          propietarioDeLeadId: TIM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).not.toThrow();
  });

  it.each([
    ['historical Team member', HISTORICAL_WORKSPACE_MEMBER_ID],
    ['Workspace Member outside the Team', OUTSIDE_TEAM_WORKSPACE_MEMBER_ID],
    ['null owner', null],
  ])('rejects coordinator transfer to %s', (_case, ownerWorkspaceMemberId) => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: teamScopedDecision,
        valuesSet: { propietarioDeLeadId: ownerWorkspaceMemberId },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('rejects contradictory relation and join-column owner destinations', () => {
    expect(() =>
      validateInconnectRecordAccessUpdateValues({
        decision: teamScopedDecision,
        valuesSet: {
          propietarioDeLead: { id: TIM_WORKSPACE_MEMBER_ID },
          propietarioDeLeadId: OUTSIDE_TEAM_WORKSPACE_MEMBER_ID,
        },
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it.each([
    'upsert',
    'merge',
    'save',
    'remove',
    'softRemove',
    'recover',
  ] as const)(
    'fails closed for unsupported %s on a scoped object',
    (operation) => {
      expect(() =>
        assertInconnectRecordAccessOperationSupported({
          decision: scopedDecision,
          operation,
        }),
      ).toThrow(
        expect.objectContaining({
          code: InconnectRecordAccessExceptionCode.UNSUPPORTED_OPERATION,
        }),
      );
    },
  );

  it.each([
    'upsert',
    'merge',
    'save',
    'remove',
    'softRemove',
    'recover',
  ] as const)('keeps coordinator %s fail-closed', (operation) => {
    expect(() =>
      assertInconnectRecordAccessOperationSupported({
        decision: teamScopedDecision,
        operation,
      }),
    ).toThrow(InconnectRecordAccessException);
  });

  it('does not restrict unsupported operations for a Role without a policy', () => {
    expect(() =>
      assertInconnectRecordAccessOperationSupported({
        decision: { kind: 'not-managed' },
        operation: 'upsert',
      }),
    ).not.toThrow();
  });
});
