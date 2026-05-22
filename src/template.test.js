import {
	decorateTicketReverts,
	filterRevertedCommits,
	generate,
	generateTemplateData,
	getTicketReporters,
	groupTicketsByStatus,
	transformCommitLogs
} from './template'
import { getDefaultConfig } from './Config'

const ticket = (key, status = 'Done', reporter = {}) => ({
	id: key,
	key,
	fields: {
		summary: `${key} summary`,
		issuetype: { name: 'Story' },
		status: { name: status },
		reporter: {
			emailAddress: 'owner@example.com',
			displayName: 'Owner',
			...reporter
		}
	}
})

const commit = (revision, fields = {}) => ({
	revision,
	date: '2020-02-01T16:02:36-08:00',
	summary: revision,
	fullText: revision,
	tickets: [],
	...fields
})

describe('template helpers', () => {
	test('filters revert commits and marks reverted originals when the original commit is present', () => {
		const original = commit('a', { tickets: [ticket('ENG-1')] })
		const revert = commit('b', { reverted: 'a' })
		const other = commit('c')

		const logs = filterRevertedCommits([revert, other, original])

		expect(logs).toContain(original)
		expect(logs).toContain(other)
		expect(logs).not.toContain(revert)
		expect(original.revertedBy).toBe('b')
	})

	test('keeps revert commits when the original commit is not present in the changelog range', () => {
		const revert = commit('b', { reverted: 'outside-range' })

		expect(filterRevertedCommits([revert])).toEqual([revert])
	})

	test('decorates tickets as reverted from their latest commit state', () => {
		const tickets = [
			{
				key: 'ENG-123',
				commits: [
					commit('old', { date: '2020-02-02T16:02:36-08:00' }),
					commit('latest', { date: '2020-02-04T16:02:36-08:00', revertedBy: 'revert-sha' })
				]
			}
		]

		decorateTicketReverts(tickets)

		expect(tickets[0].reverted).toBe('revert-sha')
	})

	test('leaves tickets unreverted when their latest commit is active', () => {
		const tickets = [
			{
				key: 'ENG-123',
				commits: [commit('old', { date: '2020-02-02T16:02:36-08:00', revertedBy: 'revert-sha' }), commit('latest', { date: '2020-02-04T16:02:36-08:00' })]
			}
		]

		decorateTicketReverts(tickets)

		expect(tickets[0].reverted).toBeFalsy()
	})

	test('groups tickets by configured approval status', () => {
		const config = getDefaultConfig()
		const tickets = [ticket('ENG-1', 'Done'), ticket('ENG-2', 'In Review'), ticket('ENG-3', 'Closed')]

		const grouped = groupTicketsByStatus(config, tickets)

		expect(grouped.approved.map((item) => item.key)).toEqual(['ENG-1', 'ENG-3'])
		expect(grouped.pending.map((item) => item.key)).toEqual(['ENG-2'])
	})

	test('groups pending tickets by reporter', () => {
		const reporters = getTicketReporters([
			ticket('ENG-1', 'In Review', { emailAddress: 'b@example.com', displayName: 'B' }),
			ticket('ENG-2', 'In Review', { emailAddress: 'a@example.com', displayName: 'A' }),
			ticket('ENG-3', 'In Review', { emailAddress: 'a@example.com', displayName: 'A' })
		])

		expect(reporters.map((item) => item.email)).toEqual(['a@example.com', 'b@example.com'])
		expect(reporters[0].tickets.map((item) => item.key)).toEqual(['ENG-2', 'ENG-3'])
	})
})

describe('template data', () => {
	test('groups commits and tickets', async () => {
		const config = getDefaultConfig()
		const commits = [
			commit('a', { summary: 'A', fullText: 'A', tickets: [ticket('ENG-1')] }),
			commit('b', { summary: 'B', fullText: 'B', tickets: [] }),
			commit('c', { summary: 'C', fullText: 'C', tickets: [ticket('ENG-2', 'In Review')] })
		]

		const data = await generateTemplateData(config, commits, [])

		expect(data.commits.tickets).toHaveLength(2)
		expect(data.commits.noTickets).toHaveLength(1)
		expect(data.tickets.approved.map((t) => t.key)).toEqual(['ENG-1'])
		expect(data.tickets.pending.map((t) => t.key)).toEqual(['ENG-2'])
		expect(data.tickets.pendingByOwner[0].email).toBe('owner@example.com')
	})

	test('tracks reverted commits and reverted tickets in generated data', async () => {
		const config = getDefaultConfig()
		const revertedTicket = ticket('ENG-1')
		const commits = [
			commit('revert', { date: '2020-02-03T16:02:36-08:00', reverted: 'original' }),
			commit('original', { date: '2020-02-02T16:02:36-08:00', tickets: [revertedTicket] }),
			commit('active', { date: '2020-02-04T16:02:36-08:00', tickets: [ticket('ENG-2')] })
		]

		const data = await generateTemplateData(config, commits, [])

		expect(data.commits.all.map((item) => item.revision)).toEqual(['original', 'active'])
		expect(data.commits.reverted.map((item) => item.revision)).toEqual(['original'])
		expect(data.tickets.reverted.map((item) => item.key)).toEqual(['ENG-1'])
		expect(data.tickets.all.map((item) => item.key)).toEqual(['ENG-1', 'ENG-2'])
	})

	test('exposes release versions and hideEmptyBlocks option to templates', async () => {
		const config = {
			...getDefaultConfig(),
			hideEmptyBlocks: true
		}
		const releaseVersions = [{ name: '1.2.3', projectKey: 'ENG' }]

		const data = await generateTemplateData(config, [], releaseVersions)

		expect(data.jira.releaseVersions).toBe(releaseVersions)
		expect(data.options.hideEmptyBlocks).toBe(true)
	})

	test('allows transformData to adjust generated template data', async () => {
		const config = {
			...getDefaultConfig(),
			transformData: (data) => ({ ...data, custom: 'value' })
		}

		const data = await generateTemplateData(config, [], [])

		expect(data.custom).toBe('value')
	})

	test('renders configured template', async () => {
		const config = {
			...getDefaultConfig(),
			template: '<%= tickets.all.length %> ticket(s)',
			transformData: (data) => Promise.resolve(data)
		}
		const output = await generate([commit('a', { summary: 'A', fullText: 'A', tickets: [ticket('ENG-1')] })], config)

		expect(output).toBe('1 ticket(s)')
	})
})
