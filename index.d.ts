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

/**
 * Fastify plugin registering `mercurius` with a federated schema: the
 * `schema` option (SDL string, DocumentNode or DocumentNodes) is passed
 * through `buildFederationSchema`, and `schemaTransforms` are wrapped with
 * `federationSchemaTransformer`.
 */
export declare const mercuriusFederationPlugin: (
  instance: FastifyInstance,
  opts: MercuriusFederationOptions
) => void

/**
 * Builds an executable schema with federation support: `_service`, `_entities`
 * and `_Entity`, plus the federation directives. A schema that links the
 * federation specification (`extend schema @link(url: "https://specs.apollo.dev/federation/v2.x")`)
 * is built as a Federation 2 subgraph, any other as a Federation 1 subgraph.
 * With `isGateway` the gateway-side variant is built instead (no root
 * federation fields, federation directives and `@external` fields removed).
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
 * `@link` (importing `@key` and every federation directive in use) and turns
 * `extend type X @key` / `type X @extends` into plain definitions, keeping
 * `@external`, `@requires` and `@provides`. Root type extensions are left as
 * they are. An SDL that already links the federation spec is returned as is.
 * Comments are lost; descriptions and custom directives are kept.
 */
export declare const upgradeSubgraphSdl: (sdl: string, opts?: UpgradeOptions) => string

/**
 * Upgrades a set of Federation 1 subgraph SDLs together (keyed by subgraph
 * name). Beyond `upgradeSubgraphSdl`, marks `@shareable` what Federation 1
 * allowed implicitly: object types without `@key` defined in several
 * subgraphs, and non-external, non-key fields of entities defined in several
 * subgraphs. SDLs that already link the federation spec are returned as is.
 */
export declare const upgradeSubgraphSdls: (sdls: Record<string, string>, opts?: UpgradeOptions) => Record<string, string>
