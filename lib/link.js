'use strict'

const { Kind } = require('graphql')
const {
  FEDERATION_SPEC_IDENTITY,
  LATEST_FEDERATION_VERSION,
  importableNames,
  versionCode
} = require('./specs')
const {
  MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION,
  MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT,
  MER_ERR_GQL_FEDERATION_MULTIPLE_LINKS
} = require('./errors')

const LINK_DIRECTIVE_NAME = 'link'
const DEFAULT_NAMESPACE = 'federation'

function schemaLevelDirectives (document) {
  const directives = []
  for (const definition of document.definitions) {
    if (
      definition.kind === Kind.SCHEMA_DEFINITION ||
      definition.kind === Kind.SCHEMA_EXTENSION
    ) {
      directives.push(...(definition.directives || []))
    }
  }
  return directives
}

function stringArgument (directive, name) {
  const argument = (directive.arguments || []).find(
    arg => arg.name.value === name
  )
  return argument && argument.value.kind === Kind.STRING
    ? argument.value.value
    : undefined
}

function parseVersion (url) {
  const match = /\/v(\d+)\.(\d+)\/?$/.exec(url)
  if (!match) {
    throw new MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION(url)
  }
  const version = { major: Number(match[1]), minor: Number(match[2]) }
  if (
    version.major !== LATEST_FEDERATION_VERSION.major ||
    versionCode(version) > versionCode(LATEST_FEDERATION_VERSION)
  ) {
    throw new MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION(url)
  }
  return version
}

function parseImportEntry (entry) {
  if (entry.kind === Kind.STRING) {
    return { name: entry.value, alias: entry.value }
  }
  if (entry.kind === Kind.OBJECT) {
    const field = fieldName => {
      const found = entry.fields.find(f => f.name.value === fieldName)
      if (!found) {
        return undefined
      }
      if (found.value.kind !== Kind.STRING) {
        throw new MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT(
          `import "${fieldName}" must be a string`
        )
      }
      return found.value.value
    }
    const name = field('name')
    if (!name) {
      throw new MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT(
        'import object is missing "name"'
      )
    }
    const alias = field('as') || name
    if (name.startsWith('@') !== alias.startsWith('@')) {
      throw new MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT(
        `import "${name}" cannot be aliased as "${alias}"`
      )
    }
    return { name, alias }
  }
  throw new MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT(
    'import entries must be strings or { name, as } objects'
  )
}

function parseImports (directive, version) {
  const imports = new Map()
  const importArgument = (directive.arguments || []).find(
    arg => arg.name.value === 'import'
  )
  if (!importArgument) {
    return imports
  }
  if (importArgument.value.kind !== Kind.LIST) {
    throw new MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT('"import" must be a list')
  }
  const importable = importableNames(version)
  for (const entry of importArgument.value.values) {
    const { name, alias } = parseImportEntry(entry)
    if (!importable.has(name)) {
      throw new MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT(
        `"${name}" is not part of federation v${version.major}.${version.minor}`
      )
    }
    imports.set(name, alias)
  }
  return imports
}

/**
 * Finds the `@link` that points at the federation specification.
 * Returns `null` for a document without one (a Federation 1 subgraph).
 */
function parseFederationLink (document) {
  const links = schemaLevelDirectives(document).filter(directive => {
    if (directive.name.value !== LINK_DIRECTIVE_NAME) {
      return false
    }
    const url = stringArgument(directive, 'url')
    return url !== undefined && url.startsWith(`${FEDERATION_SPEC_IDENTITY}/`)
  })

  if (links.length === 0) {
    return null
  }
  if (links.length > 1) {
    throw new MER_ERR_GQL_FEDERATION_MULTIPLE_LINKS()
  }

  const node = links[0]
  const url = stringArgument(node, 'url')
  const version = parseVersion(url)
  const imports = parseImports(node, version)
  const namespace = stringArgument(node, 'as') || DEFAULT_NAMESPACE

  return { url, version, imports, namespace, node }
}

module.exports = {
  parseFederationLink,
  DEFAULT_NAMESPACE
}
