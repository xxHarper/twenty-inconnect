#!/usr/bin/env python3
"""Materialize the reviewed STAGING-S2 source and derive its build recipe."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile


REVISION = '51ead3881fa18ccc0feb1d0afe8e1dd46483c27a'
INSTALL_F1 = '24deec2f970d1d0369beb4c331b8e185c67cccd9'
DOCKERFILE = 'packages/twenty-docker/twenty/Dockerfile'
ENTRYPOINT = 'packages/twenty-docker/twenty/entrypoint.sh'
BASE = 'node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436'
YARN_RELEASE = '.yarn/releases/yarn-4.13.0.cjs'
YARN_SHA = '730e0619753d39754c9e7613c7e57f084ea18b3244f5ba9a5a60bd3da048450b'
LOCK_SHA = '472cf6982919d1c7afe1fb54acebc9fe1d4fa14add05ddb806b01006e5a3e568'
DOCKERFILE_SHA = '896e489fb8444d28678387b983dbaf8271b872ad84aa8791e42d8d7ff3503654'
BUILD_PACKAGES = (
    'twenty-front', 'twenty-front-component-renderer', 'twenty-ui',
    'twenty-sdk', 'twenty-shared', 'twenty-client-sdk', 'twenty-server',
    'twenty-emails',
)
LOCAL_DIRS = {
    '.aws', '.cache', '.git', '.gnupg', '.local-storage', '.nx', '.ssh', '.swc',
    'node_modules',
}
SECRET_NAMES = {'.netrc', '.npmrc', '.yarnrc', 'credentials', 'credentials.json'}


def git(*args):
    return subprocess.check_output(['git', *args])


def use_source(path):
    name = path.name.lower()
    if name.endswith('.env') or name.startswith(('.env.', '.env-')):
        return False
    if LOCAL_DIRS.intersection(path.parts):
        raise ValueError(f'Local directory in committed context: {path}')
    if (
        name in SECRET_NAMES
        or name.startswith(('id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'))
        or path.suffix.lower() in {'.key', '.pem', '.pfx', '.p12', '.jks', '.ppk'}
    ):
        raise ValueError(f'Credential-like path in committed context: {path}')
    if path.parts[:3] == ('packages', 'twenty-server', 'scripts'):
        return name == 'upgrade-background.sh'
    if len(path.parts) > 3 and path.parts[2] in {'build', 'dist', 'coverage'}:
        if path.as_posix() not in {
            'packages/twenty-ui/dist/theme-dark.css',
            'packages/twenty-ui/dist/theme-light.css',
        }:
            raise ValueError(f'Unexpected committed build output: {path}')
    return True


def materialize(context, paths):
    with subprocess.Popen(
        ['git', 'archive', REVISION, '--', *paths], stdout=subprocess.PIPE,
    ) as archive:
        with tarfile.open(fileobj=archive.stdout, mode='r|') as source:
            for member in source:
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts:
                    raise ValueError(f'Unsafe archive path: {path}')
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ValueError(f'Unexpected archive entry: {path}')
                if use_source(path):
                    target = context / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(member) as content, target.open('xb') as output:
                        shutil.copyfileobj(content, output)
                    target.chmod(0o755 if member.mode & 0o111 else 0o644)
        if archive.wait() != 0:
            raise ValueError('git archive failed')


def staging_recipe(upstream):
    def replace_once(old, new):
        nonlocal upstream
        if upstream.count(old) != 1:
            raise ValueError(f'Review staging recipe anchor: {old!r}')
        upstream = upstream.replace(old, new, 1)

    # Keep the pinned official target graph through twenty.
    upstream = upstream.split('# Target: twenty-aws (server + frontend + aws-cli)', 1)[0]
    separator = '# ==========================================================================='
    upstream = upstream.rstrip().removesuffix(separator).rstrip()
    aws_start = upstream.index('# Target: twenty-server-aws (server only + aws-cli, no frontend)')
    twenty_start = upstream.index('# Target: twenty (server + frontend)')
    upstream = upstream[:aws_start] + upstream[twenty_start:]
    yarn = f'node /app/{YARN_RELEASE}'
    guarded_yarn = f'YARN_RC_FILENAME=.yarnrc.staging.yml {yarn}'
    lock_check = 'sha256sum -c /app/.staging-s2/yarn.lock.sha256'
    build_env = (
        'ENV CI=true NX_DAEMON=false NX_NO_CLOUD=true NX_SKIP_NX_CACHE=true '
        'NX_PARALLEL=1 npm_config_offline=true YARN_ENABLE_TELEMETRY=0\n'
    )
    wrapper = (
        'RUN --network=none rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg && '
        "printf '%s\\n' '#!/bin/sh' "
        f"""'exec {yarn} "$@"' > /usr/local/bin/yarn && """
        'chmod 755 /usr/local/bin/yarn && ln -s yarn /usr/local/bin/yarnpkg\n'
    )

    for stage in ('front-deps', 'server-deps'):
        anchor = f'FROM {BASE} AS {stage}\n'
        replace_once(
            anchor,
            anchor + build_env + wrapper
            + 'COPY --from=staging-lock-check /tmp/immutable-lock-ok /tmp/immutable-lock-ok\n'
            + 'COPY .staging-s2 /app/.staging-s2\n'
            + 'COPY .staging-s2/yarnrc.yml /app/.yarnrc.staging.yml\n',
        )

    for line in upstream.splitlines():
        if line.startswith('RUN yarn workspaces focus '):
            replace_once(
                line,
                line.replace('RUN yarn', f'RUN {guarded_yarn}', 1)
                .replace(' && yarn cache clean && npx nx reset', '')
                + f' && {lock_check}',
            )

    # Build tools must use installed dependencies. Nx cannot download or use remote cache.
    upstream = upstream.replace('RUN npx nx ', 'RUN --network=none npx nx ')
    front_start = upstream.index('# To skip the memory-intensive frontend build')
    front_end = upstream.index(separator, front_start)
    replace_once(
        upstream[front_start:front_end],
        'RUN --network=none NODE_OPTIONS=--max-old-space-size=8192 npx nx build twenty-front\n\n',
    )
    replace_once(
        'RUN apk add --no-cache \\',
        (
            'ARG STAGING_APK_SHA256\n'
            'RUN --network=none --mount=type=bind,from=staging-apk,target=/staging-apk '
            'set -eu; export LC_ALL=C; cd /staging-apk; \\n'
            '''    printf '%s  SHA256SUMS\\n' "$STAGING_APK_SHA256" | sha256sum -c -; \\n'''
            '    sha256sum -- *.apk > /tmp/staging-apk.sha256; \\n'
            '    cmp /tmp/staging-apk.sha256 SHA256SUMS; rm /tmp/staging-apk.sha256; cd /; \\n'
            '    apk add --no-network --no-cache --repositories-file /dev/null /staging-apk/*.apk; \\n'
            '    apk add --simulate --no-network --no-cache --repositories-file /dev/null \\'
        ),
    )
    replace_once('    jq\n', '    jq && apk list --installed | sort\n')

    replace_once('USER 1000\n\nCMD', wrapper + '\nUSER 1000\n\nCMD')

    # Keep package-local node_modules created by the production focus when hoisting
    # cannot place a dependency at the root. Directories are empty when unnecessary.
    workspaces = ('twenty-server', 'twenty-emails', 'twenty-shared', 'twenty-client-sdk')
    focus = next(line for line in upstream.splitlines() if 'workspaces focus --production' in line)
    replace_once(focus, focus + ' && mkdir -p ' + ' '.join(
        f'/app/packages/{name}/node_modules' for name in workspaces
    ))
    node_modules_copy = (
        'COPY --chown=1000 --from=twenty-server-build /app/node_modules /app/node_modules\n'
    )
    replace_once(node_modules_copy, node_modules_copy + ''.join(
        f'COPY --chown=1000 --from=twenty-server-build /app/packages/{name}/node_modules '
        f'/app/packages/{name}/node_modules\n'
        for name in workspaces
    ))

    target = 'LABEL org.opencontainers.image.description="Twenty image with backend and frontend."'
    replace_once(target, target + """
