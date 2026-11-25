import { ForbiddenException, Injectable } from '@nestjs/common';

import {
  getCountryCallingCode,
  getCountries,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { FieldMetadataType } from 'twenty-shared/types';
import { z } from 'zod';

import { CommonFindOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-one-query-runner.service';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { buildObjectIdByNameMaps } from 'src/engine/metadata-modules/flat-object-metadata/utils/build-object-id-by-name-maps.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';

const primaryPhoneSchema = z.object({
  primaryPhoneNumber: z.string().trim().min(1).max(64),
  primaryPhoneCountryCode: z.string().nullish(),
  primaryPhoneCallingCode: z
    .string()
    .regex(/^(?:\+?[1-9]\d{0,2})?$/)
    .nullish(),
});

const normalizePrimaryPhone = (value: unknown) => {
  const parsed = primaryPhoneSchema.safeParse(value);

  if (!parsed.success) return null;

  const {
    primaryPhoneNumber: number,
    primaryPhoneCallingCode,
    primaryPhoneCountryCode,
  } = parsed.data;
  const country = getCountries().find(
    (code) => code === primaryPhoneCountryCode,
  );
  if (primaryPhoneCountryCode && !country) return null;

  const dial = primaryPhoneCallingCode?.replace(/^\+/, '');
  const countryDial = country && getCountryCallingCode(country);
  if (dial && countryDial && dial !== countryDial) return null;

  const input =
    !number.startsWith('+') && !country && dial ? `+${dial}${number}` : number;
  const phone = parsePhoneNumberFromString(input, {
    defaultCountry: country,
    extract: false,
  });
  const expectedDial = dial || countryDial;

  return phone?.isValid() &&
    !phone.ext &&
    (!expectedDial || phone.countryCallingCode === expectedDial)
    ? phone.number
    : null;
};

@Injectable()
export class InconnectVoiceDestinationService {
  constructor(
    private readonly workspaceCache: WorkspaceCacheService,
    private readonly findOne: CommonFindOneQueryRunnerService,
    private readonly recordAccess: InconnectRecordAccessAuthorizationService,
  ) {}

  async resolve(
    authContext: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    recordId: string,
  ) {
    const { record, phoneFieldName } = await this.readRecord(
      authContext,
      config,
      recordId,
      true,
    );
    const destination = normalizePrimaryPhone(
      phoneFieldName && record[phoneFieldName],
    );

    if (!destination || destination !== config.allowedDestination)
      throw new ForbiddenException('Voice destination is unavailable');

    return destination;
  }

  async authorizeHistory(
    authContext: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    recordId: string,
  ) {
    await this.readRecord(authContext, config, recordId, false);
    return this.getRecordCondition(authContext, config);
  }

  async getRecordCondition(
    authContext: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
  ) {
    const scope = await this.recordAccess.buildAuthorizedRecordExistsCondition({
      authContext,
      workspaceId: config.workspaceId,
      objectMetadataId: config.objectId,
      recordIdReference: { tableAlias: 'call', columnName: 'recordId' },
    });

    if (
      scope.scope.kind !== 'all-records' &&
      scope.scope.kind !== 'owner-scoped'
    ) {
      throw new ForbiddenException('Voice history is unavailable');
    }

    return scope;
  }

  private async readRecord(
    authContext: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    recordId: string,
    includePhone: boolean,
  ) {
    const workspaceId = authContext.workspace.id;
    const deny = () =>
      new ForbiddenException('Voice destination is unavailable');

    try {
      if (
        workspaceId !== config.workspaceId ||
        !(await this.recordAccess.isAuthenticatedWorkspaceMemberValid({
          authContext,
          workspaceId,
        }))
      ) {
        throw deny();
      }

      const scope = await this.recordAccess.resolveReadScope({
        authContext,
        workspaceId,
        objectMetadataId: config.objectId,
      });
      if (scope.kind !== 'all-records' && scope.kind !== 'owner-scoped')
        throw deny();

      const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
        await this.workspaceCache.getOrRecompute(workspaceId, [
          'flatObjectMetadataMaps',
          'flatFieldMetadataMaps',
        ]);
      const object = findFlatEntityByIdInFlatEntityMaps({
        flatEntityId: config.objectId,
        flatEntityMaps: flatObjectMetadataMaps,
      });
      const field = findFlatEntityByIdInFlatEntityMaps({
        flatEntityId: config.fieldId,
        flatEntityMaps: flatFieldMetadataMaps,
      });

      if (
        !object?.isActive ||
        object.workspaceId !== workspaceId ||
        object.isSystem ||
        object.isRemote ||
        (includePhone &&
          (!field?.isActive ||
            field.workspaceId !== workspaceId ||
            field.objectMetadataId !== object.id ||
            field.type !== FieldMetadataType.PHONES))
      ) {
        throw deny();
      }

      // Common Find One enforces the current object and field permissions and Record Access in the SELECT.
      const { results: record } = await this.findOne.execute(
        {
          filter: { id: { eq: recordId } },
          selectedFields: {
            id: true,
            ...(includePhone &&
              field && {
                [field.name]: {
                  primaryPhoneNumber: true,
                  primaryPhoneCallingCode: true,
                  primaryPhoneCountryCode: true,
                },
              }),
          },
        },
        {
          authContext,
          flatObjectMetadata: object,
          flatObjectMetadataMaps,
          flatFieldMetadataMaps,
          objectIdByNameSingular: buildObjectIdByNameMaps(
            flatObjectMetadataMaps,
          ).idByNameSingular,
        },
      );
      if (record.id !== recordId) throw deny();
      return { record, phoneFieldName: includePhone ? field?.name : undefined };
    } catch {
      throw deny();
    }
  }
}
