import { build } from 'esbuild';
await build({ entryPoints: ['src/worker.js'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dist/worker.js', loader: { '.html': 'text', '.css': 'text' }, minify: true });
console.log('Built dist/worker.js');
