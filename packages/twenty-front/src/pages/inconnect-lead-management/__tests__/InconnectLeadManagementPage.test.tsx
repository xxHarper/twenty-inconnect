import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
} from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import {
  type LeadPoolCatalog,
  type LeadPoolOperation,
  type LeadPoolPage,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';

import { LEAD_POOL_CATALOG } from '@/inconnect-lead-management/graphql/leadPoolOperations';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { mockCurrentWorkspace } from '~/testing/mock-data/users';
import { InconnectLeadManagementPage } from '~/pages/inconnect-lead-management/InconnectLeadManagementPage';

jest.mock('@/ui/layout/page/components/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

afterEach(() => localStorage.removeItem(currentWorkspaceState.key));

const sourceId = '99999999-1111-4111-8111-000000000010';
const otherSourceId = '99999999-1111-4111-8111-000000000011';
const recipientId = '99999999-1111-4111-8111-000000000020';
const recordId = '99999999-1111-4111-8111-000000000030';
const operationId = '99999999-1111-4111-8111-000000000050';
const otherOperationId = '99999999-1111-4111-8111-000000000051';
const intentionId = '99999999-1111-4111-8111-000000000060';
const recordIds = [
  recordId,
  '99999999-1111-4111-8111-000000000031',
  '99999999-1111-4111-8111-000000000032',
];

const catalog: LeadPoolCatalog = {
  objects: [
    { id: sourceId, label: 'Origen A' },
    { id: otherSourceId, label: 'Origen B' },
  ],
  storageReady: true,
  blockedReason: null,
  allMatchingReady: false,
  messagingClassification: 'NOT_READY',
};

const records: LeadPoolPage = {
  records: recordIds.map((id, index) => ({
    id,
    label: index === 0 ? 'Lead A' : `Lead A-${index}`,
    ownerId: null,
  })),
  total: recordIds.length,
  offset: 0,
  fields: [],
  recipients: [{ id: recipientId, label: 'Ejecutivo permitido' }],
};

const makePreview = (input: LeadPoolPreviewInput): LeadPoolOperation => ({
  id: operationId,
  intentionId: input.intentionId,
  objectId: input.objectId,
  mode: input.mode,
  status: 'PREVIEW',
  version: 0,
  found: records.total,
  selected: input.recordIds.length,
  authorized: input.recordIds.length,
  plannedChanges: input.recordIds.length,
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
    PENDING: input.recordIds.length,
  },
  recipients: [
    {
      id: recipientId,
      label: 'Ejecutivo permitido',
      assignable: true,
      quantity: input.recordIds.length,
    },
  ],
  canExecute: true,
  items: input.recordIds.map((id) => ({ recordId: id, status: 'PENDING' })),
  hiddenItems: 0,
  expiresAt: '2026-11-13T00:00:00.000Z',
});

const initialOperation = makePreview({
  objectId: sourceId,
  intentionId,
  recordIds,
  recipientIds: [recipientId],
  mode: 'SINGLE',
  batchSize: 1,
  filter: {},
});

const afterBatch = (processed: number): LeadPoolOperation => ({
  ...initialOperation,
  status: processed === recordIds.length ? 'COMPLETED' : 'RUNNING',
  version: processed,
  processed,
  counts: {
    ...initialOperation.counts,
    CHANGED: processed,
    PENDING: recordIds.length - processed,
  },
  items: recordIds.map((id, index) => ({
    recordId: id,
    status: index < processed ? 'CHANGED' : 'PENDING',
  })),
});

const runningOperation = afterBatch(1);
const cancelledOperation: LeadPoolOperation = {
  ...runningOperation,
  status: 'CANCELLED',
  version: 2,
  canExecute: false,
  counts: { ...runningOperation.counts, REMAINING: 2, PENDING: 0 },
  items: runningOperation.items.map((item) =>
    item.status === 'PENDING' ? { ...item, status: 'REMAINING' } : item,
  ),
};

type WriteInput = { operationId: string; expectedVersion: number };

const renderPage = (workspaceId?: string) => {
  const store = createStore();
  const changeWorkspace = (id: string) =>
    store.set(currentWorkspaceState.atom, { ...mockCurrentWorkspace, id });
  if (workspaceId) changeWorkspace(workspaceId);
  const readCatalog = jest.fn(async () => catalog);
  const readRecords = jest.fn(async (objectId: string) =>
    objectId === sourceId
      ? records
      : {
          ...records,
          records: [{ id: recordId, label: 'Lead B', ownerId: null }],
          total: 1,
        },
  );
  const preview = jest.fn(async (input: LeadPoolPreviewInput) =>
    makePreview(input),
  );
  const readOperation = jest.fn(
    async (_operationId: string) => runningOperation,
  );
  const execute = jest.fn(async (_input: WriteInput) => afterBatch(3));
  const cancel = jest.fn(async (_input: WriteInput) => cancelledOperation);
  const request = async ({
    operationName,
    variables,
  }: ApolloLink.Operation) => {
    switch (operationName) {
      case 'InconnectLeadPoolCatalog':
        return { inconnectLeadPoolCatalog: await readCatalog() };
      case 'InconnectLeadPoolRecords':
        return {
          inconnectLeadPoolRecords: await readRecords(variables.input.objectId),
        };
      case 'PreviewInconnectLeadPool':
        return { previewInconnectLeadPool: await preview(variables.input) };
      case 'InconnectLeadPoolOperation':
        return {
          inconnectLeadPoolOperation: await readOperation(
            variables.input.operationId,
          ),
        };
      case 'ExecuteInconnectLeadPool':
        return { executeInconnectLeadPool: await execute(variables.input) };
      case 'CancelInconnectLeadPool':
        return { cancelInconnectLeadPool: await cancel(variables.input) };
      default:
        throw new Error(`Unexpected request: ${operationName}`);
    }
  };

  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
      (operation) =>
        new Observable((observer) => {
          void request(operation).then(
            (data) => {
              observer.next({ data });
              observer.complete();
            },
            (error) => observer.error(error),
          );
        }),
    ),
  });

  render(
    <Provider store={store}>
      <ApolloProvider client={client}>
        <I18nProvider i18n={i18n}>
          <InconnectLeadManagementPage />
        </I18nProvider>
      </ApolloProvider>
    </Provider>,
  );

  return {
    client,
    changeWorkspace,
    readCatalog,
    readRecords,
    preview,
    readOperation,
    execute,
    cancel,
    user: userEvent.setup(),
  };
};

