import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
import { brotliCompress } from 'zlib';
const brotliPromise = promisify(brotliCompress);

// Plugin to log bundle size information
function bundleSizeLogger() {
  return {
    name: 'bundle-size-logger',
    generateBundle: async (options, bundle) => {
      console.log('\n==== Bundle Size Information ====');
      
      // Process each chunk in the bundle
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.code) {
          const size = Buffer.byteLength(chunk.code);
          const gzipped = await gzip(chunk.code, { level: zlib.constants.Z_BEST_COMPRESSION });
          const gzippedSize = Buffer.byteLength(gzipped);

          const brotlied = await brotliPromise(Buffer.from(chunk.code), { 
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
          });
          const brotliSize = Buffer.byteLength(brotlied);
          
          console.log(
            `${fileName}:
  Raw size:     ${(size / 1024).toFixed(2)} KB
  Gzipped:      ${(gzippedSize / 1024).toFixed(2)} KB (${((1 - gzippedSize / size) * 100).toFixed(1)}%)
  Brotli:       ${(brotliSize / 1024).toFixed(2)} KB (${((1 - brotliSize / size) * 100).toFixed(1)}%)`
          );
        }
      }
      
      console.log('=================================\n');
    }
  };
}

// Custom plugin to add version from package.json as a comment
function versionComment() {
  return {
    name: 'version-comment',
    renderChunk(code, chunk, options) {
      // Read package.json
      const packageJson = JSON.parse(
        fs.readFileSync(path.resolve('./package.json'), 'utf8')
      );
      const version = packageJson.version;
      
      // Add version comment at the top of the bundle
      const commentString = `//TokenJS v${version}\n`;
      const modifiedCode = `${commentString}${code}`;
      
      // If sourcemaps aren't enabled, just return the code
      if (!options.sourcemap) {
        return modifiedCode;
      }
      
      // For sourcemaps, we need to handle it differently
      const linesToAdd = commentString.split('\n').length - 1;
      
      // Create a proper sourcemap with adjusted mappings
      const map = { ...chunk.map };
      
      // Shift all mappings down by the number of added lines
      if (map && map.mappings) {
        map.mappings = ';'.repeat(linesToAdd) + map.mappings;
      }
      
      return {
        code: modifiedCode,
        map
      };
    }
  };
}

export default [
  // Unminified bundle
  {
    input: 'src/index.js',
    output: {
      file: 'dist/token.js',
      format: 'es',
      sourcemap: true,
    },
    plugins: [
      versionComment(),
      bundleSizeLogger()
    ]
  },
  // Minified bundle
  {
    input: 'src/index.js',
    output: {
      file: 'dist/token.min.js',
      format: 'es',
      sourcemap: true,
    },
    plugins: [
      versionComment(),
      terser({
        compress: {
          ecma: 2020,
          pure_getters: true,
          passes: 3,
          unsafe: true,
          unsafe_comps: true,
          unsafe_math: true,
          unsafe_methods: true,
          drop_console: true,
          drop_debugger: true
        },
        mangle: {
          toplevel: true, 
          properties: false
        },
        format: {
          comments: /TokenJS v/,
          ecma: 2020
        }
      }),
      bundleSizeLogger()
    ]
  }
];