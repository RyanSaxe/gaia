; HTML: an element with an id is a definition; a src or href is a literal.
((element (start_tag (attribute (attribute_name) @_a (quoted_attribute_value (attribute_value) @name)))) @definition.element
  (#eq? @_a "id"))
((attribute (attribute_name) @_a (quoted_attribute_value (attribute_value) @literal))
  (#any-of? @_a "src" "href"))
