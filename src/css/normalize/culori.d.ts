// The subset of culori's `culori/fn` entry point that colors.ts uses. culori ships no types.
declare module 'culori/fn' {
  /** A parsed color: `mode` names the space, missing (`none`) channels are absent. */
  export interface Color {
    mode: string
    alpha?: number
    [channel: string]: number | string | undefined
  }

  export interface ModeDefinition {
    mode: string
  }

  export const modeA98: ModeDefinition
  export const modeHsl: ModeDefinition
  export const modeHwb: ModeDefinition
  export const modeLab: ModeDefinition
  export const modeLch: ModeDefinition
  export const modeLrgb: ModeDefinition
  export const modeOklab: ModeDefinition
  export const modeOklch: ModeDefinition
  export const modeP3: ModeDefinition
  export const modeProphoto: ModeDefinition
  export const modeRec2020: ModeDefinition
  export const modeRgb: ModeDefinition
  export const modeXyz50: ModeDefinition
  export const modeXyz65: ModeDefinition

  /** Registers a color space and returns a converter into it. */
  export function useMode(definition: ModeDefinition): (color: Color) => Color
  /** Parses any CSS color syntax of a registered space; `undefined` when it isn't one. */
  export function parse(color: string): Color | undefined
  /** CSS named colors (without `transparent`) mapped to `0xRRGGBB`. */
  export const colorsNamed: Readonly<Record<string, number>>
}
