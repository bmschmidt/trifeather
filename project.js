#!/usr/bin/env node

import TriFeather from './src/TriFeather.js';
import { random_points } from './src/RandomPoints.js';
import JSONStream from 'JSONStream'
import * as d3geo from 'd3-geo';
import * as geoproj from 'd3-geo-projection';
import * as geoAlbersUsaTerritories from './src/geo-albers-usa-territories.js';
import pkg from 'commander';
import { tableToIPC } from 'apache-arrow';

const { program } = pkg;

const projections = {
  albersUsa: geoAlbersUsaTerritories,
  mollweide: d3geo.geoMollweide,
  mercator: d3geo.geoMercator
}

program.version('1.1.1');

program
  .option('-c, --counts [counts...]',
  "Count fields to use for dot-density; must be keys in the geojson properties")
  .option('-n, --names [names...]', `Column names to split count fields into using delimiter. E.g., {'white_non-hispanic': 31}
  with names ['race', 'ethnicity'] will add 31 points with "race" of "white" and "ethnicity" of "non-hispanic." If left blank, 
  the column will be named "category" and no splitting will occur.`)
  .option('-d, --delimiter <delimiter>', 
  `Delimiter character. in conjunction with names. Default "_" if more than one "names" passed.`)
  .option('-k, --keep [keep...]',
    "Geojson properties to pass into derived points without alteration. (Saved as utf8 regardless of type.)")
  .option('-p --projection <projection>', "Projection. String representing d3-geo or d3-geo-projection factory function. Will be scaled up by a factor of 1e12 to support zoom.", "geoAlbersUsaTerritories")
  .requiredOption('-f, --files <files...>', 'geojson files to parse');

program.parse(process.argv);
// Look in several places.
const proj = d3geo[program.projection] || geoAlbersUsaTerritories[program.projection] || geoproj[program.projection]

console.log(proj)
const projection = proj().scale(1)

import fs from 'fs';

const fnames = program.opts()['files']
const counts = program.opts()['counts']
const names = program.opts()['names'] || ["category"]
const delimiter = program.opts()['delimiter'] || names.length == 1 ? "ARBITRYAR STRING_THAT_WONT_OCCURR IN TEXT" : "_"
const keep = program.opts()['keep'] || []

for (let fname of fnames) {
  console.log(fname)
  if (!(fname.endsWith(".json") || fname.endsWith(".geojson"))) {
    throw "Suffix should be 'json' or 'geojson', but " + fname + " found"
  }
  
  const destname = fname.replace(".geojson", counts ? ".feather" : ".trifeather")
    .replace(".json", counts ? ".feather" : ".trifeather")

  if (fs.existsSync(destname)) {
    console.log("Skipping " + destname + " because it already exists")
    continue
  }


  /*var data = fs.readFileSync(fname, 'utf-8');
  console.log(fname, "loaded")
  const feature_collection = JSON.parse(data)
  */

  let stream = fs.createReadStream(fname, {encoding: 'utf8'});
  let parser = JSONStream.parse('$*');
  stream.pipe(parser)

  let feature_collection_promise = new Promise((resolve, reject) => {
    let d = {};
    parser.on('data', (data) => {
      d[data.key] = data.value;
    }).on('end', () => {
      // I don't really get streaming in node, so I'm wrapping
      // it in a promise.
      resolve(d)
    })
  })

  const feature_collection = await feature_collection_promise;

  console.log(fname, "parsed... Creating triangulation")

  let trifeather = TriFeather
    .from_feature_collection(feature_collection, projection)
  console.log(fname, "triangulated")

  let t;
  if (!counts) {
    t = trifeather.t
  } else {
    t = random_points(trifeather, counts, 1, "feather", keep, names, delimiter)
  }
  let b = Buffer.from(tableToIPC(t, "file"))
  const fd = fs.openSync(destname, "w")
  fs.writeSync(fd, b)
}
