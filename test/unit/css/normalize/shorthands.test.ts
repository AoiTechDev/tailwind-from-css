import { describe, expect, it } from 'vitest'
import { normalizeDeclaration } from '../../../../src/css/normalize/index.ts'
import {
  canonicalProperty,
  coveredByImportant,
  covers,
  longhandsOf as declaredLonghands,
  dropCovered,
  EXPANDED_LONGHANDS,
  expandShorthand,
} from '../../../../src/css/normalize/shorthands.ts'
import { shorthandLonghands } from '../../../../src/data/css-properties.generated.ts'
import { normal } from '../../../helpers/normalize.ts'

const longhandsOf = (property: string, value: string): string[] =>
  normalizeDeclaration({ property, value }, { rootFontSize: 16 }).map((d) => d.property)

describe('N01 shorthand expansion', () => {
  describe('box shorthands', () => {
    it('expands 1–4 values to top, right, bottom, left', () => {
      expect(normal('margin', '0 auto')).toBe(
        'margin-top: 0; margin-right: auto; margin-bottom: 0; margin-left: auto',
      )
      expect(normal('padding', '1px 2px 3px')).toBe(
        'padding-top: 1px; padding-right: 2px; padding-bottom: 3px; padding-left: 2px',
      )
      expect(normal('inset', '1px 2px 3px 4px')).toBe(
        'top: 1px; right: 2px; bottom: 3px; left: 4px',
      )
      expect(normal('scroll-margin', '4px')).toBe(
        'scroll-margin-top: 4px; scroll-margin-right: 4px; scroll-margin-bottom: 4px; scroll-margin-left: 4px',
      )
      expect(normal('border-color', 'red blue')).toBe(
        'border-top-color: srgb(255 0 0 / 1); border-right-color: srgb(0 0 255 / 1); ' +
          'border-bottom-color: srgb(255 0 0 / 1); border-left-color: srgb(0 0 255 / 1)',
      )
    })

    it('makes four equal longhands equal to the shorthand', () => {
      const longhands = ['top', 'right', 'bottom', 'left']
        .map((side) => normal(`padding-${side}`, '1rem'))
        .join('; ')
      expect(normal('padding', '16px')).toBe(longhands)
    })

    it('expands logical and two-value shorthands to start/end', () => {
      expect(normal('margin-inline', '1px 2px')).toBe(
        'margin-inline-start: 1px; margin-inline-end: 2px',
      )
      expect(normal('padding-block', '3px')).toBe(
        'padding-block-start: 3px; padding-block-end: 3px',
      )
      expect(normal('border-inline-width', 'thin thick')).toBe(
        'border-inline-start-width: thin; border-inline-end-width: thick',
      )
      expect(normal('gap', '1px 2px')).toBe('row-gap: 1px; column-gap: 2px')
      expect(normal('overflow', 'hidden')).toBe('overflow-x: hidden; overflow-y: hidden')
      expect(normal('overflow', 'hidden auto')).toBe('overflow-x: hidden; overflow-y: auto')
    })

    it('expands border-radius per corner, with an optional vertical radius', () => {
      expect(normal('border-radius', '4px 8px')).toBe(
        'border-top-left-radius: 4px; border-top-right-radius: 8px; ' +
          'border-bottom-right-radius: 4px; border-bottom-left-radius: 8px',
      )
      expect(normal('border-radius', '4px / 8px')).toBe(
        'border-top-left-radius: 4px 8px; border-top-right-radius: 4px 8px; ' +
          'border-bottom-right-radius: 4px 8px; border-bottom-left-radius: 4px 8px',
      )
      expect(normal('border-radius', '1px 2px 3px 4px / 1px')).toBe(
        'border-top-left-radius: 1px; border-top-right-radius: 2px 1px; ' +
          'border-bottom-right-radius: 3px 1px; border-bottom-left-radius: 4px 1px',
      )
    })

    it('keeps box shorthands with too many values or a slash whole', () => {
      expect(normal('margin', '1px 2px 3px 4px 5px')).toBe('margin: 1px 2px 3px 4px 5px')
      expect(normal('margin', '1px / 2px')).toBe('margin: 1px / 2px')
      expect(normal('gap', '1px 2px 3px')).toBe('gap: 1px 2px 3px')
      expect(normal('border-radius', '1px / 2px / 3px')).toBe('border-radius: 1px / 2px / 3px')
    })
  })

  describe('place-*', () => {
    it('copies a single value to both axes', () => {
      expect(normal('place-items', 'center')).toBe('align-items: center; justify-items: center')
      expect(normal('place-self', 'start end')).toBe('align-self: start; justify-self: end')
      expect(normal('place-content', 'safe center space-between')).toBe(
        'align-content: safe center; justify-content: space-between',
      )
    })

    it('keeps multi-word alignment values together', () => {
      expect(normal('place-items', 'first baseline')).toBe(
        'align-items: first baseline; justify-items: first baseline',
      )
      expect(normal('place-items', 'center legacy center')).toBe(
        'align-items: center legacy; justify-items: center',
      )
    })

    it('uses start for justify-content when place-content has only a baseline', () => {
      expect(normal('place-content', 'last baseline')).toBe(
        'align-content: last baseline; justify-content: start',
      )
    })

    it('keeps three or more values whole', () => {
      expect(normal('place-items', 'center start end')).toBe('place-items: center start end')
      expect(normal('place-self', 'a / b')).toBe('place-self: a / b')
    })
  })

  describe('flex', () => {
    it.each([
      ['1', '1', '1', '0%'],
      ['none', '0', '0', 'auto'],
      ['auto', '1', '1', 'auto'],
      ['2 3', '2', '3', '0%'],
      ['2 30px', '2', '1', '30px'],
      ['30px 2', '2', '1', '30px'],
      ['10%', '1', '1', '10%'],
      ['1 2 3rem', '1', '2', '48px'],
      ['content 1 2', '1', '2', 'content'],
      ['1 1 0', '1', '1', '0px'],
      ['1 1 0px', '1', '1', '0px'],
    ])('flex: %s', (value, grow, shrink, basis) => {
      expect(normal('flex', value)).toBe(
        `flex-grow: ${grow}; flex-shrink: ${shrink}; flex-basis: ${basis}`,
      )
    })

    it('keeps values that are not [grow shrink?] || basis whole', () => {
      expect(normal('flex', '1 2 3')).toBe('flex: 1 2 3')
      expect(normal('flex', '10px 20px')).toBe('flex: 10px 20px')
      expect(normal('flex', '1 / 2')).toBe('flex: 1 / 2')
    })

    it('keeps flex: 1 apart from flex-grow: 1 alone', () => {
      expect(normal('flex', '1')).not.toBe(normal('flex-grow', '1'))
    })

    it('expands flex-flow in any order', () => {
      expect(normal('flex-flow', 'wrap column')).toBe('flex-direction: column; flex-wrap: wrap')
      expect(normal('flex-flow', 'row-reverse')).toBe(
        'flex-direction: row-reverse; flex-wrap: nowrap',
      )
      expect(normal('flex-flow', 'wrap wrap')).toBe('flex-flow: wrap wrap')
    })
  })

  describe('width || style || color shorthands', () => {
    it('sets every side and fills the missing parts with initial values', () => {
      expect(normal('border', '1px solid red')).toBe(
        [
          'border-bottom-color: srgb(255 0 0 / 1)',
          'border-bottom-style: solid',
          'border-bottom-width: 1px',
          'border-left-color: srgb(255 0 0 / 1)',
          'border-left-style: solid',
          'border-left-width: 1px',
          'border-right-color: srgb(255 0 0 / 1)',
          'border-right-style: solid',
          'border-right-width: 1px',
          'border-top-color: srgb(255 0 0 / 1)',
          'border-top-style: solid',
          'border-top-width: 1px',
        ].join('; '),
      )
      expect(normal('border-top', 'dashed')).toBe(
        'border-top-color: currentcolor; border-top-style: dashed; border-top-width: medium',
      )
      expect(normal('outline', 'auto 2px')).toBe(
        'outline-color: auto; outline-style: auto; outline-width: 2px',
      )
      expect(normal('column-rule', 'thick double #000')).toBe(
        'column-rule-color: srgb(0 0 0 / 1); column-rule-style: double; column-rule-width: thick',
      )
      expect(longhandsOf('border-block-start', '0')).toEqual([
        'border-block-start-color',
        'border-block-start-style',
        'border-block-start-width',
      ])
    })

    it('reads the components in any order', () => {
      expect(normal('border-left', 'red 2px solid')).toBe(normal('border-left', 'solid red 2px'))
    })

    it('keeps a repeated or unknown component whole', () => {
      expect(normal('border', '1px 2px solid')).toBe('border: 1px 2px solid')
      expect(normal('border', 'solid foo')).toBe('border: solid foo')
      expect(normal('border', 'auto')).toBe('border: auto')
    })

    it('keeps `border: 1px solid` apart from its width alone', () => {
      expect(normal('border', '1px solid')).not.toBe(normal('border-width', '1px'))
    })
  })

  describe('text-decoration', () => {
    it('expands line, style, color and thickness', () => {
      expect(normal('text-decoration', 'underline dotted red 2px')).toBe(
        'text-decoration-color: srgb(255 0 0 / 1); text-decoration-line: underline; ' +
          'text-decoration-style: dotted; text-decoration-thickness: 2px',
      )
      expect(normal('text-decoration', 'underline overline from-font')).toBe(
        'text-decoration-color: currentcolor; text-decoration-line: underline overline; ' +
          'text-decoration-style: solid; text-decoration-thickness: from-font',
      )
      expect(normal('text-decoration', 'none')).toBe(
        'text-decoration-color: currentcolor; text-decoration-line: none; ' +
          'text-decoration-style: solid; text-decoration-thickness: auto',
      )
    })

    it('keeps invalid combinations whole', () => {
      expect(normal('text-decoration', 'none underline')).toBe('text-decoration: none underline')
      expect(normal('text-decoration', 'solid wavy')).toBe('text-decoration: solid wavy')
    })
  })

  describe('columns and list-style', () => {
    it('expands columns', () => {
      expect(normal('columns', '3')).toBe(
        'column-count: 3; column-height: auto; column-width: auto',
      )
      expect(normal('columns', '12em auto')).toBe(
        'column-count: auto; column-height: auto; column-width: 12em',
      )
      expect(normal('columns', 'auto')).toBe(
        'column-count: auto; column-height: auto; column-width: auto',
      )
    })

    it('keeps invalid columns whole', () => {
      expect(normal('columns', '3 4')).toBe('columns: 3 4')
      expect(normal('columns', '3 10px auto')).toBe('columns: 3 10px auto')
    })

    it('expands list-style, where none fills whatever is not given', () => {
      expect(normal('list-style', 'none')).toBe(
        'list-style-image: none; list-style-position: outside; list-style-type: none',
      )
      expect(normal('list-style', 'square inside')).toBe(
        'list-style-image: none; list-style-position: inside; list-style-type: square',
      )
      expect(normal('list-style', 'none url(a.png)')).toBe(
        'list-style-image: url("a.png"); list-style-position: outside; list-style-type: none',
      )
      expect(normal('list-style', 'none disc')).toBe(
        'list-style-image: none; list-style-position: outside; list-style-type: disc',
      )
      expect(normal('list-style', 'none none')).toBe(
        'list-style-image: none; list-style-position: outside; list-style-type: none',
      )
    })

    it('keeps invalid list-style whole', () => {
      expect(normal('list-style', 'none disc url(a.png)')).toBe(
        'list-style: none disc url("a.png")',
      )
      expect(normal('list-style', 'disc square')).toBe('list-style: disc square')
    })
  })

  describe('grid lines', () => {
    it('copies a custom ident to the missing end, else uses auto', () => {
      expect(normal('grid-column', 'span 2 / span 2')).toBe(
        'grid-column-start: span 2; grid-column-end: span 2',
      )
      expect(normal('grid-row', 'Header')).toBe('grid-row-start: Header; grid-row-end: Header')
      expect(normal('grid-row', '2')).toBe('grid-row-start: 2; grid-row-end: auto')
      expect(normal('grid-row', 'span 2')).toBe('grid-row-start: span 2; grid-row-end: auto')
      expect(normal('grid-area', 'main')).toBe(
        'grid-row-start: main; grid-column-start: main; grid-row-end: main; grid-column-end: main',
      )
      expect(normal('grid-area', '1 / 2')).toBe(
        'grid-row-start: 1; grid-column-start: 2; grid-row-end: auto; grid-column-end: auto',
      )
      expect(normal('grid-area', 'a / b / 3')).toBe(
        'grid-row-start: a; grid-column-start: b; grid-row-end: 3; grid-column-end: b',
      )
    })

    it('keeps invalid grid lines whole', () => {
      expect(normal('grid-row', '1 / 2 / 3')).toBe('grid-row: 1 / 2 / 3')
      expect(normal('grid-area', '1 / / 2')).toBe('grid-area: 1 / / 2')
      expect(normal('grid-area', '1 / 2 / 3 / 4 / 5')).toBe('grid-area: 1 / 2 / 3 / 4 / 5')
    })
  })

  describe('transition and animation', () => {
    it('expands every transition layer', () => {
      expect(normal('transition', 'opacity .15s ease-in-out, transform 0.2s')).toBe(
        'transition-behavior: normal,normal; transition-delay: 0ms,0ms; ' +
          'transition-duration: 150ms,200ms; transition-property: opacity,transform; ' +
          'transition-timing-function: ease-in-out,ease',
      )
      expect(normal('transition', 'none')).toBe(
        'transition-behavior: normal; transition-delay: 0ms; transition-duration: 0ms; ' +
          'transition-property: none; transition-timing-function: ease',
      )
      expect(normal('transition', 'all 1s 2s cubic-bezier(0.4, 0, 0.2, 1) allow-discrete')).toBe(
        'transition-behavior: allow-discrete; transition-delay: 2000ms; ' +
          'transition-duration: 1000ms; transition-property: all; ' +
          'transition-timing-function: cubic-bezier(0.4,0,0.2,1)',
      )
    })

    it('expands animation, giving keywords to other longhands before the name', () => {
      expect(normal('animation', 'spin 1s linear infinite')).toBe(
        'animation-delay: 0ms; animation-direction: normal; animation-duration: 1000ms; ' +
          'animation-fill-mode: none; animation-iteration-count: infinite; animation-name: spin; ' +
          'animation-play-state: running; animation-timeline: auto; animation-timing-function: linear',
      )
      expect(normal('animation', 'Bounce 2 alternate both paused 1s')).toContain(
        'animation-name: Bounce',
      )
      expect(normal('animation', 'none')).toContain(
        'animation-fill-mode: none; animation-iteration-count: 1',
      )
      expect(normal('animation', 'normal normal')).toContain(
        'animation-direction: normal; animation-duration: 0ms; animation-fill-mode: none; animation-iteration-count: 1; animation-name: normal',
      )
    })

    it('keeps layers with unknown components whole', () => {
      expect(normal('transition', 'opacity 1s, a b')).toBe('transition: opacity 1000ms,a b')
      expect(normal('transition', '1s 2s 3s')).toBe('transition: 1000ms 2000ms 3000ms')
      expect(normal('animation', 'a b')).toBe('animation: a b')
    })
  })

  describe('font', () => {
    it('expands style, variant, weight, stretch, size, line-height and family', () => {
      expect(normal('font', 'bold 14px/1.5 Arial, sans-serif')).toBe(
        'font-family: Arial,sans-serif; font-size: 14px; font-stretch: normal; font-style: normal; ' +
          'font-variant: normal; font-weight: 700; line-height: 1.5',
      )
      expect(normal('font', 'italic small-caps 300 condensed 1rem Helvetica Neue')).toBe(
        'font-family: "Helvetica Neue"; font-size: 16px; font-stretch: condensed; ' +
          'font-style: italic; font-variant: small-caps; font-weight: 300; line-height: normal',
      )
      expect(normal('font', 'normal oblique 10deg large serif')).toContain(
        'font-size: large; font-stretch: normal; font-style: oblique 10deg',
      )
      expect(normal('font', 'oblique 12px serif')).toContain('font-style: oblique; font-variant')
    })

    it('keeps system fonts and fonts without a size or family whole', () => {
      expect(normal('font', 'caption')).toBe('font: caption')
      expect(normal('font', 'bold Arial')).toBe('font: bold Arial')
      expect(normal('font', '12px')).toBe('font: 12px')
      expect(normal('font', '12px /')).toBe('font: 12px /')
    })
  })

  describe('background and mask', () => {
    it('expands background layers, with the color from the final layer only', () => {
      expect(normal('background', 'url(a.png) no-repeat center / cover, #fff')).toBe(
        'background-attachment: scroll,scroll; background-clip: border-box,border-box; ' +
          'background-color: srgb(255 255 255 / 1); background-image: url("a.png"),none; ' +
          'background-origin: padding-box,padding-box; background-position: center,0% 0%; ' +
          'background-repeat: no-repeat,repeat; background-size: cover,auto auto',
      )
      expect(normal('background', 'red')).toBe(
        'background-attachment: scroll; background-clip: border-box; ' +
          'background-color: srgb(255 0 0 / 1); background-image: none; ' +
          'background-origin: padding-box; background-position: 0% 0%; ' +
          'background-repeat: repeat; background-size: auto auto',
      )
    })

    it('reads positions, sizes, repeats, attachments and boxes', () => {
      expect(
        normal(
          'background',
          'linear-gradient(red, blue) left 10px top / 50% auto repeat-x fixed content-box',
        ),
      ).toBe(
        'background-attachment: fixed; background-clip: content-box; ' +
          'background-color: srgb(0 0 0 / 0); ' +
          'background-image: linear-gradient(srgb(255 0 0 / 1),srgb(0 0 255 / 1)); ' +
          'background-origin: content-box; background-position: left 10px top; ' +
          'background-repeat: repeat-x; background-size: 50% auto',
      )
      expect(normal('background', 'space round padding-box text')).toContain(
        'background-clip: text',
      )
      expect(normal('background', 'space round padding-box text')).toContain(
        'background-origin: padding-box; background-position: 0% 0%; background-repeat: space round',
      )
      expect(normal('background', 'text 0 0 / contain')).toContain(
        'background-clip: text; background-color: srgb(0 0 0 / 0); background-image: none; background-origin: padding-box',
      )
      expect(normal('background', '0 0 / 10px')).toContain('background-size: 10px')
    })

    it('expands mask layers', () => {
      expect(
        normal('mask', 'url(m.svg) center / contain no-repeat luminance subtract no-clip'),
      ).toBe(
        'mask-clip: no-clip; mask-composite: subtract; mask-image: url("m.svg"); ' +
          'mask-mode: luminance; mask-origin: border-box; mask-position: center; ' +
          'mask-repeat: no-repeat; mask-size: contain',
      )
    })

    it('keeps background and mask with invalid components whole', () => {
      expect(normal('background', 'red, url(a.png)')).toBe(
        'background: srgb(255 0 0 / 1),url("a.png")',
      )
      expect(normal('background', 'center / foo')).toBe('background: center / foo')
      expect(normal('background', 'none none')).toBe('background: none none')
      expect(normal('mask', 'red')).toBe('mask: srgb(255 0 0 / 1)')
    })
  })

  describe('whole values', () => {
    it('gives every longhand a CSS-wide keyword', () => {
      expect(normal('margin', 'INHERIT')).toBe(
        'margin-top: inherit; margin-right: inherit; margin-bottom: inherit; margin-left: inherit',
      )
      expect(normal('font', 'unset')).toContain('font-family: unset; font-size: unset')
    })

    it('keeps shorthands with var() whole, since a variable can hold several components', () => {
      expect(normal('margin', 'var(--x)')).toBe('margin: var(--x)')
      expect(normal('border', '1px solid var(--c)')).toBe('border: 1px solid var(--c)')
      expect(normal('padding', 'env(safe-area-inset-top) 0')).toBe(
        'padding: env(safe-area-inset-top) 0',
      )
    })

    it('expands a variable once it is known', () => {
      expect(normal('margin', 'var(--x)', { variables: new Map([['--x', '1px 2px']]) })).toBe(
        'margin-top: 1px; margin-right: 2px; margin-bottom: 1px; margin-left: 2px',
      )
    })

    it('keeps shorthands without a parser whole', () => {
      expect(normal('grid', 'auto-flow / 1fr 1fr')).toBe('grid: auto-flow / 1fr 1fr')
      expect(normal('border-image', 'url(a.png) 30 round')).toBe(
        'border-image: url("a.png") 30 round',
      )
      expect(normal('-webkit-text-stroke', '1px red')).toBe(
        '-webkit-text-stroke: 1px srgb(255 0 0 / 1)',
      )
    })
  })

  it('renames legacy aliases', () => {
    expect(canonicalProperty('grid-gap')).toBe('gap')
    expect(canonicalProperty('Grid-Row-Gap')).toBe('row-gap')
    expect(canonicalProperty('grid-column-gap')).toBe('column-gap')
    expect(canonicalProperty('word-wrap')).toBe('overflow-wrap')
    expect(canonicalProperty('--Grid-Gap')).toBe('--Grid-Gap')
    expect(normal('grid-gap', '1px')).toBe(normal('gap', '1px'))
  })

  it('sets the longhands mdn-data lists for each shorthand', () => {
    // text-decoration also resets the thickness (CSS Text Decoration 4); mdn-data doesn't list
    // overflow as a shorthand.
    const extra: Record<string, string[]> = {
      'text-decoration': ['text-decoration-thickness'],
    }
    for (const [shorthand, longhands] of EXPANDED_LONGHANDS) {
      if (shorthand === 'overflow') continue
      const expected = [...(shorthandLonghands.get(shorthand) ?? []), ...(extra[shorthand] ?? [])]
      expect([...longhands].sort(), shorthand).toEqual(expected.sort())
    }
  })

  it('returns nothing for longhands and unknown properties', () => {
    expect(expandShorthand('margin-top', '1px')).toBeUndefined()
    expect(expandShorthand('foo', '1px')).toBeUndefined()
  })
})

