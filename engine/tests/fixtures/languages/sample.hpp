#ifndef SAMPLE_HPP
#define SAMPLE_HPP

#include <vector>
#include "walker.h"

namespace sample {

/// Walks names under a root.
class Walker {
public:
    int walk(int depth) {
        int n = 0;
        // TODO: count bytes
        for (int i : limits) {
            if (i > depth && depth > 0 || i == 0) {
                n += i;
            } else if (i > 5) {
                n -= 1;
            } else {
                n += 2;
            }
        }
        try {
            n += count();
        } catch (...) {
            n = 0;
        }
        auto twice = [](int x) { return x * 2; };
        switch (depth) {
        case 0:
            return twice(n);
        default:
            log("logs/walk.txt");
            return n;
        }
    }

private:
    std::vector<int> limits = {
        1,
        2,
    };
    int count() { return 1; }
    void log(const char *path) {}
};

}  // namespace sample

#endif