const button = (name: string) => screen.getByRole('button', { name });
const origin = () => screen.getByLabelText('Objeto de origen');
const refreshLabel = 'Actualizar disponibilidad';
const recoverPreviewLabel = 'Recuperar la misma intención de preview';
const operationInput = () =>
  screen.getByLabelText('Identificador de operación');
const nextBatchLabel = 'Procesar siguiente lote';
const cancelLabel = 'Cancelar registros pendientes';
const queryOperationLabel = 'Consultar operación';

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const openSource = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByRole('option', { name: 'Origen A' });
  await user.selectOptions(origin(), sourceId);
};

const recoverById = async (
  user: ReturnType<typeof userEvent.setup>,
  id: string,
) => {
  fireEvent.change(operationInput(), { target: { value: id } });
  await user.click(button(queryOperationLabel));
};

const refreshAndRemount = async (
  { user, readCatalog }: ReturnType<typeof renderPage>,
  refreshedCatalog = catalog,
) => {
  const previousPanelInput = operationInput();
  const pendingCatalog = createDeferred<LeadPoolCatalog>();
  readCatalog.mockReturnValueOnce(pendingCatalog.promise);
  await user.click(button(refreshLabel));
  expect(
    await screen.findByText('Comprobando disponibilidad…'),
  ).toBeInTheDocument();
  expect(previousPanelInput).not.toBeInTheDocument();
  await act(async () => pendingCatalog.resolve(refreshedCatalog));
  expect(await screen.findByLabelText('Identificador de operación')).not.toBe(
    previousPanelInput,
  );
};

