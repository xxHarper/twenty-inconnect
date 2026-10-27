import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type LeadPoolOperation, type LeadPoolPage } from 'twenty-shared/types';

import { LeadPoolWorkspace } from '@/inconnect-lead-management/components/LeadPoolWorkspace';
import {
  LEAD_POOL_EXECUTE,
  LEAD_POOL_OPERATION,
  LEAD_POOL_PREVIEW,
  LEAD_POOL_RECORDS,
} from '@/inconnect-lead-management/graphql/leadPoolOperations';

const mockClient = { query: jest.fn(), mutate: jest.fn() };
jest.mock('@apollo/client/react', () => ({
  useApolloClient: () => mockClient,
}));

const objectId = '99999999-1111-4111-8111-000000000010';
const operationId = '99999999-1111-4111-8111-000000000050';
const recipientId = '99999999-1111-4111-8111-000000000020';
const makePage = (offset = 0): LeadPoolPage => ({
  records: Array.from({ length: 50 }, (_, index) => ({
    id: `record-${offset + index}`,
    label: `Lead ${offset + index}`,
    ownerId: null,
  })),
  total: 1000,
  offset,
  fields: [],
  recipients: [{ id: recipientId, label: 'Ejecutivo permitido' }],
});
const makeOperation = (
  change: Partial<LeadPoolOperation> = {},
): LeadPoolOperation => ({
  id: operationId,
  intentionId: 'preview-intention',
  objectId,
  mode: 'SINGLE',
  status: 'PREVIEW',
  version: 0,
  found: 1000,
  selected: 50,
  authorized: 50,
  plannedChanges: 50,
  plannedUnchanged: 0,
  plannedRemaining: 0,
  processed: 0,
  lastBatchError: null,
  batchFailures: 0,
  counts: {
    CHANGED: 0,
    UNCHANGED: 0,
    CONFLICT: 0,
    REJECTED: 0,
    FAILED: 0,
    REMAINING: 0,
    PENDING: 50,
  },
  recipients: [
    {
      id: recipientId,
      label: 'Ejecutivo permitido',
      assignable: true,
      quantity: 50,
    },
  ],
  canExecute: true,
  items: [{ recordId: 'record-0', status: 'PENDING' }],
  hiddenItems: 0,
  expiresAt: '2026-10-27T00:00:00.000Z',
  ...change,
});
const renderWorkspace = (storageReady = true) =>
  render(
    <I18nProvider i18n={i18n}>
      <LeadPoolWorkspace objectId={objectId} storageReady={storageReady} />
    </I18nProvider>,
  );
const click = async (label: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }));
  });
const selectAndPreview = async () => {
  await click('Consultar Leads');
  await click('Seleccionar primeros 50 elegibles');
  fireEvent.click(
    screen.getByRole('radio', { name: 'Asignar a Ejecutivo permitido' }),
  );
  await click('Obtener vista previa');
};

beforeEach(() => {
  i18n.load('es', {});
  i18n.activate('es');
  mockClient.query.mockReset();
  mockClient.mutate.mockReset();
  mockClient.query.mockImplementation(async ({ query, variables }) =>
    query === LEAD_POOL_OPERATION
      ? { data: { inconnectLeadPoolOperation: makeOperation() } }
      : {
          data: { inconnectLeadPoolRecords: makePage(variables.input.offset) },
        },
  );
  mockClient.mutate.mockImplementation(async ({ mutation }) =>
    mutation === LEAD_POOL_PREVIEW
      ? { data: { previewInconnectLeadPool: makeOperation() } }
      : {
          data: {
            executeInconnectLeadPool: makeOperation({
              status: 'COMPLETED',
              version: 1,
              processed: 50,
              counts: {
                CHANGED: 50,
                UNCHANGED: 0,
                CONFLICT: 0,
                REJECTED: 0,
                FAILED: 0,
                REMAINING: 0,
                PENDING: 0,
              },
            }),
          },
        },
  );
});

