; Swift: what its tags query leaves out.
(import_declaration (identifier) @name) @reference.import
(call_expression (simple_identifier) @name) @reference.call

[(if_statement) (guard_statement) (ternary_expression)] @block.branch
[(for_statement) (while_statement) (repeat_while_statement)] @block.loop
(switch_statement) @block.match
(do_statement) @block.try
(lambda_literal) @block.closure
[(array_literal) (dictionary_literal)] @block.data
