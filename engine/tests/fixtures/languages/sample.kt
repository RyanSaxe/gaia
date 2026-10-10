package sample

import java.io.File

/** Walks names under a root. */
class Walker(private val root: String) {
    /** Lists names. */
    fun walk(depth: Int): List<String> {
        val out = mutableListOf<String>()
        // TODO: follow links
        for (name in root.split("/")) {
            if (name.length > 3 && depth > 0 || name.isEmpty()) {
                continue
            } else if (depth > 5) {
                out.add(name.uppercase())
            } else {
                out.add(name)
            }
        }
        try {
            out.sort()
        } catch (e: IllegalStateException) {
            out.clear()
        }
        val keep = { s: String -> s.isNotEmpty() }
        return when (depth) {
            0 -> out.filter(keep)
            else -> listOf(File("config/app.json").readText())
        }
    }
}
