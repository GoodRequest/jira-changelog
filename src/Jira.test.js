import fetch from 'node-fetch'
import Jira, { JiraRestClient, normalizeBaseUrl, normalizeHost } from './Jira'
import { getDefaultConfig } from './Config'

jest.mock('node-fetch', () => jest.fn())

const ORIGINAL_ENV = process.env

const DEFAULT_TICKET = (overrides = {}) => {
	const base = {
		id: '10001',
		key: 'ENG-123',
		fields: {
			summary: 'Ticket summary',
			issuetype: { name: 'Story' },
			project: { key: 'PROJ' },
			status: { name: 'Done' },
			reporter: { emailAddress: 'owner@example.com' },
			fixVersions: []
		}
	}

	return {
		...base,
		...overrides,
		fields: {
			...base.fields,
			...(overrides.fields || {})
		}
	}
}

function mockJsonResponse(body, status = 200, statusText = 'OK') {
	const text = typeof body === 'string' ? body : JSON.stringify(body)

	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		text: jest.fn(() => Promise.resolve(text)),
		json: jest.fn(() => Promise.resolve(body))
	}
}

function basicAuth(email, token) {
	return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

function newConfig(api = {}) {
	const cfg = getDefaultConfig()
	cfg.jira.api = {
		host: 'example.atlassian.net',
		email: 'user@example.com',
		token: 'token',
		...api
	}
	cfg.jira.excludeIssueTypes = []
	cfg.jira.includeIssueTypes = []
	return cfg
}

function clearJiraEnv() {
	delete process.env.JIRA_API_HOST
	delete process.env.JIRA_API_USER
	delete process.env.JIRA_API_TOKEN
	delete process.env.JIRA_API_CLOUD_ID
	delete process.env.CHANGELOG_JIRA_API_HOST
	delete process.env.CHANGELOG_JIRA_API_USER
	delete process.env.CHANGELOG_JIRA_API_TOKEN
	delete process.env.CHANGELOG_JIRA_API_CLOUD_ID
	delete process.env.JIRA_EMAIL
	delete process.env.CHANGELOG_JIRA_EMAIL
}

let config
let jira
let consoleLogSpy
let consoleWarnSpy
let consoleErrorSpy

beforeEach(() => {
	fetch.mockReset()
	process.env = { ...ORIGINAL_ENV }
	clearJiraEnv()
	consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
	consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
	consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
	config = newConfig({ cloudId: 'cloud-123' })
	jira = new Jira(config)
})

afterEach(() => {
	consoleLogSpy.mockRestore()
	consoleWarnSpy.mockRestore()
	consoleErrorSpy.mockRestore()
	process.env = ORIGINAL_ENV
})

describe('Jira host and URL normalization', () => {
	test('normalizes Jira host values used by caller secrets', () => {
		expect(normalizeHost('https://example.atlassian.net/')).toBe('example.atlassian.net')
		expect(normalizeHost('http://example.atlassian.net///')).toBe('example.atlassian.net')
		expect(normalizeHost(' example.atlassian.net ')).toBe('example.atlassian.net')
	})

	test('normalizes Jira base URLs used for cloudId discovery', () => {
		expect(normalizeBaseUrl('example.atlassian.net')).toBe('https://example.atlassian.net')
		expect(normalizeBaseUrl('https://example.atlassian.net/')).toBe('https://example.atlassian.net')
	})
})

describe('Jira REST client gateway behavior', () => {
	test('uses Atlassian API Gateway mode by default when cloudId is configured', async () => {
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await jira.jira.findIssue('ENG-123')

		expect(jira.jira.baseUrl).toBe('https://api.atlassian.com/ex/jira/cloud-123/rest/api/3')
		expect(fetch).toHaveBeenCalledWith('https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/ENG-123', expect.objectContaining({ method: 'GET' }))
	})

	test('supports the GoodRequest reusable workflow env contract without passing cloudId', async () => {
		process.env.JIRA_API_HOST = 'workflow.atlassian.net'
		process.env.JIRA_API_USER = 'workflow@example.com'
		process.env.JIRA_API_TOKEN = 'workflow-token'
		config = getDefaultConfig()
		config.jira.api = {}
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse({ cloudId: 'resolved-workflow-cloud' }))
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await jira.getJiraIssue('ENG-123')

		expect(fetch).toHaveBeenNthCalledWith(1, 'https://workflow.atlassian.net/_edge/tenant_info', {
			headers: { Accept: 'application/json' }
		})
		expect(fetch.mock.calls[1][0]).toBe('https://api.atlassian.com/ex/jira/resolved-workflow-cloud/rest/api/3/issue/ENG-123')
		expect(fetch.mock.calls[1][1].headers.Authorization).toBe(basicAuth('workflow@example.com', 'workflow-token'))
	})

	test('resolves cloudId lazily from a normalized Jira host', async () => {
		config = newConfig({ host: 'https://example.atlassian.net/' })
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse({ cloudId: 'resolved-cloud' }))
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await jira.getJiraIssue('ENG-123')

		expect(fetch.mock.calls[0][0]).toBe('https://example.atlassian.net/_edge/tenant_info')
		expect(fetch.mock.calls[1][0]).toBe('https://api.atlassian.com/ex/jira/resolved-cloud/rest/api/3/issue/ENG-123')
	})

	test('uses explicit cloudId without making a tenant_info discovery request', async () => {
		config = newConfig({ host: 'https://example.atlassian.net/', cloudId: 'explicit-cloud' })
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await jira.getJiraIssue('ENG-123')

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(fetch.mock.calls[0][0]).toBe('https://api.atlassian.com/ex/jira/explicit-cloud/rest/api/3/issue/ENG-123')
	})

	test('builds legacy Jira Cloud URLs only when API Gateway mode is disabled', async () => {
		config = newConfig({ useApiGateway: false })
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await jira.jira.findIssue('ENG-123')

		expect(jira.jira.baseUrl).toBe('https://example.atlassian.net/rest/api/2')
		expect(fetch.mock.calls[0][0]).toBe('https://example.atlassian.net/rest/api/2/issue/ENG-123')
	})

	test('uses Basic auth with email and token', async () => {
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await jira.jira.findIssue('ENG-123')

		expect(fetch.mock.calls[0][1].headers.Authorization).toBe(basicAuth('user@example.com', 'token'))
	})

	test('keeps deprecated username/password config working as an auth fallback', async () => {
		config = newConfig({ email: undefined, token: undefined, username: 'legacy@example.com', password: 'legacy-token', cloudId: 'legacy-cloud' })
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await jira.jira.findIssue('ENG-123')

		expect(fetch.mock.calls[0][1].headers.Authorization).toBe(basicAuth('legacy@example.com', 'legacy-token'))
		expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
	})

	test('allows explicit API version override', () => {
		config = newConfig({ cloudId: 'cloud-123', apiVersion: 2 })
		jira = new Jira(config)

		expect(jira.jira.baseUrl).toBe('https://api.atlassian.com/ex/jira/cloud-123/rest/api/2')
	})

	test('passes JSON bodies and custom fetch options through the internal REST client', async () => {
		const client = new JiraRestClient({
			host: 'api.atlassian.com',
			basePath: '/ex/jira/cloud-123',
			email: 'user@example.com',
			token: 'token',
			apiVersion: 3,
			options: {
				fetchOptions: { timeout: 5000 },
				headers: { 'X-Test': 'yes' }
			}
		})
		fetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }))

		await client.updateIssue('ENG-123', { fields: { summary: 'Updated' } })

		expect(fetch).toHaveBeenCalledWith(
			'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/ENG-123',
			expect.objectContaining({
				method: 'PUT',
				timeout: 5000,
				body: JSON.stringify({ fields: { summary: 'Updated' } }),
				headers: expect.objectContaining({
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-Test': 'yes',
					Authorization: basicAuth('user@example.com', 'token')
				})
			})
		)
	})
})

