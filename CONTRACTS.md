# Contracts

One file. `contracts/corroborate.py`, class `Corroborate`, is the contract. It targets GenVM v0.4
(`# v0.4.0`, runner `py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0`), the runner Studio
v0.123 ships.

## Corroborate

### Purpose

The two-source rule, made enforceable. A desk opens a claim, one factual sentence, and says how many
independent sources it needs (k, 2 to 5), what each source stakes (the bond), how long the claim stays open,
and which addresses count as sources (one to six prefixes, such as the outlets it trusts, or `https://` for
any page). The bounty sent with
the call is cut into k equal shares. Contributors offer one page at a time. The network reads each page and
decides whether it states the claim and whether it took it from a source the claim has already accepted. The
claim is corroborated only when k pages have been accepted, each independent of the ones before it.

### Consensus

One round, `_judge(claim, url, leads)`, run only in `submit()`, which takes no value. It is one
`gl.vm.run_nondet(leader_fn, validator_fn)` block. The leader closure:

1. `got = gl.nondet.web.get(url)`. A raise is `[TRANSIENT] the page could not be fetched`; a 4xx is
   `[EXTERNAL] the page answered with status N`; any other status outside 200 to 299 is `[TRANSIENT]`. The body
   judged is the body of that same answer.
2. `page = _page_text(_visible(_decoded(body)))`: the first 128,000 bytes read as UTF-8 with replacement, the
   first 32,000 characters walked for tags (each tag a space, the text after a `script` or `style` tag
   dropped), whitespace collapsed, the first 4,000 characters kept. Empty is `[EXTERNAL] the page reads as
   nothing`.
3. STANCE, asked twice: CLAIM then SOURCE, and SOURCE then CLAIM.
4. INDEPENDENCE, asked twice, only when the claim already has accepted sources: CLAIM, SOURCE, then
   `ACCEPTED_1..n` oldest first, and the exact reverse. Each `ACCEPTED_i` block is the first 1,200 characters
   of an accepted page's judged text.
5. A model failure is `[LLM_ERROR]`. The value returned is
   `{"mask": <stance letter><independence letter>, "fp": <16 hex of sha256(page)>, "lead": page[:1200]}`.

The validator (`_agrees`) always does the whole task itself inside `try`, and:

- against a leader that returned, agrees only if its own value is equal, mask, fingerprint and lead;
- against a leader that failed, agrees only to fail the same way: the same `[EXPECTED]` or `[EXTERNAL]` text
  exactly, or `[TRANSIENT]` on both sides. It never agrees with `[LLM_ERROR]`, and never when its own rerun
  succeeds or raises anything else.

A failed round stores nothing and takes no credit; `run_nondet` re-raises the leader's error once the
validators agree with it.

| letter | stance (both orders) | independence (both orders) |
|---|---|---|
| S / I | `supports` twice | `independent` twice |
| C / D | `contradicts` twice | `derivative` twice |
| N | `neither` twice | |
| U | anything else, an unreadable answer included | anything else |
| - | | not asked: nothing accepted yet |

The outcome is code over the mask: S with I or `-` accepted, S with D derivative, N not supporting, C
contradicting, anything else unsettled. A fingerprint the claim has already read, under any address, is a
copy, whatever the mask.

### State

- `claim_rows: TreeMap[str, Claim]`: `K1`, `K2`, ... Scalars only: desk, text, k, bond, bounty, share, prefix,
  opened_at, deadline, status (`open`, `corroborated`, `expired`), left, the count of each outcome, to_desk,
  returned, closed_at.
- `source_rows: TreeMap[str, Source]`: `S1`, `S2`, ... one per reading: claim, contributor, url, outcome, mask,
  fp, lead (kept for accepted sources only), slot (1..k for accepted, else 0), bond, share, to_desk, at.
- `read_urls` (`K|url`), `seen_fps` (`K|fp`), `accepted_by` (`K|address`): the three once-only indexes.
- `index` and `counts`: append-only numbered lists (`claim:K`, `accepted:K`, `desk:addr`, `by:addr`).
- `balances`: credit per lower-case address. Totals: `bounties_held`, `credit_total`, and counters for
  `stats()`.

### Key methods

| method | who | what |
|---|---|---|
| `open_claim(claim, k, bond, window_seconds, source_prefix)` payable | anyone; becomes the desk | value is the bounty; refusals return the value, never raise, no model |
| `deposit()` payable | anyone | adds to its own credit; never raises |
| `withdraw()` | anyone | pays out all of its own credit |
| `submit(claim_id, source_url)` | anyone but the desk, while open and in the window | one consensus round; bond from credit; settles in the same call |
| `expire(claim_id)` | anyone, after the window | the rest of the bounty to the desk's credit |
| `claim`, `claims`, `claims_of`, `sources_of`, `accepted_of`, `sources_by`, `source`, `credit`, `stats`, `rules` | views | every list pages at 20 rows; `accepted_of` at 5 |

### Reuse

The pattern carries to any "k independent X" rule: k reviews of a paper that do not share authors' wording,
k eyewitness reports, k bug reproductions from different reporters. Change the stance question and keep the
independence question, which is the part that is hard: it is asked against the accepted set, so each new
item must be independent of everything already counted, not of one fixed original. A consumer that needs the
verdict reads `claim(id)`: `status == "corroborated"`, `accepted == k`, and `contested` for how many offered
pages contradicted it on the record.

### Note

The network decides whether a page states the claim and whether it took it from an accepted page. It does not
decide whether the claim is true, and addresses are free, so the defence against one story counting twice is
the independence question, not identity. See the README's limits.
