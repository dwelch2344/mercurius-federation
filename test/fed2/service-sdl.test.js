'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const gql = require('graphql-tag')
const { mercuriusFederationPlugin } = require('../..')

const sdl = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])

  type Query {
    me: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String @shareable
  }
`

test('_service { sdl } returns the original SDL including the @link schema extension', async t => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(mercuriusFederationPlugin, { schema: sdl })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ _service { sdl } }' }
  })

  assert.deepStrictEqual(JSON.parse(res.body), { data: { _service: { sdl } } })
})

test('_service { sdl } returns the original SDL for a DocumentNode schema', async t => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(mercuriusFederationPlugin, { schema: gql(sdl) })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ _service { sdl } }' }
  })

  assert.deepStrictEqual(JSON.parse(res.body), { data: { _service: { sdl } } })
})

test('federation 2 subgraph answers a regular query', async t => {
  const app = Fastify()
  t.after(() => app.close())
  app.register(mercuriusFederationPlugin, {
    schema: sdl,
    resolvers: { Query: { me: () => ({ id: '1', name: 'John' }) } }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ me { id name } }' }
  })

  assert.deepStrictEqual(JSON.parse(res.body), { data: { me: { id: '1', name: 'John' } } })
})
