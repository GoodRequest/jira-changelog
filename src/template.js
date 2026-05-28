import ejs from 'ejs'
import _ from 'lodash'

/**
 * Filter revert commits out of a commit log list when the original commit is present.
 * @param {Array} logs - List of commit logs.
 * @return {Array}
 */
export function filterRevertedCommits(logs) {
	const commitHash = {}
	logs.forEach((log) => {
		commitHash[log.revision] = log
	})

	const reduced = logs.reduce((acc, log) => {
		if (log.reverted) {
			const revertedCommit = commitHash[log.reverted]

			if (revertedCommit) {
				revertedCommit.revertedBy = log.revision
				acc.add(revertedCommit)
			} else {
				acc.add(log)
			}
		} else {
			acc.add(log)
		}

		return acc
	}, new Set())

	return Array.from(reduced)
}

/**
 * Mark tickets as reverted if their latest commit is a revert.
 * @param {Array} tickets - Jira ticket objects with commit lists.
 * @return {Array}
 */
export function decorateTicketReverts(tickets) {
	tickets.forEach((ticket) => {
		if (!ticket.commits || !ticket.commits.length) {
			ticket.reverted = null
			return
		}

		const commits = _.sortBy(ticket.commits, (commit) => commit.date).reverse()
		const lastCommit = commits[0]
		ticket.reverted = lastCommit.reverted || lastCommit.revertedBy
	})

	return tickets
}

/**
 * Fetch reporter contact information for a list of tickets.
 * @param {Array} tickets
 * @return {Array}
 */
export function getTicketReporters(tickets) {
	const reporters = {}

	tickets.forEach((ticket) => {
		const reporter = ticket?.fields?.reporter || {}
		const email = reporter.emailAddress || reporter.email || 'Unknown'
		const name = reporter.displayName || email

		if (!reporters[email]) {
			reporters[email] = { email, name, tickets: [ticket] }
		} else {
			reporters[email].tickets.push(ticket)
		}
	})

	return _.sortBy(Object.values(reporters), (item) => item.name)
}

/**
 * Split Jira tickets by approval status.
 * @param {Object} config - Configuration object.
 * @param {Array} tickets - Jira tickets.
 * @return {Object}
 */
export function groupTicketsByStatus(config, tickets) {
	let { approvalStatus } = config.jira

	if (!approvalStatus) {
		return { approved: [], pending: tickets }
	}

	if (!Array.isArray(approvalStatus)) {
		approvalStatus = [approvalStatus]
	}

	const statusMatch = approvalStatus.map((status) => String(status).toLowerCase())
	const out = { approved: [], pending: [] }

	tickets.forEach((ticket) => {
		const name = String(ticket?.fields?.status?.name || '').toLowerCase()

		if (statusMatch.includes(name)) {
			out.approved.push(ticket)
		} else {
			out.pending.push(ticket)
		}
	})

	return out
}

/**
 * Filter commit logs into template data.
 * @param {Object} config - Configuration object.
 * @param {Array} logs - Commit logs with Jira tickets.
 * @return {Object}
 */
export function transformCommitLogs(config, logs) {
	const reducedLogs = filterRevertedCommits(logs)
	const ticketHash = reducedLogs.reduce((all, log) => {
		;(log.tickets || []).forEach((ticket) => {
			all[ticket.key] = all[ticket.key] || ticket
			all[ticket.key].commits = all[ticket.key].commits || []
			all[ticket.key].commits.push(log)
		})

		return all
	}, {})

	decorateTicketReverts(Object.values(ticketHash))

	const ticketList = _.sortBy(Object.values(ticketHash), (ticket) => ticket?.fields?.issuetype?.name || '')
	const tixByStatus = groupTicketsByStatus(config, ticketList)
	const pendingByOwner = getTicketReporters(tixByStatus.pending)

	return {
		commits: {
			all: reducedLogs,
			tickets: reducedLogs.filter((commit) => commit.tickets && commit.tickets.length),
			noTickets: reducedLogs.filter((commit) => !commit.tickets || !commit.tickets.length),
			reverted: reducedLogs.filter((log) => log.reverted || log.revertedBy)
		},
		tickets: {
			pendingByOwner,
			all: ticketList,
			approved: tixByStatus.approved,
			pending: tixByStatus.pending,
			reverted: ticketList.filter((ticket) => ticket.reverted)
		}
	}
}

/**
 * Create data object for the changelog template.
 * @param {Object} config - Configuration object.
 * @param {Array} changelog - Changelog list.
 * @param {Array} releaseVersions - Jira release versions for this changelog.
 * @return {Promise<Object>}
 */
export async function generateTemplateData(config, changelog, releaseVersions) {
	let data = transformCommitLogs(config, changelog)

	if (typeof config.transformData == 'function') {
		data = await Promise.resolve(config.transformData(data))
	}

	data.jira = {
		baseUrl: config.jira.baseUrl,
		releaseVersions
	}

	data.options = {
		hideEmptyBlocks: !!config.hideEmptyBlocks
	}

	return data
}

/**
 * Render the changelog template and provide output.
 * @param {Object} config - Configuration object.
 * @param {Object} data - Template data.
 * @return {String}
 */
export function renderTemplate(config, data) {
	return ejs.render(config.template, data)
}

export async function generate(changelog, config, releaseVersions = []) {
	const data = await generateTemplateData(config, changelog, releaseVersions)
	return renderTemplate(config, data)
}

export default {
	filterRevertedCommits,
	decorateTicketReverts,
	getTicketReporters,
	groupTicketsByStatus,
	transformCommitLogs,
	generateTemplateData,
	renderTemplate,
	generate
}
