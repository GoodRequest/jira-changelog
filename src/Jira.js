import 'core-js/stable'
import 'regenerator-runtime/runtime'

import fetch from 'node-fetch'
import PromiseThrottle from 'promise-throttle'

const ATLASSIAN_API_HOST = 'api.atlassian.com'
const LEGACY_JIRA_API_VERSION = 2
const GATEWAY_JIRA_API_VERSION = 3

const promiseThrottle = new PromiseThrottle({
	requestsPerSecond: 10,
	promiseImplementation: Promise
})

export function normalizeHost(host) {
	if (!host || typeof host !== 'string') {
		return host
	}

	return host
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
}

export function normalizeBaseUrl(host) {
	if (!host || typeof host !== 'string') {
		return host
	}

	const normalized = host.trim().replace(/\/+$/, '')
	return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`
}

function normalizePath(path) {
	if (!path || typeof path !== 'string') {
		return ''
	}

	const trimmed = path.trim().replace(/\/+$/, '')
	return trimmed ? (trimmed.startsWith('/') ? trimmed : `/${trimmed}`) : ''
}

function normalizeEndpoint(endpoint) {
	return endpoint.startsWith('/') ? endpoint : `/${endpoint}`
}

function encodeBasicAuth(email, token) {
	return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

function parseResponseBody(text) {
	if (!text) {
		return undefined
	}

	try {
		return JSON.parse(text)
	} catch (e) {
		return text
	}
}

function stringifyErrorDetail(detail) {
	if (!detail) {
		return ''
	}

	if (Array.isArray(detail)) {
		return detail.join('; ')
	}

	if (typeof detail === 'string') {
		return detail
	}

	if (detail.message) {
		return detail.message
	}

	try {
		return JSON.stringify(detail)
	} catch (e) {
		return String(detail)
	}
}

function errorStatus(err) {
	return err?.status || err?.statusCode || err?.response?.status || err?.response?.statusCode
}

function normalizeApiVersion(value, fallback) {
	const parsed = Number(value || fallback)

	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export class JiraRequestError extends Error {
	constructor(message, response, body) {
		super(message)
		this.name = 'JiraRequestError'
		this.status = response?.status
		this.statusCode = response?.status
		this.statusText = response?.statusText
		this.body = body
	}
}

/**
 * Minimal Jira REST client for the exact endpoints used by the changelog tool.
 */
export class JiraRestClient {
	constructor({ host, basePath = '', email, token, apiVersion, options = {} }) {
		if (!host) {
			throw new Error('ERROR: Cannot configure Jira without a host.')
		}

		this.host = normalizeHost(host)
		this.basePath = normalizePath(basePath)
		this.email = email
		this.token = token
		this.apiVersion = apiVersion
		this.fetchOptions = options.fetchOptions || {}
		this.headers = options.headers || {}
		this.baseUrl = `https://${this.host}${this.basePath}/rest/api/${this.apiVersion}`
	}

	async request(method, endpoint, body) {
		const headers = {
			Accept: 'application/json',
			...this.headers
		}

		if (this.email && this.token) {
			headers.Authorization = encodeBasicAuth(this.email, this.token)
		}

		const options = {
			...this.fetchOptions,
			method,
			headers
		}

		if (typeof body !== 'undefined') {
			headers['Content-Type'] = 'application/json'
			options.body = JSON.stringify(body)
		}

		const response = await fetch(`${this.baseUrl}${normalizeEndpoint(endpoint)}`, options)
		const text = typeof response.text === 'function' ? await response.text() : ''
		const parsedBody = parseResponseBody(text)

		if (!response.ok) {
			const detail =
				typeof parsedBody === 'object' && parsedBody
					? parsedBody.errorMessages || parsedBody.errors || parsedBody.message
					: parsedBody
			const suffix = detail ? `: ${stringifyErrorDetail(detail)}` : ''

			throw new JiraRequestError(`Jira API request failed: ${response.status} ${response.statusText || ''}${suffix}`, response, parsedBody)
		}

		return parsedBody
	}

	findIssue(issueKeyOrId) {
		return this.request('GET', `/issue/${encodeURIComponent(issueKeyOrId)}`)
	}

	getVersions(projectKey) {
		return this.request('GET', `/project/${encodeURIComponent(projectKey)}/versions`)
	}

	createVersion(data) {
		return this.request('POST', '/version', data)
	}

	updateIssue(issueKeyOrId, data) {
		return this.request('PUT', `/issue/${encodeURIComponent(issueKeyOrId)}`, data)
	}
}

