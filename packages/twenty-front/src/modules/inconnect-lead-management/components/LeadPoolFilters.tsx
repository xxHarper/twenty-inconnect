import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { type LeadPoolField, type LeadPoolFilter } from 'twenty-shared/types';

import { StyledPoolControls } from '@/inconnect-lead-management/components/LeadPool.styles';

type LeadPoolFiltersProps = {
  fields: LeadPoolField[];
  owners: { id: string; label: string }[];
  disabled: boolean;
  onSearch: (filter: LeadPoolFilter) => void;
};
export const LeadPoolFilters = ({
  fields,
  owners,
  disabled,
  onSearch,
}: LeadPoolFiltersProps) => {
  const { t } = useLingui();
  const [conditions, setConditions] = useState<
    NonNullable<LeadPoolFilter['conditions']>
  >([]);
  const [search, setSearch] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [operator, setOperator] = useState<'EQ' | 'NEQ' | 'BEFORE' | 'AFTER'>(
    'EQ',
  );
  const [value, setValue] = useState('');
  const [orderFieldId, setOrderFieldId] = useState('');
  const [direction, setDirection] = useState<'ASC' | 'DESC'>('ASC');
  const field = fields.find((candidate) => candidate.id === fieldId);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch({
          ...(search ? { search } : {}),
          ...(ownerId ? { ownerId } : {}),
          ...(conditions.length || field
            ? {
                conditions: [
                  ...conditions,
                  ...(field ? [{ fieldId, operator, value }] : []),
                ],
              }
            : {}),
          ...(orderFieldId ? { orderFieldId, direction } : {}),
        });
      }}
    >
      <fieldset disabled={disabled}>
        <legend>{t`Filtros del origen`}</legend>
        <StyledPoolControls>
          <label>
            {t`Buscar por etiqueta`}
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            {t`Propietario actual`}
            <select
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
            >
              <option value="">{t`Cualquiera`}</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t`Campo de filtro`}
            <select
              value={fieldId}
              onChange={(event) => {
                setFieldId(event.target.value);
                setValue('');
                setOperator('EQ');
              }}
            >
              <option value="">{t`Sin condición adicional`}</option>
              {fields.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          {field && (
            <>
              <label>
                {t`Condición`}
                <select
                  value={operator}
                  onChange={(event) =>
                    setOperator(event.target.value as typeof operator)
                  }
                >
                  <option value="EQ">{t`Igual`}</option>
                  <option value="NEQ">{t`Distinto`}</option>
                  {(field.type === 'DATE' || field.type === 'DATE_TIME') && (
                    <>
                      <option value="BEFORE">{t`Antes de`}</option>
                      <option value="AFTER">{t`Después de`}</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                {field.label}
                {field.type === 'SELECT' || field.type === 'BOOLEAN' ? (
                  <select
                    required
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  >
                    <option value="">{t`Selecciona un valor`}</option>
                    {(field.type === 'BOOLEAN'
                      ? [
                          { value: 'true', label: t`Sí` },
                          { value: 'false', label: t`No` },
                        ]
                      : field.options
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    type={
                      field.type === 'DATE' || field.type === 'DATE_TIME'
                        ? 'date'
                        : 'text'
                    }
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                )}
              </label>
            </>
          )}
          {field && (
            <button
              type="button"
              disabled={conditions.length >= 9 || value === ''}
              onClick={() => {
                setConditions((current) => [
                  ...current,
                  { fieldId, operator, value },
                ]);
                setFieldId('');
                setValue('');
              }}
            >{t`Añadir condición AND`}</button>
          )}
          <label>
            {t`Ordenar por`}
            <select
              value={orderFieldId}
              onChange={(event) => setOrderFieldId(event.target.value)}
            >
              <option value="">{t`Identidad estable`}</option>
              {fields.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t`Dirección`}
            <select
              value={direction}
              onChange={(event) =>
                setDirection(event.target.value as typeof direction)
              }
            >
              <option value="ASC">{t`Ascendente`}</option>
              <option value="DESC">{t`Descendente`}</option>
            </select>
          </label>
          <button type="submit">{t`Consultar Leads`}</button>
        </StyledPoolControls>
        {conditions.length > 0 && (
          <ul>
            {conditions.map((condition, index) => (
              <li key={index}>
                {fields.find((candidate) => candidate.id === condition.fieldId)
                  ?.label ?? t`Campo seleccionado`}{' '}
                {condition.operator} {condition.value}{' '}
                <button
                  type="button"
                  onClick={() =>
                    setConditions((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >{t`Quitar condición`}</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </form>
  );
};
