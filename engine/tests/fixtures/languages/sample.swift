import Foundation

/// Walks names under a root.
class Walker {
    let root: String

    init(root: String) {
        self.root = root
    }

    /// Lists names.
    func walk(depth: Int) -> [String] {
        var out: [String] = [
            root,
        ]
        // TODO: follow links
        for name in root.split(separator: "/") {
            if name.count > 3 && depth > 0 || name.isEmpty {
                continue
            } else if depth > 5 {
                out.append(name.uppercased())
            } else {
                out.append(String(name))
            }
        }
        do {
            try check(out)
        } catch {
            out.removeAll()
        }
        let keep = { (s: String) -> Bool in s.count > 0 }
        switch depth {
        case 0:
            return out.filter(keep)
        default:
            return ["Sources/App/main.swift"]
        }
    }

    func check(_ names: [String]) throws {}
}
