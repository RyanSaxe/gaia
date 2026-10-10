; C: what its tags query leaves out.
(preproc_include path: (_) @name) @reference.import
(call_expression function: (identifier) @name) @reference.call

[(if_statement) (conditional_expression)] @block.branch
[(for_statement) (while_statement) (do_statement)] @block.loop
(switch_statement) @block.match
(initializer_list) @block.data

(else_clause (if_statement) @decide.elseif)
(else_clause (compound_statement)) @decide.else
(case_statement value: (_)) @decide.case
(binary_expression operator: ["&&" "||"]) @decide.logic

(string_content) @literal