RUN --network=none set -eu; \\
    test "$(node --version)" = v24.18.0; \\
    test "$(yarn --version)" = 4.13.0; \\
    case "$(cat /etc/alpine-release)" in 3.23.*) ;; *) exit 1 ;; esac; \\
    apk --print-arch; \\
    node -e 'for (const name of process.argv.slice(1)) console.log(require.resolve(name))' \\
      @nestjs/core typeorm pg bullmq ioredis twenty-shared/types; \\
    test -s dist/main.js; \\
    test -s dist/command/command.js; \\
    test -s dist/front/index.html; \\
    test -s dist/modules/inconnect-lead-management/lead-management.module.js; \\
    test -s dist/modules/inconnect-messaging/inconnect-messaging.module.js; \\
    grep -Fq runLegacyCoreMigrations dist/database/commands/run-instance-commands.command.js; \\
    grep -Fq installExtensions dist/database/typeorm/core/run-legacy-core-migrations.js; \\
    test -n "$(find dist/front/assets -name '*.js' -exec grep -lF inconnectLeadPoolCatalog {} +)"; \\
    echo 'STAGING-S2 compiled markers verified'
""")

    # A writable bind mount keeps this preflight's complete dev install out of layers.
    return f"""FROM {BASE} AS staging-lock-check
{build_env}WORKDIR /app
RUN --mount=type=bind,source=.,target=/app,rw set -eu; \\
    cp .staging-s2/yarnrc.yml .yarnrc.staging.yml; \\
    {lock_check}; \\
    test "$({yarn} --version)" = 4.13.0; \\
    {guarded_yarn} install --immutable --mode=skip-build; \\
    {lock_check}; \\
    touch /tmp/immutable-lock-ok

