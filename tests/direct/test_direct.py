"""Corroborate in genlayer-test's direct mode: the real v0.4 SDK, one process, mocked web and model.

The offline suite (tests/test_pure.py) runs the contract under a stub; this file loads it in the GenVM
Python SDK the header pins, to show the storage types, the payable calls, the clock and one consensus
round work there too. It needs genlayer-test 0.30.0 and the GenVM release Studio runs, so it is opt-in:

    CORROBORATE_DIRECT=1 GENVM_VERSION=v0.6.0-rc14 pytest tests/direct -q -p gltest_direct -o addopts=""

Without CORROBORATE_DIRECT it skips, so `pytest tests/ -q` stays clean on any machine.
"""
import json
import os
import pathlib

import pytest

if not os.environ.get("CORROBORATE_DIRECT"):
    pytest.skip("direct mode is opt-in: set CORROBORATE_DIRECT=1 (see the docstring)", allow_module_level=True)

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = str(ROOT / "contracts" / "corroborate.py")
GEN = 10 ** 18
PREFIX = "https://raw.githubusercontent.com/demo-owner/corroborate/0123456789abcdef0123456789abcdef01234567/pages/"
COUNTY = PREFIX + "county-roads-notice.html"
CLAIM = ("The Marrow Creek footbridge in Fenwick closed to the public on 3 March 2026 after an inspection found "
         "cracked supports")
PAGE = (ROOT / "pages" / "county-roads-notice.html").read_text(encoding="utf-8")


def llm_json(obj):
    # genlayer-test 0.30.0 json.loads every string mock once before the SDK sees it: wrap once more
    return json.dumps(json.dumps(obj))


def _deploy(direct_vm, direct_deploy, desk):
    direct_vm.warp("2026-11-26T09:00:00Z")
    direct_vm.sender = desk
    return direct_deploy(CONTRACT)


def test_open_deposit_submit_and_withdraw(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = _deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.deal(direct_alice, 10 * GEN)
    direct_vm.deal(direct_bob, 10 * GEN)
    direct_vm.value = 2 * GEN
    out = json.loads(c.open_claim(CLAIM, 2, GEN // 5, 3600, PREFIX))
    assert out["ok"] is True and out["claim"] == "K1" and out["share"] == str(GEN)

    direct_vm.sender = direct_bob
    direct_vm.value = GEN
    assert json.loads(c.deposit())["credit"] == str(GEN)
    direct_vm.value = 0

    direct_vm.mock_web(r".*county-roads-notice\.html", {"status": 200, "body": PAGE})
    direct_vm.mock_llm(r".*How does the SOURCE stand on the CLAIM.*", llm_json({"answer": "supports"}))
    out = json.loads(c.submit("K1", COUNTY))
    assert out["outcome"] == "accepted" and out["mask"] == "S-" and out["share"] == str(GEN)
    assert direct_vm.run_validator() is True

    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*county-roads-notice\.html", {"status": 200, "body": PAGE.replace("eastern", "western")})
    direct_vm.mock_llm(r".*How does the SOURCE stand on the CLAIM.*", llm_json({"answer": "supports"}))
    assert direct_vm.run_validator() is False

    row = json.loads(c.claim("K1"))
    assert row["accepted"] == 1 and row["left"] == str(GEN) and row["status"] == "open"
    assert json.loads(c.withdraw())["withdrawn"] == str(2 * GEN)


def test_a_refused_open_returns_the_value_without_raising(direct_vm, direct_deploy, direct_alice):
    c = _deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.deal(direct_alice, 10 * GEN)
    direct_vm.value = GEN
    out = json.loads(c.open_claim(CLAIM, 9, GEN // 5, 3600, PREFIX))
    assert out["ok"] is False and out["returned"] == str(GEN)
    assert json.loads(c.stats())["refused_payments"] == 1


def test_refusals_before_the_round(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = _deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.deal(direct_alice, 10 * GEN)
    direct_vm.value = 2 * GEN
    c.open_claim(CLAIM, 2, GEN // 5, 3600, PREFIX)
    direct_vm.value = 0
    with direct_vm.expect_revert("may not offer sources for its own claim"):
        c.submit("K1", COUNTY)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("deposit() first"):
        c.submit("K1", COUNTY)
    with direct_vm.expect_revert("runs until"):
        c.expire("K1")
