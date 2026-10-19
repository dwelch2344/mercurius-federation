'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Fastify = require('fastify')
const { parse } = require('graphql')
const { upgradeSubgraphSdl, upgradeSubgraphSdls, buildFederationSchema, parseFederationLink, mercuriusFederationPlugin } = require('../..')

const postsV1 = `
  type Post @key(fields: "pid") {
    pid: ID!
    title: String
    author: User @provides(fields: "name")
  }

  extend type User @key(fields: "id") {
    id: ID! @external
    name: String @external
    posts: [Post]
  }

  type PageInfo {
    hasNext: Boolean
  }

  extend type Query {
    topPosts: [Post]
  }
`

const usersV1 = `
  directive @custom on FIELD_DEFINITION

  type Query @extends {
    me: User @custom
  }

  type User @key(fields: "id") {
    id: ID!
    name: String
    username: String
  }

  type PageInfo {
    hasNext: Boolean
  }
`

test('upgradeSubgraphSdl adds the federation @link with the used directives and converts extensions', t => {
  const upgraded = upgradeSubgraphSdl(postsV1)
  assert.match(upgraded, /^extend schema @link\(url: "https:\/\/specs.apollo.dev\/federation\/v2.3", import: \["@external", "@key", "@provides"\]\)/)
  assert.match(upgraded, /\ntype User @key\(fields: "id"\) \{\n {2}id: ID! @external\n {2}name: String @external\n {2}posts: \[Post\]\n\}/)
  assert.match(upgraded, /extend type Query \{\n {2}topPosts: \[Post\]\n\}/, 'root type extensions are preserved')
  assert.doesNotMatch(upgraded, /@extends/)

  const link = parseFederationLink(parse(upgraded))
  assert.deepStrictEqual(link.version, { major: 2, minor: 3 })
  assert.deepStrictEqual([...link.imports.keys()], ['@external', '@key', '@provides'])

  const custom = upgradeSubgraphSdl(usersV1, { version: '2.5' })
  assert.match(custom, /federation\/v2.5", import: \["@key"\]\)/)
  assert.match(custom, /\ntype Query \{\n {2}me: User @custom\n\}/, '@extends on a root type is dropped, the type stays')
  assert.match(custom, /directive @custom on FIELD_DEFINITION/)
})

test('an SDL that already links the federation spec is returned unchanged', t => {
  const sdl = `
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])
    type Query { me: User }
    type User @key(fields: "id") { id: ID! }
  `
  assert.strictEqual(upgradeSubgraphSdl(sdl), sdl)
  assert.deepStrictEqual(upgradeSubgraphSdls({ a: sdl }), { a: sdl })
})

test('upgradeSubgraphSdls marks shared value types and shared entity fields @shareable, not key fields', t => {
  const inventory = `
    extend type Query { inventory: Inventory }
    type Inventory { id: ID! }
    type Product @key(fields: "sku") {
      sku: ID!
      name: String
      stock: Int
    }
    type PageInfo { hasNext: Boolean }
  `
  const catalog = `
    extend type Query { catalog: [Product] }
    type Product @key(fields: "sku") {
      sku: ID!
      name: String
      price: Int
    }
    type PageInfo { hasNext: Boolean }
  `
  const reviews = `
    extend type Product @key(fields: "sku") {
      sku: ID! @external
      name: String @external
      reviews: [String]
    }
  `
  const upgraded = upgradeSubgraphSdls({ inventory, catalog, reviews })
  assert.deepStrictEqual(Object.keys(upgraded), ['inventory', 'catalog', 'reviews'])

  for (const name of ['inventory', 'catalog']) {
    assert.match(upgraded[name], /import: \["@key", "@shareable"\]/)
    assert.match(upgraded[name], /type PageInfo @shareable \{/, `${name}: shared value type`)
    assert.match(upgraded[name], /\n {2}sku: ID!\n/, `${name}: key field untouched`)
    assert.match(upgraded[name], /\n {2}name: String @shareable\n/, `${name}: shared entity field`)
  }
  assert.match(upgraded.inventory, /\n {2}stock: Int\n/)
  assert.match(upgraded.catalog, /\n {2}price: Int\n/)
  assert.match(upgraded.inventory, /type Inventory \{/, 'single-subgraph value type stays as is')
  // the reviews extension becomes a definition; external fields are not shareable, its own field is unique
  assert.match(upgraded.reviews, /import: \["@external", "@key"\]/)
  assert.match(upgraded.reviews, /\ntype Product @key\(fields: "sku"\) \{\n {2}sku: ID! @external\n {2}name: String @external\n {2}reviews: \[String\]\n\}/)
})

test('the upgraded SDL builds a Federation 2 subgraph schema and round-trips through _service', async t => {
  const upgraded = upgradeSubgraphSdls({ posts: postsV1, users: usersV1 })
  for (const sdl of Object.values(upgraded)) {
    const schema = buildFederationSchema(sdl)
    assert.ok(schema.getDirective('link'))
    assert.ok(schema.getType('_Entity'))
  }

  const app = Fastify()
  t.after(() => app.close())
  app.register(mercuriusFederationPlugin, {
    schema: upgraded.posts,
    resolvers: { Query: { topPosts: () => [] } }
  })
  await app.ready()
  const res = await app.inject({ method: 'POST', url: '/graphql', body: { query: '{ _service { sdl } }' } })
  assert.deepStrictEqual(JSON.parse(res.body), { data: { _service: { sdl: upgraded.posts } } })
})

test('bin: one file prints to stdout, several files are written next to their sources', t => {
  const dir = mkdtempSync(join(tmpdir(), 'fed2-upgrade-'))
  const posts = join(dir, 'posts.graphql')
  const users = join(dir, 'users.graphql')
  writeFileSync(posts, postsV1)
  writeFileSync(users, usersV1)
  const bin = join(__dirname, '..', '..', 'bin', 'upgrade.js')

  const single = execFileSync(process.execPath, [bin, '--version', '2.4', posts], { encoding: 'utf8' })
  assert.strictEqual(single, upgradeSubgraphSdl(postsV1, { version: '2.4' }))

  const multi = execFileSync(process.execPath, [bin, posts, users], { encoding: 'utf8' })
  assert.deepStrictEqual(multi.trim().split('\n'), [join(dir, 'posts.fed2.graphql'), join(dir, 'users.fed2.graphql')])
  const expected = upgradeSubgraphSdls({ [posts]: postsV1, [users]: usersV1 })
  assert.strictEqual(readFileSync(join(dir, 'posts.fed2.graphql'), 'utf8'), expected[posts])
  assert.strictEqual(readFileSync(join(dir, 'users.fed2.graphql'), 'utf8'), expected[users])

  assert.throws(() => execFileSync(process.execPath, [bin], { encoding: 'utf8', stdio: 'pipe' }), /usage/)
})
