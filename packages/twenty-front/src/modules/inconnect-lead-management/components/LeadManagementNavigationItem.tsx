import { useLingui } from '@lingui/react/macro';
import { useLocation } from 'react-router-dom';
import { IconUsers } from 'twenty-ui/icon';

import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';

export const LeadManagementNavigationItem = () => {
  const { t } = useLingui();
  const { pathname } = useLocation();
  return (
    <NavigationDrawerSection>
      <NavigationDrawerItem
        label={t`Distribuidor de Leads`}
        Icon={IconUsers}
        to="/inconnect-lead-management"
        active={pathname === '/inconnect-lead-management'}
      />
    </NavigationDrawerSection>
  );
};
