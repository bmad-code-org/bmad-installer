import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json')

export const packageRoot = dirname(require.resolve('../package.json'))
/** @type {string} */
export const packageName = packageJson.name
/** @type {string} */
export const version = packageJson.version
