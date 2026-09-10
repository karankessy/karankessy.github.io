---
layout: post
title: A From-Scratch Tour of OpenFlow, From the Wire Up
date: 2026-09-10
description: Building a toy OpenFlow switch and controller in ~600 lines of Python, then working bottom-up through PHY, parser, TCAM, pipeline, and actions to show why the protocol's design is downstream of memory technology and a 20-cycle-per-packet budget.
tags: openflow sdn networking tcam asic p4 packet-processing network-architecture switching
categories: research analysis networking
toc:
  sidebar: left
published: true
---

> _"What I cannot create, I do not understand."_ — Feynman, allegedly on a blackboard, definitely on every networking engineer's conscience.

I have read the OpenFlow spec maybe four times over the years and each time I came away with the same uneasy feeling: I could recite the message types, I could draw the controller-above-switch picture, and I still could not have told you what _physically happens_ when a `FLOW_MOD` lands on a switch. Which is a bad sign. Knowing that `OFPT_FLOW_MOD = 14` is trivia. Knowing why a 100 Gbps ASIC can evaluate ten thousand wildcard rules in a handful of nanoseconds, and why your controller absolutely must not be in that path, is the actual content.

So I did the thing that always works: I wrote a tiny OpenFlow switch and a tiny controller in Python, ~600 lines total, no dependencies beyond the stdlib, and then went and read what the hardware people actually built. This post is the writeup. We'll go bottom-up — photons, PHY, parser, TCAM, pipeline, actions, counters — and only _then_ talk about the protocol, because by that point the protocol is almost obvious.

Fair warning on the artifact: everything I built runs in software on a laptop, which means it's a _model_ of a switch, not a switch. Every hardware number in here comes from published papers or from arithmetic, and I've flagged which is which. The software numbers are mine and they're rough.

---

## The one number that explains everything

Start here, because the entire architecture falls out of it.

100 Gigabit Ethernet. Minimum-size frame: 64 bytes of Ethernet frame, plus 8 bytes of preamble/SFD, plus a 12-byte interframe gap. So 84 bytes on the wire, 672 bits.

```
100e9 bits/s ÷ 672 bits/packet = 148,809,523 packets/s
```

~148.8 Mpps. That's the canonical number and you can derive it on a napkin. Invert it:

```
1 / 148.8e6 = 6.72 nanoseconds per packet
```

Now put a 3 GHz core next to it. 6.72 ns × 3e9 cycles/s = **about 20 clock cycles per packet**, per 100G port, if a single core had to do the whole job. Twenty cycles. A single L3 cache miss is ~40 cycles. A DRAM access is a few hundred. You cannot do a hash lookup that misses cache. You cannot take an interrupt. You cannot, hilariously, even afford a mispredicted branch.

And a mid-range top-of-rack switch today has 32 or 64 of these ports.

So: whatever a switch is, it is _not_ a computer running a `while` loop over packets. That's the whole thing. Everything else in this post — TCAM, pipelining, the control/data plane split, the very existence of OpenFlow — is a consequence of those 20 cycles.

I like to think of it as the memory hierarchy argument transplanted into networking. In a CPU you have registers, L1, L2, DRAM, disk, each ~10x slower and ~10x bigger than the last, and good code is code that respects the hierarchy. A switch has the same shape: a fixed-function ASIC pipeline (nanoseconds, tiny state), the switch CPU (microseconds, megabytes), the controller (milliseconds, unbounded). Good network design is design that respects _that_ hierarchy. Sending every packet to the controller is the networking equivalent of doing your inner loop over swap.

---

## Two machines in one box

Open a switch and you find two computers glued together.

```
                 CONTROL PLANE                     ~ms, GBs of RAM
              ┌────────────────────┐
              │ CPU: Linux/NOS     │
              │ BGP, OSPF, STP     │
              │ OpenFlow agent     │
              │ gNMI, SNMP, CLI    │
              └─────────┬──────────┘
                        │  PCIe / MDIO / vendor SDK
                        │  "program these tables"
                        ▼
              ┌────────────────────┐
   packet ───►│ ASIC: DATA PLANE   │───► packet    ~ns, MBs of SRAM/TCAM
              └────────────────────┘
```

The control plane is a normal-ish computer. Often a modest x86 or ARM core running Linux. It thinks in seconds and milliseconds. It runs routing protocols, holds the RIB, talks to humans.

The data plane is an ASIC. It thinks in nanoseconds and it does exactly one thing: turn incoming bits into outgoing bits according to tables that somebody else filled in.

The connection between them is _table writes_. That's it. That's the interface. The control plane doesn't "handle packets"; it populates state that the data plane consults. Once you internalize that the CPU→ASIC interface is a table-programming API, OpenFlow stops looking like a networking protocol and starts looking like what it is: **a standardized, remote version of that same table-programming API**.

That reframing is, I think, the single most useful sentence in this post. OpenFlow is a remote table-write interface with a vendor-neutral schema.

