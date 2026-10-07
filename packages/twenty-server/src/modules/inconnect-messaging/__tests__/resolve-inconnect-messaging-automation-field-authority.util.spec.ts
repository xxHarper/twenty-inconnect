import { FieldMetadataType } from 'twenty-shared/types';

import { type FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { resolveInconnectMessagingAutomationFieldAuthority } from 'src/modules/inconnect-messaging/utils/resolve-inconnect-messaging-automation-field-authority.util';

const field = (overrides: Partial<FieldMetadataEntity>): FieldMetadataEntity =>
  ({
    id: crypto.randomUUID(),
    name: 'ordinary',
    type: FieldMetadataType.TEXT,
    isActive: true,
    isSystem: false,
    isSystemSideEffect: false,
    isNullable: true,
    isUIEditable: true,
    ...overrides,
  }) as FieldMetadataEntity;

describe('resolveInconnectMessagingAutomationFieldAuthority', () => {
  it('classifies only PRIMARY and Owner as deliberate and canonical position as system-required', () => {
    const primary = field({ name: 'phone', type: FieldMetadataType.PHONES });
    const owner = field({ name: 'owner', type: FieldMetadataType.RELATION });
    const position = field({
      name: 'position',
      type: FieldMetadataType.POSITION,
      isSystem: true,
      isSystemSideEffect: true,
      isNullable: false,
      isUIEditable: false,
    });
    const ordinary = field({ name: 'companyName' });
    const authority = resolveInconnectMessagingAutomationFieldAuthority({
      fields: [primary, owner, position, ordinary],
      ownerFieldMetadataId: owner.id,
      primaryFieldMetadataId: primary.id,
    });

    expect(authority).not.toBeNull();
    expect([...authority!.deliberateBusinessFieldMetadataIds]).toEqual([
      primary.id,
      owner.id,
    ]);
    expect([...authority!.requiredSystemCreateFieldMetadataIds]).toEqual([
      position.id,
    ]);
    expect([...authority!.writableFieldMetadataIds]).toEqual([
      primary.id,
      owner.id,
      position.id,
    ]);
    expect(authority!.writableFieldMetadataIds.has(ordinary.id)).toBe(false);
  });

  it('does not treat an arbitrary system-side-effect Field as create authority', () => {
    const primary = field({ name: 'phone', type: FieldMetadataType.PHONES });
    const owner = field({ name: 'owner', type: FieldMetadataType.RELATION });
    const arbitrarySystemSideEffect = field({
      name: 'generatedBusinessValue',
      isSystem: true,
      isSystemSideEffect: true,
      isNullable: false,
      isUIEditable: false,
    });

    expect(
      resolveInconnectMessagingAutomationFieldAuthority({
        fields: [primary, owner, arbitrarySystemSideEffect],
        ownerFieldMetadataId: owner.id,
        primaryFieldMetadataId: primary.id,
      }),
    ).toBeNull();
  });
});
