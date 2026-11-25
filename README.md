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
| `tests/on_chain/smoke-run.log` | the log of that run |
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

Pending: the run needs this repository's `pages/` folder pushed at a commit first, because the validators
read the pages from that commit.

## Licence

MIT. See `LICENSE`.