This lineage is not something I'm inventing post-hoc, either — it's explicit in the intellectual history. Feamster, Rexford & Zegura's _The Road to SDN_ (ACM CCR 2014) traces the line from active networks through the IETF's **ForCES** (RFC 5810, literally "Forwarding and Control Element Separation"), the **RCP** routing control platform, the **4D** architecture (Greenberg et al., CCR 2005), and **Ethane** (Casado et al., SIGCOMM 2007) — which is essentially OpenFlow's direct parent — straight into McKeown et al.'s _OpenFlow: Enabling Innovation in Campus Networks_ (CCR, April 2008). OpenFlow's actual innovation over ForCES was not the idea. It was the pragmatism: _don't ask vendors to expose their ASIC; ask them to expose the flow table they already have for ACLs._

---

## Let's follow one packet

Client `10.10.1.25:49152` → server `10.10.2.50:443`. TCP SYN, 74 bytes.

### 1. Photons → bits (PHY)

The frame arrives as modulated light in a fiber, hits a transceiver, becomes an electrical signal, and lands in the PHY. The PHY's job is decidedly unglamorous and completely essential: clock recovery, line-code decoding (64b/66b for 10G+, PAM4 for the modern high-lane-rate stuff), lane deskew across the multiple physical lanes that make up one logical 100G link, FEC. Out the other side comes a clean bitstream with frame boundaries.

There is nothing "networking" about this layer. It's signal processing. But it's where your link flaps and your mysterious CRC errors come from, so.

### 2. Bits → frame (MAC)

The MAC finds the preamble, strips it, validates the FCS (CRC-32) over the frame, and hands up:

```
┌──────────┬──────────┬───────────┬─────────────────────┬─────┐
│ dst MAC  │ src MAC  │ EtherType │      payload        │ FCS │
│  6 B     │  6 B     │   2 B     │      46-1500 B      │ 4 B │
└──────────┴──────────┴───────────┴─────────────────────┴─────┘
```

EtherType `0x0800` → IPv4. Now we have to look deeper, and this is where it gets genuinely interesting.

### 3. Frame → fields (the parser)

Here's the naive mental model, and it's wrong: _"IP header starts at byte 14."_

It doesn't, reliably. Consider what can actually show up:

```
Eth │ IPv4 │ TCP                                    → IP at byte 14
Eth │ VLAN │ IPv4 │ TCP                             → IP at byte 18
Eth │ VLAN │ VLAN │ IPv4 │ TCP                      → IP at byte 22   (QinQ)
Eth │ MPLS │ MPLS │ MPLS │ IPv4 │ TCP               → IP at byte 26
Eth │ IPv6 │ HopByHop │ Routing │ Frag │ TCP        → good luck
Eth │ IPv4 │ UDP │ VXLAN │ Eth │ IPv4 │ TCP         → two of everything
```

The parser is a **state machine over the header graph**. You start in the Ethernet state, read a field, and that field tells you which state to jump to next:

```
        ┌──────────┐
        │ Ethernet │
        └────┬─────┘
   0x8100│   │0x0800        │0x86DD
   ┌─────┘   ▼              ▼
   ▼      ┌──────┐      ┌──────┐
┌──────┐  │ IPv4 │      │ IPv6 │
│ VLAN │  └──┬───┘      └──┬───┘
└──┬───┘  6  │ 17          │ 6 / 17 / ext-hdr chain
   └────►    ▼             ▼
        ┌───────┐     ┌───────┐
        │  TCP  │     │  UDP  │
        └───────┘     └───────┘
```

In hardware this is implemented as a pipeline of parser stages, each of which extracts a fixed-width chunk, matches it against a small TCAM of "next header" transitions, and advances a cursor. It's a compiled DFA in silicon. The RMT paper (Bosshart et al., _Forwarding Metamorphosis_, SIGCOMM 2013) describes exactly this and it's the single best hardware-architecture paper in the area — if you read one citation from this post, read that one.

The parser is also, incidentally, where a _lot_ of security bugs live, because "the parser and the endpoint disagree about where the headers are" is the entire ambiguity-based-IDS-evasion literature (Ptacek & Newsham 1998 is still depressingly relevant). Every additional encapsulation you support is another chance for the switch and the host to parse a packet differently.

Out of the parser comes a bag of fields — the **packet header vector** in RMT terminology:

```python
{
  'in_port':   3,
  'eth_src':   'aa:bb:cc:dd:ee:ff',
  'eth_dst':   '11:22:33:44:55:66',
  'eth_type':  0x0800,
  'vlan_vid':  None,
  'ipv4_src':  '10.10.1.25',
  'ipv4_dst':  '10.10.2.50',
  'ip_proto':  6,
  'tcp_src':   49152,
  'tcp_dst':   443,
}
```

That dict is the whole point. Everything downstream operates on this ~100-500 bit vector, not on the packet. The packet body goes and sits in a buffer and doesn't participate. This is a _massive_ engineering simplification and it's why the pipeline can be fixed-latency: the pipeline processes a small fixed-size struct, not a variable-length blob.

Here's the parser from my toy switch. It's the honest version of the diagram above:

