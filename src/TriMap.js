import { rgb } from 'd3-color';
import { range, extent as d3extent, mean } from 'd3-array';
import { scaleSqrt, scaleLinear, scaleOrdinal } from 'd3-scale';
import { select } from 'd3-selection';
import { zoom } from 'd3-zoom';

const greys = function () {
  const out = []
  for (let i of range(10)) {
    for (let j of range(10)) {
      for (let k of range(10)) {
        out.push([118 + i * 2, 118 + j*2, 118 + k*2, 255]) 
      }
    }
  }
  return out  
}()

const greyscale = scaleOrdinal().range(greys)
  
  const copy_shader = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform float wRcp, hRcp;
void main() {
  vec4 c = texture2D(tex, uv);
  if (c.a > 0.) {
    gl_FragColor = c;
  } else {
    discard;
  }
}        
`

const alpha_color_merge = `
precision mediump float;
  varying vec2 uv;
  uniform sampler2D color;
  uniform sampler2D alpha;
  uniform float wRcp, hRcp;
  void main() {
  vec4 col = texture2D(color, uv);
  vec4 alph = texture2D(alpha, uv);
  float a = alph.a;
  if (a < 1./255.) {
    discard;
  } else if (col.a == 0.) {
    discard;
  } else if (a < .99) {
    a = .25;
  } else {
    a = 0.75;
    // col = vec4(.5, .5, .5, 1.);
  }
  gl_FragColor = vec4(col.rgb * a, a);
  }               
`

const edge_propagation = `precision mediump float;
          varying vec2 uv;
          uniform sampler2D tex;
          uniform float wRcp, hRcp;
          uniform float u_decay;
          void main() {
            // The immediate neighbors
            vec4 maxlr = max(texture2D(tex, uv + vec2(wRcp, 0.)), texture2D(tex, uv + vec2(-wRcp, 0.)));
            vec4 maxud = max(texture2D(tex, uv + vec2(0., hRcp)), texture2D(tex, uv + vec2(0., -hRcp)));    
            vec4 max_neighbor1 = max(maxlr, maxud) * u_decay;
            // Corners
            vec4 maxulur = max(texture2D(tex, uv + vec2(wRcp, hRcp)), texture2D(tex, uv + vec2(-wRcp, hRcp)));
            vec4 maxlllr = max(texture2D(tex, uv + vec2(wRcp, -hRcp)), texture2D(tex, uv + vec2(-wRcp, -hRcp)));
            vec4 max_neighbor2 = max(maxulur, maxlllr) * pow(u_decay, 1.414); // i.e., sqrt(2)

            vec4 max_neighbor = max(max_neighbor1, max_neighbor2);

            vec4 current = texture2D(tex, uv);
            gl_FragColor = max(max_neighbor, current);
          }