describe('real Lead selection UI and transport hook', () => {
  it('selects the first 50 through the backend, previews and changes owners only after confirmation', async () => {
    renderWorkspace();
    await selectAndPreview();
    const preview = mockClient.mutate.mock.calls[0][0];
    expect(preview.mutation).toBe(LEAD_POOL_PREVIEW);
    expect(preview.variables.input.recordIds).toHaveLength(50);
    expect(preview.variables.input).toMatchObject({
      objectId,
      mode: 'SINGLE',
      recipientIds: [recipientId],
      batchSize: 50,
    });
    expect(preview.variables.input).not.toHaveProperty('category');
    expect(mockClient.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
    await click('Confirmar y procesar primer lote');
    expect(mockClient.mutate.mock.calls[1][0]).toEqual({
      mutation: LEAD_POOL_EXECUTE,
      variables: { input: { operationId, expectedVersion: 0 } },
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');
    expect(screen.getByText(/CHANGED: 50/)).toBeInTheDocument();
  });
  it('pages through 1000 matches and retains explicit selection across pages', async () => {
    renderWorkspace();
    await click('Consultar Leads');
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Lead 0' }),
    );
    await click('Siguiente');
    expect(mockClient.query.mock.calls.at(-1)![0]).toMatchObject({
      query: LEAD_POOL_RECORDS,
      variables: { input: { offset: 50, first: 50 } },
      fetchPolicy: 'network-only',
    });
    expect(
      screen.getByText('Resultados autorizados: 1000 · Seleccionados: 1'),
    ).toBeInTheDocument();
    await click('Añadir esta página a la selección');
    expect(
      screen.getByText('Resultados autorizados: 1000 · Seleccionados: 51'),
    ).toBeInTheDocument();
  });
  it('shows all-by-filter as disabled with its concrete dependency', async () => {
    renderWorkspace();
    await click('Consultar Leads');
    const all = screen.getByRole('button', {
      name: 'Todos por filtro · no disponible',
    });
    expect(all).toBeDisabled();
    expect(all).toHaveAttribute(
      'title',
      expect.stringContaining('materialización estable'),
    );
  });
  it('blocks preview when durable storage is unavailable', async () => {
    renderWorkspace(false);
    await click('Consultar Leads');
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Lead 0' }),
    );
    fireEvent.click(
      screen.getByRole('radio', { name: 'Asignar a Ejecutivo permitido' }),
    );
    expect(
      screen.getByRole('button', { name: 'Obtener vista previa' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/requieren instalar el almacenamiento/),
    ).toBeInTheDocument();
  });
  it('preserves the exact intention when preview response is lost', async () => {
    renderWorkspace();
    mockClient.mutate.mockRejectedValueOnce(new Error('Respuesta perdida'));
    await selectAndPreview();
    expect(screen.getByRole('alert')).toHaveTextContent('Respuesta perdida');
    await click('Recuperar la misma intención de preview');
    expect(mockClient.mutate.mock.calls[0][0].variables.input).toEqual(
      mockClient.mutate.mock.calls[1][0].variables.input,
    );
  });
  it('clears record data on denial and preserves the operation ID for recovery', async () => {
    renderWorkspace();
    await selectAndPreview();
    mockClient.mutate.mockRejectedValueOnce(new Error('Permiso revocado'));
    await click('Confirmar y procesar primer lote');
    expect(screen.queryByText('record-0')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Identificador de operación')).toHaveValue(
      operationId,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Permiso revocado');
  });
  it('recovers a saved operation before allowing a continuation', async () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Identificador de operación'), {
      target: { value: operationId },
    });
    await click('Consultar operación');
    expect(mockClient.query).toHaveBeenCalledWith({
      query: LEAD_POOL_OPERATION,
      variables: { input: { operationId } },
      fetchPolicy: 'network-only',
    });
    expect(
      screen.getByRole('button', { name: 'Confirmar y procesar primer lote' }),
    ).toBeEnabled();
  });
  it('renders partial rejection rather than reporting complete success', async () => {
    mockClient.query.mockResolvedValue({
      data: {
        inconnectLeadPoolOperation: makeOperation({
          status: 'COMPLETED',
          counts: {
            CHANGED: 49,
            UNCHANGED: 0,
            CONFLICT: 1,
            REJECTED: 0,
            FAILED: 0,
            REMAINING: 0,
            PENDING: 0,
          },
          processed: 50,
        }),
      },
    });
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Identificador de operación'), {
      target: { value: operationId },
    });
    await click('Consultar operación');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'conflictos o rechazos',
    );
    expect(screen.getByText(/CONFLICT: 1/)).toBeInTheDocument();
  });
  it('supports EVEN and manual quantities using only selected authorized recipients', async () => {
    renderWorkspace();
    await click('Consultar Leads');
    fireEvent.change(screen.getByLabelText('Estrategia'), {
      target: { value: 'MANUAL_QUOTAS' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Asignar a Ejecutivo permitido' }),
    );
    fireEvent.change(screen.getByLabelText('Cuota de Ejecutivo permitido'), {
      target: { value: '1' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Lead 0' }),
    );
    await click('Obtener vista previa');
    expect(mockClient.mutate.mock.calls[0][0].variables.input).toMatchObject({
      mode: 'MANUAL_QUOTAS',
      quotas: [{ recipientId, quantity: 1 }],
    });
  });
  it('does not let a late origin-A query populate origin B', async () => {
    let finish: ((value: unknown) => void) | undefined;
    mockClient.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = renderWorkspace();
    await click('Consultar Leads');
    view.rerender(
      <I18nProvider i18n={i18n}>
        <LeadPoolWorkspace
          key="new-origin"
          objectId="new-origin"
          storageReady
        />
      </I18nProvider>,
    );
    await act(async () =>
      finish!({ data: { inconnectLeadPoolRecords: makePage() } }),
    );
    expect(
      screen.queryByRole('checkbox', { name: 'Seleccionar Lead 0' }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole('group', {
          name: 'Asignación manual del conjunto seleccionado',
        }),
      ).getByLabelText('Estrategia'),
    ).toBeDisabled();
  });
});

it('prevents excessive manual quotas locally and allows correcting the same selection', async () => {
  renderWorkspace();
  await click('Consultar Leads');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Lead 0' }));
  fireEvent.change(screen.getByLabelText('Estrategia'), {
    target: { value: 'MANUAL_QUOTAS' },
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Asignar a Ejecutivo permitido' }),
  );
  fireEvent.change(screen.getByLabelText('Cuota de Ejecutivo permitido'), {
    target: { value: '2' },
  });
  expect(
    screen.getByRole('button', { name: 'Obtener vista previa' }),
  ).toBeDisabled();
  expect(mockClient.mutate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Estrategia')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Cuota de Ejecutivo permitido'), {
    target: { value: '1' },
  });
  await click('Obtener vista previa');
  expect(mockClient.mutate).toHaveBeenCalledTimes(1);
});

it.each(['VALIDATION', 'PERMISSION'])(
  'unfreezes only a correlated backend rejection with confirmed absence: %s',
  async (reason) => {
    renderWorkspace();
    mockClient.mutate.mockImplementationOnce(async ({ variables }) => {
      throw new CombinedGraphQLErrors({
        errors: [
          {
            message: 'Request rejected',
            extensions: {
              leadPoolPreview: {
                outcome: 'REJECTED',
                reason,
                intentionId: variables.input.intentionId,
              },
            },
          },
        ],
      });
    });
    await selectAndPreview();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'sin crear una operación',
    );
    expect(
      screen.getByRole('button', { name: 'Consultar Leads' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Estrategia')).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Limpiar selección' }),
    ).toBeEnabled();
    await click('Obtener vista previa');
    expect(
      mockClient.mutate.mock.calls[1][0].variables.input.intentionId,
    ).not.toBe(mockClient.mutate.mock.calls[0][0].variables.input.intentionId);
    expect(
      screen.getByRole('button', { name: 'Confirmar y procesar primer lote' }),
    ).toBeEnabled();
  },
);

it('can query and start a new selection after a definitive rejection', async () => {
  renderWorkspace();
  mockClient.mutate.mockImplementationOnce(async ({ variables }) => {
    throw new CombinedGraphQLErrors({
      errors: [
        {
          message: 'Invalid parameters',
          extensions: {
            leadPoolPreview: {
              outcome: 'REJECTED',
              reason: 'VALIDATION',
              intentionId: variables.input.intentionId,
            },
          },
        },
      ],
    });
  });
  await selectAndPreview();
  await click('Consultar Leads');
  await click('Nueva selección');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Consultar Leads' })).toBeEnabled();
});

it.each(['network', 'uncorrelated', 'generic GraphQL'])(
  'preserves an uncertain intention for %s; recovery reuses the persisted preview without a second intention',
  async (failure) => {
    renderWorkspace();
    const intentions = new Map<string, LeadPoolOperation>();
    mockClient.mutate.mockImplementation(async ({ variables }) => {
      const intentionId = variables.input.intentionId;
      if (!intentions.has(intentionId)) {
        intentions.set(intentionId, makeOperation({ intentionId }));
        if (failure === 'network') throw new Error('Timeout');
        throw new CombinedGraphQLErrors({
          errors: [
            {
              message: 'Invalid Lead Management request',
              extensions:
                failure === 'uncorrelated'
                  ? {
                      leadPoolPreview: {
                        outcome: 'REJECTED',
                        reason: 'VALIDATION',
                        intentionId: 'another-intention',
                      },
                    }
                  : { code: 'FORBIDDEN' },
            },
          ],
        });
      }
      return {
        data: { previewInconnectLeadPool: intentions.get(intentionId) },
      };
    });
    await selectAndPreview();
    expect(
      screen.getByRole('button', { name: 'Consultar Leads' }),
    ).toBeDisabled();
    expect(screen.getByLabelText('Estrategia')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Nueva selección' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Confirmar y procesar primer lote',
      }),
    ).not.toBeInTheDocument();
    await click('Recuperar la misma intención de preview');
    expect(intentions.size).toBe(1);
    expect(mockClient.mutate.mock.calls[0][0].variables).toEqual(
      mockClient.mutate.mock.calls[1][0].variables,
    );
    expect(
      screen.getByRole('button', { name: 'Confirmar y procesar primer lote' }),
    ).toBeEnabled();
  },
);

