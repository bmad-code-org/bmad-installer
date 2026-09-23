import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { packageRoot } from './version.js'

const PLACEHOLDER = /\{(\w+)\}/g

export class MessagesError extends Error {}

/**
 * @param {string} [filePath]
 * @returns {Promise<Record<string, any>>}
 */
export async function loadMessages(filePath = join(packageRoot, 'messages.yaml')) {
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new MessagesError(`cannot read ${filePath}: ${errorText(err)}`)
  }

  let data
  try {
    data = parse(text)
  } catch (err) {
    throw new MessagesError(`invalid YAML in ${filePath}: ${errorText(err)}`)
  }

  if (!isRecord(data)) throw new MessagesError(`${filePath} must hold a mapping of keys`)
  return data
}

/**
 * @param {string} template
 * @param {Record<string, string | number>} [values]
 * @returns {string}
 */
export function render(template, values = {}) {
  return template.replace(PLACEHOLDER, (match, key) => {
    const value = values[key]
    if (value === undefined || value === null) throw new MessagesError(`no value for ${match}`)
    return String(value)
  })
}

/**
 * @param {Record<string, any>} messages
 * @param {string} key
 * @param {Record<string, string | number>} [values]
 * @returns {string}
 */
export function message(messages, key, values) {
  const found = lookup(messages, key)
  if (typeof found !== 'string') throw new MessagesError(`unknown message key: ${key}`)
  return render(found, values)
}

/**
 * @param {Record<string, any>} messages
 * @param {string} key
 * @returns {unknown}
 */
function lookup(messages, key) {
  /** @type {unknown} */
  let current = messages
  for (const part of key.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param {unknown} err */
function errorText(err) {
  return err instanceof Error ? err.message : String(err)
}
