# @mercuriusjs/federation

A module to add Apollo Federation metadata (Federation 1 and Federation 2) to a `mercurius` schema.

## Quick start

```bash
npm i fastify @mercuriusjs/federation
```

```js
const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

const users = {
  1: {
    id: '1',
    name: 'John',
    username: '@john'
  },
  2: {
    id: '2',
    name: 'Jane',
    username: '@jane'
  }
}

const app = Fastify()
const schema = `
  extend type Query {
    me: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String
    username: String
  }
`

const resolvers = {
  Query: {
    me: () => {
      return users['1']
    }
  },
  User: {
    __resolveReference: (source, args, context, info) => {
      return users[source.id]
    }
  }
}

app.register(mercuriusFederationPlugin, {
  schema,
  resolvers
})

app.get('/', async function (req, reply) {
  const query = '{ _service { sdl } }'
  return app.graphql(query)
})

app.listen({ port: 3000 })
```

### Build a schema and pass it to `mercurius`

Instead of using the plugin, the federation schema can be built using the `buildFederationSchema` function and passing the schema generated to `mercurius`.

```javascript
const Fastify = require('fastify')
const mercurius = require('mercurius')
const { buildFederationSchema } = require('../')

...

app.register(mercurius, {
  schema: buildFederationSchema(schema),
  resolvers,
  graphiql: true
})

...
```

## Federation 2

A subgraph is a Federation 2 subgraph when its SDL links the federation specification:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "@override"])
```

Without that `@link` the schema is built as a Federation 1 subgraph, exactly as before: Federation 1 SDLs keep working unchanged.

### Supported versions and directives

Specification versions `v2.0` through `v2.9` are supported. The directives and scalars available depend on the linked version:

| Since | Elements |
|-------|----------|
| v2.0 | `@key(fields: FieldSet!, resolvable: Boolean = true)` (repeatable), `@requires`, `@provides`, `@external`, `@extends`, `@shareable`, `@override(from:)`, `@inaccessible`, `@tag`, `FieldSet` |
| v2.1 | `@composeDirective` |
| v2.2 | `@shareable` becomes repeatable |
| v2.3 | `@interfaceObject`, `@tag` on `SCHEMA` |
| v2.5 | `@authenticated`, `@requiresScopes`, `Scope` |
| v2.6 | `@policy`, `Policy` |
| v2.7 | `@override(from:, label:)` (progressive override) |
| v2.8 | `@context`, `@fromContext`, `ContextFieldValue` |
| v2.9 | `@cost`, `@listSize` |

Importing a name that does not exist in the linked version is an error (`MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT`).

### Imported names, prefixes and aliases

An element listed in `import` is available under its own name. Every other element of the specification is still defined, under the `federation__` prefix (or `<as>__` when the `@link` has an `as:` argument):

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

type Product @key(fields: "id") {
  id: ID!
  name: String @federation__shareable
}
```

An import can be aliased with the object form:

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: [{ name: "@key", as: "@primaryKey" }])

type Product @primaryKey(fields: "id") {
  id: ID!
}
```

Only the local name of `@key` marks a type as an entity: with the alias above, `@primaryKey` does and `@federation__key` does not. Definitions a subgraph declares itself (for example its own `directive @tag`) win over the injected ones.

### A Federation 2 subgraph

```js
const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

const users = {
  u1: { id: 'u1', email: 'jane@example.com', name: 'Jane', secret: 'hidden', yearsOfEmployment: 10 }
}

const schema = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3",
          import: ["@key", "@shareable", "@override", "@inaccessible", "@external", "@requires"])

  type Query {
    me: User
  }

  type User @key(fields: "id") @key(fields: "email") {
    id: ID!
    email: String
    name: String @override(from: "legacy-users")
    secret: String @inaccessible
    yearsOfEmployment: Int
    totalProductsCreated: Int @external
    average: Int @requires(fields: "totalProductsCreated yearsOfEmployment")
  }

  type PageInfo @shareable {
    hasNextPage: Boolean!
  }
`

const resolvers = {
  Query: {
    me: () => users.u1
  },
  User: {
    __resolveReference: reference => {
      // called with whichever @key the gateway used
      if (reference.id) return { ...users[reference.id], ...reference }
      return { ...Object.values(users).find(u => u.email === reference.email), ...reference }
    },
    average: user => Math.round(user.totalProductsCreated / user.yearsOfEmployment)
  }
}

const app = Fastify()
app.register(mercuriusFederationPlugin, { schema, resolvers })
app.listen({ port: 4001 })
```

