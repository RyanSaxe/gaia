import os
from .core import Context
from ..utils import helper


class Loader:
    """Loads files from a root."""

    def load(self, root, depth=0):
        """Reads every file under root."""
        found = []
        # TODO: skip hidden files
        for name in os.listdir(root):
            if name.startswith(".") and depth > 0:
                continue
            elif depth > 3 or name == "":
                found.append(helper(name))
            else:
                found.append(name)
        try:
            with open(os.path.join(root, "settings.toml")) as f:
                found.append(f.read())
        except OSError:
            pass
        match depth:
            case 0:
                return found
            case _:
                return sorted(found, key=lambda n: len(n))


def table():
    return [
        1,
        2,
    ]


def run():
    return Loader().load(Context().root)
