import {
  buildLeadDistributionPlan,
  type LeadDistributionInput,
  type LeadDistributionPlan,
  type LeadDistributionSelection,
} from 'src/modules/inconnect-lead-management/distribution';
import {
  evenInput,
  fixtureUuid,
  LIMITS,
  makeLead,
  RECIPIENT_IDS,
  SCOPE,
} from 'src/modules/inconnect-lead-management/distribution/__tests__/lead-distribution.fixtures';

const vectors = (length: number, choices: number): number[][] => {
  if (length === 0) {
    return [[]];
  }

  return vectors(length - 1, choices).flatMap((prefix) =>
    Array.from({ length: choices }, (_, value) => [...prefix, value]),
  );
};

// Independent exhaustive oracle: enumerate every destination, including remaining.
const minimumChanges = (
  leads: readonly LeadDistributionSelection[],
  recipientIds: readonly string[],
  accepts: (destinations: number[]) => boolean,
): number => {
  let minimum = Infinity;

  for (const destinations of vectors(leads.length, recipientIds.length + 1)) {
    if (!accepts(destinations)) {
      continue;
    }

    const changes = destinations.reduce(
      (count, destination, index) =>
        count +
        Number(
          destination < recipientIds.length &&
            leads[index].currentOwnerWorkspaceMemberId !==
              recipientIds[destination],
        ),
      0,
    );

    minimum = Math.min(minimum, changes);
  }

  return minimum;
};

const assertPartition = (
  input: LeadDistributionInput,
  plan: LeadDistributionPlan,
) => {
  const all = [...plan.changes, ...plan.unchanged, ...plan.remaining];
  const ids = all.map((lead) => lead.identity.recordId);

  expect(new Set(ids).size).toBe(input.leads.length);
  expect([...ids].sort()).toEqual(
    input.leads.map((lead) => lead.recordId).sort(),
  );
  expect(plan.totals.distributed).toBe(
    plan.changes.length + plan.unchanged.length,
  );
  expect(plan.totals.selected).toBe(
    plan.totals.distributed + plan.totals.remaining,
  );
  expect(plan.totals.changed).toBe(plan.changes.length);
  expect(plan.totals.unchanged).toBe(plan.unchanged.length);
  expect(
    plan.recipients.reduce(
      (sum, recipient) => sum + recipient.totals.distributed,
      0,
    ),
  ).toBe(plan.totals.distributed);

  for (const assignment of [...plan.changes, ...plan.unchanged]) {
    expect(
      input.recipients.some(
        (recipient) =>
          recipient.workspaceMemberId === assignment.recipientWorkspaceMemberId,
      ),
    ).toBe(true);
  }

  for (const lead of all) {
    const original = input.leads.find(
      (selection) => selection.recordId === lead.identity.recordId,
    );

    expect(lead.identity).toMatchObject(input.scope);
    expect(lead.expectedOwnerWorkspaceMemberId).toBe(
      original?.currentOwnerWorkspaceMemberId,
    );
    expect(lead.category).toBe(original?.category);
  }

  for (const category of ['NORMAL', 'MESSAGE_PENDING'] as const) {
    const counts = plan.totalsByCategory[category];

    expect(counts.selected).toBe(
      input.leads.filter((lead) => lead.category === category).length,
    );
    expect(counts.distributed).toBe(counts.changed + counts.unchanged);
    expect(counts.selected).toBe(counts.distributed + counts.remaining);
  }
};

