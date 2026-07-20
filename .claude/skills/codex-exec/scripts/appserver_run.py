#!/usr/bin/env python3
"""Run a codex turn through the local app-server daemon so it shows up in the
remote-connected Codex app (threads land as interactive `vscode`-source sessions
and stream live to every connected client).

Talks JSON-RPC over a WebSocket on the daemon's unix control socket
(~/.codex/app-server-control/app-server-control.sock). Stdlib only.

Usage:
  appserver_run.py run  [--cwd DIR] [--model M] [--effort E] [--name NAME]
                        [-o FILE] [--timeout SECS] [PROMPT | -]
  appserver_run.py run  --thread-id ID [same flags] PROMPT     # follow-up turn
  appserver_run.py list [--source-kinds cli,vscode,exec] [--limit N]

Progress goes to stderr; the final agent message goes to stdout (and -o FILE).
Exit codes: 0 turn completed, 2 turn failed/interrupted, 3 protocol error,
124 timeout (turn/interrupt is sent best-effort).
"""

import argparse
import base64
import json
import os
import socket
import struct
import sys
import time

DEFAULT_SOCK = os.path.expanduser("~/.codex/app-server-control/app-server-control.sock")


class WsClient:
    def __init__(self, sock_path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(sock_path)
        self.buf = b""
        self._frag = b""
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\n"
                "Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\n"
                f"Sec-WebSocket-Key: {key}\r\n\r\n"
            ).encode()
        )
        resp = self._read_until(b"\r\n\r\n")
        if b" 101 " not in resp.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"websocket handshake failed: {resp[:200]!r}")

    def _read_until(self, marker):
        while marker not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("socket closed during handshake")
            self.buf += chunk
        data, self.buf = self.buf.split(marker, 1)
        return data + marker

    def _read_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("socket closed")
            self.buf += chunk
        data, self.buf = self.buf[:n], self.buf[n:]
        return data

    def send_text(self, text):
        self._send_frame(0x1, text.encode())

    def _send_frame(self, opcode, payload):
        mask = os.urandom(4)
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def recv_message(self, timeout):
        """Return the next complete text message, or None on timeout."""
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            self.sock.settimeout(remaining)
            try:
                b0 = self._read_exact(1)[0]
                b1 = self._read_exact(1)[0]
            except socket.timeout:
                return None
            fin, opcode = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if b1 & 0x80 else None
            payload = self._read_exact(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x9:  # ping -> pong
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode == 0x8:  # close
                raise ConnectionError("server closed websocket")
            if opcode in (0x1, 0x2, 0x0):
                self._frag += payload
                if fin:
                    msg, self._frag = self._frag, b""
                    return msg.decode("utf-8", "replace")


class AppServerClient:
    def __init__(self, sock_path):
        self.ws = WsClient(sock_path)
        self.next_id = 1
        self.pending = {}  # id -> response
        self.notifications = []

    def request(self, method, params, timeout=30):
        req_id = self.next_id
        self.next_id += 1
        self.ws.send_text(json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}))
        deadline = time.monotonic() + timeout
        while req_id not in self.pending:
            if not self.pump(deadline - time.monotonic()):
                raise TimeoutError(f"no response to {method} within {timeout}s")
        resp = self.pending.pop(req_id)
        if "error" in resp:
            raise RuntimeError(f"{method} failed: {json.dumps(resp['error'])}")
        return resp.get("result")

    def notify(self, method, params=None):
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self.ws.send_text(json.dumps(msg))

    def pump(self, timeout):
        """Process one incoming message. Returns False on timeout."""
        if timeout <= 0:
            return False
        raw = self.ws.recv_message(timeout)
        if raw is None:
            return False
        try:
            msg = json.loads(raw)
        except ValueError:
            return True
        if "method" in msg and "id" in msg:
            self._answer_server_request(msg)
        elif "method" in msg:
            self.notifications.append(msg)
        elif "id" in msg:
            self.pending[msg["id"]] = msg
        return True

    def _answer_server_request(self, msg):
        method = msg["method"]
        if method in ("execCommandApproval", "applyPatchApproval",
                      "item/commandExecution/requestApproval",
                      "item/fileChange/requestApproval"):
            result = {"decision": "approved"}
            log(f"auto-approved server request: {method}")
        else:
            self.ws.send_text(json.dumps(
                {"jsonrpc": "2.0", "id": msg["id"],
                 "error": {"code": -32601, "message": f"unsupported by headless client: {method}"}}))
            log(f"rejected unsupported server request: {method}")
            return
        self.ws.send_text(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}))


def log(line):
    print(line, file=sys.stderr, flush=True)


def describe_item(item, phase):
    kind = item.get("type")
    if kind == "commandExecution":
        cmd = (item.get("command") or "").strip().replace("\n", " ")
        if phase == "started":
            return f"$ {cmd[:200]}"
        code = item.get("exitCode")
        return None if code in (0, None) else f"  -> exit {code}: {cmd[:120]}"
    if kind == "agentMessage" and phase == "completed":
        return "codex: " + (item.get("text") or "")[:2000]
    if kind == "reasoning":
        return None
    if kind == "fileChange" and phase == "completed":
        files = ", ".join((c.get("path") or "?") for c in (item.get("changes") or [])[:5])
        return f"edited: {files}"
    if kind == "webSearch" and phase == "started":
        return f"searching: {item.get('query') or ''}"
    if phase == "started" and kind not in ("userMessage", "agentMessage"):
        return f"[{kind}]"
    return None


