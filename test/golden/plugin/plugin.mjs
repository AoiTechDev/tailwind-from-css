import plugin from 'tailwindcss/plugin'

export default plugin(({ addUtilities, matchUtilities, addVariant }) => {
  addUtilities({
    '.tfc-glass': {
      'backdrop-filter': 'blur(4px)',
      'background-color': 'rgb(255 255 255 / 0.5)',
    },
    '.tfc-card': {
      'border-radius': '12px',
      '&:hover': { 'border-radius': '16px' },
    },
  })
  matchUtilities(
    { 'tfc-depth': (value) => ({ 'math-depth': value }) },
    { values: { 1: '1', 2: '2' } },
  )
  addVariant('tfc-open', '&[open]')
  addVariant('tfc-wide', '@media (min-width: 1400px)')
})