Everything else works as in Federation 1: `__resolveReference` on an entity type (or a `loaders` entry), the `_service` and `_entities` root fields, `buildFederationSchema` and `federationSchemaTransformer`.

### What the schema exposes

- `_service { sdl }` returns the original SDL unchanged, including the `extend schema @link(...)` node, so composition sees the real imports.
- `_Entity` is the union of every object type carrying the local `@key` directive. Types marked `@interfaceObject` are object types with a `@key`, so they are entities too. Interfaces with a `@key` are not members of `_Entity` (a union can only hold object types); references to them are resolved through their implementations, see below.
- `_entities(representations:)` resolves each representation through `__resolveReference` of the type named by its `__typename`. Any `@key` of the type can be used, including composite keys such as `@key(fields: "study { caseNumber }")`, whose nested objects are passed through as is.
- `@link` and `@composeDirective` applications are kept on the schema (`schema.extensionASTNodes`), and a directive composed with `@composeDirective` keeps its definition.
- `@requires` no longer marks a type as an extension; only `@extends` (or `extend type`) does.

#### Interface entities

A representation whose `__typename` is an interface (`interface Inventory @key(fields: "id")`, or an `@interfaceObject` on another subgraph pointing at it) is resolved by calling the interface's `resolveType` with the reference, then `__resolveReference` of the concrete type. The reference only carries the key fields, so `resolveType` has to derive the concrete type from them:

```js
const resolvers = {
  Inventory: {
    resolveType: reference => reference.__typename || inventories[reference.id].__typename
  },
  OpenSourceInventory: {
    __resolveReference: reference => inventories[reference.id]
  }
}
```

### parseFederationLink

`(document: DocumentNode) => FederationLink | null`

Returns the federation `@link` of a subgraph document, or `null` for a Federation 1 subgraph:

```js
const { parse } = require('graphql')
const { parseFederationLink } = require('@mercuriusjs/federation')

const link = parseFederationLink(parse(schema))
// {
//   url: 'https://specs.apollo.dev/federation/v2.3',
//   version: { major: 2, minor: 3 },
//   imports: Map { '@key' => '@key', '@requires' => '@needs' },  // canonical name → local name
//   namespace: 'federation',                                     // or the `as:` argument
//   node: DirectiveNode
// }
```

### Migrating from Federation 1

Federation 1 SDLs keep working, so nothing has to change at once. To move a subgraph to Federation 2, use the upgrade helper:

```js
const { upgradeSubgraphSdl, upgradeSubgraphSdls } = require('@mercuriusjs/federation')

// one subgraph
const fed2 = upgradeSubgraphSdl(sdl, { version: '2.3' })

// every subgraph of a graph at once (needed to work out what must be @shareable)
const upgraded = upgradeSubgraphSdls({ users: usersSdl, posts: postsSdl }, { version: '2.3' })
```

or the bundled command:

```bash
# one file: the upgraded SDL is printed to stdout
npx mercurius-federation-upgrade users.graphql > users.fed2.graphql

# several files: each is written next to its source as <name>.fed2.graphql
npx mercurius-federation-upgrade --version 2.3 users.graphql posts.graphql
```

What it changes:

- adds `extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: [...])` with `@key` and every federation directive the SDL uses;
- turns `extend type X @key(...)` and `type X @extends @key(...)` into plain `type X @key(...)` definitions (`@external`, `@requires` and `@provides` on their fields are kept); `extend type Query` / `Mutation` / `Subscription` are left as they are, both forms are valid;
- with several SDLs, marks `@shareable` what Federation 1 allowed implicitly: object types without `@key` defined in more than one subgraph, and fields of entities defined (without `@external`) in more than one subgraph. Key fields are never marked.

What it does not do:

- an SDL that already links the federation specification is returned unchanged;
- comments are lost (the output is printed from the parsed document); descriptions and custom directives are kept;
- it cannot know how fields are resolved: review the `@shareable` marks and add `@override` where a field is meant to move between subgraphs.

### Errors

- `MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION`: the `@link` url is not `https://specs.apollo.dev/federation/v2.0` … `v2.9`.
- `MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT`: an `import` entry is malformed, names an element that does not exist in the linked version, or aliases a directive as a type (or the reverse).
- `MER_ERR_GQL_FEDERATION_MULTIPLE_LINKS`: the schema links the federation specification more than once.

