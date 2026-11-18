import { useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { atom, useStore } from 'jotai';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { type LeadPoolCatalog } from 'twenty-shared/types';
import { IconUsers } from 'twenty-ui/icon';

import {
  leadPoolAdmissionContext,
  LeadPoolDispatchBlockedError,
  type LeadPoolSession,
} from '@/apollo/utils/leadPoolDispatch';
import { currentUserState } from '@/auth/states/currentUserState';
import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { isCookieAuthActiveState } from '@/auth/states/isCookieAuthActiveState';
import { isPendingServerSignOutState } from '@/auth/states/isPendingServerSignOutState';
import { LeadPoolWorkspace } from '@/inconnect-lead-management/components/LeadPoolWorkspace';
import {
  StyledPoolContent,
  StyledPoolControls,
  StyledPoolNotice,
  StyledPoolPage,
  StyledPoolSection,
} from '@/inconnect-lead-management/components/LeadPool.styles';
import { LEAD_POOL_CATALOG } from '@/inconnect-lead-management/graphql/leadPoolOperations';
import {
  LEAD_POOL_READ_OPTIONS,
  useLeadPool,
} from '@/inconnect-lead-management/hooks/useLeadPool';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';

const workspaceIdAtom = atom((get) =>
  get(currentWorkspaceState.atom)?.id?.toLowerCase(),
);
const userIdAtom = atom((get) => get(currentUserState.atom)?.id?.toLowerCase());
const memberIdAtom = atom((get) =>
  get(currentWorkspaceMemberState.atom)?.id?.toLowerCase(),
);
const leadPoolIdentityAtom = atom((get) =>
  Object.freeze({
    workspaceId: get(workspaceIdAtom),
    actorUserId: get(userIdAtom),
    workspaceMemberId: get(memberIdAtom),
    signingOut: get(isPendingServerSignOutState.atom),
  }),
);
// Each transport generation invalidates requests, including a mode round trip
// before React renders. Only a new identity replaces the recovery state.
const leadPoolTransportAtom = atom((get) =>
  Object.freeze({
    identity: get(leadPoolIdentityAtom),
    cookieAuthActive: get(isCookieAuthActiveState.atom),
  }),
);

type LeadPoolOriginProps = {
  pool: ReturnType<typeof useLeadPool>;
  catalog: LeadPoolCatalog | null;
  loading: boolean;
  onRefresh: () => void;
};

const LeadPoolOrigin = ({
  pool,
  catalog,
  loading,
  onRefresh,
}: LeadPoolOriginProps) => {
  const { t } = useLingui();
  const { objectId } = pool;
  const hasSelectedOrigin =
    catalog?.objects.some((object) => object.id.toLowerCase() === objectId) ===
    true;
  const storageReady = catalog?.storageReady === true;
  const recoveryAvailable = hasSelectedOrigin && storageReady;

  return (
    <>
      <StyledPoolSection>
        <h2>{t`Origen administrado`}</h2>
        <p>{t`Selecciona el objeto de Leads de tu workspace. La lista contiene únicamente orígenes con autoridad de transferencia y metadata compatible.`}</p>
        <StyledPoolControls>
          <label>
            {t`Objeto de origen`}
            <select
              disabled={!catalog || pool.originLocked}
              value={objectId}
              onChange={(event) => {
                if (catalog) pool.changeOrigin(event.target.value);
              }}
            >
              <option value="">{t`Selecciona un origen`}</option>
              {catalog?.objects.map((object) => (
                <option key={object.id} value={object.id.toLowerCase()}>
                  {object.label}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={loading}
            onClick={() => {
              pool.changeOrigin('');
              onRefresh();
            }}
          >{t`Actualizar disponibilidad`}</button>
        </StyledPoolControls>
        {pool.originLocked && (
          <StyledPoolNotice role="status">
            {t`El origen se conserva mientras haya una operación activa o pendiente de recuperar.`}{' '}
            {!recoveryAvailable &&
              t`Vuelve a comprobar la disponibilidad para continuar con la misma operación.`}
            {recoveryAvailable &&
              pool.hasIntention &&
              t`Usa «Recuperar la misma intención de preview» para confirmar su estado.`}
            {recoveryAvailable &&
              pool.writesBlocked &&
              t`Consulta la operación guardada para confirmar su estado.`}
          </StyledPoolNotice>
        )}
      </StyledPoolSection>
      <StyledPoolNotice>{t`Distribución NORMAL/MESSAGE_PENDING: NOT_READY. Todos por filtro: deshabilitado; falta la selección masiva estable con recuperación aceptada.`}</StyledPoolNotice>
      {hasSelectedOrigin && (
        <LeadPoolWorkspace
          key={objectId}
          pool={pool}
          storageReady={storageReady}
        />
      )}
    </>
  );
};

type LeadPoolCatalogPanelProps = {
  pool: ReturnType<typeof useLeadPool>;
  session: LeadPoolSession;
};

const LeadPoolCatalogPanel = ({ pool, session }: LeadPoolCatalogPanelProps) => {
  const { t } = useLingui();
  const { data, loading, error, refetch } = useQuery(LEAD_POOL_CATALOG, {
    ...LEAD_POOL_READ_OPTIONS,
    context: {
      ...LEAD_POOL_READ_OPTIONS.context,
      ...leadPoolAdmissionContext(session, session.isCurrent),
    },
  });
  const catalog =
    loading || error ? null : (data?.inconnectLeadPoolCatalog ?? null);
  return (
    <>
      {loading && <p role="status">{t`Comprobando disponibilidad…`}</p>}
      {error && (
        <p role="alert">
          {error instanceof LeadPoolDispatchBlockedError
            ? t`No se pudo vincular esta solicitud con las credenciales de la sesión del Distribuidor.`
            : t`No se pudo comprobar tu acceso.`}
        </p>
      )}
      {catalog?.blockedReason && (
        <StyledPoolNotice role="status">
          {catalog.blockedReason}
        </StyledPoolNotice>
      )}
      <LeadPoolOrigin
        pool={pool}
        catalog={catalog}
        loading={loading}
        onRefresh={() => {
          if (!session.isCurrent()) return;
          // The query already exposes availability errors to the page.
          void refetch().catch(() => undefined);
        }}
      />
    </>
  );
};

type LeadPoolPageProps = {
  session: LeadPoolSession;
  transportRevision: number;
  dispatchAvailable: boolean;
};

const LeadPoolPage = ({
  session,
  transportRevision,
  dispatchAvailable,
}: LeadPoolPageProps) => {
  const { t } = useLingui();
  const pool = useLeadPool('', session);
  return (
    <StyledPoolPage>
      <PageHeader title={t`Distribuidor de Leads`} Icon={IconUsers} />
      <StyledPoolContent>
        <StyledPoolNotice>{t`Asignación explícita de CRM. Cada cambio requiere tus permisos y políticas actuales. No utiliza atención de WhatsApp.`}</StyledPoolNotice>
        {dispatchAvailable ? (
          <LeadPoolCatalogPanel
            key={transportRevision}
            pool={pool}
            session={session}
          />
        ) : (
          <p role="alert">{t`No se pudo vincular esta solicitud con las credenciales de la sesión del Distribuidor.`}</p>
        )}
      </StyledPoolContent>
    </StyledPoolPage>
  );
};

export const InconnectLeadManagementPage = () => {
  const store = useStore();
  const readTransport = useCallback(
    () => store.get(leadPoolTransportAtom),
    [store],
  );
  const subscribe = useCallback(
    (listener: () => void) => store.sub(leadPoolTransportAtom, listener),
    [store],
  );
  const transport = useSyncExternalStore(subscribe, readTransport);
  const dispatchAvailable =
    !transport.identity.signingOut && !transport.cookieAuthActive;
  const session = useMemo(
    () =>
      Object.freeze({
        identity: transport.identity,
        isCurrent: () => dispatchAvailable && readTransport() === transport,
      }),
    [transport, dispatchAvailable, readTransport],
  );
  const [scope, setScope] = useState({
    transport,
    ownerRevision: 0,
    transportRevision: 0,
  });
  if (scope.transport !== transport) {
    setScope({
      transport,
      ownerRevision:
        scope.ownerRevision +
        Number(scope.transport.identity !== transport.identity),
      transportRevision: scope.transportRevision + 1,
    });
    return null;
  }

  return (
    <LeadPoolPage
      key={scope.ownerRevision}
      session={session}
      transportRevision={scope.transportRevision}
      dispatchAvailable={dispatchAvailable}
    />
  );
};
