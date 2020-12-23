import TriFeather from './src/TriFeather.mjs';
import { random_points } from './src/RandomPoints.mjs';

import d3geo from 'd3-geo';
import geo from 'geo-albers-usa-territories';
 const geoAlbersUsaTerritories = geo.geoAlbersUsaTerritories
import pkg from 'commander';
const { program } = pkg;

program.version('0.0.1');

program
  .option('-c, --counts [counts...]', 
  "Count fields to use for dot-density; must be keys in the geojson properties")
  .requiredOption('-f, --files <files...>', 'geojson files to parse');

program.parse(process.argv);


import fs from 'fs';

const fnames = program.opts()['files']
for (let fname of fnames) {
  console.log(fname)
  if (!(fname.endsWith(".json") || fname.endsWith(".geojson"))) {
    throw "Suffix should be 'json' or 'geojson', but " + fname + " found"
  }
  var data = fs.readFileSync(fname, 'utf-8');

  console.log(fname, "loaded")
  const feature_collection = JSON.parse(data)
  console.log(fname, "parsed")
  let trifeather = TriFeather
    .from_feature_collection(feature_collection, geoAlbersUsaTerritories().scale(1e9))
  
  console.log(fname, "triangulated")

  let t, destname;
  const counts = program.opts()['counts']
  if (!counts) {
    t = trifeather.t
    destname = fname.replace(".geojson", ".trifeather")
      .replace(".json", ".trifeather")
  } else {
    
    t = random_points(trifeather, counts, 1, "feather")
    destname = fname.replace(".geojson", ".feather")
      .replace(".json", ".feather")
  }
  
  
  let b = Buffer.from(t.serialize("binary", true))
//  b = Buffer.from("hi")
  const fd = fs.openSync(destname, "w")
  fs.writeSync(fd, b)
}
