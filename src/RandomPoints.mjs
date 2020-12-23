import arrow from 'apache-arrow';
const { Table, Uint8Vector, Float32Vector } = arrow;
import sh from 'd3-array'
const { shuffler, sum, range, extent } = sh
import rand from 'd3-random' 
const { randomLcg } = rand;

console.log("Random points loaded")

export function random_points(frame, fields, n_represented = 1, value = "feather") {
  const counts_by_field = fields.map(field => sum(frame.t.getColumn(field).toArray()))
  const all_coords = fields.map((f, i) => new Float32Array(Math.round(counts_by_field[i]/n_represented * 2.05)))
  let coord_positions = all_coords.map(() => -2);
  // Overallocate a bit.

  const xs = [];
  const ys = [];
  const ts = [];
  
  let current_field = -1; 
  for (let ix of range(frame.t.length)) {
    const f = frame.t.get(ix);
    if (f.coord_resolution === null) {continue}
    const vert_buffer = new DataView(f.vertices.buffer, f.vertices.byteOffset, f.vertices.byteLength)
    let double_areas = fields.map(k => f.pixel_area * 2)// save an op later by doubling here.  
    let number_neededs = fields.map(k => randround(f[k]/n_represented))
    // number_needed = 3;
    // The current triangle in ax,ay,bx,by,cx,cy order

    let current_number = -2;
    const metadata = []
    const stride = f.coord_resolution / 8
    const offset = f.coord_buffer_offset; 
    
    
    for (let i = 0; i < f.vertices.byteLength; i += stride * 3) {
      let a, b, c
      try {
      [a, b, c] = ([0, 1, 2]).map(ix => vert_buffer[`getUint${f.coord_resolution}`](i + ix*stride, true)).map(n => frame.coord(n+ offset))
      } catch {
        return {f, current_number, i, byte_length: f.vertices.byteLength}
      }

      const area = Math.abs(
        a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])
      )//earcut seems to always return triangles in a form where the absolute
      // value isn't necessary.

      for (let f_num of range(fields.length)) {
        const share = area/double_areas[f_num]
        double_areas[f_num] -= area
        let how_many_points_do_i_get = randround(number_neededs[f_num] * share)
        for (let i = 0; i < how_many_points_do_i_get; i++) {
     
          // Assign no more if we're at the cap.
          if ((number_neededs[f_num] -= 1) < 0) {break}
          if (coord_positions[f_num] > (all_coords[f_num].length - 2)) {break}
          
          if (value === "feather") {
          const [x, y] = random_point(a, b, c)
          //if (Math.random() < .0001) {console.log(x, y)}
          xs[current_field++] = 0 + x 
          ys[current_field] = 0 + y;
          ts[current_field] = f_num;
          coord_positions[f_num] += 2
        } else {
          all_coords[f_num].set(random_point(a, b, c), coord_positions[f_num] += 2) 
        }
        }     
        }
      }
  }  
  
  if (value === "feather") {

    // Some major advantages to having them sort randomly. So let's do it.
    /*let random, shuffle;
    random = randomLcg(0.9051667019185816);
    shuffle = shuffler(random);
    shuffle(xs)
    random = randomLcg(0.9051667019185816);
    shuffle = shuffler(random);
    shuffle(ys)
    random = randomLcg(0.9051667019185816);
    shuffle = shuffler(random);
    shuffle(ts)*/
    const my_table2 = Table.new(
      [Float32Vector.from(xs),Float32Vector.from(ys), Uint8Vector.from(ts)],
      ['x', 'y', 'class']
    )
    console.log({l_length: ys.length, t_length: ts.length})
    return my_table2
    
  }
  return all_coords.map( (c, i) => c.slice(0, coord_positions[i]) )
}



function randround(how_many_points_do_i_get) {
  const leftover = how_many_points_do_i_get % 1;
  // Random round to decide if you get a fractional point.
  if (Math.random() > leftover) {
    how_many_points_do_i_get -= leftover
  } else {
    how_many_points_do_i_get += (1 - leftover)
  }
  return how_many_points_do_i_get
}


function random_point([ax, ay], [bx, by], [cx, cy]) {
  const a = [bx - ax, by - ay]
  const b = [cx - ax, cy - ay]
  let [u1, u2] = [Math.random(), Math.random()]
  if (u1 + u2 > 1) {u1 = 1 - u1; u2 = 1 - u2}
  const w = [u1 * a[0] + u2 * b[0], u1 * a[1] + u2 * b[1]]
  return [w[0] + ax, w[1] + ay]  
}
