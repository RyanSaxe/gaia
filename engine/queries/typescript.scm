; TypeScript: what its tags queries (TypeScript's and JavaScript's) leave out.
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum

(import_statement source: (string (string_fragment) @name)) @reference.import
(export_statement source: (string (string_fragment) @name)) @reference.import
((call_expression function: (identifier) @_f arguments: (arguments . (string (string_fragment) @name))) @reference.import
  (#eq? @_f "require"))

[(if_statement) (ternary_expression)] @block.branch
[(for_statement) (for_in_statement) (while_statement) (do_statement)] @block.loop
(switch_statement) @block.match
(try_statement) @block.try
[(arrow_function) (function_expression)] @block.closure
[(object) (array)] @block.data

(else_clause (if_statement) @decide.elseif)
(else_clause) @decide.else
(switch_case) @decide.case
(catch_clause) @decide.catch
(binary_expression operator: ["&&" "||"]) @decide.logic

(string_fragment) @literal
