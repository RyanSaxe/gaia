; Python: what its tags query leaves out.
(import_statement name: (dotted_name) @name) @reference.import
(import_statement name: (aliased_import name: (dotted_name) @name)) @reference.import
(import_from_statement module_name: (_) @name) @reference.import

(function_definition body: (block . (expression_statement (string (string_content) @doc))))
(class_definition body: (block . (expression_statement (string (string_content) @doc))))

[(if_statement) (conditional_expression)] @block.branch
[(for_statement) (while_statement)] @block.loop
(match_statement) @block.match
(try_statement) @block.try
(lambda) @block.closure
(with_statement) @block.scope
[(list) (dictionary) (set)] @block.data

(elif_clause) @decide.elseif
(if_statement alternative: (else_clause) @decide.else)
((case_clause (case_pattern) @_p) @decide.case (#not-eq? @_p "_"))
(except_clause) @decide.catch
(boolean_operator) @decide.logic

(string_content) @literal
