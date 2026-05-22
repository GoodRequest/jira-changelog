import { generate, generateTemplateData } from './template'
import { getDefaultConfig } from './Config'

const ticket = (key, status = 'Done') => ({
	id: key,
	key,
	fields: {
		summary: `${key} summary`,
		issuetype: { name: 'Story' },
		status: { name: status },
		reporter: { emailAddress: 'owner@example.com' }
	}
})

describe('template data', () => {
	test('groups commits and tickets', async () => {
		const config = getDefaultConfig()
		const commits = [
			{ revision: 'a', summary: 'A', fullText: 'A', tickets: [ticket('ENG-1')] },
			{ revision: 'b', summary: 'B', fullText: 'B', tickets: [] },
			{ revision: 'c', summary: 'C', fullText: 'C', tickets: [ticket('ENG-2', 'In Review')] }
		]

		const data = await generateTemplateData(config, commits, [])

		expect(data.commits.tickets).toHaveLength(2)
		expect(data.commits.noTickets).toHaveLength(1)
		expect(data.tickets.approved.map((t) => t.key)).toEqual(['ENG-1'])
		expect(data.tickets.pending.map((t) => t.key)).toEqual(['ENG-2'])
		expect(data.tickets.pendingByOwner[0].email).toBe('owner@example.com')
	})

	test('renders configured template', async () => {
		const config = {
			...getDefaultConfig(),
			template: '<%= tickets.all.length %> ticket(s)',
			transformData: (data) => Promise.resolve(data)
		}
		const output = await generate([{ revision: 'a', summary: 'A', fullText: 'A', tickets: [ticket('ENG-1')] }], config)

		expect(output).toBe('1 ticket(s)')
	})
})
