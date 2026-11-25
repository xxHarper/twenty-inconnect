#!/usr/bin/env python3
"""Read-only history observation alongside the supervised R9 Voice window."""

import argparse
import fcntl
import getpass
import json
import os
from pathlib import Path
import runpy
import sys
import threading
import uuid
import warnings


ROOT = Path('/home/alberto/twenty-inconnect-dev-local-r1')
VOICE = '/auth/inconnect-voice'


def read_history(request, token, lead, object_id):
    code, scope = request(f'{VOICE}/history-access/{lead}', token=token)
    if code != 200 or scope.get('objectMetadataId') != object_id:
        raise RuntimeError(f'El operador no tiene acceso al historial del Lead. HTTP {code}.')
    code, history = request(f'{VOICE}/history/{lead}', token=token)
    if code != 200 or not isinstance(history.get('rows'), list):
        raise RuntimeError(f'El historial no se pudo comprobar. HTTP {code}.')
    return history


def follow_history(request, token, lead, baseline, stop):
    known = {}
    while not stop.wait(2):
        try:
            code, history = request(f'{VOICE}/history/{lead}', token=token)
            if code != 200:
                raise RuntimeError(f'HTTP {code}')
            for row in reversed(history['rows']):
                if row['id'] in baseline:
                    continue
                state = (row['status'], row['result'], row['durationSeconds'])
                ordinal, last = known.get(row['id'], (len(known) + 1, None))
                if last != state:
                    known[row['id']] = (ordinal, state)
                    print(f'Voice V1.2 intento {ordinal} {state[0]} '
                          f'resultado={state[1]} segundos={state[2]}', flush=True)
        except (OSError, ValueError, KeyError, RuntimeError):
            print('Historial de Voice temporalmente no verificable. Usa el cierre de R9 ante un fallo.',
                  file=sys.stderr, flush=True)
            return


def main():
    parser = argparse.ArgumentParser(description='Observador dedicado de Voice en DEV-LOCAL-R1')
    parser.add_argument('lead', type=uuid.UUID, help='UUID del Lead autorizado')
    parser.add_argument('--check', action='store_true', help='Comprueba disabled e historial y termina')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise RuntimeError('Usa una terminal interactiva de WSL para autenticar al operador.')
    warnings.filterwarnings('error', category=getpass.GetPassWarning)
    os.umask(0o077)
    with (ROOT / 'voice-r9/observer.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        r7 = runpy.run_path(str(ROOT / 'voice-r7/configurar-voice.py'))
        r9 = runpy.run_path(str(ROOT / 'voice-r9/observar-voice-r9.py'))
        evidence = json.loads((ROOT / 'voice-r7/validated.json').read_text())
        config = evidence['identifiers']
        token = r9['authenticate'](r7['graphql'], config['INCONNECT_VOICE_WORKSPACE_ID'])
        r9['verify'](r7['request'], token, 'disabled')
        history = read_history(r7['request'], token, args.lead, config['INCONNECT_VOICE_LEAD_OBJECT_ID'])
        print(f'Voice disabled, historial HTTP 200, intentos={history["attempts"]}, '
              f'contestadas={history["answered"]}, segundos={history["durationSeconds"]}', flush=True)
        if args.check:
            return

        baseline = {row['id'] for row in history['rows']}
        stop = threading.Event()
        listener = threading.Thread(target=follow_history, daemon=True,
                                    args=(r7['request'], token, args.lead, baseline, stop))
        listener.start()
        print('Para la serie V1.2, pulsa Enter al finalizar las tres pruebas o ante cualquier fallo.',
              flush=True)
        try:
            r9['observe'](r7['request'], token)
        finally:
            stop.set()
            listener.join(timeout=2)
        r9['verify'](r7['request'], token, 'disabled')
        final = read_history(r7['request'], token, args.lead, config['INCONNECT_VOICE_LEAD_OBJECT_ID'])
        print(f'Historial final HTTP 200, intentos={final["attempts"]}, '
              f'contestadas={final["answered"]}, segundos={final["durationSeconds"]}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, EOFError, RuntimeError, ValueError, KeyError, getpass.GetPassWarning):
        print('No se pudo autenticar al operador o verificar el estado y el historial de Voice.',
              file=sys.stderr)
        raise SystemExit(1)
