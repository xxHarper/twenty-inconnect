export const INCONNECT_MESSAGING_SESSION_WINDOW_MILLISECONDS =
  24 * 60 * 60 * 1000;

export const isInconnectMessagingFreeformWindowOpen = ({
  lastInboundAt,
  now,
}: {
  lastInboundAt: Date | null;
  now: Date;
}): boolean => {
  if (lastInboundAt === null) {
    return false;
  }

  const elapsed = now.getTime() - lastInboundAt.getTime();

  return (
    Number.isFinite(elapsed) &&
    elapsed >= 0 &&
    elapsed < INCONNECT_MESSAGING_SESSION_WINDOW_MILLISECONDS
  );
};
