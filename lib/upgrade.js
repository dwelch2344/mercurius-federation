'use strict'

const { Kind, parse, print, visit } = require('graphql')
const { parseFederationLink } = require('./link')

const FEDERATION_SPEC = 'https://specs.apollo.dev/federation/v'
const ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription'])
// Federation directives that are imported when used (besides @key, always imported).
const IMPORTABLE_DIRECTIVES = new Set([
  'external', 'requires', 'provides', 'shareable', 'extends', 'tag',
  'inaccessible', 'override', 'interfaceObject', 'composeDirective'
])

function hasDirective (node, name) {
  return (node.directives || []).some(d => d.name.value === name)
}

function withoutDirective (node, name) {
  return { ...node, directives: (node.directives || []).filter(d => d.name.value !== name) }
}

function withDirective (node, name) {
  if (hasDirective(node, name)) return node
  return {
    ...node,
    directives: [
      ...(node.directives || []),
      { kind: Kind.DIRECTIVE, name: { kind: Kind.NAME, value: name }, arguments: [] }
    ]
  }
}

function usedDirectiveNames (document) {
  const names = new Set()
  visit(document, {
    Directive (node) {
      if (IMPORTABLE_DIRECTIVES.has(node.name.value)) names.add(node.name.value)
    }
  })
  return names
}

function linkExtension (document, version) {
  const imports = ['@key', ...[...usedDirectiveNames(document)].map(name => `@${name}`)]
  const values = [...new Set(imports)].sort().map(value => ({ kind: Kind.STRING, value }))
  return {
    kind: Kind.SCHEMA_EXTENSION,
    directives: [
      {
        kind: Kind.DIRECTIVE,
        name: { kind: Kind.NAME, value: 'link' },
        arguments: [
          {
            kind: Kind.ARGUMENT,
            name: { kind: Kind.NAME, value: 'url' },
            value: { kind: Kind.STRING, value: `${FEDERATION_SPEC}${version}` }
          },
          {
            kind: Kind.ARGUMENT,
            name: { kind: Kind.NAME, value: 'import' },
            value: { kind: Kind.LIST, values }
          }
        ]
      }
    ],
    operationTypes: []
  }
}

function keyFieldNames (node) {
  const names = new Set()
  for (const directive of node.directives || []) {
    if (directive.name.value !== 'key') continue
    const fields = (directive.arguments || []).find(a => a.name.value === 'fields')
    if (!fields || fields.value.kind !== Kind.STRING) continue
    const selectionSet = parse(`{ ${fields.value.value} }`).definitions[0].selectionSet
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) names.add(selection.name.value)
    }
  }
  return names
}

/**
 * Federation 1 extensions (`extend type X @key` / `type X @extends @key`) are
 * plain definitions in Federation 2. Root type extensions are left alone.
 */
function convertExtensions (document) {
  return {
    ...document,
    definitions: document.definitions.map(definition => {
      if (definition.kind === Kind.OBJECT_TYPE_EXTENSION || definition.kind === Kind.INTERFACE_TYPE_EXTENSION) {
        if (ROOT_TYPES.has(definition.name.value)) return definition
        return {
          ...withoutDirective(definition, 'extends'),
          kind: definition.kind === Kind.OBJECT_TYPE_EXTENSION ? Kind.OBJECT_TYPE_DEFINITION : Kind.INTERFACE_TYPE_DEFINITION
        }
      }
      if ((definition.kind === Kind.OBJECT_TYPE_DEFINITION || definition.kind === Kind.INTERFACE_TYPE_DEFINITION) && hasDirective(definition, 'extends')) {
        return withoutDirective(definition, 'extends')
      }
      return definition
    })
  }
}

function isUpgradable (document) {
  return parseFederationLink(document) === null
}

function upgradeDocument (document, version) {
  const converted = convertExtensions(document)
  return {
    ...converted,
    definitions: [linkExtension(converted, version), ...converted.definitions]
  }
}

/**
 * Upgrade a single Federation 1 subgraph SDL to Federation 2. SDLs that
 * already `@link` the federation specification are returned unchanged.
 */
function upgradeSubgraphSdl (sdl, { version = '2.3' } = {}) {
  const document = parse(sdl)
  if (!isUpgradable(document)) return sdl
  return print(upgradeDocument(document, version))
}

/**
 * Upgrade a set of Federation 1 subgraph SDLs together. Beyond the single-SDL
 * conversion, fields Federation 1 implicitly allowed in several subgraphs are
 * marked `@shareable`: value types (object types without @key) defined in
 * more than one subgraph, and non-external, non-key fields of entities
 * defined in more than one subgraph.
 */
function upgradeSubgraphSdls (sdls, { version = '2.3' } = {}) {
  const documents = {}
  const results = {}
  for (const [name, sdl] of Object.entries(sdls)) {
    const document = parse(sdl)
    if (isUpgradable(document)) {
      documents[name] = convertExtensions(document)
    } else {
      results[name] = sdl
    }
  }

  // name → { subgraphs: Set, entity: boolean, fields: Map<field, Set<subgraph>> }
  const types = new Map()
  for (const [name, document] of Object.entries(documents)) {
    for (const definition of document.definitions) {
      if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION || ROOT_TYPES.has(definition.name.value)) continue
      const typeName = definition.name.value
      const entry = types.get(typeName) || { subgraphs: new Set(), entity: false, fields: new Map() }
      entry.subgraphs.add(name)
      if (hasDirective(definition, 'key')) entry.entity = true
      for (const field of definition.fields || []) {
        if (hasDirective(field, 'external')) continue
        const owners = entry.fields.get(field.name.value) || new Set()
        owners.add(name)
        entry.fields.set(field.name.value, owners)
      }
      types.set(typeName, entry)
    }
  }

  for (const [name, document] of Object.entries(documents)) {
    const marked = {
      ...document,
      definitions: document.definitions.map(definition => {
        if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION || ROOT_TYPES.has(definition.name.value)) return definition
        const entry = types.get(definition.name.value)
        if (entry.subgraphs.size < 2) return definition
        if (!entry.entity) return withDirective(definition, 'shareable')
        const keys = keyFieldNames(definition)
        return {
          ...definition,
          fields: (definition.fields || []).map(field => {
            if (keys.has(field.name.value) || hasDirective(field, 'external')) return field
            const owners = entry.fields.get(field.name.value)
            return owners && owners.size > 1 ? withDirective(field, 'shareable') : field
          })
        }
      })
    }
    results[name] = print({ ...marked, definitions: [linkExtension(marked, version), ...marked.definitions] })
  }

  return results
}

module.exports = { upgradeSubgraphSdl, upgradeSubgraphSdls }
