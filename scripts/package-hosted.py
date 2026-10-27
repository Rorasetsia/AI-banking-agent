"""Build a minimal source archive for a standalone free hosted preview."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--target', choices=['render', 'modelscope'], default='render')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = args.output.resolve()
if output.exists():
    raise SystemExit('Output exists; choose a new name.')
files = []
for folder in ['src', 'server', 'shared', 'public']:
    files.extend(p for p in (root / folder).rglob('*') if p.is_file())
for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', '.gitignore', 'render.yaml', 'scripts/start-hosted.mjs', 'scripts/package-hosted.py', 'docs/26_免费在线试用部署_2026-10-27.md', 'docs/27_AI确认表单与模型接入_2026-10-27.md', 'docs/28_通用自适应追问与条件折叠_2026-10-27.md']:
    files.append(root / name)
files.append(root / 'docs/29_储蓄可行性决策与理财情景_2026-10-27.md')
studio_readme = root / 'deploy/modelscope/README.md'
if args.target == 'modelscope':
    files.extend(root / name for name in ['Dockerfile', '.dockerignore', 'scripts/start-modelscope.mjs', 'docs/30_魔搭免费试用部署_2026-10-27.md'])
    files.append(studio_readme)
secret = re.compile(rb'(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
records = []
sources = {}
for path in sorted(files):
    if not path.resolve().is_relative_to(root) or path.suffix in {'.sqlite', '.db', '.key', '.pem'}:
        raise SystemExit('Unsafe package path')
    raw = path.read_bytes()
    if path.suffix not in {'.png', '.jpg', '.webp', '.woff', '.woff2', '.ttf', '.ico'} and secret.search(raw):
        raise SystemExit('Review possible secret: ' + str(path.relative_to(root)))
    archive_name = 'README.md' if path == studio_readme else path.relative_to(root).as_posix()
    sources[archive_name] = path
    records.append({'path': archive_name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for record in records:
        archive.write(sources[record['path']], record['path'])
    archive.writestr('CLOUD_SOURCE_MANIFEST.json', json.dumps({'version': json.loads((root/'package.json').read_text(encoding='utf-8'))['version'], 'files': records}, ensure_ascii=False, indent=2))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    for record in records:
        assert hashlib.sha256(archive.read(record['path'])).hexdigest() == record['sha256']
print(json.dumps({'archive': str(output), 'files': len(records) + 1, 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'no_local_accounts_or_secrets': True}, ensure_ascii=False))