describe('Jira REST client failures', () => {
	test('throws useful errors for failed Jira requests with errorMessages', async () => {
		const client = new JiraRestClient({ host: 'example.atlassian.net', apiVersion: 2 })
		fetch.mockResolvedValueOnce(mockJsonResponse({ errorMessages: ['Nope'] }, 403, 'Forbidden'))

		await expect(client.findIssue('ENG-123')).rejects.toThrow('403 Forbidden: Nope')
	})

	test('fails clearly when cloudId cannot be resolved', async () => {
		config = newConfig()
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse({ error: 'not found' }, 404, 'Not Found'))

		await expect(jira.getJiraIssue('ENG-123')).rejects.toThrow('Could not resolve Jira cloudId: 404 Not Found')
	})

	test('fails clearly when tenant_info does not include cloudId', async () => {
		config = newConfig()
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse({ tenantId: 'missing-cloud' }))

		await expect(jira.getJiraIssue('ENG-123')).rejects.toThrow('tenant_info response did not include cloudId')
	})

	test('fails clearly when cloudId discovery is disabled without explicit cloudId', async () => {
		config = newConfig({ resolveCloudId: false })
		jira = new Jira(config)

		await expect(jira.getJiraIssue('ENG-123')).rejects.toThrow('requires a cloudId when jira.api.resolveCloudId is false')
		expect(fetch).not.toHaveBeenCalled()
	})

	test('does not create a legacy Jira client without a host even when cloudId is configured', () => {
		config = newConfig({ host: undefined, cloudId: 'cloud-123', useApiGateway: false })
		jira = new Jira(config)

		expect(jira.jira).toBeUndefined()
		expect(consoleErrorSpy).toHaveBeenCalledWith('ERROR: Jira legacy site-host mode requires jira.api.host.')
	})

	test('createJiraClient fails clearly for legacy mode without a host', () => {
		config = newConfig({ cloudId: 'cloud-123', useApiGateway: false })
		jira = new Jira(config)

		expect(() =>
			jira.createJiraClient({
				...jira.apiConfig,
				host: undefined,
				useApiGateway: false
			})
		).toThrow('Jira legacy site-host mode requires jira.api.host')
	})

	test('clears cached async Jira client promise after cloudId resolution failure', async () => {
		config = newConfig()
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse({ error: 'temporary failure' }, 500, 'Internal Server Error'))
		fetch.mockResolvedValueOnce(mockJsonResponse({ cloudId: 'resolved-after-retry' }))
		fetch.mockResolvedValueOnce(mockJsonResponse(DEFAULT_TICKET()))

		await expect(jira.getJiraIssue('ENG-123')).rejects.toThrow('Could not resolve Jira cloudId: 500 Internal Server Error')
		await expect(jira.getJiraIssue('ENG-123')).resolves.toEqual(DEFAULT_TICKET())

		expect(fetch.mock.calls.map((call) => call[0])).toEqual([
			'https://example.atlassian.net/_edge/tenant_info',
			'https://example.atlassian.net/_edge/tenant_info',
			'https://api.atlassian.com/ex/jira/resolved-after-retry/rest/api/3/issue/ENG-123'
		])
	})

	test('wraps Jira auth and permission failures with context', async () => {
		fetch.mockResolvedValueOnce(mockJsonResponse({ errorMessages: ['Forbidden'] }, 403, 'Forbidden'))

		await expect(jira.getJiraIssue('ENG-123')).rejects.toThrow('Jira authentication or permission check failed while loading ENG-123: 403')
	})
})

