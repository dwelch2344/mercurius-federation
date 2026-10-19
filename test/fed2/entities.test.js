'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('../..')
const buildFederationSchema = require('../../lib/federation')

const LINK = 'extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@interfaceObject", "@external", "@requires"])'

function entityTypes (schema) {
  return schema.getType('_Entity').getTypes().map(type => type.name).sort()
}

test('a type with multiple @key directives is an entity resolvable by any key', async t => {
  const app = Fastify()
  t.after(() => app.close())
  const users = [
    { id: '1', email: 'a@example.com', name: 'A' },
    { id: '2', email: 'b@example.com', name: 'B' }
  ]
  app.register(mercuriusFederationPlugin, {
    schema: `
      ${LINK}
      type Query { users: [User] }
      type User @key(fields: "id") @key(fields: "email") {
        id: ID!
        email: String!
        name: String
      }
    `,
    resolvers: {
      Query: { users: () => users },
      User: {
        __resolveReference: ref =>
          users.find(u => (ref.id && u.id === ref.id) || (ref.email && u.email === ref.email))
      }
    }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: 'query ($r: [_Any!]!) { _entities(representations: $r) { ... on User { id email name } } }',
      variables: {
        r: [
          { __typename: 'User', id: '1' },
          { __typename: 'User', email: 'b@example.com' }
        ]
      }
    }
  })

  assert.deepStrictEqual(JSON.parse(res.body), {
    data: { _entities: [users[0], users[1]] }
  })
})

test('composite keys are accepted and passed through to __resolveReference', async t => {
  const app = Fastify()
  t.after(() => app.close())
  const research = [
    { study: { caseNumber: '1234', description: 'Federation Study' }, outcome: null }
  ]
  app.register(mercuriusFederationPlugin, {
    schema: `
      ${LINK}
      type Query { research: [ProductResearch] }
      type ProductResearch @key(fields: "study { caseNumber }") {
        study: CaseStudy!
        outcome: String
      }
      type CaseStudy {
        caseNumber: ID!
        description: String
      }
    `,
    resolvers: {
      Query: { research: () => research },
      ProductResearch: {
        __resolveReference: ref => research.find(r => r.study.caseNumber === ref.study.caseNumber)
      }
    }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: 'query ($r: [_Any!]!) { _entities(representations: $r) { ... on ProductResearch { study { caseNumber description } outcome } } }',
      variables: { r: [{ __typename: 'ProductResearch', study: { caseNumber: '1234' } }] }
    }
  })

  assert.deepStrictEqual(JSON.parse(res.body), { data: { _entities: research } })
})

test('@interfaceObject types join _Entity, interfaces with @key do not', () => {
  const schema = buildFederationSchema(`
    ${LINK}
    type Query { inventory(id: ID!): Inventory }
    interface Inventory @key(fields: "id") {
      id: ID!
    }
    type OpenSourceInventory implements Inventory @key(fields: "id") {
      id: ID!
      products: [String]
    }
    type Media @interfaceObject @key(fields: "id") {
      id: ID!
      title: String
    }
  `)

  assert.deepStrictEqual(entityTypes(schema), ['Media', 'OpenSourceInventory'])
  assert.ok(schema.getDirective('interfaceObject'))
  assert.deepStrictEqual(schema.getDirective('interfaceObject').locations, ['OBJECT'])
})

test('@key(resolvable: false) is accepted and the type stays an entity', () => {
  const schema = buildFederationSchema(`
    ${LINK}
    type Query { a: A }
    type A @key(fields: "id", resolvable: false) { id: ID! }
  `)
  assert.deepStrictEqual(entityTypes(schema), ['A'])
})

test('an aliased @key import is honoured when collecting entities', () => {
  const schema = buildFederationSchema(`
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: [{ name: "@key", as: "@primaryKey" }])
    type Query { a: A }
    type A @primaryKey(fields: "id") { id: ID! }
    type B @federation__key(fields: "id") { id: ID! }
  `)
  // Only the local name of @key marks an entity; @federation__key is not that name
  // when @key is imported under an alias.
  assert.deepStrictEqual(entityTypes(schema), ['A'])
  assert.ok(schema.getDirective('primaryKey').isRepeatable)
})

test('@requires no longer marks a type as an extension in federation 2', () => {
  const schema = buildFederationSchema(`
    ${LINK}
    type Query { a: A }
    type A @key(fields: "id") {
      id: ID!
      b: String @external
      c: String @requires(fields: "b")
    }
  `)
  const type = schema.getType('A')
  assert.strictEqual(type.astNode.kind, 'ObjectTypeDefinition')
  assert.strictEqual(type.extensionASTNodes.length, 0)
})

test('an explicit @extends still marks an extension in federation 2 (gateway mode drops @external fields)', () => {
  const schema = buildFederationSchema(`
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", { name: "@extends", as: "@ext" }, { name: "@external", as: "@notMine" }])
    type Query { a: A }
    type A @ext @key(fields: "id") {
      id: ID! @notMine
      c: String
    }
  `, { isGateway: true })
  const type = schema.getType('A')
  assert.strictEqual(type.extensionASTNodes.length, 1)
  assert.deepStrictEqual(Object.keys(type.getFields()), ['c'])
})
