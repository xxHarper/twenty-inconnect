import { useLingui } from '@lingui/react';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const stops = [
  {
    id: 'pages-settings-security-commercial-teams--demo',
    title: 'Commercial Teams',
    description:
      'Organizar la coordinación y las membresías del equipo comercial.',
  },
  {
    id: 'pages-settings-roles-settingsroleedit--default',
    title: 'Roles',
    description: 'Revisar el editor estándar de permisos de Twenty.',
  },
  {
    id: 'pages-settings-security-record-access--demo',
    title: 'Record Access',
    description: 'Comparar el alcance de Ejecutivo, Coordinador y Supervisor.',
  },
  {
    id: 'pages-inconnect-messaging--demo',
    title: 'INCONNECT Messaging',
    description:
      'Abrir un chat y revisar su historial, sus estados y el contexto CRM.',
  },
  {
    id: 'pages-inconnect-lead-management--demo',
    title: 'INCONNECT Lead Management',
    description:
      'Preparar una propuesta de 25 Leads por ejecutivo con la estrategia EVEN.',
  },
];

const Presentation = () => {
  const { i18n } = useLingui();
  return (
    <main
      style={{
        color: themeCssVariables.font.color.primary,
        fontFamily: 'Inter, sans-serif',
        lineHeight: 1.5,
        margin: '0 auto',
        maxWidth: 760,
        padding: '36px 24px',
      }}
    >
      <strong>
        {i18n._({ id: 'a5-badge', message: 'DEMO · Datos ficticios · 10 min' })}
      </strong>
      <h1>{i18n._({ id: 'a5-title', message: 'Twenty INCONNECT' })}</h1>
      <p>
        {i18n._({
          id: 'a5-intro',
          message:
            'Recorrido para dirección por cinco interfaces reales del proyecto. Las interacciones se simulan en memoria.',
        })}
      </p>
      <nav
        aria-label={i18n._({ id: 'a5-nav', message: 'Recorrido ejecutivo' })}
      >
        <ol style={{ display: 'grid', gap: 12, paddingInlineStart: 24 }}>
          {stops.map(({ id, title, description }) => (
            <li key={id}>
              <a href={`/?path=/story/${id}`} target="_top">
                <strong>{title}</strong>
              </a>
              <div>{i18n._({ id: `a5-${id}`, message: description })}</div>
            </li>
          ))}
        </ol>
      </nav>
      <p>
        {i18n._({
          id: 'a5-reset',
          message:
            'Recarga la historia para restablecer sus datos. Vuelve a Presentación en la barra lateral para continuar el recorrido.',
        })}
      </p>
    </main>
  );
};

const meta = {
  id: 'inconnect-presentacion',
  title: 'Presentación/Recorrido ejecutivo',
  component: Presentation,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
} satisfies Meta<typeof Presentation>;

export default meta;

export const Inicio: StoryObj<typeof meta> = {};
