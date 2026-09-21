import {
  mergeInconnectMessagingEdges,
  mergeInconnectMessagingMessageConnections,
} from '@/inconnect-messaging/utils/mergeInconnectMessagingEdges';

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

  it('adopts a safe read target when an older page first presents the delayed inbound', () => {
    const merged = mergeInconnectMessagingMessageConnections(
      {
        edges: [{ cursor: 'newer', node: { id: 'm10' } }],
        pageInfo: { hasNextPage: true, endCursor: 'newer' },
        readThroughMessageId: null,
      },
      {
        edges: [{ cursor: 'older', node: { id: 'm11-delayed' } }],
        pageInfo: { hasNextPage: false, endCursor: 'older' },
        readThroughMessageId: 'm11-delayed',
      },
    );

    expect(merged.edges.map(({ node }) => node.id)).toEqual([
      'm10',
      'm11-delayed',
    ]);
    expect(merged.readThroughMessageId).toBe('m11-delayed');
  });

  it('does not regress an existing safe read target when fetching an older page', () => {
    const merged = mergeInconnectMessagingMessageConnections(
      {
        edges: [{ cursor: 'newer', node: { id: 'm20' } }],
        pageInfo: { hasNextPage: true, endCursor: 'newer' },
        readThroughMessageId: 'm20',
      },
      {
        edges: [{ cursor: 'older', node: { id: 'm10' } }],
        pageInfo: { hasNextPage: false, endCursor: 'older' },
        readThroughMessageId: 'm10',
      },
    );

    expect(merged.readThroughMessageId).toBe('m20');
  });
});
