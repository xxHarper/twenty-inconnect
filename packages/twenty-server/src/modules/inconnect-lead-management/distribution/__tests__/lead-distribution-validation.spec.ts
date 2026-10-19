import {
  buildLeadDistributionPlan,
  LeadDistributionError,
  type LeadDistributionInput,
  type LeadDistributionLimits,
} from 'src/modules/inconnect-lead-management/distribution';
import {
  evenInput,
  fixtureUuid,
  LIMITS,
  makeLead,
  RECIPIENT_IDS,
  SCOPE,
} from 'src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution.fixtures';

// Exercise runtime validation as well as the compile-time discriminated union.
const planUnknown = (input: unknown, limits: unknown = LIMITS) =>
  buildLeadDistributionPlan(
    input as LeadDistributionInput,
    limits as LeadDistributionLimits,
  );

const manualInput = () => ({
  mode: 'MANUAL_QUOTAS',
  scope: SCOPE,
  leads: [makeLead(1)],
  recipients: [{ workspaceMemberId: RECIPIENT_IDS[0] }],
  quotas: [
    {
      recipientWorkspaceMemberId: RECIPIENT_IDS[0],
      quantities: { NORMAL: 1, MESSAGE_PENDING: 0 },
    },
  ],
});

describe('Lead distribution validation', () => {
  it.each([
    '',
    'not-a-uuid',
    'abcdef00-0000-4000-0000-000000000001',
    ' abcdef00-0000-4000-8000-000000000001',
  ])('should reject invalid record identity %s', (recordId) => {
    expect(() =>
      planUnknown(evenInput([{ ...makeLead(1), recordId }])),
    ).toThrow(new LeadDistributionError('INVALID_INPUT'));
  });

  it.each(['workspaceId', 'objectMetadataId'])(
    'should reject an invalid %s',
    (key) => {
      expect(() =>
        planUnknown({
          ...evenInput([]),
          scope: { ...SCOPE, [key]: 'invalid' },
        }),
      ).toThrow('INVALID_INPUT');
    },
  );

  it('should reject invalid current Owner and recipient UUIDs', () => {
    expect(() => planUnknown(evenInput([makeLead(1, 'invalid')]))).toThrow(
      'INVALID_INPUT',
    );
    expect(() =>
      planUnknown({
        ...evenInput([]),
        recipients: [{ workspaceMemberId: 'invalid' }],
      }),
    ).toThrow('INVALID_INPUT');
    const input = manualInput();

    expect(() =>
      planUnknown({
        ...input,
        quotas: [{ ...input.quotas[0], recipientWorkspaceMemberId: 'invalid' }],
      }),
    ).toThrow('INVALID_INPUT');
  });

  it('should reject duplicate Leads even across categories and UUID casing', () => {
    expect(() => planUnknown(evenInput([makeLead(1), makeLead(1)]))).toThrow(
      'DUPLICATE_LEAD',
    );
    expect(() =>
      planUnknown(
        evenInput([
          makeLead(1),
          {
            ...makeLead(1, null, 'MESSAGE_PENDING'),
            recordId: fixtureUuid(1).toUpperCase(),
          },
        ]),
      ),
    ).toThrow('DUPLICATE_LEAD');
  });

  it('should reject duplicate recipients including case variants', () => {
    expect(() =>
      planUnknown({
        ...evenInput([]),
        recipients: [
          { workspaceMemberId: RECIPIENT_IDS[0] },
          { workspaceMemberId: RECIPIENT_IDS[0].toUpperCase() },
        ],
      }),
    ).toThrow('DUPLICATE_RECIPIENT');
  });

  it.each([
    undefined,
    null,
    'UNREAD',
    '',
    'normal',
    ['NORMAL', 'MESSAGE_PENDING'],
    { NORMAL: true, MESSAGE_PENDING: true },
  ])('should reject invalid or ambiguous category %j', (category) => {
    expect(() =>
      planUnknown({ ...evenInput([]), leads: [{ ...makeLead(1), category }] }),
    ).toThrow('INVALID_INPUT');
  });

  it('should reject implicit classification, extra Messaging inputs and missing expected Owner', () => {
    expect(() =>
      planUnknown({
        ...evenInput([]),
        leads: [{ ...makeLead(1), unread: true }],
      }),
    ).toThrow('INVALID_INPUT');
    expect(() =>
      planUnknown({
        ...evenInput([]),
        leads: [{ recordId: fixtureUuid(1), category: 'NORMAL' }],
      }),
    ).toThrow('INVALID_INPUT');
    expect(() => planUnknown({ ...evenInput([]), conversations: [] })).toThrow(
      'INVALID_INPUT',
    );
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])(
    'should reject invalid quota quantity %j',
    (value) => {
      const input = manualInput();

      for (const category of ['NORMAL', 'MESSAGE_PENDING']) {
        expect(() =>
          planUnknown({
            ...input,
            quotas: [
              {
                ...input.quotas[0],
                quantities: {
                  ...input.quotas[0].quantities,
                  [category]: value,
                },
              },
            ],
          }),
        ).toThrow('INVALID_INPUT');
      }
    },
  );

  it('should reject missing or unknown category quantities', () => {
    const input = manualInput();

    expect(() =>
      planUnknown({
        ...input,
        quotas: [{ ...input.quotas[0], quantities: { NORMAL: 1 } }],
      }),
    ).toThrow('INVALID_INPUT');
    expect(() =>
      planUnknown({
        ...input,
        quotas: [
          {
            ...input.quotas[0],
            quantities: { NORMAL: 1, MESSAGE_PENDING: 0, UNREAD: 1 },
          },
        ],
      }),
    ).toThrow('INVALID_INPUT');
  });

  it('should reject duplicate quotas, missing quotas and quotas for unselected recipients', () => {
    const input = manualInput();

    expect(() =>
      planUnknown({
        ...input,
        quotas: [
          ...input.quotas,
          {
            ...input.quotas[0],
            recipientWorkspaceMemberId: RECIPIENT_IDS[0].toUpperCase(),
          },
        ],
      }),
    ).toThrow('INVALID_QUOTAS');
    expect(() => planUnknown({ ...input, quotas: [] })).toThrow(
      'INVALID_QUOTAS',
    );
    expect(() =>
      planUnknown({
        ...input,
        quotas: [
          { ...input.quotas[0], recipientWorkspaceMemberId: RECIPIENT_IDS[1] },
        ],
      }),
    ).toThrow('INVALID_QUOTAS');
  });

  it('should reject quotas exceeding available Leads without borrowing from another category', () => {
    const input = manualInput();

    expect(() =>
      planUnknown({
        ...input,
        quotas: [
          { ...input.quotas[0], quantities: { NORMAL: 2, MESSAGE_PENDING: 0 } },
        ],
      }),
    ).toThrow('QUOTA_EXCEEDS_AVAILABLE');
    expect(() =>
      planUnknown({
        ...input,
        quotas: [
          { ...input.quotas[0], quantities: { NORMAL: 0, MESSAGE_PENDING: 1 } },
        ],
      }),
    ).toThrow('QUOTA_EXCEEDS_AVAILABLE');
    expect(() => planUnknown({ ...input, leads: [] })).toThrow(
      'QUOTA_EXCEEDS_AVAILABLE',
    );
  });

  it('should reject aggregate over-allocation even when each individual quota fits', () => {
    const input = manualInput();

    expect(() =>
      planUnknown({
        ...input,
        recipients: [
          ...input.recipients,
          { workspaceMemberId: RECIPIENT_IDS[1] },
        ],
        quotas: [
          ...input.quotas,
          { ...input.quotas[0], recipientWorkspaceMemberId: RECIPIENT_IDS[1] },
        ],
      }),
    ).toThrow('QUOTA_EXCEEDS_AVAILABLE');
  });

  it('should fail closed on very large safe-integer quotas', () => {
    const input = manualInput();

    expect(() =>
      planUnknown({
        ...input,
        quotas: [
          {
            ...input.quotas[0],
            quantities: {
              NORMAL: Number.MAX_SAFE_INTEGER,
              MESSAGE_PENDING: Number.MAX_SAFE_INTEGER,
            },
          },
        ],
      }),
    ).toThrow('QUOTA_EXCEEDS_AVAILABLE');
  });

  it.each([
    { recipients: [] },
    {
      recipients: RECIPIENT_IDS.slice(0, 2).map((workspaceMemberId) => ({
        workspaceMemberId,
      })),
    },
  ])(
    'should require exactly one SINGLE recipient even for empty selections: %j',
    ({ recipients }) => {
      expect(() =>
        planUnknown({ mode: 'SINGLE', scope: SCOPE, leads: [], recipients }),
      ).toThrow('INVALID_INPUT');
    },
  );

  it.each([
    undefined,
    null,
    {},
    { maxLeads: -1, maxRecipients: 1 },
    { maxLeads: 1.5, maxRecipients: 1 },
    { maxLeads: 1, maxRecipients: NaN },
    { maxLeads: 1, maxRecipients: Infinity },
    { maxLeads: Number.MAX_SAFE_INTEGER + 1, maxRecipients: 1 },
  ])('should reject invalid configurable limits %j', (limits) => {
    expect(() =>
      planUnknown(evenInput([]), limits === undefined ? null : limits),
    ).toThrow('INVALID_LIMITS');
  });

  it('should enforce configurable limits at their exact boundaries', () => {
    const input = {
      ...evenInput([makeLead(1)]),
      recipients: [{ workspaceMemberId: RECIPIENT_IDS[0] }],
    };

    expect(
      planUnknown(input, { maxLeads: 1, maxRecipients: 1 }).totals.distributed,
    ).toBe(1);
    expect(() => planUnknown(input, { maxLeads: 0, maxRecipients: 1 })).toThrow(
      'INVALID_INPUT',
    );
    expect(() => planUnknown(input, { maxLeads: 1, maxRecipients: 0 })).toThrow(
      'INVALID_INPUT',
    );
    expect(() =>
      buildLeadDistributionPlan(
        input,
        undefined as unknown as LeadDistributionLimits,
      ),
    ).toThrow('INVALID_LIMITS');
  });

  it.each(['leads', 'recipients', 'quotas'])(
    'should reject excessive %s before parsing its elements',
    (key) => {
      const oversized = Array.from({ length: 11 }, () => {
        const element = {};

        Object.defineProperty(element, 'recordId', {
          enumerable: true,
          get: () => {
            throw new Error('ELEMENT_WAS_PARSED');
          },
        });
        Object.defineProperty(element, 'workspaceMemberId', {
          enumerable: true,
          get: () => {
            throw new Error('ELEMENT_WAS_PARSED');
          },
        });
        Object.defineProperty(element, 'recipientWorkspaceMemberId', {
          enumerable: true,
          get: () => {
            throw new Error('ELEMENT_WAS_PARSED');
          },
        });

        return element;
      });

      expect(() =>
        planUnknown(
          { ...manualInput(), [key]: oversized },
          { maxLeads: 10, maxRecipients: 10 },
        ),
      ).toThrow('INVALID_INPUT');
    },
  );

  it.each([
    null,
    {},
    { mode: 'SMART' },
    { ...evenInput([]), balanceBy: undefined },
    { ...evenInput([]), balanceBy: 'UNREAD' },
    { ...evenInput([]), leads: null },
    { ...evenInput([]), recipients: null },
    { ...manualInput(), quotas: null },
  ])('should reject malformed input %j', (input) => {
    expect(() => planUnknown(input)).toThrow('INVALID_INPUT');
  });
});
