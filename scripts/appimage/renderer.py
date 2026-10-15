"""Identify WebKit renderer children independently of rewritten process argv."""
from pathlib import Path


def renderer_children(parent_pid, proc=Path('/proc')):
    processes = {}
    for directory in proc.iterdir():
        if not directory.name.isdecimal():
            continue
        try:
            values = dict(line.split(':', 1) for line in (directory / 'status').read_text().splitlines() if ':' in line)
            processes[int(directory.name)] = (values['Name'].strip(), int(values['PPid']))
        except (FileNotFoundError, PermissionError, ProcessLookupError, KeyError, IndexError, ValueError):
            continue
    found = []
    for pid, (name, parent) in processes.items():
        # Linux comm is limited to 15 bytes; WebKit can also rewrite argv to omit
        # the original AppImage extraction path. Follow real parent identities.
        if not name.startswith('WebKitWebProc'):
            continue
        seen = {pid}
        while parent and parent not in seen:
            if parent == parent_pid:
                found.append(pid)
                break
            seen.add(parent)
            parent = processes.get(parent, ('', 0))[1]
    return sorted(found)


def stop_process_group(process):
    """Stop a test-owned session, including the AppImage supervisor's children."""
    import os
    import signal
    import time

    if process.poll() is None and os.getpgid(process.pid) != process.pid:
        raise ValueError('Launch test processes with start_new_session=True')
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        if sig == signal.SIGTERM:
            try:
                process.wait(timeout=10)
            except __import__('subprocess').TimeoutExpired:
                pass
    process.wait(timeout=10)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        live = False
        for directory in Path('/proc').iterdir():
            if not directory.name.isdecimal(): continue
            try:
                fields = (directory / 'stat').read_text().rsplit(')', 1)[1].split()
                if int(fields[2]) == process.pid and fields[0] != 'Z': live = True
            except (FileNotFoundError, PermissionError, ProcessLookupError, KeyError, IndexError, ValueError): continue
        if not live: return
        time.sleep(.05)
    raise RuntimeError('Test-owned AppImage process group did not stop')
