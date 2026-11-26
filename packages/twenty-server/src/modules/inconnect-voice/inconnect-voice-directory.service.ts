import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { computeCompositeColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-column-name.util';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { getObjectsPermissionsFromRolePermissionConfig } from 'src/engine/twenty-orm/utils/get-objects-permissions-from-role-permission-config.util';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { type normalizeVoiceDialNumber } from 'src/modules/inconnect-voice/inconnect-voice-dial-number';

const unavailable = () =>
  new ForbiddenException('Voice directory is unavailable');
const alias = 'voiceLead';
const column = (name: string) =>
  `${escapeIdentifier(alias)}.${escapeIdentifier(name)}`;
const compositeColumn = (
  field: { name: string; type: FieldMetadataType },
  name: string,
) =>
  column(
    computeCompositeColumnName(field, {
      name,
      type: FieldMetadataType.TEXT,
      hidden: false,
      isRequired: false,
    }),
  );

@Injectable()
export class InconnectVoiceDirectoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cache: WorkspaceCacheService,
    private readonly recordAccess: InconnectRecordAccessAuthorizationService,
  ) {}

  async rolePermissions(authContext: UserWorkspaceAuthContext) {
    const workspaceId = authContext.workspace.id;
    if (
      !(await this.recordAccess.isAuthenticatedWorkspaceMemberValid({
        authContext,
        workspaceId,
      }))
    )
      throw unavailable();

    const { userWorkspaceRoleMap, apiKeyRoleMap, rolesPermissions } =
      await this.cache.getOrRecompute(workspaceId, [
        'userWorkspaceRoleMap',
        'apiKeyRoleMap',
        'rolesPermissions',
      ]);
    const rolePermissionConfig = resolveRolePermissionConfig({
      authContext,
      userWorkspaceRoleMap,
      apiKeyRoleMap,
    });
    if (
      !rolePermissionConfig ||
      'shouldBypassPermissionChecks' in rolePermissionConfig
    )
      throw unavailable();

    return {
      rolePermissionConfig,
      objectsPermissions: getObjectsPermissionsFromRolePermissionConfig({
        rolesPermissions,
        rolePermissionConfig,
      }),
    };
  }

  async query(
    authContext: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    phone: ReturnType<typeof normalizeVoiceDialNumber>,
    inbound = false,
  ) {
    const workspaceId = authContext.workspace.id;
    const schema = authContext.workspace.databaseSchema;
    if (
      workspaceId !== config.workspaceId ||
      !schema ||
      !/^[A-Za-z_][A-Za-z_0-9]*$/.test(schema)
    )
      throw unavailable();

    const { objectsPermissions } = await this.rolePermissions(authContext);
    const permission = objectsPermissions[config.objectId];
    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.cache.getOrRecompute(workspaceId, [
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
      permission?.canReadObjectRecords !== true ||
      Boolean(permission.rowLevelPermissionPredicates?.length) ||
      Boolean(permission.rowLevelPermissionPredicateGroups?.length) ||
      !field?.isActive ||
      field.workspaceId !== workspaceId ||
      field.objectMetadataId !== object.id ||
      field.type !== FieldMetadataType.PHONES ||
      permission.restrictedFields?.[field.id]?.canRead === false
    )
      throw unavailable();

    const table = computeObjectTargetTable(object);
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(table)) throw unavailable();

    const id = column('id');
    const number = compositeColumn(field, 'primaryPhoneNumber');
    const compact = `regexp_replace(${number}, '[[:space:]()-]', '', 'g')`;
    const country = compositeColumn(field, 'primaryPhoneCountryCode');
    const callingCode = compositeColumn(field, 'primaryPhoneCallingCode');
    const mexican = phone.country === 'MX';

    const query = this.dataSource
      .createQueryBuilder()
      .from(`${schema}.${table}`, alias)
      .where(`${column('deletedAt')} IS NULL`)
      .andWhere(
        `(NULLIF(${country}, '') IS NULL OR ${country} = :voiceCountry)`,
      )
      .andWhere(
        `(NULLIF(${callingCode}, '') IS NULL OR ${callingCode} IN (:voiceCallingCode, :voiceCallingDigits))`,
      )
      .andWhere(`${number} ~ :voicePhoneShape`)
      .andWhere(
        `(${compact} IN (:...voiceInternational)
        OR (${compact} = :voiceNational AND (
          ${country} = :voiceCountry OR ${callingCode} IN (:voiceCallingCode, :voiceCallingDigits)
          OR :voiceUseDefault
        )))`,
        {
          voiceCountry: phone.country,
          voiceCallingCode: `+${phone.countryCallingCode}`,
          voiceCallingDigits: phone.countryCallingCode,
          voicePhoneShape:
            '^[[:space:]]*[+]?([0-9[:space:]-]|[(][0-9[:space:]-]+[)])+$',
          voiceInternational: mexican
            ? [
                phone.number,
                phone.number.slice(1),
                `+521${phone.nationalNumber}`,
                `521${phone.nationalNumber}`,
              ]
            : [phone.number],
          voiceNational: phone.nationalNumber,
          voiceUseDefault: config.defaultCountry === phone.country,
        },
      );

    // Count exact matches across the workspace without returning a restricted record.
    if (inbound) {
      const exactSet = query.clone().select(id).limit(2);
      query.andWhere(
        `(SELECT COUNT(*) FROM (${exactSet.getQuery()}) AS exact_phone) = 1`,
      );
    }

    const scopeArgs = {
      queryBuilder: query,
      tableAlias: alias,
      authContext,
      workspaceId,
      objectMetadataId: object.id,
    };
    const scope = inbound
      ? await this.recordAccess.applyOwnedReadScopeToQueryBuilder(scopeArgs)
      : await this.recordAccess.applyReadScopeToQueryBuilder(scopeArgs);
    if (scope.kind !== 'all-records' && scope.kind !== 'owner-scoped')
      throw unavailable();

    const labelField = object.labelIdentifierFieldMetadataId
      ? findFlatEntityByIdInFlatEntityMaps({
          flatEntityId: object.labelIdentifierFieldMetadataId,
          flatEntityMaps: flatFieldMetadataMaps,
        })
      : undefined;
    let name = 'NULL::text';
    if (
      labelField?.isActive &&
      labelField.workspaceId === workspaceId &&
      labelField.objectMetadataId === object.id &&
      permission.restrictedFields?.[labelField.id]?.canRead !== false
    ) {
      if (labelField.type === FieldMetadataType.TEXT)
        name = column(labelField.name);
      if (labelField.type === FieldMetadataType.FULL_NAME)
        name = `NULLIF(CONCAT_WS(' ', ${compositeColumn(labelField, 'firstName')}, ${compositeColumn(labelField, 'lastName')}), '')`;
    }

    return { query, id, name };
  }

  async lookup(
    authContext: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    phone: ReturnType<typeof normalizeVoiceDialNumber>,
    after?: string,
  ) {
    const { query, id, name } = await this.query(authContext, config, phone);
    if (after) query.andWhere(`${id} > :voiceAfter`, { voiceAfter: after });

    const rows = await query
      .select(id, 'recordId')
      .addSelect(name, 'name')
      .orderBy(id, 'ASC')
      .limit(11)
      .getRawMany<{ recordId: string; name: string | null }>();

    return {
      candidates: rows.slice(0, 10),
      next: rows.length > 10 ? rows[9].recordId : null,
    };
  }

  async dialCondition(
    authContext: UserWorkspaceAuthContext,
    config: InconnectVoiceConfig,
    phone: ReturnType<typeof normalizeVoiceDialNumber>,
    recordId: string | null,
  ) {
    const { query, id } = await this.query(authContext, config, phone);
    if (recordId !== null) query.andWhere(`${id} = call."recordId"`);

    return {
      sql: `${recordId === null ? 'NOT ' : ''}EXISTS (${query.select('1').getQuery()})`,
      parameters: query.getParameters(),
    };
  }
}
