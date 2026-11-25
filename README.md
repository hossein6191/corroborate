# Corroborate

A claim counts as corroborated only once K independent sources support it. A desk opens a claim with a
bounty; contributors offer pages, each staking a bond; validators read every page on the live web and decide
whether it states the claim and whether it took it from a source already accepted. The K-th independent page
closes the claim, and the money moves in the call that decides.

## The problem

Newsrooms and fact-check desks have a two-source rule: do not run a claim until two sources that did not get
it from each other confirm it. It is the rule that breaks first under pressure. A wire story is picked up by
ten outlets and looks like ten sources; a digest that quotes one report looks like a second report. Counting
links is easy. Counting independent links is the job, and nothing enforces it.

Corroborate makes the count a contract. A claim needs K accepted pages, and each page is accepted only if it
states the claim and does not take it from a page already accepted, by naming it, quoting it or repeating it.
A page that only echoes an accepted source costs its contributor the bond.

## What it is

- **`open_claim(claim, k, bond, window_seconds, source_prefix)`**, payable. The sender is the desk; the value
  is the bounty, cut into k shares of `bounty // k`. The claim is one factual sentence of 20 to 300 printable
  ASCII characters; k is 2 to 5; the bond each source stakes is 0.01 to 10 GEN; the window is 600 seconds to 30
  days; the source rule lists one to six address prefixes separated by commas, each `https://` alone or a
  host and folder ending in `/` (the outlets the desk trusts). No model runs. Every refusal returns
  everything sent. Claims are `K1`, `K2`, ...
- **`deposit()` / `withdraw()`**: credit, from which bonds are taken and into which shares, forfeits and
  returned bounties are paid.
- **`submit(claim, source_url)`**: anyone but the desk, while the claim is open and its window runs. The bond
  comes from credit. One consensus round reads the page; the money moves in the same call.
- **`expire(claim)`**: anyone, once the window has ended without K accepted sources. What is left of the
  bounty goes to the desk.
- **Views**: `claim(id)`, `claims(offset, limit)`, `claims_of(desk, offset, limit)`,
  `sources_of(claim, offset, limit)`, `accepted_of(claim)`, `sources_by(address, offset, limit)`,
  `source(id)`, `credit(address)`, `stats()`, `rules()`. Every list pages at 20 rows.

## How consensus is used

One round, run only in `submit()`, which takes no value: one `gl.vm.run_nondet(leader_fn, validator_fn)`
block. Inside the leader closure the page is fetched once with `gl.nondet.web.get`, its status is checked,
and the body of that same answer becomes the judged text: tags removed (and the text after a script or style
tag), whitespace collapsed, at most 4,000 characters. Its fingerprint is the first 16 hex characters of its
sha256. Then two questions:

> **STANCE.** How does the SOURCE stand on the CLAIM as worded? Answer supports, contradicts or neither.

> **INDEPENDENCE.** Does the SOURCE take what it says about the CLAIM from any ACCEPTED page? Answer
> independent, derivative or unclear.

Each is followed by what its three answers mean. *Supports* needs every figure, name, date and place in the
claim to be given by the page; *contradicts* means the page states something that cannot be true if the claim
is; *derivative* means the page names an accepted page or its outlet as its source, quotes it, or repeats its
sentences, and agreeing with it is explicitly not enough. The accepted pages are shown by their first 1,200
characters, each in its own block.

| asking | blocks shown | question |
|---|---|---|
| 1 | CLAIM, SOURCE | STANCE |
| 2 | SOURCE, CLAIM | STANCE |
| 3 | CLAIM, SOURCE, ACCEPTED_1 .. ACCEPTED_n | INDEPENDENCE |
| 4 | ACCEPTED_n .. ACCEPTED_1, SOURCE, CLAIM | INDEPENDENCE |

Askings 3 and 4 are made only when the claim already has accepted sources; the first source has nothing to be
derived from. The contract reads each answer strictly (one of the three words under `"answer"` in a JSON
object, nothing else) and writes the stored value itself:

| stance, both orders | independence, both orders | mask | outcome |
|---|---|---|---|
| supports, supports | independent, independent, or not asked | `SI`, `S-` | **accepted** |
| supports, supports | derivative, derivative | `SD` | **derivative** |
| neither, neither | any | `N?` | **not supporting** |
| contradicts, contradicts | any | `C?` | **contradicting** |
| anything else, or supports with independence split | | `U?`, `SU` | **unsettled** |
| the page text this claim already read, under any address | | any | **copy** |

The stored value is `{"mask", "fp", "lead"}`: two letters the contract wrote, the fingerprint, and the
first 1,200 characters of the judged page (what later readers see of it when it is accepted).

