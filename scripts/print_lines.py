import itertools
import sys

path = sys.argv[1]
count = int(sys.argv[2]) if len(sys.argv) > 2 else 220

with open(path, 'r', encoding='utf-8') as f:
    for i, line in enumerate(itertools.islice(f, count), start=1):
        print(f"{i:4d}: {line.rstrip()}")
