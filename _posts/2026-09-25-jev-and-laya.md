---
layout: post
title: "Teaching a Model to Answer Instead of Talk"
date: 2026-09-25
description: "Jev, Laya, and a weekend spent building a UI for a category of model I didn't know existed — typed-decision models that skip generation entirely and hand back a calibrated probability instead."
tags: llm ai-engineering
categories: ai
toc:
  sidebar: left
published: true
---

*Jev, Laya, and a weekend spent building a UI for a category of model I didn't know existed*

I've spent most of the last few years assuming "using an LLM in production" meant one thing: send a prompt, get a stream of tokens back, parse whatever JSON-shaped debris falls out of `generateObject`, and hope the schema validator doesn't throw. That's been true enough, often enough, that I stopped questioning it.

Then I tried to wire up a model called Jev and got this back from the API:

```
Model 'typesafe-ai/jev' is an evaluation model, not a language model.
Use the evaluation generation API instead.
```

Not a language model. I stared at that for a second longer than I'd like to admit, because the whole mental model I'd built — prompt in, tokens out, coerce into JSON — turned out to not apply here at all. That error message is the actual subject of this post.

## The primitive: state in, typed answer out

Jev (from a company called TypeSafe AI) and an open-source project called Laya both belong to a small, newish category people are calling "System 1" models — as in Kahneman's fast, intuitive System 1, as opposed to the slow, deliberate System 2 that a chat model doing chain-of-thought is trying to emulate. The pitch, as far as I can tell, is: most of what we use big autoregressive models for in production isn't really generation. It's classification. Routing. Scoring. Yes-or-no. We just don't have a native primitive for "answer one typed question about this input" so we reach for the sledgehammer that also happens to write poetry.

Jev and Laya give you that primitive directly. You hand the model two things:

- **state** — a string, a JSON object, or an array. An HTTP request, a support ticket, a login event, whatever.
- **questions** — a map of typed judgments to make about that state.

Three question types, and only three:

- **choice** — pick one option out of a named set
- **score** — rate the state against an ordered scale
- **boolean** — estimate the probability that something is true