```python
import struct

def parse(pkt: bytes, in_port: int) -> dict:
    m = {'in_port': in_port}
    m['eth_dst'], m['eth_src'], et = struct.unpack_from('!6s6sH', pkt, 0)
    off = 14

    # VLAN tags: chase the stack
    m['vlan_vid'] = None
    while et in (0x8100, 0x88a8):
        tci, et = struct.unpack_from('!HH', pkt, off)
        if m['vlan_vid'] is None:
            m['vlan_vid'] = tci & 0x0fff
        off += 4

    m['eth_type'] = et
    if et != 0x0800:
        return m                              # not IPv4, we're done

    ihl = (pkt[off] & 0x0f) * 4               # <- variable-length header
    proto = pkt[off + 9]
    m['ip_proto'] = proto
    m['ipv4_src'] = pkt[off+12:off+16]
    m['ipv4_dst'] = pkt[off+16:off+20]
    off += ihl

    if proto in (6, 17):                      # TCP or UDP
        sport, dport = struct.unpack_from('!HH', pkt, off)
        m['tcp_src'], m['tcp_dst'] = sport, dport
    return m
```

Note `ihl` — the IPv4 header is variable length, so even "skip the IP header" is a data-dependent computation. In hardware that's a shifter fed by a field you just extracted. Little things like this are why parsers are hard.

### 4. Fields → decision (the match)

Now the flow table. The naive implementation, which is what I wrote first:

```python
def lookup(match, table):
    best = None
    for entry in table:                       # O(n). RIP.
        if entry.matches(match):
            if best is None or entry.priority > best.priority:
                best = entry
    return best
```

On my laptop this does something like a few hundred thousand packets/sec with a 1000-entry table — the exact number depends enormously on your Python version and how many fields each rule constrains, so don't quote mine, run your own. The point is the shape, not the constant: it's O(n) in table size and it's three to four orders of magnitude away from line rate on a single 100G port. That gap is not closeable by optimizing Python. It's not closeable by rewriting in C either — remember, the budget is 20 cycles.

It's closeable by changing the memory.

---

## TCAM, or: why networking hardware is weird

Regular RAM: you give it an address, it gives you contents. CAM inverts this: you give it contents, it gives you the address where that content lives — in one shot, by comparing against _every_ entry in parallel.

TCAM ("ternary") adds a third state per bit: **X, don't care**. Which happens to be exactly what a subnet mask is.

```
rule:    192.168.1.0/24
bits:    11000000 10101000 00000001 XXXXXXXX
                                    ^^^^^^^^ don't care

packet:  192.168.1.77
bits:    11000000 10101000 00000001 01001101
                                             → MATCH
```

Every TCAM entry compares itself against the search key simultaneously. A priority encoder picks the lowest-index match. The result is an index, which indexes into a parallel SRAM holding the _action_. Lookup time: **one clock, independent of table size.** That's the trick. That's the whole trick.

The cost is brutal and worth stating precisely:

- An SRAM cell is 6 transistors. A TCAM cell is on the order of **16** — it stores two bits (value + mask) _and_ carries its own comparator.
- Every entry is powered and switching on every lookup, because they all compare in parallel. Power scales with _capacity_, not with utilization. An empty TCAM burns nearly as much as a full one. Agrawal & Sherwood's TCAM power model (ISPASS 2008) is the reference here; the folk summary "TCAM is roughly an order of magnitude worse than SRAM in both area and power per bit" is close enough for reasoning, and I'd hedge anything more precise than that.

Which is why merchant silicon ships with TCAM budgets measured in the low thousands to low tens of thousands of entries, while the same chip has room for hundreds of thousands of exact-match L2/L3 entries in SRAM. DevoFlow (Curtis et al., SIGCOMM 2011) called this out directly and it remains the correct framing: **flow table space is a scarce, contended, physically expensive resource**, and any SDN design that pretends otherwise will fall over.

So real ASICs stratify:

```
              ┌─────────────────────────────────────┐
              │            LOOKUP MEMORY            │
              ├──────────────┬──────────────────────┤
   wildcard   │    TCAM      │  ACLs, OF wildcards  │  1000s
   longest-px │    TCAM/algo │  IP routing (LPM)    │  10Ks-100Ks
   exact      │  hash + SRAM │  MAC table, 5-tuple  │  100Ks+
   indexed    │    SRAM      │  port/VLAN configs   │  cheap
              └──────────────┴──────────────────────┘
```

The rule of thumb that falls out: **if your match is exact, never spend TCAM on it.** Hash it. TCAM is for wildcards, ranges, and priority, and for nothing else.

Ranges deserve a footnote of shame. TCAM does prefixes natively but not ranges — `tcp_dst ∈ [1024, 65535]` isn't a prefix. Classic prefix expansion turns one range into up to `2W-2` prefixes for a W-bit field, so a single arbitrary 16-bit port range can burn up to 30 TCAM entries, and a rule with ranges on _two_ fields multiplies. This is why "just add a firewall rule" sometimes silently costs you 900 hardware entries. Vendors mitigate with range encoders and DIRPE-style tricks, but the tax is real.

---

## The pipeline

We can now do one lookup in one clock. But a real forwarding decision isn't one lookup — it's L2, then ACL, then L3, then QoS, then rewrite, then egress ACL. Six-ish dependent lookups. Do them sequentially and you're back to being slow.

So: pipeline it, exactly like a CPU pipeline.

```
   time ──────────────────────────────────────────────►
   pkt 1  [PRS][L2 ][ACL][L3 ][MOD][EGR]
   pkt 2       [PRS][L2 ][ACL][L3 ][MOD][EGR]
   pkt 3            [PRS][L2 ][ACL][L3 ][MOD][EGR]
   pkt 4                 [PRS][L2 ][ACL][L3 ][MOD][EGR]
                              ▲
                    every stage busy, one packet retires per clock
```

