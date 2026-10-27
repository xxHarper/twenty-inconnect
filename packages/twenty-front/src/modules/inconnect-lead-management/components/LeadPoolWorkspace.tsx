import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';

import { LeadPoolFilters } from '@/inconnect-lead-management/components/LeadPoolFilters';
import { LeadPoolStrategy } from '@/inconnect-lead-management/components/LeadPoolStrategy';
import { LeadPoolResult } from '@/inconnect-lead-management/components/LeadPoolResult';
import {
  StyledPoolControls,
  StyledPoolNotice,
  StyledPoolSection,
  StyledPoolTableScroll,
} from '@/inconnect-lead-management/components/LeadPool.styles';
import { useLeadPool } from '@/inconnect-lead-management/hooks/useLeadPool';

type LeadPoolWorkspaceProps = { objectId: string; storageReady: boolean };
export const LeadPoolWorkspace = ({
  objectId,
  storageReady,
}: LeadPoolWorkspaceProps) => {
  const { t } = useLingui();
  const pool = useLeadPool(objectId);
  const [recoverId, setRecoverId] = useState('');
  const frozen = pool.busy || pool.unresolved || pool.operation !== null;
  return (
    <>
      <StyledPoolSection>
        <h2>{t`1. Consulta y selección explícita`}</h2>
        <LeadPoolFilters
          fields={pool.page?.fields ?? []}
          owners={pool.page?.recipients ?? []}
          disabled={frozen}
          onSearch={(filter) => void pool.load(filter)}
        />
        {!pool.page && !pool.operation && (
          <p>{t`Consulta para cargar los campos y destinatarios permitidos por el backend. Los filtros se habilitan según la metadata vigente.`}</p>
        )}
        {pool.page && (
          <>
            <p>
              {t`Resultados autorizados`}: {pool.page.total} ·{' '}
              {t`Seleccionados`}: {pool.selection.length}
            </p>
            <StyledPoolControls>
              <button
                disabled={frozen}
                onClick={() => void pool.load(pool.filter, 0, false, true)}
              >{t`Seleccionar primeros 50 elegibles`}</button>
              <button
                disabled={frozen || pool.selection.length >= 1000}
                onClick={() =>
                  pool.select(
                    [
                      ...new Set([
                        ...pool.selection,
                        ...pool.page!.records.map((record) => record.id),
                      ]),
                    ].slice(0, 1000),
                  )
                }
              >{t`Añadir esta página a la selección`}</button>
              <button
                disabled={frozen}
                onClick={() => pool.select([])}
              >{t`Limpiar selección`}</button>
              <button
                disabled
                title={t`Pendiente: materialización estable del filtro y recuperación masiva aceptada.`}
              >{t`Todos por filtro · no disponible`}</button>
            </StyledPoolControls>
            <StyledPoolTableScroll>
              <table>
                <thead>
                  <tr>
                    <th>{t`Seleccionar`}</th>
                    <th>{t`Lead`}</th>
                    <th>{t`Propietario actual`}</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.page.records.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t`Seleccionar ${record.label ?? record.id}`}
                          checked={pool.selection.includes(record.id)}
                          disabled={
                            frozen ||
                            (!pool.selection.includes(record.id) &&
                              pool.selection.length >= 1000)
                          }
                          onChange={(event) =>
                            pool.select(
                              event.target.checked
                                ? [...pool.selection, record.id]
                                : pool.selection.filter(
                                    (id) => id !== record.id,
                                  ),
                            )
                          }
                        />
                      </td>
                      <td>{record.label ?? t`Sin etiqueta`}</td>
                      <td>
                        {pool.page?.recipients.find(
                          (member) => member.id === record.ownerId,
                        )?.label ?? t`Propietario no disponible`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StyledPoolTableScroll>
            <StyledPoolControls>
              <button
                disabled={frozen || pool.page.offset === 0}
                onClick={() =>
                  void pool.load(
                    pool.filter,
                    Math.max(0, pool.page!.offset - 50),
                    true,
                  )
                }
              >{t`Anterior`}</button>
              <span>
                {pool.page.offset + (pool.page.records.length ? 1 : 0)}–
                {pool.page.offset + pool.page.records.length} /{' '}
                {pool.page.total}
              </span>
              <button
                disabled={
                  frozen ||
                  pool.page.offset + pool.page.records.length >= pool.page.total
                }
                onClick={() =>
                  void pool.load(pool.filter, pool.page!.offset + 50, true)
                }
              >{t`Siguiente`}</button>
            </StyledPoolControls>
          </>
        )}
      </StyledPoolSection>
      {!pool.operation && (
        <LeadPoolStrategy
          key={JSON.stringify(pool.filter)}
          recipients={pool.page?.recipients ?? []}
          frozen={frozen}
          available={pool.page !== null}
          busy={pool.busy}
          hasIntention={pool.hasIntention}
          storageReady={storageReady}
          selectedCount={pool.selection.length}
          onChange={pool.invalidatePreviewInput}
          onPreview={(mode, ids, quantities, size) => {
            void pool.preview(mode, ids, quantities, size);
          }}
        />
      )}
      {pool.operation && (
        <LeadPoolResult
          operation={pool.operation}
          busy={pool.busy}
          onExecute={() => void pool.advance()}
          onCancel={() => void pool.cancel()}
          onRecover={() => void pool.recover(pool.operation!.id)}
          onReset={pool.reset}
        />
      )}
      {!frozen && !pool.operation && (
        <button onClick={pool.reset}>{t`Nueva selección`}</button>
      )}
      <StyledPoolSection>
        <h2>{t`Recuperar una operación guardada`}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void pool.recover(recoverId || pool.knownOperationId || '');
          }}
        >
          <StyledPoolControls>
            <label>
              {t`Identificador de operación`}
              <input
                required
                value={recoverId || pool.knownOperationId || ''}
                onChange={(event) => setRecoverId(event.target.value)}
              />
            </label>
            <button
              disabled={pool.busy || !storageReady}
            >{t`Consultar operación`}</button>
          </StyledPoolControls>
        </form>
      </StyledPoolSection>
      {pool.busy && (
        <StyledPoolNotice role="status">{t`Esperando una respuesta confirmada del backend…`}</StyledPoolNotice>
      )}
      {pool.error && (
        <StyledPoolNotice role="alert">
          {pool.error}{' '}
          {t`Si pudo confirmarse un lote, consulta su operación antes de reintentar. No se muestra éxito sin confirmación.`}
        </StyledPoolNotice>
      )}
    </>
  );
};
