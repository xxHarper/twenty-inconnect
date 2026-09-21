export const mergeInconnectMessagingEdges = <
  TConnection extends { edges: Array<{ node: { id: string } }> },
>(
  current: TConnection,
  next: TConnection,
): TConnection => {
  const knownIds = new Set(current.edges.map(({ node }) => node.id));

  return {
    ...next,
    edges: [
      ...current.edges,
      ...next.edges.filter(({ node }) => !knownIds.has(node.id)),
    ],
  };
};

export const mergeInconnectMessagingMessageConnections = <
  TConnection extends {
    edges: Array<{ node: { id: string } }>;
    readThroughMessageId?: string | null;
  },
>(
  current: TConnection,
  next: TConnection,
): TConnection => ({
  ...mergeInconnectMessagingEdges(current, next),
  // fetchMore only appends older display pages. Once a safe arrival target is
  // present, metadata from an older page must not replace it.
  readThroughMessageId:
    current.readThroughMessageId ?? next.readThroughMessageId ?? null,
});