`

const edge_detection = `
          precision mediump float;
          varying vec2 uv;
          uniform sampler2D tex;
          uniform float wRcp, hRcp;
          void main() {
            // 4 adjacent pixels; left, right, up down.
            vec4 l =  texture2D(tex, uv + vec2(-wRcp, 0.));
            vec4 r =  texture2D(tex, uv + vec2(wRcp, 0.));
            vec4 u =  texture2D(tex, uv + vec2(0., hRcp));
            vec4 d =  texture2D(tex, uv + vec2(0., -hRcp));            
            vec4 around = (l + r + u + d) / 4.;
            vec4 current = texture2D(tex, uv);
            if (distance(around, current) < 0.00001) {
                gl_FragColor = vec4(0., 0., 0., 0.);           
            } else {
              gl_FragColor = vec4(0., 0., 0., 1.);
            }
          }
        `





function rgb2glcolor(col) {
  const {r, g, b} = rgb(col)
  return [r, g, b, 255]
}

export default class TriMap {
  constructor(div, layers, regl) {
    this.div = div
    this.regl =regl
    for (let layer of layers) {
      layer.bind_to_regl(this.regl) 
    }
    this.layers = layers;

    const {width, height} = div
    this.width = width || window.innerWidth
    this.height = height || window.innerHeight
    this.set_magic_numbers()
    this.prepare_div(width, height)
    this.color_map = this.regl.texture( {
      width: 128,
      format: "rgba", 
      height: 1,
      data: range(128*4)})

    this.set_renderer()

    this.random_points = []
  }

  add_layer(layer) {
    layer.bind_to_regl(this.regl)
    this.layers.push(layer)

  }
  reglize_frag(regl, frag_shader = edge_detection, blend = false) {
    // Turn a frag shader into a regl call.
    return regl({
          blend: {
            enable: blend,
            func: {
              srcRGB: 'one',
              srcAlpha: 'one',
              dstRGB: 'one minus src alpha',
              dstAlpha: 'one minus src alpha',
            }
          },
          frag: frag_shader,
          vert: `
            precision mediump float;
            attribute vec2 position;
            varying vec2 uv;
            void main() {
              uv = 0.5 * (position + 1.0);
              gl_Position = vec4(position, 0, 1);
            }
          `,
          attributes: {
            position: this.fill_buffer
          },
          depth: { enable: false },
          count: 3,
          uniforms: {
            u_decay: (_, {decay}) => decay,
            tex: (_, {layer}) => layer,
            color: (_, {color}) => color,
            alpha: (_, {alpha}) => alpha,
            wRcp: ({viewportWidth}) => {return 1.0 / viewportWidth},
            hRcp: ({viewportHeight}) => 1.0 / viewportHeight
          },
        })
  }
  get fill_buffer() {
    if (!this._fill_buffer) {
      const { regl } = this;
      this._fill_buffer = regl.buffer(
        { data: [-4, -4, 4, -4, 0, 4] },
      );
    }

    return this._fill_buffer;
  }
  get filter() {
    return this._filter ? this._filter : function (d) {return true}
  }

  set filter(f) {
    this._filter = f
  }
  
  cleanup() {
    this.cleanup_point_buffers()
    this.cleanup_frame_buffers()
    this.cleanup_poly_buffers()

  }

  cleanup_poly_buffers() {
   // pass 
  }
  
  cleanup_frame_buffers() {
    if (this.buffers) {
      for (let buffer of this.buffers.values()) {
        buffer.destroy() 
      }
    }
  }

  fbo(name) {
    this.buffers = this.buffers || new Map()
    if (this.buffers.get(name)) {
      return this.buffers.get(name) 
    }
    const fbo = this.regl.framebuffer({
      width: this.width,
      height: this.height,
      stencil: false
    })
    this.buffers.set(name, fbo)
    return this.buffers.get(name)
  }


  
  set_magic_numbers() {
    
    // It's a major pain to align regl with d3 scales.
    
    const { layers, width, height } = this;
    
    const extent = JSON.parse(JSON.stringify(layers[0].bbox));
    for (let layer of layers) {
      if (layer.t.get(0).get("holc_id")) {
        continue 
      }
     const { bbox } = layer
     extent.x = d3extent([...extent.x, ...bbox.x])
     extent.y = d3extent([...extent.y, ...bbox.y])
    }
    const scales = {};

    const scale_dat = {'x': {}, 'y': {}}

    for (let [name, dim] of [['x', width], ['y', height]]) {
      const limits = extent[name]
      scale_dat[name].limits = limits;
      scale_dat[name].size_range = limits[1] - limits[0]
      scale_dat[name].pixels_per_unit = dim / scale_dat[name].size_range
    }

    const data_aspect_ratio =
          scale_dat.x.pixels_per_unit / scale_dat.y.pixels_per_unit

    let x_buffer_size = 0, y_buffer_size = 0,
        x_target_size = width, y_target_size = height;
    if (data_aspect_ratio > 1) {
      // There are more pixels in the x dimension, so we need a buffer
      // around it.
      x_target_size = width / data_aspect_ratio;
      x_buffer_size = (width - x_target_size)/2
    } else {
      y_target_size = height * data_aspect_ratio;
      y_buffer_size = (height - y_target_size)/2
    }

    scales.x =
      scaleLinear()
      .domain(scale_dat.x.limits)
      .range([x_buffer_size, width-x_buffer_size])

    scales.y =
      scaleLinear()
      .domain(scale_dat.y.limits)
      .range([y_buffer_size, height-y_buffer_size])

    this.magic_numbers = window_transform(
      scales.x,
      scales.y, width, height)
      .map(d => d.flat())
  }

  prepare_div(width, height) {
    this.zoom = {transform: {k: 1, x: 0, y:0}}
    select(this.div)
      .call(zoom().extent([[0, 0], [width, height]]).on("zoom", (event, g) => {
      this.zoom.transform = event.transform
    }));
    return this.div;
  }

  get size_func() {
    return this._size_function ? this._size_function : () => 1
  }

  set size_func(f) {
    this._size_function = f
  }

  set color_func(f) {
    this._color_function = f
  }

  get index_color() {
    return function(f) {
      if (f._index_color) {return f._index_color}
      f._index_color = [0, 1, 2].map(d => 1 / 255 * Math.floor(Math.random() * 255))
      return f._index_color
    } 
  }

  get color_func() {
    //return d => [Math.random() * 255, Math.random() * 255, Math.random() * 255];
    return this._color_function ? this._color_function : p => greyscale(p.ix).slice(0, 3).map(c => c/255)
  }

  draw_edges(layer) {
    
    const {regl} = this;
    const colors = this.fbo("colorpicker")
    const edges = this.fbo("edges")

    colors.use(d => {
      this.regl.clear({color: [0, 0, 0, 0]})
      this.poly_tick(layer)
    })
/*    this.regl(() => {
      this.poly_tick(layer)
    }) */
    edges.use(() => {
      this.regl.clear({color: [1, 1, 1, 1]})
      const shader = this.reglize_frag(this.regl, edge_detection)
      shader({layer: colors})
    })

    // Copy the edges to a ping-pong shader to be blurred.

    const pingpong = [this.fbo("ping"), this.fbo("pong")]
    const copier = this.reglize_frag(this.regl, copy_shader)

    const { decay } = this;
    pingpong[0].use(() => {
      regl.clear({color: [0, 0, 0, 0]})
      copier({layer: edges})
    })

    const edge_propagator = this.reglize_frag(this.regl, edge_propagation)
    let alpha = 1
    while (alpha > 1/255) {
      pingpong[1].use(() => {
        regl.clear({color: [0, 0, 0, 0]})
        edge_propagator({layer: pingpong[0], decay: decay})
      })
      alpha *= decay
      // swap the buffers.
      pingpong.reverse()
    }
    const final_shade = this.reglize_frag(this.regl, alpha_color_merge, true)
    // First copy the blur
    
    final_shade({alpha: pingpong[0], color: colors})
//    copier({layer: colors})
  }

  get decay() {
    const pixels = 8;
    return Math.exp(Math.log(1/255)/pixels)
  }

  cleanup_point_buffers() {
    this.random_points.map(d => {
      d.x.destroy()
      d.y.destroy()
      d.f_num.destroy()
      d.ix.destroy()
    })    
  }

  generate_random_points(fields, represented=1, layers, clear = true, index_function) {
    if (clear) {
      this.cleanup_point_buffers()
      this._number_of_points = 0

      this.random_points = []
    }

    for (let layer of layers) {
      const { regl } = this;
      const {x_array, y_array, f_num_array} = random_points(layer, fields, represented, index_function);
      this._number_of_points += x_array.length
      let this_item = {
        x: regl.buffer(x_array),
        y: regl.buffer(y_array),
        f_num: regl.buffer(f_num_array), 
        ix: regl.buffer(range(x_array.length)),
        count: x_array.length,
      };
      this.random_points.push(this_item)
    }
  }


  point_tick() {
    const { regl } = this;
    const calls = []
    // multiple interleaved tranches prevent Trump or Biden from always being on top. This is
    // an issue with Williamson's maps, which over-represent the Hispanic population of DC because it
    // gets plotted last.

    const alpha_scale = scaleSqrt().domain([0, 500]).range([0, 1])
    for (let pointset of this.random_points) {
      calls.push({
        x: pointset.x,
        y: pointset.y,
        ix: pointset.ix,
        f_num: pointset.f_num,
        transform: this.zoom.transform,
        // Drops the last point in each tranch--needs a modulo operation to know how
        // many to expect.
        count: pointset.count,
        centroid: [0, 0],
        size: this.point_size ? this.point_size : 1,
        alpha: this.point_opacity > 1/255 ? this.point_opacity : 1/255
      })
    }
    this.render_points(calls)
  }

  tick(wut) {
    const { regl } = this
    regl.clear({
      color: [1, 1, 1, 1],
    })
    const alpha = 1
    if (wut === "points") {
      this.point_tick() 
    } else {
      for (let layer of this.layers) {
//        console.log(layer)
        this.draw_edges(layer)
        return;
      }
      this.fbo("points").use(d => {
        regl.clear({
          color: [0, 0, 0, 0]
        })
        this.point_tick()
      })

      const copier = this.reglize_frag(this.regl, copy_shader, true)
      copier({layer: this.fbo("points")})
    }

  }


  poly_tick(layer) {
    const calls = []
    let i = 0;
    for (let feature of layer) {
      //if (feature.properties['2020_tot'] === null) {continue}

      const {vertices, coords} = feature;
      
      calls.push({
        transform: this.zoom.transform,
        color: this.color_func(feature),
        u_blob: this.blob_func(feature),
        centroid: [feature.properties.centroid_x, feature.properties.centroid_y],
        size: this.size_func(feature),
        alpha: 1,
        vertices: vertices,
        coords: coords
      })
    }
    this.render_polygons(calls)
  }
  get blob_func() {
    return d => [1, 1, 0.0]
  }
  get point_vertex_shader() {
    return `
