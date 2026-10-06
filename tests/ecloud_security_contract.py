"""Offline sidecar security contract; all HTTP/login operations are stubbed."""
from pathlib import Path
import json
import os
import sys
import tempfile
from types import SimpleNamespace

sys.path.insert(0, sys.argv[1])
import sidecar

assert sidecar._IMPORT_ERR is None, "侧车依赖必须就绪"
sidecar._emit_log = lambda *args, **kwargs: None
sidecar.rate_limit_mod = SimpleNamespace(guard_login=lambda username: None, record_attempt=lambda username: None)


class FakeHttp:
    def __init__(self):
        self.access_token = ""

    def set_token(self, token):
        self.access_token = token


sidecar._new_http = lambda device_uid: FakeHttp()
status = sidecar.login_mod.LoginResult.SUCCESS


def password_login(http, username, password):
    if status == sidecar.login_mod.LoginResult.SUCCESS:
        http.set_token("fixture-session")
    return {"status": status, "mobile": "", "login_code": None}


sidecar.login_mod.login_with_password = password_login
permissions = []
write_guard = {"secured": False}


class PrivateWriter:
    def __init__(self, handle):
        self.handle = handle

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.handle.close()

    def fileno(self):
        return self.handle.fileno()

    def write(self, text):
        assert write_guard["secured"], "写 Token 前必须先限制已有临时文件权限"
        return self.handle.write(text)


class PosixContract:
    name = "posix"

    def __getattr__(self, name):
        return getattr(os, name)

    def open(self, path, flags, mode):
        assert mode == 0o600, "新文件必须以 0600 创建"
        write_guard["secured"] = False
        permissions.append(("open", mode))
        return os.open(path, flags, mode)

    def fdopen(self, *args, **kwargs):
        return PrivateWriter(os.fdopen(*args, **kwargs))

    def fchmod(self, fd, mode):
        assert mode == 0o600, "已有临时文件也必须先限制为 0600"
        write_guard["secured"] = True
        permissions.append(("fchmod", mode))

    def chmod(self, path, mode):
        assert mode == 0o600, "替换前必须再次确保 0600"
        permissions.append(("chmod", mode))


with tempfile.TemporaryDirectory(prefix="ctyun-phase1-sidecar-") as directory:
    sidecar._SESSION_FILE = Path(directory) / "sessions.json"
    sidecar._SESSION_FILE.with_suffix(".tmp").write_text("old temporary file", encoding="utf-8")
    sidecar.os = PosixContract()
    sidecar._SESSIONS.clear()
    begin = sidecar.op_login_begin({"sessionId": "login", "username": "fixture-user", "password": "fixture-password"})
    assert sidecar._SESSIONS["login"]["password"] == "", "登录成功必须清空密码"
    assert sidecar._SESSION_FILE.is_file(), "会话必须可落盘"
    saved = json.loads(sidecar._SESSION_FILE.read_text(encoding="utf-8"))
    assert "password" not in saved["login"], "密码不得落盘"
    assert saved["login"].get("accessToken"), "内部会话 Token 仍须持久化"

    restored = sidecar.op_session_restore({"sessionId": "login", "username": "fixture-user"})
    assert restored["restored"] is True
    relogin = sidecar.op_session_relogin({"sessionId": "login", "username": "fixture-user", "password": "fixture-password", "quiet": True})
    assert relogin["relogged"] is True
    assert sidecar._SESSIONS["login"]["password"] == "", "重登成功必须清空密码"

    status = sidecar.login_mod.LoginResult.NEED_TWO_FACTOR
    pending = sidecar.op_login_begin({"sessionId": "sms", "username": "fixture-sms-user", "password": "fixture-password"})
    assert sidecar._SESSIONS["sms"]["password"], "等待二次验证时必须保留必要密码"

    def complete_two_factor(http, mobile, username, password, sms_code, **kwargs):
        assert password == "fixture-password", "二次验证必须仍可使用原密码"
        http.set_token("fixture-sms-session")
        return {"status": sidecar.login_mod.LoginResult.SUCCESS}

    sidecar.login_mod.complete_two_factor = complete_two_factor
    sms = sidecar.op_login_sms({"sessionId": "sms", "branch": status, "code": "123456"})
    assert sidecar._SESSIONS["sms"]["password"] == "", "短信成功必须清空密码"
    for response in (begin, restored, relogin, pending, sms):
        assert "accessToken" not in response, "IPC 不得返回未使用的裸 Token"
    assert len(permissions) >= 9, "每次落盘均须执行权限保护"

print(json.dumps({"success": True, "privateMode": "0600", "loginPaths": 4, "posixContract": "simulated"}))