it('keeps one in-flight intention when preview is clicked twice before the transport resolves', async () => {
  let finish!: (value: unknown) => void;
  mockClient.mutate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderWorkspace();
  await selectAndPreview();
  await click('Recuperar la misma intención de preview');
  expect(mockClient.mutate).toHaveBeenCalledTimes(1);
  await act(async () =>
    finish({ data: { previewInconnectLeadPool: makeOperation() } }),
  );
});

it('identifies multiple original recipients after reload, independently of the form catalog', async () => {
  mockClient.query.mockResolvedValueOnce({
    data: {
      inconnectLeadPoolOperation: makeOperation({
        mode: 'EVEN',
        recipients: [
          {
            id: recipientId,
            label: 'Ana Original',
            assignable: true,
            quantity: 25,
          },
          {
            id: 'other-recipient',
            label: 'Luis Original',
            assignable: true,
            quantity: 25,
          },
        ],
      }),
    },
  });
  renderWorkspace();
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: operationId },
  });
  await click('Consultar operación');
  expect(screen.getByText(/Ana Original/)).toBeInTheDocument();
  expect(screen.getByText(/Luis Original/)).toBeInTheDocument();
  expect(screen.getByText(recipientId)).toBeInTheDocument();
  expect(screen.getByText('other-recipient')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Confirmar y procesar primer lote' }),
  ).toBeEnabled();
});

