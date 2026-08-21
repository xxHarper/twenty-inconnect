export const getInconnectRecordAccessRuleKey = ({
  objectMetadataId,
  roleId,
}: {
  objectMetadataId: string;
  roleId: string;
}): string => `${objectMetadataId}:${roleId}`;
