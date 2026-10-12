import { defineConfig, type UserConfig } from 'tsdown'

const config: UserConfig = defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22.12',
  // tsdown defaults to .mjs on the node platform; the exports map points at .js.
  fixedExtension: false,
  // SPEC §11 size budget. The declarations, TSDoc included, stay unminified in the .d.ts files.
  minify: true,
  dts: true,
  clean: true,
})

export default config