/**
 * Generate a changelog by matching source control commit logs to Jira tickets.
 */
export default class Jira {
	constructor(config) {
		this.config = config
		this.jira = undefined
		this.jiraClientPromise = undefined
		this.releaseVersions = []
		this.ticketPromises = {}
		this.apiConfig = this.normalizeApiConfig(config?.jira?.api || {})

		if (!this.apiConfig.useApiGateway && !this.apiConfig.host) {
			console.error('ERROR: Jira legacy site-host mode requires jira.api.host.')
			return
		}

		if (this.apiConfig.useApiGateway && !this.apiConfig.host && !this.apiConfig.cloudId && !this.apiConfig.gatewayBase) {
			console.error('ERROR: Jira API gateway mode requires jira.api.host, jira.api.cloudId, or jira.api.gatewayBase.')
			return
		}

		if (!this.apiConfig.useApiGateway || this.apiConfig.cloudId || this.apiConfig.gatewayBase) {
			this.jira = this.createJiraClient(this.apiConfig)
		}
	}

	normalizeApiConfig(api = {}) {
		const env = process.env || {}
		const host = api.host || env.JIRA_API_HOST || env.CHANGELOG_JIRA_API_HOST
		const { username, password } = api
		let { email, token, options, cloudId, apiVersion, useApiGateway, resolveCloudId } = api

		if (!email) {
			email = api.user || env.JIRA_API_USER || env.CHANGELOG_JIRA_API_USER || env.JIRA_EMAIL || env.CHANGELOG_JIRA_EMAIL
		}

		if (!token) {
			token = env.JIRA_API_TOKEN || env.CHANGELOG_JIRA_API_TOKEN
		}

		if (!token && typeof password !== 'undefined') {
			console.warn('WARNING: Jira password is deprecated. Use an API token instead.')
			token = password
		}

		if (!email && typeof username !== 'undefined') {
			console.warn('WARNING: Jira username is deprecated for API authentication. Use user email instead.')
			email = username
		}

		options = options || {}
		cloudId = cloudId || env.JIRA_API_CLOUD_ID || env.CHANGELOG_JIRA_API_CLOUD_ID
		cloudId = cloudId ? String(cloudId).trim() : undefined

		// New scoped Atlassian API tokens require the API gateway path.
		// Keep legacy site-host mode available, but only as an explicit opt-out.
		useApiGateway = useApiGateway !== false

		return {
			host: normalizeHost(host),
			email,
			token,
			options,
			cloudId,
			useApiGateway,
			resolveCloudId: resolveCloudId !== false,
			gatewayHost: normalizeHost(api.gatewayHost || ATLASSIAN_API_HOST),
			gatewayBase: normalizePath(api.gatewayBase),
			basePath: normalizePath(api.basePath || options.base),
			apiVersion: normalizeApiVersion(apiVersion, useApiGateway ? GATEWAY_JIRA_API_VERSION : LEGACY_JIRA_API_VERSION)
		}
	}

	createJiraClient(apiConfig) {
		const { useApiGateway, cloudId, gatewayHost, gatewayBase, host, email, token, apiVersion, options, basePath } = apiConfig

		if (!useApiGateway && !host) {
			throw new Error('ERROR: Jira legacy site-host mode requires jira.api.host.')
		}

		if (useApiGateway && !cloudId && !gatewayBase) {
			throw new Error('ERROR: Jira API gateway mode requires a cloudId. Set jira.api.cloudId, set JIRA_API_CLOUD_ID, or ensure jira.api.host points to your Atlassian site host so cloudId can be resolved.')
		}

		return new JiraRestClient({
			host: useApiGateway ? gatewayHost : host,
			basePath: useApiGateway ? gatewayBase || `/ex/jira/${encodeURIComponent(cloudId)}` : basePath,
			email,
			token,
			apiVersion,
			options
		})
	}

