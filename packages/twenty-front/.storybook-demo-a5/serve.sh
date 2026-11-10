#!/usr/bin/env bash
set -eo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
case "${1:-a5}" in
  a5)
    demo_build=".cache/demo-a5-executive/validated-storybook"
    first_story="inconnect-presentacion--inicio"
    ;;
  a4)
    demo_build=".cache/demo-a4-lead-management/validated-storybook"
    first_story="pages-settings-security-commercial-teams--demo"
    ;;
  *)
    printf 'Uso: bash %s [a5|a4]\n' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac

cd "$repo_dir"
if [[ ! -f "$demo_build/index.json" || ! -f "$demo_build/iframe.html" ]]; then
  printf 'Build estático incompleto en %s. Consulta la guía de DEMO-A5.\n' "$demo_build" >&2
  exit 1
fi

. "$HOME/.nvm/nvm.sh"
nvm use --silent

exec node - "$repo_dir/$demo_build" "$first_story" <<'NODE'
const { readFileSync } = require('node:fs');
const { createServer } = require('http-server');

const [, , root, firstStory] = process.argv;
const host = '127.0.0.1';
const port = 6006;
const origin = 'http://' + host + ':' + port;
const policy = readFileSync(root + '/iframe.html', 'utf8')
  .match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

if (!policy) throw new Error('El build carece de la política CSP de la demo.');

const server = createServer({
  root,
  showDir: false,
  cache: -1,
  headers: { 'Content-Security-Policy': policy },
  logFn: (request, _response, error) => {
    if (!error) console.log(request.method, new URL(request.url, origin).pathname);
  },
});

server.server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error('Puerto 6006 ocupado. Identifica el proceso con ss -ltnp \'sport = :6006\'.');
  process.exitCode = 1;
});

server.listen(port, host, () => console.log(origin + '/?path=/story/' + firstStory));
NODE
