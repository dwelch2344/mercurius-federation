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

export interface UpgradeOptions {
  /** federation specification version to link, e.g. `'2.3'` (default) */
  version?: string
}

/**
 * Upgrades a Federation 1 subgraph SDL to Federation 2: adds the federation
 * `@link`, turns `extend type X @key` / `type X @extends` into plain
 * definitions. An SDL that already links the federation spec is returned as is.
 */
export declare const upgradeSubgraphSdl: (sdl: string, opts?: UpgradeOptions) => string

/**
 * Upgrades a set of Federation 1 subgraph SDLs together, additionally marking
 * `@shareable` the value types and entity fields defined in several subgraphs.
 */
export declare const upgradeSubgraphSdls: (sdls: Record<string, string>, opts?: UpgradeOptions) => Record<string, string>
