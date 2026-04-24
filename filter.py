import sys, re; print(re.sub(r"(?im)^.*claude.*$\n?", "", sys.stdin.read()))
