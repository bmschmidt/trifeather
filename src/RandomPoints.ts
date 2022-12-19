import {
  Table,
  Uint8,
  Dictionary,
  Float32,
  Utf8,
  Int16,
  Int8,
  vectorFromArray,
  tableFromArrays,
} from "apache-arrow";
import { shuffle, sum, range, extent, min } from "d3-array";

export function random_points(
  frame,
  fields,
  n_represented = 1,
  value = "feather",
  keep = [],
  names = ["category"],
  delim = "_"
) {
  /*

  */
  // Usually this can just be a number.
  let targets = fields.map((f) => []);
  let total_counts = 0;
  let ix = 0;
  for (let field of fields) {
    // NB we are one-indexed here.
    for (let i of range(1, frame.t.numRows)) {
      const feature = frame.t.get(i);
      if (feature.coord_resolution === null) {
        continue;
      }
      const target = randround(feature[field] / n_represented);
      total_counts += target || 0;
      // un one-index
      targets[ix][i - 1] = target || 0;
    }
    ix++;
  }
  console.log(`Preparing to generate ${total_counts} points`);
  const x_array = new Float32Array(total_counts);
  const y_array = new Float32Array(total_counts);
  const field_array =
    fields.length > 127
      ? new Int16Array(total_counts)
      : new Int8Array(total_counts);
  const keepers = keep.map((key) => new Array(total_counts).fill(""));
  const ix_array = range(total_counts);

  // We are going to place these points randomly.
  // Important for overplotting.

  shuffle(ix_array);

  let overall_position = 0;
  for (let i_ of range(1, frame.t.numRows)) {
    const feature = frame.t.get(i_);
    const keep_values = keep.map((key) => feature[key]);
    const i = i_ - 1; // Because the other thing is one-indexed;
    const vert_buffer = new DataView(
      feature.vertices.buffer,
      feature.vertices.byteOffset,
      feature.vertices.byteLength
    );
    let local_targets = targets.map((d) => d[i]);
    let offset = feature.coord_buffer_offset;
    // earcut seems to always return triangles in a form where the absolute
    // value isn't necessary.
    const stride = feature.coord_resolution / 8; // Bytes, not bits.

    const triangles = [];
    for (
      let tri_number = 0;
      tri_number < feature.vertices.byteLength;
      tri_number += stride * 3
    ) {
      let a, b, c;
      //      console.log(vert_buffer.getUint32(tri_number + ix*stride, true))
      //      console.log(vert_buffer[`getUint${feature.coord_resolution}`](tri_number + ix*stride, true))

      try {
        [a, b, c] = [0, 1, 2]
          .map((ix) =>
            vert_buffer[`getUint${feature.coord_resolution}`](
              tri_number + ix * stride,
              true
            )
          )
          .map((n) => frame.coord(n + offset));
      } catch {
        console.log({
          feature,
          stride,
          i,
          byte_length: feature.vertices.byteLength,
        });
        throw "Yikes--hit some observable debugging code here.";
      }
      const double_area = Math.abs(
        a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])
      );
      triangles.push({ a, b, c, double_area });
    }

    let double_areas = sum(triangles, (d) => d.double_area);

    for (let { a, b, c, double_area } of triangles) {
      if (double_area == 0) {
        continue;
      }
      const share_of_remaining = double_area / double_areas;
      double_areas -= double_area;
      if (share_of_remaining < 0) {
        if (local_targets.every((d) => d == 0)) {
          continue;
        }
      }
      for (let f_num of range(local_targets.length)) {
        let how_many_points_do_i_get = randround(
          local_targets[f_num] * share_of_remaining
        );
        how_many_points_do_i_get = min([
          how_many_points_do_i_get,
          local_targets[f_num],
        ]);
        if (how_many_points_do_i_get <= 0) {
          continue;
        }
        for (let i = 0; i < how_many_points_do_i_get; i++) {
          const [x, y] = random_point(a, b, c);
          //          console.log({x, y})
          const writing_to = ix_array[overall_position++];
          x_array[writing_to] = x;
          y_array[writing_to] = y;
          for (let i = 0; i < keep.length; i++) {
            keepers[i][writing_to] = keep_values[i];
          }
          field_array[writing_to] = f_num;
          local_targets[f_num] -= 1;
        }
      }
    }
  }
  // Hard to imagine someone needing more than 2**16 entries here...

  const dictionaries = [];
  // Split the names by the delimiter and turn each
  // into a dictionary column.
  names.forEach((column_name, column_number) => {
    const codes = [];
    const strings = [];
    fields.forEach((multi_field, multi_field_number) => {
      const field = multi_field.split(delim)[column_number];
      if (strings.indexOf(field) == -1) {
        strings.push(field);
      }
      codes[multi_field_number] = strings.indexOf(field);
    });
    let dict_type;
    let subset_array;
    if (strings.length <= 127) {
      dict_type = new Int8();
      subset_array = new Int8Array(field_array.length);
    } else {
      dict_type = new Int16();
      subset_array = new Int16Array(field_array.length);
    }
    for (let i = 0; i < field_array.length; i++) {
      subset_array[i] = codes[field_array[i]];
    }
    const classes = vectorFromArray(
      strings,
      new Dictionary(new Utf8(), dict_type)
    );
    dictionaries.push(classes);
  });

  const my_table2 = new tableFromArrays({
    x: vectorFromArray(x_array, new Float32()),
    y: vectorFromArray(y_array, new Float32()),
    ...keep.reduce(
      (acc, d, i) => ({ ...acc, [d]: vectorFromArray(keepers[i], new Utf8()) }),
      {}
    ),
    ...names.reduce((acc, d, i) => ({ ...acc, [d]: dictionaries[i] }), {}),
  });
  console.log(dictionaries);
  console.log(my_table2.get(100));
  return my_table2;
}

function randround(how_many_points_do_i_get) {
  const leftover = how_many_points_do_i_get % 1;
  // Random round to decide if you get a fractional point.
  if (Math.random() > leftover) {
    return how_many_points_do_i_get - leftover;
  } else {
    return how_many_points_do_i_get + (1 - leftover);
  }
}

function random_point([ax, ay], [bx, by], [cx, cy]) {
  const a = [bx - ax, by - ay];
  const b = [cx - ax, cy - ay];
  let [u1, u2] = [Math.random(), Math.random()];
  if (u1 + u2 > 1) {
    u1 = 1 - u1;
    u2 = 1 - u2;
  }
  const w = [u1 * a[0] + u2 * b[0], u1 * a[1] + u2 * b[1]];
  return [w[0] + ax, w[1] + ay];
}
