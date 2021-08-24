// vite.config.js
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export default {
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.js'),
      name: 'trifeather',
      fileName: (format) => `trifeather.${format}.js`
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ['regl'],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          regl: 'regl'
        }
      }
    }
  }
}