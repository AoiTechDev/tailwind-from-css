import { describe, expect, it } from 'vitest'
import {
  inheritedProperties,
  initialValues,
  shorthandLonghands,
  unitlessProperties,
} from '../../../src/data/css-properties.generated.ts'

// React's isUnitlessNumber list in kebab-case, minus names that are not CSS properties
// (flex-positive, flex-negative, flex-order, grid-row-span, grid-column-span).
const REACT_UNITLESS = [
  'animation-iteration-count',
  'aspect-ratio',
  'border-image-outset',
  'border-image-slice',
  'border-image-width',
  'box-flex',
  'box-flex-group',
  'box-ordinal-group',
  'column-count',
  'columns',
  'fill-opacity',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flood-opacity',
  'font-weight',
  'grid-area',
  'grid-column',
  'grid-column-end',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-start',
  'line-clamp',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'scale',
  'stop-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'tab-size',
  'widows',
  'z-index',
  'zoom',
]

describe('unitlessProperties', () => {
  it.each(REACT_UNITLESS)('includes %s from the React list', (property) => {
    expect(unitlessProperties.has(property)).toBe(true)
  })

  it.each(['width', 'margin-top', 'font-size', 'letter-spacing', 'border-radius', 'gap'])(
    'excludes %s, which takes lengths only',
    (property) => {
      expect(unitlessProperties.has(property)).toBe(false)
    },
  )
})

describe('inheritedProperties', () => {
  it.each(['color', 'font-family', 'line-height', 'visibility', 'cursor'])('includes %s', (p) => {
    expect(inheritedProperties.has(p)).toBe(true)
  })

  it.each(['margin-top', 'display', 'background-color', 'opacity'])('excludes %s', (p) => {
    expect(inheritedProperties.has(p)).toBe(false)
  })
})

describe('initialValues', () => {
  it('has the CSS initial value of longhands', () => {
    expect(initialValues.get('display')).toBe('inline')
    expect(initialValues.get('opacity')).toBe('1')
    expect(initialValues.get('line-height')).toBe('normal')
  })

  it('omits shorthands and properties without a single initial value', () => {
    expect(initialValues.has('margin')).toBe(false)
    expect(initialValues.has('font-family')).toBe(false)
    expect(initialValues.has('text-align')).toBe(false)
    expect(initialValues.has('all')).toBe(false)
  })
})

describe('shorthandLonghands', () => {
  it('expands box shorthands', () => {
    expect(shorthandLonghands.get('margin')).toEqual([
      'margin-bottom',
      'margin-left',
      'margin-right',
      'margin-top',
    ])
  })

  it('expands nested shorthands down to longhands', () => {
    const border = shorthandLonghands.get('border') ?? []
    expect(border).toHaveLength(12)
    expect(border).toContain('border-top-width')
    expect(border).not.toContain('border-width')
  })

  it('lists only longhands, sorted', () => {
    for (const longhands of shorthandLonghands.values()) {
      expect(longhands.filter((p) => shorthandLonghands.has(p))).toEqual([])
      expect([...longhands].sort()).toEqual(longhands)
    }
  })
})
