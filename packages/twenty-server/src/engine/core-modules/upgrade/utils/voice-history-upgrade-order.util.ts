export const VOICE_HISTORY_UPGRADE_NAME =
  '2.32.0_CreateInconnectVoiceHistoryFastInstanceCommand_1795521600000';

export const VOICE_HISTORY_FOLLOWING_SLOW_NAME =
  '2.32.0_BackfillInconnectMessagingWebhookProjectionSlowInstanceCommand_1789040000001';

export const voiceHistoryCursorParameters = {
  voiceHistory: VOICE_HISTORY_UPGRADE_NAME,
  voiceHistoryFollowingSlow: VOICE_HISTORY_FOLLOWING_SLOW_NAME,
};

export const cursorHasPassedVoiceHistory = (
  stepNames: string[],
  cursorName: string,
  cursorStatus?: 'completed' | 'failed',
) => {
  const voiceIndex = stepNames.indexOf(VOICE_HISTORY_UPGRADE_NAME);
  const cursorIndex = stepNames.indexOf(cursorName);
  return (
    voiceIndex !== -1 &&
    (cursorIndex > voiceIndex ||
      (cursorIndex === voiceIndex && cursorStatus === 'completed'))
  );
};

// The later-applied Fast can leave the cursor at the real Slow already completed
// for this scope. Its own success or failure remains in tracking.
export const voiceHistoryCursorCondition = (
  row: 'migration' | 'candidate',
  bind: {
    voiceHistory: ':voiceHistory' | '$2';
    voiceHistoryFollowingSlow: ':voiceHistoryFollowingSlow' | '$3';
  },
) => `(
  ${row}.name <> ${bind.voiceHistory}
  OR NOT (
    (SELECT successor.status = 'completed' AND NOT successor."isInitial"
     FROM core."upgradeMigration" successor
     WHERE successor.name = ${bind.voiceHistoryFollowingSlow} AND successor."workspaceId" IS NULL
     ORDER BY successor.attempt DESC LIMIT 1) IS TRUE
    AND (
      ${row}."workspaceId" IS NULL
      OR (SELECT successor.status = 'completed'
          FROM core."upgradeMigration" successor
          WHERE successor.name = ${bind.voiceHistoryFollowingSlow}
            AND successor."workspaceId" = ${row}."workspaceId"
          ORDER BY successor.attempt DESC LIMIT 1) IS TRUE
    )
  )
)`;

export const VOICE_HISTORY_NAMED_CURSOR_CONDITION = voiceHistoryCursorCondition(
  'migration',
  {
    voiceHistory: ':voiceHistory',
    voiceHistoryFollowingSlow: ':voiceHistoryFollowingSlow',
  },
);

export const VOICE_HISTORY_WORKSPACE_CURSOR_CONDITION =
  voiceHistoryCursorCondition('candidate', {
    voiceHistory: '$2',
    voiceHistoryFollowingSlow: '$3',
  });