precision mediump float;
attribute float a_x;
attribute float a_y;
attribute float a_ix;
attribute float a_f_num;
uniform sampler2D u_color_map;

uniform float u_discard_prob;
uniform float u_size;
uniform vec2 u_centroid;
varying vec4 fragColor;
uniform float u_k;
uniform float u_time;
varying vec4 fill;

// Transform from data space to the open window.
uniform mat3 u_window_scale;
// Transform from the open window to the d3-zoom.
uniform mat3 u_zoom;
uniform mat3 u_untransform;
uniform float u_scale_factor;

float distortion_factor = exp(log(u_k)*u_scale_factor);

vec4 discard_me = vec4(-100., -100., 0., 1.);

float tau = 3.14159265358 * 2.;

highp float ix_to_random(in float ix, in float seed) {
  // For high numbers, taking the log avoids coincidence.
  highp float seed2 = log(ix) + 1.;
  vec2 co = vec2(seed2, seed);
  highp float a = 12.9898;
  highp float b = 78.233;
  highp float c = 43758.5453;
  highp float dt = dot(co.xy, vec2(a, b));
  highp float sn = mod(dt, 3.14);
  return fract(sin(sn) * c);
}

vec2 box_muller(in float ix, in float seed) {
  // Box-Muller transform gives you two gaussian randoms for two uniforms.
  highp float U = ix_to_random(ix, seed);
  highp float V = ix_to_random(ix, seed + 17.123123);
  return vec2(sqrt(-2. * log(U)) * cos(tau * V),
              sqrt(-2. * log(U)) * sin(tau * V));
}



