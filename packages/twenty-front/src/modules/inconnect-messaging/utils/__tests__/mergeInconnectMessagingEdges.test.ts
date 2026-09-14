import { mergeInconnectMessagingEdges } from '@/inconnect-messaging/utils/mergeInconnectMessagingEdges';

describe('mergeInconnectMessagingEdges', () => {
  it('keeps cursor order and removes duplicate records across pages', () => {
    const merged = mergeInconnectMessagingEdges(
      {
        edges: [{ cursor: 'first', node: { id: 'a' } }],
        pageInfo: { hasNextPage: true, endCursor: 'first' },
      },
      {
        edges: [
          { cursor: 'again', node: { id: 'a' } },
          { cursor: 'second', node: { id: 'b' } },
        ],
        pageInfo: { hasNextPage: false, endCursor: 'second' },
      },
    );

    expect(merged.edges.map(({ node }) => node.id)).toEqual(['a', 'b']);
    expect(merged.pageInfo.endCursor).toBe('second');
  });
});