	async getJiraClient() {
		if (this.jira) {
			return this.jira
		}

		if (!this.jiraClientPromise) {
			this.jiraClientPromise = this.createJiraClientAsync()
		}

		return this.jiraClientPromise
	}

	async createJiraClientAsync() {
		if (!this.apiConfig.useApiGateway) {
			this.jira = this.createJiraClient(this.apiConfig)
			return this.jira
		}

		if (!this.apiConfig.cloudId && !this.apiConfig.gatewayBase) {
			if (!this.apiConfig.resolveCloudId) {
				throw new Error('ERROR: Jira API gateway mode requires a cloudId when jira.api.resolveCloudId is false.')
			}

			this.apiConfig.cloudId = await this.resolveJiraCloudId(this.apiConfig.host)
		}

		this.jira = this.createJiraClient(this.apiConfig)
		return this.jira
	}

	async resolveJiraCloudId(host) {
		if (!host) {
			throw new Error('ERROR: Cannot resolve Jira cloudId without jira.api.host.')
		}

		const response = await fetch(`${normalizeBaseUrl(host)}/_edge/tenant_info`, {
			headers: { Accept: 'application/json' }
		})

		if (!response.ok) {
			const responseText = typeof response.text === 'function' ? await response.text() : ''
			throw new Error(`ERROR: Could not resolve Jira cloudId: ${response.status} ${response.statusText || ''}${responseText ? `\n${responseText}` : ''}`)
		}

		const tenantInfo = await response.json()

		if (!tenantInfo || !tenantInfo.cloudId) {
			throw new Error('ERROR: Jira tenant_info response did not include cloudId.')
		}

		return tenantInfo.cloudId
	}

	async generate(commitLogs, releaseVersion = null) {
		this.releaseVersions = []
		const logs = await Promise.all(commitLogs.map((commit) => this.findJiraInCommit(commit)))

		const ticketsHash = {}
		logs.forEach((log) => {
			log.tickets.forEach((ticket) => {
				const key = ticket.id || ticket.key
				if (key) {
					ticketsHash[key] = ticket
				}
			})
		})

		const ticketsList = Object.keys(ticketsHash).map((key) => ticketsHash[key])

		if (ticketsList.length && releaseVersion) {
			await this.addTicketsToReleaseVersion(ticketsList, releaseVersion)
		}

		return logs
	}

	async findJiraInCommit(commitLog) {
		const log = Object.assign({ tickets: [] }, { ...commitLog })
		const promises = []
		const found = {}

		this.parseTicketsFromString(log.fullText || '').forEach((key) => {
			if (found[key]) {
				return
			}

			found[key] = true
			promises.push(this.fetchJiraTicket(key).catch((err) => this.ignoreMissingIssue(err)))
		})

		const tickets = await Promise.all(promises)
		const parentPromises = []

		tickets.forEach((ticket) => {
			if (ticket?.fields?.issuetype?.subtask) {
				const parentKey = ticket?.fields?.parent?.key

				if (!parentKey || found[parentKey]) {
					return
				}

				found[parentKey] = true
				parentPromises.push(this.fetchJiraTicket(parentKey).catch((err) => this.ignoreMissingIssue(err)))
			}
		})

		const parentTickets = await Promise.all(parentPromises)
		log.tickets = tickets.concat(parentTickets).filter((ticket) => ticket && this.includeTicket(ticket))

		return log
	}

	ignoreMissingIssue(err) {
		if (this.isNotFoundError(err)) {
			return undefined
		}

		throw err
	}

