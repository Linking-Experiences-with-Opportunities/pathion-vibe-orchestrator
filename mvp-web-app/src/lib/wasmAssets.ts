/**
 * WASM Asset Manifest
 *
 * Centralized configuration for all WASM dependencies.
 * Update versions here to propagate changes across the app.
 */

export const WASM_ASSETS = {
  pyodide: {
    version: '0.28.2',
    basePath: '/pyodide/0.28.2/',
    files: {
      core: 'pyodide.js',
      wasm: 'pyodide.asm.wasm',
      stdlib: 'python_stdlib.zip',
      packages: 'packages.json',
      repodata: 'repodata.json',
    },
  },
  treeSitter: {
    version: '0.23.2',
    basePath: '/tree-sitter/',
    files: {
      core: 'tree-sitter.wasm',
      python: 'tree-sitter-python.wasm',
    },
  },
} as const;

/**
 * Get full URL for a WASM asset
 */
export function getWasmUrl(
  module: keyof typeof WASM_ASSETS,
  file: string
): string {
  const config = WASM_ASSETS[module];
  return `${config.basePath}${file}`;
}

/**
 * Verify COEP/COOP headers are present (for SharedArrayBuffer)
 */
export function checkCrossOriginIsolation(): boolean {
  return typeof window !== 'undefined' && window.crossOriginIsolated;
}
