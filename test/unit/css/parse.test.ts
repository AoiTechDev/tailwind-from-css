// SPEC §5.1: stylesheet → style rules (subject, transform, conditions, positioned declarations),
// passthrough CSS and stylesheet diagnostics. CSS problems never throw.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseStylesheet, type StyleRule } from '../../../src/css/parse.ts'

const codes = (css: string): string[] =>
  parseStylesheet(css).diagnostics.map((diagnostic) => diagnostic.code)

const summary = (rule: StyleRule): string =>
  [...rule.conditions, `${rule.subject} | ${rule.transform}`].join(' | ')

const summaries = (css: string): string[] => parseStylesheet(css).rules.map(summary)

const declarations = (rule: StyleRule | undefined): string[] =>
  (rule?.declarations ?? []).map(
    (declaration) =>
      `${declaration.line}:${declaration.column} ${declaration.property}: ${declaration.value}` +
      (declaration.important ? ' !important' : ''),
  )

describe('rules and declarations', () => {
  it('reads each declaration with its 1-based line and column', () => {
    const { rules, passthroughCss, diagnostics } = parseStylesheet(
      '.a {\n  color: red;\n  padding: 4px !important;\n}\n.b { margin: 0 }',
    )
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({
      selector: '.a',
      subject: '.a',
      transform: '&',
      conditions: [],
    })
    expect(declarations(rules[0])).toEqual(['2:3 color: red', '3:3 padding: 4px !important'])
    expect(declarations(rules[1])).toEqual(['5:6 margin: 0'])
    expect(passthroughCss).toBe('')
    expect(diagnostics).toEqual([])
  })

  it('counts columns per line for CRLF input too', () => {
    const [rule] = parseStylesheet('.a {\r\n  color: red;\r\n  margin: 0;\r\n}').rules
    expect(declarations(rule)).toEqual(['2:3 color: red', '3:3 margin: 0'])
  })

  it('lowercases property names but keeps custom properties as written', () => {
    const [rule] = parseStylesheet('.a { COLOR: Red; --My-Var: A  b }').rules
    expect(declarations(rule)).toEqual(['1:6 color: Red', '1:18 --My-Var: A  b'])
  })

  it('skips comments and rules without declarations', () => {
    expect(summaries('/* c */ .a { /* x */ } .b { /* y */ color: red; }')).toEqual(['.b | &'])
  })

  it('keeps empty and broken declarations for the converter to report', () => {
    const [rule] = parseStylesheet('.a { color: ; --x: ; }').rules
    expect(declarations(rule)).toEqual(['1:6 color: ', '1:15 --x: '])
  })
})

describe('@layer', () => {
  it('is flattened, keeping source order', () => {
    expect(
      summaries(
        '@layer reset, base; @layer base { .a { color: red } } .b { color: blue } ' +
          '@layer components { @layer inner { .c { color: green } } }',
      ),
    ).toEqual(['.a | &', '.b | &', '.c | &'])
  })

  it('passes a layer statement through (TFC103)', () => {
    const { passthroughCss, diagnostics } = parseStylesheet('@layer reset, base;')
    expect(passthroughCss).toBe('@layer reset, base;\n')
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC103'])
  })
})

describe('conditions', () => {
  it('records @media, @supports, @container and @starting-style, outermost first', () => {
    expect(
      summaries(
        '@media (min-width: 768px) { @supports (display: grid) { .a { display: grid } } }\n' +
          '@container card (min-width: 400px) { .b { flex-direction: row } }\n' +
          '@starting-style { .c { opacity: 0 } }\n' +
          '@MEDIA print { @layer x { .d { color: black } } }',
      ),
    ).toEqual([
      '@media (min-width: 768px) | @supports (display: grid) | .a | &',
      '@container card (min-width: 400px) | .b | &',
      '@starting-style | .c | &',
      '@media print | .d | &',
    ])
  })

  it('applies conditions nested in a rule to that rule', () => {
    expect(
      summaries('.a { color: red; @media (min-width: 640px) { color: blue; &:hover { x: y } } }'),
    ).toEqual([
      '.a | &',
      '@media (min-width: 640px) | .a | &',
      '@media (min-width: 640px) | .a | &:hover',
    ])
  })

  it('reports declarations outside any rule as TFC102', () => {
    const { rules, diagnostics } = parseStylesheet('color: red;\n@media print { margin: 0 }')
    expect(rules).toEqual([])
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC102', 'TFC102'])
  })
})

