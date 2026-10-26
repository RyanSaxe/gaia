; TypeScript: what its tags queries (TypeScript's and JavaScript's) leave out.
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum

(import_statement source: (string (string_fragment) @name)) @reference.import
(export_statement source: (string (string_fragment) @name)) @reference.import
((call_expression function: (identifier) @_f arguments: (arguments . (string (string_fragment) @name))) @reference.import
  (#eq? @_f "require"))

; Names an import binds under the file's own: `b` in `import { a as b }`, a
; namespace and a default import; and the definition a file exports as its default.
(import_specifier name: (_) @imported alias: (identifier) @name) @alias.renamed
(namespace_import (identifier) @name) @alias.module
(import_clause (identifier) @name) @alias.default

; What an `export … from` passes on to the files that import this one: a name,
; a name renamed, the module under a name, and everything the module exports.
(export_statement (export_clause (export_specifier name: (_) @name !alias) @reexport.named) source: (_))
(export_statement (export_clause (export_specifier name: (_) @imported alias: (_) @name) @reexport.renamed) source: (_))
(export_statement (namespace_export (_) @name) @reexport.module source: (_))
(export_statement "*" source: (_)) @reexport.all
(export_statement "default" declaration: (_ name: (_) @name)) @export.default
(export_statement "default" value: (identifier) @name) @export.default

[(if_statement) (ternary_expression)] @block.branch
[(for_statement) (for_in_statement) (while_statement) (do_statement)] @block.loop
(switch_statement) @block.match
(try_statement) @block.try
[(arrow_function) (function_expression)] @block.closure
[(object) (array)] @block.data
