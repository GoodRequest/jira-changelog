import SourceControl from './SourceControl'
import git from 'simple-git'

jest.mock('simple-git', () => jest.fn())

beforeEach(() => {
	git.mockReset()
})

const commit = (revision, parents = '', fields = {}) => ({
	revision,
	date: '2026-01-01',
	summary: `Summary ${revision}`,
	fullText: `Full ${revision}`,
	authorName: 'Jane',
	authorEmail: 'jane@example.com',
	parents,
	...fields
})

describe('SourceControl', () => {
	test('loads commit logs from git', async () => {
		const all = [commit('a1', '', { summary: 'Feature [ENG-1]', fullText: 'Feature [ENG-1]' })]
		const log = jest.fn((opts, cb) => cb(null, { all }))
		git.mockReturnValue({ log })

		const source = new SourceControl()
		const logs = await source.getCommitLogs('/repo', { from: 'a', to: 'b', symmetric: false })

		expect(git).toHaveBeenCalledWith('/repo')
		expect(log.mock.calls[0][0].from).toBe('a')
		expect(log.mock.calls[0][0].to).toBe('b')
		expect(log.mock.calls[0][0].symmetric).toBe(false)
		expect(logs[0].revision).toBe('a1')
	})

	test('passes opaque git ranges through as custom arguments', async () => {
		const log = jest.fn((args, opts, cb) => cb(null, { all: [] }))
		git.mockReturnValue({ log })

		const source = new SourceControl()
		await source.getCommitLogs('/repo', 'HEAD~3')

		expect(log.mock.calls[0][0]).toEqual(['HEAD~3'])
		expect(log.mock.calls[0][1].format.revision).toBe('%H')
	})

	test('detects git revert commits', () => {
		const source = new SourceControl()
		const reverted = source.isRevert({
			summary: 'Revert "Feature"',
			fullText: 'Revert "Feature"\n\nThis reverts commit abc123.'
		})

		expect(reverted).toBe('abc123')
	})

	test('does not treat double-revert commits as reverts', () => {
		const source = new SourceControl()
		const reverted = source.isRevert({
			summary: 'Revert "Revert "Feature""',
			fullText: 'Revert "Revert "Feature""\n\nThis reverts commit abc123.'
		})

		expect(reverted).toBeNull()
	})

	test('does not treat normal commits as reverts', () => {
		const source = new SourceControl()

		expect(source.isRevert(commit('abc123'))).toBeNull()
	})

	test('builds a one-level graph that preserves nested merge commits', () => {
		const source = new SourceControl()
		const logs = [
			commit('6', '5 3'),
			commit('5', '4'),
			commit('4', '2'),
			commit('3', '2 2b'),
			commit('2b', '2a'),
			commit('2a', '2'),
			commit('2', '1'),
			commit('1')
		]

		const graph = source.simpleTopLevelGraph(logs)

		expect(graph.map((item) => item.revision)).toEqual(['6', '5', '4', '2', '1'])
		expect(graph[0].graph.merged.map((item) => item.revision)).toEqual(['3', '2b', '2a'])
	})

	test('consolidates nested merged commit messages into their top-level merge commit', () => {
		const source = new SourceControl()
		const logs = [
			commit('6', '5 3', { fullText: 'Merge' }),
			commit('5', '4', { fullText: 'Full rev 5' }),
			commit('4', '2', { fullText: 'Full rev 4' }),
			commit('3', '2 2b', { fullText: 'Full rev 3' }),
			commit('2b', '2a', { fullText: 'Full rev 2b' }),
			commit('2a', '2', { fullText: 'Full rev 2a' }),
			commit('2', '1', { fullText: 'Full rev 2' }),
			commit('1', '', { fullText: 'Full rev 1' })
		]

		const graph = source.simpleTopLevelGraph(logs)
		const consolidated = source.consolidateCommitMessages(graph)

		expect(consolidated[0].fullText).toContain('Merge')
		expect(consolidated[0].fullText).toContain('Full rev 3')
		expect(consolidated[0].fullText).toContain('Full rev 2b')
		expect(consolidated[0].fullText).toContain('Full rev 2a')
		expect(consolidated[1].fullText).toBe('Full rev 5')
	})

	test('does not consolidate merged revert commit messages', () => {
		const source = new SourceControl()
		const logs = [
			commit('merge', 'main revert', { fullText: 'Merge' }),
			commit('main', 'base', { fullText: 'Mainline' }),
			commit('revert', 'base', {
				summary: 'Revert "Feature [ENG-1]"',
				fullText: 'Revert "Feature [ENG-1]"\n\nThis reverts commit abc123.'
			}),
			commit('base')
		]

		const graph = source.simpleTopLevelGraph(logs)
		const consolidated = source.consolidateCommitMessages(graph)

		expect(consolidated[0].fullText).toBe('Merge')
		expect(consolidated[0].fullText).not.toContain('Feature [ENG-1]')
	})

	test('keeps backwards-compatible misspelled consolidate alias', () => {
		const source = new SourceControl()
		const graph = source.simpleTopLevelGraph([commit('merge', 'main feature'), commit('main'), commit('feature', '', { fullText: 'Feature [ENG-1]' })])

		expect(source.consolodateCommitMessages(graph)[0].fullText).toContain('Feature [ENG-1]')
	})
})
