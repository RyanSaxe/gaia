; TOML: each table and top-level key is a definition, and every string a literal.
(document (table [(bare_key) (dotted_key) (quoted_key)] @name) @definition.section)
(document (table_array_element [(bare_key) (dotted_key) (quoted_key)] @name) @definition.section)
(document (pair [(bare_key) (dotted_key) (quoted_key)] @name) @definition.key)
(string) @literal
