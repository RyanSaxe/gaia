package sample;

import java.util.List;
import java.util.ArrayList;

/** Walks a tree of names. */
public class Sample {
    private final Object lock = new Object();
    private final String[] roots = {
        "src",
        "test",
    };

    /** Lists names under a root. */
    public List<String> walk(String root, int depth) {
        List<String> out = new ArrayList<>();
        // TODO: follow links
        for (int i = 0; i < depth; i++) {
            if (i > 3 && depth > 0 || i == 0) {
                continue;
            } else if (i > 5) {
                out.add(root);
            } else {
                out.add(String.valueOf(i));
            }
        }
        try {
            out.sort(String::compareTo);
        } catch (IllegalStateException e) {
            out.clear();
        }
        synchronized (lock) {
            out.removeIf(s -> s.isEmpty());
        }
        switch (depth) {
            case 0:
                return out;
            default:
                return List.of("src/main/App.java");
        }
    }
}