describe('Extract ticket keys from a string', () => {
	test('parses tickets out of a commit message', () => {
		const tickets = jira.parseTicketsFromString('Foo bar [ENG-123] [ABC-1]nospace')

		expect(tickets).toEqual(['ENG-123', 'ABC-1'])
	})

	test('supports regexp without a capture group', () => {
		config.jira.ticketIDPattern = /[A-Z]+\-[0-9]+/i
		jira = new Jira(config)
		const tickets = jira.parseTicketsFromString('Foo bar ENG-123 ABC-1nospace')

		expect(tickets).toEqual(['ENG-123', 'ABC-1'])
	})
})

describe('Fetch ticket objects from Jira', () => {
	let tixInJira = []

	beforeEach(() => {
		tixInJira = []
		jira.fetchJiraTicket = jest.fn((key) => {
			if (tixInJira.includes(key)) {
				return Promise.resolve(DEFAULT_TICKET({ id: key, key }))
			}

			const err = new Error('Not found')
			err.status = 404
			return Promise.reject(err)
		})
	})

	test('gets tickets from Jira and ignores missing tickets', async () => {
		tixInJira = ['ENG-123', 'ABC-1']
		const commit = await jira.findJiraInCommit({ fullText: 'Foo bar [ENG-123] [ABC-1] [NOOP-345]' })
		const tix = commit.tickets.map((t) => t.key)

		expect(tix).toEqual(['ENG-123', 'ABC-1'])
		expect(tix).not.toEqual(expect.arrayContaining(['NOOP-345']))
	})

	test('caches Jira requests within a commit', async () => {
		tixInJira = ['ENG-123', 'ABC-1']
		const commit = await jira.findJiraInCommit({ fullText: '[ENG-123] [ABC-1] [ENG-123]' })
		const tix = commit.tickets.map((t) => t.key)

		expect(tix).toEqual(['ENG-123', 'ABC-1'])
		expect(jira.fetchJiraTicket).toHaveBeenCalledTimes(2)
	})

	test('loads a parent ticket for a subtask ticket', async () => {
		const subtask = DEFAULT_TICKET({
			id: '10002',
			key: 'ENG-124',
			fields: {
				issuetype: { name: 'Task', subtask: true },
				parent: { key: 'ENG-123' }
			}
		})
		const parent = DEFAULT_TICKET({ id: '10001', key: 'ENG-123' })
		jira.fetchJiraTicket = jest.fn((key) => Promise.resolve(key === 'ENG-124' ? subtask : parent))

		const commit = await jira.findJiraInCommit({ fullText: '[ENG-124]' })

		expect(jira.fetchJiraTicket).toHaveBeenCalledWith('ENG-124')
		expect(jira.fetchJiraTicket).toHaveBeenCalledWith('ENG-123')
		expect(commit.tickets.map((ticket) => ticket.key)).toEqual(['ENG-124', 'ENG-123'])
	})

	test('does not refetch a subtask parent already referenced by the commit', async () => {
		const subtask = DEFAULT_TICKET({
			id: '10002',
			key: 'ENG-124',
			fields: {
				issuetype: { name: 'Task', subtask: true },
				parent: { key: 'ENG-123' }
			}
		})
		const parent = DEFAULT_TICKET({ id: '10001', key: 'ENG-123' })
		jira.fetchJiraTicket = jest.fn((key) => Promise.resolve(key === 'ENG-124' ? subtask : parent))

		const commit = await jira.findJiraInCommit({ fullText: '[ENG-123] [ENG-124]' })

		expect(jira.fetchJiraTicket).toHaveBeenCalledTimes(2)
		expect(commit.tickets.map((ticket) => ticket.key)).toEqual(['ENG-123', 'ENG-124'])
	})

	test('generate keeps changelog generation going when one commit only references a missing ticket', async () => {
		const missing = new Error('Not found')
		missing.status = 404
		jira.findJiraInCommit = jest
			.fn()
			.mockResolvedValueOnce({ fullText: '[ENG-123]', tickets: [DEFAULT_TICKET({ id: 'ENG-123', key: 'ENG-123' })] })
			.mockRejectedValueOnce(missing)
			.mockResolvedValueOnce({ fullText: '[ENG-456]', tickets: [DEFAULT_TICKET({ id: 'ENG-456', key: 'ENG-456' })] })

		const logs = await jira.generate([{ fullText: '[ENG-123]' }, { fullText: '[MISSING-1]' }, { fullText: '[ENG-456]' }])

		expect(logs).toHaveLength(3)
		expect(logs[0].tickets.map((ticket) => ticket.key)).toEqual(['ENG-123'])
		expect(logs[1]).toEqual({ fullText: '[MISSING-1]', tickets: [] })
		expect(logs[2].tickets.map((ticket) => ticket.key)).toEqual(['ENG-456'])
	})

	test('generate still fails fast for non-404 Jira errors', async () => {
		const forbidden = new Error('Forbidden')
		forbidden.status = 403
		jira.findJiraInCommit = jest.fn().mockRejectedValue(forbidden)

		await expect(jira.generate([{ fullText: '[ENG-123]' }])).rejects.toThrow('Forbidden')
	})

	test('does not swallow Jira auth or permission errors', async () => {
		jira.fetchJiraTicket = jest.fn(() => {
			const err = new Error('Forbidden')
			err.status = 403
			return Promise.reject(err)
		})

		await expect(jira.findJiraInCommit({ fullText: '[ENG-123]' })).rejects.toThrow('Forbidden')
	})
})

