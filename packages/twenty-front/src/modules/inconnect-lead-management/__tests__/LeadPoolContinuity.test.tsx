import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
} from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { type PropsWithChildren } from 'react';
import {
  type LeadPoolOperation,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';

import { currentUserState } from '@/auth/states/currentUserState';
import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { LEAD_POOL_CATALOG } from '@/inconnect-lead-management/graphql/leadPoolOperations';
import { useLeadPool } from '@/inconnect-lead-management/hooks/useLeadPool';
import { InconnectLeadManagementPage } from '~/pages/inconnect-lead-management/InconnectLeadManagementPage';
import {
  mockCurrentWorkspace,
  mockedUserData,
  mockedWorkspaceMemberData,
} from '~/testing/mock-data/users';

jest.mock('@/ui/layout/page/components/PageHeader', () => ({
  PageHeader: () => null,
}));
afterEach(() => {
  for (const { key } of [
    currentWorkspaceState,
    currentWorkspaceMemberState,
    currentUserState,
  ]) {
    localStorage.removeItem(key);
  }
});

const uuid = (suffix: number) =>
  'a04b5c67-d002-40c3-8102-' + suffix.toString(16).padStart(12, '0');
const origin = uuid(1);
const otherOrigin = uuid(2);
const X = uuid(15);
const Y = uuid(26);
const A = uuid(31);
const B = uuid(32);
const record1 = uuid(40);
const record2 = uuid(41);
const preview: LeadPoolOperation = {
  id: X,
  intentionId: uuid(60),
  objectId: origin,
  mode: 'SINGLE',
  status: 'PREVIEW',
  version: 0,
  found: 2,
  selected: 2,
  authorized: 2,
  plannedChanges: 2,
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
    PENDING: 2,
  },
  recipients: [{ id: A, label: 'Destino A', assignable: true, quantity: 2 }],
  canExecute: true,
  items: [
    { recordId: record1, status: 'PENDING' },
    { recordId: record2, status: 'PENDING' },
  ],
  hiddenItems: 0,
  expiresAt: '2030-01-01T00:00:00.000Z',
};
const running: LeadPoolOperation = {
  ...preview,
  status: 'RUNNING',
  version: 1,
  processed: 1,
  counts: { ...preview.counts, CHANGED: 1, PENDING: 1 },
  items: [
    { recordId: record1, status: 'CHANGED' },
    { recordId: record2, status: 'PENDING' },
  ],
};
const cancelled: LeadPoolOperation = {
  ...running,
  status: 'CANCELLED',
  version: 2,
  canExecute: false,
  counts: { ...running.counts, PENDING: 0, REMAINING: 1 },
  items: [
    { recordId: record1, status: 'CHANGED' },
    { recordId: record2, status: 'REMAINING' },
  ],
};
const completed: LeadPoolOperation = {
  ...running,
  status: 'COMPLETED',
  version: 2,
  canExecute: false,
  processed: 2,
  counts: { ...running.counts, CHANGED: 2, PENDING: 0 },
  items: [
    { recordId: record1, status: 'CHANGED' },
    { recordId: record2, status: 'CHANGED' },
  ],
};
const second = { ...completed, id: Y, intentionId: uuid(61) };
const redirected = (op: LeadPoolOperation) => ({
  ...op,
  recipients: [{ ...op.recipients[0], id: B, label: 'Destino B' }],
});
const revived: LeadPoolOperation = { ...running, version: 3 };
const catalog = {
  objects: [
    { id: origin.toUpperCase(), label: 'Origen A' },
    { id: otherOrigin, label: 'Origen B' },
  ],
  storageReady: true,
  blockedReason: null,
  allMatchingReady: false,
  messagingClassification: 'NOT_READY',
};
const fields: Record<string, string> = {
  InconnectLeadPoolCatalog: 'inconnectLeadPoolCatalog',
  InconnectLeadPoolOperation: 'inconnectLeadPoolOperation',
  PreviewInconnectLeadPool: 'previewInconnectLeadPool',
  ExecuteInconnectLeadPool: 'executeInconnectLeadPool',
  CancelInconnectLeadPool: 'cancelInconnectLeadPool',
};
type Answer = { value?: unknown; error?: Error };
const memoryTransport = () => {
  const calls: ApolloLink.Operation[] = [];
  const answers = new Map<string, Answer[]>();
  const queue = (name: string, answer: Answer) => {
    const pending = answers.get(name) ?? [];
    pending.push(answer);
    answers.set(name, pending);
  };
  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
      (operation) =>
        new Observable((observer) => {
          calls.push(operation);
          const name = operation.operationName ?? '';
          const answer =
            answers.get(name)?.shift() ??
            (name === 'InconnectLeadPoolCatalog'
              ? { value: catalog }
              : { error: new Error(`Unexpected operation ${name}`) });
          void Promise.resolve(answer.value).then(
            (value) => {
              if (answer.error) observer.error(answer.error);
              else {
                observer.next({
                  data: { [fields[name]]: value },
                });
                observer.complete();
              }
            },
            (error) => observer.error(error),
          );
        }),
    ),
  });
  return {
    client,
    calls,
    read: (value: unknown) => queue('InconnectLeadPoolOperation', { value }),
    newCatalog: (value: unknown) =>
      queue('InconnectLeadPoolCatalog', { value }),
    preview: (value: unknown) => queue('PreviewInconnectLeadPool', { value }),
    execute: (value: unknown) => queue('ExecuteInconnectLeadPool', { value }),
    cancel: (value: unknown) => queue('CancelInconnectLeadPool', { value }),
    lost: (name: string) =>
      queue(name, { error: new Error('Respuesta perdida') }),
    writes: () =>
      calls.filter(({ operationName }) =>
        /^(Preview|Cancel|Execute)/.test(operationName ?? ''),
      ),
    reads: () =>
      calls.filter(
        ({ operationName }) => operationName === 'InconnectLeadPoolOperation',
      ),
  };
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const renderPool = () => {
  const transport = memoryTransport();
  const pool = renderHook(() => useLeadPool(origin.toUpperCase()), {
    wrapper: ({ children }: PropsWithChildren) => (
      <ApolloProvider client={transport.client}>{children}</ApolloProvider>
    ),
  }).result;
  const recover = async (id: string, value: unknown) => {
    transport.read(value);
    await act(() => pool.current.recover(id));
  };
  return { ...transport, pool, recover };
};

