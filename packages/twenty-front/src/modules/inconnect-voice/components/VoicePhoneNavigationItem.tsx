import { useContext, useEffect, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { IconPhone } from 'twenty-ui/icon';

import { VoicePhoneContext } from '@/inconnect-voice/contexts/VoiceCallContext';
import { getVoicePhoneAccess } from '@/inconnect-voice/utils/voiceApi';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';

const AuthorizedPhoneNavigationItem = ({ onOpen }: { onOpen: () => void }) => {
  const { t } = useLingui();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void getVoicePhoneAccess(
      AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
    )
      .then((allowed) => {
        if (!abort.signal.aborted) setAvailable(allowed);
      })
      .catch(() => {
        if (!abort.signal.aborted) setAvailable(false);
      });
    return () => abort.abort();
  }, []);

  return (
    available && (
      <NavigationDrawerSection>
        <NavigationDrawerItem
          label={t`Phone`}
          Icon={IconPhone}
          onClick={onOpen}
          triggerEvent="CLICK"
        />
      </NavigationDrawerSection>
    )
  );
};

export const VoicePhoneNavigationItem = () => {
  const onOpen = useContext(VoicePhoneContext);
  return onOpen ? <AuthorizedPhoneNavigationItem onOpen={onOpen} /> : null;
};
