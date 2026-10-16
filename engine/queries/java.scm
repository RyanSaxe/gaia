; Java: what its tags query leaves out.
(import_declaration (scoped_identifier) @name) @reference.import

[(if_statement) (ternary_expression)] @block.branch
[(for_statement) (enhanced_for_statement) (while_statement) (do_statement)] @block.loop
(switch_expression) @block.match
[(try_statement) (try_with_resources_statement)] @block.try
(lambda_expression) @block.closure
(synchronized_statement) @block.concurrent
(array_initializer) @block.data
