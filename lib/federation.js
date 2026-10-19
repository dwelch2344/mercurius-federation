/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2020 Meteor Development Group, Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use strict'

const {
  GraphQLSchema,
  GraphQLObjectType,
  Kind,
  extendSchema,
  parse,
  print,
  isTypeDefinitionNode,
  isTypeExtensionNode,
  isObjectType,
  isInterfaceType,
  isSpecifiedDirective,
  defaultTypeResolver,
  GraphQLDirective
} = require('graphql')
const { validateSDL } = require('graphql/validation/validate')
const compositionRules = require('./compositionRules')
const mergeDocumentNode = require('./mergeDocumentNode')

const {
  MER_ERR_GQL_INVALID_SCHEMA,
  MER_ERR_GQL_FEDERATION_INVALID_SCHEMA,
  MER_ERR_GQL_FEDERATION_DUPLICATE_DIRECTIVE
} = require('./errors')
const { hasExtensionDirective, V1_EXTENSION_DIRECTIVES } = require('./util')
const { parseFederationLink } = require('./link')
const { LINK_SPEC, definitionsFor } = require('./specs')
const { applyLinkNaming, linkedDirectiveName } = require('./naming')

const BASE_FEDERATION_TYPES = `
  scalar _Any
  scalar _FieldSet

  directive @external on FIELD_DEFINITION
  directive @requires(fields: _FieldSet!) on FIELD_DEFINITION
  directive @provides(fields: _FieldSet!) on FIELD_DEFINITION
  directive @key(fields: _FieldSet!) on OBJECT | INTERFACE
  directive @extends on OBJECT | INTERFACE
`

const FEDERATION_SCHEMA = `
  ${BASE_FEDERATION_TYPES}
  type _Service {
    sdl: String
  }
`

const extensionKindToDefinitionKind = {
  [Kind.SCALAR_TYPE_EXTENSION]: Kind.SCALAR_TYPE_DEFINITION,
  [Kind.OBJECT_TYPE_EXTENSION]: Kind.OBJECT_TYPE_DEFINITION,
  [Kind.INTERFACE_TYPE_EXTENSION]: Kind.INTERFACE_TYPE_DEFINITION,
  [Kind.UNION_TYPE_EXTENSION]: Kind.UNION_TYPE_DEFINITION,
  [Kind.ENUM_TYPE_EXTENSION]: Kind.ENUM_TYPE_DEFINITION,
  [Kind.INPUT_OBJECT_TYPE_EXTENSION]: Kind.INPUT_OBJECT_TYPE_DEFINITION
}

const definitionKindToExtensionKind = {
  [Kind.SCALAR_TYPE_DEFINITION]: Kind.SCALAR_TYPE_EXTENSION,
  [Kind.OBJECT_TYPE_DEFINITION]: Kind.OBJECT_TYPE_EXTENSION,
  [Kind.INTERFACE_TYPE_DEFINITION]: Kind.INTERFACE_TYPE_EXTENSION,
  [Kind.UNION_TYPE_DEFINITION]: Kind.UNION_TYPE_EXTENSION,
  [Kind.ENUM_TYPE_DEFINITION]: Kind.ENUM_TYPE_EXTENSION,
  [Kind.INPUT_OBJECT_TYPE_DEFINITION]: Kind.INPUT_OBJECT_TYPE_EXTENSION
}

function removeExternalFields (typeDefinition, externalName = 'external') {
  return {
    ...typeDefinition,
    fields: typeDefinition.fields.filter(
      fieldDefinition =>
        !fieldDefinition.directives.some(
          directive => directive.name.value === externalName
        )
    )
  }
}

const V1_NAMES = {
  version: 1,
  key: 'key',
  external: 'external',
  requires: 'requires',
  extensionDirectives: V1_EXTENSION_DIRECTIVES
}

/**
 * Local names of the federation directives in a Federation 2 subgraph,
 * derived from its `@link` imports (aliases and `namespace__` prefixes).
 */
function createV2Names (link) {
  const local = name => linkedDirectiveName(link.imports, link.namespace, name)
  return {
    version: 2,
    key: local('key'),
    external: local('external'),
    requires: local('requires'),
    extensionDirectives: [local('extends')]
  }
}