	fetchJiraTicket(ticketKey) {
		if (!ticketKey) {
			return Promise.resolve()
		}

		let promise = this.ticketPromises[ticketKey]

		if (!promise) {
			promise = promiseThrottle.add(this.getJiraIssue.bind(this, ticketKey))
			promise.catch((err) => {
				if (this.isNotFoundError(err)) {
					console.log(`Ticket ${ticketKey} not found`)
				}
			})
			this.ticketPromises[ticketKey] = promise
		}

		return promise
	}

	async addTicketsToReleaseVersion(tickets, versionName) {
		const versionPromises = {}
		this.releaseVersions = []
		const jira = await this.getJiraClient()

		async function updateTicketVersion(ticket) {
			const project = ticket?.fields?.project?.key

			if (!project) {
				throw new Error(`Ticket ${ticket.key || ticket.id} does not include fields.project.key.`)
			}

			let verPromise = versionPromises[project]

			if (!verPromise) {
				verPromise = this.createProjectVersion(versionName, project)
				versionPromises[project] = verPromise

				verPromise.then((ver) => {
					ver.projectKey = project
					this.releaseVersions.push(ver)
				})
			}

			const versionObj = await verPromise
			const fixVersions = Array.isArray(ticket.fields.fixVersions) ? [...ticket.fields.fixVersions] : []
			const alreadyAssigned = fixVersions.some((version) => version.id === versionObj.id || version.name === versionObj.name)

			if (!alreadyAssigned) {
				fixVersions.push({ name: versionObj.name })
			}

			return jira.updateIssue(ticket.id || ticket.key, {
				fields: { fixVersions }
			})
		}

		const promises = tickets.map((ticket) => {
			return promiseThrottle.add(updateTicketVersion.bind(this, ticket)).catch((err) => {
				if (this.isAuthOrPermissionError(err)) {
					throw err
				}

				console.log(err instanceof Error ? err : JSON.stringify(err, null, ' '))
				console.log(`Could not assign ticket ${ticket.key} to release '${versionName}'!`)
			})
		})

		return Promise.all(promises)
	}

	async createProjectVersion(versionName, projectKey) {
		const searchName = versionName.toLowerCase()
		const jira = await this.getJiraClient()
		const versions = await jira.getVersions(projectKey)
		const exists = versions.find((version) => version.name.toLowerCase() === searchName)

		if (exists) {
			return exists
		}

		return jira.createVersion({
			name: versionName,
			project: projectKey
		})
	}

	async getJiraIssue(ticketId) {
		const jira = await this.getJiraClient()

		if (!jira) {
			return Promise.reject('Jira is not configured.')
		}

		try {
			return await jira.findIssue(ticketId)
		} catch (err) {
			if (this.isAuthOrPermissionError(err)) {
				throw new Error(`Jira authentication or permission check failed while loading ${ticketId}: ${errorStatus(err)} ${err.message || err}`)
			}

			throw err
		}
	}

	isNotFoundError(err) {
		return errorStatus(err) === 404
	}

	isAuthOrPermissionError(err) {
		return [401, 403].includes(errorStatus(err))
	}

	includeTicket(ticket) {
		if (!ticket?.fields?.issuetype?.name) {
			return false
		}

		const type = ticket.fields.issuetype.name
		const { includeIssueTypes, excludeIssueTypes } = this.config.jira

		if (Array.isArray(includeIssueTypes) && includeIssueTypes.length) {
			return includeIssueTypes.includes(type)
		}

		if (Array.isArray(excludeIssueTypes)) {
			return !excludeIssueTypes.includes(type)
		}

		return true
	}

	parseTicketsFromString(str = '') {
		const configPattern = this.config.jira.ticketIDPattern
		const searchPattern = new RegExp(configPattern.source, `${configPattern.flags || ''}g`)
		const matches = String(str).match(searchPattern) || []

		return matches
			.map((match) => {
				let key = match.match(configPattern)
				key = key.length > 1 ? key[1] : key[0]
				return key ? key.toUpperCase() : null
			})
			.filter(Boolean)
	}
}
