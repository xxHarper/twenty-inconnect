import { VoiceCallContext } from '@/inconnect-voice/contexts/VoiceCallContext';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useLingui } from '@lingui/react/macro';
import { useContext } from 'react';
import { IconPhone } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';

type LeadVoiceActionProps = {
  objectMetadataItem: EnrichedObjectMetadataItem;
  recordId: string;
};

export const LeadVoiceAction = ({
  objectMetadataItem,
  recordId,
}: LeadVoiceActionProps) => {
  const { t } = useLingui();
  const openSoftphone = useContext(VoiceCallContext);
  const label = t`Call`;

  if (!openSoftphone) return null;

  return (
    <Button
      title={label}
      ariaLabel={label}
      Icon={IconPhone}
      size="small"
      variant="secondary"
      onClick={() =>
        openSoftphone({
          objectMetadataId: objectMetadataItem.id,
          objectNameSingular: objectMetadataItem.nameSingular,
          recordId,
        })
      }
    />
  );
};
