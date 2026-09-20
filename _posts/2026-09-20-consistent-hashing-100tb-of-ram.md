---
layout: post
title: "Consistent Hashing from Scratch, and Why Cloudflare Deleted 90% of It"
date: 2026-09-20
description: "I built a consistent-hash ring in 40 lines of Python and measured everything — load imbalance, 32-bit collisions, what moves when a server dies — to understand how Cloudflare recovered ~100 TB of RAM by asking how much randomness they actually needed."
tags: systems distributed-systems
categories: systems
toc:
  sidebar: left
published: true
---

> _"What I cannot create, I do not understand."_ — Feynman

I read Cloudflare's [_Saving another 100TB of RAM with math (and Rust)_](https://blog.cloudflare.com/saving-100-tb-of-ram-with-math/) twice and came away with the uneasy feeling I get whenever I've read something rather than understood it. I could recite the shape of it — consistent hashing, too many virtual nodes, they cut them, 100 TB back — but I couldn't have told you _how many is too many_, or how you'd know. So I wrote the ring in 40 lines of Python with no dependencies, routed 200,000 keys through it, and measured everything. Every number below is either from that script or from Cloudflare's post, and I've marked which is which.

The punchline, for the impatient: the imbalance you're fighting shrinks like $$1/\sqrt{k}$$ in the number of positions per server, which means the 90,000th position is worth roughly a ten-thousandth of what the 10th was worth. Cloudflare was paying for those positions across a global fleet. That's the whole story, and you can watch it happen in a table.

---

## The setup, which takes one paragraph

You have a rack of cache servers and a stream of URLs. You want a given URL to land on the same server every time — not out of tidiness, but because a cache miss costs an origin fetch and a duplicated copy costs disk you paid for. Get it wrong and three servers each hold `/image/cat.jpg`, your effective cache is a third the size it should be, and your origin sees 3× the traffic. Cloudflare's version of this is routing by URL so a data center keeps one copy of a file instead of one per machine.

So: deterministic routing. That's the requirement. Consistent hashing is one answer.

---

## Build it: servers and requests on the same line

Here's the move that makes the whole thing click, and it took me embarrassingly long to internalize the first time I saw it: **hash the servers with the same function you hash the keys with, into the same space.**

Pretend our hash only emits `0..99`.

```text
hash("cat.jpg")   = 23
hash("movie.mp4") = 71
hash(Server A)    = 20
hash(Server B)    = 50
hash(Server C)    = 80
```

Servers and requests now live on one number line:

```text
0    20        50        80       99
|----A---------B---------C---------|
```

Routing rule: walk **left** from where the key landed, take the first server you hit.

```text
cat.jpg = 23

0    20  23    50        80       99
|----A---X-----B---------C---------|
          ↖ walk left → A
```

```text
movie.mp4 = 71

0    20        50    71    80       99
|----A---------B-----X-----C---------|
                      ↖ walk left → B
```

That's it. That is the entire lookup. There's no lookup table, no coordination, no gossip — every client that knows the server list computes the same answer independently.

### The wrap-around is an off-by-one

What about a key at `10`? Walk left and you fall off the line. So you wrap to the rightmost server:

```text
10 → C
```

which means C owns two stretches, `80..99` and `0..20`. Bend the line into a circle and they become one arc — which is why every diagram of this is a circle. But the circle is a **presentation choice, not an algorithm**. In code it's a sorted array, a binary search, and Python's negative indexing doing the wrap for free:

```python
import bisect

class Ring:
    def __init__(self, points):            # points: [(position, server), ...]
        points.sort()
        self.pos = [p for p, _ in points]
        self.own = [s for _, s in points]

    def lookup(self, key_hash):
        i = bisect.bisect_right(self.pos, key_hash)
        return self.own[i - 1]             # i == 0 wraps to the last point
```

`self.own[i - 1]` when `i == 0` gives `self.own[-1]`, the largest position. The ring was hiding in an off-by-one the whole time. I find that genuinely delightful.

---

## Measure it: one position per server is a catastrophe

Let's run it. 100 servers, 200,000 keys, one hash position each, BLAKE2b truncated to 32 bits:

```text
k=1:  min = 2 requests      max = 10,955 requests
```

One server got **2** requests. Another got **10,955**. Same hash function, same keys, same code — a 5,000× spread.

