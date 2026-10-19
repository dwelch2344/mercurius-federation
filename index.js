'use strict'

const buildFederationSchema = require('./lib/federation')
const mercuriusFederationPlugin = require('./lib/plugin')
const federationSchemaTransformer = require('./lib/transformFederatedSchema')
const { parseFederationLink } = require('./lib/link')

module.exports = { mercuriusFederationPlugin, buildFederationSchema, federationSchemaTransformer, parseFederationLink }
module.exports.default = mercuriusFederationPlugin