Latency per packet: six stages. Throughput: **one packet per clock**, once the pipe is full. At ~1 GHz that's a billion packets/sec of pipeline capacity, which you then statically fan out across ports. This is why a switch can advertise 6.4 Tbps and sub-microsecond port-to-port latency at the same time: those are throughput and latency, and pipelining decouples them.

The constraint this imposes is the one people underestimate: **the pipeline only goes forward.** No loops, no backtracking, no "go re-check table 2." Each stage sees the packet header vector once, for one clock, and passes it on. If your policy needs to consult a table twice, you either need two physical stages holding copies of it, or you need recirculation (send the packet back to the top), which costs you bandwidth out of your own budget.

RMT's contribution was showing you could make this pipeline _reconfigurable_ — 32 match-action stages with flexibly allocated TCAM/SRAM blocks and a programmable parser — at 64×10 GbE, and they estimated the area cost at under ~15% versus a fixed-function chip. That number is what made programmable switching commercially plausible rather than a research toy, and it's the direct ancestor of Tofino.

---

## Now, finally, OpenFlow

With the hardware in view, the protocol is nearly derivable.

OpenFlow says: expose the pipeline as a sequence of **flow tables**, where each table holds entries of the form

```
┌──────────┬────────────────┬──────────────┬──────────┬─────────────┐
│ priority │ match fields   │ instructions │ counters │  timeouts   │
└──────────┴────────────────┴──────────────┴──────────┴─────────────┘
```

and let a remote controller write those entries over a TCP (ideally TLS) channel.

```
      TABLE 0            TABLE 1            TABLE 2
   ┌───────────┐      ┌───────────┐      ┌───────────┐
   │ classify  │─────►│  security │─────►│ forward   │───► action set
   └───────────┘ goto └───────────┘ goto └───────────┘        │
        │                  │                                  ▼
     table-miss         DROP                               execute
        │
        ▼
    PACKET_IN to controller
```

A packet enters table 0, matches at most one entry (highest priority wins), and that entry's _instructions_ can modify an action set, write metadata, and `goto-table N` for N > current. Strictly increasing — because, as we just established, the pipeline only goes forward. The spec's table-chaining rule is not an arbitrary design choice; it is silicon leaking through the abstraction, and once you see it that way the spec reads much better.

The version history is basically a story of the abstraction chasing the hardware:

| Version | Year | What it added                                                   | What it reveals                        |
| ------- | ---- | --------------------------------------------------------------- | -------------------------------------- |
| 1.0     | 2009 | Single table, fixed 12-tuple match                              | "assume every switch has one ACL TCAM" |
| 1.1     | 2011 | Multiple tables, groups, MPLS                                   | "oh, switches are pipelines"           |
| 1.3     | 2012 | OXM extensible match (~40 fields), meters, multiple controllers | "oh, and the field set keeps growing"  |
| 1.5.1   | 2015 | Egress tables, packet-type-aware pipeline                       | "…and there's an egress pipeline too"  |

OF 1.0's twelve-tuple was chosen almost exactly because that's what commodity ACL TCAMs of 2009 could already match on. Beautiful pragmatism. Also the seed of every later problem, because the moment you standardize a _fixed_ field list, you've frozen the abstraction and the hardware keeps moving.

Here's the flow table from my toy, with priority ordering and OXM-ish wildcards:

```python
class FlowEntry:
    def __init__(self, priority, match, instructions,
                 idle_timeout=0, hard_timeout=0):
        self.priority = priority
        self.match = match                    # dict of field -> value; absent = wildcard
        self.instructions = instructions
        self.idle_timeout = idle_timeout
        self.hard_timeout = hard_timeout
        self.packet_count = 0
        self.byte_count = 0
        self.created = time.monotonic()
        self.last_used = self.created

    def matches(self, m):
        for field, want in self.match.items():
            if field.endswith('_prefix'):     # e.g. ipv4_dst_prefix
                base, plen = want
                if not in_prefix(m[field[:-7]], base, plen):
                    return False
            elif m.get(field) != want:
                return False
        return True                           # absent field == don't care == X


class FlowTable:
    def __init__(self, table_id):
        self.table_id = table_id
        self.entries = []                     # kept sorted by -priority

    def add(self, e):
        self.entries.append(e)
        self.entries.sort(key=lambda x: -x.priority)   # software's fake priority encoder

    def lookup(self, m, nbytes):
        for e in self.entries:                # sorted => first match is highest priority
            if e.matches(m):
                e.packet_count += 1
                e.byte_count += nbytes
                e.last_used = time.monotonic()
                return e
        return None                           # table miss
```

That `self.entries.sort(key=lambda x: -x.priority)` line is doing in software, badly, what a TCAM priority encoder does in one clock for free. And that early-return loop is the O(n) that hardware turns into O(1). Two lines, two orders of the entire hardware architecture. I find that pleasing.

Also note: the counters live _on the entry_, updated on match. That's not an add-on, it's part of the abstraction, and it's what makes the controller feedback loop possible at all. In hardware they're SRAM counter banks incremented by the action unit, periodically drained by the CPU.

---

