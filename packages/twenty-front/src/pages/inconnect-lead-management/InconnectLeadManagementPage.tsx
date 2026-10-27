import { useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { IconUsers } from 'twenty-ui/icon';

import { LeadPoolWorkspace } from '@/inconnect-lead-management/components/LeadPoolWorkspace';
import {
  StyledPoolContent,
  StyledPoolControls,
  StyledPoolNotice,
  StyledPoolPage,
  StyledPoolSection,
} from '@/inconnect-lead-management/components/LeadPool.styles';
import { LEAD_POOL_CATALOG } from '@/inconnect-lead-management/graphql/leadPoolOperations';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';

export const InconnectLeadManagementPage = () => {
  const { t } = useLingui();
  const [objectId, setObjectId] = useState('');
  const { data, loading, error, refetch } = useQuery(LEAD_POOL_CATALOG, {
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'network-only',
  });
  const catalog = loading || error ? null : data?.inconnectLeadPoolCatalog;
  const selectedObject = catalog?.objects.find(
    (object) => object.id === objectId,
  );
  return (
    <StyledPoolPage>
      <PageHeader title={t`Distribuidor de Leads`} Icon={IconUsers} />
      <StyledPoolContent>
        <StyledPoolNotice>{t`Asignación explícita de CRM. Cada cambio requiere tus permisos y políticas actuales. No utiliza atención de WhatsApp.`}</StyledPoolNotice>
        {loading && <p role="status">{t`Comprobando disponibilidad…`}</p>}
        {error && <p role="alert">{t`No se pudo comprobar tu acceso.`}</p>}
        {catalog?.blockedReason && (
          <StyledPoolNotice role="status">
            {catalog.blockedReason}
          </StyledPoolNotice>
        )}
        <StyledPoolSection>
          <h2>{t`Origen administrado`}</h2>
          <p>{t`Selecciona el objeto de Leads de tu workspace. La lista contiene únicamente orígenes con autoridad de transferencia y metadata compatible.`}</p>
          <StyledPoolControls>
            <label>
              {t`Objeto de origen`}
              <select
                disabled={loading || !catalog}
                value={objectId}
                onChange={(event) => setObjectId(event.target.value)}
              >
                <option value="">{t`Selecciona un origen`}</option>
                {catalog?.objects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={loading}
              onClick={() => {
                setObjectId('');
                void refetch();
              }}
            >{t`Actualizar disponibilidad`}</button>
          </StyledPoolControls>
        </StyledPoolSection>
        <StyledPoolNotice>{t`Distribución NORMAL/MESSAGE_PENDING: NOT_READY. Todos por filtro: deshabilitado; falta la selección masiva estable con recuperación aceptada.`}</StyledPoolNotice>
        {selectedObject && (
          <LeadPoolWorkspace
            key={objectId}
            objectId={objectId}
            storageReady={catalog?.storageReady === true}
          />
        )}
      </StyledPoolContent>
    </StyledPoolPage>
  );
};