describe('Filtering by ticket type', () => {
	const fooTicket = DEFAULT_TICKET({ fields: { issuetype: { name: 'foo' } } })
	const barTicket = DEFAULT_TICKET({ fields: { issuetype: { name: 'bar' } } })

	test('uses include list when present', () => {
		config.jira.includeIssueTypes = ['foo', 'boo']
		jira = new Jira(config)

		expect(jira.includeTicket(fooTicket)).toBe(true)
		expect(jira.includeTicket(barTicket)).toBe(false)
	})

	test('uses exclude list when include list is empty', () => {
		config.jira.includeIssueTypes = []
		config.jira.excludeIssueTypes = ['foo', 'boo']
		jira = new Jira(config)

		expect(jira.includeTicket(fooTicket)).toBe(false)
		expect(jira.includeTicket(barTicket)).toBe(true)
	})

	test('excludes malformed Jira responses without issue type names', () => {
		expect(jira.includeTicket(DEFAULT_TICKET({ fields: { issuetype: {} } }))).toBe(false)
	})
})

describe('Release version orchestration', () => {
	let jiraVersions = []

	beforeEach(() => {
		jiraVersions = []
		jira.jira.getVersions = jest.fn(() => Promise.resolve(jiraVersions))
		jira.jira.createVersion = jest.fn((data) => Promise.resolve(data))
		jira.jira.updateIssue = jest.fn((key, data) => Promise.resolve(data))
	})

	test('creates a new project version', async () => {
		const ver = await jira.createProjectVersion('test-version-1', 'PROJ')

		expect(ver.name).toBe('test-version-1')
		expect(ver.project).toBe('PROJ')
		expect(jira.jira.createVersion).toHaveBeenCalled()
	})

	test('reuses an existing project version case-insensitively', async () => {
		jiraVersions = [{ id: 'v1', name: 'Test-Version-1', project: 'PROJ' }]
		const ver = await jira.createProjectVersion('test-version-1', 'PROJ')

		expect(ver.id).toBe('v1')
		expect(jira.jira.createVersion).not.toHaveBeenCalled()
	})

	test('adds release to tickets', async () => {
		const tickets = [
			DEFAULT_TICKET({ id: 987, key: 'ENG-123' }),
			DEFAULT_TICKET({ id: 876, key: 'BAR-234' })
		]

		await jira.addTicketsToReleaseVersion(tickets, 'test-release-1')

		expect(jira.jira.createVersion).toHaveBeenCalledTimes(1)
		expect(jira.jira.updateIssue).toHaveBeenCalledTimes(2)
		expect(jira.jira.updateIssue.mock.calls[0][0]).toBe(987)
		expect(jira.jira.updateIssue.mock.calls[0][1].fields.fixVersions).toEqual([{ name: 'test-release-1' }])
		expect(jira.jira.updateIssue.mock.calls[1][0]).toBe(876)
		expect(jira.jira.updateIssue.mock.calls[1][1].fields.fixVersions).toEqual([{ name: 'test-release-1' }])
	})

	test('requires release tickets to include a project key', async () => {
		const ticket = DEFAULT_TICKET({ id: 987, key: 'ENG-123', fields: { project: undefined } })

		await expect(jira.addTicketsToReleaseVersion([ticket], 'test-release-1')).resolves.toEqual([undefined])
	})
})

