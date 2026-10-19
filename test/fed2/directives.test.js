'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const buildFederationSchema = require('../../lib/federation')

function directive (schema, name) {
  const found = schema.getDirective(name)
  assert.ok(found, `directive @${name} is defined`)
  return found
}

test('federation 2.3 directives are defined with their spec locations', () => {
  const schema = buildFederationSchema(`
    extend schema @link(
      url: "https://specs.apollo.dev/federation/v2.3",
      import: ["@key", "@shareable", "@override", "@inaccessible", "@tag", "@composeDirective", "@interfaceObject", "@external", "@requires", "@provides"]
    )
    type Query { a: A }
    type A @key(fields: "id") {
      id: ID!
      x: String @shareable @tag(name: "t")
      y: String @override(from: "other") @inaccessible
    }
  `)

  assert.deepStrictEqual(directive(schema, 'key').locations, ['OBJECT', 'INTERFACE'])
  assert.strictEqual(directive(schema, 'key').isRepeatable, true)
  assert.deepStrictEqual(directive(schema, 'key').args.map(a => a.name), ['fields', 'resolvable'])
  // FieldSet is not imported here, so the injected definition refers to the namespaced scalar
  assert.strictEqual(directive(schema, 'key').args[0].type.toString(), 'federation__FieldSet!')

  assert.deepStrictEqual(directive(schema, 'shareable').locations, ['OBJECT', 'FIELD_DEFINITION'])
  assert.strictEqual(directive(schema, 'shareable').isRepeatable, true)

  assert.deepStrictEqual(directive(schema, 'override').locations, ['FIELD_DEFINITION'])
  assert.deepStrictEqual(directive(schema, 'override').args.map(a => a.name), ['from'])

  assert.ok(directive(schema, 'inaccessible').locations.includes('FIELD_DEFINITION'))
  assert.ok(directive(schema, 'inaccessible').locations.includes('INPUT_FIELD_DEFINITION'))

  assert.ok(directive(schema, 'tag').locations.includes('SCHEMA'))
  assert.strictEqual(directive(schema, 'tag').isRepeatable, true)

  assert.deepStrictEqual(directive(schema, 'composeDirective').locations, ['SCHEMA'])
  assert.strictEqual(directive(schema, 'composeDirective').isRepeatable, true)
  assert.deepStrictEqual(directive(schema, 'interfaceObject').locations, ['OBJECT'])
  assert.deepStrictEqual(directive(schema, 'external').locations, ['OBJECT', 'FIELD_DEFINITION'])
  assert.deepStrictEqual(directive(schema, 'requires').locations, ['FIELD_DEFINITION'])
  assert.deepStrictEqual(directive(schema, 'provides').locations, ['FIELD_DEFINITION'])

  // not imported -> namespaced
  assert.ok(directive(schema, 'federation__extends'))
  assert.strictEqual(schema.getDirective('extends'), undefined)
  // 2.5+ elements are not available in 2.3
  assert.strictEqual(schema.getDirective('federation__authenticated'), undefined)
  assert.strictEqual(schema.getType('federation__Scope'), undefined)
})

test('definitions track the linked version', () => {
  const v20 = buildFederationSchema(`
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable", "@override", "@tag"])
    type Query { a: String }
  `)
  assert.strictEqual(v20.getDirective('shareable').isRepeatable, false)
  assert.ok(!v20.getDirective('tag').locations.includes('SCHEMA'))
  assert.strictEqual(v20.getDirective('federation__composeDirective'), undefined)
  assert.strictEqual(v20.getDirective('federation__interfaceObject'), undefined)

  const v29 = buildFederationSchema(`
    extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@override", "@authenticated", "@requiresScopes", "@policy", "@context", "@fromContext", "@cost", "@listSize"])
    type Query { a: String }
  `)
  assert.deepStrictEqual(v29.getDirective('override').args.map(a => a.name), ['from', 'label'])
  assert.ok(v29.getDirective('authenticated'))
  assert.strictEqual(v29.getDirective('requiresScopes').args[0].type.toString(), '[[federation__Scope!]!]!')
  assert.strictEqual(v29.getDirective('policy').args[0].type.toString(), '[[federation__Policy!]!]!')
  assert.strictEqual(v29.getDirective('fromContext').args[0].type.toString(), 'federation__ContextFieldValue')
  assert.ok(v29.getDirective('context').isRepeatable)
  assert.ok(v29.getDirective('cost'))
  assert.deepStrictEqual(v29.getDirective('listSize').args.map(a => a.name), ['assumedSize', 'slicingArguments', 'sizedFields', 'requireOneSlicingArgument'])
})

test('aliased imports can be used in the SDL', () => {
  const schema = buildFederationSchema(`
    extend schema @link(
      url: "https://specs.apollo.dev/federation/v2.3",
      import: [{ name: "@key", as: "@entityKey" }, { name: "@shareable", as: "@shared" }, { name: "FieldSet", as: "Selection" }]
    )
    type Query { a: A }
    type A @entityKey(fields: "id") @shared {
      id: ID!
      x: String @shared
    }
  `)
  assert.ok(schema.getDirective('entityKey'))
  assert.strictEqual(schema.getDirective('entityKey').args[0].type.toString(), 'Selection!')
  assert.ok(schema.getDirective('shared'))
  assert.ok(schema.getType('Selection'))
  assert.strictEqual(schema.getType('federation__FieldSet'), undefined)
  assert.deepStrictEqual(schema.getType('_Entity').getTypes().map(t => t.name), ['A'])
})

test('@composeDirective and custom @link applications are kept on the schema', () => {
  const schema = buildFederationSchema(`
    extend schema
      @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@composeDirective"])
      @link(url: "https://myspecs.dev/myCustomDirective/v1.0", import: ["@custom"])
      @composeDirective(name: "@custom")

    directive @custom on OBJECT

    type Query { a: A }
    type A @custom @key(fields: "id") { id: ID! }
  `)
  assert.strictEqual(schema.extensionASTNodes.length, 1)
  const applied = schema.extensionASTNodes[0].directives.map(d => d.name.value)
  assert.deepStrictEqual(applied, ['link', 'link', 'composeDirective'])
  assert.ok(schema.getDirective('custom'))
  assert.deepStrictEqual(schema.getType('A').astNode.directives.map(d => d.name.value), ['custom', 'key'])
})

test('gateway mode strips the federation directives but keeps @requires and custom directives', () => {
  const schema = buildFederationSchema(`
    extend schema
      @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", { name: "@requires", as: "@needs" }, "@external"])
    directive @custom on OBJECT
    type Query { a: A }
    type A @custom @key(fields: "id") {
      id: ID!
      x: String @external
      y: String @needs(fields: "x")
    }
  `, { isGateway: true })
  const names = schema.getDirectives().map(d => d.name)
  assert.ok(names.includes('needs'))
  assert.ok(names.includes('custom'))
  for (const removed of ['key', 'shareable', 'external', 'link', 'federation__override']) {
    assert.ok(!names.includes(removed), `@${removed} removed`)
  }
  assert.strictEqual(schema.getType('_Service'), undefined)
  assert.strictEqual(schema.getType('_Entity'), undefined)
})
