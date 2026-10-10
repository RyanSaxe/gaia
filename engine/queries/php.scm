; PHP: what its tags query leaves out.
(namespace_use_clause (qualified_name) @name) @reference.import
([(require_expression) (require_once_expression) (include_expression) (include_once_expression)] (string (string_content) @name)) @reference.import
(function_call_expression function: (name) @name) @reference.call
(member_call_expression name: (name) @name) @reference.call

[(if_statement) (conditional_expression)] @block.branch
[(for_statement) (foreach_statement) (while_statement) (do_statement)] @block.loop
[(switch_statement) (match_expression)] @block.match
(try_statement) @block.try
[(anonymous_function) (arrow_function)] @block.closure
(array_creation_expression) @block.data

(else_if_clause) @decide.elseif
(else_clause) @decide.else
(case_statement) @decide.case
(catch_clause) @decide.catch
(binary_expression operator: ["&&" "||" "and" "or"]) @decide.logic

(string_content) @literal
