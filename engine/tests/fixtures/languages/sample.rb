require "json"
require_relative "lib/helper"

# Walks names under a root.
class Walker
  # Lists names.
  def walk(root, depth)
    out = [
      root,
    ]
    # TODO: follow links
    root.split("/").each do |name|
      if name.length > 3 && depth > 0 || name.empty?
        next
      elsif depth > 5
        out << name.upcase
      else
        out << name
      end
    end
    while out.length > 100
      out.pop
    end
    begin
      out.sort!
    rescue ArgumentError
      out.clear
    end
    case depth
    when 0 then out
    else JSON.parse(File.read("config/app.json"))
    end
  end
end
