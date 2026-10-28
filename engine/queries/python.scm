; Python: what its tags query leaves out.
(import_statement name: (dotted_name) @name) @reference.import
(import_statement name: (aliased_import name: (dotted_name) @name)) @reference.import
(import_from_statement module_name: (_) @name) @reference.import

; Names an import binds in the file: a module (`import m as n`) and a name from
; one (`from m import a as b`).
(import_statement name: (aliased_import alias: (identifier) @name) @alias.module)
(import_from_statement name: (aliased_import name: (_) @imported alias: (identifier) @name) @alias.renamed)

; What a module passes on to the files that import it: every name its `from`
; imports bind, as a package's `__init__.py` collects its modules' names.
(import_from_statement name: (dotted_name) @name @reexport.named)
(import_from_statement name: (aliased_import name: (_) @imported alias: (identifier) @name) @reexport.renamed)
(import_from_statement (wildcard_import) @reexport.all)

(function_definition body: (block . (expression_statement (string (string_content) @doc))))
(class_definition body: (block . (expression_statement (string (string_content) @doc))))

[(if_statement) (conditional_expression)] @block.branch
[(for_statement) (while_statement)] @block.loop
(match_statement) @block.match
(try_statement) @block.try
(lambda) @block.closure
(with_statement) @block.scope
[(list) (dictionary) (set)] @block.data
