"""Проверка подписи Telegram Mini App initData: python miniapp/test_init_data.py"""

import hashlib
import hmac
import json
import os
import sys
import time
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TOKEN = "123456:TEST-TOKEN-NOT-REAL"


def make_init_data(user: dict, token: str = TOKEN, auth_date: int = None) -> str:
    """Собирает подписанный initData так, как это делает Telegram."""
    data = {
        "auth_date": str(auth_date if auth_date is not None else int(time.time())),
        "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
        "user": json.dumps(user, separators=(",", ":")),
    }
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


def main():
    os.environ.setdefault("BOT_TOKEN", TOKEN)
    import config

    config.BOT_TOKEN = TOKEN

    from fastapi import HTTPException

    from website.website_api import _verify_tg_init_data

    user = {"id": 777001, "first_name": "Тест", "username": "tester"}

    # 1. Валидная подпись — проходит, user распарсен.
    got = _verify_tg_init_data(make_init_data(user))
    assert got["id"] == 777001, got
    assert got["username"] == "tester", got

    # 2. Подпись чужим токеном — отбой.
    try:
        _verify_tg_init_data(make_init_data(user, token="999:OTHER"))
        raise AssertionError("чужой токен не должен проходить")
    except HTTPException as e:
        assert e.status_code == 401, e.status_code

    # 3. Подмена user при валидном hash от другого набора — отбой.
    tampered = make_init_data(user).replace("777001", "777002")
    try:
        _verify_tg_init_data(tampered)
        raise AssertionError("подмена user_id не должна проходить")
    except HTTPException as e:
        assert e.status_code == 401, e.status_code

    # 4. Просроченный auth_date — отбой.
    old = make_init_data(user, auth_date=int(time.time()) - 90000)
    try:
        _verify_tg_init_data(old)
        raise AssertionError("просроченные данные не должны проходить")
    except HTTPException as e:
        assert e.status_code == 401, e.status_code

    # 5. Без hash — отбой.
    try:
        _verify_tg_init_data("auth_date=1&user=%7B%22id%22%3A1%7D")
        raise AssertionError("без подписи не должно проходить")
    except HTTPException as e:
        assert e.status_code == 401, e.status_code

    print("OK: 5/5 проверок initData прошли")


if __name__ == "__main__":
    main()
