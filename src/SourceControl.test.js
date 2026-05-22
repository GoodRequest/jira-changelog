import SourceControl from './SourceControl'
import git from 'simple-git'

jest.mock('simple-git', () => jest.fn())

beforeEach(() => {
	git.mockReset()
})

describe('SourceControl', () => {
	test('loads commit logs from git', async () => {
		const all = [
			{
				revision: 'a1',
				date: '2026-01-01',
				summary: 'Feature [ENG-1]',
				fullText: 'Feature [ENG-1]',
				authorName: 'Jane',
				authorEmail: 'jane@example.com',
				parents: ''
			}
		]
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

	test('consolidates merged commit messages', () => {
		const source = new SourceControl()
		const logs = [
			{ revision: 'merge', fullText: 'Merge', summary: 'Merge', parents: 'main feature' },
			{ revision: 'main', fullText: 'Main', summary: 'Main', parents: '' },
			{ revision: 'feature', fullText: 'Feature [ENG-1]', summary: 'Feature [ENG-1]', parents: '' }
		]

		const graph = source.simpleTopLevelGraph(logs)
		const consolidated = source.consolidateCommitMessages(graph)

		expect(consolidated[0].fullText).toContain('Merge')
		expect(consolidated[0].fullText).toContain('Feature [ENG-1]')
	})
})