## The table miss, and the mistake everyone makes

No match. Now what?

The switch consults the **table-miss flow entry** (priority 0, matches everything), which typically says either `drop` or `output:CONTROLLER`. The latter generates a `PACKET_IN`, and this is the single most consequential design point in all of SDN.

```
 packet ─► parse ─► lookup ─► MISS ─► PACKET_IN ─┐
                                                  │  (switch CPU, then TCP, then controller)
                                                  ▼
                                            ┌──────────┐
                                            │controller│  compute path
                                            └────┬─────┘
                                                 │ FLOW_MOD × N switches
                                                 ▼
 packet ─► parse ─► lookup ─► HIT ─► output   (every subsequent packet)
```

Here's the honest reactive controller from my build. It's the classic Ethane-style learning switch plus a policy hook:

```python
def on_packet_in(self, dpid, in_port, pkt, match):
    self.mac_to_port[dpid][match['eth_src']] = in_port     # learn

    if self.policy.is_blocked(match):
        self.send_flow_mod(dpid, priority=1000, match={
            'eth_type': 0x0800, 'ipv4_src': match['ipv4_src']},
            instructions=[], hard_timeout=600)             # empty = drop
        return                                             # and drop this one

    out = self.mac_to_port[dpid].get(match['eth_dst'])
    if out is None:
        self.packet_out(dpid, pkt, port=OFPP_FLOOD)        # don't know yet: flood
        return

    self.send_flow_mod(dpid, priority=100,
        match={'eth_src': match['eth_src'], 'eth_dst': match['eth_dst']},
        instructions=[('output', out)],
        idle_timeout=30, hard_timeout=300)
    self.packet_out(dpid, pkt, port=out)                   # don't drop the trigger packet
```

Two things in there that took me embarrassingly long to get right, and which I'll flag because I suspect they bite everyone:

**One.** You must `PACKET_OUT` the triggering packet after installing the rule. The rule only helps _future_ packets; the one that caused the miss is sitting in your controller's memory and if you don't send it back, you've silently dropped a SYN and the connection eats a 1-second TCP retransmit timer. Path installed correctly, application still feels broken. Wonderful debugging afternoon.

**Two.** There is a race, and it's unavoidable in reactive mode. Between `FLOW_MOD` and the ASIC actually committing the entry, more packets of the same flow arrive and generate _more_ `PACKET_IN`s for a flow you already handled. Your controller must be idempotent about this. Also `FLOW_MOD` has no reply by default — you get no acknowledgment that it landed. If you want ordering you send an `OFPT_BARRIER_REQUEST` and wait for the reply, which serializes you and costs an RTT. The spec gives you correctness or speed, and makes you choose explicitly. I respect that more than I did before I hit the race.

### Why reactive is a trap at scale

