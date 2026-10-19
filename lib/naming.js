'use strict'

const { Kind, visit } = require('graphql')

/**
 * The name a canonical specification element takes inside a subgraph:
 * its import alias when imported, otherwise `<namespace>__<name>`.
 * Directives keep their leading `@` in both input and output.
 */
function linkedName (imports, namespace, canonical) {
  const alias = imports.get(canonical)
  if (alias) {
    return alias
  }
  return canonical.startsWith('@')
    ? `@${namespace}__${canonical.slice(1)}`
    : `${namespace}__${canonical}`
}

/** Same as linkedName for a directive, without the leading `@` on either side. */
function linkedDirectiveName (imports, namespace, canonicalWithoutAt) {
  return linkedName(imports, namespace, `@${canonicalWithoutAt}`).slice(1)
}

/**
 * Renames every definition in a specification document, and every reference
 * to one of the specification's own types, to its linked name.
 * `typeNames` is the set of canonical type names owned by the specification;
 * references to anything else (String, Boolean, …) are left alone.
 */
function applyLinkNaming (document, imports, namespace, typeNames) {
  const rename = canonical => linkedName(imports, namespace, canonical)
  const renameNode = node => ({
    ...node,
    name: { ...node.name, value: rename(node.name.value) }
  })

  return visit(document, {
    [Kind.DIRECTIVE_DEFINITION] (node) {
      return {
        ...node,
        name: { ...node.name, value: rename(`@${node.name.value}`).slice(1) }
      }
    },
    [Kind.SCALAR_TYPE_DEFINITION]: renameNode,
    [Kind.ENUM_TYPE_DEFINITION]: renameNode,
    [Kind.NAMED_TYPE] (node) {
      if (!typeNames.has(node.name.value)) {
        return undefined
      }
      return renameNode(node)
    }
  })
}

module.exports = {
  linkedName,
  linkedDirectiveName,
  applyLinkNaming
}
