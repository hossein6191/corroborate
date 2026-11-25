/* Corroborate against GenLayer Studio (chain 61999, Studio v0.123, GenVM v0.4), with throwaway accounts.
 *
 *   npm ci                                                          # genlayer-js 2.0.0 and viem 2.56.8, pinned
 *   node tests/on_chain/smoke.mjs <owner>/<repo> <commit>           # the whole run, about an hour
 *   RESUME=1 node tests/on_chain/smoke.mjs <owner>/<repo> <commit>  # continue a run that was cut off
 *   STATE=/some/dir/run.json ...                                    # the state file: keys, address, every step
 *
 * The validators read the source pages from raw.githubusercontent.com, pinned to one commit, so the page every
 * node fetches is the same bytes. Push the repository first and pass that commit (40 hex characters); the source
 * rule of every claim is https://raw.githubusercontent.com/<owner>/<repo>/<commit>/pages/. The script fetches
 * every page itself before it deploys anything, and stops if one is not served exactly as it is in this checkout.
 *
 * Studio v0.123 charges fees: every deploy and write carries the distribution and deposit quoted by
 * estimateTransactionFees, and every transaction is checked for both its status (FINALIZED) and its execution
 * result (FINISHED_WITH_RETURN, or FINISHED_WITH_ERROR where a refusal is the point). Five accounts the script
 * generates and funds with sim_fundAccount play the story; no key is ever printed:
 *   DESK      opens the claims and deploys the contract
 *   ANNA      offers the county roads notice
 *   BEN       offers the Valley Courier report
 *   CARA      offers the digest, the parish newsletter, the walkers' log and the rowing club notice
 *   STRANGER  has no part in any claim and tries what only the others may do
 *
 *   A  deploy. DESK opens a claim with a 0.01 GEN bounty for three shares: refused, every atto back in the same
 *      transaction. DESK opens K1 "The Marrow Creek footbridge in Fenwick closed to the public on 3 March 2026
 *      after an inspection found cracked supports", k 3, bond 0.2 GEN, bounty 3 GEN (three shares of 1 GEN), and
 *      K2 "An inspection of the Marrow Creek footbridge on 2 March 2026 found cracked supports", k 2, bond 0.2 GEN,
 *      bounty 1 GEN, a 40-minute window.
 *   B  ANNA, BEN and CARA deposit credit. ANNA offers the county notice for K2: accepted (S-), 0.5 GEN share.
 *      STRANGER offers a page with no credit, DESK offers a source for its own claim, ANNA offers a page outside
 *      the source rule: all refused before anything is fetched.
 *   C  K1, one consensus round per source, every validator fetching the page itself:
 *        county notice   ANNA  accepted (S-), the first source: 1 GEN share
 *        Valley Courier  BEN   accepted (SI), independent of the county notice: 1 GEN share
 *        River Digest    CARA  derivative (SD): it names the Courier; the 0.2 GEN bond to DESK
 *        parish letter   CARA  not supporting (N.): the 0.2 GEN bond to DESK
 *        walkers' log    CARA  contradicting (C.): on the record, K1 contested, the bond kept
 *      CARA offers the county notice again (read once per claim) and BEN offers the rowing club (one accepted
 *      source per address per claim): both refused before any fetch. STRANGER expires K2 early: refused.
 *        rowing club     CARA  accepted (SI), the third: K1 corroborated, nothing left of the bounty to return
 *      STRANGER offers a source for the closed K1: refused.
 *   D  once K2's window has passed by the chain's own clock, STRANGER expires it: not corroborated, its unpaid
 *      0.5 GEN to DESK's credit. The views read back, the deployed code compared with contracts/corroborate.py
 *      byte for byte, the contract's balance against what it owes, every credit withdrawn, the contract left
 *      holding nothing, and every account's movement checked against the money table, less the fee each of its
 *      transactions was charged (each within the deposit it carried).
 *
 * A round no majority carried stores nothing, and since submit takes no value it strands nothing either: the
 * call is sent again and both transactions are kept. Every id is read from the receipt of the call that made it.
 * Every step is saved as it is made, so a run cut off part way continues with RESUME=1 without sending anything
 * twice.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";
const STATE = process.env.STATE || join(tmpdir(), "corroborate-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const FILE = new URL("../../contracts/corroborate.py", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || j.error.code === -32429 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const GEN = 10n ** 18n;
const gen = (v) => (Number(v) / 1e18).toString();
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const big = (k, v) => (typeof v === "bigint" ? v.toString() : v);

// ---------- where the validators will read the source pages ----------
const REPO = String(process.argv[2] || process.env.REPO || "").trim();
const COMMIT = String(process.argv[3] || process.env.COMMIT || "").trim();
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(REPO) || !/^[0-9a-f]{40}$/.test(COMMIT)) {
  console.log("usage: node tests/on_chain/smoke.mjs <owner>/<repo> <commit>   (the commit the pages/ folder was pushed in, 40 hex)");
  process.exit(2);
}
const PREFIX = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/pages/`;
const FILES = { county: "county-roads-notice.html", courier: "valley-courier.html", digest: "river-digest.html", parish: "parish-newsletter.html", walkers: "towpath-walkers.html", rowing: "rowing-club.html" };
const PAGE = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, PREFIX + f]));
if (PREFIX.length > 120) { console.log(`${PREFIX} is longer than the contract's 120-character source rule; use a shorter repository name.`); process.exit(2); }
for (const [name, address] of Object.entries(PAGE)) {
  const local = readFileSync(new URL("../../pages/" + FILES[name], import.meta.url), "utf8");
  let there = "";
  try { const r = await fetch(address); there = r.ok ? await r.text() : ""; } catch (e) { there = ""; }
  if (there !== local) { console.log(`${address}\ndoes not serve pages/${FILES[name]} as it is in this checkout. Push the repository and pass that commit.`); process.exit(2); }
}
// what every validator should fingerprint: the contract's _visible and _page_text
const visible = (text) => {
  const pieces = text.slice(0, 32000).split("<");
  let out = pieces[0];
  for (const piece of pieces.slice(1)) {
    const close = piece.indexOf(">");
    if (close === -1) out += "<" + piece;
    else if (/^(script|style)/.test(piece.slice(0, 6).toLowerCase())) out += " ";
    else out += " " + piece.slice(close + 1);
  }
  return out;
};
const fpOf = (name) => sha(visible(readFileSync(new URL("../../pages/" + FILES[name], import.meta.url), "utf8")).slice(0, 32000).split(/\s+/).filter(Boolean).join(" ").slice(0, 4000)).slice(0, 16);

// ---------- state ----------
const st = existsSync(STATE) && process.env.RESUME ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || []; st.ids = st.ids || {};
const SOURCE_SHA = sha(readFileSync(FILE));
if (st.source_sha256 && st.source_sha256 !== SOURCE_SHA) { console.log(`the state file ${STATE} belongs to a run of another contract file; start without RESUME, or name another STATE`); process.exit(2); }
if (st.commit && st.commit !== COMMIT) { console.log(`This saved run used commit ${st.commit}; continue it with that commit, or start without RESUME.`); process.exit(2); }
st.source_sha256 = SOURCE_SHA; st.commit = COMMIT; st.repo = REPO; st.prefix = PREFIX;
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, big, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, big, 1));
};
const ROLES = {
  desk: "DESK, who opens the claims and deploys the contract",
  anna: "ANNA, who offers the county roads notice",
  ben: "BEN, who offers the Valley Courier report",
  cara: "CARA, who offers the digest, the newsletter, the walkers' log and the rowing club notice",
  stranger: "STRANGER, who has no part in any claim",
};
for (const k of Object.keys(ROLES)) st.keys[k] = st.keys[k] || generatePrivateKey();
const acct = {}, client = {};
for (const k of Object.keys(ROLES)) { acct[k] = createAccount(st.keys[k]); client[k] = createClient({ chain: studionet, account: acct[k] }); }
const rd = createClient({ chain: studionet });
st.accounts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, getAddress(acct[k].address)]));
save();

const need = (value, what) => {
  if (value === undefined || value === null || value === "") {
    ok(`the receipt carries ${what}`, false, "stopping: nothing after this step can be sent without it");
    st.checks = { pass, fail }; save();
    process.exit(1);
  }
  return value;
};

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundOnce = async (k, whole) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  await rpc("sim_fundAccount", { account_address: getAddress(acct[k].address), amount: whole * 1e18 });
  for (let i = 0; i < 20 && (await balance(acct[k].address)) === 0n; i++) await sleep(3000);
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- fees: quoted by the network for every transaction ----------
const feesFor = async (who) => {
  const q = await client[who].estimateTransactionFees();
  if (!q?.distribution || q.feeValue === undefined) throw new Error("the network gave no fee quote");
  return { distribution: q.distribution, ...(q.messageAllocations ? { messageAllocations: q.messageAllocations } : {}), feeValue: q.feeValue };
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      const text = errText(e);
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${text.slice(0, 90)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => String(t.from_address).toLowerCase() === addr.toLowerCase() && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const countVotes = (t) => { let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; } return { agree: a, disagree: d, idle: idl }; };
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const v = countVotes(t);
      return { tx, status: t.status, result: t.result_name || "", exec: t.txExecutionResultName || "", msg, votes: v, applied: v.agree * 2 > v.agree + v.disagree + v.idle, address: t.data?.contract_address || t.to_address || "", fee_deposit: String(t.fees?.deposit || "0") };
    }
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, status: "UNDETERMINED", result: t.result_name || "", exec: "", msg: "UNDETERMINED", votes: countVotes(t), applied: false, address: "", fee_deposit: "0" };
    if (t?.status === "CANCELED") return { tx, status: "CANCELED", result: "", exec: "", msg: "CANCELED", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "", fee_deposit: "0" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, status: "TIMEOUT", result: "", exec: "", msg: "TIMEOUT", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "", fee_deposit: "0" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };

// What a step moved for its sender, fees aside, read off its own receipt: value it kept, value it returned, value
// a withdrawal paid out. Every payout of this contract goes to credit, so nobody but the sender moves in a step.
const contractDelta = (fn, value, j, exec) => {
  if (exec !== "FINISHED_WITH_RETURN") return 0n;   // a raised call takes nothing
  if (fn === "withdraw") return BigInt(j?.withdrawn || 0);
  if (j && j.ok === false) return -value + BigInt(j.returned || 0);
  return -value;
};

// One step: a signed transaction with fees, its status and execution result, its tally, what it returned, and the
// sender's balance before and after. The fee is what the balance moved beyond the receipt's own movement; it must
// be at least zero and at most the deposit the transaction carried. A balance that does not fit is read once more
// a few seconds later before it is failed: an emitted transfer can land a moment after the receipt.
const call = async (id, who, fn, args = [], opt = {}) => {
  const value = opt.value || 0n;
  if (!st.steps[id]) { st.steps[id] = { id, who, fn, args: args.map(String), value: String(value), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    let r;
    for (;;) {
      if (!rec.pending) {
        rec.before = String(await balance(acct[who].address));
        const fees = await feesFor(who);
        rec.fee_quote = String(fees.feeValue);
        rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address: st.contract, functionName: fn, args, ...(value ? { value } : {}), fees }));
        save();
      }
      r = await wait(rec.pending);
      const j = jsonOf(r.msg);
      const want = contractDelta(fn, value, j, r.exec);
      let after = await balance(acct[who].address);
      let charged = want - (after - BigInt(rec.before));
      if (charged < 0n || charged > BigInt(rec.fee_quote)) { await sleep(8000); after = await balance(acct[who].address); charged = want - (after - BigInt(rec.before)); }
      rec.tries.push({ tx: r.tx, status: r.status, result: r.result, exec: r.exec, votes: r.votes, applied: r.applied, msg: r.msg, moved: String(want), fee: String(charged), fee_quote: rec.fee_quote, at: stamp() });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${fn}(${args.map((x) => String(x).slice(-32)).join(", ")})${value ? " +" + gen(value) + " GEN" : ""}  ${r.tx}  ${r.status} ${r.exec}  ${tally(r.votes)}  fee ${gen(charged)}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied && fn === "submit") { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      break;
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries };
};
const done = (r) => r.status === "FINALIZED" && r.exec === "FINISHED_WITH_RETURN";
const feeOk = (r) => BigInt(r.fee) >= 0n && BigInt(r.fee) <= BigInt(r.fee_quote);
const refused = (r, words) => r.status === "FINALIZED" && r.exec === "FINISHED_WITH_ERROR" && r.msg.includes(words) && feeOk(r);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");

const deploy = async (id, who) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn: "deploy corroborate.py", args: [], value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = readFileSync(FILE, "utf8");
    for (;;) {
      if (!rec.pending) {
        rec.before = String(await balance(acct[who].address));
        const fees = await feesFor(who);
        rec.fee_quote = String(fees.feeValue);
        rec.pending = await sendRaw(who, "deploy", () => client[who].deployContract({ code, args: [], leaderOnly: false, fees }));
        save();
      }
      const r = await wait(rec.pending);
      const charged = BigInt(rec.before) - (await balance(acct[who].address));
      rec.tries.push({ tx: r.tx, status: r.status, result: r.result, exec: r.exec, votes: r.votes, applied: r.applied, msg: r.msg.slice(0, 300), moved: "0", fee: String(charged), fee_quote: rec.fee_quote, at: stamp() });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} deploy corroborate.py  ${r.tx}  ${r.status} ${r.exec}  ${tally(r.votes)}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return { address: rec.address, ...rec.tries[rec.tries.length - 1] };
};

// ---------- reads: paced, and made again on a 429 or on "Contract not found" ----------
let lastRead = 0;
const read = async (fn, args = []) => {
  for (let i = 0; i < 30; i++) {
    const gap = 3500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try { return JSON.parse(String(await rd.readContract({ address: st.contract, functionName: fn, args }))); } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
const seen = async (id, fn, args = []) => { if (!st.views[id]) { st.views[id] = { fn, args, at: stamp(), out: await read(fn, args) }; save(); } return st.views[id].out; };
const untilPast = async (cid, instant, what) => {
  for (;;) {
    const row = await read("claim", [cid]);
    const now = Number(row.now > 0 ? row.now : Math.floor(Date.now() / 1000));
    const left = Number(instant) - now;
    if (left <= -5) return;
    console.log(`      [${stamp()}] waiting ${left + 20} s, by the chain clock, for ${what}`);
    await sleep((left + 20) * 1000);
  }
};

// ---------- the demonstration: the same claims and pages as tests/test_pure.py ----------
const FOOTBRIDGE = "The Marrow Creek footbridge in Fenwick closed to the public on 3 March 2026 after an inspection found cracked supports";
const INSPECTION = "An inspection of the Marrow Creek footbridge on 2 March 2026 found cracked supports";
const BOND = GEN / 5n, BOUNTY = 3n * GEN, BOUNTY_B = GEN, LOW = GEN / 100n;
const WINDOW = 14400, WINDOW_B = 2400;
const DEP = { anna: GEN / 2n, ben: GEN / 2n, cara: GEN };

await fundOnce("desk", 6); await fundOnce("anna", 2); await fundOnce("ben", 2); await fundOnce("cara", 3); await fundOnce("stranger", 1);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); st.started = new Date().toISOString(); save(); }
console.log(`[${stamp()}] ${Object.keys(ROLES).map((k) => k.toUpperCase().padEnd(9) + st.accounts[k] + "  " + ROLES[k]).join("\n           ")}\n           source rule ${PREFIX}`);
const policy = await client.desk.estimateTransactionFees();
ok("the network charges fees (Studio v0.123), and quotes a deposit for every transaction", policy?.policy?.enabled === true && BigInt(policy.feeValue) > 0n, `fee deposit quoted ${gen(policy.feeValue)} GEN`);

// ================================================================ A
console.log(`\n[${stamp()}] ---- A: deploy, and two claims opened`);
const dep = await deploy("deploy", "desk");
st.contract = need(dep.address, "the contract address"); save();
ok(`DESK deploys corroborate.py, with fees: FINALIZED and FINISHED_WITH_RETURN`, dep.status === "FINALIZED" && dep.exec === "FINISHED_WITH_RETURN", `${dep.tx}  ${tally(dep.votes)}  ${st.contract}`);
{
  const low = await call("openLow", "desk", "open_claim", [FOOTBRIDGE, 3, BOND, WINDOW, PREFIX], { value: LOW });
  ok("DESK opens a claim with 0.01 GEN for three shares: refused, every atto back in the same transaction", done(low) && low.j?.ok === false && String(low.j?.reason).startsWith("the bounty, sent with the call") && low.j?.returned === String(LOW) && low.moved === "0" && feeOk(low), `${votes(low)}  ${low.j?.reason}  fee ${gen(low.fee)}`);
  const a = await call("openK1", "desk", "open_claim", [FOOTBRIDGE, 3, BOND, WINDOW, PREFIX], { value: BOUNTY });
  st.ids.K1 = need(a.j?.claim, "the id of the first claim"); save();
  ok(`DESK opens ${st.ids.K1}: k 3, bond 0.2 GEN, bounty 3 GEN in three shares of 1 GEN`, done(a) && a.j?.ok === true && a.j?.k === 3 && a.j?.share === String(GEN) && a.j?.source_prefix === PREFIX && feeOk(a), `${votes(a)}  ${a.msg.slice(0, 160)}`);
  const b = await call("openK2", "desk", "open_claim", [INSPECTION, 2, BOND, WINDOW_B, PREFIX], { value: BOUNTY_B });
  st.ids.K2 = need(b.j?.claim, "the id of the second claim"); st.ids.K2deadline = b.j?.deadline; save();
  ok(`DESK opens ${st.ids.K2}: k 2, bounty 1 GEN in two shares of 0.5 GEN, a ${WINDOW_B / 60}-minute window`, done(b) && b.j?.ok === true && b.j?.k === 2 && b.j?.share === String(GEN / 2n) && feeOk(b), `${votes(b)}  ${b.msg.slice(0, 160)}`);
}
const [K1, K2] = [st.ids.K1, st.ids.K2];

// ================================================================ B
console.log(`\n[${stamp()}] ---- B: credit, the second claim's first source, and three refusals`);
{
  for (const who of ["anna", "ben", "cara"]) {
    const r = await call("deposit_" + who, who, "deposit", [], { value: DEP[who] });
    ok(`${who.toUpperCase()} deposits ${gen(DEP[who])} GEN of credit`, done(r) && r.j?.ok === true && r.j?.credit === String(DEP[who]) && feeOk(r), `${votes(r)}  fee ${gen(r.fee)}`);
  }
  const k2 = await call("k2County", "anna", "submit", [K2, PAGE.county]);
  ok(`ANNA offers the county notice for ${K2}: accepted (S-), a 0.5 GEN share`, done(k2) && k2.applied && k2.j?.outcome === "accepted" && k2.j?.mask === "S-" && k2.j?.share === String(GEN / 2n) && k2.j?.fp === fpOf("county") && feeOk(k2), `${votes(k2)}  ${JSON.stringify({ source: k2.j?.source, mask: k2.j?.mask, fp: k2.j?.fp })}`);
  const broke = await call("strangerNoCredit", "stranger", "submit", [K1, PAGE.county]);
  ok(`STRANGER offers a source for ${K1} with no credit: refused before anything is fetched`, refused(broke, "holds 0; deposit() first"), `${votes(broke)}  ${broke.msg.slice(0, 150)}`);
  const own = await call("deskOwn", "desk", "submit", [K1, PAGE.county]);
  ok(`DESK may not offer a source for its own ${K1}`, refused(own, "may not offer sources for its own claim"), `${votes(own)}  ${own.msg.slice(0, 120)}`);
  const off = await call("offRule", "anna", "submit", [K1, "https://news.example/marrow-creek.html"]);
  ok(`ANNA offers a page outside ${K1}'s source rule: refused`, refused(off, "are pages under " + PREFIX), `${votes(off)}  ${off.msg.slice(0, 120)}`);
}

// ================================================================ C
console.log(`\n[${stamp()}] ---- C: ${K1}, one consensus round per source`);
const steps = [
  ["k1County", "anna", "county", "accepted", "S-"],
  ["k1Courier", "ben", "courier", "accepted", "SI"],
  ["k1Digest", "cara", "digest", "derivative", "SD"],
  ["k1Parish", "cara", "parish", "not_supporting", "N"],
  ["k1Walkers", "cara", "walkers", "contradicting", "C"],
];
const WORDS = {
  county: "the county roads notice, the first source: accepted, 1 GEN share",
  courier: "the Valley Courier report, independent of the county notice: accepted, 1 GEN share",
  digest: "the River Towns Digest, which names the Courier as its source: derivative, the 0.2 GEN bond to DESK",
  parish: "the parish newsletter, which says nothing of a closure: not supporting, the bond to DESK",
  walkers: "the walkers' log, which says the bridge stayed open: contradicting, on the record, the bond kept",
};
for (const [id, who, page, outcome, mask] of steps) {
  const r = await call(id, who, "submit", [K1, PAGE[page]]);
  const toDesk = ["derivative", "not_supporting"].includes(outcome) ? String(BOND) : "0";
  const share = outcome === "accepted" ? String(GEN) : "0";
  ok(`${who.toUpperCase()} offers ${WORDS[page]}`, done(r) && r.applied && r.j?.outcome === outcome && String(r.j?.mask).startsWith(mask) && r.j?.to_desk === toDesk && r.j?.share === share && r.j?.fp === fpOf(page) && feeOk(r), `${votes(r)}  ${JSON.stringify({ source: r.j?.source, mask: r.j?.mask, fp: r.j?.fp, accepted: r.j?.accepted, contested: r.j?.contested })}`);
  st.ids[id] = r.j?.source; save();
}
{
  const again = await call("readTwice", "cara", "submit", [K1, PAGE.county]);
  ok(`CARA offers the county notice for ${K1} again: refused, a page is read once per claim`, refused(again, "already read for " + K1), `${votes(again)}  ${again.msg.slice(0, 140)}`);
  const farm = await call("farm", "ben", "submit", [K1, PAGE.rowing]);
  ok(`BEN offers a second page for ${K1}: refused, one accepted source per address per claim`, refused(farm, "already holds the accepted source"), `${votes(farm)}  ${farm.msg.slice(0, 140)}`);
  const early = await call("expireEarly", "stranger", "expire", [K2]);
  ok(`STRANGER expires ${K2} before its window ends: refused`, refused(early, "runs until"), `${votes(early)}  ${early.msg.slice(0, 120)}`);
  const last = await call("k1Rowing", "cara", "submit", [K1, PAGE.rowing]);
  ok(`CARA offers the rowing club notice: accepted (SI), the third independent source, ${K1} corroborated`, done(last) && last.applied && last.j?.outcome === "accepted" && last.j?.mask === "SI" && last.j?.slot === 3 && last.j?.status === "corroborated" && last.j?.returned === "0" && last.j?.contested === 1 && last.j?.fp === fpOf("rowing") && feeOk(last), `${votes(last)}  ${JSON.stringify({ source: last.j?.source, status: last.j?.status, accepted: last.j?.accepted, contested: last.j?.contested })}`);
  const closed = await call("closedK1", "stranger", "submit", [K1, PAGE.parish]);
  ok(`STRANGER offers a source for the corroborated ${K1}: refused`, refused(closed, "only an open claim takes sources"), `${votes(closed)}  ${closed.msg.slice(0, 120)}`);
}

// ================================================================ D
console.log(`\n[${stamp()}] ---- D: ${K2}'s window, the views, the code, the money`);
{
  if (!st.steps.expireK2?.done) await untilPast(K2, Number(st.ids.K2deadline || 0), `${K2}'s window to end`);
  const ex = await call("expireK2", "stranger", "expire", [K2]);
  ok(`STRANGER expires ${K2} after its window: not corroborated, its unpaid 0.5 GEN to DESK's credit`, done(ex) && ex.j?.status === "expired" && ex.j?.accepted === 1 && ex.j?.returned === String(GEN / 2n) && feeOk(ex), `${votes(ex)}  ${ex.msg.slice(0, 160)}`);

  const k1 = await seen("claimK1", "claim", [K1]);
  ok(`claim(${K1}): corroborated, 3 accepted, contested by 1, 1 derivative, 1 not supporting, nothing left`, k1.status === "corroborated" && k1.accepted === 3 && k1.contested === 1 && k1.is_contested === true && k1.derivative === 1 && k1.not_supporting === 1 && k1.submissions === 6 && k1.left === "0" && k1.to_desk === String(2n * BOND) && k1.text === FOOTBRIDGE, JSON.stringify({ status: k1.status, accepted: k1.accepted, contested: k1.contested, to_desk: k1.to_desk }));
  const acc = await seen("acceptedK1", "accepted_of", [K1]);
  ok(`accepted_of(${K1}): the county notice, the Courier and the rowing club, slots 1 to 3, three different contributors`, acc.total === 3 && (acc.rows || []).map((r) => r.url).join(",") === [PAGE.county, PAGE.courier, PAGE.rowing].join(",") && new Set((acc.rows || []).map((r) => r.contributor)).size === 3, JSON.stringify((acc.rows || []).map((r) => [r.source, r.slot, r.mask])));
  const all = await seen("sourcesK1", "sources_of", [K1, 0, 20]);
  ok(`sources_of(${K1}, 0, 20): six readings, every outcome on the record`, all.total === 6 && (all.rows || []).map((r) => r.outcome).join(",") === "accepted,accepted,derivative,not_supporting,contradicting,accepted", JSON.stringify((all.rows || []).map((r) => [r.source, r.outcome, r.mask])));
  const k2 = await seen("claimK2", "claim", [K2]);
  ok(`claim(${K2}): expired with 1 of 2 accepted, 0.5 GEN returned`, k2.status === "expired" && k2.accepted === 1 && k2.returned === String(GEN / 2n) && k2.left === "0", JSON.stringify({ status: k2.status, accepted: k2.accepted, returned: k2.returned }));
  const stats = await seen("stats", "stats", []);
  ok("stats(): two claims, one corroborated, one expired, seven readings, four accepted, one each derivative, not supporting and contradicting, one refused payment", stats.claims === 2 && stats.corroborated === 1 && stats.expired === 1 && stats.sources === 7 && stats.accepted === 4 && stats.derivative === 1 && stats.not_supporting === 1 && stats.contradicting === 1 && stats.refused_payments === 1 && stats.bounties_held === "0", JSON.stringify(stats));
  const rules = await seen("rules", "rules", []);
  ok("rules(): both questions word for word, the outcome table and the limits", rules.questions?.stance === "How does the SOURCE stand on the CLAIM as worded? Answer supports, contradicts or neither." && rules.questions?.independence === "Does the SOURCE take what it says about the CLAIM from any ACCEPTED page? Answer independent, derivative or unclear." && rules.outcomes?.accepted === "S with I or -" && String(rules.compared).includes("exact equality"), Object.keys(rules).join(","));

  const file = readFileSync(FILE);
  const chain = Buffer.from(String(await rpc("gen_getContractCode", [st.contract])), "base64");
  st.code = { address: st.contract, bytes: chain.length, sha256: sha(chain), file_bytes: file.length, file_sha256: sha(file), identical: Buffer.compare(chain, file) === 0 };
  save();
  ok(`the code deployed at ${st.contract} is byte for byte contracts/corroborate.py`, st.code.identical, `${chain.length} bytes, sha256 ${st.code.sha256}`);

  const owedBefore = await read("stats", []);
  let held = await balance(st.contract);
  if (String(held) !== owedBefore.balance_owed) { await sleep(8000); held = await balance(st.contract); }
  ok("before the withdrawals the contract holds exactly what it owes: every credit, no open bounty", String(held) === owedBefore.balance_owed && owedBefore.bounties_held === "0", `${gen(held)} GEN held, ${gen(owedBefore.balance_owed)} owed`);

  // what each holds: its own deposit (a kept bond never leaves credit), plus shares, less forfeits; the desk holds
// the two forfeited bonds and K2's unpaid half
const CREDIT = { anna: DEP.anna + GEN + GEN / 2n, ben: DEP.ben + GEN, cara: DEP.cara - 2n * BOND + GEN, desk: 2n * BOND + GEN / 2n };
  for (const who of ["anna", "ben", "cara", "desk"]) {
    const r = await call("withdraw_" + who, who, "withdraw", []);
    ok(`${who.toUpperCase()} withdraws its ${gen(CREDIT[who])} GEN of credit`, done(r) && r.j?.withdrawn === String(CREDIT[who]) && feeOk(r), `${votes(r)}  fee ${gen(r.fee)}`);
  }
  const none = await call("withdraw_stranger", "stranger", "withdraw", []);
  ok("STRANGER withdraws with no credit: refused", refused(none, "this address holds no credit"), `${votes(none)}  ${none.msg.slice(0, 100)}`);
  const owed = await read("stats", []);
  held = await balance(st.contract);
  if (held !== 0n) { await sleep(8000); held = await balance(st.contract); }
  ok("the contract ends holding nothing and owing nothing", held === 0n && owed.balance_owed === "0" && owed.credit === "0", `${held} held, ${owed.balance_owed} owed`);

  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address));
  st.ended = new Date().toISOString(); save();
  // the money table, from the receipts: each account's movement fees aside, and the fees its transactions were charged
  const table = {}, fees = {};
  for (const k of Object.keys(ROLES)) { table[k] = 0n; fees[k] = 0n; }
  for (const id of st.order) { const s = st.steps[id]; for (const t of s.tries) { table[s.who] += BigInt(t.moved); fees[s.who] += BigInt(t.fee); } }
  const WANT = { desk: -(BOUNTY + BOUNTY_B) + 2n * BOND + GEN / 2n, anna: GEN + GEN / 2n, ben: GEN, cara: GEN - 2n * BOND, stranger: 0n };
  st.money = Object.fromEntries(Object.keys(ROLES).map((k) => [k, { moved: String(table[k]), fees: String(fees[k]), net: String(BigInt(st.end[k]) - BigInt(st.start[k])) }])); save();
  ok("the money table: DESK -3.1 GEN, ANNA +1.5, BEN +1, CARA +0.6, STRANGER 0, each less only the fees its own transactions were charged",
    Object.keys(ROLES).every((k) => table[k] === WANT[k] && BigInt(st.end[k]) - BigInt(st.start[k]) === table[k] - fees[k]),
    Object.keys(ROLES).map((k) => `${k.toUpperCase()} ${gen(table[k])} (fees ${gen(fees[k])})`).join("  "));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`Corroborate: ${st.contract}  ${EXPLORER}/address/${st.contract}`);
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
for (const id of st.order) { const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || ""); if (s.fn === "submit" && j?.fp) console.log(`${id.padEnd(12)} ${s.tries.map((t) => t.tx + " " + tally(t.votes)).join(" | ")}  ${j.outcome} ${j.mask}  fp ${j.fp}`); }
console.log("record:", RECORD.split("/").pop(), "(next to the state file; it carries no key)");
process.exit(fail ? 1 : 0);
