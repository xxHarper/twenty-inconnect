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