it('recovers the exact persisted preview intention after source change and availability refresh attempts', async () => {
  const { user, readCatalog, preview } = renderPage();
  let persisted: LeadPoolOperation | undefined;
  preview.mockImplementationOnce(async (input) => {
    persisted = makePreview(input);
    throw new Error('Se perdió la respuesta del preview');
  });
  preview.mockImplementationOnce(async (input) => {
    expect(input).toEqual(preview.mock.calls[0][0]);
    return persisted!;
  });

  await screen.findByRole('option', { name: 'Origen A' });
  await user.selectOptions(origin(), sourceId);
  await user.click(button('Consultar Leads'));
  await user.click(
    await screen.findByRole('checkbox', { name: 'Seleccionar Lead A' }),
  );
  await user.click(
    screen.getByRole('radio', { name: 'Asignar a Ejecutivo permitido' }),
  );
  await user.click(button('Obtener vista previa'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Se perdió la respuesta del preview',
  );
  expect(persisted?.id).toBe(operationId);
  const previousPanelInput = operationInput();
  expect(previousPanelInput).toHaveValue('');

  await user.selectOptions(origin(), otherSourceId);
  const pendingCatalog = createDeferred<LeadPoolCatalog>();
  readCatalog.mockReturnValueOnce(pendingCatalog.promise);
  await user.click(button(refreshLabel));
  expect(previousPanelInput).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Identificador de operación'),
  ).not.toBeInTheDocument();
  await act(async () => pendingCatalog.resolve(catalog));
  await screen.findByRole('option', { name: 'Origen A' });
  expect(readCatalog).toHaveBeenCalledTimes(2);
  await user.selectOptions(origin(), sourceId);
  expect(operationInput()).not.toBe(previousPanelInput);

  expect(preview).toHaveBeenCalledTimes(1);
  await user.click(button(recoverPreviewLabel));
  expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '0');
  expect(preview.mock.calls).toEqual([
    [preview.mock.calls[0][0]],
    [preview.mock.calls[0][0]],
  ]);
  expect(origin()).toHaveValue(sourceId);
  expect(origin()).toBeDisabled();
});

it.each(['execute', 'cancel'] as const)(
  'keeps the UUID and checkpoint of an uncertain %s across a panel remount',
  async (action) => {
    const page = renderPage();
    const { user, readOperation, preview, execute, cancel } = page;
    const write = page[action];
    const label = action === 'execute' ? nextBatchLabel : cancelLabel;
    const committed = action === 'execute' ? afterBatch(2) : cancelledOperation;
    let persisted = runningOperation;
    readOperation.mockImplementation(async () => persisted);
    await openSource(user);
    await recoverById(user, operationId);
    expect(await screen.findByRole('progressbar')).toHaveAttribute(
      'value',
      '1',
    );

    write.mockImplementationOnce(async () => {
      persisted = committed;
      throw new Error('Se perdió la respuesta de escritura');
    });
    await user.click(button(label));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Se perdió la respuesta de escritura',
    );
    expect(write).toHaveBeenCalledWith({ operationId, expectedVersion: 1 });

    await user.selectOptions(origin(), otherSourceId);
    expect(origin()).toHaveValue(sourceId);
    await refreshAndRemount(page);
    expect(operationInput()).toHaveValue(operationId);
    expect(origin()).toBeDisabled();
    expect(button('Consultar Leads')).toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();

    readOperation.mockResolvedValueOnce({ ...committed, id: otherOperationId });
    await recoverById(user, otherOperationId);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'otra intención',
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    readOperation.mockResolvedValueOnce(initialOperation);
    await recoverById(user, operationId);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'progreso confirmado',
    );
    expect(origin()).toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);

    await user.click(button(queryOperationLabel));
    expect(await screen.findByRole('progressbar')).toHaveAttribute(
      'value',
      String(committed.processed),
    );
    expect(write).toHaveBeenCalledTimes(1);

    if (action === 'execute') {
      expect(origin()).toBeDisabled();
      expect(
        screen.queryByRole('button', { name: 'Nueva selección' }),
      ).not.toBeInTheDocument();
      await user.click(button(nextBatchLabel));
      expect(execute.mock.calls).toEqual([
        [{ operationId, expectedVersion: 1 }],
        [{ operationId, expectedVersion: 2 }],
      ]);
      expect(await screen.findByText(/COMPLETED/)).toBeInTheDocument();
      expect(cancel).not.toHaveBeenCalled();
    } else {
      expect(await screen.findByText(/CANCELLED/)).toBeInTheDocument();
      expect(execute).not.toHaveBeenCalled();
    }

    expect(origin()).toBeEnabled();
    await user.click(button('Nueva selección'));
    expect(button('Consultar Leads')).toBeEnabled();
    await user.selectOptions(origin(), otherSourceId);
    expect(origin()).toHaveValue(otherSourceId);
    expect(operationInput()).toHaveValue('');
    expect(preview).not.toHaveBeenCalled();
  },
);

