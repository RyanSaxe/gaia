; Java: what its tags query leaves out.
(import_declaration (scoped_identifier) @name) @reference.import

[(if_statement) (ternary_expression)] @block.branch
[(for_statement) (enhanced_for_statement) (while_statement) (do_statement)] @block.loop
(switch_expression) @block.match
[(try_statement) (try_with_resources_statement)] @block.try
(lambda_expression) @block.closure
(synchronized_statement) @block.concurrent
(array_initializer) @block.data

(if_statement alternative: (if_statement) @decide.elseif)
(if_statement alternative: (block) @decide.else)
((switch_label) @decide.case (#not-match? @decide.case "^default"))
(catch_clause) @decide.catch
(binary_expression operator: ["&&" "||"]) @decide.logic

(string_fragment) @literal
