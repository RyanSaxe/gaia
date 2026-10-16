; HTML: an element with an id is a definition.
((element (start_tag (attribute (attribute_name) @_a (quoted_attribute_value (attribute_value) @name)))) @definition.element
  (#eq? @_a "id"))
