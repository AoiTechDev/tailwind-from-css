import type { CandidateAst, TailwindDesignSystem } from '../../src/tailwind/adapter.ts'

/**
 * Prints the style rules of a compiled candidate as one line of CSS, conditions outermost first,
 * e.g. `@media (hover: hover) { .hover\:flex:hover { display: flex; } }`. `@property` rules are
 * left out.
 */
export function printRules(ast: CandidateAst): string {
  return ast.rules
    .map((rule) => {
      const body = rule.declarations
        .map((decl) => `${decl.property}: ${decl.value}${decl.important ? ' !important' : ''};`)
        .join(' ')
      return rule.conditions.reduceRight(
        (inner, condition) => `${condition} { ${inner} }`,
        `${rule.selector} { ${body} }`,
      )
    })
    .join(' ')
}

/** Compiles one candidate and prints it with {@link printRules}; `null` for an invalid one. */
export function css(design: TailwindDesignSystem, candidate: string): string | null {
  const [ast] = design.toAst([candidate])
  return ast ? printRules(ast) : null
}

/** The declarations of a candidate's rules, in order, as `property: value`. */
export function declarations(design: TailwindDesignSystem, candidate: string): string[] {
  const [ast] = design.toAst([candidate])
  if (!ast) throw new Error(`${candidate} does not compile`)
  return ast.rules.flatMap((rule) =>
    rule.declarations.map((decl) => `${decl.property}: ${decl.value}`),
  )
}

/** `true` when `version` is at least `minimum` (both `major.minor.patch`, prerelease ignored). */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (text: string): number[] => (text.split('-')[0] ?? '').split('.').map(Number)
  const [actual, wanted] = [parse(version), parse(minimum)]
  for (let index = 0; index < 3; index++) {
    const difference = (actual[index] ?? 0) - (wanted[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}
