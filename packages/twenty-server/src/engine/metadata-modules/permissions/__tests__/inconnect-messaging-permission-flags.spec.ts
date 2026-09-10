import {
  PermissionFlagType,
  SystemPermissionFlag,
} from 'twenty-shared/constants';

import { STANDARD_PERMISSION_FLAG_DEFINITIONS } from 'src/engine/metadata-modules/permission-flag/constants/standard-permission-flag-definitions.constant';
import { TOOL_PERMISSION_FLAGS } from 'src/engine/metadata-modules/permissions/constants/tool-permission-flags';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { type RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

const TOOL_FLAGS = [
  PermissionFlagType.INCONNECT_MESSAGING,
  PermissionFlagType.SEND_INCONNECT_MESSAGING,
  PermissionFlagType.TRIAGE_INCONNECT_MESSAGING,
];

describe('INCONNECT Messaging permission flags', () => {
  const service = new PermissionsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('defines stable identifiers and the approved permission classifications', () => {
    const definitionsByKey = Object.fromEntries(
      STANDARD_PERMISSION_FLAG_DEFINITIONS.map((definition) => [
        definition.key,
        definition,
      ]),
    );

    for (const flag of TOOL_FLAGS) {
      expect(SystemPermissionFlag[flag]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(TOOL_PERMISSION_FLAGS).toContain(flag);
      expect(definitionsByKey[flag].permissionType).toBe('tool');
    }

    expect(TOOL_PERMISSION_FLAGS).not.toContain(
      PermissionFlagType.MANAGE_INCONNECT_MESSAGING,
    );
    expect(
      definitionsByKey[PermissionFlagType.MANAGE_INCONNECT_MESSAGING]
        .permissionType,
    ).toBe('settings');
  });

  it('defaults every Messaging permission to false', () => {
    const defaults = service.getDefaultUserWorkspacePermissions();

    for (const flag of [
      ...TOOL_FLAGS,
      PermissionFlagType.MANAGE_INCONNECT_MESSAGING,
    ]) {
      expect(defaults.permissionFlags[flag]).toBe(false);
    }
  });

  it('grants only tool flags through canAccessAllTools', () => {
    const role = {
      canAccessAllTools: true,
      canUpdateAllSettings: false,
      rolePermissionFlags: [],
    } as unknown as RoleEntity;

    for (const flag of TOOL_FLAGS) {
      expect(service.checkRolePermissions(role, flag)).toBe(true);
    }
    expect(
      service.checkRolePermissions(
        role,
        PermissionFlagType.MANAGE_INCONNECT_MESSAGING,
      ),
    ).toBe(false);
  });

  it('grants only the settings flag through canUpdateAllSettings', () => {
    const role = {
      canAccessAllTools: false,
      canUpdateAllSettings: true,
      rolePermissionFlags: [],
    } as unknown as RoleEntity;

    expect(
      service.checkRolePermissions(
        role,
        PermissionFlagType.MANAGE_INCONNECT_MESSAGING,
      ),
    ).toBe(true);
    for (const flag of TOOL_FLAGS) {
      expect(service.checkRolePermissions(role, flag)).toBe(false);
    }
  });

  it('does not grant any Messaging capability without a base or explicit flag', () => {
    const role = {
      canAccessAllTools: false,
      canUpdateAllSettings: false,
      rolePermissionFlags: [],
    } as unknown as RoleEntity;

    for (const flag of [
      ...TOOL_FLAGS,
      PermissionFlagType.MANAGE_INCONNECT_MESSAGING,
    ]) {
      expect(service.checkRolePermissions(role, flag)).toBe(false);
    }
  });
});
