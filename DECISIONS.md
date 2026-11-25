# Decisions

The boundary first, then the questions, the page, the prompt, the money, the once-only rules, the bounds, the
doors, then what was measured on the v0.4 tooling and what is not verified.

## 1. The boundary: what the network agrees on

**A two-letter mask, a fingerprint and the page's opening.** The round stores letters the contract wrote
(`S`, `C`, `N`, `U` for the stance; `I`, `D`, `U`, `-` for independence), the fingerprint of the text every
validator read, and the first 1,200 characters of that text. That is the coarsest value that carries the
decision. A score, a quote chosen by the model or a reason in the model's words would put things in storage
that honest nodes reach differently while agreeing on the verdict.

**The lead is part of the agreed value, not a side channel.** An accepted page is shown to every later reader
by its opening text. That text is a pure function of the page text, which the fingerprint already pins, so
storing it adds nothing a node could disagree about; it is compared with everything else by exact equality.

**It does not decide what is true.** The questions are whether the page states the claim and whether it took
it from an accepted page. A claim can be corroborated by k independent pages that are all wrong. That is a
narrower promise than truth, and one validators can keep.

**What a program can check, the program checks.** The claim's length and alphabet, k, the bond, the window,
the source rule, the address's shape and its prefix, the desk not contributing, the window, an address read
before, an address already holding an accepted source, the credit: every one is decided in code before any
page is fetched. The outcome is code over the mask, and the copy rule is code over the fingerprint.

## 2. Two questions, both orders, one block

**STANCE is one closed question with three words.** Supports, contradicts or neither, each defined after the
question. An earlier contract of ours learned that a "pushes toward YES?" / "toward NO?" pair confuses models
when the meaning of yes flips; one question whose three answers are spelled out does not.