No temperature, no system prompt, no max tokens, no free text out. You get back a calibrated probability distribution and, for score, a probability-weighted number that can legitimately land between two defined levels (2.86 on a 0-3 scale, say, because the model wasn't fully sure between "high" and "critical"). That's the whole interface. It's small enough that I initially assumed I was missing something.

The mechanical difference from an autoregressive model matters more than it sounds like on paper. Laya, the open one, runs on a ModernBERT-large backbone (~421M parameters, per the project's own numbers) and does a single forward pass per question — no decoding loop, no next-token sampling, no stopping condition to get wrong. Published numbers are around 33ms for one question and about 7.2ms per question when you batch them, measured on a T4. That's not "fast LLM inference," that's a different computational shape entirely. It's the difference between reading a paragraph and immediately stamping a verdict on it, versus reading the paragraph and then writing a second paragraph, one word at a time, that happens to end in a verdict.

## Where my mental model was wrong

Here's the part I actually want to walk through, because it's the useful bit.

My first pass at wiring Jev into a Next.js app did the thing you'd naturally do: define a Zod schema for the expected answer shape, call `generateObject({ model: 'typesafe-ai/jev', schema, prompt })`, and let the AI SDK coerce the model's output into that schema. This is the standard move for getting structured output out of a normal chat model, and I'd used it a dozen times before without incident.

It failed immediately, with the error at the top of this post. Not a language model. It turns out Jev isn't reachable through the generation surface at all — it's a distinct model class in the AI SDK, gated behind a function called `experimental_evaluate`, which didn't even exist in the version of `ai` I had installed (`5.0.265`). I had to bump to `ai@7` before the function showed up.

Once I did, the actual request/response contract turned out to be nothing like what I'd guessed from the question types. I'd assumed, reasonably I thought, that a `score` question would take an array of `{ position, label, description }` objects, because that's how you'd model an ordered scale if you were designing the schema from scratch. The real contract is an ordered array of plain strings — the position *is* the array index:

```ts
questions: {
  severity: {
    type: 'score',
    instructions: 'How severe is this event?',
    criteria: ['low', 'medium', 'high', 'critical'], // index = position
  },
}
```

And `choice`, which I'd modeled as an array of `{ id, description }` pairs (so the UI could reorder and drag-and-drop them), is actually a flat record on the wire:

```ts
questions: {
  department: {
    type: 'choice',
    instructions: 'Which team should handle this ticket?',
    criteria: {
      billing: 'Charges, invoices, and refunds',
      technical: 'Bugs, outages, integration failures',
    },
  },
}
```

Neither of these is a big design decision on TypeSafe's part — they're both perfectly sensible shapes. They just weren't the shape I'd have guessed, and there wasn't a lot of prior art to check my guess against, because this API surface is genuinely new. I ended up keeping the array-based shape in my own UI layer, because it's nicer for a drag-to-reorder question builder, and converting to the wire format server-side, in one function, right before the call. That conversion function is maybe twenty lines, and it's the only place in the codebase that needs to know the real contract exists. Small price for guessing wrong once.

The response side has the same "simpler than expected once you see it" quality:

```json
{
  "department": {
    "type": "choice",
    "choice": "technical",
    "probabilities": { "billing": 0.08, "technical": 0.91, "account": 0.01 }
  },
  "severity": {
    "type": "score",
    "score": 2.86,
    "probabilities": { "0": 0, "1": 0.02, "2": 0.1, "3": 0.88 }
  },
  "requestsRefund": { "type": "boolean", "probability": 0.97 }
}
```

No `confidence` field, notably — I'd assumed one would exist, the way you'd want a softmax-max as a scalar confidence, but the API just gives you the raw distribution and expects you to derive whatever scalar you want from it. Fair enough. I compute `max(probabilities)` for choice and score, and `max(p, 1-p)` for boolean, and call that confidence, which is an honest thing to call it because that's literally what it is.

## The numbers, such as they are

My own measured average, hitting Jev through Vercel's AI Gateway from a Next.js API route, is around 150ms end to end — that includes the network hop, so the actual model-side latency is presumably a decent chunk lower. I don't have a controlled benchmark here, just a stopwatch on a side project, so take that as "roughly what I saw," not a number to cite.

Cost-wise, Jev is priced at around $40 per billion tokens (not million — I had to read that twice). For a typed-decision workload where the input is a support ticket or an HTTP request and the output is a handful of probabilities, that's an enormous number of evaluations for not a lot of money. I'm genuinely unsure how that compares to running the equivalent classification through a general-purpose chat model with structured output, because I haven't run that comparison side by side, but the shape of the pricing — tokens in, no tokens generated out to speak of — suggests it should be meaningfully cheaper, and the latency numbers back that intuition up.

Where this gets interesting to me, and where I want to be careful not to overclaim, is the comparison to how a lot of existing security tooling works: a rule engine walking a signature database, a WAF matching a request against a large ruleset, a SIEM correlation rule chewing through parsed fields. That's a pipeline shape of *raw input → parser → ruleset → verdict*, and every new attack pattern means writing (and testing, and maintaining) a new rule. The typed-decision model gives you a different pipeline: *raw input → semantic understanding → structured decision*, where "semantic understanding" is whatever the model learned, not whatever a human encoded as a regex.

I want to be honest that I have not proven this generalizes. I've run it against a handful of synthetic and semi-synthetic examples, not a production security pipeline with adversarial pressure on it, and calibration under adversarial pressure specifically — can someone craft an input that reliably fools the probability distribution? — is exactly the kind of question I can't answer from a weekend of poking at it. It's early. But the pipeline shape is different enough, and the cost/latency numbers are favorable enough, that it feels worth more than a shrug.

## Building a UI for the primitive, not a chat window

The thing I actually built this session is called Jev Studio — a small Next.js/TypeScript app whose entire design premise is refusing to look like a chatbot. There's no message thread, no streaming text, no "thinking..." animation. The interface is, deliberately, just the three things Jev cares about: state, questions, structured decision.

The state panel takes text, JSON, or an array, and shows you a live byte count against the 32KB request limit the Gateway enforces. The question builder lets you compose choice/score/boolean questions visually — add options, reorder score levels, write the TRUE/FALSE criteria for a boolean — and validates as you go (a choice question with duplicate option IDs, or a score question with fewer than two levels, gets flagged before you can run it). There's a raw JSON mode for people who'd rather write the payload by hand, a request/response inspector so you can see exactly what got sent and what came back, and a settings page that lets you paste in a Gateway API key which gets written server-side to `.env.local` and never touches the browser — the usual don't-ship-secrets-to-the-client discipline, just made a first-class settings flow instead of a README instruction.

None of that is novel engineering. What made it worth doing was that building the UI forced me to actually internalize the primitive — choice, score, boolean, nothing else — instead of nodding along to a docs page and assuming I understood it.

## Four use cases, worked through

The templates I ended up shipping in Jev Studio are the ones I kept reaching for while testing, so here they are as actual state-in/answer-out examples rather than abstractions.

**Security event triage.** Feed it a suspicious-looking request:

```json
{
  "method": "POST",
  "path": "/api/user",
  "body": { "id": "1 OR 1=1" }
}
```

with three questions — `attack_type` (choice: normal / sql_injection / xss / ssrf / other), `severity` (score: low → critical), `likely_malicious` (boolean) — and you get back, in one round trip, a full triage: which attack category, how bad, and a calibrated probability that it's malicious at all, rather than a single opaque score you have to reverse-engineer.

**Auth anomaly / account takeover.** This one I find genuinely more interesting than the SQLi example, because the signal is behavioral rather than syntactic — there's no regex for "this login is weird":

```json
{
  "event": "login_success",
  "ip": "185.220.101.7",
  "geo": "Unknown (Tor exit node)",
  "previous_geo": "Austin, TX, US",
  "time_since_last_login_minutes": 4,
  "failed_attempts_last_hour": 11,
  "new_device": true
}
```

`attack_pattern` (choice: normal / credential_stuffing / brute_force / impossible_travel / session_hijack), `takeover_risk` (score: unlikely → near-certain), `should_force_reauth` (boolean, with explicit TRUE/FALSE criteria so the model knows what threshold you actually care about). A rule-based version of this exists too, obviously — geo-velocity checks are a known pattern — but it's usually five or six separate rules that each fire independently and need to be stitched together downstream. Here it's one call, one coherent judgment.

**Support ticket routing**, the boring-but-real workhorse case: `department` (choice: billing / technical / account / other), `urgency` (score), `needs_human_review` (boolean) — all three answered against the same ticket text in a single request, because that's the whole point of typed multi-question evaluation: one state, several independent judgments, evaluated together instead of three separate model calls.

**Verification / workflow gating.** Less flashy, arguably more useful day to day:

```
Task: migrate the billing service to the new database.
Evidence: migration script ran successfully, all rows verified, old table archived.
```

with `is_complete` (boolean) and `confidence_review` (boolean, "does this need a human before closing"). This is the pattern I'd reach for before letting an agent close out a task automatically — not because the model's yes/no is infallible, but because it's a probability, not an assertion, and you can set your own threshold for what "confident enough to auto-close" means.

## Where I'm still uncertain

A few things I don't have good answers to yet, stated plainly rather than hedged into mush:

- **Calibration under pressure.** All my testing has been cooperative — I'm not trying to fool the model. Whether the probability distributions stay honest against inputs deliberately crafted to look benign is an open question I haven't tested.
- **Where the ceiling is.** Jev's own architecture isn't public, so I can't reason about its failure modes the way I can reason about a transformer I can actually read the weights of. Laya's is open, and people are already fine-tuning it into narrower verticals, which is the direction I'd bet on for anything safety-critical — you want to be able to inspect what you're trusting.
- **Whether "replace the rule engine" is even the right framing**, versus "add a second signal next to the rule engine and see where they disagree." My instinct, for anything where a false negative is expensive, is the latter — run both, and treat disagreement as the interesting case, not as a decision to make unilaterally.

I don't think any of that undercuts the core observation, which is that the pipeline shape — one forward pass, a typed question, a calibrated number back — is a real primitive that a lot of what currently gets built as regex and rule graphs could plausibly be rebuilt on top of. I just don't have enough hours logged against it yet to say more than "plausibly."

## What's next

I left Jev Studio open source specifically so other people can point it at their own use case and tell me where it breaks — that's more useful to me than anything else I could do with it right now. If you build a use case I haven't thought of, or find a place where the calibration falls apart, I'd genuinely like to know.

For now: still early, still poking at it, and still a little bit delighted that "not a language model" turned out to be the interesting sentence in the whole error log.
