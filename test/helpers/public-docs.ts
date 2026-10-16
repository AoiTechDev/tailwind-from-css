import { API, SymbolFlags } from 'typescript/unstable/sync'
import { REPO_ROOT } from './design-system.ts'

/** The TSDoc of one export of a module, as an editor shows it. */
export interface ExportDocs {
  name: string
  kind: 'function' | 'class' | 'type'
  documentation: string
  /** Block tag names, sorted (`example`, `param`, `throws` …). */
  tags: string[]
}

/**
 * The exports of `file` with their TSDoc, sorted by name. Reads the file through the
 * TypeScript 7 API (which runs the native compiler), so aliases resolve as in an editor.
 */
export function exportDocs(file: string): ExportDocs[] {
  const api = new API({ cwd: REPO_ROOT })
  try {
    const project = api.updateSnapshot({ openFiles: [file] }).getDefaultProjectForFile(file)
    const sourceFile = project?.program.getSourceFile(file)
    if (project === undefined || sourceFile === undefined) throw new Error(`can't load ${file}`)
    const { checker } = project
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) throw new Error(`${file} is not a module`)
    return checker
      .getExportsOfModule(moduleSymbol)
      .map((exported) => {
        const symbol =
          exported.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
        const kind: ExportDocs['kind'] =
          symbol.flags & SymbolFlags.Function
            ? 'function'
            : symbol.flags & SymbolFlags.Class
              ? 'class'
              : 'type'
        return {
          name: exported.name,
          kind,
          documentation: checker.getDocumentationCommentOfSymbol(symbol),
          tags: checker
            .getJsDocTagsOfSymbol(symbol)
            .map((tag) => tag.name)
            .sort(),
        }
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  } finally {
    api.close()
  }
}
