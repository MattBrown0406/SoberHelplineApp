#!/usr/bin/env python3
"""Targeted PostgreSQL 17 delta test; disposable container, no host ports/data."""
from pathlib import Path
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[1]
name = 'shl-fs-repeat-test-' + uuid.uuid4().hex[:10]
image = 'public.ecr.aws/supabase/postgres:17.6.1.165'
def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)
def sql(text):
    run('docker', 'exec', '-i', name, 'psql', '-U', 'supabase_admin', '-d', 'fs_test', '-v', 'ON_ERROR_STOP=1', input=text)
try:
    run('docker', 'run', '-d', '--name', name, '--network', 'none', '-e', 'POSTGRES_PASSWORD=isolated-test-only', image)
    for attempt in range(60):
        ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin'], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Postgres not ready')
    run('docker', 'exec', name, 'createdb', '-U', 'supabase_admin', '-T', 'template0', 'fs_test')
    sql((root / 'tests/fixtures/family-squares-registration-baseline.sql').read_text())
    sql((root / 'supabase/migrations/20261012224545_family_squares_registration_occurrence.sql').read_text())
    sql((root / 'tests/fixtures/family-squares-registration-assertions.sql').read_text())
    print('PASS: real PostgreSQL migration, reset, snapshot protection, composite-key retry')
finally:
    run('docker', 'rm', '-fv', name)