it.each([
  ['cambia A por B', redirected(cancelled), /destinatarios o cantidades/i],
  [
    'revive CANCELLED como RUNNING con version posterior',
    revived,
    /progreso confirmado/i,
  ],
])(
  'X → Y → X rechaza si %s y permite recuperar X',
  async (_name, falseX, error) => {
    const { pool, recover, calls, writes } = renderPool();
    await recover(X.toUpperCase(), {
      ...cancelled,
      id: X.toUpperCase(),
      objectId: origin.toUpperCase(),
    });
    expect(pool.current.operation?.id).toBe(X);
    expect(calls[0].variables).toEqual({ input: { operationId: X } });
    await recover(Y, second);
    await recover(X, falseX);
    expect(pool.current.error).toMatch(error);
    expect(pool.current.operation).toEqual(second);
    await act(async () => {
      await pool.current.advance();
      await pool.current.cancel();
    });
    expect(writes()).toHaveLength(0);
    await recover(X, cancelled);
    expect(pool.current.operation).toEqual(cancelled);
    expect(pool.current.error).toBeNull();
  },
);

it('R3 sin Y: rechaza sustitucion, bloquea ambas acciones y reconcilia el plan original', async () => {
  const { pool, recover, writes, execute } = renderPool();
  await recover(X, preview);
  await recover(X, redirected(preview));
  expect(pool.current.operation).toEqual(preview);
  expect(pool.current.writesBlocked).toBe(true);
  expect(pool.current.error).toMatch(/destinatarios/i);
  await act(async () => {
    await pool.current.advance();
    await pool.current.cancel();
  });
  expect(writes()).toHaveLength(0);
  await recover(X, preview);
  execute(running);
  await act(() => pool.current.advance());
  expect(writes()[0].variables.input).toEqual({
    operationId: X,
    expectedVersion: 0,
  });
  expect(writes()[0].getContext().disableAutomaticRetry).toBe(true);
  expect(pool.current.operation).toEqual(running);
});

