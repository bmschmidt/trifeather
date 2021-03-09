import TriFeather from './src/TriFeather.js';
import { random_points } from './src/RandomPoints.js';

import d3geo from 'd3-geo';
import geoproj from 'd3-geo-projection';
import geo from 'geo-albers-usa-territories';
const geoAlbersUsaTerritories = geo.geoAlbersUsaTerritories
import pkg from 'commander';
const { program } = pkg;

const projections = {
  albersUsa: geoAlbersUsaTerritories,
  mollweide: d3geo.geoMollweide,
  mercator: d3geo.geoMercator
}

program.version('1.1.0');

program
  .option('-c, --counts [counts...]',
  "Count fields to use for dot-density; must be keys in the geojson properties")
  .option('-k, --keep [keep...]',
  "Geojson properties to pass into derived points without alteration. (As utf8)")
  .option('-p --projection <projection>', "Projection", "geoAlbersUsaTerritories")

  .requiredOption('-f, --files <files...>', 'geojson files to parse');

program.parse(process.argv);
// Look in several places.
const proj = d3geo[program.projection] || geo[program.projection] || geoproj[program.projection]

console.log(proj)
const projection = proj().scale(1e12)

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
  console.log(fname, "parsed... Creating triangulation")

  let trifeather = TriFeather
    .from_feature_collection(feature_collection, projection)

  console.log(fname, "triangulated")

  let t, destname;
  const counts = program.opts()['counts']
  if (!counts) {
    t = trifeather.t
    destname = fname.replace(".geojson", ".trifeather")
      .replace(".json", ".trifeather")
  } else {
    const keep = program.opts()['keep'] || []
    t = random_points(trifeather, counts, 1, "feather", keep)
    destname = fname.replace(".geojson", ".feather")
      .replace(".json", ".feather")
  }
  let b = Buffer.from(t.serialize("binary", false))
  const fd = fs.openSync(destname, "w")
  fs.writeSync(fd, b)
}
