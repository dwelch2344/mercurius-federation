'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { parse } = require('graphql')
const { parseFederationLink } = require('../../lib/link')
const buildFederationSchema = require('../../lib/federation')

const link = (args) => parse(`extend schema @link(${args}) type Query { a: String }`)

test('returns null without a federation @link', () => {
  assert.strictEqual(parseFederationLink(parse('type Query { a: String }')), null)
  assert.strictEqual(
    parseFederationLink(link('url: "https://myspecs.dev/custom/v1.0", import: ["@custom"]')),
    null
  )
})

test('parses version, string imports and default namespace', () => {
  const result = parseFederationLink(
    link('url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "FieldSet"]')
  )
  assert.deepStrictEqual(result.version, { major: 2, minor: 3 })
  assert.strictEqual(result.url, 'https://specs.apollo.dev/federation/v2.3')
  assert.strictEqual(result.namespace, 'federation')
  assert.deepStrictEqual([...result.imports], [
    ['@key', '@key'],
    ['@shareable', '@shareable'],
    ['FieldSet', 'FieldSet']
  ])
})

test('parses object imports with aliases and a custom namespace', () => {
  const result = parseFederationLink(
    link('url: "https://specs.apollo.dev/federation/v2.0", as: "fed", import: [{ name: "@key", as: "@primaryKey" }, { name: "@external" }]')
  )
  assert.strictEqual(result.namespace, 'fed')
  assert.deepStrictEqual([...result.imports], [
    ['@key', '@primaryKey'],
    ['@external', '@external']
  ])
})

test('accepts @link on a schema definition and a trailing slash in the url', () => {
  const result = parseFederationLink(
    parse('schema @link(url: "https://specs.apollo.dev/federation/v2.9/") { query: Query } type Query { a: String }')
  )
  assert.deepStrictEqual(result.version, { major: 2, minor: 9 })
})

test('rejects unsupported versions', () => {
  for (const url of [
    'https://specs.apollo.dev/federation/v1.0',
    'https://specs.apollo.dev/federation/v3.0',
    'https://specs.apollo.dev/federation/v2.10',
    'https://specs.apollo.dev/federation/latest'
  ]) {
    assert.throws(
      () => parseFederationLink(link(`url: "${url}"`)),
      { code: 'MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION' },
      url
    )
  }
})

test('rejects imports that do not exist in the linked version', () => {
  assert.throws(
    () => parseFederationLink(link('url: "https://specs.apollo.dev/federation/v2.0", import: ["@interfaceObject"]')),
    { code: 'MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT' }
  )
  assert.throws(
    () => parseFederationLink(link('url: "https://specs.apollo.dev/federation/v2.3", import: ["@nope"]')),
    { code: 'MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT' }
  )
  assert.throws(
    () => parseFederationLink(link('url: "https://specs.apollo.dev/federation/v2.3", import: [{ name: "@key", as: "key" }]')),
    { code: 'MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT' }
  )
  assert.throws(
    () => parseFederationLink(link('url: "https://specs.apollo.dev/federation/v2.3", import: [{ as: "@key" }]')),
    { code: 'MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT' }
  )
  assert.throws(
    () => parseFederationLink(link('url: "https://specs.apollo.dev/federation/v2.3", import: "@key"')),
    { code: 'MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT' }
  )
})

test('rejects multiple federation links', () => {
  assert.throws(
    () => parseFederationLink(parse(`
      extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")
      extend schema @link(url: "https://specs.apollo.dev/federation/v2.0")
      type Query { a: String }
    `)),
    { code: 'MER_ERR_GQL_FEDERATION_MULTIPLE_LINKS' }
  )
})

test('non-imported directives are available under the federation__ prefix', () => {
  const schema = buildFederationSchema(`
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
    type Query { me: User }
    type User @key(fields: "id") {
      id: ID!
      name: String @federation__shareable
      secret: String @federation__inaccessible
    }
  `)
  assert.ok(schema.getDirective('key'))
  assert.ok(schema.getDirective('federation__shareable'))
  assert.ok(schema.getDirective('federation__inaccessible'))
  assert.strictEqual(schema.getDirective('shareable'), undefined)
  assert.ok(schema.getType('federation__FieldSet'))
  assert.strictEqual(schema.getType('FieldSet'), undefined)
  assert.strictEqual(schema.getType('_FieldSet'), undefined)
})

test('custom namespace is applied to non-imported elements', () => {
  const schema = buildFederationSchema(`
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", as: "fed", import: ["@key"])
    type Query { me: User }
    type User @key(fields: "id") { id: ID! name: String @fed__shareable }
  `)
  assert.ok(schema.getDirective('fed__shareable'))
  assert.ok(schema.getType('fed__FieldSet'))
  assert.strictEqual(schema.getDirective('federation__shareable'), undefined)
})

test('a non-federation @link alone keeps the federation 1 behaviour', () => {
  const schema = buildFederationSchema(`
    extend schema @link(url: "https://myspecs.dev/custom/v1.0", import: ["@custom"])
    directive @link(url: String!, import: [String]) repeatable on SCHEMA
    directive @custom on OBJECT
    type Query { me: User }
    type User @custom @key(fields: "id") { id: ID! }
  `)
  assert.ok(schema.getType('_FieldSet'), 'federation 1 scalar is present')
  assert.strictEqual(schema.getDirective('shareable'), undefined)
  assert.strictEqual(schema.getDirective('federation__shareable'), undefined)
})

test('the link spec and _Any are always injected, user definitions win over injected ones', () => {
  const schema = buildFederationSchema(`
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])
    directive @shareable on FIELD_DEFINITION
    scalar _Any
    type Query { me: User }
    type User @key(fields: "id") { id: ID! name: String @shareable }
  `)
  assert.ok(schema.getDirective('link').isRepeatable)
  assert.ok(schema.getType('link__Import'))
  assert.ok(schema.getType('link__Purpose'))
  assert.ok(schema.getType('_Any'))
  assert.deepStrictEqual(schema.getDirective('shareable').locations, ['FIELD_DEFINITION'])
  assert.strictEqual(schema.getDirective('shareable').isRepeatable, false)
})

test('index exports parseFederationLink', () => {
  const index = require('../..')
  assert.strictEqual(index.parseFederationLink, parseFederationLink)
})
