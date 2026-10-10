; Rust: what its tags query leaves out.
(use_declaration argument: (_) @name) @reference.import
(call_expression function: (scoped_identifier name: (identifier) @name)) @reference.call
(impl_item type: (_) @owner) @scope

(if_expression) @block.branch
(match_expression) @block.match
[(for_expression) (while_expression) (loop_expression)] @block.loop
(closure_expression) @block.closure
(unsafe_block) @block.unsafe
(async_block) @block.concurrent
[(struct_expression) (array_expression)] @block.data

(else_clause (if_expression) @decide.elseif)
(else_clause (block) @decide.else)
((match_arm pattern: (match_pattern) @_p) @decide.case (#not-eq? @_p "_"))
(binary_expression operator: ["&&" "||"]) @decide.logic

(string_content) @literal
