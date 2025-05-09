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
    plugins: [terser()]
  }
];