/**
 * The definitions injected into a Federation 2 subgraph schema: the link
 * specification, the federation specification for the linked version under
 * the names the subgraph imports them as, and the `_Any` / `_Service` types.
 * Definitions the subgraph declares itself are left to the subgraph.
 */
function buildV2BaseDefinitions (link, userDefinitions, isGateway) {
  const spec = definitionsFor(link.version)
  const specTypeNames = new Set(
    spec.filter(entry => !entry.name.startsWith('@')).map(entry => entry.name)
  )
  const renamedSpec = applyLinkNaming(
    parse(spec.map(entry => entry.sdl).join('\n')),
    link.imports,
    link.namespace,
    specTypeNames
  )

  const qualifiedName = definition =>
    (definition.kind === Kind.DIRECTIVE_DEFINITION ? '@' : '') + definition.name.value
  const userDefined = new Set(
    userDefinitions
      .filter(
        definition =>
          definition.kind === Kind.DIRECTIVE_DEFINITION ||
          isTypeDefinitionNode(definition)
      )
      .map(qualifiedName)
  )

  const definitions = [
    ...parse(LINK_SPEC).definitions,
    ...renamedSpec.definitions
  ].filter(definition => !userDefined.has(qualifiedName(definition)))

  definitions.push(
    ...parse(`scalar _Any ${isGateway ? '' : 'type _Service { sdl: String }'}`)
      .definitions
  )

  return {
    document: { kind: Kind.DOCUMENT, definitions },
    directiveNames: definitions
      .filter(definition => definition.kind === Kind.DIRECTIVE_DEFINITION)
      .map(definition => definition.name.value)
  }
}

function getStubTypes (schemaDefinitions, isGateway, names) {
  const definitionsMap = {}
  const extensionsMap = {}
  const extensions = []
  const directiveDefinitions = []
  const schemaNodes = []

  for (const definition of schemaDefinitions) {
    if (definition.kind === 'SchemaDefinition' || definition.kind === 'SchemaExtension') {
      // Federation 1 ignores schema nodes; Federation 2 keeps them so that
      // `@link` / `@composeDirective` applications survive in the built schema.
      if (names.version === 2) {
        schemaNodes.push(definition)
      }
      continue
    }

    const typeName = definition.name.value
    const isTypeExtensionByDirective = hasExtensionDirective(definition, names.extensionDirectives)
    /* istanbul ignore else we are not interested in nodes that does not match if statements */
    if (isTypeDefinitionNode(definition) && !isTypeExtensionByDirective) {
      definitionsMap[typeName] = definition
    } else if (
      isTypeExtensionNode(definition) ||
      (isTypeDefinitionNode(definition) && isTypeExtensionByDirective)
    ) {
      extensionsMap[typeName] = {
        kind: isTypeExtensionByDirective
          ? definition.kind
          : extensionKindToDefinitionKind[definition.kind],
        name: definition.name
      }
      if (isTypeExtensionByDirective) {
        definition.kind = definitionKindToExtensionKind[definition.kind]
      }
      extensions.push(isGateway ? removeExternalFields(definition, names.external) : definition)
    } else if (definition.kind === Kind.DIRECTIVE_DEFINITION) {
      directiveDefinitions.push(definition)
    }
  }

  return {
    typeStubs: Object.keys(extensionsMap)
      .filter(extensionTypeName => !definitionsMap[extensionTypeName])
      .map(extensionTypeName => extensionsMap[extensionTypeName]),
    extensions,
    schemaNodes,
    definitions: [...directiveDefinitions, ...Object.values(definitionsMap)]
  }
}

function gatherDirectives (type) {
  let directives = []
  /* istanbul ignore else seems that extensionASTNodes is always provided in graphql16+, we are keeping this check for safety */
  if (type.extensionASTNodes) {
    for (const node of type.extensionASTNodes) {
      if (node.directives?.length) {
        directives = directives.concat(node.directives)
      }
    }
  }

  if (type.astNode && type.astNode.directives) {
    directives = directives.concat(type.astNode.directives)
  }

  return directives
}

function typeIncludesDirective (type, directiveName) {
  const directives = gatherDirectives(type)
  return directives.some(directive => directive.name.value === directiveName)
}