## API

### mercuriusFederationPlugin

A fastify plugin to create a `mercurius` server that expose the `federation` directives.

```javascript
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

const schema = ...
const resolvers = ...
const app = Fastify()

app.register(mercuriusFederationPlugin, {
  schema,
  resolvers
})
```

#### options
Uses the same [options](https://mercurius.dev/#/docs/api/options?id=plugin-options) of `mercurius` but
it requires a `string`, `DocumentNode` or an Array of `DocumentNode` for `schema` attribute. 

### buildFederationSchema

Create a schema object that can be used in a federated environment. The schema is built as a Federation 2 subgraph when it links the federation specification (see [Federation 2](#federation-2)), as a Federation 1 subgraph otherwise.

`(schema,  opts) => GraphQLSchema`

- `schema` string | DocumentNode | Array<DocumentNode>: the source schema
- `opts` object:
  - `isGateway` boolean: If enabled create a schema compatible with the `gateway` (no `_service` / `_entities`, federation directives and `@external` fields removed, `@requires` kept), Default 'false'

### Federation 2 helpers

`parseFederationLink`, `upgradeSubgraphSdl` and `upgradeSubgraphSdls` are documented in the [Federation 2](#federation-2) section.

### federationSchemaTransformer

Wraps an array of schema transformers (e.g. custom directive transformers built with `@graphql-tools/utils` `mapSchema`) so that the `resolveReference` functions defined on entity types are preserved after the transformation.

When mercurius applies `schemaTransforms`, transformers such as `mapSchema` recreate `GraphQLObjectType` instances via `new GraphQLObjectType(type.toConfig())`. Because `resolveReference` is a non-standard property set at runtime by mercurius, it is **lost** during this process. `federationSchemaTransformer` takes care of copying it back onto the new type instances after every transformer runs.

`(transformers: SchemaTransformer[]) => SchemaTransformer`

- `transformers` Array of functions `(schema: GraphQLSchema) => GraphQLSchema`: the directive / schema transformers to apply.

> **Note:** `mercuriusFederationPlugin` already wraps `schemaTransforms` with `federationSchemaTransformer` automatically. You only need to use this function when you build the federation schema yourself with `buildFederationSchema` and register it directly with `mercurius`.

#### Usage with `mercuriusFederationPlugin`

When using the plugin, just pass your transformers directly — the plugin handles the wrapping:

```js
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

app.register(mercuriusFederationPlugin, {
  schema,
  resolvers,
  schemaTransforms: [upperDirectiveTransformer]
})
```

#### Usage with `buildFederationSchema` and `mercurius`

When registering mercurius directly with a federation schema, you must wrap transformers with `federationSchemaTransformer` to preserve `resolveReference`:

```js
const mercurius = require('mercurius')
const { buildFederationSchema, federationSchemaTransformer } = require('@mercuriusjs/federation')
const { MapperKind, mapSchema, getDirective } = require('@graphql-tools/utils')
const { defaultFieldResolver } = require('graphql')

// Define a directive transformer
function upperDirectiveTransformer (schema) {
  return mapSchema(schema, {
    [MapperKind.FIELD]: (fieldConfig) => {
      const upperDirective = getDirective(schema, fieldConfig, 'upper')?.[0]
      if (upperDirective) {
        const { resolve = defaultFieldResolver } = fieldConfig
        fieldConfig.resolve = async function (obj, args, ctx, info) {
          const result = await resolve(obj, args, ctx, info)
          return typeof result === 'string' ? result.toUpperCase() : result
        }
        return fieldConfig
      }
    }
  })
}

const schema = `
  directive @upper on FIELD_DEFINITION

  extend type Query {
    me: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String @upper
    username: String
  }
`

const resolvers = {
  Query: {
    me: () => users['1']
  },
  User: {
    __resolveReference: (source) => users[source.id]
  }
}

app.register(mercurius, {
  schema: buildFederationSchema(schema),
  resolvers,
  schemaTransforms: federationSchemaTransformer([upperDirectiveTransformer])
})
```

**Without `federationSchemaTransformer`** in this scenario, `_entities` queries will fail because `resolveReference` is lost during the schema transformation:

```js
// ⚠️ _entities queries will return null for entity fields
app.register(mercurius, {
  schema: buildFederationSchema(schema),
  resolvers,
  schemaTransforms: [upperDirectiveTransformer]
})
```
