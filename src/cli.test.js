import git from 'simple-git'
import { getRangeObject, parseRange } from './cli'

jest.mock('simple-git', () => jest.fn())

function mockTags(all) {
	const tags = jest.fn(() => Promise.resolve({ all }))
	git.mockReturnValue({ tags })
	return tags
}

describe('cli parseRange', () => {
	test('parses symmetric ranges', () => {
		expect(parseRange('origin/prod...origin/master')).toEqual({
			from: 'origin/prod',
			to: 'origin/master',
			symmetric: true
		})
	})

	test('parses non-symmetric ranges', () => {
		expect(parseRange('origin/prod..origin/master')).toEqual({
			from: 'origin/prod',
			to: 'origin/master',
			symmetric: false
		})
	})

	test('keeps opaque ranges as strings', () => {
		expect(parseRange('HEAD~3')).toBe('HEAD~3')
	})
})

describe('cli getRangeObject', () => {
	beforeEach(() => {
		git.mockReset()
	})

	test('infers the next tag when only an existing from tag is configured', async () => {
		mockTags(['v1.0.0', 'v1.1.0', 'v1.2.0'])

		await expect(getRangeObject({ gitPath: '/repo' }, { range: { from: 'v1.0.0' } })).resolves.toEqual({
			from: 'v1.0.0',
			to: 'v1.1.0',
			symmetric: false
		})
	})

	test('infers the previous tag when only an existing to tag is configured', async () => {
		mockTags(['v1.0.0', 'v1.1.0', 'v1.2.0'])

		await expect(getRangeObject({ gitPath: '/repo' }, { range: { to: 'v1.2.0' } })).resolves.toEqual({
			from: 'v1.1.0',
			to: 'v1.2.0',
			symmetric: false
		})
	})

	test('does not infer a to tag when the supplied from ref is not a known tag', async () => {
		mockTags(['v1.0.0', 'v1.1.0'])

		await expect(getRangeObject({ gitPath: '/repo' }, { range: { from: 'feature-branch' } })).resolves.toEqual({
			from: 'feature-branch',
			symmetric: false
		})
	})

	test('does not infer a from tag when the supplied to ref is not a known tag', async () => {
		mockTags(['v1.0.0', 'v1.1.0'])

		await expect(getRangeObject({ gitPath: '/repo' }, { range: { to: 'main' } })).resolves.toEqual({
			to: 'main',
			symmetric: false
		})
	})

	test('uses the latest two tags when no range is configured', async () => {
		mockTags(['v1.0.0', 'v1.1.0', 'v1.2.0'])

		await expect(getRangeObject({ gitPath: '/repo' }, {})).resolves.toEqual({
			from: 'v1.1.0',
			to: 'v1.2.0',
			symmetric: false
		})
	})
})
