'use strict'

const V1_EXTENSION_DIRECTIVES = ['extends', 'requires']

/**
 * Whether a type definition is marked as an extension by one of the given
 * directives. Federation 1 treats both `@extends` and `@requires` as markers;
 * Federation 2 only `@extends` (under whatever name it was imported as).
 */
function hasExtensionDirective (node, extensionDirectives = V1_EXTENSION_DIRECTIVES) {
  if (!node.directives || node.directives.length < 1) {
    return false
  }
  for (let i = 0; i < node.directives.length; i++) {
    const directive = node.directives[i].name.value
    if (extensionDirectives.includes(directive)) {
      return true
    }
  }
}

module.exports = {
  hasExtensionDirective,
  V1_EXTENSION_DIRECTIVES
}