it.each(['PREVIEW', 'RUNNING'] as const)(
  'blocks %s continuation for unavailable destinations while retaining historical progress and cancellation',
  async (status) => {
    mockClient.query.mockResolvedValueOnce({
      data: {
        inconnectLeadPoolOperation: makeOperation({
          status,
          canExecute: false,
          recipients: [
            { id: recipientId, label: null, assignable: false, quantity: 50 },
          ],
          processed: 10,
        }),
      },
    });
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Identificador de operación'), {
      target: { value: operationId },
    });
    await click('Consultar operación');
    expect(screen.getByText(/Destinatario no disponible/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '10');
    expect(
      screen.getByRole('button', {
        name:
          status === 'PREVIEW'
            ? 'Confirmar y procesar primer lote'
            : 'Procesar siguiente lote',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Cancelar registros pendientes' }),
    ).toBeEnabled();
    expect(mockClient.mutate).not.toHaveBeenCalled();
  },
);

it.each(['malformed', 'not found', 'temporary'] as const)(
  'N1: a %s read-only lookup preserves selection and permits a legitimate new intention',
  async (failure) => {
    renderWorkspace();
    await click('Consultar Leads');
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Lead 0' }),
    );
    fireEvent.change(screen.getByLabelText('Identificador de operación'), {
      target: { value: failure === 'malformed' ? 'invalid-uuid' : operationId },
    });
    mockClient.query.mockRejectedValueOnce(
      failure === 'temporary'
        ? new Error('Read timeout')
        : new CombinedGraphQLErrors({
            errors: [
              {
                message: 'Operation unavailable',
                extensions: {
                  code:
                    failure === 'malformed' ? 'BAD_USER_INPUT' : 'NOT_FOUND',
                },
              },
            ],
          }),
    );
    await click('Consultar operación');
    expect(mockClient.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Consultar Leads' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Nueva selección' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('checkbox', { name: 'Seleccionar Lead 0' }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Lead 1' }),
    );
    await click('Nueva selección');
    await selectAndPreview();
    expect(mockClient.mutate).toHaveBeenCalledTimes(1);
    expect(mockClient.mutate.mock.calls[0][0].mutation).toBe(LEAD_POOL_PREVIEW);
    expect(
      screen.getByRole('button', { name: 'Confirmar y procesar primer lote' }),
    ).toBeEnabled();
  },
);

it('N1: an unsuccessful read can be corrected to a valid recovery without creating a mutation', async () => {
  renderWorkspace();
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: 'invalid-uuid' },
  });
  mockClient.query.mockRejectedValueOnce(new Error('Bad lookup'));
  await click('Consultar operación');
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: operationId },
  });
  await click('Consultar operación');
  expect(
    screen.getByRole('button', { name: 'Confirmar y procesar primer lote' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Consultar Leads' }),
  ).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Nueva selección' }),
  ).not.toBeInTheDocument();
  expect(mockClient.mutate).not.toHaveBeenCalled();
});