describe('Release version Jira API routing', () => {
	test('writes release versions and issue updates through Atlassian API Gateway URLs', async () => {
		config = newConfig({ cloudId: 'release-cloud' })
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse([]))
		fetch.mockResolvedValueOnce(mockJsonResponse({ id: '500', name: 'release-1', project: 'PROJ' }))
		fetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }))
		fetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }))

		await jira.addTicketsToReleaseVersion(
			[
				DEFAULT_TICKET({ id: '10001', key: 'PROJ-1', fields: { project: { key: 'PROJ' } } }),
				DEFAULT_TICKET({ id: '10002', key: 'PROJ-2', fields: { project: { key: 'PROJ' }, fixVersions: [{ id: 'old', name: 'old-release' }] } })
			],
			'release-1'
		)

		expect(fetch.mock.calls.map((call) => call[0])).toEqual([
			'https://api.atlassian.com/ex/jira/release-cloud/rest/api/3/project/PROJ/versions',
			'https://api.atlassian.com/ex/jira/release-cloud/rest/api/3/version',
			'https://api.atlassian.com/ex/jira/release-cloud/rest/api/3/issue/10001',
			'https://api.atlassian.com/ex/jira/release-cloud/rest/api/3/issue/10002'
		])
		expect(fetch.mock.calls[1][1]).toEqual(
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ name: 'release-1', project: 'PROJ' })
			})
		)
		expect(JSON.parse(fetch.mock.calls[2][1].body).fields.fixVersions).toEqual([{ name: 'release-1' }])
		expect(JSON.parse(fetch.mock.calls[3][1].body).fields.fixVersions).toEqual([{ id: 'old', name: 'old-release' }, { name: 'release-1' }])
	})

	test('does not duplicate an existing fixVersion when assigning a release', async () => {
		config = newConfig({ cloudId: 'release-cloud' })
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse([{ id: '500', name: 'release-1', project: 'PROJ' }]))
		fetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }))

		await jira.addTicketsToReleaseVersion(
			[DEFAULT_TICKET({ id: '10001', key: 'PROJ-1', fields: { project: { key: 'PROJ' }, fixVersions: [{ id: '500', name: 'release-1' }] } })],
			'release-1'
		)

		expect(fetch).toHaveBeenCalledTimes(2)
		expect(JSON.parse(fetch.mock.calls[1][1].body).fields.fixVersions).toEqual([{ id: '500', name: 'release-1' }])
	})

	test('propagates auth failures from release writes', async () => {
		config = newConfig({ cloudId: 'release-cloud' })
		jira = new Jira(config)
		fetch.mockResolvedValueOnce(mockJsonResponse([]))
		fetch.mockResolvedValueOnce(mockJsonResponse({ id: '500', name: 'release-1', project: 'PROJ' }))
		fetch.mockResolvedValueOnce(mockJsonResponse({ errorMessages: ['Forbidden'] }, 403, 'Forbidden'))

		await expect(jira.addTicketsToReleaseVersion([DEFAULT_TICKET({ id: '10001', key: 'PROJ-1' })], 'release-1')).rejects.toThrow('403 Forbidden')
	})
})
