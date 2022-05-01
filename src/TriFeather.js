import {
  Int32, Int64,  Int16, Int8, Float32, Float64,
  Dictionary,
  Binary, Utf8,
  Uint8,
  Uint16,
  Uint32,
  makeVector,
  makeBuilder,
  vectorFromArray,
  tableToIPC,
  tableFromIPC,
  Table, Vector, tableFromArrays} from 'apache-arrow';

import earcut from 'earcut';

import { geoPath } from 'd3-geo';

import { geoProject } from 'd3-geo-projection';
import { extent, range } from 'd3-array';

import clip from 'polygon-clipping';

export default class TriFeather {

constructor(bytes) {
  this.bytes = bytes
  this.t = tableFromIPC(bytes)
}

get n_coords() {
  this.coord_buffer;
  return this._n_coords;
}

get coord_buffer() {
  if (this._coord_buffer) {
    return this._coord_buffer
  }
  const d = this.t.get(0).vertices;
  this._coord_bytes = d.byteOffset
  this._n_coords = (d.byteLength/4/2)
  this._coord_buffer = new DataView(d.buffer, d.byteOffset, d.byteLength)
  return this._coord_buffer
}

static polygon_to_triangles(polygon) {
  // Actually perform the earcut work on a polygon.
  const el_pos = []
  const coords = polygon.flat(2)
  const vertices = earcut(...Object.values(earcut.flatten(polygon)))
  return { coords, vertices }
}


static from_feature_collection(feature_collection,
                                projection,
                                options = {dictionary_threshold: .75, clip_to_sphere: false}) {

  if (projection === undefined) {throw "Must define a projection"}
  // feature_collections: a (parsed) geoJSON object.
  // projection: a d3.geoProjection instance;
  // eg, d3.geoMollweide().translate([10, 20])
  // options:

  const properties = new Map()
  // Stores the number of bytes used for the coordinates.
  const coord_resolutions = [null]
  const coord_buffer_offset = [null]
  // centroids let you have fun with shapes. Store x and y separately.
  const centroids = [[null], [null]]
  const bounds = [null]
  // Storing areas makes it possible to weight centroids.
  const areas = [null]
  let i = -1;

  const path = geoPath()
  let clip_shape;

  let projected = geoProject(feature_collection, projection)
  console.log(projected.features[0].geometry.coordinates.flat(1))
  if (options.clip_to_sphere) {
    clip_shape = geoProject({"type": "Sphere"}, projection)
    for (let feature of projected.features) {
      const new_coords = clip.intersection(feature.coordinates, clip_shape.coordinates)
      if (projected.type == "Polygon" && typeof(new_coords[0][0][0] != "numeric")) {
        projected.type = "MultiPolygon"
      }
      feature.coordinates = new_coords
    }
  }
  const {indices, points} = this.lookup_map_and_coord_buffer(projected)
  const coord_indices = indices;
  const coord_codes = points;

  // Stash the vertices in the first item of the array.
  const vertices = [new Uint8Array(coord_codes.buffer)]
  properties.set("id", ["Dummy feather row"])

  i = 0;
  for (let feature of projected.features) {
    // start at one; the first slot is reserved for caching the full
    // feature list
    i++;
    properties.get("id")[i] = feature.id || `Feature_no_${i}`

    for (let [k, v] of Object.entries(feature.properties)) {
      if (!properties.get(k)) {properties.set(k, [])}
      if (typeof(v) === "object") {
        properties.get(k)[i] = JSON.stringify(v)
        continue
      }
      properties.get(k)[i] = v
    }

    const projected = feature.geometry
    const [x, y] = path.centroid(projected)
    const bbox = vectorFromArray(path.bounds(projected).flat())

    centroids[0][i] = x; centroids[1][i] = y
    areas[i] = path.area(projected)
    bounds[i] = bbox
    let loc_coordinates;
    if (projected === null) {
      console.warn("Error on", projected)
      coord_resolutions[i] = null
      vertices[i] = null
      continue
    } else if (projected.type == "Polygon") {
      loc_coordinates = [projected.coordinates]
    } else if (projected.type == "MultiPolygon") {
      loc_coordinates = projected.coordinates
    }  else {
      throw "All elements must be polygons or multipolgyons."
    }
      let all_coords = []
      let all_vertices = []
      for (let polygon of loc_coordinates) {
        const { coords, vertices } = TriFeather.polygon_to_triangles(polygon);
        // Allow coordinate lookups by treating them as a single 64-bit int.
        const r = new Float32Array(coords.flat(3).buffer)
        const bigint_coords = new Float64Array(makeVector(r));
        // Reduce to the indices of the master lookup table.
        for (let vertex of vertices) {
          all_vertices[all_vertices.length] = coord_indices.get(bigint_coords[vertex])
        }
//        const lookup_points = vertices.map(vx => coord_indices.get(bigint_coords[vx]))
//        all_vertices.push(...lookup_points)
      }
      const [start, end] = extent(all_vertices)
      const diff = end - start

      coord_buffer_offset[i] = (start)

      // Normalize the vertices around the lowest element.
      // Allows some vertices to be stored at a lower resolution.
      for (let j=0; j<all_vertices.length; j++) {
        all_vertices[j] = all_vertices[j]-start
      }

      // Determine the type based on the offset.
      let MyArray
      if (diff < 2**8) {
        coord_resolutions[i] = 8
        MyArray = Uint8Array
      } else if (diff < 2**16) {
        coord_resolutions[i] = 16
        MyArray = Uint16Array
      } else {
        // Will not allow more than 4 billion points on a single feature,
        // should be fine.
        coord_resolutions[i] = 32
        MyArray = Uint32Array
      }
      vertices[i] = MyArray.from(all_vertices)
    }
    const cols = {
      "vertices": this.pack_binary(vertices),
      "bounds": this.pack_binary(bounds),
      "coord_resolution": vectorFromArray(coord_resolutions, new Uint8),
      "coord_buffer_offset": vectorFromArray(coord_buffer_offset, new Uint32),
      "pixel_area": vectorFromArray(areas, new Float64),
      "centroid_x": vectorFromArray(centroids[0], new Float32),
      "centroid_y": vectorFromArray(centroids[1], new Float32)
    }
    for (const [k, v] of properties.entries()) {
      if (k in cols) {
        // silently ignore.
        //throw `Duplicate column names--rename ${k} `;
      }
      const builder = makeBuilder({
        type: this.infer_type(v, options.dictionary_threshold),
        nullValues: [null, undefined],
        highWaterMark: 2**16
      })
      for (let el of v) { builder.append(el)  }

      cols[k] = builder.finish().toVector()
    }
    const tab = new Table(cols)

    const afresh = tableToIPC(tab)
    return new TriFeather(afresh)

  }