My first instinct was that I'd broken something. I hadn't. This is what a good hash function does when you only take 100 samples from it. The gaps between $$N$$ uniform random points aren't each $$1/N$$; they're roughly exponentially distributed, which means lots of tiny gaps and the occasional enormous one. Randomness at small $$N$$ is _lumpy_, and our intuition that "uniform hash → uniform load" quietly assumed a law of large numbers that we never actually invoked.

Here's the unlucky layout drawn out:

```text
0       A                                      B C
|-------|--------------------------------------|-|

A → 70% of requests
B → 10%
C → 20%
```

Nobody made a mistake here. This is the median outcome of the design.

---

## So quantify "lumpy"

Two numbers. The target first:

$$
\text{Expected} = \frac{1}{N}
$$

For 100 servers, 1%. That's not a result, it's the goal.

Then: how far from 1% does a typical server actually sit? That's the standard deviation, and for one position per server it works out to

$$
SD = \frac{1}{N}\sqrt{\frac{N-1}{N+1}} \;=\; \frac{1}{100}\sqrt{\frac{99}{101}} \;\approx\; 0.99\%
$$

Read those two side by side:

```text
target load  = 1.00%
typical miss = 0.99%
```

The noise is the size of the signal. A server at 0% and a server at 2% are both completely ordinary draws.

Dividing one by the other gives the number worth putting on a dashboard — the **coefficient of variation**, which is unitless and therefore comparable across fleet sizes:

$$
CV = \frac{SD}{\text{Expected}} \approx 99\%
$$

I'll keep using CV for the rest of the post. Mentally: _"how big is the randomness compared to what we were aiming for."_ At 99%, the answer is "as big."

---

## The fix: give every server many positions

Instead of one position per server, give each server $$k$$ of them, generated as `hash("server-7:0")`, `hash("server-7:1")`, and so on:

```text
A1 A2 A3 A4 A5
B1 B2 B3 B4 B5
C1 C2 C3 C4 C5
```

All of them go on the same ring:

```text
0    A1    B2  C1      A3      B1 C4     A2
|-----|-----|---|-------|-------|-|-------|
```

A's load is now a _sum_:

$$
\text{load}(A) = A_1 + A_2 + A_3 + A_4 + A_5
$$

Some of those slices come out too fat, some too thin, and they cancel. That cancellation is the whole mechanism — not "finer granularity," but "you're now averaging $$k$$ independent draws, and averages concentrate."

The candy version, which is the analogy I'll use once and then drop: throw candy into three bags and one kid gets 70%. Throw it into 300 tiny bags, 100 per kid, and everyone lands near 33%. Identical randomness, identical throwing. The only change is that each kid's total is a sum of many small independent things instead of one big one.

These extra positions are called **virtual nodes** (or vnodes, or replicas). Worth being clear about what they are: a statistical device, not a topology. There is no such thing as `A3` in your infrastructure. It's a number in an array that maps back to A.

### Measured, 100 servers, 200,000 keys

| $$k$$ | ring points | measured CV | predicted CV | min load | max load |
| ----: | ----------: | ----------: | -----------: | -------: | -------: |
|     1 |         100 |      96.86% |       99.00% |        2 |   10,955 |
|     2 |         200 |      79.91% |       70.18% |        2 |    8,510 |
|    10 |       1,000 |      31.17% |       31.45% |    1,012 |    3,645 |
|    50 |       5,000 |      13.70% |       14.07% |    1,462 |    2,717 |
|   160 |      16,000 |       8.09% |        7.87% |    1,540 |    2,386 |
|  1000 |     100,000 |       3.86% |        3.15% |    1,843 |    2,190 |

Ignore the CV column for a second and just read `min` and `max`. At $$k=1$$: 2 and 10,955. At $$k=160$$: 1,540 and 2,386. The entire fleet has moved inside a factor of 1.5 of each other, and all I did was generate more numbers from the same hash function.

(The 160 isn't arbitrary — it's NGINX's default for its consistent-hash balancer, and Pingora, Cloudflare's Rust proxy, inherited the same number. Hold that thought.)

### An honest aside about that last row

At $$k=1000$$ the measured CV is 3.86% but the formula says 3.15%. I stared at this for a while assuming collisions. It isn't collisions — it's my measurement.

