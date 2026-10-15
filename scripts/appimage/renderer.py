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
        except (FileNotFoundError, PermissionError, ProcessLookupError):
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
