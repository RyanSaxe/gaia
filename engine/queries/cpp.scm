; C++: what its tags query leaves out.
(namespace_definition name: (namespace_identifier) @name) @definition.module
(preproc_include path: (_) @name) @reference.import
(call_expression function: (identifier) @name) @reference.call
(call_expression function: (field_expression field: (field_identifier) @name)) @reference.call

[(if_statement) (conditional_expression)] @block.branch
[(for_statement) (for_range_loop) (while_statement) (do_statement)] @block.loop
(switch_statement) @block.match
(try_statement) @block.try
(lambda_expression) @block.closure
(initializer_list) @block.data

(else_clause (if_statement) @decide.elseif)
(else_clause (compound_statement)) @decide.else
(case_statement value: (_)) @decide.case
(catch_clause) @decide.catch
(binary_expression operator: ["&&" "||"]) @decide.logic

(string_content) @literal
