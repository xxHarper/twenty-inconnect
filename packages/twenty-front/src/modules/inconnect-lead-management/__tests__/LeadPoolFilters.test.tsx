import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';

import { LeadPoolFilters } from '@/inconnect-lead-management/components/LeadPoolFilters';

beforeEach(() => {
  i18n.load('es', {});
  i18n.activate('es');
});
it('combines metadata-backed owner, status, boolean exclusion and stable date ordering', () => {
  const search = jest.fn();
  render(
    <I18nProvider i18n={i18n}>
      <LeadPoolFilters
        disabled={false}
        onSearch={search}
        owners={[{ id: 'owner-id', label: 'Propietario visible' }]}
        fields={[
          {
            id: 'status-id',
            type: 'SELECT',
            label: 'Estado actual',
            options: [{ value: 'PENDING', label: 'Pendiente' }],
          },
          {
            id: 'boolean-id',
            type: 'BOOLEAN',
            label: 'Indicador comercial',
            options: [],
          },
          {
            id: 'date-id',
            type: 'DATE_TIME',
            label: 'Último intento',
            options: [],
          },
        ]}
      />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByLabelText('Propietario actual'), {
    target: { value: 'owner-id' },
  });
  fireEvent.change(screen.getByLabelText('Campo de filtro'), {
    target: { value: 'status-id' },
  });
  fireEvent.change(screen.getByLabelText('Estado actual'), {
    target: { value: 'PENDING' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Añadir condición AND' }));
  fireEvent.change(screen.getByLabelText('Campo de filtro'), {
    target: { value: 'boolean-id' },
  });
  fireEvent.change(screen.getByLabelText('Indicador comercial'), {
    target: { value: 'false' },
  });
  fireEvent.change(screen.getByLabelText('Ordenar por'), {
    target: { value: 'date-id' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Consultar Leads' }));
  expect(search).toHaveBeenCalledWith({
    ownerId: 'owner-id',
    conditions: [
      { fieldId: 'status-id', operator: 'EQ', value: 'PENDING' },
      { fieldId: 'boolean-id', operator: 'EQ', value: 'false' },
    ],
    orderFieldId: 'date-id',
    direction: 'ASC',
  });
});
it('does not invent Salesforce-specific filters when metadata has none', () => {
  render(
    <I18nProvider i18n={i18n}>
      <LeadPoolFilters
        disabled={false}
        onSearch={jest.fn()}
        owners={[]}
        fields={[]}
      />
    </I18nProvider>,
  );
  expect(screen.queryByText('Edenred')).not.toBeInTheDocument();
  expect(
    screen.getByLabelText('Campo de filtro').querySelectorAll('option'),
  ).toHaveLength(1);
});