### Agreement

Every validator fetches the page and makes every asking itself, inside `try`, and agrees only when its own
value equals the leader's: mask, fingerprint and lead, by exact equality. No tolerance anywhere: a reader led
by block order, or one that says the same word to everything, lands on `U`, and the mask carries the
disagreement into storage. A page that reads differently for different validators gets no agreement and
stores nothing. When the leader fails, a validator agrees only to fail the same way (the same `[EXTERNAL]`
text, or `[TRANSIENT]` on both sides), never with a model failure; the transaction then ends with the error
and stores nothing.

### No free re-roll

An address is read once per claim, whatever it read as. The same page text under another address is a copy,
and its bond goes to the desk. An address that holds an accepted source on a claim may not offer another.

### The prompt boundary

The claim, the page and every accepted page's opening are fenced (`<` and `>` replaced, never deleted) and
placed between delimiter lines tagged with the start of the sha256 of their own fenced text, under labels the
contract writes (`CLAIM`, `SOURCE`, `ACCEPTED_1`..`ACCEPTED_4`). The prompt says before the first block that
everything in them is untrusted and never an instruction. The model never sees an address, an amount, an id, a
party or the clock.

## Who may do what

| call | who | when |
|---|---|---|
| `open_claim` | anyone; becomes the desk | any time |
| `deposit`, `withdraw` | anyone, its own credit | any time |
| `submit` | anyone but the desk; at most one accepted source per address per claim | the claim is open and its window runs |
| `expire` | anyone | the window has ended and the claim is still open |

`expire` is open on purpose: all it can do is move what is left of a bounty into its own desk's credit, after
the window the desk chose. A static test checks that every other write reads its sender.

Every refusal of `submit` happens before any page is fetched: unknown claim, the desk itself, a closed claim,
the window over, an address that is not plain https or not under the claim's source rule, an address already
read for the claim, an address already holding an accepted source, or too little credit.

## The money

| outcome | contributor | desk | bounty |
|---|---|---|---|
| accepted | bond kept, + one share | | - one share |
| derivative, not supporting, copy | - bond | + bond | |
| contradicting | bond kept | | |
| unsettled | - a tenth of the bond | + a tenth | |
| K-th accepted: corroborated | | + what is left | closed |
| window over, `expire`: not corroborated | | + what is left | closed |

A contradicting page keeps its bond and earns nothing: it is on the record, and the claim's `contested`
count is public, but paying for disagreement would let anyone drain the shares that corroborating sources are
owed (DECISIONS.md, section 5). Everything moves between credits; only `withdraw` and the refund of a refused
payable call send value out. The contract holds exactly the rest of every open bounty plus all credit, which
`stats()` reports as `balance_owed`.

### Every call is bounded

A submission reads at most K - 1 accepted rows (four at most), closing touches one claim, and every list view
returns one page. Nothing walks the claims or the sources. A static test fails on any loop not bounded by a
constant.

## Why this has to be on GenLayer

The decision is a reading of pages nobody controls: does this page state the claim, and did it get it from
that one? A single server could answer, and the desk would have to trust it with the bounty. Here every
validator fetches the page and reads it, the answers are compared exactly, and the bounty pays out only on the
agreed reading. The pages are evidence the desk does not own, and the money cannot move on one node's word.

## Who uses it

- A fact-check desk that publishes "corroborated" only when two or three independent outlets carry a claim,
  and pays the people who found them.
- A newsroom enforcing the two-source rule on a developing story, with the record of every page that was
  rejected as an echo.
- A research group asking for k independent replications or reports of an observation.

A consumer reads `claim(id)`: `status == "corroborated"` and `accepted == k`, with `contested` for how many
offered pages contradicted it.

## The limits, stated plainly

- **Independence is judged against what the accepted pages say in their first 1,200 characters.** A page that
  silently rewrites an accepted page's later paragraphs, naming no outlet and repeating no sentence shown,
  reads as independent.
- **Addresses are free.** One accepted source per address stops one account from filling every slot, not a
  person with many accounts. What stops one story counting twice is the independence question, which does
  not care who offers the page.
- **Pages must hold still.** A page that changes between fetches gets no agreement and stores nothing.
  Commit-pinned or otherwise immutable pages are the ones to offer.
- **The source rule is the desk's defence against made-up pages.** With `https://` alone, anyone can write a
  page and offer it, and k invented pages that do not cite each other would read as independent. A desk that
  pays for corroboration lists the outlets it trusts instead (up to six prefixes); the demo's rule is the
  repository's own `pages/` folder at one commit.
