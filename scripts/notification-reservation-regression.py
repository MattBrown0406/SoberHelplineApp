#!/usr/bin/env python3
"""Only run against a disposable notification_* container. No production access.
Checks the final SQL producer catalog and real, overlapping PostgreSQL sessions.
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

container = sys.argv[1]
assert container.startswith('supabase_db_notification_'), 'disposable notification test DB required'
base = ['docker', 'exec', '-i', container, 'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
def sql(query):
    return subprocess.check_output(base + ['-c', query], text=True).strip()

procs = json.loads(sql("SELECT json_agg(json_build_object('name',p.proname,'body',p.prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.prosrc ~* 'insert into (public[.])?push_outbox' OR p.prosrc ~ '_video_push[(]' OR p.prosrc ~ '_coach_video_transition[(]')"))
found = {}
for p in procs:
    for m in re.finditer(r"(?:PERFORM\s+(?:public\.)?_video_push\s*\(\s*[^,]+,\s*|INSERT\s+INTO\s+(?:public\.)?push_outbox\s*\([^)]*\)\s*(?:VALUES\s*\(|SELECT)\s*[^,]+,\s*)([^,]+),", p['body'], re.I):
        expression = m.group(1).strip()
        if re.fullmatch("'[a-z_]+'", expression):
            kinds = [expression[1:-1]]
        elif expression == "'member_video_'||p_target":
            kinds = ['member_video_' + x.group(1) for caller in procs for x in re.finditer(r"_coach_video_transition\([^,]+,[^,]+,'([^']+)'", caller['body'])]
        elif expression == 'v_kind':
            assignment = re.search(r'v_kind\s*:=([^;]+)', p['body'])
            assert assignment is not None
            kinds = re.findall("'([a-z_]+)'", assignment.group(1))
        elif expression == 'p_kind' and p['name'] == '_video_push':
            continue  # Resolve all callers above, not the helper parameter.
        else:
            raise AssertionError(f"Unresolved producer {p['name']}: {expression}")
        for kind in kinds:
            found.setdefault(kind, set()).add(p['name'])
handler = Path(__file__).with_name('push-delivery-regression.cjs').read_text()
coverage = re.search(r'const allKinds = \[([^;]+)\];', handler)
assert coverage is not None
covered = set(re.findall("'([a-z_]+)'", coverage.group(1)))
assert covered == set(found), {'missing': list(set(found)-covered), 'extra': list(covered-set(found))}
delivery = sql("SELECT prosrc FROM pg_proc WHERE proname='dispatcher_outbox_delivery'")
for kind in found:
    assert "'"+kind+"'" in delivery, 'unsupported producer: '+kind
print('PRODUCER_INVENTORY', json.dumps({k: sorted(v) for k,v in sorted(found.items())}), flush=True)

user = '94000000-0000-0000-0000-000000000001'
account = '95000000-0000-0000-0000-000000000001'
assert sql(f"SELECT count(*) FROM auth.users WHERE id='{user}'") == '0', 'fixture collision'
sql(f"INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES('{user}','two-session@example.invalid','{{}}','{{}}','authenticated','authenticated'); UPDATE accounts SET id='{account}',push_token='current',family_call_reminders=true,daily_push_opt_in=true,created_at=now()-interval '10 days' WHERE user_id='{user}';")
try:
    for kind in ['family_backup', 'session_reminder', 'family_call_30min', 'winback']:
        sql(f"DELETE FROM session_rsvps WHERE account_id='{account}'")
        if kind == 'session_reminder':
            sql(f"INSERT INTO session_rsvps(account_id,session_id,status) VALUES('{account}',family_squares_session_id(),'going')")
        if kind == 'family_backup':
            query = f"SELECT claim_push_recipient('family_backup','concurrency','{account}',now()+interval '10 minutes') IS NOT NULL;"
        else:
            # Force only moves the clock guard to next occurrence; reservation
            # is the same atomic path as scheduled jobs (separate namespace).
            target = json.loads(sql(f"SELECT row_to_json(t) FROM dispatcher_job_targets('{kind}',true) t WHERE account_id='{account}'"))
            sid = 'NULL' if target['session_id'] is None else "'"+target['session_id']+"'"
            query = f"SELECT claim_dispatcher_job('{kind}','{account}',{sid},'{target['expires_at']}',true) IS NOT NULL;"
        first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        second = None
        assert first.stdin is not None and first.stdout is not None and first.stderr is not None
        try:
            first.stdin.write("BEGIN; SET application_name='notification_first';\n"+query+"\n\\echo CLAIM_HELD\n")
            first.stdin.flush()
            lines = []
            while True:
                line = first.stdout.readline().strip()
                if line == 'CLAIM_HELD': break
                assert line, first.stderr.read()
                lines.append(line)
            assert 't' in lines, lines
            second = subprocess.Popen(base + ['-c', "SET application_name='notification_second'; " + query], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            limit = time.monotonic()+10
            while time.monotonic()<limit:
                if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='notification_second' AND wait_event_type='Lock'") == '1': break
                assert second.poll() is None, 'second session did not overlap'
                time.sleep(.02)
            else: raise AssertionError('no observed lock wait')
            first.stdin.write('COMMIT;\n\\q\n'); first.stdin.flush()
            first.wait(timeout=10)
            output, error = second.communicate(timeout=10)
            assert second.returncode == 0, error
            assert output.strip() == 'f', output
            print(f'TWO_SESSION {kind}: observed lock wait, one claim only', flush=True)
        finally:
            if first.poll() is None: first.kill(); first.wait()
            if second and second.poll() is None: second.kill(); second.wait()
finally:
    sql(f"DELETE FROM auth.users WHERE id='{user}'")
    assert sql(f"SELECT count(*) FROM accounts WHERE id='{account}'") == '0'
print('CONCURRENCY_FIXTURES_REMOVED', flush=True)
