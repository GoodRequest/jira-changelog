import { parseRange } from './cli'

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
