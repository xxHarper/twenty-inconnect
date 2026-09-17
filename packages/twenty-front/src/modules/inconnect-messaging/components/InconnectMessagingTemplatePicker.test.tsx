import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingTemplatePicker } from '@/inconnect-messaging/components/InconnectMessagingTemplatePicker';
import { type InconnectMessagingTemplate } from '@/inconnect-messaging/types/InconnectMessagingRead';
import { messages } from '~/locales/generated/en';

jest.mock('@/ui/layout/modal/components/ModalStatefulWrapper', () => ({
  ModalStatefulWrapper: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

jest.mock('@/ui/layout/modal/hooks/useModal', () => ({
  useModal: () => ({ closeModal: jest.fn() }),
}));

const template: InconnectMessagingTemplate = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Appointment reminder',
  language: 'es',
  body: 'Hola {{1}}',
  variables: [{ key: '1', required: true, maxLength: 1600 }],
};

const Harness = ({ onSend }: { onSend: jest.Mock }) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );

  return (
    <InconnectMessagingTemplatePicker
      modalInstanceId="template-picker"
      templates={[template]}
      loading={false}
      loadFailed={false}
      selectedTemplateId={selectedTemplateId}
      variableValues={variableValues}
      errorMessage={null}
      sending={false}
      onSelect={(selected) => {
        setSelectedTemplateId(selected.id);
        setVariableValues({ '1': '' });
      }}
      onVariableChange={(key, value) =>
        setVariableValues((current) => ({ ...current, [key]: value }))
      }
      onSend={onSend}
      onClose={jest.fn()}
    />
  );
};

describe('InconnectMessagingTemplatePicker', () => {
  it('renders normalized templates, variable inputs, and a safe preview', () => {
    const onSend = jest.fn();

    i18n.load(SOURCE_LOCALE, messages);
    i18n.activate(SOURCE_LOCALE);
    render(
      <I18nProvider i18n={i18n}>
        <Harness onSend={onSend} />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole('radio', { name: /Appointment reminder/ }),
    );
    const variable = screen.getByRole('textbox', { name: /Variable 1/ });

    expect(screen.getByLabelText('Message preview')).toHaveTextContent(
      'Hola {{1}}',
    );
    fireEvent.change(variable, { target: { value: 'Ana' } });
    expect(screen.getByLabelText('Message preview')).toHaveTextContent(
      'Hola Ana',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Send template\b/ }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/ContentSid/i)).toBeNull();
  });
});