// From another project
vec2 circle_jitter(in float ix, in float aspect_ratio, in float time,
                   in float radius, in float speed) {
  float rand1 = ix_to_random(ix, 3.0);
  float rand2 = ix_to_random(ix, 4.0);

  float stagger_time = rand1 * tau;

  // How long does a circuit take?
  
  float units_per_period = radius * radius * tau / 2.;
  float units_per_second = speed / 100.;
  float seconds_per_period = units_per_period / units_per_second;
  seconds_per_period = tau / speed;
  float time_period = seconds_per_period;
  if (time_period > 1e4) {
    return vec2(0., 0.);
  }

  // Adjust time from the clock to our current spot.
  float varying_time = time + stagger_time * time_period;
  // Where are we from 0 to 1 relative to the time period

  float relative_time = 1. - mod(varying_time, time_period) / time_period;

  float theta = relative_time * tau;

  return vec2(cos(theta), aspect_ratio * sin(theta)) *
         radius * rand2;
}


vec2 jitter(in float ix, in float radius) {
  return circle_jitter(ix, 1.2, u_time, radius, .5);
}

// We can bundle the three matrices together here for all shaders.
mat3 from_coord_to_gl = u_window_scale * u_zoom * u_untransform;
void main () {

vec2 position = vec2(a_x, a_y);



vec3 p = vec3(position, 1.) * from_coord_to_gl;

// vec2 jittered = jitter(a_ix, .0004 * distortion_factor) * distortion_factor;
// p = p + vec3(jittered.xy, 0.);

float my_offset = ix_to_random(a_ix, 3.2);
float keep_prob =  (1. - u_discard_prob);
// always stay on screen 10 seconds.
float time_period = 10./(keep_prob);
float fraction_of_time = fract(u_time / time_period);
float size_dilate = 0.;
float my_fract = fract(fraction_of_time + my_offset);
if (my_fract >= keep_prob) {
  gl_Position = discard_me;
  gl_PointSize = 0.;
  return;
} else {
  float fraction_within = my_fract / keep_prob;
  size_dilate = abs(1. - 4.*pow((.5 - fraction_within), 2.));
  size_dilate = clamp(size_dilate, 0., 1.);
}
gl_Position = vec4(p, 1.0);

gl_PointSize = u_size * distortion_factor * size_dilate; 

//gl_PointSize += exp(sin(u_time / 2. + a_f_num/6. * 2. * 3.1415));

fragColor = texture2D(u_color_map, vec2(a_f_num / 128., .5));

}
`}

  get vertex_shader() {return `
