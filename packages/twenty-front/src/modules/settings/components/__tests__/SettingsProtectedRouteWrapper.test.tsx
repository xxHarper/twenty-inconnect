import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { SettingsProtectedRouteWrapper } from '@/settings/components/SettingsProtectedRouteWrapper';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { PermissionFlagType } from '~/generated-metadata/graphql';

jest.mock('@/auth/hooks/useIsLogged', () => ({
  useIsLogged: () => true,
}));

jest.mock('@/settings/roles/hooks/useHasPermissionFlag', () => ({
  useHasPermissionFlag: jest.fn(),
}));

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

const renderManagementRoute = () =>
  render(
    <MemoryRouter
      initialEntries={['/settings/messaging/crm-context']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          element={
            <SettingsProtectedRouteWrapper
              settingsPermission={PermissionFlagType.MANAGE_INCONNECT_MESSAGING}
            />
          }
        >
          <Route
            path="/settings/messaging/crm-context"
            element={<div>CRM context management</div>}
          />
        </Route>
        <Route path="/settings/profile" element={<div>Profile settings</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('SettingsProtectedRouteWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows the CRM context Settings route with management permission', () => {
    (useHasPermissionFlag as jest.Mock).mockImplementation(
      (permission) =>
        permission === PermissionFlagType.MANAGE_INCONNECT_MESSAGING,
    );

    renderManagementRoute();

    expect(screen.getByText('CRM context management')).toBeInTheDocument();
  });

  it('redirects a direct CRM context Settings URL without management permission', () => {
    (useHasPermissionFlag as jest.Mock).mockReturnValue(false);

    renderManagementRoute();

    expect(screen.getByText('Profile settings')).toBeInTheDocument();
    expect(
      screen.queryByText('CRM context management'),
    ).not.toBeInTheDocument();
  });
});
