import {
  buildLeadDistributionPlan,
  type LeadDistributionInput,
} from 'src/modules/inconnect-lead-management/distribution';
import {
  evenInput,
  fixtureUuid,
  freezeRecursively,
  LIMITS,
  makeLead,
  RECIPIENT_IDS,
  SCOPE,
} from 'src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution.fixtures';

describe('buildLeadDistributionPlan', () => {
  it.each([1, 8])(
    'should assign %i selected Leads to a single recipient',
    (count) => {
      const plan = buildLeadDistributionPlan(
        {
          scope: SCOPE,
          leads: Array.from({ length: count }, (_, index) => makeLead(index)),
          mode: 'SINGLE',
          recipients: [{ workspaceMemberId: RECIPIENT_IDS[0] }],
        },
        LIMITS,
      );

      expect(plan.totals).toEqual({
        selected: count,
        distributed: count,
        changed: count,
        unchanged: 0,
        remaining: 0,
      });
      expect(
        plan.changes.every(
          (assignment) =>
            assignment.recipientWorkspaceMemberId === RECIPIENT_IDS[0],
        ),
      ).toBe(true);
      expect(plan.changes[0].identity).toEqual({
        ...SCOPE,
        recordId: fixtureUuid(0),
      });
    },
  );

  it('should retain expected Owners and distinguish changes from conserved assignments in SINGLE', () => {
    const plan = buildLeadDistributionPlan(
      {
        mode: 'SINGLE',
        scope: SCOPE,
        recipients: [{ workspaceMemberId: RECIPIENT_IDS[0] }],
        leads: [
          makeLead(1, RECIPIENT_IDS[0]),
          makeLead(2, RECIPIENT_IDS[1]),
          makeLead(3),
        ],
      },
      LIMITS,
    );

    expect(plan.unchanged.map((lead) => lead.identity.recordId)).toEqual([
      fixtureUuid(1),
    ]);
    expect(
      plan.changes.map((lead) => lead.expectedOwnerWorkspaceMemberId),
    ).toEqual([RECIPIENT_IDS[1], null]);
    expect(plan.totals.changed).toBe(2);
    expect(plan.totals.unchanged).toBe(1);
  });

  it.each([
    [6, [2, 2, 2]],
    [8, [3, 3, 2]],
    [2, [1, 1, 0]],
    [0, [0, 0, 0]],
  ])(
    'should balance %i Leads with deterministic remainder quotas',
    (count, expected) => {
      const plan = buildLeadDistributionPlan(
        evenInput(Array.from({ length: count }, (_, index) => makeLead(index))),
        LIMITS,
      );

      expect(
        plan.recipients.map((recipient) => recipient.totals.distributed),
      ).toEqual(expected);
      expect(plan.totals.remaining).toBe(0);
    },
  );

  it('should give a remainder slot to an existing Owner when that avoids a transfer', () => {
    const plan = buildLeadDistributionPlan(
      evenInput([
        makeLead(1, RECIPIENT_IDS[0]),
        makeLead(2, RECIPIENT_IDS[1]),
        makeLead(3, RECIPIENT_IDS[2]),
        makeLead(4, RECIPIENT_IDS[2]),
      ]),
      LIMITS,
    );

    expect(
      plan.recipients.map((recipient) => recipient.totals.distributed),
    ).toEqual([1, 1, 2]);
    expect(plan.totals.changed).toBe(0);
  });

  it('should reserve all feasible Owners before filling other recipients', () => {
    const plan = buildLeadDistributionPlan(
      evenInput([
        makeLead(1, RECIPIENT_IDS[2]),
        makeLead(2, RECIPIENT_IDS[2]),
        makeLead(3, RECIPIENT_IDS[1]),
        makeLead(4, RECIPIENT_IDS[1]),
        makeLead(5, fixtureUuid(999)),
        makeLead(6),
      ]),
      LIMITS,
    );

    expect(plan.totals).toMatchObject({
      changed: 2,
      unchanged: 4,
      distributed: 6,
    });
    expect(plan.changes.map((lead) => lead.identity.recordId)).toEqual([
      fixtureUuid(5),
      fixtureUuid(6),
    ]);
    expect(
      plan.changes.every(
        (lead) => lead.recipientWorkspaceMemberId === RECIPIENT_IDS[0],
      ),
    ).toBe(true);
  });

  it('should balance each category independently without compensating from another category', () => {
    const plan = buildLeadDistributionPlan(
      evenInput(
        [
          ...Array.from({ length: 5 }, (_, index) => makeLead(index)),
          ...Array.from({ length: 2 }, (_, index) =>
            makeLead(index + 10, null, 'MESSAGE_PENDING'),
          ),
        ],
        'CATEGORY',
      ),
      LIMITS,
    );

    expect(plan.recipients.map((recipient) => recipient.quantities)).toEqual([
      { NORMAL: 2, MESSAGE_PENDING: 1 },
      { NORMAL: 2, MESSAGE_PENDING: 1 },
      { NORMAL: 1, MESSAGE_PENDING: 0 },
    ]);
    expect(plan.totalsByCategory.NORMAL.distributed).toBe(5);
    expect(plan.totalsByCategory.MESSAGE_PENDING.distributed).toBe(2);
    expect(plan.balanceBy).toBe('CATEGORY');
  });

  it('should balance TOTAL across categories when explicitly requested', () => {
    const plan = buildLeadDistributionPlan(
      evenInput([makeLead(1), makeLead(2, null, 'MESSAGE_PENDING')]),
      LIMITS,
    );

    expect(
      plan.recipients.map((recipient) => recipient.totals.distributed),
    ).toEqual([1, 1, 0]);
    expect(plan.balanceBy).toBe('TOTAL');
  });

  const manualInput = (): LeadDistributionInput => ({
    mode: 'MANUAL_QUOTAS',
    scope: SCOPE,
    recipients: RECIPIENT_IDS.slice(0, 2).map((workspaceMemberId) => ({
      workspaceMemberId,
    })),
    leads: [
      makeLead(1),
      makeLead(2, RECIPIENT_IDS[0]),
      makeLead(3, RECIPIENT_IDS[1]),
      makeLead(4, RECIPIENT_IDS[1], 'MESSAGE_PENDING'),
      makeLead(5, null, 'MESSAGE_PENDING'),
    ],
    quotas: [
      {
        recipientWorkspaceMemberId: RECIPIENT_IDS[0],
        quantities: { NORMAL: 1, MESSAGE_PENDING: 0 },
      },
      {
        recipientWorkspaceMemberId: RECIPIENT_IDS[1],
        quantities: { NORMAL: 1, MESSAGE_PENDING: 1 },
      },
    ],
  });

  it('should distribute only requested manual quantities and retain current Owners before selecting other Leads', () => {
    const plan = buildLeadDistributionPlan(manualInput(), LIMITS);

    expect(plan.totals).toEqual({
      selected: 5,
      distributed: 3,
      changed: 0,
      unchanged: 3,
      remaining: 2,
    });
    expect(plan.remaining.map((lead) => lead.identity.recordId)).toEqual([
      fixtureUuid(1),
      fixtureUuid(5),
    ]);
    expect(plan.totalsByCategory.NORMAL).toEqual({
      selected: 3,
      distributed: 2,
      changed: 0,
      unchanged: 2,
      remaining: 1,
    });
    expect(plan.totalsByCategory.MESSAGE_PENDING).toEqual({
      selected: 2,
      distributed: 1,
      changed: 0,
      unchanged: 1,
      remaining: 1,
    });
    expect(plan.recipients.map((recipient) => recipient.quantities)).toEqual([
      { NORMAL: 1, MESSAGE_PENDING: 0 },
      { NORMAL: 1, MESSAGE_PENDING: 1 },
    ]);
  });

  it('should permit all-zero manual quotas and preserve the Owner on remaining Leads', () => {
    const plan = buildLeadDistributionPlan(
      {
        mode: 'MANUAL_QUOTAS',
        scope: SCOPE,
        leads: [makeLead(1, RECIPIENT_IDS[0])],
        recipients: [{ workspaceMemberId: RECIPIENT_IDS[0] }],
        quotas: [
          {
            recipientWorkspaceMemberId: RECIPIENT_IDS[0],
            quantities: { NORMAL: 0, MESSAGE_PENDING: 0 },
          },
        ],
      },
      LIMITS,
    );

    expect(plan.totals).toMatchObject({
      distributed: 0,
      unchanged: 0,
      remaining: 1,
    });
    expect(plan.remaining[0].expectedOwnerWorkspaceMemberId).toBe(
      RECIPIENT_IDS[0],
    );
  });

  it.each(['TOTAL', 'CATEGORY'] as const)(
    'should leave all Leads remaining with zero recipients in EVEN %s',
    (balanceBy) => {
      const plan = buildLeadDistributionPlan(
        { ...evenInput([makeLead(1)], balanceBy), recipients: [] },
        LIMITS,
      );

      expect(plan.totals).toEqual({
        selected: 1,
        distributed: 0,
        changed: 0,
        unchanged: 0,
        remaining: 1,
      });
      expect(plan.recipients).toEqual([]);
    },
  );

  it('should permit zero Leads and zero recipients with zero limits', () => {
    const plan = buildLeadDistributionPlan(
      { ...evenInput([]), recipients: [] },
      { maxLeads: 0, maxRecipients: 0 },
    );

    expect(plan.totals).toEqual({
      selected: 0,
      distributed: 0,
      changed: 0,
      unchanged: 0,
      remaining: 0,
    });
  });

  it('should permit empty manual recipients and quotas, leaving the selection untouched', () => {
    const plan = buildLeadDistributionPlan(
      {
        mode: 'MANUAL_QUOTAS',
        scope: SCOPE,
        leads: [makeLead(1)],
        recipients: [],
        quotas: [],
      },
      LIMITS,
    );

    expect(plan.totals.remaining).toBe(1);
  });

  it('should permit an empty SINGLE selection with exactly one recipient', () => {
    const plan = buildLeadDistributionPlan(
      {
        mode: 'SINGLE',
        scope: SCOPE,
        leads: [],
        recipients: [{ workspaceMemberId: RECIPIENT_IDS[0] }],
      },
      LIMITS,
    );

    expect(plan.totals.distributed).toBe(0);
  });

  it.each(['EVEN', 'MANUAL_QUOTAS'] as const)(
    'should return identical %s plans after permutations and UUID casing changes',
    (mode) => {
      const original =
        mode === 'EVEN'
          ? evenInput([makeLead(1, RECIPIENT_IDS[2]), makeLead(2), makeLead(3)])
          : manualInput();
      const permuted: LeadDistributionInput = {
        ...original,
        scope: {
          workspaceId: original.scope.workspaceId.toUpperCase(),
          objectMetadataId: original.scope.objectMetadataId.toUpperCase(),
        },
        leads: [...original.leads].reverse().map((lead) => ({
          ...lead,
          recordId: lead.recordId.toUpperCase(),
          currentOwnerWorkspaceMemberId:
            lead.currentOwnerWorkspaceMemberId?.toUpperCase() ?? null,
        })),
        recipients: [...original.recipients].reverse().map((recipient) => ({
          workspaceMemberId: recipient.workspaceMemberId.toUpperCase(),
        })),
        ...(original.mode === 'MANUAL_QUOTAS'
          ? {
              quotas: [...original.quotas].reverse().map((quota) => ({
                ...quota,
                recipientWorkspaceMemberId:
                  quota.recipientWorkspaceMemberId.toUpperCase(),
              })),
            }
          : {}),
      };

      expect(buildLeadDistributionPlan(permuted, LIMITS)).toEqual(
        buildLeadDistributionPlan(original, LIMITS),
      );
    },
  );

  it('should not mutate inputs or alias input objects into the plan', () => {
    const input = freezeRecursively(manualInput());
    const limits = freezeRecursively({ ...LIMITS });
    const before = JSON.stringify(input);
    const plan = buildLeadDistributionPlan(input, limits);

    expect(JSON.stringify(input)).toBe(before);
    expect(plan.scope).not.toBe(input.scope);
    expect(buildLeadDistributionPlan(input, limits)).toEqual(plan);
    expect(plan.algorithmVersion).toBe('1.0.0');
    expect(plan.deterministicOrder).toBe('CANONICAL_UUID_ASC');
  });
});
