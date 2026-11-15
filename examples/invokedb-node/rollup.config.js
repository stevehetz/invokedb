import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import typescript from 'rollup-plugin-typescript2';
import { terser } from 'rollup-plugin-terser';
import pkg from './package.json';

const globals = {
  axios: 'axios'
}

export default {
  input: 'src/index.ts', // our source file
  output: [
    {
      file: pkg.main,
      format: 'cjs',
      exports: 'named',
      globals
    },
    {
      file: pkg.module,
      format: 'es',
      globals
    },
    {
      file: 'dist/invokedb.js',
      format: 'iife',
      name: 'invokedb',
      globals
    },
    {
      file: 'dist/invokedb.min.js',
      format: 'iife',
      name: 'invokedb',
      plugins: [terser()],
      globals
    }
  ],
  external: [],
  plugins: [
    replace({
      'Microsoft Corporation': 'InvokeDB, LLC'
    }),
    resolve({ jsnext: true, preferBuiltins: true, browser: true }),
    json(),
    typescript({
      rollupCommonJSResolveHack: true,
      clean: true,
      tsconfig: './tsconfig.json'
    }),
    commonjs({
      // non-CommonJS modules will be ignored, but you can also
      // specifically include/exclude files
      include: ['./src/index.js', 'node_modules/\*\*'], // Default: undefined

      // if true then uses of `global` won't be dealt with by this plugin
      ignoreGlobal: false, // Default: false

      // if false then skip sourceMap generation for CommonJS modules
      sourceMap: false // Default: true
    })
  ]
};
