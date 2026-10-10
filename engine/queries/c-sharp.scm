; C#: what its tags query leaves out.
(using_directive [(identifier) (qualified_name)] @name) @reference.import
(invocation_expression function: (identifier) @name) @reference.call

[(if_statement) (conditional_expression)] @block.branch
[(for_statement) (foreach_statement) (while_statement) (do_statement)] @block.loop
[(switch_statement) (switch_expression)] @block.match
(try_statement) @block.try
[(lambda_expression) (anonymous_method_expression)] @block.closure
(using_statement) @block.scope
(lock_statement) @block.concurrent
(unsafe_statement) @block.unsafe
(initializer_expression) @block.data

(if_statement alternative: (if_statement) @decide.elseif)
(if_statement alternative: (block) @decide.else)
(switch_section [(constant_pattern) (declaration_pattern) (recursive_pattern) (type_pattern)]) @decide.case
(catch_clause) @decide.catch
(binary_expression operator: ["&&" "||"]) @decide.logic

(string_literal_content) @literal
