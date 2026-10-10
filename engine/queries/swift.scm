; Swift: what its tags query leaves out.
(import_declaration (identifier) @name) @reference.import
(call_expression (simple_identifier) @name) @reference.call

[(if_statement) (guard_statement) (ternary_expression)] @block.branch
[(for_statement) (while_statement) (repeat_while_statement)] @block.loop
(switch_statement) @block.match
(do_statement) @block.try
(lambda_literal) @block.closure
[(array_literal) (dictionary_literal)] @block.data

(if_statement (if_statement) @decide.elseif)
(if_statement (else) @decide.else)
(switch_entry (switch_pattern)) @decide.case
(catch_block) @decide.catch
[(conjunction_expression) (disjunction_expression)] @decide.logic

(line_str_text) @literal