200,000 keys over 100 servers is ~2,000 keys per server, and counting 2,000 random events has its own Poisson noise of about $$1/\sqrt{2000} = 2.2\%$$. Two independent sources of variance add in quadrature:

$$
\sqrt{3.15^2 + 2.24^2} = 3.86\%
$$

Which is exactly what I measured. So the ring is fine; my experiment has a noise floor, and at $$k=1000$$ I've pushed the ring's imbalance _below_ the resolution of the thing I'm measuring it with. That is its own kind of answer to "how many positions do I need," and I didn't expect to get it for free from a discrepancy I initially read as a bug.

---

## Servers aren't identical, so weights

Real fleets are archaeological:

```text
Server A → 1 TB disk
Server B → 2 TB disk
Server C → 10 TB disk
```

Equal shares would be actively wrong — A thrashes while C sits half empty. The Ketama-style answer is pleasingly dumb:

> more weight → proportionally more positions.

Measured, using 160 positions per unit of weight:

| server | weight | positions | target | measured |
| ------ | -----: | --------: | -----: | -------: |
| A      |      1 |       160 |  7.69% |    7.60% |
| B      |      2 |       320 | 15.38% |   15.86% |
| C      |     10 |     1,600 | 76.92% |   76.54% |

Weighting works, and the causal chain is clean:

```text
disk capacity → weight → position count → arc of the ring → share of requests
```

But look at the bottom line of that experiment:

```text
total ring points for THREE servers: 2,080
```

Two thousand entries for three machines. **Weighting doesn't redistribute a fixed budget of positions — it multiplies the budget.** The baseline is set by the _smallest_ server and the largest one drags the total up behind it. Cloudflare weights by disk capacity for cache; other workloads weight by cores or GPUs. The math doesn't care what the weight means, only that some servers are 10× others.

---

## And then it multiplies again

Servers have capabilities: PCI-compliant storage, a GPU, a particular cache tier, a region restriction. Requests have eligibility:

```text
request X needs PCI  →  eligible: {A, B, D}
request Y needs nothing →  eligible: {A, B, C, D, E}
```

You can't serve both from one ring, because a ring _is_ a server list. Different eligible sets need different rings, and eligible sets are subsets, so they multiply: $$2^{10} = 1{,}024$$, $$2^{20} \approx 10^6$$. In practice most combinations never occur — Cloudflare reports "dozens" of rings, not millions — but dozens of rings, each holding a weight-multiplied, 160×-inflated position list, is how you end up here:

```text
servers × weights × 160 × dozens of rings = millions of entries per process
```

Cloudflare measured PBR processes spending as much as **6 GB** on consistent-hashing structures. The index had become one of the larger tenants on the box.

Every multiplication was individually defensible. The 160 came from NGINX. The weights came from real disks. The rings came from real eligibility rules. Nobody was careless; the product just got expensive, and products of defensible decisions are exactly the kind of thing nobody re-audits.

---

## The question nobody had asked

Not "how do we compress the ring." This one:

> **How much randomness do we actually need?**

That has a numeric answer. For $$N$$ servers with $$k$$ positions each:

$$
\boxed{\;CV_k = \sqrt{\frac{N-1}{Nk+1}}\;}
$$

Don't memorize it — there are only two things in it. $$k$$ sits under a square root in the denominator, so **halving the error costs 4× the memory, forever**. And $$N$$ appears top and bottom, so a bigger fleet doesn't save you; balance is governed by $$k$$.

Sanity check at $$k=1$$, $$N=100$$: $$\sqrt{99/101} = 99\%$$, which is the one-position case from earlier. Good.

Now the part that made me sit up. Here's every doubling of $$k$$ and what it buys:

|  $$k$$ |     CV | memory/server (6 B entries) | gain over previous row |
| -----: | -----: | --------------------------: | ---------------------: |
|     10 | 31.45% |                     0.1 KiB |                      — |
|     20 | 22.24% |                     0.1 KiB |                9.21 pp |
|     40 | 15.73% |                     0.2 KiB |                6.51 pp |
|     80 | 11.12% |                     0.5 KiB |                4.61 pp |
|    160 |  7.87% |                     0.9 KiB |                3.26 pp |
|    320 |  5.56% |                     1.9 KiB |                2.30 pp |
|    640 |  3.93% |                     3.8 KiB |                1.63 pp |
|  1,280 |  2.78% |                     7.5 KiB |                1.15 pp |
|  2,560 |  1.97% |                    15.0 KiB |                0.81 pp |
|  5,120 |  1.39% |                    30.0 KiB |                0.58 pp |
| 10,240 |  0.98% |                    60.0 KiB |                0.41 pp |

