; JavaScript: what its tags query leaves out.

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

[(jsx_element) (jsx_self_closing_element)] @block.markup
