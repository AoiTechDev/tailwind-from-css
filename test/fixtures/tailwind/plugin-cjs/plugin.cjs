module.exports = ({ addUtilities, addVariant }) => {
  addUtilities({ '.tfc-legacy': { 'text-wrap': 'balance' } })
  addVariant('tfc-optional', '&:optional')
}
