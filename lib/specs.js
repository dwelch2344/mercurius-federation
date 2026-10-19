'use strict'

/**
 * Apollo Federation 2.x specification elements, written from the public
 * subgraph specification. Each entry records the version that introduced
 * (or last changed) the element; `definitionsFor(version)` picks, for each
 * element, the most recent entry whose `since` is not newer than `version`.
 *
 * Names are canonical (`@key`, `FieldSet`). `lib/naming.js` renames them to
 * the names a subgraph actually uses according to its `@link` imports.
 */

const FEDERATION_SPEC_IDENTITY = 'https://specs.apollo.dev/federation'
const LATEST_FEDERATION_VERSION = { major: 2, minor: 9 }

const TAG_LOCATIONS =
  'FIELD_DEFINITION | OBJECT | INTERFACE | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION'
const SCOPED_LOCATIONS = 'FIELD_DEFINITION | OBJECT | INTERFACE | SCALAR | ENUM'

const FEDERATION_SPEC = [
  { name: 'FieldSet', since: [2, 0], sdl: 'scalar FieldSet' },
  { name: '@key', since: [2, 0], sdl: 'directive @key(fields: FieldSet!, resolvable: Boolean = true) repeatable on OBJECT | INTERFACE' },
  { name: '@requires', since: [2, 0], sdl: 'directive @requires(fields: FieldSet!) on FIELD_DEFINITION' },
  { name: '@provides', since: [2, 0], sdl: 'directive @provides(fields: FieldSet!) on FIELD_DEFINITION' },
  { name: '@external', since: [2, 0], sdl: 'directive @external on OBJECT | FIELD_DEFINITION' },
  { name: '@extends', since: [2, 0], sdl: 'directive @extends on OBJECT | INTERFACE' },
  { name: '@shareable', since: [2, 0], sdl: 'directive @shareable on OBJECT | FIELD_DEFINITION' },
  { name: '@shareable', since: [2, 2], sdl: 'directive @shareable repeatable on OBJECT | FIELD_DEFINITION' },
  { name: '@override', since: [2, 0], sdl: 'directive @override(from: String!) on FIELD_DEFINITION' },
  { name: '@override', since: [2, 7], sdl: 'directive @override(from: String!, label: String) on FIELD_DEFINITION' },
  { name: '@inaccessible', since: [2, 0], sdl: `directive @inaccessible on ${TAG_LOCATIONS}` },
  { name: '@tag', since: [2, 0], sdl: `directive @tag(name: String!) repeatable on ${TAG_LOCATIONS}` },
  { name: '@tag', since: [2, 3], sdl: `directive @tag(name: String!) repeatable on ${TAG_LOCATIONS} | SCHEMA` },
  { name: '@composeDirective', since: [2, 1], sdl: 'directive @composeDirective(name: String!) repeatable on SCHEMA' },
  { name: '@interfaceObject', since: [2, 3], sdl: 'directive @interfaceObject on OBJECT' },
  { name: '@authenticated', since: [2, 5], sdl: `directive @authenticated on ${SCOPED_LOCATIONS}` },
  { name: 'Scope', since: [2, 5], sdl: 'scalar Scope' },
  { name: '@requiresScopes', since: [2, 5], sdl: `directive @requiresScopes(scopes: [[Scope!]!]!) on ${SCOPED_LOCATIONS}` },
  { name: 'Policy', since: [2, 6], sdl: 'scalar Policy' },
  { name: '@policy', since: [2, 6], sdl: `directive @policy(policies: [[Policy!]!]!) on ${SCOPED_LOCATIONS}` },
  { name: '@context', since: [2, 8], sdl: 'directive @context(name: String!) repeatable on INTERFACE | OBJECT | UNION' },
  { name: 'ContextFieldValue', since: [2, 8], sdl: 'scalar ContextFieldValue' },
  { name: '@fromContext', since: [2, 8], sdl: 'directive @fromContext(field: ContextFieldValue) on ARGUMENT_DEFINITION' },
  { name: '@cost', since: [2, 9], sdl: 'directive @cost(weight: Int!) on ARGUMENT_DEFINITION | ENUM | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | OBJECT | SCALAR' },
  { name: '@listSize', since: [2, 9], sdl: 'directive @listSize(assumedSize: Int, slicingArguments: [String!], sizedFields: [String!], requireOneSlicingArgument: Boolean = true) on FIELD_DEFINITION' }
]

// The link specification is never namespaced by a federation `@link`.
const LINK_SPEC = `
  directive @link(url: String!, as: String, for: link__Purpose, import: [link__Import]) repeatable on SCHEMA
  scalar link__Import
  enum link__Purpose {
    SECURITY
    EXECUTION
  }
`

function versionCode ({ major, minor }) {
  return major * 1000 + minor
}

function isAvailable (entry, version) {
  return versionCode({ major: entry.since[0], minor: entry.since[1] }) <= versionCode(version)
}

/**
 * The spec elements available at `version`, canonical names, one entry per
 * element (the newest definition not after `version`).
 */
function definitionsFor (version) {
  const byName = new Map()
  for (const entry of FEDERATION_SPEC) {
    if (isAvailable(entry, version)) {
      byName.set(entry.name, entry)
    }
  }
  return [...byName.values()]
}

function importableNames (version) {
  return new Set(definitionsFor(version).map(entry => entry.name))
}

module.exports = {
  FEDERATION_SPEC_IDENTITY,
  LATEST_FEDERATION_VERSION,
  FEDERATION_SPEC,
  LINK_SPEC,
  definitionsFor,
  importableNames,
  versionCode
}
