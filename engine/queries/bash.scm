; Bash: its grammar ships no tags query, so this file finds definitions too.
(function_definition name: (word) @name) @definition.function
((command name: (command_name) @_c argument: (_) @name) @reference.import
  (#any-of? @_c "source" "."))
(command name: (command_name (word) @name)) @reference.call

(if_statement) @block.branch
[(for_statement) (c_style_for_statement) (while_statement)] @block.loop
(case_statement) @block.match

(elif_clause) @decide.elseif
(else_clause) @decide.else
((case_item value: (_) @_v) @decide.case (#not-eq? @_v "*"))
(list) @decide.logic

(string_content) @literal
(raw_string) @literal
(file_redirect destination: (word) @literal)
(command argument: (word) @literal)
