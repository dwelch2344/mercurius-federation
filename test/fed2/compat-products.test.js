'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Fastify = require('fastify')
const { GraphQLError } = require('graphql')
const { mercuriusFederationPlugin } = require('../..')

// Schema and data from the Apollo Federation subgraph compatibility suite
// (products subgraph, federation v2.3).
const sdl = readFileSync(join(__dirname, 'fixtures', 'products.graphql'), 'utf8')

const dimension = { size: 'small', weight: 1, unit: 'kg' }
const user = {
  email: 'support@apollographql.com',
  name: 'Jane Smith',
  totalProductsCreated: 1337,
  yearsOfEmployment: 10
}
const deprecatedProduct = {
  sku: 'apollo-federation-v1',
  package: '@apollo/federation-v1',
  reason: 'Migrate to Federation V2',
  createdBy: user
}
const productsResearch = [
  { study: { caseNumber: '1234', description: 'Federation Study' }, outcome: null },
  { study: { caseNumber: '1235', description: 'Studio Study' }, outcome: null }
]
const products = [
  {
    id: 'apollo-federation',
    sku: 'federation',
    package: '@apollo/federation',
    variation: { id: 'OSS' },
    dimensions: dimension,
    research: [productsResearch[0]],
    createdBy: user,
    notes: null
  },
  {
    id: 'apollo-studio',
    sku: 'studio',
    package: '',
    variation: { id: 'platform' },
    dimensions: dimension,
    research: [productsResearch[1]],
    createdBy: user,
    notes: null
  }
]
const inventory = { id: 'apollo-oss', deprecatedProducts: [deprecatedProduct] }

const resolvers = {
  Query: {
    product: (_, { id }) => products.find(p => p.id === id),
    deprecatedProduct: (_, { sku, package: pkg }) =>
      sku === deprecatedProduct.sku && pkg === deprecatedProduct.package ? deprecatedProduct : null
  },
  Product: {
    __resolveReference: ref => {
      if (ref.id) return products.find(p => p.id === ref.id)
      if (ref.sku && ref.package !== undefined) return products.find(p => p.sku === ref.sku && p.package === ref.package)
      if (ref.sku && ref.variation) return products.find(p => p.sku === ref.sku && p.variation.id === ref.variation.id)
      return null
    }
  },
  DeprecatedProduct: {
    __resolveReference: ref =>
      ref.sku === deprecatedProduct.sku && ref.package === deprecatedProduct.package ? deprecatedProduct : null
  },
  ProductResearch: {
    __resolveReference: ref => productsResearch.find(r => r.study.caseNumber === ref.study.caseNumber)
  },
  User: {
    __resolveReference: ref => (ref.email ? { ...user, ...ref } : null),
    averageProductsCreatedPerYear: u => {
      if (u.email !== user.email) {
        throw new GraphQLError("user.email was not 'support@apollographql.com'")
      }
      return u.totalProductsCreated ? Math.round(u.totalProductsCreated / u.yearsOfEmployment) : null
    }
  },
  Inventory: {
    __resolveReference: ref => (ref.id === inventory.id ? inventory : null)
  }
}

async function createApp (t) {
  const app = Fastify()
  t.after(() => app.close())
  app.register(mercuriusFederationPlugin, { schema: sdl, resolvers })
  await app.ready()
  return app
}

async function query (app, body) {
  const res = await app.inject({ method: 'POST', url: '/graphql', body })
  return JSON.parse(res.body)
}

test('the products subgraph builds and serves its SDL', async t => {
  const app = await createApp(t)
  const result = await query(app, { query: '{ _service { sdl } }' })
  assert.deepStrictEqual(result, { data: { _service: { sdl } } })

  const schema = app.graphql.schema
  assert.deepStrictEqual(
    schema.getType('_Entity').getTypes().map(type => type.name).sort(),
    ['DeprecatedProduct', 'Inventory', 'Product', 'ProductResearch', 'User']
  )
  assert.ok(schema.getDirective('custom'))
})

test('Product is resolvable by each of its three keys', async t => {
  const app = await createApp(t)
  const result = await query(app, {
    query: `query ($r: [_Any!]!) {
      _entities(representations: $r) {
        ... on Product { id sku package variation { id } dimensions { size weight unit } notes research { study { caseNumber } } }
      }
    }`,
    variables: {
      r: [
        { __typename: 'Product', id: 'apollo-federation' },
        { __typename: 'Product', sku: 'studio', package: '' },
        { __typename: 'Product', sku: 'federation', variation: { id: 'OSS' } }
      ]
    }
  })

  const expected = ({ id, sku, package: pkg, variation, dimensions, notes, research }) => ({
    id, sku, package: pkg, variation, dimensions, notes, research: research.map(r => ({ study: { caseNumber: r.study.caseNumber } }))
  })
  assert.deepStrictEqual(result, {
    data: { _entities: [expected(products[0]), expected(products[1]), expected(products[0])] }
  })
})

test('entities with composite keys, @interfaceObject and @requires resolve', async t => {
  const app = await createApp(t)
  const result = await query(app, {
    query: `query ($r: [_Any!]!) {
      _entities(representations: $r) {
        ... on ProductResearch { study { caseNumber description } outcome }
        ... on Inventory { id deprecatedProducts { sku package reason } }
        ... on User { email name averageProductsCreatedPerYear }
        ... on DeprecatedProduct { sku package reason createdBy { email } }
      }
    }`,
    variables: {
      r: [
        { __typename: 'ProductResearch', study: { caseNumber: '1235' } },
        { __typename: 'Inventory', id: 'apollo-oss' },
        { __typename: 'User', email: user.email, totalProductsCreated: 1337, yearsOfEmployment: 10 },
        { __typename: 'DeprecatedProduct', sku: deprecatedProduct.sku, package: deprecatedProduct.package }
      ]
    }
  })

  assert.deepStrictEqual(result, {
    data: {
      _entities: [
        productsResearch[1],
        { id: 'apollo-oss', deprecatedProducts: [{ sku: deprecatedProduct.sku, package: deprecatedProduct.package, reason: deprecatedProduct.reason }] },
        { email: user.email, name: user.name, averageProductsCreatedPerYear: 134 },
        { sku: deprecatedProduct.sku, package: deprecatedProduct.package, reason: deprecatedProduct.reason, createdBy: { email: user.email } }
      ]
    }
  })
})

test('root queries work, deprecated field carries its reason', async t => {
  const app = await createApp(t)
  const result = await query(app, {
    query: `{
      product(id: "apollo-studio") { id sku createdBy { email totalProductsCreated } }
      deprecatedProduct(sku: "apollo-federation-v1", package: "@apollo/federation-v1") { reason }
      __type(name: "Query") { fields(includeDeprecated: true) { name deprecationReason } }
    }`
  })
  assert.deepStrictEqual(result.data.product, { id: 'apollo-studio', sku: 'studio', createdBy: { email: user.email, totalProductsCreated: 1337 } })
  assert.deepStrictEqual(result.data.deprecatedProduct, { reason: 'Migrate to Federation V2' })
  const deprecated = result.data.__type.fields.find(f => f.name === 'deprecatedProduct')
  assert.strictEqual(deprecated.deprecationReason, 'Use product query instead')
})
