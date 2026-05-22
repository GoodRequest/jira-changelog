/**
 * Manages command configuration files.
 *
 * If changelog.config.js exists in the directory where the script is run,
 * its values are merged over the defaults exported by the package.
 */
import fs from 'fs'
import path from 'path'
import { program } from 'commander'

import defaultConfig from '../changelog.config.js'

export const CONF_FILENAME = 'changelog.config.js'

function isPlainObject(value) {
	return Object.prototype.toString.call(value) === '[object Object]'
}

function cloneConfigValue(value) {
	if (Array.isArray(value)) {
		return value.map(cloneConfigValue)
	}

	if (value instanceof RegExp) {
		return new RegExp(value.source, value.flags)
	}

	if (isPlainObject(value)) {
		return Object.entries(value).reduce((out, [key, val]) => {
			out[key] = cloneConfigValue(val)
			return out
		}, {})
	}

	return value
}

/**
 * Return the default config object.
 * @return {Object}
 */
export function getDefaultConfig() {
	return cloneConfigValue(defaultConfig)
}

/**
 * Return the path to the config file.
 * @param {String} cwd - The current directory.
 * @return {String}
 */
export function configFilePath(cwd) {
	if (program.config) {
		return path.resolve(program.config)
	}

	return path.join(cwd, CONF_FILENAME)
}

/**
 * Read the config file, merge it with default values, and return the object.
 * @param {String} cwd - The current directory.
 * @return {Object} Configuration object.
 */
export function readConfigFile(cwd) {
	let localConf = {}
	const configPath = configFilePath(cwd)

	try {
		fs.accessSync(configPath)
		localConf = require(configPath)
	} catch (e) {
		if (e instanceof SyntaxError) {
			console.log('Error reading changelog.config.js:')
			console.log(e.stack)
			console.log(e.message)
		}
	}

	return defaultValues(localConf, defaultConfig)
}

/**
 * Recursively add default values into a config object without overwriting
 * explicitly supplied values.
 *
 * @param {Object} config - The config object to merge with defaults.
 * @param {Object} defaults - The default config object.
 * @return {Object}
 */
export function defaultValues(config, defaults) {
	const localConf = { ...config }

	Object.entries(defaults).forEach(([key, defVal]) => {
		const localVal = localConf[key]

		if (isPlainObject(defVal)) {
			localConf[key] = defaultValues(isPlainObject(localVal) ? localVal : {}, defVal)
		} else if (typeof localVal === 'undefined') {
			localConf[key] = defVal
		}
	})

	return localConf
}
