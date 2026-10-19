import { expectType, expectError } from 'tsd'
import Fastify from 'fastify'
import gql from 'graphql-tag'
import { GraphQLSchema } from 'graphql/index.js'

import { buildFederationSchema, mercuriusFederationPlugin, parseFederationLink, upgradeSubgraphSdl, upgradeSubgraphSdls } from '../../index.js'
import type { FederationLink } from '../../index.js'

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

const schema2 = `
    extend type Query {
      you: User
    }
  `

expectType<GraphQLSchema>(buildFederationSchema(schema))
expectType<GraphQLSchema>(buildFederationSchema(gql(schema)))
expectType<GraphQLSchema>(buildFederationSchema([gql(schema), gql(schema2)]))
expectType<GraphQLSchema>(buildFederationSchema(schema, {}))
expectType<GraphQLSchema>(buildFederationSchema(schema, { isGateway: true }))

expectError(buildFederationSchema(schema, { isGateway: 'hello' }))

const app = Fastify()

app.register(mercuriusFederationPlugin, {
  schema,
  graphiql: true
})

expectError(() => {
  app.register(mercuriusFederationPlugin, {
    schema: buildFederationSchema(schema),
    graphiql: true
  })
})

expectType<FederationLink | null>(parseFederationLink(gql(schema)))

expectType<string>(upgradeSubgraphSdl(schema))
expectType<string>(upgradeSubgraphSdl(schema, { version: '2.3' }))
expectType<Record<string, string>>(upgradeSubgraphSdls({ a: schema, b: schema2 }))