Every row doubles the memory. The rightmost column — what you got for it — shrinks by a factor of $$\sqrt{2}$$ each time. It's a sponge: the first squeeze gets the water, and after that you're squeezing very hard for drops.

Nothing exotic is happening. Averaging $$k$$ independent things tightens them by $$\sqrt{k}$$ — same reason polling 4,000 people is only twice as precise as polling 1,000. It's the most universal cost curve in applied probability and here it is quietly setting a memory budget.

### Reproducing Cloudflare's number

Their post gives a concrete case: a base of 160 positions times a weighting factor of 625, so

$$
160 \times 625 = 100{,}000
$$

positions for one server. They say cutting that back cost about **0.7 percentage points** of accuracy. I plugged their setup into $$CV_k$$ at $$N=100$$:

```text
k = 100,000   CV = 0.315%   586 KiB/server
k =  10,000   CV = 0.995%    59 KiB/server
                ───────────
delta = 0.68 percentage points, for 90,000 fewer positions per server
```

0.68, against their stated 0.7. I don't know that $$N=100$$ is their fleet size — I'd guess the figure is fairly insensitive to it, since $$N$$ mostly cancels — but the reproduction landed close enough that I believe I'm looking at the same calculation they were. Which is the first moment in this whole exercise where the blog post stopped being a story about someone else's infrastructure and turned into something I could check.

That's the trade, stated as a ratio: **90,000 entries per server, per ring, for 0.68 points of balance that no dashboard was ever going to resolve.**

---

## Where the clean math stops being true

The formula assumes positions are drawn from a continuous space. They're not — Cloudflare uses 32-bit hashes, so there are $$2^{32} = 4{,}294{,}967{,}296$$ slots. Sounds infinite. It isn't, and the birthday paradox says you start seeing repeats around $$\sqrt{M}$$, which here is:

$$
\sqrt{2^{32}} = 65{,}536
$$

Sixty-five thousand. That's a _small_ ring. I measured it:

| points inserted |  distinct | collided | birthday prediction |
| --------------: | --------: | -------: | ------------------: |
|           1,000 |     1,000 |        0 |                   0 |
|          65,536 |    65,535 |        1 |                   0 |
|         500,000 |   499,953 |       47 |                  29 |
|       2,000,000 | 1,999,504 |      496 |                 466 |
|       8,000,000 | 7,992,514 |    7,486 |               7,446 |

At 8 million points, 7,486 of them landed on a position someone else already owned. Each one is an entry you allocated, sorted, and searched, that contributes exactly nothing to balance — a zero-width slice. 0.09% waste is not catastrophic on its own, but note which direction it points: you paid linearly for the entries and got sublinear benefit back, _and then_ lost a slice of even that.

So the tail of the curve is worse than diminishing returns:

```text
more positions
      ↓
gain shrinks as 1/√k
      +
memory grows linearly
      +
collisions claw back part of the gain
```

Cloudflare found the same thing empirically — past a certain density their measured error was worse than the ideal model predicted. Which is the kind of detail that only shows up if you go and measure the thing you already have a formula for.

---

## The two bytes that weren't data

Second change they made, and my favourite because it deletes nothing. A ring entry is a hash and a server index:

```text
hash  = 4 bytes
index = 2 bytes
        ────────
        6 bytes of actual information
```

What the compiler gives you:

```c
struct entry        { uint32_t hash; uint16_t idx; };
struct packed_entry { uint32_t hash; uint16_t idx; } __attribute__((packed));
```

```text
naive  sizeof=8  align=4
packed sizeof=6  align=1
array of 3: naive=24 packed=18 bytes
```

Eight bytes for six bytes of data. The struct's alignment is 4 (from the `uint32_t`), so its size gets rounded up to a multiple of 4 — and in an array of a hundred million of these, that trailing padding is 25% of your allocation holding nothing at all.

$$
\frac{8-6}{8} = 25\%
$$

