"""Operate the two Voice directions in DEV-LOCAL-R1."""

import argparse
import base64
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import unquote, urlencode, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request


ROOT = Path("/home/alberto/twenty-inconnect-dev-local-r1")
SERVER = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "app.env"
NODE = Path("/home/alberto/.nvm/versions/node/v24.16.0/bin/node")
PROCESS_ENV = {"PATH": f"{NODE.parent}:/usr/bin:/bin"}
API = "http://127.0.0.1:33000"
PROXY = "http://127.0.0.1:34080"
METRICS = "http://127.0.0.1:32998/ready"
VOICE_PATH = "/auth/inconnect-voice"
FLAGS = {
    "outbound": "INCONNECT_VOICE_ENABLE_OUTBOUND",
    "inbound": "INCONNECT_VOICE_ENABLE_INBOUND",
}
NEST_ARGS = [str(NODE), f"--env-file={ENV_FILE}", "dist/main.js"]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


HTTP = build_opener(ProxyHandler({}), NoRedirect())


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def private_file(path):
    info = path.lstat()
    require(
        path.resolve() == path
        and path.is_file()
        and info.st_uid == os.getuid()
        and info.st_mode & 0o077 == 0,
        "Dedicated configuration must be private",
    )
    return path.read_bytes()


def read_env(raw):
    # Use the same dotenv parser as the actual Nest entrypoint.
    parsed = subprocess.run(
        [NODE, "-e", "const f=require('node:fs'); const u=require('node:util'); process.stdout.write(JSON.stringify(u.parseEnv(f.readFileSync(0,'utf8'))));"],
        input=raw,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=PROCESS_ENV,
        check=True,
        timeout=6,
    )
    config = json.loads(parsed.stdout)
    for key, port, database in (
        ("PG_DATABASE_URL", 55432, "/twenty_inconnect_dev_local_r1"),
        ("PG_DATABASE_REPLICA_URL", 55432, "/twenty_inconnect_dev_local_r1"),
        ("REDIS_URL", 56379, None),
        ("REDIS_QUEUE_URL", 56379, None),
    ):
        if not config.get(key) and key in ("PG_DATABASE_REPLICA_URL", "REDIS_QUEUE_URL"):
            continue
        endpoint = urlsplit(config[key])
        require(
            endpoint.hostname == "127.0.0.1"
            and endpoint.port == port
            and (database is None or endpoint.path == database),
            f"{key} is outside the dedicated runtime",
        )
    require(
        all(config.get(key) in ("true", "false") for key in FLAGS.values()),
        "Both dedicated Voice flags must be explicit",
    )
    return config


def probe(url, method="GET"):
    try:
        with HTTP.open(
            Request(url, method=method, data=b"" if method == "POST" else None),
            timeout=6,
        ) as response:
            return response.status
    except HTTPError as error:
        return error.code
    except OSError:
        return None