function addTypeNameToResult (result, typename) {
  /* istanbul ignore else when result is null or not an object we return original result */
  if (result !== null && typeof result === 'object') {
    Object.defineProperty(result, '__typename', {
      value: typename
    })
  }
  return result
}

function resolveType (reference, context, info) {
  const { __typename } = reference

  const type = info.schema.getType(__typename)

  if (!type || !(isObjectType(type) || isInterfaceType(type))) {
    throw new MER_ERR_GQL_FEDERATION_INVALID_SCHEMA(__typename)
  }

  if (!isInterfaceType(type)) {
    return type
  }

  const resolveTypeFn = type.resolveType || defaultTypeResolver

  const resolveType = resolveTypeFn({
    ...reference,
    __typename: undefined
  }, context, info, type)

  if (typeof resolveType !== 'string' && typeof resolveType.then === 'function') {
    return resolveType.then((resolvedTypename) =>
      info.schema.getType(resolvedTypename)
    )
  }

  return info.schema.getType(resolveType)
}

function addEntitiesResolver (schema, keyName = 'key') {
  const entityTypes = Object.values(schema.getTypeMap()).filter(
    type => isObjectType(type) && typeIncludesDirective(type, keyName)
  )

  if (entityTypes.length > 0) {
    schema = extendSchema(
      schema,
      parse(`
      union _Entity = ${entityTypes.join(' | ')}

      extend type Query {
        _entities(representations: [_Any!]!): [_Entity]!
      }
    `),
      {
        assumeValid: true
      }
    )

    const query = schema.getType('Query')
    const queryFields = query.getFields()
    queryFields._entities = {
      ...queryFields._entities,
      resolve: (_source, { representations }, context, info) => {
        return representations.map(reference => {
          const type = resolveType(reference, context, info)

          if (type && typeof type.then === 'function') {
            return type.then((resolvedType) => {
              const resolveReference = resolvedType.resolveReference ||
                function defaultResolveReference () {
                  return reference
                }

              const result = resolveReference(reference, {}, context, info)

              if (result && typeof result.then === 'function') {
                return result.then((x) =>
                  addTypeNameToResult(x, resolvedType.name))
              }

              return addTypeNameToResult(result, resolvedType.name)
            })
          }

          const resolveReference = type.resolveReference
            ? type.resolveReference
            : function defaultResolveReference () {
              return reference
            }

          const result = resolveReference(reference, {}, context, info)

          if (result && 'then' in result && typeof result.then === 'function') {
            return result.then((x) =>
              addTypeNameToResult(x, type.name))
          }

          return addTypeNameToResult(result, type.name)
        })
      }
    }
  }

  return schema
}

function addServiceResolver (schema, originalSchemaSDL) {
  schema = extendSchema(
    schema,
    parse(`
    extend type Query {
      _service: _Service!
    }
  `),
    {
      assumeValid: true
    }
  )
  const query = schema.getType('Query')

  const queryFields = query.getFields()
  queryFields._service = {
    ...queryFields._service,
    resolve: () => ({ sdl: typeof originalSchemaSDL === 'string' ? originalSchemaSDL : originalSchemaSDL.loc.source.body })
  }

  return schema
}

function v1GatewayDirectiveNamesToRemove () {
  return parse(BASE_FEDERATION_TYPES)
    .definitions.filter(definition => definition.kind === 'DirectiveDefinition')
    .map(definition => definition.name.value)
}

function buildGatewaySchemaDirectives (schema, federationDirectiveNames, names) {
  // Remove service federation directives which should not be present in the gateway
  // Keep `@requires` directive as it can be used in the gateway schema
  const federationDirectiveNamesToRemove = federationDirectiveNames.filter(
    name => name !== names.requires
  )
  const directives = schema
    .getDirectives()
    .filter(
      directive => !federationDirectiveNamesToRemove.includes(directive.name)
    )

  // De-duplicate custom directives
  const gatewayDirectives = []
  for (const directive of directives) {
    if (!isSpecifiedDirective(directive)) {
      const directiveToCompareAgainst = gatewayDirectives.find(
        gatewayDirective => gatewayDirective.name === directive.name
      )
      if (directiveToCompareAgainst instanceof GraphQLDirective) {
        const directiveSDL = print(directive.astNode)
        const duplicatedDirectiveSDL = print(directiveToCompareAgainst.astNode)
        if (directiveSDL !== duplicatedDirectiveSDL) {
          throw new MER_ERR_GQL_FEDERATION_DUPLICATE_DIRECTIVE(directive.name)
        }
      } else {
        gatewayDirectives.push(directive)
      }
    } else {
      gatewayDirectives.push(directive)
    }
  }

  return gatewayDirectives
}

