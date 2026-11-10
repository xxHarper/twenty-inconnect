import { type InconnectMessagingMessage } from '@/inconnect-messaging/types/InconnectMessagingRead';

type MessageSeed = {
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  displayMinute: number;
  outboundState?: 'SENT' | 'DELIVERED';
  media?: InconnectMessagingMessage['media'];
};

type ConversationSeed = {
  address: string;
  recordLabel: string;
  interest: string;
  stage: string;
  unread?: boolean;
  favorite?: boolean;
  pending?: boolean;
  messages: MessageSeed[];
};

// This attachment has its own colors, independent of the app theme.
// oxlint-disable-next-line twenty/no-hardcoded-colors
const terminalIllustration = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="106" viewBox="0 0 300 106">
  <rect width="300" height="106" rx="12" fill="#eef4ff"/>
  <rect x="20" y="17" width="45" height="72" rx="9" fill="#244772"/>
  <rect x="27" y="25" width="31" height="24" rx="4" fill="#a8d4ff"/>
  <path d="M30 60h25m-25 9h25m-25 9h25" stroke="#fff" stroke-width="2"/>
  <text x="83" y="47" fill="#172c45" font-family="sans-serif" font-size="16">Terminal de demostración</text>
  <text x="83" y="69" fill="#375776" font-family="sans-serif" font-size="13">Ficha ilustrativa · INCONNECT</text>
</svg>`;

export const createMessagingStoryFixtures = () => {
  const seeds: ConversationSeed[] = [
    {
      address: 'Comercio Demo · Norte',
      recordLabel: 'Lead demo · Comercio Norte',
      interest: 'Terminal de pago para mostrador',
      stage: 'Evaluando propuesta',
      unread: true,
      messages: [
        {
          direction: 'INBOUND',
          body: 'Hola, ¿qué terminal de pago recomiendan para un comercio con dos cajas?',
          displayMinute: 0,
        },
        {
          direction: 'OUTBOUND',
          body: 'Podemos revisar una terminal de mostrador para cada caja. Te comparto una ficha ilustrativa para la demostración.',
          displayMinute: 4,
          outboundState: 'DELIVERED',
        },
        {
          direction: 'OUTBOUND',
          body: '',
          displayMinute: 5,
          outboundState: 'DELIVERED',
          media: [
            {
              __typename: 'InconnectMessagingMedia',
              id: crypto.randomUUID(),
              type: 'IMAGE',
              filename: 'Ficha ilustrativa de terminal',
              contentType: 'image/svg+xml',
              size: null,
              availabilityState: 'AVAILABLE',
              accessUrl: `data:image/svg+xml,${encodeURIComponent(terminalIllustration)}`,
            },
          ],
        },
        {
          direction: 'OUTBOUND',
          body: 'Sí, podemos revisar las opciones de conectividad y un esquema de soporte para ambas cajas.',
          displayMinute: 12,
          outboundState: 'SENT',
        },
        // This inbound arrived after the reply but belongs earlier in the chat.
        {
          direction: 'INBOUND',
          body: '¿Podemos revisar también la conectividad y el soporte para ambas cajas?',
          displayMinute: 9,
        },
      ],
    },
    {
      address: 'Comercio Demo · Sur',
      recordLabel: 'Lead demo · Comercio Sur',
      interest: 'Terminal portátil',
      stage: 'Primer contacto',
      favorite: true,
      messages: [
        {
          direction: 'INBOUND',
          body: 'Me interesa una terminal portátil para una feria de fin de semana.',
          displayMinute: 21,
        },
        {
          direction: 'OUTBOUND',
          body: 'Revisemos la cobertura y el volumen de cobros previsto para el evento.',
          displayMinute: 25,
          outboundState: 'DELIVERED',
        },
      ],
    },
    {
      address: 'Comercio Demo · Centro',
      recordLabel: 'Lead demo · Comercio Centro',
      interest: 'Capacitación para el equipo de caja',
      stage: 'Seguimiento',
      pending: true,
      messages: [
        {
          direction: 'INBOUND',
          body: '¿Podemos coordinar una capacitación para el equipo de caja?',
          displayMinute: 30,
        },
        {
          direction: 'OUTBOUND',
          body: 'Sí. Quedó pendiente acordar el horario de capacitación.',
          displayMinute: 36,
          outboundState: 'DELIVERED',
        },
      ],
    },
    {
      address: 'Comercio Demo · Oriente',
      recordLabel: 'Lead demo · Comercio Oriente',
      interest: 'Segunda terminal',
      stage: 'Propuesta enviada',
      messages: [
        {
          direction: 'INBOUND',
          body: 'Queremos una segunda terminal para la nueva sucursal.',
          displayMinute: 40,
        },
        {
          direction: 'OUTBOUND',
          body: 'Te compartimos una propuesta de ejemplo para revisarla juntos.',
          displayMinute: 43,
          outboundState: 'SENT',
        },
      ],
    },
  ];

  return seeds.map((seed) => {
    const messages = seed.messages.map((entry, index) => {
      const node: InconnectMessagingMessage = {
        __typename: 'InconnectMessagingMessage',
        id: crypto.randomUUID(),
        direction: entry.direction,
        type: entry.media ? 'IMAGE' : 'TEXT',
        body: entry.body,
        displayAt: new Date(
          Date.UTC(2026, 8, 14, 16, entry.displayMinute),
        ).toISOString(),
        sendMode: entry.direction === 'OUTBOUND' ? 'FREEFORM' : null,
        outboundState: entry.outboundState ?? null,
        location: null,
        media: entry.media ?? [],
        template: null,
      };
      return { node, arrival: index + 1 };
    });

    return {
      ...seed,
      id: crypto.randomUUID(),
      recordId: crypto.randomUUID(),
      createdAt: messages[0].node.displayAt,
      messages,
    };
  });
};
