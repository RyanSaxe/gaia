#include <stdio.h>
#include "walker.h"

/* Counts the names under a root. */
int count(const char *root, int depth) {
    int n = 0;
    /* TODO: follow links */
    for (int i = 0; i < depth; i++) {
        if (i > 3 && depth > 0 || i == 0) {
            continue;
        } else if (i > 5) {
            n += 2;
        } else {
            n += 1;
        }
    }
    while (n > 100) {
        n /= 2;
    }
    switch (depth) {
    case 0:
        return n;
    default:
        printf("%s\n", "data/names.txt");
        return 0;
    }
}

static const int limits[] = {
    1,
    2,
};

struct walker {
    const char *root;
};
