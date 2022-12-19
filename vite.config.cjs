// vite.config.js

export default {
  build: {
    target: "es2020",
    lib: {
      entry: __dirname + "/src/index.js",
      name: "trifeather",
      formats: ["es", "umd"],
      fileName: (format) => `trifeather.${format}.js`,
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ["regl"],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          regl: "regl",
        },
      },
    },
  },
};
