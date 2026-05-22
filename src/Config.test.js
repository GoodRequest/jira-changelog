import * as Config from './Config'
import { program } from 'commander'

afterEach(() => {
	delete program.config
})

describe('Config file path', () => {
	test('returns config file on current path', () => {
		const configPath = Config.configFilePath('foobar/')

		expect(configPath).toBe('foobar/changelog.config.js')
	})

	test('returns CLI config file path', () => {
		program.config = '/custom/path/bar.config.js'

		const configPath = Config.configFilePath('foobar/')

		expect(configPath).toBe(program.config)
	})
})

describe('Default values', () => {
	test('only adds default values', () => {
		const obj1 = { foo: 'bar' }
		const defaults = {
			foo: 'baz',
			hello: 'world'
		}

		const merged = Config.defaultValues(obj1, defaults)

		expect(merged).toEqual({ foo: 'bar', hello: 'world' })
	})

	test('merges nested objects', () => {
		const obj1 = {
			nested: {
				foo: 'bar'
			}
		}
		const defaults = {
			nested: {
				foo: 'baz',
				hello: 'world'
			}
		}

		const merged = Config.defaultValues(obj1, defaults)

		expect(merged).toEqual({
			nested: { foo: 'bar', hello: 'world' }
		})
	})

	test('does not merge arrays', () => {
		const obj1 = {
			arr1: [2, 4, 6]
		}
		const defaults = {
			arr1: [1, 3, 5],
			arr2: [6, 7, 8]
		}

		const merged = Config.defaultValues(obj1, defaults)

		expect(merged).toEqual({
			arr1: [2, 4, 6],
			arr2: [6, 7, 8]
		})
	})
})
