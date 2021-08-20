/* global __dirname, require, module */

// based on https://github.com/krasimir/webpack-library-starter

const webpack = require('webpack');
// const UglifyJsPlugin = webpack.optimize.UglifyJsPlugin;
const path = require('path');
const env = require('yargs').argv.env; // use --env with webpack 2
const pkg = require('./package.json');

let libraryName = pkg.name;
let libraryObjName = 'trifeather'; // name for window.MyModule via script tag loading

let plugins = [], outputFile;
if (env === 'build') {
//    plugins.push(new UglifyJsPlugin({ uglifyOptions: { 'uglify-es': { compress: { inline: false } } } }))
//    plugins.push(new UglifyJsPlugin({ minimize: true }));
    outputFile = libraryName + '.min.js';
} else {
    outputFile = libraryName + '.js';
}

const config = {
    entry: __dirname + '/src/index.js',
    externals: {
    },
    output: {
        path: __dirname + '/lib',
        filename: outputFile,
        library: libraryObjName,
        libraryTarget: 'umd',
        umdNamedDefine: false // must be 'false' for m to be resolved in require([''], (m) => {});
    },
    //========
    devtool: 'source-map',
    module: {
        rules: [
            {
                test: /(\.jsx|\.js)$/,
                loader: 'babel-loader',
                exclude: /(node_modules|bower_components)/
            }
        ]
    },
    resolve: {
        modules: [path.resolve('./node_modules'), path.resolve('./src')],
        extensions: ['.json', '.js']
    },
    plugins: plugins
};

module.exports = config;
