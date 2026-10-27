import { useLingui } from '@lingui/react/macro';
import { type LeadPoolOperation } from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';

import {
  StyledPoolControls,
  StyledPoolNotice,
  StyledPoolSection,
  StyledPoolTableScroll,
} from '@/inconnect-lead-management/components/LeadPool.styles';

type LeadPoolResultProps = {
  operation: LeadPoolOperation;
  busy: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onRecover: () => void;
  onReset: () => void;
};
export const LeadPoolResult = ({
  operation,
  busy,
  onExecute,
  onCancel,
  onRecover,
  onReset,
}: LeadPoolResultProps) => {
  const { t } = useLingui();
  const confirmationTitle =
    operation.status === 'PREVIEW'
      ? t`Confirmar y procesar primer lote`
      : t`Procesar siguiente lote`;
  const active =
    operation.status === 'PREVIEW' || operation.status === 'RUNNING';
  return (
    <StyledPoolSection aria-label={t`Vista previa y resultado`}>
      <h2>
        {operation.status === 'PREVIEW'
          ? t`Vista previa del backend`
          : t`Resultado de la operación`}
      </h2>
      <StyledPoolNotice>
        {t`Operación`}: <code>{operation.id}</code> · {operation.status} ·{' '}
        {operation.mode}
      </StyledPoolNotice>
      <p>
        {t`Encontrados`}: {operation.found} · {t`Seleccionados`}:{' '}
        {operation.selected} · {t`Autorizados al preparar`}:{' '}
        {operation.authorized}
      </p>
      <p>
        {t`Cambios previstos`}: {operation.plannedChanges} ·{' '}
        {t`Conservados previstos`}: {operation.plannedUnchanged} ·{' '}
        {t`No incluidos por cuotas`}: {operation.plannedRemaining}
      </p>
      <ul>
        {operation.recipients.map((recipient) => (
          <li key={recipient.id}>
            {recipient.label ?? t`Destinatario no disponible`} ·{' '}
            <code>{recipient.id}</code>: {recipient.quantity}
          </li>
        ))}
      </ul>
      {active && !operation.canExecute && (
        <p role="alert">{t`No se puede continuar: los destinos originales deben ser identificables y asignables con el acceso actual, y el preview debe seguir vigente. Consulta el progreso o cancela los pendientes.`}</p>
      )}
      <p>
        {t`Procesados y confirmados`}: {operation.processed} /{' '}
        {operation.selected - operation.plannedRemaining}
      </p>
      <progress
        aria-label={t`Progreso confirmado`}
        value={operation.processed}
        max={Math.max(1, operation.selected - operation.plannedRemaining)}
      />
      {operation.lastBatchError && (
        <p role="alert">{operation.lastBatchError}</p>
      )}
      <p>
        {Object.entries(operation.counts)
          .map(([status, count]) => `${status}: ${count}`)
          .join(' · ')}
      </p>
      {operation.counts.CONFLICT +
        operation.counts.REJECTED +
        operation.counts.FAILED >
        0 && (
        <p role="alert">{t`La operación incluye conflictos o rechazos. Revisa los resultados antes de preparar una nueva selección.`}</p>
      )}
      {operation.hiddenItems > 0 && (
        <p>{t`Algunos resultados individuales no están disponibles con el acceso actual.`}</p>
      )}
      <StyledPoolTableScroll>
        <table>
          <thead>
            <tr>
              <th>{t`Identidad del registro`}</th>
              <th>{t`Resultado`}</th>
            </tr>
          </thead>
          <tbody>
            {operation.items.map((item) => (
              <tr key={item.recordId}>
                <td>{item.recordId}</td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </StyledPoolTableScroll>
      <p>{t`Cada confirmación procesa como máximo un lote. Si se pierde la conexión, consulta esta misma operación antes de continuar. La cancelación conserva los lotes ya confirmados.`}</p>
      <StyledPoolControls>
        {active && (
          <Button
            disabled={
              busy ||
              !operation.canExecute ||
              !operation.recipients.length ||
              operation.recipients.some(
                (recipient) =>
                  !recipient.label?.trim() || !recipient.assignable,
              )
            }
            onClick={onExecute}
            accent="blue"
            title={confirmationTitle}
            ariaLabel={confirmationTitle}
          />
        )}
        {active && (
          <button
            disabled={busy}
            onClick={onCancel}
          >{t`Cancelar registros pendientes`}</button>
        )}
        <button
          disabled={busy}
          onClick={onRecover}
        >{t`Consultar progreso guardado`}</button>
        {!active && (
          <button
            disabled={busy}
            onClick={onReset}
          >{t`Nueva selección`}</button>
        )}
      </StyledPoolControls>
    </StyledPoolSection>
  );
};
