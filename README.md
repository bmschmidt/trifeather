# Pre-triangulated shapefiles

This library defines a binary file format for collections of projected
polygon map data bound for geojson.

It builds on the Apache Arrow project's `feather` format; each feature from
a feature collection is stored as a single row, and all keys are stored as columns.
It attempts to be clever about coercing strings to dictionaries, etc.

Rather than store coordinates, it uses the mapbox [earcut library](https://github.com/mapbox/earcut)
to triangulate polygons, and stores those triangles directly. The combination
of this strategy and apache arrow means that the binary data can be pushed 
straight to a GPU for plotting without any need for Javascript, without
an extraordinary size penalty.

A trifeather object can be instantiated from *either* the binary file format

```js
new Trifeather(await fetch("file.feather"))
```

or from 

```js
Trifeather.from_feature_collection(await fetch("file.geojson").then(d => JSON.parse(d)))
```

Storing as triangles also happens to allow
much faster generation of random points in polygons than traditional methods.


## Node usage.

The `project.js` file can be used to convert from geojson to the trifeather format.

It currently only accepts items which are a feature collection where all constituent
elements are polygons or multipolygons.
