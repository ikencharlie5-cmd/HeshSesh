# Build the single-page body used to publish the game as a hosted artifact
# (the host wraps it in its own <html>/<head>/<body> skeleton).
import re, sys, pathlib
src = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
out = pathlib.Path(sys.argv[1])
html = src.read_text()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
head = re.sub(r'\s*<meta[^>]*>', '', head)
out.write_text(head.strip() + '\n' + body.strip() + '\n')
