import { GraphQLSchema } from 'graphql'
import { FastifyInstance } from 'fastify'
import { MercuriusOptions } from 'mercurius'
import {
  DirectiveNode,
  DocumentNode
} from 'graphql/language/ast';

export interface buildFederationSchemaOptions {
  isGateway?: boolean
}

export type MercuriusFederationOptions = Omit<MercuriusOptions, 'schema'> & {
  schema: string | DocumentNode | Array<DocumentNode>
}

export declare const mercuriusFederationPlugin: (
  instance: FastifyInstance,
  opts: MercuriusFederationOptions
) => void

/**
 * Builds schema with support for federation mode.
 */
export declare const buildFederationSchema: (
  schema: string | DocumentNode | Array<DocumentNode>,
  opts?: buildFederationSchemaOptions
) => GraphQLSchema

export type SchemaTransformer = (schema: GraphQLSchema) => GraphQLSchema

/**
 * Wraps an array of schema transformers so that `resolveReference` functions
 * (set by mercurius on entity types) are preserved after the transformation.
 * Use this instead of passing transformers directly to `schemaTransforms`
 * when working with federated schemas.
 */
export declare const federationSchemaTransformer: (
  transformers: SchemaTransformer[]
) => SchemaTransformer

/**
 * The federation specification a Federation 2 subgraph links to.
 * `imports` maps canonical names (`@key`, `FieldSet`) to the names used in
 * the subgraph (the same name, or the `as` alias). Elements that are not
 * imported are available as `<namespace>__<name>`.
 */
export interface FederationLink {
  url: string
  version: { major: number, minor: number }
  imports: Map<string, string>
  namespace: string
  node: DirectiveNode
}

/**
 * Finds the `@link` to the federation specification on a subgraph document.
 * Returns `null` for a Federation 1 subgraph (no such `@link`).
 * Throws `MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION`,
 * `MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT` or
 * `MER_ERR_GQL_FEDERATION_MULTIPLE_LINKS`.
 */
export declare const parseFederationLink: (
  document: DocumentNode
) => FederationLink | null
