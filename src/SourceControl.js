import git from 'simple-git'

/**
 * Connect to the source control system and return commit logs for a range.
 * Currently this only connects to git.
 */
export default class SourceControl {
	/**
	 * Return top-level commit logs for a range.
	 * Commits produced by merges are nested under <log>.graph.merged and their
	 * messages are consolidated into the merge commit for ticket parsing.
	 *
	 * @param {String} workspaceDir The source control workspace directory.
	 * @param {Object} range An object defining the range boundaries.
	 * @return {Promise<Array>} Resolves to a list of top-level commit objects.
	 */
	async getCommitLogs(workspaceDir, range = {}) {
		const workspace = git(workspaceDir)

		return new Promise((resolve, reject) => {
			const rangeOptions = range && typeof range === 'object' ? range : {}
			const customArgs = typeof range === 'string' ? [range] : []
			const opts = {
				format: {
					revision: '%H',
					date: '%ai',
					summary: '%s%d',
					fullText: '%s\n%b',
					authorName: '%aN',
					authorEmail: '%ae',
					parents: '%P'
				},
				...rangeOptions,
				symmetric: Boolean(rangeOptions.symmetric)
			}

			const args = customArgs.length ? [customArgs, opts] : [opts]

			workspace.log(...args, (err, response) => {
				if (err) {
					return reject(err)
				}

				const graph = this.simpleTopLevelGraph(response.all || [])
				const logs = this.consolidateCommitMessages(graph)

				return resolve(logs)
			})
		})
	}

	/**
	 * Determine if a commit is a git-generated revert commit.
	 * @param {Object} log - A single commit log object.
	 * @return {String|null} The reverted sha, or null.
	 */
	isRevert(log) {
		const fullText = String(log.fullText || '').replace(/\n/g, ' ').trim()
		const match = fullText.match(/^Revert ".*?This reverts commit ([0-9a-f]+)\.$/i)

		if (!match) {
			return null
		}

		const revertSummary = String(log.summary || '').match(/^(Revert ")+/g)
		const numReverts = revertSummary ? revertSummary[0].match(/Revert/g).length : 1

		return numReverts % 2 !== 0 ? match[1] : null
	}

	/**
	 * Create a simple one-level graph of commit logs.
	 * @param {Array} logs Commit log rows from simple-git.
	 * @return {Array}
	 */
	simpleTopLevelGraph(logs) {
		const hashes = {}
		const graph = []
		const logObjs = logs.map((item) => {
			const log = { ...item }
			const parents = String(log.parents || '')
				.split(' ')
				.map((parent) => parent.trim())
				.filter(Boolean)

			log.graph = {
				prev: parents[0],
				parents: parents.slice(1),
				merged: []
			}
			log.reverted = this.isRevert(log)
			hashes[log.revision] = log

			return log
		})

		let log = logObjs[0]
		while (log) {
			graph.push(log)
			delete hashes[log.revision]
			log = hashes[log.graph.prev]
		}

		function relatedLogs(logItem, seen = {}) {
			if (!logItem || !logItem.graph) {
				return []
			}

			let out = []
			const related = [logItem.graph.prev, ...logItem.graph.parents].filter(Boolean)

			related.forEach((hash) => {
				if (seen[hash]) {
					return
				}

				seen[hash] = true
				const relatedObj = hashes[hash]

				if (relatedObj) {
					delete hashes[hash]
					out = out.concat(relatedObj, relatedLogs(relatedObj, seen))
				}
			})

			return out
		}

		graph.forEach((topLevelLog) => {
			topLevelLog.graph.merged = relatedLogs(topLevelLog)
		})

		return graph
	}

	/**
	 * Given a commit graph, combine merged commit messages into the top-level
	 * merge commit. Reverted commits are skipped because their message no longer
	 * describes a current change.
	 * @param {Array} graph Commit history graph.
	 * @return {Array}
	 */
	consolidateCommitMessages(graph) {
		const commits = [...graph]

		commits.forEach((item) => {
			let { fullText } = item

			item.graph.merged.forEach((merged) => {
				if (merged.reverted) {
					return
				}

				fullText += `\n${String(merged.fullText || '').trim()}`
			})

			item.fullText = String(fullText || '').trim()
		})

		return commits
	}

	/**
	 * Backwards-compatible alias for the original misspelled method name.
	 */
	consolodateCommitMessages(graph) {
		return this.consolidateCommitMessages(graph)
	}
}