- **First to offer is paid.** An offer still waiting to be read can be copied by whoever sees it first, who
  is then read first and paid for it.
- **Text only.** Images, scripts and anything past the first 4,000 characters of visible text are not read.
- **Not truth.** K independent pages can all be wrong. The contract certifies that they exist and agree, not
  that the world does.

## What is in this repository

| path | what |
|---|---|
| `contracts/corroborate.py` | the contract, GenVM v0.4 |
| `pages/` | the six demo pages the validators read, pinned to a commit |
| `tests/test_pure.py` | the offline suite: a stub of the v0.4 runtime and a simulator that gives every node its own web and model |
| `tests/direct/test_direct.py` | opt-in tests in genlayer-test's direct mode, the real v0.4 SDK |
| `tests/MUTATIONS.md` | 171 defences removed one by one, and the test that caught each |
| `tools/mutate.py` | generates that table; refuses to write it if any mutant survives |
| `tests/on_chain/smoke.mjs` | the run on Studio with genlayer-js 2.0.0 and fees |
| `tests/on_chain/smoke-run.log`, `smoke-run.json` | the log and the record of that run |
| `CONTRACTS.md`, `DECISIONS.md` | the one-page summary and the reasons, with what was measured |

## Running it

```bash
pip install -r requirements-dev.txt
pytest tests/ -q                                   # 205 passed, 1 skipped, under a second, no network
python tools/mutate.py                             # 171 / 171 killed, rewrites tests/MUTATIONS.md
genvm-lint check contracts/corroborate.py          # validation passes; lint reports only E014, see below
CORROBORATE_DIRECT=1 GENVM_VERSION=v0.6.0-rc14 pytest tests/direct -q -p gltest_direct -o addopts=""   # 3 passed

npm ci
node tests/on_chain/smoke.mjs <owner>/<repo> <commit>   # the pages must be pushed at that commit
```

`genvm-lint` 0.11.1rc2 reports E014 ("needs @allow_storage decorator") on the two `@gl.storage.allow`
dataclasses; `@allow_storage` does not exist on the v0.4 runner, and the `genvm-lint` skill documents this as
a false positive. Validation passes.

## Network

GenLayer Studio, `studio.genlayer.com`, chain 61999, Studio v0.123 (Consensus v0.6, GenVM v0.4). Every deploy
and write carries the fee distribution and deposit quoted by `estimateTransactionFees`.

## Evidence

One run of `tests/on_chain/smoke.mjs` on Studio (chain 61999, Studio v0.123, GenVM v0.4) on 25 November 2026,
from 19:45 to 20:33 UTC, with five throwaway accounts and genlayer-js 2.0.0, every transaction carrying the
fees quoted by `estimateTransactionFees`. The pages were read from this repository at commit
`d8429e4c829c13e5ca6dba8b02456b250d1f1731`.

