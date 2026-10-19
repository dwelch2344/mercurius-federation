#!/usr/bin/env node
'use strict'

const { readFileSync, writeFileSync } = require('node:fs')
const { basename, dirname, extname, join } = require('node:path')
const { upgradeSubgraphSdl, upgradeSubgraphSdls } = require('../lib/upgrade')

function usage () {
  console.error('usage: mercurius-federation-upgrade [--version 2.3] <schema.graphql> [more.graphql ...]')
  process.exit(1)
}

const args = process.argv.slice(2)
let version = '2.3'
const files = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version') {
    version = args[++i]
    if (!version) usage()
  } else if (args[i] === '-h' || args[i] === '--help') {
    usage()
  } else {
    files.push(args[i])
  }
}
if (files.length === 0) usage()

if (files.length === 1) {
  process.stdout.write(upgradeSubgraphSdl(readFileSync(files[0], 'utf8'), { version }))
} else {
  const sdls = {}
  for (const file of files) sdls[file] = readFileSync(file, 'utf8')
  const upgraded = upgradeSubgraphSdls(sdls, { version })
  for (const file of files) {
    const target = join(dirname(file), `${basename(file, extname(file))}.fed2${extname(file) || '.graphql'}`)
    writeFileSync(target, upgraded[file])
    console.log(target)
  }
}