  static infer_type(array, dictionary_threshold = .75) {
    // Certainly reinventing the wheel here--
    // determine the most likely type of something based on a number of examples.

    // Dictionary threshold: a number between 0 and one. Character strings will be cast
    // as a dictionary if the unique values of the array are less than dictionary_threshold
    // times as long as the length of all (not null) values.
    const seen = new Set()
    let strings = 0
    let floats = 0
    let max_int = 0

    for (let el of array) {

      if (Math.random() > 200/array.length) {continue} // Only check a subsample for speed. Try
      // to get about 200 instances for each row.
      if (el === undefined || el === null) {
        continue
      }
      if (typeof(el) === "object") {
        strings += 1
        seen.add(Math.random())
      }
        if (typeof(el) === "string") {
          strings += 1
          seen.add(el)
        } else if (typeof(el) === "number") {
          if (el % 1 > 0) {
            floats += 1
          } else if (isFinite(el)) {
            max_int = Math.max(Math.abs(el), max_int)
          } else {

          }
        } else if (typeof(el) === "boolean") {
          
        } else {
          console.warn(el);
          throw `Can't convert ${el} to arrow: no behavior defined for type ${typeof(el)}`
        }
      }
      if ( strings > 0 ) {
        // moderate overlap
        if (seen.length < strings.length * .75) {
          return new Dictionary(new Utf8(), new Int32())
        } else {
          return new Utf8()
        }
      }
      if (floats > 0) {
        return new Float32()
      }
      if (Math.abs(max_int) < 2**8) {
        return new Int32()
      }
      if (Math.abs(max_int) < 2**16) {
        return new Int32()
      }
      if (Math.abs(max_int) < 2**32) {
        return new Int32()
      } else {
        return new Int64()
      }

    }


      coord(ix) {
        // NB this manually specifies little-endian, although
        // Arrow can potentially support big-endian frames under
        // certain (future?) circumstances.
        return [
          this.coord_buffer.getFloat32(ix*4*2, true),
          this.coord_buffer.getFloat32(ix*2*4 + 4, true)
        ]
      }
      static pack_binary(els) {
        const binaryBuilder = makeBuilder({
          type: new Binary(),
          nullValues: [null, undefined],
          highWaterMark: 2**16
        });
        for (let el of els) { binaryBuilder.append(el)  }
        return binaryBuilder.finish().toVector()
      }


      bind_to_regl(regl) {
        this.regl = regl
        this.element_handler = new Map();
        // Elements can't share buffers (?) so just use a map.
        this.regl_coord_buffer = regl.buffer(
          {data: this.t.get(0).vertices, type: "float", usage: "static"})
        this.prepare_features_for_regl()

      }

  prepare_features_for_regl() {
    this.features = []
    const {t, features, regl, element_handler, regl_coord_buffer} = this;
    // Start at 1, not zero, to avoid the dummy.
    for (let ix = 1; ix<this.t.length; ix++) {
      const feature = this.t.get(ix)
      element_handler.set(
        ix,
        this.regl.elements({
          primitive: 'triangles',
          usage: 'static',
          data: feature.vertices,
          type: "uint" + feature.coord_resolution,
          length: feature.vertices.length, // in bytes
          count: feature.vertices.length / feature.coord_resolution * 8
      }))
      const f = {
        ix,
        vertices: element_handler.get(ix),
        coords: {
          buffer: this.regl_coord_buffer, 
          stride: 8, 
          offset: feature.coord_buffer_offset * 8},
        properties: feature
      }; // Other data can be bound to this object if desired, which makes programming easier than
      // working off the static feather frame.
      features.push(f)
    }

}

get bbox() {
  if (this._bbox) {return this._bbox}
    this._bbox =  {
  x: extent(range(this.n_coords).map(i => this.coord(i)[0])),
  y: extent(range(this.n_coords).map(i => this.coord(i)[1])),
}
  return this._bbox
}
*[Symbol.iterator]() {
   for (let feature of this.features) {
      yield feature
   }
  }

      static lookup_map_and_coord_buffer (geojson) {
        const all_coordinates = new Float32Array(geojson.features.filter(d => d.geometry).map(d => d.geometry.coordinates).flat(4))
        const feature_collection = geojson
        const codes = new Float64Array(all_coordinates.buffer)
        const indices = new Map()
        for (let code of codes) {
          if (!indices.has(code)) {
            indices.set(code, indices.size)
          }
        }
        const points = new Float64Array(indices.size)
        for (let [k, v] of indices.entries()) {
          points[v] = k
        }
        return {indices, points}
      }
    }
