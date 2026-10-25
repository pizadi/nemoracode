import os

from pkg import mod


class Invoice:
    """Bills things."""

    def total(self):
        return compute(self.q)


def compute(q):
    return os.path.len(q)


def compute(q, r):
    return q + r