describe('& nesting', () => {
  it('flattens nested rules to full selectors, implicit & as a descendant', () => {
    const { rules } = parseStylesheet(
      '.a { color: red; &:hover { color: blue } .b & { color: green } > .c { x: y } .d { x: y } padding: 0 }',
    )
    expect(rules.map((rule) => rule.selector)).toEqual([
      '.a',
      '.a:hover',
      '.b .a',
      '.a > .c',
      '.a .d',
      '.a',
    ])
    expect(rules.map((rule) => rule.subject)).toEqual([
      '.a',
      '.a',
      '.b .a',
      '.a > .c',
      '.a .d',
      '.a',
    ])
    expect(declarations(rules[5])).toEqual(['1:90 padding: 0'])
  })

  it('nests under every selector of a parent list', () => {
    expect(
      parseStylesheet('.a, .b { &:hover, &:focus { color: red } }').rules.map(
        (rule) => rule.selector,
      ),
    ).toEqual(['.a:hover', '.a:focus', '.b:hover', '.b:focus'])
  })

  it('wraps a parent in :is() where plain substitution would change the selector', () => {
    const selectors = (css: string): string[] =>
      parseStylesheet(css).rules.map((rule) => rule.selector)
    expect(selectors('.a .b { .c & { x: y } }')).toEqual(['.c :is(.a .b)'])
    expect(selectors('.a .b { &.c { x: y } }')).toEqual(['.a .b.c'])
    expect(selectors('div { .x& { x: y } }')).toEqual(['.x:is(div)'])
    expect(selectors('.a { .x& { x: y } }')).toEqual(['.x.a'])
    expect(selectors('.a { :not(&) > & { x: y } }')).toEqual([':not(.a) > .a'])
    expect(selectors('.a { .b { .c { x: y } } }')).toEqual(['.a .b .c'])
  })

  it('reads a top-level & as :scope, which takes no classes (TFC104)', () => {
    const { rules, passthroughCss, diagnostics } = parseStylesheet('& { color: red }')
    expect(rules).toEqual([])
    expect(passthroughCss).toBe(':scope {\n  color: red;\n}\n')
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC104'])
  })
})

describe('selector lists and subjects', () => {
  it('splits a selector list into one rule per selector, sharing the declarations', () => {
    const { rules } = parseStylesheet('.a,\n.b:hover { color: red }')
    expect(rules.map(summary)).toEqual(['.a | &', '.b | &:hover'])
    expect(rules.map((rule) => rule.selector)).toEqual(['.a', '.b:hover'])
    expect(declarations(rules[1])).toEqual(['2:12 color: red'])
  })

  it('extracts the subject and the selector transform (N50 form)', () => {
    expect(
      summaries(
        '.card .title:hover::before { content: "x" } .a>:FOCUS { x: y } .b:before { x: y } ' +
          '.c[data-state=open]:not(.d) { x: y }',
      ),
    ).toEqual([
      '.card .title | &:hover::before',
      '.a > * | &:focus',
      '.b | &::before',
      '.c[data-state="open"] | &:not(.d)',
    ])
  })

  it('keeps original selectors whitespace-collapsed outside strings', () => {
    const [rule] = parseStylesheet('.a\n   .b[title="x  y"] { x: y }').rules
    expect(rule?.selector).toBe('.a .b[title="x  y"]')
  })
})

