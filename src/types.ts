/**
 * Declarations in any of the accepted shapes.
 *
 * - a declaration string: `"color: red; padding: 4px 8px"`
 * - a record with camelCase or kebab-case keys: `{ backgroundColor: '#fff', padding: 8 }`.
 *   Numbers get `px` appended unless the property is unitless; `0` stays `0`.
 * - an array of {@link Declaration}
 */
export type DeclarationsInput = string | Record<string, string | number> | Declaration[]

/** One CSS declaration: `property: value [!important]`. */
export interface Declaration {
  property: string
  value: string
  important?: boolean
}

/** Declarations that apply to one element in one context (state, pseudo-element, media query…). */
export interface StyleInput {
  declarations: DeclarationsInput
  /**
   * Selector relative to the element. Must contain `&`. Default `'&'`.
   *
   * @example '&:hover', '&::before', '&:hover::after', '&[data-state=open]', '.dark &'
   */
  selector?: string
  /**
   * At-rule conditions, outermost first.
   *
   * @example ['@media (min-width: 768px)', '@supports (display: grid)']
   */
  conditions?: string[]
}

/** Name of an opt-in relaxation that allows a close but not identical substitution. */
export type RelaxationName =
  | 'hover-media'
  | 'logical-properties'
  | 'color-nearest'
  | 'length-nearest'
  | 'breakpoint-nearest'
  | 'font-weight-nearest'
  | 'text-line-height'
  | 'pill-radius'

/** Conversion mode. A mode is a preset list of relaxations: `exact` has none, `nearest` has all. */
export type Mode = 'exact' | 'nearest'

/**
 * Stable code of a non-fatal diagnostic. Codes are part of the public contract; messages are not.
 * Fatal errors use {@link TfcErrorCode}.
 */
export type DiagnosticCode =
  | 'TFC101'
  | 'TFC102'
  | 'TFC103'
  | 'TFC104'
  | 'TFC105'
  | 'TFC201'
  | 'TFC202'
  | 'TFC203'
  | 'TFC204'
  | 'TFC301'
  | 'TFC302'
  | 'TFC303'
  | 'TFC401'
  | 'TFC402'
  | 'TFC501'
  | 'TFC502'

/** Code of an error thrown as `TfcError`: environment and usage problems only. */
export type TfcErrorCode = 'TFC901' | 'TFC902' | 'TFC903' | 'TFC904'

/** Severity of a {@link Diagnostic}. */
export type DiagnosticSeverity = 'info' | 'warning' | 'error'

/** Where an input declaration came from. */
export interface SourceRef {
  property: string
  value: string
  important: boolean
  /** Relative selector, e.g. `'&:hover'`. */
  selector: string
  conditions: string[]
  /** 1-based line, only for stylesheet input. */
  line?: number
  /** 1-based column, only for stylesheet input. */
  column?: number
}

/** An input declaration that has no class in the output, with the reason as a code. */
export interface UnconvertedDeclaration extends SourceRef {
  code: DiagnosticCode
}

/** Something worth reporting about a conversion. */
export interface Diagnostic {
  code: DiagnosticCode
  severity: DiagnosticSeverity
  /** Human-readable text. Not part of the stability contract. */
  message: string
  source?: SourceRef
}

/** One output class and the input declarations it came from. */
export interface ClassMapping {
  className: string
  kind: 'named' | 'bare' | 'arbitrary-value' | 'arbitrary-property' | 'variable'
  sources: SourceRef[]
  /** Present only when a relaxation produced this class. */
  relaxation?: { name: RelaxationName; detail: string; delta?: number }
}

/** Result of converting the styles of one element. */
export interface ConversionResult {
  /** Classes joined with single spaces, in Tailwind's canonical order. */
  className: string
  classes: string[]
  mappings: ClassMapping[]
  unconverted: UnconvertedDeclaration[]
  diagnostics: Diagnostic[]
  /** True when no relaxation was applied and nothing is unconverted. */
  exact: boolean
}