def cmd_run(args):
    prompt = args.prompt
    if prompt is None or prompt == "-":
        prompt = sys.stdin.read()
    if not prompt.strip():
        log("error: empty prompt")
        return 3

    client = AppServerClient(args.sock)
    client.request("initialize", {
        "clientInfo": {"name": "claude_code", "title": "Claude Code", "version": "1.0"},
    })
    client.notify("initialized")

    if args.thread_id:
        result = client.request("thread/resume", {
            "threadId": args.thread_id,
            "cwd": args.cwd,
            "approvalPolicy": "never",
            "sandbox": args.sandbox,
        })
    else:
        params = {
            "cwd": args.cwd,
            "approvalPolicy": "never",
            "sandbox": args.sandbox,
            "ephemeral": False,
        }
        if args.model:
            params["model"] = args.model
        result = client.request("thread/start", params)
    thread_id = (result.get("thread") or {}).get("id") or args.thread_id
    log(f"thread id: {thread_id}")

    if args.name and not args.thread_id:
        try:
            client.request("thread/name/set", {"threadId": thread_id, "name": args.name})
        except Exception as e:
            log(f"(thread/name/set failed: {e})")

    turn_params = {"threadId": thread_id, "input": [{"type": "text", "text": prompt}]}
    if args.model:
        turn_params["model"] = args.model
    if args.effort:
        turn_params["effort"] = args.effort
    turn_result = client.request("turn/start", turn_params, timeout=60)
    turn_id = (turn_result or {}).get("turn", {}).get("id")

    deadline = time.monotonic() + args.timeout
    last_agent_message = None
    final_status = None
    final_error = None
    while time.monotonic() < deadline and final_status is None:
        client.pump(min(30.0, deadline - time.monotonic()))
        while client.notifications:
            note = client.notifications.pop(0)
            method = note.get("method")
            params = note.get("params") or {}
            if params.get("threadId") not in (None, thread_id):
                continue
            if method in ("item/started", "item/completed"):
                item = params.get("item") or {}
                line = describe_item(item, method.split("/")[1])
                if line:
                    log(line)
                if method == "item/completed" and item.get("type") == "agentMessage":
                    last_agent_message = item.get("text") or ""
            elif method == "turn/completed":
                turn = params.get("turn") or {}
                if turn_id and turn.get("id") not in (None, turn_id):
                    continue
                final_status = turn.get("status") or "completed"
                final_error = (turn.get("error") or {}).get("message")
            elif method == "error":
                log(f"server error: {json.dumps(params)[:500]}")
            elif method == "thread/status/changed":
                pass

    if final_status is None:
        log(f"timeout after {args.timeout}s; sending turn/interrupt")
        try:
            client.request("turn/interrupt", {"threadId": thread_id}, timeout=10)
        except Exception as e:
            log(f"(interrupt failed: {e})")
        return 124

    if last_agent_message is not None:
        print(last_agent_message)
        if args.output_last_message:
            with open(args.output_last_message, "w") as f:
                f.write(last_agent_message)
    log(f"turn status: {final_status}" + (f" — {final_error}" if final_error else ""))
    return 0 if final_status == "completed" else 2


def cmd_list(args):
    client = AppServerClient(args.sock)
    client.request("initialize", {
        "clientInfo": {"name": "claude_code", "title": "Claude Code", "version": "1.0"},
    })
    client.notify("initialized")
    params = {"limit": args.limit}
    if args.source_kinds:
        params["sourceKinds"] = args.source_kinds.split(",")
    result = client.request("thread/list", params)
    for t in result.get("data", []):
        preview = (t.get("name") or t.get("preview") or "").replace("\n", " ")[:60]
        print(f"{t.get('id')}  {t.get('source'):<10} {t.get('updatedAt') or t.get('createdAt') or ''}  {preview}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sock", default=DEFAULT_SOCK)
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="run one codex turn (new thread or --thread-id follow-up)")
    run_p.add_argument("prompt", nargs="?", help="prompt text, or '-' / omitted to read stdin")
    run_p.add_argument("--cwd", default=os.getcwd())
    run_p.add_argument("--thread-id", help="continue an existing thread instead of starting one")
    run_p.add_argument("--model")
    run_p.add_argument("--effort", choices=["none", "low", "medium", "high", "xhigh"])
    run_p.add_argument("--sandbox", default="danger-full-access",
                       choices=["read-only", "workspace-write", "danger-full-access"])
    run_p.add_argument("--name", help="set a thread name shown in the Codex app")
    run_p.add_argument("-o", "--output-last-message")
    run_p.add_argument("--timeout", type=float, default=3600)
    run_p.set_defaults(func=cmd_run)

    list_p = sub.add_parser("list", help="list threads as the app sees them")
    list_p.add_argument("--source-kinds", help="comma-separated, e.g. exec or cli,vscode")
    list_p.add_argument("--limit", type=int, default=15)
    list_p.set_defaults(func=cmd_list)

    args = parser.parse_args()
    try:
        sys.exit(args.func(args))
    except (ConnectionError, FileNotFoundError, TimeoutError, RuntimeError) as e:
        log(f"error: {e}")
        sys.exit(3)


if __name__ == "__main__":
    main()