Now do the arithmetic that DevoFlow did. Published measurements of early controllers landed in the ballpark of tens of thousands of flow installs per second with flow-setup latencies in the millisecond range (NOX-era numbers; the ONIX/ONOS generation improved this substantially, and I'd treat any specific figure as version-dependent). Meanwhile, a single busy datacenter rack can generate flow arrivals in that same order of magnitude _by itself_.

The failure mode isn't graceful degradation. It's this:

```
 attacker sends 1M packets, each with a random src IP
              │
              ▼
      1M table misses
              │
              ▼
      1M PACKET_INs  ──► switch CPU saturates (it's a small CPU!)
              │
              ▼
      controller channel floods  ──► legitimate PACKET_INs queue behind attack traffic
              │
              ▼
      1M FLOW_MODs (if the controller is naive)  ──► TCAM exhausted at entry ~4000
```

You have built, at line rate, a machine for converting cheap data-plane packets into expensive control-plane work. The amplification factor is enormous: one 64-byte spoofed packet costs the attacker ~6.7 ns of link time and costs you a controller round trip, a TCAM entry, and CPU on a switch management processor that was sized for running BGP, not for absorbing a flood.

This is a well-studied class — AVANT-GUARD (Shin et al., CCS 2013) is the canonical treatment, and it proposes _connection migration_ (have the data plane complete the TCP handshake itself and only escalate to the controller once a connection proves real) plus actuating triggers. FloodGuard, FRESCO, and the topology-poisoning work (TopoGuard, NDSS 2015 — LLDP-based topology discovery is unauthenticated by default, so a host that can inject LLDP can fabricate links in the controller's graph) round out the picture.

Given a security background, I'd summarize the SDN threat model as: you took the distributed control planes of N devices, centralized them into one process, and then exposed a _write_ interface to the forwarding behavior of the entire network. The upside is programmability. The downside is that you have created (a) an extremely high-value target, (b) a control channel that is now a DoS amplification vector, and (c) a resource-exhaustion surface with a hardware floor of a few thousand entries. All three are consequences of the same architectural choice.

### The fix is proactive, mostly

So real deployments install rules ahead of time. Google's **B4** (Jain et al., SIGCOMM 2013) — the WAN between their datacenters, one of the flagship production SDN deployments — is centrally computed and proactively programmed with traffic-engineered paths; they reported running those links at near-100% utilization, versus the 30-40% typical of over-provisioned WANs. That's the real SDN win, and note it has approximately nothing to do with `PACKET_IN`. It's about global visibility enabling better _optimization_, not about reactive per-flow control.

The clean way to say it:

> Use the controller to compute policy over a global view. Use the data plane to execute it. Any design where the controller is in the per-flow critical path is a design that will meet the 20-cycle budget and lose.

---

## Actions, groups, and keeping the controller out of the loop

Matching answers "which packets." Actions answer "then what." The interesting ones:

- `output:port` — the obvious one
- `set_field` — rewrite any OXM field (dst MAC for routing, DSCP for QoS, …). Triggers checksum recomputation, which is a dedicated ALU in the pipeline, not free
- `push_vlan` / `pop_mpls` — encap/decap, i.e. changing the _shape_ of the header vector mid-pipeline
- `meter` — rate limit, with mark-or-drop over threshold
- `group` — indirection

Groups are where it gets clever. A group is a list of _buckets_, each with its own actions, plus a type that says how to pick:

```
  ALL        → clone to every bucket        (multicast, port mirroring to an IDS)
  SELECT     → hash-pick one bucket         (ECMP / load balance)
  INDIRECT   → exactly one bucket           (a named indirection point — change once,
                                             thousands of flows follow)
  FAST_FAILOVER → first bucket whose watch_port is live
```

`FAST_FAILOVER` is the one that matters architecturally. Without it, a link failure means: switch detects loss → notifies controller → controller recomputes → controller writes new rules to N switches. That's tens of milliseconds minimum, and you're black-holing the whole time. With it, the backup path is _pre-installed_ and the ASIC switches over locally in microseconds when the watch port goes down.

```
    primary: port 2 (watch_port 2)   ── link up? ──► use it
                                          │ no
    backup:  port 3 (watch_port 3)   ◄────┘
```

Same principle, again: precompute in the control plane, execute in the data plane. The controller's job is to have already thought about the failure, not to think about it when it happens.

`INDIRECT` groups are the underrated one for anyone who's fought TCAM limits — instead of 50,000 flow entries each naming an output port, you point 50,000 entries at one group, and next-hop changes become a single `GROUP_MOD`. It's a pointer. Networking rediscovers indirection, film at 11.

---

## The feedback loop

Every flow entry counts packets and bytes. The controller polls with `MULTIPART_REQUEST(FLOW_STATS)` and gets back per-entry counters. Add `PORT_STATUS` (link up/down), `FLOW_REMOVED` (a rule aged out), and you have a telemetry stream.

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
   ┌──────────┐   FLOW_MOD   ┌────────┐   packets  ┌───┴────┐
   │controller├─────────────►│ switch ├───────────►│ network│
   └──────────┘              └────────┘            └────┬───┘
        ▲                         │  counters, events   │
        └─────────────────────────┴─────────────────────┘
                    observe → decide → program → observe
```

This is a control loop in the actual control-theory sense, and it has all the pathologies of one. Poll too fast and you melt the switch CPU (counter reads are CPU work — the ASIC increments them, but somebody has to walk the tables and serialize them into a reply; polling thousands of entries at high frequency is a documented way to make a switch management CPU very unhappy). Poll too slow and you're steering traffic based on a stale picture, which in the pathological case means you oscillate: you see path A congested, move flows to B, by the time you observe again B is congested and A is empty, and you move them back. Classic.

DevoFlow's answer was to push the measurement down: sampling, triggers, and approximate counters in the data plane, so the switch only tells you about things you'd actually act on. OpenSketch (Yu et al., NSDI 2013) took it further with sketch-based measurement primitives in hardware. Both are instances of the same recurring lesson: **the data plane should summarize, not report.**

Timeouts close the loop on the resource side. `idle_timeout` reclaims entries whose flow went quiet; `hard_timeout` reclaims unconditionally. Without them TCAM fills and stays full. With them you get thrash if they're too short. Picking these is empirical and I don't think there's a principled answer — for a learning switch, 30s idle / 300s hard felt fine in my toy and I wouldn't defend it further than that. `¯\_(ツ)_/¯`

And there's a genuinely hard correctness problem hiding here that took the community years: **updating rules across many switches is not atomic.** During an update, packets can see the old rules on switch A and the new rules on switch B, which can produce loops or drops in configurations neither the old nor the new policy would ever allow. Reitblatt et al. (_Abstractions for Network Update_, SIGCOMM 2012) solved this with per-packet consistent updates via version tagging: stamp packets with a version at ingress, have every switch carry rules for both versions, flip the ingress stamp atomically, then garbage-collect. It costs you 2× table space during the transition — which, given everything above about TCAM, is a genuinely painful price. The theory is elegant; the resource bill is the reason people sometimes don't pay it.

---

## What OpenFlow got wrong, and what came next

OpenFlow's central bet was: _there exists one match-action abstraction that fits all switches._ That bet did not fully pay off, and the reason is structural.

The field list grew 12 → ~40 and never stopped wanting to grow, because new encapsulations keep appearing (VXLAN, NVGRE, Geneve, SRv6, and now whatever this year's overlay is). Every one requires a spec revision, an ASIC revision, and a firmware revision. Meanwhile each vendor's real pipeline had different stage counts, different table widths, different action capabilities — so the switch agent had to _compile_ the requested logical tables onto a physical pipeline that might not fit, and when it didn't fit you got the worst possible outcome: it "worked," slowly, in software, and nobody told you. The Table Type Patterns effort was the ONF trying to patch this by letting switches describe their real pipeline, which is a tacit admission that the uniform abstraction had failed.

So the field inverted the question. Instead of _"here is a fixed pipeline, install rules into it,"_ **P4** (Bosshart et al., CCR 2014 — note the same author as RMT, this is not a coincidence, it's a research program) says: _"here is the pipeline I want; compile it to the target."_

```
   OpenFlow                        P4
   ────────                        ──
   fixed field list                you declare your headers
   fixed pipeline shape            you declare your parser (as a state machine!)
   controller installs entries     you declare your tables and actions
                                   ─────────────────────────────────
                                   compile → ASIC / FPGA / DPDK / eBPF
                                   then P4Runtime installs entries
```

The key separation: **pipeline definition at compile time, table population at runtime.** OpenFlow conflated them. Once you split them, the runtime API (P4Runtime) can be generated _from_ your program, so there's no fixed field list to argue about — the schema is whatever you declared. You want to parse a header nobody has invented yet? Write it in your P4 program. This is the thing that made in-band network telemetry (INT) possible, where switches append their own hop-by-hop latency/queue data into passing packets — an idea that is simply inexpressible in OpenFlow's vocabulary.

The software side went the same direction, from the other end. **Open vSwitch** (Pfaff et al., NSDI 2015) is worth reading closely even if you never touch OVS, because it's an honest account of what happens when you implement OpenFlow properly in software and discover the abstraction is too slow: they ended up with a two-level cache — a microflow cache keyed on the exact 5-tuple, backed by a "megaflow" cache holding wildcard entries derived from which bits the full lookup _actually_ consulted — sitting in front of a userspace classifier using tuple space search. It's software rediscovering the TCAM/hash-table split from first principles, by measurement. Then **eBPF/XDP** (Høiland-Jørgensen et al., CoNEXT 2018) went further: run verified bytecode in the kernel at the driver hook, before `sk_buff` allocation, and get multi-Mpps-per-core software forwarding. Cilium is that idea pointed at Kubernetes.

The arc is consistent, and it's the same arc as everywhere else in systems:

```
fixed function  →  configurable  →  programmable  →  compiled from a high-level language

 fixed ASIC        OpenFlow          P4 / eBPF          P4 + INT + verification
 (2000s)           (2008-2015)       (2014- )           (now)
```

Which is more or less what happened to GPUs, to DSPs, to network cards, and to basically every accelerator that survived long enough. Fixed function is fast and inflexible; you make it configurable, then the configuration language becomes complex enough that it wants to be a real language, then you build a compiler, and then the interesting work moves into the compiler. I don't think networking is special here. I think networking just got there about fifteen years after CPUs did, because the 20-cycle budget made the fixed-function phase last much longer.

---

## Reflections

Things that surprised me building this:

**The abstraction is downstream of the memory technology.** I expected OpenFlow's design to be driven by networking semantics. It's mostly driven by TCAM economics. Priorities exist because priority encoders are free. Tables chain forward-only because pipelines don't loop. The 12-tuple exists because that's what 2009's ACL TCAMs held. Once you know the hardware, you can practically re-derive the spec.

**The hard parts weren't the parts the spec talks about.** The spec spends pages on message encodings and almost none on the two things that actually broke my implementation: the flow-install race, and the fact that `FLOW_MOD` is fire-and-forget. Distributed systems problems, dressed as networking.

**"Centralized control" oversells it.** Even in a "centralized" SDN, fast failover is local, learning is local, counters are local, and the controller is a replicated distributed system with its own consistency model (ONIX, OSDI 2010, is explicit about offering you a choice between a strongly-consistent transactional store and an eventually-consistent DHT, and telling you to pick per-application). The centralization is _logical_. Physically you've traded one distributed system you understood — routing protocols, thirty years of hardening — for a different one you wrote yourself last quarter. That trade is sometimes right! B4 says it can be very right. But it should be made with open eyes.

**The security story is genuinely inverted from the pitch.** SDN is marketed as a security win: dynamic policy, IDS-driven quarantine, microsegmentation. All real. But the same interface that lets your IDS install a drop rule in 5 ms is an interface that installs _whatever the controller says_ in 5 ms, and the controller's inputs include LLDP frames from untrusted hosts and `PACKET_IN`s from whoever is sending you traffic. You've made the network programmable by the network's own traffic. Handle accordingly.

---

## Looking forward

The 20-cycle budget doesn't improve. Per-port line rates went 10G → 25G → 100G → 400G → 800G while clock frequencies went basically nowhere, so the per-packet cycle budget has been shrinking for two decades and will keep shrinking. Every architectural shift in this post — ASIC offload, pipelining, TCAM, then programmable pipelines, then SmartNICs and DPUs — is a response to that same tightening constraint. I'd bet the next decade's answers are more of the same shape: push more logic into the data plane, and make the compiler smarter about placing it.

The part I find most interesting to speculate about is verification. Once the pipeline is a program, "is my network correct?" becomes a program-analysis question, and there's already a real body of work treating it that way: Header Space Analysis (Kazemian et al., NSDI 2012) treats packets as points in a 2^L space and forwarding as transforms on it; VeriFlow (Khurshid et al., NSDI 2013) checks invariants in real time as rules are installed; NetKAT (Anderson et al., POPL 2014) gives the whole thing a sound and complete equational theory. That's a genuinely startling sentence — _networks have a Kleene algebra now_ — and I suspect it's where the field's long-term leverage actually is. Not "can I program the network" (yes, solved) but "can I prove the program does what I meant" (mostly not yet, in production).

If you want to actually understand this rather than have read about it, build the thing. Take the parser above, add the flow table, wire two of them together over a socket, write a controller that does shortest-path over the topology, then run it under Mininet against real traffic. The bugs you hit — the SYN you dropped, the race you didn't handle, the table you filled — are the entire curriculum, and they arrive in roughly the order the field encountered them historically, which is a nice bonus.

Then go read RMT and try to explain why your `sort(key=-priority)` is a priority encoder. Once that clicks, the rest is details.

---

## References

**Foundational**

- N. McKeown et al., _OpenFlow: Enabling Innovation in Campus Networks_, ACM SIGCOMM CCR 38(2), 2008. — https://dl.acm.org/doi/10.1145/1355734.1355746
- M. Casado et al., _Ethane: Taking Control of the Enterprise_, SIGCOMM 2007. — OpenFlow's direct predecessor.
- N. Feamster, J. Rexford, E. Zegura, _The Road to SDN: An Intellectual History of Programmable Networks_, ACM CCR 44(2), 2014. — best single orientation piece.
- A. Greenberg et al., _A Clean Slate 4D Approach to Network Control and Management_, CCR 2005.
- IETF RFC 5810, _Forwarding and Control Element Separation (ForCES) Protocol Specification_, 2010.

**Hardware / data plane**

- P. Bosshart et al., _Forwarding Metamorphosis: Fast Programmable Match-Action Processing in Hardware for SDN_, SIGCOMM 2013. — the RMT architecture. Read this one.
- P. Bosshart et al., _P4: Programming Protocol-Independent Packet Processors_, ACM CCR 44(3), 2014. — https://p4.org/
- B. Agrawal, T. Sherwood, _Modeling TCAM Power for Next Generation Network Devices_, ISPASS 2006/2008.
- B. Pfaff et al., _The Design and Implementation of Open vSwitch_, NSDI 2015. — https://www.usenix.org/conference/nsdi15/technical-sessions/presentation/pfaff
- T. Høiland-Jørgensen et al., _The eXpress Data Path: Fast Programmable Packet Processing in the Operating System Kernel_, CoNEXT 2018.

**Scale, control, production**

- T. Koponen et al., _Onix: A Distributed Control Platform for Large-scale Production Networks_, OSDI 2010.
- S. Jain et al., _B4: Experience with a Globally-Deployed Software Defined WAN_, SIGCOMM 2013.
- A.R. Curtis et al., _DevoFlow: Scaling Flow Management for High-Performance Networks_, SIGCOMM 2011. — the "controller is not free" paper.
- M. Yu, L. Jose, R. Miao, _Software Defined Traffic Measurement with OpenSketch_, NSDI 2013.

**Correctness & verification**

- M. Reitblatt et al., _Abstractions for Network Update_, SIGCOMM 2012.
- P. Kazemian, G. Varghese, N. McKeown, _Header Space Analysis: Static Checking for Networks_, NSDI 2012.
- A. Khurshid et al., _VeriFlow: Verifying Network-Wide Invariants in Real Time_, NSDI 2013.
- C.J. Anderson et al., _NetKAT: Semantic Foundations for Networks_, POPL 2014.

**Security**

- S. Shin et al., _AVANT-GUARD: Scalable and Vigilant Switch Flow Management in Software-Defined Networks_, CCS 2013.
- S. Hong et al., _Poisoning Network Visibility in Software-Defined Networks: New Attacks and Countermeasures_ (TopoGuard), NDSS 2015.
- T. Ptacek, T. Newsham, _Insertion, Evasion, and Denial of Service: Eluding Network Intrusion Detection_, 1998. — for the parser-ambiguity section.
- S. Scott-Hayward, S. Natarajan, S. Sezer, _A Survey of Security in Software Defined Networks_, IEEE COMST, 2016.

**Specs & diagrams**

- ONF, _OpenFlow Switch Specification v1.3.5 and v1.5.1_ — the pipeline and flow-entry figures (Fig. 2–3 in most versions) are the canonical diagrams. https://opennetworking.org/software-defined-standards/specifications/
- ONF, _SDN Architecture_ (TR-521) — the application/control/infrastructure layer diagram everyone redraws.
- Open vSwitch architecture diagram — https://docs.openvswitch.org/en/latest/topics/design/
- P4 PISA / v1model architecture figures — https://p4.org/specs/ and the p4lang/tutorials repo.
- Cisco/Broadcom public switch-architecture diagrams for the PHY→MAC→pipeline→traffic-manager block layout (vendor docs; useful as a reality check against the idealized spec diagrams).

_One honesty note on the references: I wrote these from memory of the literature rather than re-fetching each one, so titles/venues/years are right to the best of my knowledge but worth a quick verify before you cite them in anything load-bearing. The three I'd stake the most on are RMT, DevoFlow, and the OVS paper — those are the ones where the specific technical claims in this post came from._
