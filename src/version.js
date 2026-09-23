import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const packageJsonPath = require.resolve('../package.json')

export const packageRoot = dirname(packageJsonPath)
export const version = require('../package.json').version
