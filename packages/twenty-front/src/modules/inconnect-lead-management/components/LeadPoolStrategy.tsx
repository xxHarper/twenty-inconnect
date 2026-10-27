import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { Button } from 'twenty-ui/input';
import {
  type LeadPoolMode,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';

import {
  StyledPoolControls,
  StyledPoolSection,
  StyledPoolTableScroll,
} from '@/inconnect-lead-management/components/LeadPool.styles';

type LeadPoolStrategyProps = {
  recipients: { id: string; label: string }[];
  frozen: boolean;
  available: boolean;
  busy: boolean;
  hasIntention: boolean;
  storageReady: boolean;
  selectedCount: number;
  onPreview: (
    mode: LeadPoolMode,
    ids: string[],
    quotas: LeadPoolPreviewInput['quotas'],
    size: number,
  ) => void;
  onChange: () => void;
};
export const LeadPoolStrategy = ({
  recipients,
  frozen,
  available,
  busy,
  hasIntention,
  storageReady,
  selectedCount,
  onPreview,
  onChange,
}: LeadPoolStrategyProps) => {
  const { t } = useLingui();
  const [mode, setMode] = useState<LeadPoolMode>('SINGLE');
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [quotas, setQuotas] = useState<Record<string, number>>({});
  const [batchSize, setBatchSize] = useState(50);
  const change = (callback: () => void) => {
    onChange();
    callback();
  };
  const previewTitle = hasIntention
    ? t`Recuperar la misma intención de preview`
    : t`Obtener vista previa`;
  const invalidQuotas =
    mode === 'MANUAL_QUOTAS' &&
    (recipientIds.some(
      (id) => !Number.isInteger(quotas[id] ?? 0) || (quotas[id] ?? 0) < 0,
    ) ||
      recipientIds.reduce((total, id) => total + (quotas[id] ?? 0), 0) >
        selectedCount);
  const prepare = () =>
    onPreview(
      mode,
      recipientIds,
      mode === 'MANUAL_QUOTAS'
        ? recipientIds.map((recipientId) => ({
            recipientId,
            quantity: quotas[recipientId] ?? 0,
          }))
        : undefined,
      batchSize,
    );
  return (
    <StyledPoolSection>
      <h2>{t`2. Destinatarios y estrategia sin categorías`}</h2>
      <fieldset disabled={frozen || !available}>
        <legend>{t`Asignación manual del conjunto seleccionado`}</legend>
        <StyledPoolControls>
          <label>
            {t`Estrategia`}
            <select
              value={mode}
              onChange={(event) =>
                change(() => {
                  setMode(event.target.value as LeadPoolMode);
                  setRecipientIds([]);
                })
              }
            >
              <option value="SINGLE">{t`SINGLE · un destinatario`}</option>
              <option value="EVEN">{t`EVEN · cantidades equilibradas`}</option>
              <option value="MANUAL_QUOTAS">{t`MANUAL_QUOTAS · cuotas explícitas`}</option>
            </select>
          </label>
          <label>
            {t`Tamaño de procesamiento (1–100)`}
            <input
              type="number"
              min={1}
              max={100}
              value={batchSize}
              onChange={(event) =>
                change(() => setBatchSize(Number(event.target.value)))
              }
            />
          </label>
        </StyledPoolControls>
        <StyledPoolTableScroll>
          <table>
            <thead>
              <tr>
                <th>{t`Elegir`}</th>
                <th>{t`Destinatario autorizado`}</th>
                {mode === 'MANUAL_QUOTAS' && <th>{t`Cuota`}</th>}
              </tr>
            </thead>
            <tbody>
              {recipients.map((recipient) => (
                <tr key={recipient.id}>
                  <td>
                    <input
                      type={mode === 'SINGLE' ? 'radio' : 'checkbox'}
                      name="recipient"
                      aria-label={t`Asignar a ${recipient.label}`}
                      checked={recipientIds.includes(recipient.id)}
                      onChange={(event) =>
                        change(() =>
                          setRecipientIds(
                            mode === 'SINGLE'
                              ? [recipient.id]
                              : event.target.checked
                                ? [...recipientIds, recipient.id]
                                : recipientIds.filter(
                                    (id) => id !== recipient.id,
                                  ),
                          ),
                        )
                      }
                    />
                  </td>
                  <td>{recipient.label}</td>
                  {mode === 'MANUAL_QUOTAS' && (
                    <td>
                      <input
                        aria-label={t`Cuota de ${recipient.label}`}
                        type="number"
                        min={0}
                        max={1000}
                        value={quotas[recipient.id] ?? 0}
                        onChange={(event) =>
                          change(() =>
                            setQuotas((current) => ({
                              ...current,
                              [recipient.id]: Number(event.target.value),
                            })),
                          )
                        }
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </StyledPoolTableScroll>
      </fieldset>
      <StyledPoolControls>
        <Button
          accent="blue"
          disabled={
            busy ||
            !storageReady ||
            (!hasIntention && invalidQuotas) ||
            (!hasIntention &&
              (!available || selectedCount === 0 || recipientIds.length === 0))
          }
          onClick={prepare}
          title={previewTitle}
          ariaLabel={previewTitle}
        />
      </StyledPoolControls>
      {invalidQuotas && !hasIntention && (
        <p role="alert">{t`Las cuotas deben ser enteros no negativos y su suma no puede exceder la selección.`}</p>
      )}
      {!storageReady && (
        <p>{t`El preview y la ejecución requieren instalar el almacenamiento de operaciones mediante un procedimiento autorizado.`}</p>
      )}
      {selectedCount >= 1000 && (
        <p>{t`La selección explícita admite 1,000 registros por operación. Puedes seguir consultando otras páginas.`}</p>
      )}
    </StyledPoolSection>
  );
};
