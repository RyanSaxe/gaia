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