def public_get_code(host, path):
    url = f"https://{host}{path}"
    code = probe(url)
    if code is not None:
        return code
    query = urlencode({"name": host, "type": "A"})
    request = Request(
        "https://cloudflare-dns.com/dns-query?" + query,
        headers={"Accept": "application/dns-json"},
    )
    with HTTP.open(request, timeout=6) as response:
        dns = json.load(response)
    for answer in dns.get("Answer", []):
        if answer.get("type") != 1 or answer.get("name", "").rstrip(".") != host:
            continue
        address = ipaddress.IPv4Address(answer["data"])
        require(address.is_global, "Unexpected edge IP for the dedicated tunnel")
        result = subprocess.run(
            ["/usr/bin/curl", "--noproxy", "*", "--resolve", f"{host}:443:{address}",
             "--max-time", "8", "-sS", "-o", "/dev/null", "-w", "%{http_code}", url],
            env=PROCESS_ENV,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return int(result.stdout)
    return None


def nest_listener():
    rows = subprocess.check_output(
        ["ss", "-Hlnpt", "( sport = :33000 )"], env=PROCESS_ENV, text=True, timeout=5
    ).splitlines()
    if not rows:
        return None
    ids = set(re.findall(r"pid=(\d+)", rows[0]))
    require(
        len(rows) == 1 and rows[0].split()[3] == "127.0.0.1:33000" and len(ids) == 1,
        "Unexpected listener on dedicated Nest port",
    )
    pid = int(ids.pop())
    proc = Path(f"/proc/{pid}")
    argv = (proc / "cmdline").read_bytes().rstrip(b"\0").split(b"\0")
    require(
        proc.stat().st_uid == os.getuid()
        and (proc / "exe").resolve() == NODE
        and (proc / "cwd").resolve() == SERVER
        and argv[1:] == list(map(os.fsencode, NEST_ARGS[1:])),
        "Unexpected process on the dedicated Nest port",
    )
    return pid


def live_flags(pid):
    if pid is None:
        return None
    raw = dict(
        entry.split(b"=", 1)
        for entry in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
        if b"=" in entry
    )
    return {name: raw.get(key.encode(), b"").decode() for name, key in FLAGS.items()}


def stop_nest(pid):
    if pid is None:
        return
    fd = os.pidfd_open(pid)
    try:
        require(nest_listener() == pid, "Nest listener changed before stop")
        poll = select.poll()
        poll.register(fd, select.POLLIN)
        signal.pidfd_send_signal(fd, signal.SIGTERM)
        require(poll.poll(20000) and nest_listener() is None, "Nest did not stop")
    finally:
        os.close(fd)


def inspect_install():
    result = subprocess.run(
        [NODE, "dist/database/scripts/inconnect-voice-v2/install.js", "--inspect"],
        cwd=SERVER,
        env=PROCESS_ENV,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=20,
    )
    require(result.returncode == 0, "Could not inspect the dedicated Voice installation")
    record = json.loads(result.stdout)
    require(record["state"] == "installed", "Voice V2 is pending installation")
    return record


def start_nest(config, evidence):
    require(nest_listener() is None, "Dedicated Nest is already running")
    flags = {key: config[key] for key in FLAGS.values()}
    with (evidence / "nest.log").open("ab") as output:
        child = subprocess.Popen(
            NEST_ARGS,
            cwd=SERVER,
            env={
                **PROCESS_ENV,
                **flags,
                "NODE_HOST": "127.0.0.1",
                "NODE_PORT": "33000",
                "PG_INSTALL_EXTENSIONS": "false",
                "DISABLE_DB_MIGRATIONS": "true",
                "DISABLE_CRON_JOBS_REGISTRATION": "true",
            },
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=output,
            start_new_session=True,
        )
    for _ in range(45):
        if child.poll() is not None:
            break
        if probe(API + "/healthz") == 200 and nest_listener() == child.pid:
            require(
                live_flags(child.pid) == {name: config[key] for name, key in FLAGS.items()},
                "Nest Voice flags do not match the dedicated configuration",
            )
            return child.pid
        time.sleep(1)
    if child.poll() is None:
        child.terminate()
        child.wait(timeout=20)
    raise RuntimeError(f"Dedicated Nest did not become healthy. Private log: {evidence / 'nest.log'}")


def verify_provider(config, directions):
    host = urlsplit(config["INCONNECT_VOICE_URL"])
    require(
        host.scheme == "https"
        and re.fullmatch(r"[a-z0-9-]+\.trycloudflare\.com", host.netloc)
        and host.path == VOICE_PATH + "/twiml"
        and not host.query and not host.fragment
        and probe(METRICS) == 200,
        "Dedicated Quick Tunnel is unavailable or its hostname needs synchronization",
    )
    account, app = (config["INCONNECT_VOICE_" + part] for part in ("ACCOUNT_SID", "TWIML_APP_SID"))
    require(
        re.fullmatch(r"AC[0-9a-fA-F]{32}", account) and re.fullmatch(r"AP[0-9a-fA-F]{32}", app),
        "Twilio DEV identity differs",
    )
    auth = base64.b64encode(
        f'{account}:{config["INCONNECT_VOICE_AUTH_TOKEN"]}'.encode()
    ).decode()

    def get(path):
        request = Request(
            f"https://api.twilio.com/2010-04-01/Accounts/{account}{path}",
            headers={"Authorization": f"Basic {auth}", "Accept": "application/json"},
        )
        with HTTP.open(request, timeout=12) as response:
            return json.load(response)

    remote = get(f"/Applications/{app}.json")
    require(
        remote["account_sid"] == account and remote["sid"] == app
        and remote["friendly_name"] == "Twenty INCONNECT Voice DEV"
        and remote["voice_url"] == config["INCONNECT_VOICE_URL"]
        and remote["voice_method"] == "POST",
        "Twilio DEV VoiceUrl or method differs",
    )
    paths = ["twiml", "call-progress"]
    if "inbound" in directions:
        receiver = config["INCONNECT_VOICE_INBOUND_NUMBER"]
        require(
            receiver == config["INCONNECT_VOICE_CALLER_ID"]
            and config["INCONNECT_VOICE_INBOUND_TEST_SOURCE"] != receiver
            and config["INCONNECT_VOICE_INBOUND_USER_WORKSPACE_ID"]
                == config["INCONNECT_VOICE_USER_WORKSPACE_ID"],
            "The inbound receiver or original operator differs",
        )
        incoming = f"https://{host.netloc}{VOICE_PATH}/inbound"
        require(config["INCONNECT_VOICE_INBOUND_URL"] == incoming, "Inbound hostname differs")
        numbers = get("/IncomingPhoneNumbers.json?" + urlencode({"PhoneNumber": receiver}))
        rows = numbers["incoming_phone_numbers"]
        require(not numbers.get("next_page_uri") and len(rows) == 1, "Cannot identify the dedicated receiver")
        number = rows[0]
        require(
            number["account_sid"] == account and number["phone_number"] == receiver
            and number["capabilities"]["voice"]
            and not number.get("voice_application_sid") and not number.get("trunk_sid")
            and not number.get("voice_fallback_url")
            and number["voice_url"] == incoming and number["voice_method"] == "POST"
            and number["status_callback"] == incoming + "-progress"
            and number["status_callback_method"] == "POST",
            "The dedicated Twilio receiver is not synchronized",
        )
        redis = urlsplit(config["REDIS_URL"])
        redis_probe = subprocess.run(
            ["/usr/bin/redis-cli", "-e", "--raw", "-h", "127.0.0.1", "-p", "56379",
             "--user", unquote(redis.username or "default"), "GET", "inconnectVoice:inbound:acl-preflight"],
            env={**PROCESS_ENV, "REDISCLI_AUTH": unquote(redis.password or "")},
            capture_output=True,
            timeout=6,
        )
        require(redis_probe.returncode == 0, "Voice Inbound Redis ACL is unavailable")
        paths += ["inbound", "inbound-progress"]
    require(
        all(public_get_code(host.netloc, VOICE_PATH + "/" + path) == 405 for path in paths),
        "Public Voice routes do not match the configured Quick Tunnel hostname",
    )


def patch_flags(raw, config, changes):
    edited = raw
    for name, value in changes.items():
        key = FLAGS[name].encode()
        edited, count = re.subn(rb"(?m)^" + key + rb"=[^\r\n]*", key + b"=" + value.encode(), edited)
        require(count == 1, "Expected one declaration per Voice flag")
    require(
        read_env(edited) == {**config, **{FLAGS[name]: value for name, value in changes.items()}},
        "Dedicated configuration changed outside the selected flags",
    )
    return edited


def publish(expected, replacement):
    require(private_file(ENV_FILE) == expected, "app.env changed concurrently")
    with tempfile.NamedTemporaryFile(dir=ROOT, prefix=".app.env.voice.", delete=False) as candidate:
        candidate.write(replacement)
        candidate.flush()
        os.fsync(candidate.fileno())
    os.replace(candidate.name, ENV_FILE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "start", "enable", "disable"))
    parser.add_argument("direction", nargs="?", choices=("inbound", "outbound", "both"))
    command = parser.parse_args()
    require(
        bool(command.direction) == (command.action in ("enable", "disable")),
        "Specify inbound, outbound or both for enable or disable",
    )
    os.umask(0o077)
    require(
        ROOT.resolve() == ROOT and ROOT.stat().st_uid == os.getuid() and ROOT.stat().st_mode & 0o077 == 0,
        "Unexpected DEV-LOCAL-R1 runtime",
    )
    with (ROOT / "voice-v2-maintenance.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = private_file(ENV_FILE)
        config = read_env(raw)
        pid = nest_listener()
        inventory = inspect_install()
        if command.action == "status":
            print(json.dumps({
                "persisted": {name: config[key] for name, key in FLAGS.items()},
                "effective": live_flags(pid),
                "nest": probe(API + "/healthz"),
                "tunnel": probe(METRICS),
                "voiceUrl": config["INCONNECT_VOICE_URL"],
                "inventory": inventory,
            }))
            return
        require(inventory["active"] == 0, "Finish the active Voice call before maintenance")
        require(command.action != "start" or pid is None, "Dedicated Nest is already running")
        directions = list(FLAGS) if command.direction == "both" else [command.direction]
        value = "true" if command.action == "enable" else "false"
        next_raw = raw if command.action == "start" else patch_flags(
            raw, config, {name: value for name in directions},
        )
        next_config = read_env(next_raw)
        enabled = [name for name, key in FLAGS.items() if next_config[key] == "true"]
        if enabled and command.action != "disable":
            verify_provider(next_config, enabled)
        if pid and next_raw == raw and live_flags(pid) == {name: config[key] for name, key in FLAGS.items()}:
            print(json.dumps({"pid": pid, "effective": live_flags(pid), "unchanged": True}))
            return
        evidence = Path(tempfile.mkdtemp(prefix="voice-v2-controls.", dir=ROOT))
        (evidence / "app.env.before").write_bytes(raw)
        stop_nest(pid)
        if next_raw != raw:
            publish(raw, next_raw)
        try:
            pid = start_nest(next_config, evidence)
            for route in ("twiml", "call-progress", "inbound", "inbound-progress"):
                require(probe(PROXY + VOICE_PATH + "/" + route) == 405, "Dedicated Nginx route differs")
        except (RuntimeError, OSError, subprocess.SubprocessError):
            if command.action == "enable" and next_raw != raw and private_file(ENV_FILE) == next_raw:
                stop_nest(nest_listener())
                publish(next_raw, raw)
                start_nest(config, evidence)
            raise
        print(json.dumps({"pid": pid, "effective": live_flags(pid), "private_log": str(evidence / "nest.log")}))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyError, ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, RuntimeError) else f"Voice operation failed ({type(error).__name__})")
        raise SystemExit(1)
