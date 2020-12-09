# Pre-triangulated shapefiles

This library defines a binary file format for collections of polygon map data.

It builds on the Apache Arrow project's `feather` format. It stores features 
as collections of triangles.

The `project.js` file can be used to convert from geojson to the trifeather format.

It currently only accepts items which are a feature collection where all constituent
elements are polygons or multipolygons. All elements in the properties field
should be stored into the feather frame as columns.
