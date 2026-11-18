import { HeadlessEngineCommandWrapperEffect } from '@/command-menu-item/engine-command/components/HeadlessEngineCommandWrapperEffect';
import { useHeadlessCommandContextApi } from '@/command-menu-item/engine-command/hooks/useHeadlessCommandContextApi';
import { CreateLeadFromIndexDialog } from '@/inconnect-lead-management/components/CreateLeadFromIndexDialog';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useCreateNewIndexRecord } from '@/object-record/record-table/hooks/useCreateNewIndexRecord';
import { isDefined } from 'twenty-shared/utils';

type CreateNewIndexRecordImmediatelyProps = {
  objectMetadataItem: EnrichedObjectMetadataItem;
  recordIndexId: string;
};

const CreateNewIndexRecordImmediately = ({
  objectMetadataItem,
  recordIndexId,
}: CreateNewIndexRecordImmediatelyProps) => {
  const { createNewIndexRecord } = useCreateNewIndexRecord({
    objectMetadataItem,
    instanceId: recordIndexId,
  });

  return (
    <HeadlessEngineCommandWrapperEffect
      execute={() => createNewIndexRecord({ position: 'first' })}
    />
  );
};

export const CreateNewIndexRecordNoSelectionRecordCommand = () => {
  const { objectMetadataItem, recordIndexId } = useHeadlessCommandContextApi();

  if (!isDefined(objectMetadataItem) || !isDefined(recordIndexId)) {
    throw new Error(
      'Object metadata item and record index ID are required to create new index record',
    );
  }

  if (
    objectMetadataItem.nameSingular === 'lead' &&
    !objectMetadataItem.isSystem
  ) {
    return (
      <CreateLeadFromIndexDialog objectMetadataItem={objectMetadataItem} />
    );
  }

  return (
    <CreateNewIndexRecordImmediately
      objectMetadataItem={objectMetadataItem}
      recordIndexId={recordIndexId}
    />
  );
};