precision mediump float;
attribute vec2 position;
uniform float u_size;
uniform vec2 u_centroid;
varying vec4 fragColor;
uniform float u_k;
uniform float u_time;
uniform vec3 u_color;
varying vec4 fill;

// Transform from data space to the open window.
uniform mat3 u_window_scale;
// Transform from the open window to the d3-zoom.
uniform mat3 u_zoom;
uniform mat3 u_untransform;
uniform float u_scale_factor;
// rate, grittiness, blobbiness
uniform vec3 u_blob;
// We can bundle the three matrices together here for all shaders.
mat3 from_coord_to_gl = u_window_scale * u_zoom * u_untransform;




void main () {
  // scale to normalized device coordinates
  // gl_Position is a special variable that holds the position
  // of a vertex

  vec2 from_center = position-u_centroid;
  float angle = atan(from_center.x, from_center.y);
  from_center *= (1. + u_blob.b * sin(angle * u_blob.g + u_blob.r * u_time));

  vec3 p = vec3(from_center * u_size + u_centroid, 1.) * from_coord_to_gl;
  gl_Position = vec4(p, 1.0);

  //gl_PointSize = u_size * (exp(log(u_k)*u_scale_factor)); 

  fragColor = vec4(u_color.rgb, 1.);
  //gl_Position = vec4(position / vec2(1., u_aspect), 1., 1.);
}
`}

  set_renderer() {
    this.render_polygons = this.regl(this.renderer())
    this.render_points = this.regl(this.renderer("points"))
  }

  get point_frag() { return `
precision highp float;
uniform float u_alpha;
varying vec4 fragColor;

void main() {
vec2 coord = gl_PointCoord;
vec2 cxy = 2.0 * coord - 1.0;
float r_sq = dot(cxy, cxy);
if (r_sq > 1.0) {discard;}

gl_FragColor = fragColor * u_alpha;
}`}

  get triangle_frag() { return `
