from pathlib import Path
import runpy
import unittest


class StagingRecipeTest(unittest.TestCase):
    def test_offline_apk_run_has_dockerfile_continuations(self):
        generator = runpy.run_path(str(Path(__file__).with_name('prepare-staging-build.py')))
        upstream = generator['git'](
            'show', f"{generator['REVISION']}:{generator['DOCKERFILE']}",
        ).decode()
        recipe = generator['staging_recipe'](upstream)

        apk_block = recipe.split('ARG STAGING_APK_SHA256\n', 1)[1].split('\n\n', 1)[0]
        expected = r'''RUN --network=none --mount=type=bind,from=staging-apk,target=/staging-apk set -eu; export LC_ALL=C; cd /staging-apk; \
    printf '%s  SHA256SUMS\n' "$STAGING_APK_SHA256" | sha256sum -c -; \
    sha256sum -- *.apk > /tmp/staging-apk.sha256; \
    cmp /tmp/staging-apk.sha256 SHA256SUMS; rm /tmp/staging-apk.sha256; cd /; \
    apk add --no-network --no-cache --repositories-file /dev/null /staging-apk/*.apk; \
    apk add --simulate --no-network --no-cache --repositories-file /dev/null \
    'curl>=8.20.0-r0' \
    'nghttp2-libs>=1.69.0-r0' \
    'libcrypto3>=3.5.7-r0' \
    'libssl3>=3.5.7-r0' \
    'postgresql18-client>=18.4-r0' \
    jq && apk list --installed | sort'''
        self.assertEqual(apk_block, expected)