/** Conversion result for one subject selector of a stylesheet. */
export interface RuleResult {
  /** The original selector with trailing state pseudo-classes and pseudo-elements removed. */
  subject: string
  /** Original selectors merged into this subject, in source order. */
  selectors: string[]
  result: ConversionResult
}

/** Result of converting a whole stylesheet. */
export interface CssConversionResult {
  rules: RuleResult[]
  /**
   * CSS that has no utility form and must stay in a stylesheet: `@keyframes`, `@font-face`,
   * `@property`, `:root` custom properties, `@page`, `@counter-style`, and rules whose subject
   * can't take classes.
   */
  passthroughCss: string
  /** Stylesheet-level diagnostics, such as parse errors and skipped at-rules. */
  diagnostics: Diagnostic[]
}

/** Options for {@link Converter} creation and the one-shot helpers. */
export interface ConverterOptions {
  /** Preset of relaxations. Default `'exact'`. */
  mode?: Mode
  /** Relaxations added on top of the preset, or removed with `'!name'`. */
  relax?: Array<RelaxationName | `!${RelaxationName}`>
  tailwind?: {
    /** Entry stylesheet as the user's project would have it. Default `'@import "tailwindcss";'`. */
    css?: string
    /** Directory for resolving `@import`, `@plugin` and `@config` in `css`. Default `process.cwd()`. */
    base?: string
  }
  /** px per rem for px↔rem equivalence. `false` disables the equivalence. Default `16`. */
  rootFontSize?: number | false
  /** Tolerances for the `nearest` relaxations. */
  tolerance?: {
    /** Maximum ΔE OK for `color-nearest`. Default `0.02`. */
    colorDeltaE?: number
    /** Maximum absolute difference in px for `length-nearest`. Default `2`. */
    lengthPx?: number
    /** Maximum relative difference for `length-nearest`. Default `0.1`. A snap must satisfy both limits. */
    lengthRatio?: number
    /** Maximum distance in px for `breakpoint-nearest`. Default `16`. */
    breakpointPx?: number
  }
  /** Emit important as a `!` suffix (v4), or `'prefix'` for the deprecated `!flex` form. Default `'suffix'`. */
  important?: 'suffix' | 'prefix'
}

/** {@link ConverterOptions} with every default applied. Frozen. */
export interface ResolvedOptions {
  readonly mode: Mode
  /** Effective relaxations after applying the mode preset and `relax`, sorted by name. */
  readonly relaxations: readonly RelaxationName[]
  readonly tailwind: { readonly css: string; readonly base: string }
  readonly rootFontSize: number | false
  readonly tolerance: {
    readonly colorDeltaE: number
    readonly lengthPx: number
    readonly lengthRatio: number
    readonly breakpointPx: number
  }
  readonly important: 'suffix' | 'prefix'
}

/** A loaded Tailwind design system plus its index. Conversion methods are synchronous. */
export interface Converter {
  /** Version of the tailwindcss package that was actually loaded. */
  readonly tailwindVersion: string
  readonly options: ResolvedOptions
  /** Converts styles that all describe one element into one class list. */
  convertStyles(input: StyleInput | StyleInput[]): ConversionResult
  /** Parses a stylesheet and converts every rule, grouped by subject selector. */
  convertCss(css: string): CssConversionResult
  /** The CSS Tailwind generates for the given classes. Meant for debugging and tests. */
  toCss(classes: string[]): string
}

/** Options for pruning computed styles down to what actually needs classes. */
export interface PruneOptions {
  /** Computed styles of the parent element. Inherited properties with equal values are dropped. */
  parent?: DeclarationsInput
  /**
   * Computed styles of a blank element with the same tag, rendered under the target CSS
   * (Tailwind Preflight). Declarations equal to the baseline are dropped.
   */
  baseline?: DeclarationsInput
  /** Properties to always keep. */
  keep?: string[]
  /** Properties to always drop. */
  drop?: string[]
}
