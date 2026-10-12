import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import {
  type CountryCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { FieldMetadataType } from 'twenty-shared/types';
import { normalizePhoneIdentity } from 'twenty-shared/utils';
import {
  DataSource,
  type EntityManager,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { computeCompositeColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-column-name.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import { INCONNECT_MESSAGING_MAX_PHONE_IDENTITY_FIELDS } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-context.constant';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
  type InconnectMessagingPhoneIdentityResolution,
  type InconnectMessagingPhoneIdentityFieldRole,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

type PhoneIdentityFieldMetadata = Pick<
  FieldMetadataEntity,
  'id' | 'name' | 'type' | 'workspaceId' | 'objectMetadataId' | 'isActive'
>;

type CanonicalPhoneIdentity = {
  countryCode: CountryCode;
  callingCode: string;
  nationalNumber: string;
};

type PhoneIdentityResolutionAuthority =
  | {
      kind: 'HUMAN';
      authContext: WorkspaceAuthContext;
      authorizationService: InconnectMessagingAuthorizationService;
      recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService;
    }
  | {
      kind: typeof INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR;
      workspaceId: string;
    };

type TransactionBoundPhoneIdentityResolutionPersistence = {
  queryRunner: WorkspaceQueryRunner;
  coreQueryBuilderService: WorkspaceQueryRunnerCoreQueryBuilderService;
  createDynamicRecordQueryBuilder: () => SelectQueryBuilder<ObjectLiteral>;
};

type PhoneIdentityResolutionPersistence =
  | DataSource
  | EntityManager
  | TransactionBoundPhoneIdentityResolutionPersistence;

export type InconnectMessagingPhoneIdentityLinkResolution =
  | Exclude<InconnectMessagingPhoneIdentityResolution, { state: 'UNIQUE' }>
  | {
      state: 'UNIQUE';
      recordId: string;
      objectMetadataId: string;
    };

const phoneColumn = (
  fieldMetadata: PhoneIdentityFieldMetadata,
  propertyName:
    | 'primaryPhoneCountryCode'
    | 'primaryPhoneCallingCode'
    | 'primaryPhoneNumber',
): string =>
  computeCompositeColumnName(fieldMetadata, {
    name: propertyName,
    type: FieldMetadataType.TEXT,
    hidden: false,
    isRequired: false,
  });

const hasValidConfigurationShape = ({
  configuredFields,
  workspaceId,
  objectMetadataId,
}: {
  configuredFields: InconnectMessagingPhoneIdentityFieldEntity[];
  workspaceId: string;
  objectMetadataId: string;
}): boolean => {
  const primaryCount = configuredFields.filter(
    ({ role }) => role === 'PRIMARY',
  ).length;
  const rolesAreValid = configuredFields.every(({ role }) =>
    (
      ['PRIMARY', 'MATCH_ONLY'] as InconnectMessagingPhoneIdentityFieldRole[]
    ).includes(role),
  );
  const fieldIds = configuredFields.map(
    ({ fieldMetadataId }) => fieldMetadataId,
  );
  const ordinals = configuredFields.map(({ ordinal }) => ordinal);

  return (
    primaryCount === 1 &&
    rolesAreValid &&
    configuredFields.every(
      (field) =>
        field.workspaceId === workspaceId &&
        field.objectMetadataId === objectMetadataId,
    ) &&
    new Set(fieldIds).size === fieldIds.length &&
    new Set(ordinals).size === ordinals.length &&
    ordinals.every(
      (ordinal, index) => Number.isInteger(ordinal) && ordinal === index,
    )
  );
};

const parseCanonicalPhoneIdentity = ({
  input,
  defaultCountry,
}: {
  input: string | null | undefined;
  defaultCountry?: CountryCode;
}): CanonicalPhoneIdentity | null => {
  const canonicalIdentity = normalizePhoneIdentity(input, { defaultCountry });

  if (canonicalIdentity === null) {
    return null;
  }

  const parsedPhone = parsePhoneNumberFromString(canonicalIdentity);

  if (parsedPhone?.isValid() !== true || parsedPhone.country === undefined) {
    return null;
  }

  return {
    countryCode: parsedPhone.country,
    callingCode: `+${parsedPhone.countryCallingCode}`,
    nationalNumber: parsedPhone.nationalNumber,
  };
};

const resolvePhoneIdentityWithAuthority = async ({
  persistence,
  workspaceCacheService,
  authority,
  input,
  defaultCountry,
  lockAuthority = false,
}: {
  persistence: PhoneIdentityResolutionPersistence;
  workspaceCacheService: WorkspaceCacheService;
  authority: PhoneIdentityResolutionAuthority;
  input: string | null | undefined;
  defaultCountry?: CountryCode;
  lockAuthority?: boolean;
}): Promise<InconnectMessagingPhoneIdentityLinkResolution> => {
  const canonicalIdentity = parseCanonicalPhoneIdentity({
    input,
    defaultCountry,
  });

  if (canonicalIdentity === null) {
    return { state: 'INVALID' };
  }

  const workspaceId =
    authority.kind === 'HUMAN'
      ? authority.authContext.workspace.id
      : authority.workspaceId;
  const isTransactionBound =
    'coreQueryBuilderService' in persistence && 'queryRunner' in persistence;
  const createCoreQueryBuilder = <TEntity extends object>(
    target: new () => TEntity,
    alias: string,
  ) =>
    isTransactionBound
      ? persistence.coreQueryBuilderService.createCoreQueryBuilder({
          queryRunner: persistence.queryRunner,
          target,
          alias,
        })
      : persistence.getRepository(target).createQueryBuilder(alias);
  const configurationQuery = createCoreQueryBuilder(
    InconnectMessagingConfigurationEntity,
    'configuration',
  ).where('configuration.workspaceId = :workspaceId', { workspaceId });

  if (lockAuthority) {
    configurationQuery.setLock('pessimistic_read');
  }

  const configuration = await configurationQuery.getOne();

  if (configuration === null) {
    return { state: 'DISABLED' };
  }

  const configuredFields = await createCoreQueryBuilder(
    InconnectMessagingPhoneIdentityFieldEntity,
    'phoneIdentityField',
  )
    .where('phoneIdentityField.workspaceId = :workspaceId', { workspaceId })
    .orderBy('phoneIdentityField.ordinal', 'ASC')
    .getMany();

  if (
    configuredFields.length === 0 ||
    configuredFields.length > INCONNECT_MESSAGING_MAX_PHONE_IDENTITY_FIELDS
  ) {
    return { state: 'DISABLED' };
  }

  const objectMetadata = await createCoreQueryBuilder(
    ObjectMetadataEntity,
    'objectMetadata',
  )
    .where('objectMetadata.id = :objectMetadataId', {
      objectMetadataId: configuration.anchorObjectMetadataId,
    })
    .andWhere('objectMetadata.workspaceId = :workspaceId', { workspaceId })
    .getOne();

  if (
    objectMetadata === null ||
    !hasValidConfigurationShape({
      configuredFields,
      workspaceId,
      objectMetadataId: objectMetadata.id,
    })
  ) {
    return { state: 'DISABLED' };
  }

  const fieldMetadata = await createCoreQueryBuilder(
    FieldMetadataEntity,
    'fieldMetadata',
  )
    .where('fieldMetadata.id IN (:...fieldMetadataIds)', {
      fieldMetadataIds: configuredFields.map((field) => field.fieldMetadataId),
    })
    .andWhere('fieldMetadata.workspaceId = :workspaceId', { workspaceId })
    .andWhere('fieldMetadata.objectMetadataId = :objectMetadataId', {
      objectMetadataId: objectMetadata.id,
    })
    .andWhere('fieldMetadata.isActive = :isActive', { isActive: true })
    .andWhere('fieldMetadata.type = :type', { type: FieldMetadataType.PHONES })
    .getMany();

  if (fieldMetadata.length !== configuredFields.length) {
    return { state: 'DISABLED' };
  }

  const fieldMetadataById = new Map(
    fieldMetadata.map((field) => [field.id, field]),
  );
  const orderedFieldMetadata = configuredFields.flatMap((configuredField) => {
    const field = fieldMetadataById.get(configuredField.fieldMetadataId);

    return field === undefined ? [] : [field];
  });

  if (orderedFieldMetadata.length !== configuredFields.length) {
    return { state: 'DISABLED' };
  }

  let databaseSchema: string | null | undefined;

  if (authority.kind === 'HUMAN') {
    const readableFieldIds =
      await authority.authorizationService.filterReadableFieldMetadataIds({
        authContext: authority.authContext,
        objectMetadataId: objectMetadata.id,
        fieldMetadataIds: orderedFieldMetadata.map((field) => field.id),
      });

    // A configured field is part of identity authority. Omitting an unreadable
    // field could produce a misleading UNIQUE classification, so the human
    // resolver returns the same non-disclosing result as an empty authorized set.
    if (
      readableFieldIds === null ||
      orderedFieldMetadata.some((field) => !readableFieldIds.has(field.id))
    ) {
      return { state: 'NO_MATCH' };
    }

    databaseSchema = authority.authContext.workspace.databaseSchema;
  } else {
    const workspace = await createCoreQueryBuilder(WorkspaceEntity, 'workspace')
      .select(['workspace.id', 'workspace.databaseSchema'])
      .where('workspace.id = :workspaceId', { workspaceId })
      .getOne();

    if (workspace === null || !isNonEmptyString(workspace.databaseSchema)) {
      return { state: 'DISABLED' };
    }

    databaseSchema = workspace.databaseSchema;
  }

  if (!isNonEmptyString(databaseSchema)) {
    return authority.kind === 'HUMAN'
      ? { state: 'NO_MATCH' }
      : { state: 'DISABLED' };
  }

  const { flatObjectMetadataMaps } = await workspaceCacheService.getOrRecompute(
    workspaceId,
    ['flatObjectMetadataMaps'],
  );
  const objectUniversalIdentifier =
    flatObjectMetadataMaps.universalIdentifierById[objectMetadata.id];
  const flatObjectMetadata = objectUniversalIdentifier
    ? flatObjectMetadataMaps.byUniversalIdentifier[objectUniversalIdentifier]
    : undefined;

  if (
    flatObjectMetadata === undefined ||
    flatObjectMetadata.id !== objectMetadata.id ||
    flatObjectMetadata.workspaceId !== workspaceId
  ) {
    return { state: 'DISABLED' };
  }

  const recordAlias = 'inconnect_messaging_phone_identity_record';
  const escapedRecordAlias = escapeIdentifier(recordAlias);
  const qualifiedTableName = `${databaseSchema}.${computeObjectTargetTable(
    flatObjectMetadata,
  )}`;
  const parameters: Record<string, string> = {
    phoneIdentityCountryCode: canonicalIdentity.countryCode,
    phoneIdentityCallingCode: canonicalIdentity.callingCode,
    phoneIdentityNationalNumber: canonicalIdentity.nationalNumber,
  };
  const fieldPredicates = orderedFieldMetadata.map((field) => {
    const countryColumn = phoneColumn(field, 'primaryPhoneCountryCode');
    const callingCodeColumn = phoneColumn(field, 'primaryPhoneCallingCode');
    const numberColumn = phoneColumn(field, 'primaryPhoneNumber');

    return `(${escapedRecordAlias}.${escapeIdentifier(
      countryColumn,
    )} = :phoneIdentityCountryCode AND ${escapedRecordAlias}.${escapeIdentifier(
      callingCodeColumn,
    )} = :phoneIdentityCallingCode AND ${escapedRecordAlias}.${escapeIdentifier(
      numberColumn,
    )} = :phoneIdentityNationalNumber)`;
  });
  const queryBuilder = (
    isTransactionBound
      ? persistence.createDynamicRecordQueryBuilder()
      : persistence.createQueryBuilder()
  )
    .select(`${escapedRecordAlias}."id"`, 'recordId')
    .from(qualifiedTableName, recordAlias)
    .where(`${escapedRecordAlias}."deletedAt" IS NULL`)
    .andWhere(`(${fieldPredicates.join(' OR ')})`, parameters)
    .limit(2);

  if (lockAuthority) {
    queryBuilder.setLock('pessimistic_read');
  } else {
    queryBuilder.distinct(true);
  }

  if (authority.kind === 'HUMAN') {
    const recordAccessScope =
      await authority.recordAccessAuthorizationService.applyReadScopeToQueryBuilder(
        {
          queryBuilder,
          tableAlias: recordAlias,
          workspaceId,
          objectMetadataId: objectMetadata.id,
          authContext: authority.authContext,
        },
      );

    if (recordAccessScope.kind === 'denied') {
      return { state: 'NO_MATCH' };
    }
  }

  const rows = await queryBuilder.getRawMany<{ recordId: string }>();
  const recordIds = [
    ...new Set(
      rows
        .map(({ recordId }) => recordId)
        .filter((recordId) => isNonEmptyString(recordId)),
    ),
  ].slice(0, 2);

  if (recordIds.length === 0) {
    return { state: 'NO_MATCH' };
  }

  if (recordIds.length === 1) {
    return {
      state: 'UNIQUE',
      recordId: recordIds[0],
      objectMetadataId: objectMetadata.id,
    };
  }

  return { state: 'AMBIGUOUS' };
};

@Injectable()
export class InconnectMessagingPhoneIdentityResolverService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async resolvePhoneIdentity({
    authContext,
    input,
    defaultCountry,
  }: {
    authContext: WorkspaceAuthContext;
    input: string | null | undefined;
    defaultCountry?: CountryCode;
  }): Promise<InconnectMessagingPhoneIdentityResolution> {
    const resolution = await resolvePhoneIdentityWithAuthority({
      persistence: this.dataSource,
      workspaceCacheService: this.workspaceCacheService,
      authority: {
        kind: 'HUMAN',
        authContext,
        authorizationService: this.authorizationService,
        recordAccessAuthorizationService: this.recordAccessAuthorizationService,
      },
      input,
      defaultCountry,
    });

    return resolution.state === 'UNIQUE'
      ? { state: 'UNIQUE', recordId: resolution.recordId }
      : resolution;
  }
}

// This service is deliberately module-private. Its only authority is the exact
// configured phone-identity classification implemented by the shared resolver.
@Injectable()
export class InconnectMessagingBackgroundPhoneIdentityResolverService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly coreQueryBuilderService: WorkspaceQueryRunnerCoreQueryBuilderService,
  ) {}

  async resolvePhoneIdentity({
    workspaceId,
    input,
    defaultCountry,
  }: {
    workspaceId: string;
    input: string | null | undefined;
    defaultCountry?: CountryCode;
  }): Promise<InconnectMessagingPhoneIdentityResolution> {
    const resolution = await resolvePhoneIdentityWithAuthority({
      persistence: this.dataSource,
      workspaceCacheService: this.workspaceCacheService,
      authority: {
        kind: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
        workspaceId,
      },
      input,
      defaultCountry,
    });

    return resolution.state === 'UNIQUE'
      ? { state: 'UNIQUE', recordId: resolution.recordId }
      : resolution;
  }

  async resolvePhoneIdentityForLink({
    queryRunner,
    workspaceId,
    input,
  }: {
    queryRunner: WorkspaceQueryRunner;
    workspaceId: string;
    input: string | null | undefined;
  }): Promise<InconnectMessagingPhoneIdentityLinkResolution> {
    return resolvePhoneIdentityWithAuthority({
      persistence: {
        queryRunner,
        coreQueryBuilderService: this.coreQueryBuilderService,
        // This narrow dynamic CRM lookup remains outside the Core gateway.
        createDynamicRecordQueryBuilder: () =>
          this.dataSource.createQueryBuilder(queryRunner),
      },
      workspaceCacheService: this.workspaceCacheService,
      authority: {
        kind: INCONNECT_MESSAGING_BACKGROUND_PHONE_IDENTITY_ACTOR,
        workspaceId,
      },
      input,
      lockAuthority: true,
    });
  }
}