function buildFederationSchema (schema, { isGateway } = {}) {
  if (Array.isArray(schema)) {
    schema = mergeDocumentNode(schema)
  } else if (typeof schema === 'object') {
    schema = mergeDocumentNode([schema])
  }

  const parsedOriginalSchema = typeof schema === 'string' ? parse(schema) : schema
  const link = parseFederationLink(parsedOriginalSchema)
  const names = link ? createV2Names(link) : V1_NAMES

  let baseDocument
  let federationDirectiveNames
  if (link) {
    const base = buildV2BaseDefinitions(link, parsedOriginalSchema.definitions, isGateway)
    baseDocument = base.document
    federationDirectiveNames = base.directiveNames
  } else {
    baseDocument = parse(isGateway ? BASE_FEDERATION_TYPES : FEDERATION_SCHEMA)
    federationDirectiveNames = v1GatewayDirectiveNamesToRemove()
  }

  let federationSchema = new GraphQLSchema({
    query: undefined
  })

  federationSchema = extendSchema(federationSchema, baseDocument, {
    assumeValidSDL: true
  })

  const { typeStubs, extensions, schemaNodes, definitions } = getStubTypes(
    parsedOriginalSchema.definitions,
    isGateway,
    names
  )

  // before we validate the federationSchema, we want to remove the _service field from the extended query,
  // if there is one, as this field should be excluded from the validation to provide broader support
  // for different federation implementations => https://github.com/mercurius-js/mercurius/issues/643
  const filteredExtensions = [...schemaNodes, ...extensions].map(extension => {
    if (extension.name && extension.name.value === 'Query') {
      extension.fields = extension.fields.filter(
        field => field.name.value !== '_service'
      )
    }
    return extension
  })

  // Add type stubs - only needed for federation
  federationSchema = extendSchema(
    federationSchema,
    {
      kind: Kind.DOCUMENT,
      definitions: typeStubs
    },
    { assumeValidSDL: true }
  )

  // Add default type definitions
  federationSchema = extendSchema(
    federationSchema,
    {
      kind: Kind.DOCUMENT,
      definitions
    },
    { assumeValidSDL: true }
  )

  // Add all extensions
  const extensionsDocument = {
    kind: Kind.DOCUMENT,
    definitions: filteredExtensions
  }

  // instead of relying on extendSchema internal validations
  // we run validations in our code so that we can use slightly different rules
  // as extendSchema internal rules are meant for regular usage
  // and federated schemas have different constraints
  const errors = validateSDL(
    extensionsDocument,
    federationSchema,
    compositionRules
  )

  if (errors.length === 1) {
    throw errors[0]
  } else if (errors.length > 1) {
    const err = new MER_ERR_GQL_INVALID_SCHEMA()
    err.errors = errors
    throw err
  }

  federationSchema = extendSchema(federationSchema, extensionsDocument, {
    assumeValidSDL: true
  })

  if (!federationSchema.getType('Query')) {
    federationSchema = new GraphQLSchema({
      ...federationSchema.toConfig(),
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {}
      })
    })
  }

  if (!isGateway) {
    federationSchema = addEntitiesResolver(federationSchema, names.key)
    federationSchema = addServiceResolver(federationSchema, schema)
  }

  const federationSchemaConfig = federationSchema.toConfig()
  return new GraphQLSchema({
    ...federationSchemaConfig,
    query: federationSchema.getType('Query'),
    mutation: federationSchema.getType('Mutation'),
    subscription: federationSchema.getType('Subscription'),
    directives: isGateway
      ? buildGatewaySchemaDirectives(federationSchema, federationDirectiveNames, names)
      : federationSchemaConfig.directives
  })
}

module.exports = buildFederationSchema
