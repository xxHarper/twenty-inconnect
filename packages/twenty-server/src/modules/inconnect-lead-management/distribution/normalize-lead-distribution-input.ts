import { validate as isUuid } from 'uuid';
import { z } from 'zod';

import { LeadDistributionError } from 'src/modules/inconnect-lead-management/distribution/lead-distribution-error';
import {
  type LeadDistributionInput,
  type LeadDistributionLimits,
} from 'src/modules/inconnect-lead-management/distribution/lead-distribution.types';

const canonicalUuid = z
  .string()
  .refine(isUuid)
  .transform((value) => value.toLowerCase());
const quantity = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const limitsSchema = z.strictObject({
  maxLeads: quantity,
  maxRecipients: quantity,
});

const boundedArray = <TSchema extends z.ZodType>(
  schema: TSchema,
  maximum: number,
) =>
  z
    .unknown()
    .refine((value) => Array.isArray(value) && value.length <= maximum)
    .pipe(z.array(schema));

export const normalizeLeadDistributionInput = (
  input: LeadDistributionInput,
  limits: LeadDistributionLimits,
): LeadDistributionInput => {
  const parsedLimits = limitsSchema.safeParse(limits);

  if (!parsedLimits.success) {
    throw new LeadDistributionError('INVALID_LIMITS');
  }

  const base = z.strictObject({
    scope: z.strictObject({
      workspaceId: canonicalUuid,
      objectMetadataId: canonicalUuid,
    }),
    leads: boundedArray(
      z.strictObject({
        recordId: canonicalUuid,
        currentOwnerWorkspaceMemberId: canonicalUuid.nullable(),
        category: z.enum(['NORMAL', 'MESSAGE_PENDING']),
      }),
      parsedLimits.data.maxLeads,
    ),
    recipients: boundedArray(
      z.strictObject({ workspaceMemberId: canonicalUuid }),
      parsedLimits.data.maxRecipients,
    ),
  });
  const parsed = z
    .discriminatedUnion('mode', [
      base.extend({ mode: z.literal('SINGLE') }),
      base.extend({
        mode: z.literal('EVEN'),
        balanceBy: z.enum(['TOTAL', 'CATEGORY']),
      }),
      base.extend({
        mode: z.literal('MANUAL_QUOTAS'),
        quotas: boundedArray(
          z.strictObject({
            recipientWorkspaceMemberId: canonicalUuid,
            quantities: z.strictObject({
              NORMAL: quantity,
              MESSAGE_PENDING: quantity,
            }),
          }),
          parsedLimits.data.maxRecipients,
        ),
      }),
    ])
    .safeParse(input);

  if (!parsed.success) {
    throw new LeadDistributionError('INVALID_INPUT');
  }

  const normalized = parsed.data;
  const leadIds = new Set(normalized.leads.map((lead) => lead.recordId));
  const recipientIds = new Set(
    normalized.recipients.map((recipient) => recipient.workspaceMemberId),
  );

  if (leadIds.size !== normalized.leads.length) {
    throw new LeadDistributionError('DUPLICATE_LEAD');
  }

  if (recipientIds.size !== normalized.recipients.length) {
    throw new LeadDistributionError('DUPLICATE_RECIPIENT');
  }

  if (normalized.mode === 'SINGLE' && recipientIds.size !== 1) {
    throw new LeadDistributionError('INVALID_INPUT');
  }

  if (normalized.mode === 'MANUAL_QUOTAS') {
    const quotaIds = new Set(
      normalized.quotas.map((quota) => quota.recipientWorkspaceMemberId),
    );

    if (
      quotaIds.size !== normalized.quotas.length ||
      quotaIds.size !== recipientIds.size ||
      [...quotaIds].some((recipientId) => !recipientIds.has(recipientId))
    ) {
      throw new LeadDistributionError('INVALID_QUOTAS');
    }
  }

  // Sorting copies produced by parsing cannot mutate caller-owned arrays.
  normalized.leads.sort((left, right) =>
    left.recordId < right.recordId ? -1 : 1,
  );
  normalized.recipients.sort((left, right) =>
    left.workspaceMemberId < right.workspaceMemberId ? -1 : 1,
  );

  return normalized;
};