it('serializa recuperaciones de igual y distinto UUID y rechaza una respuesta anterior', async () => {
  const { pool, recover, read, reads } = renderPool();
  const pending = deferred<LeadPoolOperation>();
  read(pending.promise);
  let recovery!: Promise<void>;
  act(() => {
    recovery = pool.current.recover(X);
  });
  await act(async () => {
    await pool.current.recover(Y);
    await pool.current.recover(X.toUpperCase());
  });
  expect(reads()).toHaveLength(1);
  await act(async () => {
    pending.resolve(cancelled);
    await recovery;
  });
  expect(pool.current.operation).toEqual(cancelled);
  await recover(Y, { ...cancelled, intentionId: second.intentionId });
  expect(pool.current.error).toMatch(/identificador consultado/i);
  expect(pool.current.operation).toEqual(cancelled);
  await recover(Y, second);
  await recover(X, running);
  expect(pool.current.error).toMatch(/progreso confirmado/i);
  expect(pool.current.operation).toEqual(second);
  await recover(X, cancelled);
  expect(pool.current.operation).toEqual(cancelled);
});

const fill99 = async ({ recover }: ReturnType<typeof renderPool>) => {
  for (let n = 100; n < 199; n++) {
    await recover(uuid(n), {
      ...completed,
      id: uuid(n),
      intentionId: uuid(n + 1000),
    });
  }
};

it('99/100/101: admite la tardia numero 100, conserva la primera, y bloquea nuevas solicitudes antes del enlace', async () => {
  const harness = renderPool();
  const { pool, read, recover, reads, writes } = harness;
  await fill99(harness);
  expect(reads()).toHaveLength(99);
  const pending = deferred<LeadPoolOperation>();
  read(pending.promise);
  let recovery!: Promise<void>;
  act(() => {
    recovery = pool.current.recover(X);
  });
  await act(() => pool.current.recover(Y));
  expect(reads()).toHaveLength(100);
  expect(pool.current.operation?.id).toBe(uuid(198));
  await act(async () => {
    pending.resolve(cancelled);
    await recovery;
  });
  expect(pool.current.operation).toEqual(cancelled);
  await act(() => pool.current.recover(Y));
  expect(pool.current.error).toMatch(/límite de 100/i);
  expect(pool.current.operation).toEqual(cancelled);
  expect(reads()).toHaveLength(100);
  await recover(
    uuid(100).toUpperCase(),
    redirected({ ...completed, id: uuid(100), intentionId: uuid(1100) }),
  );
  expect(pool.current.error).toMatch(/destinatarios/i);
  expect(pool.current.operation).toEqual(cancelled);
  await recover(uuid(100), {
    ...completed,
    id: uuid(100),
    intentionId: uuid(1100),
  });
  expect(pool.current.operation?.id).toBe(uuid(100));
  act(() => pool.current.reset());
  await act(() => pool.current.preview('SINGLE', [A], undefined, 1));
  expect(pool.current.error).toMatch(/límite de 100/i);
  expect(pool.current.error).not.toMatch(/recarga/i);
  expect(writes()).toHaveLength(0);
});

