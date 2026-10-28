; Kotlin: its grammar ships no tags query, so this file also captures definitions.
(class_declaration name: (_) @name) @definition.class
(object_declaration name: (_) @name) @definition.class
(function_declaration name: (_) @name) @definition.function
(import (qualified_identifier) @name) @reference.import
(call_expression (identifier) @name) @reference.call
(call_expression (navigation_expression (identifier) (identifier) @name)) @reference.call

(if_expression) @block.branch
[(for_statement) (while_statement) (do_while_statement)] @block.loop
(when_expression) @block.match
(try_expression) @block.try
(lambda_literal) @block.closure
