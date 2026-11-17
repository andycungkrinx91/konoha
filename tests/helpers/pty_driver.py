#!/usr/bin/env python3
"""Run a command under a real pty and replay answers onto its terminal.

usage: pty_driver.py <answers-file> <argv...>

The child gets the pty slave as its controlling terminal, so `/dev/tty`
resolves even when its stdin is redirected from a file. `script(1)` cannot do
this: BSD `script` insists on a tty on *its* stdin and aborts with
`tcgetattr/ioctl: Operation not supported on socket` when it is handed a pipe,
which is how the macOS runner invokes it. `pty.fork()` has no such requirement.

Answers are replayed only once the child has printed its prompt and gone quiet.
Writing them at fork time loses them: a prompt that switches the terminal into
raw mode discards whatever was already queued.

Exits with the child's own status, so callers can assert on it on every
platform instead of skipping the assertion where `script` was unavailable.
"""

import errno
import os
import pty
import select
import sys

DEADLINE_SECONDS = 30.0
TICK_SECONDS = 0.2
IDLE_TICKS_BEFORE_ANSWER = 2


def main():
    answers_path, argv = sys.argv[1], sys.argv[2:]
    with open(answers_path, "rb") as handle:
        answers = handle.read()

    pid, master = pty.fork()
    if pid == 0:
        os.execvp(argv[0], argv)

    captured = bytearray()
    pending = answers
    idle_ticks = 0
    elapsed = 0.0

    while True:
        ready, _, _ = select.select([master], [], [], TICK_SECONDS)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError as exc:
                if exc.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            captured += chunk
            idle_ticks = 0
            continue

        elapsed += TICK_SECONDS
        if pending and captured:
            idle_ticks += 1
            if idle_ticks >= IDLE_TICKS_BEFORE_ANSWER:
                os.write(master, pending)
                pending = b""
                idle_ticks = 0
        if elapsed >= DEADLINE_SECONDS:
            os.kill(pid, 9)
            break

    sys.stdout.buffer.write(captured)
    sys.stdout.buffer.flush()

    _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


if __name__ == "__main__":
    sys.exit(main())