it('keeps a pending write through remount and rejects a late result for a different operation', async () => {
  const page = renderPage();
  const { user, readOperation, execute, cancel } = page;
  await openSource(user);
  await recoverById(user, operationId);
  const pending = createDeferred<LeadPoolOperation>();
  execute.mockReturnValueOnce(pending.promise);
  await user.click(await screen.findByRole('button', { name: nextBatchLabel }));
  await refreshAndRemount(page);
  expect(button(nextBatchLabel)).toBeDisabled();
  expect(button(cancelLabel)).toBeDisabled();
  expect(button(queryOperationLabel)).toBeDisabled();
  expect(origin()).toBeDisabled();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');

  await act(async () =>
    pending.resolve({ ...afterBatch(2), id: otherOperationId }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Resultado incierto',
  );
  expect(operationInput()).toHaveValue(operationId);
  expect(screen.queryByText(otherOperationId)).not.toBeInTheDocument();
  expect(origin()).toBeDisabled();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();

  readOperation.mockResolvedValueOnce(afterBatch(2));
  await user.click(button(queryOperationLabel));
  expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '2');
  expect(button(nextBatchLabel)).toBeEnabled();
  expect(execute).toHaveBeenCalledTimes(1);
});

it('R4 preserves terminal checkpoints when the panel remounts and another UUID becomes visible', async () => {
  const page = renderPage();
  const { user, client, readCatalog, readOperation, execute, cancel } = page;
  const otherTerminal = {
    ...afterBatch(3),
    id: otherOperationId,
    intentionId: '99999999-1111-4111-8111-000000000061',
  };

  await openSource(user);
  await recoverById(user, operationId);
  await user.click(await screen.findByRole('button', { name: cancelLabel }));
  expect(await screen.findByText(/CANCELLED/)).toBeInTheDocument();
  expect(cancel).toHaveBeenCalledWith({ operationId, expectedVersion: 1 });

  readOperation.mockResolvedValueOnce(otherTerminal);
  await recoverById(user, otherOperationId);
  expect(await screen.findByText(/COMPLETED/)).toBeInTheDocument();

  const previousPanelInput = operationInput();
  const pendingCatalog = createDeferred<LeadPoolCatalog>();
  readCatalog.mockReturnValueOnce(pendingCatalog.promise);
  const pendingRecovery = createDeferred<LeadPoolOperation>();
  readOperation.mockReturnValueOnce(pendingRecovery.promise);
  await recoverById(user, operationId);
  let refreshed: Promise<unknown> | undefined;
  act(() => {
    refreshed = client.refetchQueries({ include: [LEAD_POOL_CATALOG] });
  });
  expect(
    await screen.findByText('Comprobando disponibilidad…'),
  ).toBeInTheDocument();
  expect(previousPanelInput).not.toBeInTheDocument();
  await act(async () => {
    pendingCatalog.resolve(catalog);
    await refreshed;
  });
  expect(await screen.findByLabelText('Identificador de operación')).not.toBe(
    previousPanelInput,
  );

  await act(async () => pendingRecovery.resolve(afterBatch(2)));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'progreso confirmado',
  );
  expect(screen.getByText(otherOperationId)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: nextBatchLabel }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: cancelLabel }),
  ).not.toBeInTheDocument();

  readOperation.mockResolvedValueOnce(cancelledOperation);
  await recoverById(user, operationId);
  expect(await screen.findByText(/CANCELLED/)).toBeInTheDocument();
  await user.click(button('Nueva selección'));
  expect(button('Consultar Leads')).toBeEnabled();
  expect(execute).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('scopes checkpoints to the current workspace even when the origin UUID is the same', async () => {
  const { user, changeWorkspace, readOperation } = renderPage(
    '99999999-1111-4111-8111-000000000001',
  );
  await openSource(user);
  readOperation.mockResolvedValueOnce(cancelledOperation);
  await recoverById(user, operationId);
  expect(await screen.findByText(/CANCELLED/)).toBeInTheDocument();

  act(() => changeWorkspace('99999999-1111-4111-8111-000000000002'));
  await screen.findByRole('option', { name: 'Origen A' });
  expect(origin()).toHaveValue('');
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();

  await openSource(user);
  await recoverById(user, operationId);
  expect(await screen.findByText(/RUNNING/)).toBeInTheDocument();
  expect(button(nextBatchLabel)).toBeEnabled();
});

