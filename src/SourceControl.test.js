import SourceControl from './SourceControl';
import {getDefaultConfig} from './Config';

const source = new SourceControl(getDefaultConfig());

/**
 * Test git log graph:
 *
   *    1
   *    2 ⟍
   *    3   2a
   *    4   2b
   *    5 ⟋
   *    6 ⟍
   *    7   6a ⟍
   *        6b   6a1
   *             6a2
   *    8   6c ⟋
   *    9 ⟋
   *    10
 */
const testGitLogs = [
  {
    revision: '10',
    parents: '9',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 10', fullText: 'Full rev 10',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '9',
    parents: '8 6c',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 9', fullText: 'Full rev 9',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '8',
    parents: '7',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 8', fullText: 'Full rev 8',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '6c',
    parents: '6b 6a2',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 6c', fullText: 'Full rev 6c',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '6b',
    parents: '6a',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 6b', fullText: 'Full rev 6b',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '6a2',
    parents: '6a1',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 6a2', fullText: 'Full rev 6a2',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '6a1',
    parents: '6a',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 6a1', fullText: 'Full rev 6a1',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '6a',
    parents: '6',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 6', fullText: 'Full rev 6',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '7',
    parents: '6',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 7', fullText: 'Full rev 7',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '6',
    parents: '5',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 6', fullText: 'Full rev 6',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '5',
    parents: '4 2b',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 5', fullText: 'Full rev 5',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '2b',
    parents: '2a',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 2b', fullText: 'Full rev 2b',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '2a',
    parents: '2',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 2a', fullText: 'Full rev 2a',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '4',
    parents: '3',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 4', fullText: 'Full rev 4',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '3',
    parents: '2',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 3', fullText: 'Full rev 3',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '2',
    parents: '1',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 2', fullText: 'Full rev 2',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
  {
    revision: '1',
    parents: '0',
    date: '2020-01-23 15:52:51 -0800',
    summary: 'rev 1', fullText: 'Full rev 1',
    authorName: 'Za', authorEmail: 'Za@nowhere.com',
  },
];

describe('Build history graph', () => {
  const graph = source.simpleTopLevelGraph(testGitLogs);
  const combinedMessages = source.consolodateCommitMessages(graph);

  test('Top-level logs should not contain merged revisions', () => {
    const revisions = graph.map(i => i.revision);
    expect(revisions).toEqual(expect.arrayContaining(['10', '9', '8', '7', '6', '5', '4', '3', '2', '1']));
  });

  test('Simple 1-level nested merged', () => {
    // console.log(graph.find(i => i.revision === '2'));
    const revisions = graph.find(i => i.revision === '5')
      .graph.merged
      .map(i => i.revision);
    expect(revisions).toEqual(expect.arrayContaining(['2a', '2b']));
  });

  test('Simple multiple nested merges.', () => {
    const revisions = graph.find(i => i.revision === '9')
      .graph.merged
      .map(i => i.revision);
    expect(revisions).toEqual(expect.arrayContaining(['6a', '6b', '6c', '6a1', '6a2']));
  });

  test('Commit messages are combined from merged commits.', () => {
    const rev5 = combinedMessages.find(i => i.revision === '5');
    const expectSummary = ['rev 5', 'rev 2b', 'rev 2a'].join('\n');
    const expectFull = ['Full rev 5', 'Full rev 2b', 'Full rev 2a'].join('\n');

    expect(rev5.summary).toEqual(expectSummary);
    expect(rev5.fullText).toEqual(expectFull);
  })
});
