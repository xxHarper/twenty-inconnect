import { useLingui } from '@lingui/react/macro';

export const useVoiceResultLabel = () => {
  const { t } = useLingui();

  return {
    answered: t`Destination answered`,
    completed: t`Completed`,
    'no-answer': t`No answer`,
    busy: t`Busy`,
    canceled: t`Canceled`,
    failed: t`Failed`,
    pending: t`Pending confirmation`,
    ringing: t`Destination ringing…`,
    connecting: t`Connecting to destination…`,
  };
};
