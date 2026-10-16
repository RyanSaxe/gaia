; C: what its tags query leaves out.
(preproc_include path: (_) @name) @reference.import
(call_expression function: (identifier) @name) @reference.call

[(if_statement) (conditional_expression)] @block.branch
[(for_statement) (while_statement) (do_statement)] @block.loop
(switch_statement) @block.match
(initializer_list) @block.data
