; Rust: what its tags query leaves out.
(use_declaration argument: (_) @name) @reference.import
(call_expression function: (scoped_identifier name: (identifier) @name)) @reference.call
(impl_item type: (_) @owner) @scope

; A name a `use` binds under the file's own: `b` in `use m::a as b`.
(use_as_clause path: (_) @imported alias: (identifier) @name) @alias.renamed

; What a `pub use` passes on to the files that import this one.
(use_declaration (visibility_modifier) argument: (scoped_identifier name: (identifier) @name) @reexport.named)
(use_declaration (visibility_modifier) argument: (use_as_clause path: (_) @imported alias: (identifier) @name) @reexport.renamed)
(use_declaration (visibility_modifier) argument: (scoped_use_list list: (use_list (identifier) @name @reexport.named)))
(use_declaration (visibility_modifier) argument: (scoped_use_list list: (use_list (use_as_clause path: (_) @imported alias: (identifier) @name) @reexport.renamed)))
(use_declaration (visibility_modifier) argument: (use_wildcard) @reexport.all)

(if_expression) @block.branch
(match_expression) @block.match
[(for_expression) (while_expression) (loop_expression)] @block.loop
(closure_expression) @block.closure
(unsafe_block) @block.unsafe
(async_block) @block.concurrent
[(struct_expression) (array_expression)] @block.data
