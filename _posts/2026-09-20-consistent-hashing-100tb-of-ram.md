---
layout: post
title: "A Number Line, 100 TB of RAM, and the Square Root That Saved It"
date: 2026-09-20
description: "Consistent hashing explained from zero — number line, virtual nodes, weights, and the coefficient of variation — then a walk through how Cloudflare used that math to cut ~90% of its hash-ring entries and recover roughly 100 TB of RAM globally."
tags: systems distributed-systems
categories: systems
toc:
  sidebar: left
published: true
---

> **TL;DR** — Consistent hashing puts servers and requests on the same number line and sends each request to the nearest server on its left. Random placement makes that unfair, so you give each server many positions and let the randomness average out. The imbalance shrinks like $$1/\sqrt{k}$$ in the number of positions per server — which means past a few hundred positions you are buying almost nothing and paying full price in RAM. Cloudflare noticed, cut roughly 90% of its ring entries, compacted the struct from 8 bytes to 6, and got back about **100 TB of RAM** across its fleet. ([Cloudflare blog](https://blog.cloudflare.com/saving-100-tb-of-ram-with-math/))

---

## Key takeaways

- **The algorithm is one sentence.** Hash the key, hash the servers, walk left, wrap around at the end. Everything else is bookkeeping.
- **One hash per server is badly unbalanced.** For 100 servers, the coefficient of variation of the load is about **99%** — the noise is the same size as the signal.
- **Virtual nodes fix it statistically, not structurally.** $$k$$ positions per server gives $$CV_k=\sqrt{(N-1)/(Nk+1)}$$. At $$k=160$$ and $$N=100$$ that's ~8%.
- **Square root means diminishing returns.** 2× better balance costs 4× the memory. 10× better costs 100×.
- **At scale the tail of that curve is a bill.** Cloudflare's weighting pushed some servers toward 100,000 positions; the last 90,000 of them bought about 0.7 percentage points of accuracy.
- **Finite hashes bite back.** With 32-bit hashes and millions of points, collisions make the real error _worse_ than the ideal formula predicts. More points eventually hurt twice.

---

## Why I wanted to write this down

The Cloudflare post is titled _"Saving another 100TB of RAM with math (and Rust)"_ and I think the title undersells it. It reads like a math lesson but it is really a distributed-systems story, and the interesting part is not the formula — it is the **question** they asked. Not "how do we make the ring smaller" but "how much randomness do we actually need?" That is a different kind of question and it has a numeric answer.

So let's rebuild the whole thing from zero. No scary math. We will earn every formula.

---

## 1. Forget the math. Start with three servers.

You have three servers:

```text
Server A
Server B
Server C
```

And a stream of cache requests:

```text
/image/cat.jpg
/video/movie.mp4
/css/style.css
/api/user/123
```

You want the **same request to land on the same server every time**. Not because of elegance — because of disk.

Suppose `/image/cat.jpg` goes to Server B. B fetches it from origin and caches it. Next request for the same URL:

```text
good:                       bad:
req 1 → B → cache hit       req 1 → B → MISS, fetch, store
req 2 → B → cache hit       req 2 → A → MISS, fetch, store
req 3 → B → cache hit       req 3 → C → MISS, fetch, store
```

In the bad column you now hold three copies of one file, you burned three origin fetches, and your effective cache size just got divided by three. Cloudflare describes exactly this motivation: route by URL so a data center keeps **one** copy of a file rather than scattering copies across every machine in the rack.

Deterministic routing is the requirement. Consistent hashing is one way to get it.

---

## 2. The naive version: plain hashing

Take a hash function. For teaching purposes, pretend it only produces numbers `0..99`:

```text
hash("cat.jpg")   = 23
hash("movie.mp4") = 71
hash("style.css") = 42
```

Here is the trick that makes consistent hashing click: **hash the servers with the same function into the same space.**

```text
hash(Server A) = 20
hash(Server B) = 50
hash(Server C) = 80
```

Now servers and requests live on one number line:

```text
0    20        50        80       99
|----A---------B---------C---------|
```

Route a request by walking **left** from where it lands, to the first server you meet.

```text
cat.jpg = 23

0    20  23    50        80       99
|----A---X-----B---------C---------|
          ↖ walk left → A

23 → A
```

```text
movie.mp4 = 71

0    20        50    71    80       99
|----A---------B-----X-----C---------|
                      ↖ walk left → B

71 → B
```

And `90 → C`. That's it. That is the entire lookup.

---

## 3. Why everyone draws a circle

Because after 99 comes 0.

```text
0 -------------------- 99
^                       |
|_______________________|
```

Take the request `10`. Walk left. There is no server to its left — you run off the edge of the line. So you wrap around to the largest server position, which is C at 80:

```text
10 → C
```

Which means C owns two disjoint stretches:

```text
C owns: 80 → 99  and  0 → 20
```

Bend the line into a circle and those two stretches become one arc. That is the "ring" in consistent hashing, and honestly the circle is a **presentation choice, not an algorithmic one**. The number line plus a wrap rule is easier to hold in your head, and it is what the code actually does — a sorted array and a binary search that falls back to index 0.

Here is the whole lookup in ten lines:

```python
import bisect

class Ring:
    def __init__(self, points):
        # points: list of (hash_position, server_name)
        points.sort()
        self.positions = [p for p, _ in points]
        self.owners    = [s for _, s in points]

    def lookup(self, key_hash):
        # index of the first position greater than key_hash
        i = bisect.bisect_right(self.positions, key_hash)
        # step left to the owner; i == 0 wraps to the last point
        return self.owners[i - 1]
```

That `i - 1` with Python's negative indexing _is_ the wrap-around. The circle was hiding in an off-by-one the whole time.

---

## 4. Now the actual problem

Look at a lucky layout:

```text
0          20                       50  80       99
|----------A------------------------B---C--------|
```

Shares are roughly A=30%, B=30%, C=40%. Acceptable.

Now an unlucky one:

```text
0       A                                      B C
|-------|--------------------------------------|-|
```

```text
A → 70% of requests
B → 10%
C → 20%
```

A is on fire. B is idle. And here is the part people get wrong: **this is not a bad hash function.** A perfectly uniform hash function produces this. Uniformly random points on a line naturally produce wildly uneven gaps — that is what randomness looks like up close. The gaps between $$N$$ uniform random points are not each $$1/N$$; they are exponentially distributed, which means lots of small ones and occasional huge ones.

So we need to quantify "how uneven, typically?" That is where probability enters, and it enters for a very practical reason: we are about to trade memory for evenness, and you cannot price a trade you cannot measure.

---

## 5. The first formula, which is trivial

With $$N$$ servers, each _should_ get:

$$
\text{Expected} = \frac{1}{N}
$$

For $$N = 100$$, that's $$0.01 = 1\%$$. That is the whole first formula. It is the target, not a result.

---

## 6. Standard deviation, without the jargon

Ask 100 people to each pick a random number from 0 to 100. You get 12, 13, 87, 41, ... The average lands near 50, but almost nobody _is_ 50. Standard deviation is the one-number answer to "how far from the average does a typical sample sit?"

For one hash position per server, the standard deviation of a server's load share works out to:

$$
SD = \frac{1}{N}\sqrt{\frac{N-1}{N+1}}
$$

Plug in $$N = 100$$:

$$
SD = \frac{1}{100}\sqrt{\frac{99}{101}} \approx 0.0099 = 0.99\%
$$

Sit with that for a second:

```text
Expected load = 1.00%
Typical wobble = 0.99%
```

The typical deviation is **the same size as the thing being measured**. A server getting 0% and a server getting 2% are both entirely ordinary outcomes. That is not a system you want to run a cache on.

---

## 7. Coefficient of variation: the number that matters

The raw SD is awkward because it shrinks as you add servers — 0.99% sounds small until you remember the target is 1%. So normalize:

$$
CV = \frac{SD}{\text{Expected}}
$$

$$
CV = \frac{0.99\%}{1\%} \approx 99\%
$$

Read it in English:

> **The random noise is 99% as large as the workload we were aiming for.**

CV is unitless, so it compares across fleet sizes, across weights, across designs. It is the right dashboard number. And at $$k=1$$ it says: this design does not work.

---

## 8. The trick: give every server many positions

Instead of one position per server, give each several:

```text
A1 A2 A3 A4 A5
B1 B2 B3 B4 B5
C1 C2 C3 C4 C5
```

All fifteen go on the same ring:

```text
0    A1    B2  C1      A3      B1 C4     A2
|-----|-----|---|-------|-------|-|-------|
```

Server A no longer owns one giant random chunk. It owns five smaller ones, and its total load is:

$$
\text{load}(A) = A_1 + A_2 + A_3 + A_4 + A_5
$$

Some of those chunks come out too big, some too small, and **they cancel**. That cancellation is the entire mechanism. Not "more positions means finer granularity" — it's "more positions means you are averaging more independent draws, and averages of independent draws concentrate."

### The candy version

Three kids splitting candy.

**One bag each, thrown randomly:**

```text
Alice   → 70
Bob     → 10
Charlie → 20
```

**One hundred tiny bags each, thrown randomly:**

```text
Alice   → ~33%
Bob     → ~33%
Charlie → ~34%
```

Same randomness, same throwing. The only change is that each kid's total is now a sum of 100 independent small things instead of one big thing. That is the law of large numbers doing all the work, and it is exactly why virtual nodes exist.

---

## 9. These are called virtual nodes

Standard terminology, so worth naming:

```text
Physical server
      ↓
many virtual positions (vnodes / replicas / hash points)
      ↓
one consistent-hash ring
```

```text
Server A                  Server B
 ├── hash A1               ├── hash B1
 ├── hash A2               ├── hash B2
 ├── hash A3               ├── hash B3
 ├── hash A4               ├── hash B4
 └── hash A5               └── hash B5
```

Usually generated as `hash(server_id + ":" + i)` for `i in 0..k`. The client never sees these identities — every one of them resolves back to a physical `A` or `B`. They are a **statistical device, not a topology**.

---

## 10. Cloudflare's starting number: 160

NGINX's consistent-hash implementation uses **160 hash positions per server** as its baseline, and Pingora — Cloudflare's Rust proxy — inherited the same default.

For 100 servers:

$$
100 \times 160 = 16{,}000 \text{ positions}
$$

Sixteen thousand points instead of a hundred. And the payoff is exactly what you'd hope:

```text
k = 1    →  CV ≈ 99%
k = 160  →  CV ≈ 8%
```

From "noise equals signal" to "±8%." That is a good trade and it is why 160 became folklore. The problem is that folklore does not come with a derivative, so nobody asked what 161 was worth.

---

## 11. But servers are not identical

Real fleets are heterogeneous:

```text
Server A → 1 TB disk
Server B → 2 TB disk
Server C → 4 TB disk
```

Equal shares would be actively wrong. A thrashes while C idles with empty disk. You want share proportional to capacity:

```text
A → 1 part      A = 1/7 ≈ 14%
B → 2 parts     B = 2/7 ≈ 29%
C → 4 parts     C = 4/7 ≈ 57%
```

This is **weighted consistent hashing**.

---

## 12. Ketama: weight becomes position count

The Ketama-style answer is beautifully dumb, which is why it works:

> More weight → more hash positions.

```text
A weight 1 → 10 positions
B weight 2 → 20 positions
C weight 4 → 40 positions
            ───────────────
            70 positions
```

```text
A → 10/70 = 14%
B → 20/70 = 29%
C → 40/70 = 57%
```

Exactly the target. The causal chain:

```text
SERVER CAPACITY
      ↓
    WEIGHT
      ↓
NUMBER OF HASH POSITIONS
      ↓
PORTION OF RING
      ↓
SHARE OF REQUESTS
```

Cloudflare weights its cache tier by **disk capacity**, since that is what determines how much of the working set a machine can hold. Other workloads weight by CPU cores, GPU count, or memory — the framework does not care what the weight _means_, only that it is a number.

---

## 13. Where it goes wrong

Now make the spread realistic. Fleets accumulate hardware generations:

```text
Server A = 1 TB
Server B = 2 TB
Server C = 10 TB
```

Keep 160 as the _baseline for the smallest_ server and scale up:

```text
A →  160 positions
B →  320 positions
C → 1600 positions
     ───────────────
     2080 positions  (for three servers)
```

Notice what happened. Weighting does not redistribute a fixed budget of positions — it **multiplies** the budget. The largest machine in the fleet sets the ceiling and everything is denominated against the smallest.

Cloudflare is not doing this for three servers. They are doing it across a global fleet, and some PBR (policy-based routing) processes were spending as much as **6 GB** on consistent-hashing structures alone. The data structure that was supposed to be an index had become one of the larger tenants of the box.

---

## 14. And then: one ring is not enough

Servers have capabilities:

```text
PCI-compliant storage
GPU present
special cache tier
region restriction
```

Some requests are only eligible for some servers.

```text
Request X needs PCI  →  eligible: {A, B, D}
Request Y needs nothing → eligible: {A, B, C, D, E}
```

You cannot route both off one ring, because the ring encodes _which servers exist_. Different eligible sets need different rings.

And eligible sets are subsets, so they multiply:

$$
2^4 = 16 \qquad 2^{10} = 1{,}024 \qquad 2^{20} = 1{,}048{,}576
$$

Classic combinatorial explosion. In practice it is nowhere near the theoretical bound — most combinations never occur — but Cloudflare reports that feature combinations produced **dozens of separate rings** in their system. Dozens of rings, each holding a weighted, 160×-multiplied position list.

---

## 15. The bill, assembled

```text
Servers
   ↓
× weights (biggest disk sets the multiplier)
   ↓
× 160 positions per weight unit
   ↓
× dozens of rings for feature combinations
   ↓
millions of hash entries per process
   ↓
RAM
```

Every multiplication was locally defensible. Nobody made a mistake. The 160 was inherited from NGINX, the weighting was needed for heterogeneous disks, the multiple rings were needed for eligibility. The product is what got expensive.

So Cloudflare asked the question that had gone unasked for the entire history of that code:

> **Do we actually need this many positions?**

---

## 16. Diminishing returns, and why square roots are brutal

This is the core idea of the whole story. The error behaves like:

$$
\text{Error} \propto \frac{1}{\sqrt{k}}
$$

where $$k$$ is positions per server. Ignore the derivation; look at what it costs to improve:

```text
    100 positions →  some error E
    400 positions →  E/2
  1,600 positions →  E/4
  6,400 positions →  E/8
 25,600 positions →  E/16
```

Each halving of the error costs **four times** the memory. The curve is a sponge: the first squeeze gets you most of the water, and after that you are squeezing very hard for drops.

The reason is not mysterious. Averaging $$k$$ independent things reduces their spread by $$\sqrt{k}$$ — same reason polling 4,000 people is only twice as precise as polling 1,000. It is the most universal cost curve in applied probability, and here it is deciding a memory budget.

---

## 17. The formula Cloudflare derived

For $$N$$ servers and $$k$$ positions each:

$$
\text{Expected}_k = \frac{1}{N}
$$

$$
SD_k = \sqrt{\frac{k+1}{N(kN+1)} - \frac{1}{N^2}}
$$

and dividing through:

$$
\boxed{\;CV_k = \sqrt{\frac{N-1}{Nk+1}}\;}
$$

Do not memorize it. Read it. There are only two things in it:

- **$$k$$ is under a square root in the denominator.** Doubling accuracy costs 4× the positions. Forever.
- **$$N$$ appears on top and bottom.** Add servers and both the numerator and the $$Nk$$ term grow, so a bigger fleet does not rescue you — the balance is governed by $$k$$, not by how many machines you own.

Sanity check at $$k = 1$$, $$N = 100$$:

$$
CV_1 = \sqrt{\frac{99}{101}} \approx 0.99 = 99\% \;\checkmark
$$

It agrees with the one-hash case from §7, which is how you know you read it right.

### Run it yourself

```python
import math

def cv(N, k):
    return math.sqrt((N - 1) / (N * k + 1))

N = 100
for k in (1, 10, 100, 160, 1000, 10_000, 100_000):
    print(f"k={k:>7,}  positions={N*k:>9,}  CV={cv(N,k)*100:6.2f}%")
```

```text
k=      1  positions=      100  CV= 99.00%
k=     10  positions=    1,000  CV= 31.45%
k=    100  positions=   10,000  CV=  9.95%
k=    160  positions=   16,000  CV=  7.87%
k=  1,000  positions=  100,000  CV=  3.15%
k= 10,000  positions=1,000,000  CV=  0.99%
k=100,000  positions=10,000,000  CV=  0.31%
```

Look at the last three rows. Going from 1,000 to 100,000 positions per server — a **100× increase in memory** — moves CV from 3.15% to 0.31%. You spent 99,000 extra entries per server — 9.9 million across a 100-server fleet — to remove under three percentage points of imbalance that nobody could measure in production anyway.

---

## 18. The concrete waste

Cloudflare's own example: a base of 160 positions multiplied by a weighting factor of 625 gives

$$
160 \times 625 = 100{,}000
$$

positions for a single server. They measured what the tail of that was worth: the last **90,000 positions** bought roughly a **0.7 percentage-point** reduction in error.

```text
90,000 extra entries per server
        ↓
0.7 percentage points of balance
```

That is the trade, stated plainly. Once you see it written as a ratio it stops being a judgement call.

---

## 19. Where math meets a 32-bit integer

Here is the twist that makes this an engineering story instead of a math one.

The formula in §17 assumes positions are drawn from a continuous space. Real hashes are integers. Cloudflare uses **32-bit** hashes:

$$
2^{32} = 4{,}294{,}967{,}296
$$

4.3 billion slots. Enormous — until you start putting millions of points into it.

### Collisions, quickly

Shrink the space to `0..9`:

```text
A → 3
B → 7
C → 3      ← A and C collide
```

Two servers claiming the same position means one of them effectively owns a zero-width slice. A wasted entry: full memory cost, zero balancing benefit.

This is the **birthday paradox**. With $$M$$ slots you start seeing collisions around $$\sqrt{M}$$ points, not $$M$$ points. For 32-bit hashes:

$$
\sqrt{2^{32}} = 65{,}536
$$

Sixty-five thousand. That is a _small_ ring. By the time you have millions of points, collisions are not an edge case — they are a steady drag, and every collided point is memory you bought and got nothing for.

Cloudflare found exactly this: past a certain density, measured error was **worse than the ideal formula predicted**, because the formula assumes distinct positions and reality was not supplying them.

So the tail of the curve is worse than "diminishing returns." It is:

```text
more positions
      ↓
tiny accuracy gain (√k)
      +
more RAM (linear)
      +
more collisions (which give back some of the gain)
      ↓
you can make it worse by trying harder
```

---

## 20. What they actually did

Two changes.

**One — stop earlier.** Cut positions by roughly **90%**, with no appreciable accuracy loss in their measurements. Not a heuristic; a decision priced against $$CV_k$$ and validated against real traffic.

**Two — stop paying for padding.** Each ring entry is a hash plus a server index:

```text
hash  = 4 bytes
index = 2 bytes
      = 6 bytes of actual data
```

But a naive struct gets aligned to 8:

```text
┌────────────┬──────────┬──────────┐
│ hash       │ index    │ padding  │
│ 4 bytes    │ 2 bytes  │ 2 bytes  │
└────────────┴──────────┴──────────┘
              8 bytes
```

Store it packed instead:

```text
┌────────────┬──────────┐
│ hash       │ index    │
│ 4 bytes    │ 2 bytes  │
└────────────┴──────────┘
        6 bytes
```

$$
\frac{8 - 6}{8} = 25\%
$$

A 25% reduction from deleting nothing at all. The two bytes were never data — they were alignment. That is the "(and Rust)" half of the title: a language where you can lay out and iterate a packed representation without giving up the safety or the speed.

### The arithmetic of why this is 100 TB

```text
1 entry × 8 bytes
1,000,000,000 entries × 8 bytes  =   8 GB
100,000,000,000 entries × 8 bytes = 800 GB
```

Now multiply by processes per machine, machines per data center, and data centers per planet. Cloudflare's reported total: about **100 TB of RAM recovered globally**.

Nothing about that came from a clever algorithm. It came from noticing that a constant inherited from NGINX had been multiplied by a weight factor, then by a ring count, then by a fleet — and that nobody had ever differentiated the accuracy curve to see what the last 90% was buying.

---

## 21. A small system, end to end

Four servers, one position each:

```text
A = 10   B = 30   C = 70   D = 90
```

```text
0----10---------30----------------70---------90----100
     A           B                 C          D
```

```text
request        hash    server
------------------------------
cat.jpg          12      A
dog.jpg          35      B
movie.mp4        72      C
logo.png         95      D
index.html        5      D   ← wrapped around
```

Now three positions each:

```text
A = 10, 45, 83
B = 20, 55, 96
C = 30, 61, 74
D = 40, 68, 88
```

Sorted:

```text
10 A   20 B   30 C   40 D   45 A   55 B
61 C   68 D   74 C   83 A   88 D   96 B
```

Ownership goes from this:

```text
A → ███████████████
B → ███
C → ███████
D → █████
```

to this:

```text
A → ███ ███ ███
B → ███ ███ ███
C → ███ ███ ███
D → ███ ███ ███
```

Same hash function. Same randomness. Different variance.

### Simulate it

```python
import bisect, hashlib, collections

def h32(s):
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=4).digest(), "big")

def build(servers, k):
    ring = sorted((h32(f"{s}:{i}"), s) for s in servers for i in range(k))
    return [p for p, _ in ring], [s for _, s in ring]

def route(positions, owners, key):
    i = bisect.bisect_right(positions, h32(key))
    return owners[i - 1]          # negative index = wrap-around

servers = [f"server-{i}" for i in range(100)]
keys = [f"/asset/{i}.jpg" for i in range(1_000_000)]

for k in (1, 10, 160, 1000):
    pos, own = build(servers, k)
    counts = collections.Counter(route(pos, own, key) for key in keys)
    loads = [counts.get(s, 0) for s in servers]
    mean = sum(loads) / len(loads)
    var = sum((x - mean) ** 2 for x in loads) / len(loads)
    print(f"k={k:>5}  CV={var**0.5/mean*100:6.2f}%  "
          f"min={min(loads):>6,}  max={max(loads):>6,}")
```

Measured against predicted, on 200,000 keys and 100 servers:

```text
k=    1  measCV= 96.86%  predCV= 99.00%  min=    2  max=10,955
k=   10  measCV= 31.17%  predCV= 31.45%  min=1,012  max= 3,645
k=  160  measCV=  8.09%  predCV=  7.87%  min=1,540  max= 2,386
```

Look at the `min`/`max` columns, not just the CV. At $$k=1$$ one server got **2 requests** and another got **10,955** — a 5,000× spread, from a perfectly good hash function. At $$k=160$$ the whole fleet sits inside 1,540–2,386. The formula tracks $$\sqrt{(N-1)/(Nk+1)}$$ to within noise. Worth running — watching the predicted number fall out of a million simulated requests is what makes the formula stop feeling like decoration.

---

## 22. The part that makes it "consistent"

Everything so far is about balance. The name is about something else.

Naive modulo routing:

```python
server = hash(key) % len(servers)
```

Go from 4 servers to 3 and the modulus changes for **every key**. Roughly 75% of your keys move. Every moved key is a cache miss, and every miss is an origin fetch. Removing one machine stampedes your origin.

With consistent hashing, when A dies:

```text
before:  A A B B C C D D A A B B
A dies:  · · B B C C D D · · B B
after:   D D B B C C D D C C B B
         ↑↑                 ↑↑
     only A's old regions moved
```

A's positions vanish; whoever sits to the left of each vanished region inherits it. **Every other key stays exactly where it was.** The fraction of keys that move is about $$1/N$$ — the departing server's share — instead of $$(N-1)/N$$.

That is the whole point of the design, and it is why the operational story matters more than the balance story:

```text
modulo hashing:            consistent hashing:
server added                server added
    ↓                           ↓
recompute everything        a few ring regions change hands
    ↓                           ↓
most objects move           most objects stay put
    ↓                           ↓
mass cache miss             small, bounded miss spike
    ↓                           ↓
origin traffic spike        origin barely notices
```

Adding capacity should not be an incident.

---

## 23. Four things worth remembering

**① The target.** With $$N$$ servers, each should get

$$
\frac{1}{N}
$$

**② Randomness alone does not give you that.** Few points → large gaps → uneven traffic. Uniform hashing is not uniform load.

**③ More points concentrate the average.**

$$
\text{error} \sim \frac{1}{\sqrt{k}}
$$

**④ And that square root is the whole engineering story.** 2× better balance = 4× memory. 10× better = 100× memory. Somewhere on that curve is the point where you are paying real money for an improvement no dashboard can see — and past it, finite hash space starts taking the improvement back.

---

## 24. Why the title is better than it looks

_"Saving another 100TB of RAM with math (and Rust)."_

The Rust is real but secondary — packed layouts and cheap iteration. The math is the story, and specifically this loop:

```text
      build → measure → find waste → model it
                                        ↓
      deploy ← benchmark ←──────── change it
```

They did not say "let's use fewer hashes, feels like enough." They asked _how much randomness do we actually need_, wrote down $$CV_k$$, found the knee of the curve, checked it against 32-bit reality where the clean formula stopped holding, and then cut.

Which is the honest version of what "engineering at scale" means. Not heroics — noticing that a default someone inherited from NGINX in 2008 had been multiplied by four different things, and being willing to do the arithmetic on it.

---

## 25. FAQ

**How many virtual nodes should I use?**
Compute it. $$CV_k=\sqrt{(N-1)/(Nk+1)}$$ — pick your tolerable imbalance and solve for $$k$$. For most fleets under a few hundred machines, 100–200 lands you under 10% and there is no reason to go further unless you have measured that 10% hurting.

**Does a better hash function fix the imbalance?**
No. The imbalance in §4 comes from uniform randomness itself, not from a defect in the hash. A "better" hash gives you the same exponentially distributed gaps. Only more points fix it.

**Is this relevant below Cloudflare scale?**
The algorithm, yes — deterministic routing and cheap rebalancing are worth having at any size. The 100 TB optimization, no. If your ring holds 16,000 entries, it is ~128 KB and you should never think about it again. The lesson at small scale is the inverse one: _don't_ build the weighted multi-ring machinery until something forces you to. Same math, opposite conclusion — which is a good subject for its own post.

**Why 32-bit hashes if collisions are the problem?**
Because for reasonable ring sizes they are not a problem, and 4 bytes per entry versus 8 is a 33% saving on a structure you are replicating everywhere. The collisions only bite at the extreme density that the §18 analysis says you should not be at anyway. The two findings point the same direction.

**What about bounded-load or rendezvous hashing?**
Different tools on the same shelf. Rendezvous (HRW) hashing skips the ring entirely — score every server per key, take the max — which gives excellent balance at $$O(N)$$ lookup instead of $$O(\log(Nk))$$, so it suits small $$N$$. Consistent hashing with bounded loads adds a capacity cap and overflow-forwarding on top of the ring. Both are worth knowing; neither changes the $$1/\sqrt{k}$$ story above.

---

## Source

Cloudflare, _Saving another 100TB of RAM with math (and Rust)_ — <https://blog.cloudflare.com/saving-100-tb-of-ram-with-math/>

All figures attributed to Cloudflare in this post (the 99% and 8% CV values, 160 positions per server, the 6 GB PBR processes, the dozens of rings, the 160×625 = 100,000 example and its 0.7 percentage points, the ~90% reduction, the 25% struct saving, and the ~100 TB total) come from that post. The derivations, simulations, and the code in §3, §17, and §21 are mine.
