#!/usr/bin/env node

/**
 * jira-changelog CLI
 */
import 'core-js/stable'
import 'regenerator-runtime/runtime'
import 'source-map-support/register'

import fs from 'fs'
import path from 'path'
import { program } from 'commander'
import git from 'simple-git'
import { decodeEntity } from 'html-entities'

import Slack from './Slack'
import { generateTemplateData, renderTemplate } from './template'
import { readConfigFile } from './Config'
import SourceControl from './SourceControl'
import Jira from './Jira'

/**
 * Parse command line arguments.
 */
function commandLineArgs(argv = process.argv) {
	const pkg = require('../../package.json')

	program
		.version(pkg.version)
		.option('-c, --config <path>', 'Path to the config file.')
		.option('-r, --range <range>', 'git commit range for changelog', parseRange)
		.option('-d, --date <range>', 'Only include commits after this date, or within a date range', parseRange)
		.option('-s, --slack', 'Automatically post changelog to Slack, if configured')
		.option('--release [release]', 'Assign a release version to these stories')
		.parse(argv)
}

/**
 * Run the main program.
 */
export async function runProgram(argv = process.argv, cwd = process.cwd()) {
	try {
		commandLineArgs(argv)
		const options = program.opts()

		let gitPath = cwd
		if (program.args.length) {
			gitPath = program.args[0]
		}
		gitPath = path.resolve(gitPath)

		const config = readConfigFile(gitPath)
		config.gitPath = gitPath

		const jira = new Jira(config)
		const source = new SourceControl(config)
		const range = await getRangeObject(config, options)

		if (options.release === true) {
			if (typeof config.jira.generateReleaseVersionName !== 'function') {
				console.log(
					"You need to define the jira.generateReleaseVersionName function in your config, if you're not going to pass the release version name in the command."
				)
				return undefined
			}

			options.release = await config.jira.generateReleaseVersionName(range)
		}

		const commitLogs = await source.getCommitLogs(gitPath, range)
		const changelog = await jira.generate(commitLogs, options.release)
		const tmplData = await generateTemplateData(config, changelog, jira.releaseVersions)
		const changelogMessage = renderTemplate(config, tmplData)
		const decodedMessage = decodeEntity(changelogMessage)

		console.log(decodedMessage)

		if (config.save) {
			const filepath = path.join(cwd, 'changelog')
			if (!fs.existsSync(filepath)) {
				fs.mkdirSync(filepath)
			}

			fs.writeFileSync(path.join(filepath, `changelog-${options.release || Date.now()}.md`), decodedMessage)
		}

		if (options.slack) {
			await postToSlack(config, tmplData, changelogMessage)
		}

		return decodedMessage
	} catch (e) {
		console.error(e.stack || e)
		process.exit(1)
	}
}

/**
 * Post the changelog to Slack.
 * @param {Object} config - Configuration object.
 * @param {Object} data - Changelog data object.
 * @param {String} changelogMessage - Rendered changelog message.
 */
export async function postToSlack(config, data, changelogMessage) {
	const slack = new Slack(config)

	if (!slack.isEnabled() || !config.slack.channel) {
		throw new Error('Error: Slack is not configured.')
	}

	console.log(`\nPosting changelog message to slack channel: ${config.slack.channel}...`)

	try {
		if (typeof config.transformForSlack == 'function') {
			changelogMessage = await Promise.resolve(config.transformForSlack(changelogMessage, data))
		}

		await slack.postMessage(changelogMessage, config.slack.channel)
		console.log('Sent')
	} catch (err) {
		throw err instanceof Error ? err : new Error(err)
	}
}

/**
 * Convert a range string formatted as "a...b" or "a..b" into an object.
 * @param {String} rangeStr - The range string.
 * @return {Object}
 */
export function parseRange(rangeStr) {
	let parts = []
	let symmetric = false
	let rangeError = false

	if (!rangeStr || typeof rangeStr !== 'string') {
		throw new Error('Invalid Range')
	}

	if (rangeStr.includes('...')) {
		if (rangeStr.length <= 3) {
			rangeError = true
		}
		symmetric = true
		parts = rangeStr.split('...')
	} else if (rangeStr.includes('..')) {
		if (rangeStr.length <= 2) {
			rangeError = true
		}
		parts = rangeStr.split('..')
	} else if (rangeStr.length > 0) {
		return rangeStr
	}

	if (!parts.length || rangeError || !parts[0]) {
		throw new Error('Invalid Range')
	}

	return { symmetric, from: parts[0], to: parts[1] || '' }
}

/**
 * Construct the range object from CLI arguments and config.
 * @param {Object} config - Config object.
 * @param {Object} options - Parsed command line options.
 * @return {Promise<Object>}
 */
export async function getRangeObject(config, options) {
	const range = {}
	const defaultRange = config.sourceControl && config.sourceControl.defaultRange ? config.sourceControl.defaultRange : {}
	const dateRange = options.dateRange || options.date

	if (typeof options.range === 'string') {
		return options.range
	}

	if (options.range && options.range.from) {
		Object.assign(range, options.range)
	}

	if (typeof dateRange === 'string') {
		range.after = dateRange
	} else if (dateRange && dateRange.from) {
		range.after = dateRange.from
		if (dateRange.to) {
			range.before = dateRange.to
		}
	}

	if (!Object.keys(range).length && Object.keys(defaultRange).length) {
		Object.assign(range, defaultRange)
	}

	if (Object.keys(range).length < 2) {
		const workspace = git(config.gitPath)
		const { all: allTags } = await workspace.tags()

		if (Object.keys(range).length === 1) {
			const rangeFromTagIndex = range.from ? allTags.findIndex((item) => item === range.from) : null
			const rangeToTagIndex = range.to ? allTags.findIndex((item) => item === range.to) : null

			if (range.from && rangeFromTagIndex + 1 < allTags.length) {
				range.to = allTags[rangeFromTagIndex + 1]
			}

			if (range.to && rangeToTagIndex - 1 >= 0) {
				range.from = allTags[rangeToTagIndex - 1]
			}
		} else if (allTags.length >= 2) {
			range.from = allTags[allTags.length - 2]
			range.to = allTags[allTags.length - 1]
		}
	}

	if (!Object.keys(range).length) {
		throw new Error('No range defined for the changelog.')
	}

	range.symmetric = !!range.symmetric
	return range
}

if (require.main === module) {
	runProgram()
}
