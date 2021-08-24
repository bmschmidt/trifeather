import { Table, Uint8Vector, Float32Vector, DictionaryVector, Utf8Vector, Int32, Int8 } from '@apache-arrow/es5-cjs'
import { shuffle, sum, range, extent, min } from 'd3-array';

function random_points2(frame, fields, n_represented = 1, value = "feather", keep = []) {
  
  let targets = fields.map(f => [])
  
  let field_goals = fields.map(f => 0)
  let field_written = fields.map(f => 0)
  
  let total_counts = 0
  let ix = 0;
  for (let field of fields) {
   // NB we are one-indexed here.
   for (let i of range(1, frame.t.length)) {
     const feature = frame.t.get(i);
     if (feature.coord_resolution === null) {continue}
     const target = randround(feature[field] / n_represented)
     if (target < 0) {
       console.log("WTF", feature[field], feature)
     }
     total_counts += target || 0
     // un one-index
     targets[ix][i - 1] = target || 0
     field_goals[ix] += target
    }
    ix++;
  }
  console.log(`Preparing to generate ${total_counts} points`)
  const x_array = new Float32Array(total_counts)
  const y_array = new Float32Array(total_counts)
  const field_array = fields.length > 127 ? new Int16Array(total_counts) : new Int8Array(total_counts)
  const keepers = keep.map(key => new Array(total_counts).fill(""))
  const ix_array = range(total_counts)

  // We are going to place these points randomly.
  // Important for overplotting.

  shuffle(ix_array)

  let overall_position = 0;
  let written = 0
  // For each feature
  for (let i_ of range(1, frame.t.length)) {
    const feature = frame.t.get(i_);
    // stash some things as metadata
    const keep_values = keep.map(key => feature[key])
    const i = i_ - 1 // Because this thing is one-indexed, feature number is off by one.;
    const vert_buffer = new DataView(feature.vertices.buffer, feature.vertices.byteOffset, feature.vertices.byteLength)
    
    let local_targets = targets.map(d => d[i])
    let offset = feature.coord_buffer_offset
    const stride = feature.coord_resolution / 8; // Bytes, not bits.

    const triangles = []
    for (let tri_number = 0; tri_number < feature.vertices.byteLength; tri_number += stride * 3) {
      let a, b, c;
      [a, b, c] = ([0, 1, 2])
        .map(ix => vert_buffer[`getUint${feature.coord_resolution}`](tri_number + ix*stride, true)).map(n => frame.coord(n + offset))
      const double_area = Math.abs(
        a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])
      )
      triangles.push({a, b, c, double_area, class_counts : local_targets.map(d => 0) })
    }

    let double_areas = sum(triangles, d => d.double_area)

    // Largest to smallest.
    
    triangles.sort((a, b) => a.double_area - b.double_area)
    
    triangles.forEach(d => d.share = d.double_area/double_areas)
    
    for (let f_num of range(local_targets.length)) {
      let allocated = 0;
      let previously_allocated = 0;
      feature_loop : while (allocated < local_targets[f_num]) {
        triangle_loop : for (let triangle of triangles) {
          let deserved = randround((local_targets[f_num] - previously_allocated) * triangle.share)
          if (deserved === 0) {
            continue triangle_loop
          }
          if (allocated + deserved > local_targets[f_num]) {
            // Can't ask for more than all the remaining points.
            deserved = local_targets[f_num] - allocated
          }
          allocated += deserved
          triangle.class_counts[f_num] += deserved
          if (allocated >= local_targets[f_num]) {
            break feature_loop
          }
          previously_allocated = allocated
        }
        // Redo the process for the leftover items.
      }
//      if (allocated != local_targets[f_num])       console.log(allocated, local_targets[f_num])
    }
    for (let {a, b, c, double_area, class_counts} of triangles) {
      for (let f_num of range(local_targets.length)) {
        let i = 0;
        while (i++ < class_counts[f_num]) {
          const [x, y] = random_point(a, b, c)
          const writing_to = ix_array[overall_position++]
          field_written[f_num] += 1
          written += 1
          x_array[writing_to] = x;
          y_array[writing_to] = y;
          let j = 0;
          while (j++ < keep.length) {          
            keepers[i][writing_to] = keep_values[i]
          }
          field_array[writing_to] = f_num
        }
      }
    }
  }
  console.log(field_written, field_goals)
  console.log(`Written to ${overall_position} or ${written} points`)
//  console.log({overall_position, total_counts})
  // Hard to imagine someone needing more than 2**16 entries here...
  const dict_type = fields.length <= 127 ? new Int8() : new Int16()
  const classes = DictionaryVector.from(
    Utf8Vector.from(fields),
    dict_type,
    field_array
  )
  const my_table2 = Table.new(
    [
      Float32Vector.from(x_array),
      Float32Vector.from(y_array),
      classes,
      ...keep.map((d, i) => Utf8Vector.from(keepers[i]))
    ],
    ['x', 'y', 'category', ...keep]
  )
  return my_table2
}