**INDEPENDENCE is asked against the accepted set, not against an original.** The question is whether the page
takes what it says about the claim from any page this claim has already accepted: by naming it or its outlet
as its source, by quoting it, or by repeating its sentences. Agreement is explicitly not derivation ("even
where it agrees with an ACCEPTED page"), so two honest reporters who saw the same thing both count.

**Both orders.** Stance is asked with the claim first and with the page first. Independence is asked with
CLAIM, SOURCE, ACCEPTED_1..n, and with the exact reverse, so the accepted pages also swap order. A reader
swayed by position answers differently when the order flips and lands on `U`. The combine rule is
two-of-two per question: no majority, no tolerance.

**The first source is not asked about independence.** Nothing has been accepted, so there is nothing to be
derived from; asking would show the model an empty list and invite a guess. The letter `-` says so, and the
contract checks the letter against whether the question was asked (`_clean_value`).

**Unreadable is unsettled.** An answer counts only as one of its question's three words under `"answer"` in a
JSON object. Anything else is `""`, which can never make two orders agree.

## 3. The page

Fetched once by every validator itself, with `gl.nondet.web.get`; the body judged is the body of the answer
whose status was read. Tags removed, script and style text dropped, whitespace collapsed, 4,000 characters
judged. A 4xx and an empty page are `[EXTERNAL]`: every honest node sees the same answer, agrees on the
failure, and the transaction ends with an error that stores nothing. A network failure or a 5xx is
`[TRANSIENT]`; validators that also fail agree to fail. Nothing is stored in either case and the address may be
offered again, because nothing was judged.

The demo pages live in `pages/` and are read from `raw.githubusercontent.com` pinned to one commit, so the
bytes cannot move while validators read them.

## 4. The prompt

Every untrusted string, the claim, the page and each accepted page's opening, goes through `_block`, which
fences it (`<` and `>` replaced by `(` and `)`, never deleted, so the length is kept) and puts it between
delimiter lines tagged with the start of the sha256 of the fenced body. A body cannot carry its own closing
line (the tag depends on every byte of it) and cannot carry anybody else's (it holds no angle bracket). Labels
are the contract's own: `CLAIM`, `SOURCE`, `ACCEPTED_1` to `ACCEPTED_4`. The boundary is declared before the
first block. No address, amount, id, party or clock reaches the model; a test sends a full round and searches
every prompt for them.

## 5. The money

**Credit, not value, in the judged call.** `submit` is not payable: the bond comes from credit and settles in
the same call, and no value leaves the contract there. A round that fails stores nothing and takes nothing.
The only transfers are `withdraw` and the refund of a refused payable call.

**Payable calls never run the model and never raise.** Value sent with a call that raises is not returned on
GenLayer, so `open_claim` and `deposit` refuse by returning `ok: false` and sending the value back with
`gl.chain.Account(sender).emit_transfer(value)`. A static test checks that neither contains a raise, `_fail`,
`_clock`, `_known` or the round.

| outcome | contributor's credit | desk's credit | bounty |
|---|---|---|---|
| accepted | + share | | - share |
| derivative | - bond | + bond | |
| not supporting | - bond | + bond | |
| copy | - bond | + bond | |
| contradicting | | | |
| unsettled | - bond / 10 | + bond / 10 | |
| k-th accepted | | + the rest | - the rest |
| expire | | + the rest | - the rest |

**Why a contradicting page keeps its bond and earns nothing.** Contradiction is information the desk wants on
the record: the claim's `contested` count is public and travels with the verdict. Taking the bond would
punish a contributor for telling the desk something true about the evidence. Paying a share would let anyone
drain the bounty that corroborating sources are owed, by offering pages that disagree. So it costs only the
transaction fee, and it is read once like every other address.

**Why unsettled costs a tenth.** An address that reads `U` costs the network a full round. A tenth of the bond
to the desk keeps junk offers from being free while leaving an honest contributor, whose page met an
ambiguous model, most of its stake.

**Why forfeits go to the desk and not into the bounty.** Shares are fixed at opening (`bounty // k`); adding
forfeits to the pool would change what the k-th source is owed after the first k - 1 were paid. The desk paid
the bounty and bears the noise; the forfeits are its compensation. The integer remainder of `bounty // k` goes
back to the desk at close.

## 6. Once only

- **An address is read once per claim, whatever it read as.** A refusal before the round names the earlier
  reading. No outcome can be re-rolled by asking again.
- **The same text under another address is a copy.** The fingerprint is checked after the round; a match with
  any earlier reading of the claim sends the bond to the desk, so a mirror cannot re-roll an unsettled page or
  count an accepted one twice. The earlier reading stays the page of record.
- **One accepted source per address per claim.** An address that already holds one is refused before the
  round. Addresses are free, so this stops casual farming, not a determined one; the independence question is
  what stops one story counting k times, and it does not care who offers the page.

## 7. Bounds

Every loop runs over a constant: `range(min(accepted, MAX_K - 1))` for the accepted leads, the same bound in
`_asking`, one page of 20 rows in every list view (5 in `accepted_of`), and string walks capped by the size
caps. Nothing walks the claims or the sources. Closing a claim, by the k-th source or by `expire`, touches one
row. A static test fails on any loop it does not recognise.

## 8. The doors

The claim is printable ASCII on one line, 20 to 300 characters. Each prefix of the source rule is `https://` alone
or a lowercase host and a path ending in `/`, at most 120 characters. A source address is https, a lowercase host
with a dot, a path, no query, fragment, port, percent sign, empty, `.` or `..` segment, at most 200
characters, and must be strictly longer than the prefix it starts with. k is 2 to 5, the bond 0.01 to 10 GEN,
the window 600 seconds to 30 days, the bounty at most 100 GEN with every share at least 0.01 GEN.

**The source rule is a list.** Whoever controls a page controls what it says, so a rule of `https://` lets a
contributor write k pages that do not cite each other and collect every share. The rule is therefore one to
six prefixes, separated by commas, each checked like an address and none twice: a desk lists the outlets it
trusts, and a source must lie strictly under one of them. `https://` alone stays possible for low stakes, and
`rules()` says what it costs.

## 9. Measured on the v0.4 tooling (25 November 2026)

- **Runner and API.** `# v0.4.0` + `py-genlayer:kzybg95x…` with `import genlayer as gl`,
  `gl.contract.Contract`, `gl.storage.allow`, `TreeMap` from `genlayer.storage`, plain ints in storage,
  `gl.vm.run_nondet`, `UserError.data`, `gl.chain.Account(addr).emit_transfer(value)`: deployed and ran on
  Studio. The clock is `gl.message.raw["datetime"]`; v0.4 has no `gl.message_raw`. A view read on Studio also
  carried a datetime.
- **Linter.** `genvm-linter` 0.11.1rc2 (`genvm-lint check`) downloads the newest genvm-manager release when
  none is named: v0.6.0-rc17 on the day, while Studio pins v0.6.0-rc14; the kzybg runner is in both. It
  reports E014 ("needs @allow_storage decorator") on both `@gl.storage.allow` dataclasses and exits 1, with
  validation passing: the false positive the `genvm-lint` skill describes. No other finding.
- **Direct mode.** `genlayer-test` 0.30.0 with `GENVM_VERSION=v0.6.0-rc14` loads the contract in the real SDK;
  `mock_llm` needs the extra `json.dumps` the skill describes; `run_validator()` replays the captured
  validator and returns False when the page mock changes. Running it creates an empty `artifacts/` folder in
  the working directory (git-ignored here).
- **Fees.** `estimateTransactionFees()` (genlayer-js 2.0.0) quoted a deposit of 0.100000000000010352 GEN
  (100 leader and 200 validator time units, an execution budget of 0.025 GEN per round). A simple payable
  call was charged about 0.000126 GEN and the rest of the deposit came back in the same transaction.
  `estimateTransactionFeesForWrite` failed with "execution failed" for a payable call that carried value, and
  worked for a `submit`, quoting a far smaller deposit (0.0004 GEN) from a simulation. The smoke uses the
  generic quote for every transaction, so a round that runs longer than one simulation is still covered.
- **Receipts.** `eth_getTransactionByHash` carries `status` (`FINALIZED`), `txExecutionResultName`
  (`FINISHED_WITH_RETURN` or `FINISHED_WITH_ERROR`), `result_name` (`MAJORITY_AGREE`), `fees.deposit` and
  `fees.consumed`. A `UserError` ends as `FINISHED_WITH_ERROR` with its text in the leader receipt.
- **A refused payable call.** Measured on Studio: the value came back by `emit_transfer` in the same
  transaction and the sender's balance moved by the fee alone.
- **One round on Studio before the demo.** A dry run of this contract against a page pinned elsewhere read
  `S-`, 3 agree and 2 idle, 5 leader and 11 validator time units, about 0.00008 GEN.

## 10. Not verified

- How the independence question behaves on pages much longer than the demo pages, where an accepted page's
  first 1,200 characters may be navigation rather than reporting.
- Behaviour with four accepted sources' leads in one prompt on Studio (k = 5, about 9,000 characters of
  blocks); the demo shows at most two.
- Appeals: the run does not appeal any round.