// A shorthand kept whole (N01: a `var()` value) still sets every longhand it covers, so the
// cascade of a block must let it override earlier declarations of those longhands.
describe('shorthand coverage', () => {
  it('covers longhands and smaller shorthands of a shorthand', () => {
    expect(covers('padding', 'padding-top')).toBe(true)
    expect(covers('border', 'border-color')).toBe(true)
    expect(covers('border', 'border-top-width')).toBe(true)
    expect(covers('border', 'border-top')).toBe(true)
    expect(covers('text-decoration', 'text-decoration-thickness')).toBe(true)
    expect(covers('font', 'line-height')).toBe(true)
  })

  it('does not cover itself, larger or partly overlapping shorthands, or other properties', () => {
    expect(covers('padding', 'padding')).toBe(false)
    expect(covers('border-color', 'border')).toBe(false)
    expect(covers('border-top', 'border-color')).toBe(false)
    expect(covers('padding', 'margin-top')).toBe(false)
    expect(covers('padding-top', 'padding-top')).toBe(false)
    expect(covers('color', 'padding-top')).toBe(false)
  })

  it('finds a normal declaration that an earlier important shorthand covers', () => {
    const winners = new Map([['padding', { important: true }]])
    expect(coveredByImportant(winners, { property: 'padding-top', important: false })).toBe(true)
    expect(coveredByImportant(winners, { property: 'padding-top', important: true })).toBe(false)
    expect(coveredByImportant(winners, { property: 'margin-top', important: false })).toBe(false)
    expect(
      coveredByImportant(new Map([['padding', { important: false }]]), {
        property: 'padding-top',
        important: false,
      }),
    ).toBe(false)
  })

  it('lists the longhands a declaration sets, sorted', () => {
    expect(declaredLonghands('padding')).toEqual([
      'padding-bottom',
      'padding-left',
      'padding-right',
      'padding-top',
    ])
    expect(declaredLonghands('text-decoration')).toContain('text-decoration-thickness')
    expect(declaredLonghands('color')).toEqual(['color'])
    expect(declaredLonghands('--x')).toEqual(['--x'])
  })

  it('drops the winners a later shorthand overrides, unless they are important and it is not', () => {
    const winners = new Map([
      ['padding-top', { important: false }],
      ['padding-left', { important: true }],
      ['margin-top', { important: false }],
    ])
    dropCovered(winners, { property: 'padding', important: false })
    expect([...winners.keys()]).toEqual(['padding-left', 'margin-top'])
    dropCovered(winners, { property: 'padding', important: true })
    expect([...winners.keys()]).toEqual(['margin-top'])
    dropCovered(winners, { property: 'margin-top', important: true })
    expect([...winners.keys()]).toEqual(['margin-top'])
  })
})
