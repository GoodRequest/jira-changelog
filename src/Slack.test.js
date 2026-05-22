import fetch from 'node-fetch'
import Slack from './Slack'
import { getDefaultConfig } from './Config'

jest.mock('node-fetch', () => jest.fn())

function mockSlackResponse(body) {
	return Promise.resolve({
		json: () => Promise.resolve(body)
	})
}

function newConfig(slack = {}) {
	const config = getDefaultConfig()
	config.slack = {
		apiKey: 'xoxb-token',
		channel: 'C123',
		username: 'Changelog Bot',
		icon_emoji: ':clipboard:',
		icon_url: undefined,
		...slack
	}
	return config
}

function parseForm(body) {
	return Object.fromEntries(new URLSearchParams(body).entries())
}

beforeEach(() => {
	fetch.mockReset()
})

describe('Slack API requests', () => {
	test('posts messages as URL-encoded Slack API requests without form-urlencoded dependency', async () => {
		const slack = new Slack(newConfig())
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: true, ts: '123.456' }))

		await slack.postMessage('Hello changelog', 'C123')

		expect(fetch).toHaveBeenCalledWith(
			'https://slack.com/api/chat.postMessage',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					Authorization: 'Bearer xoxb-token',
					'Content-Type': 'application/x-www-form-urlencoded'
				})
			})
		)
		expect(parseForm(fetch.mock.calls[0][1].body)).toEqual({
			text: 'Hello changelog',
			channel: 'C123',
			parse: 'full',
			username: 'Changelog Bot',
			icon_emoji: ':clipboard:'
		})
	})

	test('omits empty optional Slack fields from POST bodies', async () => {
		const slack = new Slack(newConfig({ username: '', icon_emoji: '', icon_url: undefined }))
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: true }))

		await slack.postMessage('Hello', 'C123')

		expect(parseForm(fetch.mock.calls[0][1].body)).toEqual({
			text: 'Hello',
			channel: 'C123',
			parse: 'full'
		})
	})

	test('adds GET parameters to the query string and caches successful GET responses', async () => {
		const slack = new Slack(newConfig())
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: true, members: [] }))

		const first = await slack.api('users.list', 'GET', { limit: 25, cursor: '' })
		const second = await slack.api('users.list', 'GET', { limit: 25, cursor: '' })

		expect(first).toBe(second)
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(fetch.mock.calls[0][0]).toBe('https://slack.com/api/users.list?limit=25')
		expect(fetch.mock.calls[0][1]).toEqual({
			method: 'GET',
			body: undefined,
			headers: { Authorization: 'Bearer xoxb-token' }
		})
	})

	test('does not cache unsuccessful GET responses', async () => {
		const slack = new Slack(newConfig())
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: false, error: 'ratelimited' }))
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: true, members: [] }))

		await slack.api('users.info', 'GET', { user: 'U123' })
		await slack.api('users.info', 'GET', { user: 'U123' })

		expect(fetch).toHaveBeenCalledTimes(2)
	})

	test('shares an in-flight GET request for identical URLs', async () => {
		const slack = new Slack(newConfig())
		let resolveResponse
		const responsePromise = new Promise((resolve) => {
			resolveResponse = resolve
		})
		fetch.mockReturnValueOnce(responsePromise)

		const first = slack.api('users.lookupByEmail', 'GET', { email: 'user@example.com' })
		const second = slack.api('users.lookupByEmail', 'GET', { email: 'user@example.com' })
		resolveResponse({ json: () => Promise.resolve({ ok: true, user: { id: 'U123' } }) })

		await expect(first).resolves.toEqual({ ok: true, user: { id: 'U123' } })
		await expect(second).resolves.toEqual({ ok: true, user: { id: 'U123' } })
		expect(fetch).toHaveBeenCalledTimes(1)
	})
})

describe('Slack posting behavior', () => {
	test('resolves without calling Slack when Slack integration is disabled', async () => {
		const config = newConfig({ apiKey: undefined })
		const slack = new Slack(config)

		await expect(slack.postMessage('Hello', 'C123')).resolves.toEqual({})
		expect(fetch).not.toHaveBeenCalled()
	})

	test('rejects empty messages before attempting to call Slack', async () => {
		const slack = new Slack(newConfig())

		await expect(slack.postMessage('', 'C123')).rejects.toBe('No text to send to slack.')
		expect(fetch).not.toHaveBeenCalled()
	})

	test('throws Slack API errors returned by chat.postMessage', async () => {
		const slack = new Slack(newConfig())
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: false, error: 'channel_not_found' }))

		await expect(slack.postMessage('Hello', 'missing-channel')).rejects.toBe('channel_not_found')
	})

	test('posts long messages in sequential chunks', async () => {
		const slack = new Slack(newConfig())
		const longMessage = `${'a'.repeat(3990)}\n${'b'.repeat(120)}`
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: true, ts: '1' }))
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: true, ts: '2' }))

		await slack.postMessage(longMessage, 'C123')

		expect(fetch).toHaveBeenCalledTimes(2)
		expect(parseForm(fetch.mock.calls[0][1].body).text.length).toBeLessThanOrEqual(4000)
		expect(parseForm(fetch.mock.calls[1][1].body).text.length).toBeLessThanOrEqual(4000)
	})

	test('keeps backwards-compatible post alias', async () => {
		const slack = new Slack(newConfig({ channel: 'C999' }))
		fetch.mockResolvedValueOnce(await mockSlackResponse({ ok: true }))

		await slack.post('Alias message')

		expect(parseForm(fetch.mock.calls[0][1].body).channel).toBe('C999')
	})
})