**Register:** [`0x3De963CF5B3F0172a60010279BeAd90441d104E5`](https://explorer-studio.genlayer.com/address/0x3De963CF5B3F0172a60010279BeAd90441d104E5).
Its code, read back with `gen_getContractCode`, is byte for byte `contracts/corroborate.py` (63,292 bytes,
sha256 `0457d1ceac6c90d0bb9fccc21a902d2345a66df012383b460327aa4d54c04cde`).

27 transactions in 27 steps, none sent twice; every one FINALIZED, every refusal FINISHED_WITH_ERROR with its
reason, everything else FINISHED_WITH_RETURN. The log is `tests/on_chain/smoke-run.log` and the record (every
step, receipt, view and balance, no keys) is `tests/on_chain/smoke-run.json`.

| | who | call | tx | votes (agree/disagree/idle) | result |
|---|---|---|---|---|---|
| A | DESK | deploy `corroborate.py` | [0x5ce4ab6d…](https://explorer-studio.genlayer.com/tx/0x5ce4ab6d29fe13bb05bd11a8b24b8518673e3de0b2133d0806660b81574622b9) | 3/0/2 | deployed; code byte for byte the repository file |
| A | DESK | `open_claim` with 0.01 GEN for three shares | [0x8c67cd6f…](https://explorer-studio.genlayer.com/tx/0x8c67cd6f69b124a81e04767ebe8010bc0d370a964c60e9865149edf9ed8bd74f) | 3/0/2 | refused, `ok: false`, every atto returned in the same transaction |
| A | DESK | `open_claim` K1, k 3, bond 0.2, bounty 3 GEN | [0xe5b03b03…](https://explorer-studio.genlayer.com/tx/0xe5b03b03e739ba3804df2ae7d854c0ace2239a55fd5903a5bc9161f86792b567) | 3/0/2 | K1, three shares of 1 GEN |
| A | DESK | `open_claim` K2, k 2, bond 0.2, bounty 1 GEN, 40 min | [0x92bc562f…](https://explorer-studio.genlayer.com/tx/0x92bc562fb4b487ac6d176fbfb4ee64c3b0ac9b1e6d83aa5ea2569e54fc45032b) | 3/0/2 | K2, two shares of 0.5 GEN |
| B | ANNA | `deposit` 0.5 GEN | [0x8cfe264f…](https://explorer-studio.genlayer.com/tx/0x8cfe264fb84ca0cee3b4c1720745863849f4d074cc9c5931c5418abfef37e876) | 3/0/2 | credit 0.5 |
| B | BEN | `deposit` 0.5 GEN | [0x50106184…](https://explorer-studio.genlayer.com/tx/0x50106184615144fdf59d2b0bca5e3550e712e3e103ba4ba34f94abf0ac580386) | 4/0/1 | credit 0.5 |
| B | CARA | `deposit` 1 GEN | [0x357c2c67…](https://explorer-studio.genlayer.com/tx/0x357c2c672bdf5650e197943f8b07f97e8f2b0ff84d4064ffa110595f924dbfad) | 3/0/2 | credit 1 |
| B | ANNA | `submit` K2, county notice | [0x582c0b34…](https://explorer-studio.genlayer.com/tx/0x582c0b344b3eeaacca7c6488425ad3388520fa0493f5d9b001348fb65b47f4f7) | 3/0/2 | **accepted** `S-`, fp `5b82318b5c39e90f`, 0.5 GEN share |
| B | STRANGER | `submit` K1 with no credit | [0x6400bfb5…](https://explorer-studio.genlayer.com/tx/0x6400bfb554275b5df16fc7ea72f16090dd12f27b671fa6824567e68a8e3bceae) | 3/0/2 | refused before any fetch: deposit() first |
| B | DESK | `submit` to its own K1 | [0x66dda5cd…](https://explorer-studio.genlayer.com/tx/0x66dda5cdb7e6bd417508645b0c8db82933dd0c1722fb88f9550414fe767c0292) | 3/0/2 | refused: the desk may not offer sources |
| B | ANNA | `submit` K1, a page outside the source rule | [0x28073452…](https://explorer-studio.genlayer.com/tx/0x2807345238b63d8166783a11cc95be1a31bf961ea666e39b4257c583aacd02b9) | 3/0/2 | refused: the sources of K1 are pages under the rule |
| C | ANNA | `submit` K1, county notice | [0xaa0f7c81…](https://explorer-studio.genlayer.com/tx/0xaa0f7c81f47a78d1721116b9aae01563d327807d894946109f9ccc9efde81989) | 3/0/2 | **accepted** `S-`, the first source, 1 GEN share |
| C | BEN | `submit` K1, Valley Courier | [0xc7c15588…](https://explorer-studio.genlayer.com/tx/0xc7c15588ae10e5d2b47002bc2d77c32e4f78ca4a67662dfe582974efacf07981) | 3/2/0 | **accepted** `SI`, fp `775152bb5b9e2939`, 1 GEN share |
| C | CARA | `submit` K1, River Towns Digest | [0x0a4ee762…](https://explorer-studio.genlayer.com/tx/0x0a4ee762d8c08c64b5c2366dafe91d695857d4383563280f48b2927a2bcaf0db) | 3/1/1 | **derivative** `SD` (names the Courier): 0.2 GEN bond to DESK |
| C | CARA | `submit` K1, parish newsletter | [0x03a91148…](https://explorer-studio.genlayer.com/tx/0x03a9114858e5540e047069c90351013097d57758deac1edbd4916798fcee696b) | 3/1/1 | **not supporting** `NI`: 0.2 GEN bond to DESK |
| C | CARA | `submit` K1, walkers' log | [0xacfdb1cf…](https://explorer-studio.genlayer.com/tx/0xacfdb1cf71aeda3a6b1d9033d71aad99805a8ab16c7f4f06073897cdea7f33c3) | 3/0/2 | **contradicting** `CI`: on the record, K1 contested, bond kept |
| C | CARA | `submit` K1, county notice again | [0x2a7f7e43…](https://explorer-studio.genlayer.com/tx/0x2a7f7e437f397c3975366d01861f2a793f3ffa678c5a69c78e90c41286a5e28d) | 3/0/2 | refused: already read for K1 as S2 |
| C | BEN | `submit` K1, rowing club | [0x65f9168f…](https://explorer-studio.genlayer.com/tx/0x65f9168f3a8a7cebf82423e64185e4c675f1718a7468fb657e377451daf91e2f) | 3/0/2 | refused: BEN already holds the accepted source S3 |
| C | STRANGER | `expire` K2 early | [0xe0c73ab9…](https://explorer-studio.genlayer.com/tx/0xe0c73ab9cae26e1532a7b37c9708faa3aa15c11bbfa10950d7ab8a12654e3c50) | 3/0/2 | refused: the window runs 1,658 more seconds |
| C | CARA | `submit` K1, rowing club | [0xcbafd2a5…](https://explorer-studio.genlayer.com/tx/0xcbafd2a55884c63810b376c9454b24beec89fbab53895ee6fa967917e6f0bd82) | 3/0/2 | **accepted** `SI`, slot 3: **K1 corroborated**, contested 1 |
| C | STRANGER | `submit` to the corroborated K1 | [0x3654f90e…](https://explorer-studio.genlayer.com/tx/0x3654f90e990c44053a45696b1c59f7049e3b949d2ab30017589aafeafd6f1247) | 4/0/1 | refused: only an open claim takes sources |
| D | STRANGER | `expire` K2 after its window | [0x04b67248…](https://explorer-studio.genlayer.com/tx/0x04b6724833f02ce7091aad0c47f8b8f0f6c3aa2eb02b1d0b5fb4a59204c7ce4e) | 4/0/1 | **expired**, 1 of 2 accepted, 0.5 GEN to DESK's credit |
| D | ANNA | `withdraw` | [0xe2e2367e…](https://explorer-studio.genlayer.com/tx/0xe2e2367e1dd1658ff092ba4205c958d248df5969f638ac4cbd7135fd80e0aaeb) | 3/0/2 | 2 GEN (0.5 deposit + 1.5 in shares) |
| D | BEN | `withdraw` | [0x0013255e…](https://explorer-studio.genlayer.com/tx/0x0013255ec7b915bab667688ec9f959da87b40dc0082c78de840df24ee41b051b) | 3/0/2 | 1.5 GEN (0.5 deposit + 1 share) |
| D | CARA | `withdraw` | [0xe16ed83e…](https://explorer-studio.genlayer.com/tx/0xe16ed83e7753ce76c78c67061cb17718fa1b60af2fffa3196be682f28c7ceb55) | 3/0/2 | 1.6 GEN (1 deposit - 0.4 forfeited + 1 share) |
| D | DESK | `withdraw` | [0x344157bf…](https://explorer-studio.genlayer.com/tx/0x344157bf2967c7e80c319707e238f411be879213fb50a4fb8a2d16fef408e1e0) | 3/0/2 | 0.9 GEN (two bonds + K2's unpaid half) |
| D | STRANGER | `withdraw` with no credit | [0x14c91620…](https://explorer-studio.genlayer.com/tx/0x14c91620e5ec7f9a56d7e0254e5aaeccb7128629d8f7e8817532e654c9758c21) | 3/0/2 | refused: holds no credit |

Read back afterwards: K1 corroborated with 3 accepted (S2, S3, S7 from three different contributors), contested
by 1, 1 derivative, 1 not supporting; K2 expired with 1 of 2. Before the withdrawals the contract held exactly
the 6 GEN of credit it owed; after them it held 0 and owed 0. Every account moved by exactly the money table,
less the fee each of its own transactions was charged: DESK -3.1 GEN, ANNA +1.5, BEN +1, CARA +0.6, STRANGER 0
(fees per transaction 0.00008 to 0.00013 GEN, each within its 0.1 GEN deposit).

**36 checks passed, 2 failed, and the two failures are in the script, not the contract.** "ANNA withdraws its
1.5 GEN of credit" and "BEN withdraws its 1 GEN of credit" compared the withdrawal with the shares alone and
forgot each one's own 0.5 GEN deposit: a kept bond never leaves credit, so ANNA's credit was 2 GEN and BEN's
1.5 GEN, which is what both withdrew. Both transactions finished FINISHED_WITH_RETURN, both balances moved by
exactly that amount less the fee, and the later checks (the contract left holding nothing, and the money table
for every account) pass. The expectation in `smoke.mjs` has been corrected since the run; the run was not
repeated.

Two readings are worth reading in the record: the Courier's round carried 3 agree to 2 disagree, and the
digest and newsletter rounds 3 to 1; in each the agreeing majority's value is what was stored, and the dissenters
only voted. The newsletter read `NI` rather than `N-` because independence is asked of every source once
one is accepted; the outcome is decided by the stance letter alone.

## Licence

MIT. See `LICENSE`.
