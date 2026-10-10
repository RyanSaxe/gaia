; Go: what its tags query leaves out.
(import_spec path: (interpreted_string_literal) @name) @reference.import
(method_declaration
  receiver: (parameter_list (parameter_declaration type: [(type_identifier) @owner (pointer_type (type_identifier) @owner)]))) @scope

(if_statement) @block.branch
(for_statement) @block.loop
[(expression_switch_statement) (type_switch_statement) (select_statement)] @block.match
(func_literal) @block.closure
(go_statement) @block.concurrent
(composite_literal) @block.data

(if_statement alternative: (if_statement) @decide.elseif)
(if_statement alternative: (block) @decide.else)
[(expression_case) (type_case) (communication_case)] @decide.case
(binary_expression operator: ["&&" "||"]) @decide.logic

(interpreted_string_literal) @literal
