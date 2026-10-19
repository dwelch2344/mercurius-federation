'use strict'

const buildFederationSchema = require('./lib/federation')
const mercuriusFederationPlugin = require('./lib/plugin')
const federationSchemaTransformer = require('./lib/transformFederatedSchema')
const { parseFederationLink } = require('./lib/link')
const { upgradeSubgraphSdl, upgradeSubgraphSdls } = require('./lib/upgrade')

module.exports = { mercuriusFederationPlugin, buildFederationSchema, federationSchemaTransformer, parseFederationLink, upgradeSubgraphSdl, upgradeSubgraphSdls }
module.exports.default = mercuriusFederationPlugin
