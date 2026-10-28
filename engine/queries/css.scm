; CSS: rule sets are definitions, imports are references and media statements are blocks.
(rule_set (selectors) @name) @definition.rule
(import_statement [(string_value) (call_expression (arguments (string_value)))] @name) @reference.import
(media_statement) @block.scope
