"""
Minimal MCP stdio client for `mcp_server.js`.

The GUI uses this to drive the very same tool layer that Claude/Cursor/opencode
see, so there is one batch implementation, not two. It spawns the server as a
child process and speaks JSON-RPC over stdin/stdout - no dependencies, no
network listener, nothing to install.

Only what a host needs: initialize, tools/call, and stderr tailing for progress.
"""

import json
import os
import subprocess
import threading


class MCPClient:
    def __init__(self, server_js, cwd=None, log=None):
        self.server_js = server_js
        self.cwd = cwd or os.path.dirname(os.path.abspath(server_js))
        self.log = log or (lambda _line: None)
        self.proc = None
        self._id = 0
        self._id_lock = threading.Lock()
        self._waiters = {}
        self._lock = threading.Lock()

    # ── lifecycle ──────────────────────────────────────────────
    def start(self):
        self.proc = subprocess.Popen(
            ["node", self.server_js],
            cwd=self.cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()
        # The handshake every MCP client does before anything else.
        self.request("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "veo3-gui", "version": "1.0"},
        })
        self.notify("notifications/initialized", {})
        return True

    def stop(self):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.kill()
        except Exception:
            pass
        self.proc = None

    # ── transport ──────────────────────────────────────────────
    def _read_stdout(self):
        try:
            for line in self.proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except Exception:
                    continue
                mid = msg.get("id")
                if mid is None:
                    continue
                with self._lock:
                    waiter = self._waiters.pop(mid, None)
                if waiter:
                    waiter(msg)
        except Exception:
            pass

    def _read_stderr(self):
        try:
            for line in self.proc.stderr:
                self.log(line.rstrip("\n"))
        except Exception:
            pass

    def _send(self, obj):
        self.proc.stdin.write(json.dumps(obj) + "\n")
        self.proc.stdin.flush()

    def notify(self, method, params):
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method, params, timeout=6 * 3600):
        with self._id_lock:
            self._id += 1
            mid = self._id
        event = threading.Event()
        box = {}

        def waiter(msg):
            box["m"] = msg
            event.set()

        with self._lock:
            self._waiters[mid] = waiter
        self._send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params})
        if not event.wait(timeout):
            raise TimeoutError("no reply to %s within %ss" % (method, timeout))
        msg = box.get("m") or {}
        if msg.get("error"):
            raise RuntimeError(msg["error"].get("message", "MCP error"))
        return msg.get("result")

    # ── the one call the GUI needs ─────────────────────────────
    def call_tool(self, name, args, timeout=6 * 3600):
        result = self.request("tools/call", {"name": name, "arguments": args}, timeout=timeout)
        text = ""
        for part in (result or {}).get("content", []):
            if part.get("type") == "text":
                text += part.get("text", "")
        return {"isError": bool((result or {}).get("isError")), "text": text}