export function random_points(frame, fields, n_represented = 1, value = "feather", keep = []) {
  /*

  */
  // Usually this can just be a number.
  let targets = fields.map(f => [])
  let total_counts = 0
  let ix = 0;
  for (let field of fields) {
   // NB we are one-indexed here.
   for (let i of range(1, frame.t.length)) {
     const feature = frame.t.get(i);
     if (feature.coord_resolution === null) {continue}
     const target = randround(feature[field]/n_represented)
     total_counts += target || 0
     // un one-index
     targets[ix][i - 1] = target || 0
    }
    ix++;
  }
  console.log(`Preparing to generate ${total_counts} points`)
  const x_array = new Float32Array(total_counts)
  const y_array = new Float32Array(total_counts)
  const field_array = fields.length > 127 ? new Int16Array(total_counts) : new Int8Array(total_counts)
  const keepers = keep.map(key => new Array(total_counts).fill(""))
  const ix_array = range(total_counts)

  // We are going to place these points randomly.
  // Important for overplotting.

  shuffle(ix_array)

  let overall_position = 0;
  for (let i_ of range(1, frame.t.length)) {
    const feature = frame.t.get(i_);
    const keep_values = keep.map(key => feature[key])
    const i = i_ - 1 // Because the other thing is one-indexed;
    const vert_buffer = new DataView(feature.vertices.buffer, feature.vertices.byteOffset, feature.vertices.byteLength)
    let local_targets = targets.map(d => d[i])
    let offset = feature.coord_buffer_offset
      // earcut seems to always return triangles in a form where the absolute
      // value isn't necessary.
    const stride = feature.coord_resolution / 8; // Bytes, not bits.

    const triangles = []
    for (let tri_number = 0; tri_number < feature.vertices.byteLength; tri_number += stride * 3) {
      let a, b, c;
      try {
      [a, b, c] = ([0, 1, 2])
        .map(ix => vert_buffer[`getUint${feature.coord_resolution}`](tri_number + ix*stride, true)).map(n => frame.coord(n + offset))
      } catch {
        console.log({feature, stride, i, byte_length: feature.vertices.byteLength})
        throw "Yikes--hit some observable debugging code here."
      }
      const double_area = Math.abs(
        a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])
      )
      triangles.push({a, b, c, double_area})
    }

    let double_areas = sum(triangles, d => d.double_area)

    for (let {a, b, c, double_area} of triangles) {

      if (double_area == 0) {
        continue
      }
      const share_of_remaining = double_area/double_areas
      double_areas -= double_area
      if (share_of_remaining < 0) {
        if (local_targets.every(d => d == 0)) {
          continue
        }
        console.log({share_of_remaining, id: feature.GEOID, overall_position, local_targets})
      }

      for (let f_num of range(local_targets.length)) {
        let how_many_points_do_i_get = randround(local_targets[f_num] * share_of_remaining)
        how_many_points_do_i_get = min([how_many_points_do_i_get, local_targets[f_num]])
        if (how_many_points_do_i_get <= 0) {continue}
        for (let i = 0; i < how_many_points_do_i_get; i++) {
          const [x, y] = random_point(a, b, c)
          const writing_to = ix_array[overall_position++]
          x_array[writing_to] = x;
          y_array[writing_to] = y;
          for (let i = 0; i < keep.length; i++) {
            keepers[i][writing_to] = keep_values[i]
          }
          field_array[writing_to] = f_num
          local_targets[f_num] -= 1
        }
      }
    }
  }
  console.log({overall_position, total_counts})
  // Hard to imagine someone needing more than 2**16 entries here...
  const dict_type = fields.length <= 127 ? new Int8() : new Int16()
  const classes = DictionaryVector.from(
    Utf8Vector.from(fields),
    dict_type,
    field_array
  )
  const my_table2 = Table.new(
    [
      Float32Vector.from(x_array),
      Float32Vector.from(y_array),
      classes,
      ...keep.map((d, i) => Utf8Vector.from(keepers[i]))
    ],
    ['x', 'y', 'category', ...keep]
  )
  return my_table2
}

function randround(how_many_points_do_i_get) {
  const leftover = how_many_points_do_i_get % 1;
  // Random round to decide if you get a fractional point.
  if (Math.random() > leftover) {
    return how_many_points_do_i_get - leftover
  } else {
    return how_many_points_do_i_get + (1 - leftover)
  }
}


function random_point([ax, ay], [bx, by], [cx, cy]) {
  const a = [bx - ax, by - ay]
  const b = [cx - ax, cy - ay]
  let [u1, u2] = [Math.random(), Math.random()]
  if (u1 + u2 > 1) {u1 = 1 - u1; u2 = 1 - u2}
  const w = [u1 * a[0] + u2 * b[0], u1 * a[1] + u2 * b[1]]
  return [w[0] + ax, w[1] + ay]
}