{upstream}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('context', type=Path, help='new directory outside the repository')
    args = parser.parse_args()
    repo = Path(git('rev-parse', '--show-toplevel').decode().strip())
    context = args.context.resolve()
    if context.is_relative_to(repo):
        parser.error('the context must be outside the repository')
    subprocess.run(['git', 'merge-base', '--is-ancestor', INSTALL_F1, REVISION], check=True)
    manifest = json.loads(git('show', f'{REVISION}:package.json'))
    if manifest['packageManager'] != 'yarn@4.13.0':
        raise ValueError('Unexpected Yarn version')

    context.mkdir(mode=0o700)
    paths = [
        'package.json', 'yarn.lock', '.yarnrc.yml', 'tsconfig.base.json', 'nx.json',
        '.dockerignore', '.gitignore', YARN_RELEASE, '.yarn/patches', DOCKERFILE,
        ENTRYPOINT, *(f'packages/{name}' for name in BUILD_PACKAGES),
    ]
    paths += [
        f'{path}/package.json' for path in manifest['workspaces']['packages']
        if path.rsplit('/', 1)[-1] not in BUILD_PACKAGES
    ]
    materialize(context, paths)

    for path, expected in (
        ('yarn.lock', LOCK_SHA), (DOCKERFILE, DOCKERFILE_SHA), (YARN_RELEASE, YARN_SHA),
    ):
        if hashlib.sha256((context / path).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Unexpected content: {path}')

    staging = context / '.staging-s2'
    staging.mkdir()
    (staging / 'Dockerfile').write_text(staging_recipe((context / DOCKERFILE).read_text()))
    (staging / 'yarnrc.yml').write_text(
        (context / '.yarnrc.yml').read_text()
        + '\nchecksumBehavior: throw\nplugins:\n  - .staging-s2/staging-lock-guard.cjs\n',
    )
    (staging / 'staging-lock-guard.cjs').write_bytes(
        Path(__file__).with_name('staging-lock-guard.cjs').read_bytes(),
    )
    (staging / 'yarn.lock.sha256').write_text(f'{LOCK_SHA}  /app/yarn.lock\n')
    print(f'STAGING-S2 context for {REVISION}: {context}')


if __name__ == '__main__':
    main()
