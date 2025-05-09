import terser from '@rollup/plugin-terser';

export default [
  // Unminified bundle
  {
    input: 'src/index.js',
    output: {
      file: 'dist/token.js',
      format: 'es',
      sourcemap: true,
    },
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
          comments: false,
          ecma: 2020
        }
      })
    ]
  }
];