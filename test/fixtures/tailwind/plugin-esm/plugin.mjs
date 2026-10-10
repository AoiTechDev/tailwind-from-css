import plugin from 'tailwindcss/plugin'

export default plugin(({ addUtilities, matchUtilities, addVariant }) => {
  addUtilities({
    '.tfc-card': {
      'border-radius': '12px',
      '&:hover': { 'border-radius': '16px' },
    },
  })
  matchUtilities({ 'tfc-tab': (value) => ({ 'tab-size': value }) }, { values: { 2: '2', 4: '4' } })
  addVariant('tfc-hocus', ['&:hover', '&:focus'])
})
