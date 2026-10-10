interface Config {
  theme: { extend: { colors: Record<string, string> } }
}

const config: Config = {
  theme: { extend: { colors: { typed: '#fedcba' } } },
}

export default config