it('N1: a failed read preserves confirmed progress and the original continuation version', async () => {
  mockClient.query.mockResolvedValueOnce({
    data: {
      inconnectLeadPoolOperation: makeOperation({
        status: 'RUNNING',
        version: 1,
        processed: 25,
      }),
    },
  });
  renderWorkspace();
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: operationId },
  });
  await click('Consultar operación');
  mockClient.query.mockRejectedValueOnce(new Error('Read timeout'));
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: 'invalid-uuid' },
  });
  await click('Consultar operación');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25');
  expect(
    screen.getByRole('button', { name: 'Consultar Leads' }),
  ).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Nueva selección' }),
  ).not.toBeInTheDocument();
  await click('Procesar siguiente lote');
  expect(mockClient.mutate).toHaveBeenCalledTimes(1);
  expect(mockClient.mutate.mock.calls[0][0].variables.input).toEqual({
    operationId,
    expectedVersion: 1,
  });
});

it('N1: failed and unrelated reads cannot clear an uncertain preview; matching recovery admits one confirmation', async () => {
  renderWorkspace();
  mockClient.mutate.mockRejectedValueOnce(new Error('Preview response lost'));
  await selectAndPreview();
  const original = mockClient.mutate.mock.calls[0][0].variables.input;
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: 'invalid-uuid' },
  });
  mockClient.query.mockRejectedValueOnce(new Error('Bad lookup'));
  await click('Consultar operación');
  expect(
    screen.getByRole('button', { name: 'Consultar Leads' }),
  ).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Nueva selección' }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: operationId },
  });
  await click('Consultar operación');
  expect(screen.getByRole('alert')).toHaveTextContent('otra intención');
  expect(
    screen.getByRole('button', { name: 'Consultar Leads' }),
  ).toBeDisabled();
  expect(mockClient.mutate).toHaveBeenCalledTimes(1);
  mockClient.query.mockResolvedValueOnce({
    data: {
      inconnectLeadPoolOperation: makeOperation({
        intentionId: original.intentionId,
      }),
    },
  });
  await click('Consultar operación');
  await click('Confirmar y procesar primer lote');
  expect(mockClient.mutate).toHaveBeenCalledTimes(2);
  expect(mockClient.mutate.mock.calls[1][0].mutation).toBe(LEAD_POOL_EXECUTE);
  expect(mockClient.mutate.mock.calls[1][0].variables.input).toEqual({
    operationId,
    expectedVersion: 0,
  });
  await click('Nueva selección');
  expect(screen.getByRole('button', { name: 'Consultar Leads' })).toBeEnabled();
});

