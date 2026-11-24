import { useLeadVoiceCall } from '@/inconnect-voice/hooks/useLeadVoiceCall';
import { resolveLeadVoiceDestination } from '@/inconnect-voice/utils/resolveLeadVoiceDestination';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useFindOneRecordQuery } from '@/object-record/hooks/useFindOneRecordQuery';
import { InputHint } from '@/ui/input/components/InputHint';
import { useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { IconPhone } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from 'twenty-ui/surfaces';
import { H2Title } from 'twenty-ui/typography';
import { useIsMobile } from 'twenty-ui/utilities';
import { FieldMetadataType } from '~/generated-metadata/graphql';

type LeadVoiceActionProps = {
  objectMetadataItem: EnrichedObjectMetadataItem;
  recordId: string;
};

type LeadVoiceSoftphoneProps = LeadVoiceActionProps & {
  onClose: () => void;
};

type LeadPhoneQueryResult = Record<
  string,
  ({ id: string } & Record<string, unknown>) | null
>;

const LeadVoiceSoftphone = ({
  objectMetadataItem,
  recordId,
  onClose,
}: LeadVoiceSoftphoneProps) => {
  const { t } = useLingui();
  const isMobile = useIsMobile();
  const apolloClient = useApolloCoreClient();
  const { availability, state, failure, tokenExpiring, hangUp, placeCall } =
    useLeadVoiceCall(recordId);
  const phoneFields = objectMetadataItem.fields.filter(
    (field) => field.isActive && field.type === FieldMetadataType.PHONES,
  );
  const phoneField =
    phoneFields.find(({ name }) => name === 'phone') ??
    (phoneFields.length === 1 ? phoneFields[0] : undefined);
  const readablePhone = objectMetadataItem.readableFields.find(
    ({ id }) => id === phoneField?.id,
  );
  const { findOneRecordQuery } = useFindOneRecordQuery({
    objectNameSingular: objectMetadataItem.nameSingular,
    recordGqlFields: readablePhone
      ? { id: true, [readablePhone.name]: true }
      : { id: true },
  });
  const { data, error, loading } = useQuery<LeadPhoneQueryResult>(
    findOneRecordQuery,
    {
      client: apolloClient,
      variables: { objectRecordId: recordId },
      skip: !readablePhone,
      fetchPolicy: 'no-cache',
    },
  );

  const record = data?.[objectMetadataItem.nameSingular];
  const destination =
    !loading && !error && readablePhone && record?.id === recordId
      ? resolveLeadVoiceDestination(record[readablePhone.name])
      : null;

  let destinationError: string | undefined;
  if (!readablePhone) {
    destinationError = t`A readable Phone field is unavailable for this lead.`;
  } else if (!loading && (error || !destination)) {
    destinationError = t`The lead could not be read. Close and reopen the softphone to try again.`;
  } else if (destination?.status === 'missing') {
    destinationError = t`Add a primary phone number to this lead.`;
  } else if (destination?.status === 'invalid') {
    destinationError = t`The primary phone number is invalid. Check the number and country code.`;
  }

  const title = t`Softphone`;
  const availabilityLabels = {
    loading: t`Checking Voice availability…`,
    ready: t`Twilio Voice is ready for authorized outbound calls.`,
    disabled: t`Outbound Voice is disabled.`,
    'not-configured': t`Twilio Voice is not configured.`,
    unavailable: t`Voice availability could not be verified for this session.`,
  };
  const callLabels = {
    idle: null,
    'checking-microphone': t`Checking microphone access. Allow access if asked.`,
    'loading-sdk': t`Loading the Voice SDK…`,
    preparing: t`Authorizing call…`,
    connecting: t`Connecting to Twilio…`,
    ringing: t`Ringing…`,
    active: t`Call connected`,
    reconnecting: t`Reconnecting…`,
    disconnected: t`Call disconnected`,
    'microphone-unavailable': t`Microphone access is unavailable in this browser.`,
    'microphone-denied': t`Microphone access was denied.`,
    expired: t`The Voice session expired. Start a new call to get a new session.`,
    unauthorized: t`This session does not have permission to call this lead.`,
    'destination-changed': t`The authorized phone number changed. Reopen the softphone to review it.`,
    timeout: t`Voice did not respond in time. The attempt was stopped.`,
    error: t`Voice could not complete the call.`,
  };
  const failureStages = {
    microphone: t`Microphone access`,
    sdk: t`Voice SDK setup`,
    session: t`Authorization and Voice session`,
    connection: t`Twilio connection`,
  };
  const failureStage = failure && failureStages[failure.stage];
  const failureCode = failure?.code;
  const busy = [
    'checking-microphone',
    'loading-sdk',
    'preparing',
    'connecting',
    'ringing',
    'active',
    'reconnecting',
  ].includes(state);

  return (
    <Modal
      isOpen
      ariaLabel={title}
      autoHeight
      size="small"
      padding="none"
      isMobile={isMobile}
    >
      <ModalHeader>
        <H2Title title={title} />
      </ModalHeader>
      <ModalContent gap={3}>
        {loading && <span role="status">{t`Loading lead phone…`}</span>}
        {destination?.status === 'valid' && (
          <div>
            {t`Destination`} <strong>{destination.number}</strong>
          </div>
        )}
        {destinationError && (
          <InputHint danger role="alert">
            {destinationError}
          </InputHint>
        )}
        <InputHint role="status">{availabilityLabels[availability]}</InputHint>
        {callLabels[state] && (
          <InputHint role="status">{callLabels[state]}</InputHint>
        )}
        {failureStage && (
          <InputHint role="status">
            {failureCode === undefined
              ? failureStage
              : t`${failureStage} (code ${failureCode})`}
          </InputHint>
        )}
        {tokenExpiring && (
          <InputHint role="status">{t`This Voice session is nearing expiry. A new call will request a fresh token.`}</InputHint>
        )}
      </ModalContent>
      <ModalFooter>
        <Button title={t`Close`} variant="secondary" onClick={onClose} />
        {busy ? (
          <Button title={t`Hang up`} accent="danger" onClick={hangUp} />
        ) : (
          <Button
            title={t`Place call`}
            Icon={IconPhone}
            disabled={
              availability !== 'ready' ||
              destination?.status !== 'valid' ||
              state === 'destination-changed'
            }
            onClick={() => {
              if (destination?.status === 'valid')
                void placeCall(destination.number);
            }}
          />
        )}
      </ModalFooter>
    </Modal>
  );
};

export const LeadVoiceAction = ({
  objectMetadataItem,
  recordId,
}: LeadVoiceActionProps) => {
  const { t } = useLingui();
  const [isOpen, setIsOpen] = useState(false);
  const label = t`Call`;

  return (
    <>
      <Button
        title={label}
        ariaLabel={label}
        Icon={IconPhone}
        size="small"
        variant="secondary"
        onClick={() => setIsOpen(true)}
      />
      {isOpen && (
        <LeadVoiceSoftphone
          objectMetadataItem={objectMetadataItem}
          recordId={recordId}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};