it('blocks replacing an active operation and disables its actions when refreshed storage is unavailable', async () => {
  const page = renderPage();
  const { user, readOperation, execute, cancel } = page;
  await openSource(user);
  await recoverById(user, operationId);
  expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '1');

  readOperation.mockResolvedValueOnce({
    ...cancelledOperation,
    id: otherOperationId,
  });
  await recoverById(user, otherOperationId);
  expect(await screen.findByRole('alert')).toHaveTextContent('otra intención');
  expect(origin()).toBeDisabled();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');

  await refreshAndRemount(page, { ...catalog, storageReady: false });
  expect(operationInput()).toHaveValue(operationId);
  expect(button(nextBatchLabel)).toBeDisabled();
  expect(button(cancelLabel)).toBeDisabled();
  expect(button('Consultar progreso guardado')).toBeDisabled();
  expect(button(queryOperationLabel)).toBeDisabled();
  expect(origin()).toBeDisabled();

  await refreshAndRemount(page);
  expect(button(nextBatchLabel)).toBeEnabled();
  expect(button(cancelLabel)).toBeEnabled();
  expect(execute).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it('allows idle origin changes and refreshes without accepting a late read from the previous origin', async () => {
  const { user, readCatalog, readRecords, preview, execute, cancel } =
    renderPage();
  await openSource(user);
  const pending = createDeferred<LeadPoolPage>();
  readRecords.mockReturnValueOnce(pending.promise);
  await user.click(button('Consultar Leads'));
  await user.selectOptions(origin(), otherSourceId);
  expect(origin()).toHaveValue(otherSourceId);
  await user.click(button('Consultar Leads'));
  expect(
    await screen.findByRole('checkbox', { name: 'Seleccionar Lead B' }),
  ).toBeInTheDocument();
  await act(async () => pending.resolve(records));
  expect(
    screen.queryByRole('checkbox', { name: 'Seleccionar Lead A' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: 'Seleccionar Lead B' }),
  ).toBeInTheDocument();
  expect(readRecords.mock.calls).toEqual([[sourceId], [otherSourceId]]);

  await user.click(button(refreshLabel));
  await screen.findByRole('option', { name: 'Origen A' });
  expect(readCatalog).toHaveBeenCalledTimes(2);
  expect(origin()).toHaveValue('');
  expect(
    screen.queryByRole('button', { name: 'Consultar Leads' }),
  ).not.toBeInTheDocument();
  expect(preview).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});
