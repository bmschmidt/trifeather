NAME=$1


cat $NAME.geojson | geo2topo | toposimplify -s .1 | topo2geo - > $NAME2.geojson

node project.js $NAME2.geojson