describe('passthrough at-rules (TFC103)', () => {
  it.each([
    ['@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }'],
    ['@font-face { font-family: "X"; src: url(x.woff2) format("woff2") }'],
    ['@property --x { syntax: "<length>"; inherits: false; initial-value: 0px }'],
    ['@page :first { margin: 1cm }'],
    ['@counter-style thumbs { system: cyclic; symbols: "👍"; suffix: " " }'],
    ['@font-feature-values Font One { @styleset { nice-style: 12 } }'],
    ['@import url("theme.css") layer(theme);'],
    ['@namespace svg url(http://www.w3.org/2000/svg);'],
    ['@scope (.card) { .title { color: red } }'],
  ])('%s', (css) => {
    const { rules, passthroughCss, diagnostics } = parseStylesheet(css)
    expect(rules).toEqual([])
    expect(passthroughCss).not.toBe('')
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC103'])
    // Passthrough CSS is itself a stylesheet that parses to the same passthrough.
    expect(parseStylesheet(passthroughCss).passthroughCss).toBe(passthroughCss)
  })

  it('prints them verbatim, inside their conditions, layers and rules', () => {
    const { passthroughCss } = parseStylesheet(
      '@layer base { @media print { @page { margin: 1cm !important } } }\n' +
        '.a { color: red; @apply font-bold; }\n' +
        '@keyframes fade { /* start */ 0%, 50% { opacity: 0 } }',
    )
    expect(passthroughCss).toBe(
      [
        '@layer base {',
        '  @media print {',
        '    @page {',
        '      margin: 1cm !important;',
        '    }',
        '  }',
        '}',
        '',
        '.a {',
        '  @apply font-bold;',
        '}',
        '',
        '@keyframes fade {',
        '  0%, 50% {',
        '    opacity: 0;',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })
})

describe('subjects that take no classes (TFC104)', () => {
  it.each([
    [':root { --brand: #123456 }', ':root'],
    ['html { font-size: 16px }', 'html'],
    ['* { box-sizing: border-box }', '*'],
    ['::selection { color: red }', '::selection'],
    [':root:hover { color: red }', ':root:hover'],
    ['html * { margin: 0 }', 'html *'],
    ['* + * { margin-top: 1em }', '* + *'],
    [':host { display: block }', ':host'],
  ])('%s', (css, selector) => {
    const { rules, passthroughCss, diagnostics } = parseStylesheet(css)
    expect(rules).toEqual([])
    expect(passthroughCss.startsWith(`${selector} {\n`)).toBe(true)
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC104'])
  })

  it('keeps subjects with an element: types, classes, ids, attributes, children of one', () => {
    expect(
      summaries(
        'body { x: y } html.dark { x: y } #main { x: y } [data-x] { x: y } .a > * { x: y } ' +
          ':root .a { x: y } h1:first-child { x: y }',
      ),
    ).toEqual([
      'body | &',
      'html.dark | &',
      '#main | &',
      '[data-x] | &',
      '.a > * | &',
      ':root .a | &',
      'h1 | &:first-child',
    ])
  })

  it('splits a list into converted and passthrough rules, keeping conditions', () => {
    const { rules, passthroughCss } = parseStylesheet(
      '@media (prefers-color-scheme: dark) { :root, .a { color: white } }',
    )
    expect(rules.map(summary)).toEqual(['@media (prefers-color-scheme: dark) | .a | &'])
    expect(passthroughCss).toBe(
      '@media (prefers-color-scheme: dark) {\n  :root {\n    color: white;\n  }\n}\n',
    )
  })

  it('shares wrappers between adjacent passthrough blocks', () => {
    const { passthroughCss } = parseStylesheet(
      '@media print { :root { --a: 1 } * { --b: 2 } }\n@media print { html { --c: 3 } }',
    )
    expect(passthroughCss).toBe(
      [
        '@media print {',
        '  :root {',
        '    --a: 1;',
        '  }',
        '  * {',
        '    --b: 2;',
        '  }',
        '  html {',
        '    --c: 3;',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('passes a rule whose selector does not parse through verbatim', () => {
    const { rules, passthroughCss, diagnostics } = parseStylesheet(
      '.a! { color: red; .b { x: y } }',
    )
    expect(rules).toEqual([])
    expect(passthroughCss).toBe('.a! {\n  color: red;\n  .b {\n    x: y;\n  }\n}\n')
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC104'])
  })
})

describe('diagnostics', () => {
  it('report each selector of a list on its own', () => {
    const { passthroughCss, diagnostics } = parseStylesheet(':root, .a, html { --x: 1 }')
    expect(passthroughCss).toBe(':root, html {\n  --x: 1;\n}\n')
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC104', 'TFC104'])
    expect(diagnostics[1]?.message).toContain('"html"')
  })

  it('are sorted by position and name it in the message', () => {
    const { diagnostics } = parseStylesheet(
      '@font-face { font-family: X }\n:root { --x: 1 }\ncolor: red;',
    )
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC103', 'TFC104', 'TFC102'])
    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      'info',
      'info',
      'warning',
    ])
    expect(diagnostics[1]?.message).toContain('2:1')
  })
})

describe('safe parsing', () => {
  it('closes an unclosed block, comment, string or bracket', () => {
    expect(declarations(parseStylesheet('.a { color: red').rules[0])).toEqual(['1:6 color: red'])
    expect(summaries('.a { color: red } /* x')).toEqual(['.a | &'])
    expect(declarations(parseStylesheet('.a { content: "abc; }').rules[0])).toEqual([
      '1:6 content: "abc; }"',
    ])
    expect(
      parseStylesheet('.a { color: rgb(0 0 0; padding: 1px }').rules[0]?.declarations.map(
        (declaration) => declaration.property,
      ),
    ).toEqual(['color', 'padding'])
    expect(codes('.a { background: url(x }')).toEqual([])
  })

  it('closes every open block at once, ignoring braces in strings and comments', () => {
    const { rules, diagnostics } = parseStylesheet(
      '.a { content: "{\\"{"; /* { */ &:hover { color: red',
    )
    expect(rules.map((rule) => rule.selector)).toEqual(['.a', '.a:hover'])
    expect(declarations(rules[1])).toEqual(['1:41 color: red'])
    expect(diagnostics).toEqual([])
  })

  it('closes square brackets and single-quoted strings too', () => {
    expect(
      declarations(parseStylesheet('.a { grid-template-columns: [a 1fr; color: red }').rules[0]),
    ).toEqual(['1:6 grid-template-columns: [a 1fr]', '1:37 color: red'])
    expect(declarations(parseStylesheet(".a { content: 'abc\n}").rules[0])).toEqual([
      "1:6 content: 'abc'",
    ])
  })

  it('inserts a missed semicolon and maps positions back to the original text', () => {
    const [rule] = parseStylesheet('.a { color: red padding: 1px; margin: 0 }').rules
    expect(declarations(rule)).toEqual(['1:6 color: red', '1:17 padding: 1px', '1:31 margin: 0'])
  })

  it('drops stray closing braces, double colons and nameless at-rules', () => {
    expect(summaries('.a { color: red } } .b { x: y }')).toEqual(['.a | &', '.b | &'])
    expect(declarations(parseStylesheet('.a { color:: red; margin: 0 }').rules[0])).toEqual([
      '1:6 color: red',
      '1:19 margin: 0',
    ])
    expect(summaries('@ { } .b { x: y }')).toEqual(['.b | &'])
  })

  it('skips unknown words with TFC102, keeping the rest of the rule', () => {
    const { rules, diagnostics } = parseStylesheet('.a {\n  color red;\n  padding: 4px;\n}')
    expect(declarations(rules[0])).toEqual(['3:3 padding: 4px'])
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['TFC102'])
    expect(diagnostics[0]?.message).toContain('2:3')
  })

  it('gives up with TFC101 and no rules when the text cannot be repaired', () => {
    const { rules, passthroughCss, diagnostics } = parseStylesheet(
      `.a { color: red } ${'}'.repeat(2000)}`,
    )
    expect(rules).toEqual([])
    expect(passthroughCss).toBe('')
    expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity])).toEqual([
      ['TFC101', 'error'],
    ])
  })

  it('never throws on malformed input', () => {
    for (const css of [
      '',
      '}',
      '{',
      '{}',
      ':::',
      '"',
      "'",
      '/*',
      '@',
      '@media',
      '@media {',
      '.a { & }',
      '.a { &:hover }',
      '.a{b:c}}}}',
      '.a { --x: { a: b } }',
      '.a { color: [; }',
      'a { b: c; ; }',
      '.a { color: red\n  .b { x: y } }',
      '.a{'.repeat(3000),
      '@media x{'.repeat(3000),
      '\\',
      '.a\\',
      '.a { color: red !important important }',
    ]) {
      expect(() => parseStylesheet(css)).not.toThrow()
    }
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...'.a{}:;&@()[]"\'/*\\ \n!-,>#b'.split('')) }),
        (css) => {
          const result = parseStylesheet(css)
          expect(Array.isArray(result.rules)).toBe(true)
        },
      ),
      { numRuns: 500 },
    )
  })
})