it('preview incierto en 99 conserva el UUID de intención; escritura incierta en 100 se reconcilia por UUID conocido', async () => {
  const harness = renderPool();
  const {
    pool,
    recover,
    writes,
    reads,
    lost,
    preview: previewAnswer,
    execute,
  } = harness;
  await fill99(harness);
  act(() => pool.current.reset());
  act(() => pool.current.select([record1, record2]));
  lost('PreviewInconnectLeadPool');
  await act(() => pool.current.preview('SINGLE', [A], undefined, 1));
  const input: LeadPoolPreviewInput = writes()[0].variables.input;
  expect(pool.current.hasIntention).toBe(true);
  expect(pool.current.knownOperationId).toBeNull();
  expect(writes()).toHaveLength(1);
  await recover(Y, second);
  expect(pool.current.error).toMatch(/intención pendiente/i);
  expect(pool.current.hasIntention).toBe(true);
  const persisted = { ...preview, intentionId: input.intentionId };
  previewAnswer(persisted);
  await act(() => pool.current.preview('EVEN', [B], undefined, 50));
  expect(writes()[1].variables.input).toEqual(input);
  expect(pool.current.operation).toEqual(persisted);
  const falseAdvance = {
    ...redirected(running),
    intentionId: input.intentionId,
  };
  execute(falseAdvance);
  await act(() => pool.current.advance());
  expect(pool.current.operation).toEqual(persisted);
  expect(pool.current.writesBlocked).toBe(true);
  expect(pool.current.error).toMatch(/destinatarios/i);
  const readCount = reads().length;
  await act(() => pool.current.recover(Y));
  expect(reads()).toHaveLength(readCount);
  await recover(X, falseAdvance);
  expect(pool.current.operation).toEqual(persisted);
  expect(pool.current.writesBlocked).toBe(true);
  await act(async () => {
    await pool.current.advance();
    await pool.current.cancel();
  });
  expect(writes()).toHaveLength(3);
  await recover(X.toUpperCase(), {
    ...running,
    intentionId: input.intentionId,
  });
  expect(pool.current.operation?.version).toBe(1);
  expect(pool.current.writesBlocked).toBe(false);
  expect(writes()).toHaveLength(3);
});

it('rechaza regresiones de versión/contadores y admite una proyección legítima del mismo plan', async () => {
  const { pool, recover } = renderPool();
  const progressed = {
    ...running,
    version: 2,
    batchFailures: 1,
    lastBatchError: 'Lote revertido',
  };
  await recover(X, progressed);
  await recover(X, running);
  expect(pool.current.error).toMatch(/progreso confirmado/i);
  await recover(X, { ...running, version: 3 });
  expect(pool.current.error).toMatch(/progreso confirmado/i);
  expect(pool.current.operation).toEqual(progressed);
  const projected = {
    ...progressed,
    recipients: [
      {
        ...progressed.recipients[0],
        id: A.toUpperCase(),
        label: null,
        assignable: false,
      },
    ],
    items: [...progressed.items].reverse().slice(0, 1),
    hiddenItems: 1,
    canExecute: false,
  };
  await recover(X, projected);
  expect(pool.current.operation).toEqual(projected);
  expect(pool.current.error).toBeNull();
});

it('conserva el resultado individual de X al volver a ser visible después de X oculto → Y → X', async () => {
  const { pool, recover } = renderPool();
  await recover(X, cancelled);
  // Un cambio legítimo de Record Access oculta la primera fila.
  await recover(X, {
    ...cancelled,
    items: cancelled.items.slice(1),
    hiddenItems: 1,
  });
  expect(pool.current.operation?.hiddenItems).toBe(1);
  await recover(Y, second);
  // Misma versión y contadores globales. La primera fila reaparece con otro resultado.
  const rewritten = {
    ...cancelled,
    items: [{ recordId: record1, status: 'REMAINING' }],
    hiddenItems: 1,
  };
  await recover(X, rewritten);
  expect({
    operation: pool.current.operation?.id,
    error: pool.current.error,
  }).toEqual({
    operation: Y,
    error: expect.stringMatching(/progreso confirmado/i),
  });
});

const renderPage = () => {
  const store = createStore();
  const signIn = (
    workspaceId = uuid(71),
    memberId = uuid(72),
    userId = uuid(70),
  ) => {
    store.set(currentWorkspaceState.atom, {
      ...mockCurrentWorkspace,
      id: workspaceId,
    });
    store.set(currentWorkspaceMemberState.atom, {
      ...mockedWorkspaceMemberData,
      id: memberId,
    });
    store.set(currentUserState.atom, { ...mockedUserData, id: userId });
  };
  signIn();
  const transport = memoryTransport();
  render(
    <Provider store={store}>
      <ApolloProvider client={transport.client}>
        <I18nProvider i18n={i18n}>
          <InconnectLeadManagementPage />
        </I18nProvider>
      </ApolloProvider>
    </Provider>,
  );
  return { ...transport, signIn };
};
const sourceInput = () => screen.getByLabelText('Objeto de origen');
const operationInput = () =>
  screen.getByLabelText('Identificador de operación');
