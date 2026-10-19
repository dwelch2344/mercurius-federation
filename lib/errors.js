'use strict'

const createError = require('@fastify/error')

const errors = {
  MER_ERR_GQL_INVALID_SCHEMA: createError(
    'MER_ERR_GQL_INVALID_SCHEMA',
    'Invalid schema: check out the .errors property on the Error'
  ),
  /**
   * Gateway errors
   */
  MER_ERR_GQL_FEDERATION_INVALID_SCHEMA: createError(
    'MER_ERR_GQL_FEDERATION_INVALID_SCHEMA',
    'The _entities resolver tried to load an entity for type "%s", but no object type of that name was found in the schema'
  ),
  MER_ERR_GQL_FEDERATION_DUPLICATE_DIRECTIVE: createError(
    'MER_ERR_GQL_FEDERATION_DUPLICATE_DIRECTIVE',
    'Directive with a different definition but the same name "%s" already exists in the gateway schema'
  ),
  /**
   * Federation 2 `@link` errors
   */
  MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION: createError(
    'MER_ERR_GQL_FEDERATION_UNSUPPORTED_VERSION',
    'Unsupported federation specification "%s": only https://specs.apollo.dev/federation/v2.0 through v2.9 are supported'
  ),
  MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT: createError(
    'MER_ERR_GQL_FEDERATION_UNKNOWN_IMPORT',
    'Invalid @link import: %s'
  ),
  MER_ERR_GQL_FEDERATION_MULTIPLE_LINKS: createError(
    'MER_ERR_GQL_FEDERATION_MULTIPLE_LINKS',
    'A subgraph schema must @link the federation specification at most once'
  )
}

module.exports = errors
