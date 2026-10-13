import { describe, expect, it } from 'vitest'
import { pruneStyles } from '../../src/prune.ts'

const kept = (...args: Parameters<typeof pruneStyles>): string[] =>
  pruneStyles(...args).map(
    (declaration) =>
      `${declaration.property}: ${declaration.value}${declaration.important ? ' !important' : ''}`,
  )

describe('pruneStyles', () => {
  describe('input and output', () => {
    it('reads every input shape and returns declarations in input order', () => {
      const expected = ['padding-top: 4px', 'display: flex']
      expect(kept('padding-top: 4px; display: flex', {})).toEqual(expected)
      expect(kept({ paddingTop: 4, display: 'flex' }, {})).toEqual(expected)
      expect(
        kept(
          [
            { property: 'padding-top', value: '4px' },
            { property: 'display', value: 'flex' },
          ],
          {},
        ),
      ).toEqual(expected)
    })

    it('returns nothing for nothing', () => {
      expect(pruneStyles({}, {})).toEqual([])
      expect(pruneStyles('', { parent: '', baseline: '' })).toEqual([])
    })

    it('keeps invalid declarations, after the others, for the converter to report', () => {
      expect(kept({ color: '', display: 'flex', width: Number.NaN }, {})).toEqual([
        'display: flex',
        'color: ',
        'width: NaN',
      ])
    })

    it("doesn't change its inputs and is deterministic", () => {
      const styles = { color: 'red', opacity: '1' }
      const options = { parent: { color: 'red' }, keep: ['opacity'] }
      const first = pruneStyles(styles, options)
      expect(pruneStyles(styles, options)).toEqual(first)
      expect(styles).toEqual({ color: 'red', opacity: '1' })
      expect(options).toEqual({ parent: { color: 'red' }, keep: ['opacity'] })
    })
  })

  describe('inherited properties and the parent', () => {
    it('drops an inherited property equal to the parent', () => {
      expect(
        kept({ color: 'rgb(51, 51, 51)', fontFamily: 'Inter' }, { parent: { color: '#333' } }),
      ).toEqual(['font-family: Inter'])
    })

    it('compares normal forms', () => {
      const parent = { fontFamily: "'Helvetica Neue', Arial, SANS-SERIF", fontWeight: 'bold' }
      expect(
        kept({ fontFamily: '"Helvetica Neue",Arial,sans-serif', fontWeight: '700' }, { parent }),
      ).toEqual([])
    })

    it('keeps an inherited property that differs from the parent', () => {
      expect(kept({ color: 'red' }, { parent: { color: 'blue' } })).toEqual(['color: red'])
    })

    it('keeps a non-inherited property even when the parent has the same value', () => {
      expect(kept({ paddingTop: '4px' }, { parent: { paddingTop: '4px' } })).toEqual([
        'padding-top: 4px',
      ])
    })

    it('keeps an inherited property the given parent does not list', () => {
      expect(kept({ letterSpacing: 'normal' }, { parent: { color: 'red' } })).toEqual([
        'letter-spacing: normal',
      ])
    })

    it("resolves em against each element's own font size (N10)", () => {
      expect(
        kept(
          { fontSize: '20px', letterSpacing: '0.1em' },
          { parent: { fontSize: '16px', letterSpacing: '2px' } },
        ),
      ).toEqual(['font-size: 20px'])
    })
  })

  describe('the baseline', () => {
    it('drops any property equal to the baseline', () => {
      const baseline = { display: 'block', marginTop: '0px', color: 'rgb(0, 0, 0)' }
      expect(kept({ display: 'block', marginTop: '0', color: 'black' }, { baseline })).toEqual([])
    })

    it('keeps a property that differs from the baseline', () => {
      expect(kept({ display: 'flex' }, { baseline: { display: 'block' } })).toEqual([
        'display: flex',
      ])
    })

    it('wins over the parent for inherited properties (it was rendered under the parent)', () => {
      const parent = { fontFamily: 'Inter', color: 'rgb(51, 51, 51)' }
      // <code>: Preflight sets a mono font, so a font equal to the parent's must stay.
      expect(
        kept({ fontFamily: 'Inter' }, { parent, baseline: { fontFamily: 'ui-monospace' } }),
      ).toEqual(['font-family: Inter'])
      // A tag rule set the color the element has: no class needed, whatever the parent's.
      expect(
        kept({ color: 'rgb(0, 0, 0)' }, { parent, baseline: { color: 'rgb(0, 0, 0)' } }),
      ).toEqual([])
    })

    it('falls back to the parent for inherited properties it does not list', () => {
      expect(
        kept({ color: 'red' }, { parent: { color: 'red' }, baseline: { display: 'block' } }),
      ).toEqual([])
    })

    it('wins over initial values', () => {
      // A <div> shown inline: inline is the initial value, but not the div's.
      expect(kept({ display: 'inline' }, { baseline: { display: 'block' } })).toEqual([
        'display: inline',
      ])
    })
  })

  describe('initial values', () => {
    it('drops a non-inherited property at its initial value', () => {
      expect(
        kept(
          {
            opacity: 1,
            zIndex: 'auto',
            transform: 'none',
            backgroundColor: 'rgba(0, 0, 0, 0)',
            transitionDuration: '0s',
            display: 'inline',
          },
          {},
        ),
      ).toEqual([])
    })

    it('keeps a value other than the initial one', () => {
      expect(kept({ opacity: 0.5, display: 'block' }, {})).toEqual([
        'opacity: 0.5',
        'display: block',
      ])
    })

    it('drops an inherited property at its initial value only without a parent (a root)', () => {
      const styles = { letterSpacing: 'normal', textTransform: 'none' }
      expect(kept(styles, {})).toEqual([])
      expect(kept(styles, { parent: { letterSpacing: '1px', textTransform: 'none' } })).toEqual([
        'letter-spacing: normal',
      ])
    })

    it('keeps a property without a known initial value', () => {
      expect(kept({ WebkitBorderHorizontalSpacing: '0px' }, {})).toEqual([
        '-webkit-border-horizontal-spacing: 0px',
      ])
    })
  })

  describe('currentcolor', () => {
    const styles = {
      color: 'rgb(51, 51, 51)',
      borderTopColor: 'rgb(51, 51, 51)',
      textDecorationColor: '#333',
    }

    it("counts a color equal to the element's own color as currentcolor", () => {
      expect(kept(styles, { parent: { color: 'rgb(51, 51, 51)' } })).toEqual([])
    })

    it("compares with the baseline's currentcolor", () => {
      const baseline = { color: 'black', borderTopColor: 'black', textDecorationColor: 'black' }
      expect(kept(styles, { baseline })).toEqual(['color: rgb(51, 51, 51)'])
    })

    it('keeps a color the baseline sets explicitly', () => {
      const baseline = { color: 'black', borderTopColor: 'rgb(229, 231, 235)' }
      expect(kept(styles, { baseline })).toEqual([
        'color: rgb(51, 51, 51)',
        'border-top-color: rgb(51, 51, 51)',
      ])
    })

    it('keeps a color other than the own color', () => {
      expect(kept({ color: 'red', borderTopColor: 'blue' }, { parent: { color: 'red' } })).toEqual([
        'border-top-color: blue',
      ])
    })

    it('reads back the colors whose auto value computes to currentcolor', () => {
      const own = { color: 'red', caretColor: 'red', outlineColor: 'red', rowRuleColor: 'red' }
      const baseline = {
        color: 'black',
        caretColor: 'black',
        outlineColor: 'black',
        rowRuleColor: 'black',
      }
      expect(kept(own, { baseline })).toEqual(['color: red'])
      expect(kept({ ...own, color: 'blue' }, { baseline })).toEqual([
        'color: blue',
        'caret-color: red',
        'outline-color: red',
        'row-rule-color: red',
      ])
    })

    it("reads back the parent's inherited currentcolor too", () => {
      const parent = { color: 'black', caretColor: 'black', WebkitTextFillColor: 'black' }
      expect(
        kept({ color: 'red', caretColor: 'red', WebkitTextFillColor: 'red' }, { parent }),
      ).toEqual(['color: red'])
    })
  })

  describe('logical twins', () => {
    const flow = { direction: 'ltr', writingMode: 'horizontal-tb' }

    it('drops a logical longhand equal to the physical one it maps to', () => {
      expect(
        kept(
          {
            ...flow,
            paddingLeft: '20px',
            paddingInlineStart: '20px',
            marginTop: '-10px',
            marginBlockStart: '-10px',
            height: '45px',
            blockSize: '45px',
            maxWidth: '1200px',
            maxInlineSize: '1200px',
            borderInlineEndColor: 'red',
            borderRightColor: 'red',
            borderStartEndRadius: '5px',
            borderTopRightRadius: '5px',
            insetInlineStart: '4px',
            left: '4px',
            overscrollBehaviorBlock: 'contain',
            overscrollBehaviorY: 'contain',
          },
          { baseline: flow },
        ),
      ).toEqual([
        'padding-left: 20px',
        'margin-top: -10px',
        'height: 45px',
        'max-width: 1200px',
        'border-right-color: red',
        'border-top-right-radius: 5px',
        'left: 4px',
        'overscroll-behavior-y: contain',
      ])
    })

    it('drops overflow-block and overflow-inline equal to overflow-y and overflow-x', () => {
      expect(
        kept(
          {
            ...flow,
            overflowX: 'hidden',
            overflowY: 'auto',
            overflowBlock: 'auto',
            overflowInline: 'hidden',
          },
          { baseline: flow },
        ),
      ).toEqual(['overflow-x: hidden', 'overflow-y: auto'])
    })

    it('maps inline sides by direction', () => {
      const styles = { paddingInlineStart: '20px', paddingRight: '20px', paddingLeft: '0px' }
      expect(kept({ ...styles, direction: 'rtl', writingMode: 'horizontal-tb' }, {})).toEqual([
        'padding-right: 20px',
        'direction: rtl',
      ])
      expect(kept({ ...styles, ...flow }, {})).toEqual([
        'padding-inline-start: 20px',
        'padding-right: 20px',
      ])
    })

    it('keeps both without a known horizontal writing mode', () => {
      const styles = { paddingLeft: '20px', paddingInlineStart: '20px' }
      expect(kept(styles, {})).toEqual(['padding-left: 20px', 'padding-inline-start: 20px'])
      expect(kept({ ...styles, direction: 'ltr', writingMode: 'vertical-rl' }, {})).toEqual([
        'padding-left: 20px',
        'padding-inline-start: 20px',
        'writing-mode: vertical-rl',
      ])
    })

    it('keeps a logical longhand whose physical twin differs or is missing', () => {
      expect(kept({ ...flow, paddingInlineStart: '20px' }, {})).toEqual([
        'padding-inline-start: 20px',
      ])
    })
  })

  describe('origins at the center of the box', () => {
    it('reads a resolved center back as the initial 50% 50%', () => {
      const box = { width: '63.4688px', height: '50px', boxSizing: 'border-box' }
      expect(
        kept(
          { ...box, transformOrigin: '31.7344px 25px', perspectiveOrigin: '31.7344px 25px' },
          {
            baseline: {
              width: '100px',
              height: '0px',
              boxSizing: 'border-box',
              transformOrigin: '50px 0px',
            },
          },
        ),
      ).toEqual(['width: 63.4688px', 'height: 50px'])
    })

    it('measures the border box, within a hundredth of a pixel', () => {
      const box = {
        width: '100px',
        height: '20px',
        boxSizing: 'content-box',
        paddingTop: '0px',
        paddingRight: '10px',
        paddingBottom: '0px',
        paddingLeft: '10px',
        borderTopWidth: '1px',
        borderRightWidth: '0px',
        borderBottomWidth: '1px',
        borderLeftWidth: '0px',
      }
      expect(kept({ ...box, transformOrigin: '60.004px 11px' }, {})).not.toContain(
        'transform-origin: 60.004px 11px',
      )
      expect(kept({ ...box, transformOrigin: '50px 10px' }, {})).toContain(
        'transform-origin: 50px 10px',
      )
      const { paddingLeft: _, ...unknownPadding } = box
      expect(kept({ ...unknownPadding, transformOrigin: '55px 11px' }, {})).toContain(
        'transform-origin: 55px 11px',
      )
    })

    it('keeps an origin off the center, or without a size to compare with', () => {
      expect(kept({ width: '100px', height: '50px', transformOrigin: '0px 0px' }, {})).toEqual([
        'width: 100px',
        'height: 50px',
        'transform-origin: 0px 0px',
      ])
      expect(kept({ width: 'auto', height: 'auto', transformOrigin: '10px 5px' }, {})).toEqual([
        'transform-origin: 10px 5px',
      ])
    })
  })

  describe('origins left unresolved', () => {
    it('reads 50% 50% (a box that is not rendered keeps the computed value) as initial', () => {
      expect(
        kept(
          {
            display: 'none',
            transformOrigin: '50% 50%',
            perspectiveOrigin: '50% 50%',
          },
          {
            baseline: {
              display: 'block',
              width: '100px',
              height: '0px',
              boxSizing: 'border-box',
              transformOrigin: '50px 0px',
            },
          },
        ),
      ).toEqual(['display: none'])
      expect(kept({ display: 'none', transformOrigin: '50% 0%' }, {})).toEqual([
        'display: none',
        'transform-origin: 50% 0%',
      ])
    })
  })

  describe('origins of inline boxes', () => {
    it('reads any origin of an inline box with no size back as initial (no transform applies)', () => {
      const inline = { display: 'inline', width: 'auto', height: 'auto', boxSizing: 'border-box' }
      expect(
        kept(
          {
            display: 'block',
            width: '1200px',
            height: '30px',
            boxSizing: 'border-box',
            transformOrigin: '600px 15px',
          },
          { baseline: { ...inline, transformOrigin: '0px 0px' } },
        ),
      ).toEqual(['display: block', 'width: 1200px', 'height: 30px'])
    })
  })

  describe('border, outline and column rule styles', () => {
    it('drops a none style, which shows nothing whatever the baseline', () => {
      const styles = {
        borderTopStyle: 'none',
        borderTopWidth: '0px',
        outlineStyle: 'none',
        columnRuleStyle: 'none',
      }
      const baseline = { borderTopStyle: 'solid', borderTopWidth: '0px', outlineStyle: 'solid' }
      expect(kept(styles, { baseline })).toEqual([])
    })

    it('keeps the style of a visible side or outline whose width is kept', () => {
      const baseline = {
        borderTopStyle: 'solid',
        borderTopWidth: '0px',
        borderLeftStyle: 'solid',
        borderLeftWidth: '1px',
        outlineStyle: 'solid',
        outlineWidth: '0px',
      }
      expect(
        kept(
          {
            borderTopStyle: 'solid',
            borderTopWidth: '1px',
            borderLeftStyle: 'solid',
            borderLeftWidth: '1px',
            outlineStyle: 'solid',
            outlineWidth: '2px',
          },
          { baseline },
        ),
      ).toEqual([
        'border-top-style: solid',
        'border-top-width: 1px',
        'outline-style: solid',
        'outline-width: 2px',
      ])
    })
  })

  describe('repeated list items', () => {
    it('compares a coordinated list of equal items as one item', () => {
      expect(
        kept(
          {
            transitionProperty: 'color, background-color',
            transitionDelay: '0s, 0s',
            transitionBehavior: 'normal, normal',
            transitionDuration: '0.2s, 0.2s',
            backgroundRepeat: 'repeat, repeat',
          },
          {},
        ),
      ).toEqual(['transition-property: color, background-color', 'transition-duration: 0.2s, 0.2s'])
    })

    it('keeps lists that are not coordinated, or of different items', () => {
      expect(
        kept(
          { boxShadow: 'none, none', transitionDelay: '0s, 1s', animationName: 'none, none' },
          {},
        ),
      ).toEqual([
        'box-shadow: none, none',
        'transition-delay: 0s, 1s',
        'animation-name: none, none',
      ])
    })
  })

  describe('shorthands listed next to their longhands', () => {
    it('drops a shorthand whose longhands are all listed with the same values', () => {
      expect(
        kept(
          {
            textDecoration: 'underline rgb(1, 88, 135)',
            textDecorationColor: 'rgb(1, 88, 135)',
            textDecorationLine: 'underline',
            textDecorationStyle: 'solid',
            textDecorationThickness: 'auto',
          },
          {},
        ),
      ).toEqual(['text-decoration-color: rgb(1, 88, 135)', 'text-decoration-line: underline'])
    })

    it('reads the longhands back first (a resolved color is the currentcolor of the shorthand)', () => {
      expect(
        kept(
          {
            color: 'rgb(180, 35, 90)',
            textDecoration: 'underline',
            textDecorationColor: 'rgb(180, 35, 90)',
            textDecorationLine: 'underline',
            textDecorationStyle: 'solid',
            textDecorationThickness: 'auto',
          },
          {},
        ),
      ).toEqual(['color: rgb(180, 35, 90)', 'text-decoration-line: underline'])
    })

    it('keeps it when a longhand is missing or differs', () => {
      expect(
        kept({ textDecoration: 'underline red', textDecorationLine: 'underline' }, {}),
      ).toEqual(['text-decoration: underline red', 'text-decoration-line: underline'])
    })
  })

  describe('line-height', () => {
    // Computed line-heights are px whether the author wrote a length or a number.
    it('keeps a px line-height equal to the reference when the font sizes differ', () => {
      const baseline = { fontSize: '16px', lineHeight: '24px' }
      expect(kept({ fontSize: '14px', lineHeight: '24px' }, { baseline })).toEqual([
        'font-size: 14px',
        'line-height: 24px',
      ])
      expect(kept({ fontSize: '14px', lineHeight: '24px' }, { parent: baseline })).toEqual([
        'font-size: 14px',
        'line-height: 24px',
      ])
    })

    it('drops it when the font sizes are equal, and compares normal as usual', () => {
      const baseline = { fontSize: '16px', lineHeight: '24px' }
      expect(kept({ fontSize: '16px', lineHeight: '24px' }, { baseline })).toEqual([])
      expect(
        kept(
          { fontSize: '14px', lineHeight: 'normal' },
          { baseline: { fontSize: '16px', lineHeight: 'normal' } },
        ),
      ).toEqual(['font-size: 14px'])
    })
  })

  describe('min sizes of a box that is not rendered', () => {
    it('reads 0px back as auto (min-width: auto computes to 0px outside flex and grid items)', () => {
      const baseline = { display: 'block', minWidth: 'auto', minHeight: 'auto' }
      expect(kept({ display: 'none', minWidth: '0px', minHeight: '0px' }, { baseline })).toEqual([
        'display: none',
      ])
      expect(kept({ display: 'block', minWidth: '0px' }, { baseline })).toEqual(['min-width: 0px'])
    })
  })

  describe('insets of a relatively positioned box', () => {
    it('reads 0px on both sides of an axis back as auto (no offset either way)', () => {
      const insets = { top: '0px', right: '0px', bottom: '0px', left: '0px' }
      expect(kept({ position: 'relative', ...insets }, {})).toEqual(['position: relative'])
    })

    it('keeps an axis with an offset, and the insets of other positions', () => {
      expect(
        kept({ position: 'relative', top: '10px', bottom: '-10px', left: '0px', right: '0px' }, {}),
      ).toEqual(['position: relative', 'top: 10px', 'bottom: -10px'])
      expect(kept({ position: 'sticky', top: '0px', bottom: '0px' }, {})).toEqual([
        'position: sticky',
        'top: 0px',
        'bottom: 0px',
      ])
    })
  })

  describe('derived properties', () => {
    it('drops -webkit-text-decorations-in-effect, which Chromium derives and CSS cannot set', () => {
      expect(
        kept({ textDecorationLine: 'underline', WebkitTextDecorationsInEffect: 'underline' }, {}),
      ).toEqual(['text-decoration-line: underline'])
    })
  })

  describe('custom properties', () => {
    it('drops them, since computed values have var() substituted', () => {
      expect(kept({ '--tw-shadow': '0 0 #0000', '--pico-color': 'red', color: 'red' }, {})).toEqual(
        ['color: red'],
      )
    })

    it('keeps the ones listed in keep', () => {
      expect(kept({ '--brand': 'red', '--other': 'blue' }, { keep: ['--brand'] })).toEqual([
        '--brand: red',
      ])
    })
  })

  describe('keep and drop', () => {
    it('drops listed properties whatever their value', () => {
      expect(
        kept({ width: '742px', height: '38px', opacity: 0.5 }, { drop: ['width', 'height'] }),
      ).toEqual(['opacity: 0.5'])
    })

    it('keeps listed properties even when they would be pruned', () => {
      expect(
        kept(
          { color: 'red', opacity: 1 },
          { parent: { color: 'red' }, keep: ['color', 'opacity'] },
        ),
      ).toEqual(['color: red', 'opacity: 1'])
    })

    it('accepts camelCase names, and a shorthand stands for its longhands', () => {
      const styles = { transitionDuration: '0.2s', transitionProperty: 'color', marginTop: '4px' }
      expect(kept(styles, { drop: ['transition', 'marginTop'] })).toEqual([])
      expect(kept({ transitionDuration: '0s' }, { keep: ['transition'] })).toEqual([
        'transition-duration: 0s',
      ])
    })

    it('still reads back from what it drops (a dropped size keeps the origin at the center)', () => {
      const styles = {
        width: '120px',
        height: '40px',
        boxSizing: 'border-box',
        transformOrigin: '60px 20px',
        color: 'red',
        borderTopColor: 'red',
      }
      expect(kept(styles, { drop: ['width', 'height', 'color'] })).toEqual([
        'box-sizing: border-box',
      ])
    })

    it('lets keep win over drop', () => {
      expect(kept({ opacity: 0.5 }, { keep: ['opacity'], drop: ['opacity'] })).toEqual([
        'opacity: 0.5',
      ])
    })

    it('applies to invalid declarations too', () => {
      expect(kept({ color: '' }, { drop: ['color'] })).toEqual([])
    })
  })

  describe('important declarations', () => {
    it('keeps them, since importance matters beyond the element', () => {
      expect(kept('color: red !important', { parent: { color: 'red' } })).toEqual([
        'color: red !important',
      ])
    })
  })

  describe('declarations that set the same longhands', () => {
    it('drops a shorthand and its longhands when every longhand is pruned', () => {
      expect(kept({ margin: '0px', marginTop: '0px' }, {})).toEqual([])
    })

    it('judges a longhand by the declaration that wins it', () => {
      expect(kept('color: red; color: blue', { parent: { color: 'blue' } })).toEqual([])
      expect(kept('color: blue; color: red', { parent: { color: 'blue' } })).toEqual([
        'color: blue',
        'color: red',
      ])
    })

    it('keeps every declaration of a longhand that a kept declaration sets', () => {
      // margin stays for its right side, so margin-top must stay to keep winning over it.
      expect(
        kept({ margin: '0px 1px', marginTop: '5px' }, { baseline: { marginTop: '5px' } }),
      ).toEqual(['margin: 0px 1px', 'margin-top: 5px'])
    })

    it('keeps a whole shorthand and the longhands it overlaps (N01)', () => {
      expect(
        kept({ padding: 'var(--p)', paddingTop: '0px' }, { baseline: { paddingTop: '0px' } }),
      ).toEqual(['padding: var(--p)', 'padding-top: 0px'])
    })
  })
})
