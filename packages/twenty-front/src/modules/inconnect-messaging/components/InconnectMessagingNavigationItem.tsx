import { useLocation } from 'react-router-dom';
import { IconMessageCircle } from 'twenty-ui/icon';
import { useLingui } from '@lingui/react/macro';

import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { INCONNECT_MESSAGING_PATH } from '@/inconnect-messaging/constants/InconnectMessagingPath';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { PermissionFlagType } from '~/generated-metadata/graphql';

export const InconnectMessagingNavigationItem = () => {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const hasMessagingPermission = useHasPermissionFlag(
    PermissionFlagType.INCONNECT_MESSAGING,
  );

  if (!hasMessagingPermission) {
    return null;
  }

  return (
    <NavigationDrawerSection>
      <NavigationDrawerItem
        label={t`Messaging`}
        Icon={IconMessageCircle}
        to={INCONNECT_MESSAGING_PATH}
        active={pathname === INCONNECT_MESSAGING_PATH}
      />
    </NavigationDrawerSection>
  );
};