const button = (name: string) => screen.getByRole('button', { name });
const chooseOrigin = async (id = origin) => {
  await screen.findByRole('option', { name: 'Origen A' });
  fireEvent.change(sourceInput(), { target: { value: id } });
  await screen.findByLabelText('Identificador de operación');
};
const submit = (id: string) => {
  fireEvent.change(operationInput(), { target: { value: id } });
  fireEvent.click(button('Consultar operación'));
};
const show = async (
  transport: ReturnType<typeof memoryTransport>,
  op: LeadPoolOperation,
) => {
  transport.read(op);
  submit(op.id);
  await screen.findByText(op.id);
  await waitFor(() => expect(button('Consultar operación')).toBeEnabled());
};

it('respuesta contradictoria tardía sobrevive al remontaje por refetch de catálogo conservando origen e Y', async () => {
  const transport = renderPage();
  await chooseOrigin();
  await show(transport, cancelled);
  await show(transport, second);
  const oldInput = operationInput();
  const pendingRecovery = deferred<LeadPoolOperation>();
  transport.read(pendingRecovery.promise);
  submit(X);
  const pendingCatalog = deferred<typeof catalog>();
  transport.newCatalog(pendingCatalog.promise);
  let refresh!: Promise<unknown>;
  act(() => {
    refresh = transport.client.refetchQueries({ include: [LEAD_POOL_CATALOG] });
  });
  await screen.findByText('Comprobando disponibilidad…');
  expect(oldInput).not.toBeInTheDocument();
  await act(async () => {
    pendingCatalog.resolve(catalog);
    await refresh;
  });
  expect(operationInput()).not.toBe(oldInput);
  expect(button('Consultar operación')).toBeDisabled();
  await act(async () => {
    pendingRecovery.resolve(redirected(cancelled));
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(/destinatarios/i);
  expect(screen.getByText(Y)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Procesar siguiente lote' }),
  ).not.toBeInTheDocument();
  expect(transport.writes()).toHaveLength(0);
  await show(transport, cancelled);
});

it.each(['workspace', 'miembro'])(
  'cambio de %s separa el mismo UUID y aísla una respuesta tardía',
  async (changed) => {
    const transport = renderPage();
    await chooseOrigin();
    await show(transport, cancelled);
    const oldReply = deferred<LeadPoolOperation>();
    transport.read(oldReply.promise);
    submit(X);
    const oldInput = operationInput();
    act(() =>
      transport.signIn(
        changed === 'workspace' ? uuid(73) : uuid(71),
        changed === 'miembro' ? uuid(74) : uuid(72),
      ),
    );
    await screen.findByRole('option', { name: 'Origen A' });
    expect(sourceInput()).toHaveValue('');
    expect(oldInput).not.toBeInTheDocument();
    await chooseOrigin();
    await act(async () => {
      oldReply.resolve(redirected(cancelled));
    });
    expect(screen.queryByText(X)).not.toBeInTheDocument();
    await show(transport, running);
    expect(button('Procesar siguiente lote')).toBeEnabled();
    expect(transport.writes()).toHaveLength(0);
  },
);

it('otro origen aísla el mismo UUID y descarta una respuesta tardía del origen anterior', async () => {
  const transport = renderPage();
  await chooseOrigin();
  await show(transport, cancelled);
  const oldReply = deferred<LeadPoolOperation>();
  transport.read(oldReply.promise);
  submit(X);
  await chooseOrigin(otherOrigin);
  await act(async () => {
    oldReply.resolve(cancelled);
  });
  expect(screen.queryByText(X)).not.toBeInTheDocument();
  await show(transport, { ...running, objectId: otherOrigin });
  expect(button('Procesar siguiente lote')).toBeEnabled();
  expect(transport.writes()).toHaveLength(0);
});

it.each(['Actualizar disponibilidad', 'seleccionar B y volver a A'])(
  'mismo contexto conserva X después de X → Y y %s',
  async (action) => {
    const transport = renderPage();
    await chooseOrigin();
    await show(transport, cancelled);
    await show(transport, second);
    if (action === 'Actualizar disponibilidad') {
      fireEvent.click(button(action));
      await waitFor(() => expect(sourceInput()).toHaveValue(''));
    } else {
      await chooseOrigin(otherOrigin);
    }
    await chooseOrigin();
    transport.read(revived);
    submit(X);
    await waitFor(() => expect(button('Consultar operación')).toBeEnabled());
    const advance = screen.queryByRole('button', {
      name: 'Procesar siguiente lote',
    });
    if (advance) {
      // Exercise the real action with the contradictory model and inspect the request only.
      transport.lost('ExecuteInconnectLeadPool');
      fireEvent.click(advance);
      await waitFor(() => expect(transport.writes()).toHaveLength(1));
    }
    expect({
      error: screen.queryByRole('alert')?.textContent,
      falseXVisible: Boolean(advance),
      sent: transport
        .writes()
        .map(({ operationName, variables }) => ({ operationName, variables })),
    }).toEqual({
      error: expect.stringMatching(/progreso confirmado/i),
      falseXVisible: false,
      sent: [],
    });
  },
);

it.each(['workspace', 'miembro'])(
  'recuperación de X con otro %s requiere una respuesta de la nueva sesión aun con X anterior en vuelo',
  async (changed) => {
    const transport = renderPage();
    await chooseOrigin();
    const oldReply = deferred<LeadPoolOperation>();
    transport.read(oldReply.promise);
    submit(X);
    await waitFor(() => expect(transport.reads()).toHaveLength(1));
    act(() =>
      transport.signIn(
        changed === 'workspace' ? uuid(73) : uuid(71),
        changed === 'miembro' ? uuid(74) : uuid(72),
      ),
    );
    await screen.findByRole('option', { name: 'Origen A' });
    await chooseOrigin();
    transport.read(null); // The new identity has no access to X.
    submit(X);
    await act(async () => {
      oldReply.resolve(running);
    });
    await waitFor(() => expect(button('Consultar operación')).toBeEnabled());
    expect({
      recoveryRequests: transport.reads().length,
      previousResultRendered: Boolean(screen.queryByText(X)),
      canAdvance: Boolean(
        screen.queryByRole('button', { name: 'Procesar siguiente lote' }),
      ),
    }).toEqual({
      recoveryRequests: 2,
      previousResultRendered: false,
      canAdvance: false,
    });
  },
);

it('dos llamadas directas en una misma tarea no permiten cancelar tras un execute contradictorio', async () => {
  const { pool, recover, execute, cancel, writes } = renderPool();
  await recover(X, running);
  execute(redirected(completed));
  cancel(cancelled);
  await act(async () => {
    await pool.current.advance();
    await pool.current.cancel();
  });
  expect({
    sent: writes().map(({ operationName }) => operationName),
    blocked: pool.current.writesBlocked,
    status: pool.current.operation?.status,
  }).toEqual({
    sent: ['ExecuteInconnectLeadPool'],
    blocked: true,
    status: 'RUNNING',
  });
});

it('un replay de preview no acredita un UUID 101 aunque el llamador conserve el callback de la intención', async () => {
  const harness = renderPool();
  const {
    pool,
    lost,
    preview: previewAnswer,
    writes,
    recover,
    reads,
  } = harness;
  await fill99(harness);
  act(() => pool.current.reset());
  act(() => pool.current.select([record1, record2]));
  lost('PreviewInconnectLeadPool');
  await act(() => pool.current.preview('SINGLE', [A], undefined, 1));
  const input: LeadPoolPreviewInput = writes()[0].variables.input;
  const op100 = { ...completed, intentionId: input.intentionId };
  const falseOp101 = { ...op100, id: Y };
  previewAnswer(op100);
  previewAnswer(falseOp101);
  await act(async () => {
    await pool.current.preview('SINGLE', [A], undefined, 1);
    await pool.current.preview('SINGLE', [A], undefined, 1);
  });
  const visibleAfterReplay = pool.current.operation?.id;
  // If Y consumed a 101st checkpoint, it goes over the link even at capacity.
  const before = reads().length;
  await recover(Y, falseOp101);
  expect({
    visibleAfterReplay,
    writes: writes().length,
    requestsForY: reads().length - before,
  }).toEqual({ visibleAfterReplay: X, writes: 2, requestsForY: 0 });
});

it('mantiene el cupo de página al cambiar de origen y permite recuperar un UUID acreditado', async () => {
  const harness = renderPool();
  const { pool, recover, reads } = harness;
  await fill99(harness);
  act(() => pool.current.changeOrigin(otherOrigin));
  const operationInOtherOrigin = { ...cancelled, objectId: otherOrigin };
  await recover(X, operationInOtherOrigin);
  expect(pool.current.operation).toEqual(operationInOtherOrigin);

  act(() => pool.current.changeOrigin(origin));
  await act(() => pool.current.recover(X));
  expect(reads()).toHaveLength(100);
  expect(pool.current.error).toMatch(/límite de 100/i);
  const known = { ...completed, id: uuid(100), intentionId: uuid(1100) };
  await recover(known.id, known);
  expect(pool.current.operation).toEqual(known);
});

it('acepta que un pendiente vuelva como CHANGED en una relectura de la versión que lo procesó', async () => {
  const { pool, recover } = renderPool();
  await recover(X, running);
  const projected = {
    ...completed,
    items: completed.items.slice(0, 1),
    hiddenItems: 1,
  };
  await recover(X, projected);
  expect(pool.current.operation).toEqual(projected);
  await recover(X, completed);
  expect(pool.current.operation).toEqual(completed);
  expect(pool.current.error).toBeNull();
});

it('mantiene el resultado del usuario nuevo cuando su respuesta llega antes que la anterior', async () => {
  const transport = renderPage();
  await chooseOrigin();
  const oldResponse = deferred<LeadPoolOperation>();
  transport.read(oldResponse.promise);
  submit(X);
  await waitFor(() => expect(transport.reads()).toHaveLength(1));

  act(() => transport.signIn(uuid(71), uuid(72), uuid(75)));
  await chooseOrigin();
  const newResponse = deferred<LeadPoolOperation>();
  transport.read(newResponse.promise);
  submit(X);
  await waitFor(() => expect(transport.reads()).toHaveLength(2));
  expect(
    transport
      .reads()
      .every((request) => request.getContext().queryDeduplication === false),
  ).toBe(true);

  await act(async () => newResponse.resolve(cancelled));
  expect(await screen.findByText(/CANCELLED/)).toBeInTheDocument();
  await act(async () => oldResponse.resolve(running));
  expect(screen.getByText(/CANCELLED/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Procesar siguiente lote' }),
  ).not.toBeInTheDocument();
  expect(transport.writes()).toHaveLength(0);
});

it('invalida una acción del DOM anterior aunque el usuario vuelva antes del siguiente render', async () => {
  const transport = renderPage();
  await chooseOrigin();
  await show(transport, running);
  const oldAdvance = button('Procesar siguiente lote');
  await act(async () => {
    transport.signIn(uuid(71), uuid(72), uuid(75));
    transport.signIn();
    fireEvent.click(oldAdvance);
  });

  expect(transport.writes()).toHaveLength(0);
  await screen.findByRole('option', { name: 'Origen A' });
  expect(sourceInput()).toHaveValue('');
  expect(screen.queryByText(X)).not.toBeInTheDocument();
  await chooseOrigin();
  await show(transport, cancelled);
  expect(screen.getByText(/CANCELLED/)).toBeInTheDocument();
});