precision highp float;
uniform float u_alpha;
varying vec4 fragColor;

void main() {
gl_FragColor = fragColor * u_alpha;
}`}

  renderer(wut = "polygons") {
    const { regl, magic_numbers } = this;
    const definition = {      
      depth: {
        enable: false
      },
      blend: {enable: true,      func: {
        srcRGB: 'one',
        srcAlpha: 'one',
        dstRGB: 'one minus src alpha',
        dstAlpha: 'one minus src alpha',
      }
             },
      vert: wut == 'polygons' ? this.vertex_shader : this.point_vertex_shader,
      frag: wut == 'polygons' ? this.triangle_frag : this.point_frag,
      attributes: {
        a_x: regl.prop("x"),
        a_y: regl.prop("y"),
        a_ix: regl.prop("ix"),
        a_f_num: regl.prop("f_num"),

        position: wut == "polygons" ? 
          (_, {coords}) =>  coords: 
          (_, {position, stride, offset}) => {return {buffer: position, offset , stride}}
      },
      count: regl.prop("count"),
      elements: wut == "polygons" ? (_, {vertices}) => vertices : undefined,
      uniforms: {
        u_time: (context, _) => performance.now()/500,
        u_scale_factor: () => this.scale_factor ? this.scale_factor : .5,
        u_color_map: () => this.color_map,
        u_k: function(context, props) {        
          return props.transform.k
        },
        u_discard_prob: () => this.discard_share,
        u_centroid: propd("centroid", [0, 0]),
        u_color: (_, {color}) => color ? color : [.8, .9, .2],
        u_blob: (_, {u_blob}) => u_blob,
        u_window_scale: magic_numbers[0].flat(),
        u_untransform: magic_numbers[1].flat(),
        u_zoom: function(context, props) {
          const g = [
            // This is how you build a transform matrix from d3 zoom.
            [props.transform.k, 0, props.transform.x],
            [0, props.transform.k, props.transform.y],
            [0, 0, 1],
          ].flat()
          return g
        },
        u_alpha: (_, {alpha}) => alpha ? alpha : 1,
        u_size: (_, {size}) => size || 1,
      },
      primitive: wut == "polygons" ? "triangles" : "points"
    }
    if (wut === "polygons") {
      delete definition['count'] 
    }
    return definition
  }
}

function window_transform(x_scale, y_scale, width, height) {    
  
  // A function that creates the two matrices a webgl shader needs, in addition to the zoom state,
  // to stay aligned with canvas and d3 zoom.

  // width and height are svg parameters; x and y scales project from the data x and y into the
  // the webgl space.
   
  // Given two d3 scales in coordinate space, create two matrices that project from the original
  // space into [-1, 1] webgl space.

  
  function gap(array) {
    // Return the magnitude of a scale.
    return array[1] - array[0]
  }

  let x_mid = mean(x_scale.domain())
  let y_mid = mean(y_scale.domain())

  const xmulti = gap(x_scale.range())/gap(x_scale.domain());
  const ymulti = gap(y_scale.range())/gap(y_scale.domain());
  
  // the xscale and yscale ranges may not be the full width or height.

  const aspect_ratio = width/height;

  // translates from data space to scaled space.
  const m1 =  [
    // transform by the scale;
    [xmulti, 0, -xmulti * x_mid + mean(x_scale.range()) ],
    [0, ymulti, -ymulti * y_mid + mean(y_scale.range()) ],
    [0, 0, 1]
  ]
  
  // translate from scaled space to webgl space. 
  // The '2' here is because webgl space runs from -1 to 1; the shift at the end is to
  // shift from [0, 2] to [-1, 1]
  const m2 = [
    [2 / width, 0, -1],
    [0, - 2 / height, 1],
    [0, 0, 1]
  ]
 
  return [m1, m2]
}



function propd(string, def) {
  return (_, props) => {
    if (props[string] !== undefined) {return props[string]}
    return def
  }
}