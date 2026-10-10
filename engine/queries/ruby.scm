; Ruby: what its tags query leaves out.
((call method: (identifier) @_m arguments: (argument_list (string (string_content) @name))) @reference.import
  (#any-of? @_m "require" "require_relative" "load"))

[(if) (unless) (conditional) (if_modifier) (unless_modifier)] @block.branch
[(while) (until) (for) (while_modifier) (until_modifier)] @block.loop
(case) @block.match
(begin) @block.try
[(do_block) (block) (lambda)] @block.closure
[(array) (hash)] @block.data

(elsif) @decide.elseif
(else) @decide.else
(when) @decide.case
(rescue) @decide.catch
(binary operator: ["&&" "||" "and" "or"]) @decide.logic

(string_content) @literal