describe('Lead distribution exhaustive optimality and logical isolation', () => {
  it('should achieve the minimum changes for every small TOTAL Owner configuration', () => {
    const owners = [null, ...RECIPIENT_IDS, fixtureUuid(999)];

    for (let count = 0; count <= 4; count++) {
      for (const configuration of vectors(count, owners.length)) {
        const leads = configuration.map((owner, index) =>
          makeLead(index, owners[owner]),
        );
        const input = evenInput(leads);
        const plan = buildLeadDistributionPlan(input, LIMITS);
        const minimum = minimumChanges(leads, RECIPIENT_IDS, (destinations) => {
          if (destinations.includes(RECIPIENT_IDS.length)) {
            return false;
          }
          const counts = RECIPIENT_IDS.map(
            (_, index) =>
              destinations.filter((destination) => destination === index)
                .length,
          );

          return Math.max(...counts) - Math.min(...counts) <= 1;
        });

        expect(plan.totals.changed).toBe(minimum);
        assertPartition(input, plan);
        expect(
          buildLeadDistributionPlan(
            {
              ...input,
              leads: [...leads].reverse(),
              recipients: [...input.recipients].reverse(),
            },
            LIMITS,
          ),
        ).toEqual(plan);
      }
    }
  });

  it('should minimize changes under independent category balance for all small mixed selections', () => {
    const owners = [null, ...RECIPIENT_IDS];

    for (const configuration of vectors(3, owners.length * 2)) {
      const leads = configuration.map((value, index) =>
        makeLead(
          index,
          owners[value % owners.length],
          value < owners.length ? 'NORMAL' : 'MESSAGE_PENDING',
        ),
      );
      const input = evenInput(leads, 'CATEGORY');
      const plan = buildLeadDistributionPlan(input, LIMITS);
      const minimum = minimumChanges(leads, RECIPIENT_IDS, (destinations) => {
        if (destinations.includes(RECIPIENT_IDS.length)) {
          return false;
        }

        return (['NORMAL', 'MESSAGE_PENDING'] as const).every((category) => {
          const counts = RECIPIENT_IDS.map(
            (_, recipientIndex) =>
              leads.filter(
                (lead, leadIndex) =>
                  lead.category === category &&
                  destinations[leadIndex] === recipientIndex,
              ).length,
          );

          return Math.max(...counts) - Math.min(...counts) <= 1;
        });
      });

      expect(plan.totals.changed).toBe(minimum);
      assertPartition(input, plan);
    }
  });

  it('should minimize transfers over all small manual quota selections including partial allocations', () => {
    const recipientIds = RECIPIENT_IDS.slice(0, 2);
    const owners = [null, ...recipientIds, fixtureUuid(999)];

    for (const configuration of vectors(3, owners.length)) {
      const leads = configuration.map((value, index) =>
        makeLead(index, owners[value]),
      );

      for (let first = 0; first <= leads.length; first++) {
        for (let second = 0; second <= leads.length - first; second++) {
          const quantities = [first, second];
          const input: LeadDistributionInput = {
            mode: 'MANUAL_QUOTAS',
            scope: SCOPE,
            leads,
            recipients: recipientIds.map((workspaceMemberId) => ({
              workspaceMemberId,
            })),
            quotas: recipientIds.map((recipientWorkspaceMemberId, index) => ({
              recipientWorkspaceMemberId,
              quantities: { NORMAL: quantities[index], MESSAGE_PENDING: 0 },
            })),
          };
          const plan = buildLeadDistributionPlan(input, LIMITS);
          const minimum = minimumChanges(leads, recipientIds, (destinations) =>
            quantities.every(
              (quota, recipientIndex) =>
                destinations.filter(
                  (destination) => destination === recipientIndex,
                ).length === quota,
            ),
          );

          expect(plan.totals.changed).toBe(minimum);
          expect(
            plan.recipients.map((recipient) => recipient.quantities.NORMAL),
          ).toEqual(quantities);
          assertPartition(input, plan);
        }
      }
    }
  });

  it('should honor the confirmed manual example with independent category leftovers', () => {
    const input: LeadDistributionInput = {
      mode: 'MANUAL_QUOTAS',
      scope: SCOPE,
      leads: [
        ...Array.from({ length: 70 }, (_, index) => makeLead(index)),
        ...Array.from({ length: 30 }, (_, index) =>
          makeLead(index + 70, null, 'MESSAGE_PENDING'),
        ),
      ],
      recipients: RECIPIENT_IDS.map((workspaceMemberId) => ({
        workspaceMemberId,
      })),
      quotas: RECIPIENT_IDS.map((recipientWorkspaceMemberId, index) => ({
        recipientWorkspaceMemberId,
        quantities: {
          NORMAL: [20, 15, 25][index],
          MESSAGE_PENDING: [5, 10, 5][index],
        },
      })),
    };
    const plan = buildLeadDistributionPlan(input, LIMITS);

    expect(plan.totals).toEqual({
      selected: 100,
      distributed: 80,
      changed: 80,
      unchanged: 0,
      remaining: 20,
    });
    expect(plan.totalsByCategory.NORMAL.remaining).toBe(10);
    expect(plan.totalsByCategory.MESSAGE_PENDING.remaining).toBe(10);
    expect(plan.recipients.map((recipient) => recipient.quantities)).toEqual(
      input.quotas.map((quota) => quota.quantities),
    );
    assertPartition(input, plan);
  });
});