it('N1: an uncertain execution survives failed and unrelated reads and resumes only the recovered version', async () => {
  renderWorkspace();
  await selectAndPreview();
  mockClient.mutate.mockRejectedValueOnce(new Error('Commit response lost'));
  await click('Confirmar y procesar primer lote');
  mockClient.query.mockRejectedValueOnce(new Error('Read timeout'));
  await click('Consultar operación');
  expect(
    screen.getByRole('button', { name: 'Consultar Leads' }),
  ).toBeDisabled();
  const otherOperationId = '99999999-1111-4111-8111-000000000099';
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: otherOperationId },
  });
  mockClient.query.mockResolvedValueOnce({
    data: {
      inconnectLeadPoolOperation: makeOperation({
        id: otherOperationId,
        status: 'COMPLETED',
      }),
    },
  });
  await click('Consultar operación');
  expect(screen.getByRole('alert')).toHaveTextContent('otra intención');
  expect(
    screen.queryByRole('button', { name: 'Nueva selección' }),
  ).not.toBeInTheDocument();
  expect(mockClient.mutate).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: operationId },
  });
  mockClient.query.mockResolvedValueOnce({
    data: {
      inconnectLeadPoolOperation: makeOperation({
        status: 'RUNNING',
        version: 1,
        processed: 25,
      }),
    },
  });
  await click('Consultar operación');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25');
  await click('Procesar siguiente lote');
  expect(mockClient.mutate).toHaveBeenCalledTimes(3);
  expect(mockClient.mutate.mock.calls[1][0].variables.input).toEqual({
    operationId,
    expectedVersion: 0,
  });
  expect(mockClient.mutate.mock.calls[2][0].variables.input).toEqual({
    operationId,
    expectedVersion: 1,
  });
});

it('N1: correlates an uppercase UUID lookup with the canonical backend identity', async () => {
  const canonicalOperationId = 'abcdefab-1111-4111-8111-000000000050';
  mockClient.query.mockResolvedValueOnce({
    data: {
      inconnectLeadPoolOperation: makeOperation({ id: canonicalOperationId }),
    },
  });
  mockClient.mutate.mockResolvedValueOnce({
    data: {
      executeInconnectLeadPool: makeOperation({
        id: canonicalOperationId,
        status: 'COMPLETED',
        version: 1,
      }),
    },
  });
  renderWorkspace();
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: canonicalOperationId.toUpperCase() },
  });
  await click('Consultar operación');
  expect(
    screen.getByRole('button', { name: 'Confirmar y procesar primer lote' }),
  ).toBeEnabled();
  await click('Confirmar y procesar primer lote');
  expect(mockClient.mutate.mock.calls[0][0].variables.input).toEqual({
    operationId: canonicalOperationId,
    expectedVersion: 0,
  });
});
