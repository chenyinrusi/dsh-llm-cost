import { defineConfig } from 'tsdown'

/**
 * Shared browser platform modules — the module table the DSH shell seeds, so a
 * client bundle must keep these EXTERNAL (the loader's require answers them).
 * Mirrors packages/client/web/src/platform.ts in the deepseek-harness repo.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

const CLIENT_EXTERNALS = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

export default defineConfig([
  // Host (node) half — @deepseek-ai/* peers and zod stay external.
  {
    name: 'dsh-llm-cost',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, 'zod', /^node:/] },
  },
  // Client (browser) half — wraps in the DSH __ModuleLoader__ factory.
  {
    name: 'dsh-llm-cost/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: { neverBundle: CLIENT_EXTERNALS },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-llm-cost", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
