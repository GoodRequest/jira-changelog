import fetch from 'node-fetch'
import { URLSearchParams } from 'url'

const API_ROOT = 'https://slack.com/api'
const MSG_SIZE_LIMIT = 4000

const cache = {}
const pending = {}

function compactObject(obj = {}) {
	return Object.entries(obj).reduce((out, [key, value]) => {
		if (typeof value !== 'undefined' && value !== null && value !== '') {
			out[key] = value
		}

		return out
	}, {})
}

function encodeForm(body = {}) {
	return new URLSearchParams(compactObject(body)).toString()
}

/**
 * Manages Slack integration.
 */
export default class Slack {
	constructor(config) {
		this.config = config
		this.slackUsers = false
	}

	/**
	 * Is Slack integration enabled?
	 */
	isEnabled() {
		return Boolean(this.config.slack && this.config.slack.apiKey)
	}

	/**
	 * Make a Slack API call.
	 *
	 * @param {String} endpoint - Slack API endpoint name, for example chat.postMessage.
	 * @param {String} method - HTTP method.
	 * @param {Object} body - Request body or query values.
	 * @return {Promise<Object>}
	 */
	api(endpoint, method = 'GET', body = undefined) {
		if (!this.isEnabled()) {
			return Promise.reject('The slack API is not configured.')
		}

		const methodName = method.toUpperCase()
		const cachable = methodName === 'GET'
		const headers = {
			Authorization: `Bearer ${this.config.slack.apiKey}`
		}
		let url = `${API_ROOT}/${endpoint}`
		let requestBody

		if (body && typeof body === 'object') {
			const encoded = encodeForm(body)

			if (methodName === 'GET' && encoded) {
				url = `${url}?${encoded}`
			} else if (encoded) {
				requestBody = encoded
				headers['Content-Type'] = 'application/x-www-form-urlencoded'
			}
		}

		const cacheKey = `${methodName}:${url}`

		if (cachable && cache[cacheKey]) {
			return Promise.resolve(cache[cacheKey])
		}

		if (cachable && pending[cacheKey]) {
			return pending[cacheKey]
		}

		const request = fetch(url, {
			method: methodName,
			body: requestBody,
			headers
		})
			.then((res) => res.json())
			.then((data) => {
				if (cachable && data && data.ok) {
					cache[cacheKey] = data
				}

				return data
			})

		if (!cachable) {
			return request
		}

		pending[cacheKey] = request.finally(() => {
			delete pending[cacheKey]
		})

		return pending[cacheKey]
	}

	/**
	 * Post a message to a Slack channel.
	 * If the message is longer than Slack's limit, it is split into multiple messages.
	 *
	 * @param {String} text - Message to send.
	 * @param {String} channel - Slack channel ID or name.
	 * @return {Promise<Object>}
	 */
	postMessage(text, channel) {
		if (!text || !text.length) {
			return Promise.reject('No text to send to slack.')
		}

		if (!this.isEnabled()) {
			return Promise.resolve({})
		}

		const chunks = this.splitUpMessage(text)

		return chunks.reduce((promise, chunk) => {
			return promise.then(() =>
				this.api('chat.postMessage', 'POST', {
					text: chunk,
					channel,
					parse: 'full',
					username: this.config.slack.username,
					icon_emoji: this.config.slack.icon_emoji,
					icon_url: this.config.slack.icon_url
				}).then((response) => {
					if (response && !response.ok) {
						throw response.error
					}

					return response
				})
			)
		}, Promise.resolve())
	}

	/**
	 * Backwards-compatible convenience alias.
	 */
	post(text, channel = this.config?.slack?.channel) {
		return this.postMessage(text, channel)
	}

	/**
	 * Cut a message into chunks that fit Slack's message length limit.
	 * The text is divided on newlines when possible.
	 *
	 * @param {String} text - Message text.
	 * @return {Array<String>}
	 */
	splitUpMessage(text) {
		if (text.length <= MSG_SIZE_LIMIT) {
			return [text]
		}

		const lines = text.split('\n')
		const messages = []
		const continuation = '...'
		const limit = MSG_SIZE_LIMIT - continuation.length
		let block = ''

		lines.forEach((line) => {
			const tmpBlock = `${block}${line}\n`

			if (tmpBlock.length <= MSG_SIZE_LIMIT) {
				block = tmpBlock
			} else if (block.length) {
				messages.push(block)
				block = line
			} else {
				while (line.length > 0) {
					let last = line.substr(0, limit).trim()
					line = line.substr(limit).trim()

					if (line.length) {
						last += continuation
						line = `${continuation}${line}`
					}

					messages.push(last)
				}
			}
		})

		if (block) {
			messages.push(block)
		}

		return messages
	}
}