A quarter of the structure recovered without removing a single entry. This is the "(and Rust)" half of Cloudflare's title, and I think it's underplayed there: the win isn't that Rust is fast, it's that you can control the layout and iterate a packed representation without giving up safety. You can do this in C too, of course — people just usually don't, because nothing in the profiler says "padding."

---

## The part that makes it _consistent_

Everything so far has been about balance. The name is about something else, and it's the reason this algorithm exists at all.

Naive routing is `server = hash(key) % len(servers)`. Take a server out and the modulus changes for every key. I measured both, 100 servers down to 99, 200,000 keys:

```text
consistent hashing: moved 2,154 / 200,000 = 1.08%   (the dead server owned 1.08%)
modulo hashing:     moved 198,016 / 200,000 = 99.01%
```

**99.01% versus 1.08%.** With modulo, losing one machine out of a hundred relocates essentially your entire keyspace — every relocated key is a cache miss, and every miss is an origin fetch. One machine dying stampedes your origin. With consistent hashing, the only keys that move are the ones the dead server owned, which is $$1/N$$, and my measured 1.08% is just that server's actual share.

```text
before:  A A B B C C D D A A B B
A dies:  · · B B C C D D · · B B
after:   D D B B C C D D C C B B
         ↑↑                 ↑↑
     only A's old regions changed hands
```

That's the property worth paying for. Adding capacity should be a Tuesday, not an incident.

---

## Reflections

Things that surprised me while doing this:

**The $$k=1$$ failure is much worse than "unbalanced."** I expected a 3–4× spread. I got 5,000×, from a hash function that is doing nothing wrong. I now think "uniformly random" and "uniform" are two words people let slide into each other, and the gap between them is this entire algorithm.

**The measurement floor was more instructive than the measurement.** Discovering that my 200k-key experiment couldn't resolve a $$k=1000$$ ring is, in practice, the same discovery Cloudflare made with a much bigger $$k$$ and much more expensive RAM. If your instrument can't see the improvement, neither can your SLO.

**Nobody in this story was careless.** 160 is a reasonable default. Weighting by disk is correct. Separate rings per eligibility set is correct. The bug, if you can call it that, was that four correct decisions were multiplied together and the product was never differentiated. I suspect this is the most common shape of large-scale waste — not bad code, just a constant that stopped being questioned once it had been inherited twice.

**The formula was cheap and I should have written it sooner.** $$CV_k$$ is one line of Python. I spent longer building the simulation than I would have spent deriving the answer, and the simulation's main value turned out to be confirming the formula rather than replacing it.

---

## Where this goes if you keep pulling

The thing I keep turning over is that this exact analysis has an inverse, and the inverse applies to almost everyone reading it. If your ring holds 16,000 entries it occupies 96 KB packed, and you should never think about it again — the correct move at small scale is to _not_ build the weighted multi-ring machinery, because the same math that says Cloudflare was overpaying says you'd be overpaying harder for a problem you don't have. Same curve, opposite conclusion, and the only thing that decides which end of it you're on is the multiplier in front. That deserves its own post.

Some threads I didn't chase, left as exercises:

- **Rendezvous (HRW) hashing** drops the ring entirely — score every server per key, take the max. Excellent balance, $$O(N)$$ per lookup instead of $$O(\log Nk)$$, so it wins at small $$N$$. Worth measuring against the table above.
- **Consistent hashing with bounded loads** (Mirrokni et al.) adds a capacity cap and forwards overflow, which gets you a hard guarantee instead of a statistical one.
- **Jump consistent hash** (Lamping & Veach) needs no ring and no memory at all — 5 lines, perfect balance — but can't do weights or arbitrary removals. The constraints are the interesting part.
- Rerun my tables with 64-bit hashes and watch the collision column go to zero, then ask whether 8-byte entries were worth it.

The code is all in this post; it's ~40 lines and imports nothing. If you only do one thing, do the $$k=1$$ run and look at the min and max. I don't think you get that number until you print it yourself.

---

**Sources.** Cloudflare, [_Saving another 100TB of RAM with math (and Rust)_](https://blog.cloudflare.com/saving-100-tb-of-ram-with-math/). Theirs: the 160/625 example and its 0.7 percentage points, the ~90% reduction, the 6 GB PBR processes, the dozens of rings, the 25% struct saving, and the ~100 TB total. Mine: every table of measurements, the $$CV_k$$ reproductions, the collision counts, the C layout output, and the failure-mode experiment.
