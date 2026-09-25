---
layout: post
title: "The Ambulance Behind the Truck: Why TCP Struggles in the Datacenter, and What Homa Does Differently"
date: 2026-09-25
description: "A transport protocol out of Stanford treats messages, not streams, as the unit that matters — and prioritizes by what's left to send, not what arrived first. Notes from throughput work on F5 ADC and S3/MinIO infrastructure carrying AI workloads."
tags: networking systems ai-infrastructure
categories: infrastructure
toc:
  sidebar: left
published: true
---

_Notes from throughput work on F5 ADC and S3/MinIO infrastructure, and a protocol out of Stanford that reframes what a network is supposed to optimize for._

I keep coming back to the same feeling: TCP starts showing its age exactly when a network gets extremely fast, extremely busy, and the data moving through it gets extremely mixed. Congestion happens. Packets drop. Retransmissions follow. Queues build up. And somewhere in that queue, a few bytes of metadata end up waiting behind something a thousand times its size.

That's not a hypothetical. It's what I kept seeing while working on large-scale throughput optimization at enterprise scale — specifically, moving AI workloads through F5 ADC and S3/MinIO infrastructure. The thing that stood out wasn't the volume. It was the variety.

## The problem isn't speed. It's what's sharing the lane.

On that infrastructure, you have large objects — model checkpoints, sharded weights, big S3/MinIO payloads — moving through the same pipes as an enormous number of small messages: metadata, control information, RPCs, requests, responses, fragments of application state.

From the network's point of view, all of that is just packets. Bytes to move from A to B, no different from each other.

From the application's point of view, it is absolutely not the same. A few bytes of metadata stuck behind a large transfer can matter more than the transfer itself — a control-plane message that's late is a stalled pipeline, a health check that's late is a false failure, a small RPC that's late is a tail-latency outlier that drags your p99 somewhere embarrassing.

TCP has no concept of that distinction. It sees a byte stream and delivers it in order, first-in, first-out, per connection. It doesn't know that the four bytes behind the two-hundred-megabyte checkpoint transfer are more urgent than the checkpoint itself. It can't know — that information doesn't exist at the transport layer TCP was designed for.

That gap sent me back to something I'd bumped into before and hadn't looked at closely enough: **Homa**.

## Homa, in one sentence

Homa is a transport protocol built at Stanford by John Ousterhout and collaborators, designed specifically for datacenter networks, and its central move is to stop treating traffic as competing streams and start treating it as **messages with a size**, scheduled by a receiver that can see the whole picture arriving on its link.

The paper that makes the case most directly is blunt about it. From the abstract of [_"It's Time to Replace TCP in the Datacenter"_](https://arxiv.org/abs/2210.00714) (arXiv:2210.00714):

> "In spite of its long and successful history, TCP is a poor transport protocol for modern datacenters. Every significant element of TCP, from its stream orientation to its expectation of in-order packet delivery, is wrong for the datacenter... It is time to recognize that TCP's problems are too fundamental and interrelated to be fixed; the only way to harness the full performance potential of modern networks is to introduce a new transport protocol into the datacenter."

That's a strong claim, and I want to sit with why it's not just contrarian noise. TCP was built for a world of long-lived, roughly-equal-priority connections over unreliable, low-bandwidth links. A modern datacenter is close to the opposite: short-lived, wildly unequal-priority messages over links so fast that the bottleneck usually isn't bandwidth, it's queueing and scheduling.

## What actually changes: sender-driven vs. receiver-driven

Here's the mechanism, and it's worth drawing out because it inverts something most of us don't think to question. TCP is sender-driven — the sender decides how much to push based on acks and inferred congestion signals, and the network's job is mostly to deliver bytes in the order they were sent.

Homa flips who's in charge. It's **message-oriented and receiver-driven**. The receiver has the better vantage point — it can see everything landing on its link, from every sender, at once — so it decides which messages get bandwidth next, rather than each sender independently guessing.

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        <img src="/assets/img/homa/tcp-vs-homa-queue.svg" alt="Diagram comparing TCP's single FIFO queue, where a large object blocks small RPC and metadata messages behind it, against Homa's receiver-driven scheduling, where small messages are interleaved ahead of the large transfer" class="img-fluid rounded z-depth-1"/>
    </div>
</div>
<div class="caption">
    TCP delivers in arrival order down one queue. Homa lets the receiver interleave short messages ahead of a large transfer that's still in flight.
</div>

The scheduling rule itself is close to a classic result from operating systems theory, applied to network scheduling: approximate **shortest-remaining-processing-time (SRPT)**. Rank messages by how many bytes they have left to send, not by when they arrived, and let the ones closest to finishing go first.

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        <img src="/assets/img/homa/srpt-scheduling.svg" alt="Timeline diagram showing a large 200 megabyte object being scheduled around shorter metadata and RPC messages, which are prioritized because they have fewer bytes remaining" class="img-fluid rounded z-depth-1"/>
    </div>
</div>
<div class="caption">
    Rank by bytes remaining, not arrival time. The large transfer still completes — it just yields whenever something smaller shows up.
</div>

Put plainly: **finish the small thing first.** It sounds obvious once you say it from the application's point of view. It is not how TCP, or most transport protocols built in TCP's shadow, actually behave.

## The specific problems Homa is aimed at

None of this is scheduling theory for its own sake. Each piece is aimed at a concrete failure mode that gets worse as datacenters get faster and busier.

**Tail latency.** A network can have a fine average latency and still be miserable for its slowest one percent of requests — and that slowest one percent is usually where short, latency-sensitive messages live, stuck behind something bigger. The [Homa project's own documentation](https://homa-transport.atlassian.net/wiki/spaces/HOMA/overview#replaceTcp) states the target directly: Homa aims at reducing "tail latency by an order of magnitude or more," particularly for short messages in loaded systems. That's the number I'd want reproduced independently before leaning on it too hard, but it tells you exactly what problem the design is optimizing for.

**Head-of-line interference.** A small, latency-sensitive message shouldn't have to wait behind a large transfer purely because they happen to share a link. That's the whole picture in the first diagram above — it's not a corner case, it's the default behavior of a FIFO byte stream carrying mixed traffic.

**Reactive congestion control.** TCP mostly finds out about congestion after it's already happened — a dropped packet, a delayed ack, a signal that pressure already built up somewhere. Homa tries to move more of that decision earlier, to the receiver, before the pressure turns into loss. The project describes this as eliminating "core congestion in datacenter networks" rather than reacting to it after the fact.

**Unnecessary queueing.** Big queues keep links busy, which looks efficient on a utilization graph, but they also drag down the latency of everything sitting behind them. Homa tries to control what gets admitted and scheduled instead of just letting queues absorb the mismatch.

**Mixed message sizes.** This is the one that mapped most directly onto what I was actually looking at on the F5/S3/MinIO side. Datacenter workloads are rarely uniform — they're a genuine mix of enormous and tiny, and a protocol that assumes one typical message size will always be wrong for a meaningful fraction of the traffic. Homa's SRPT-style approximation is built explicitly to handle that mixture without sacrificing the utilization you get from a long transfer running underneath it.

There's a secondary claim worth naming too, because it's less about latency and more about implementation cost: the wiki states Homa "eliminates the high overheads of per-connection state," which is TCP's other quiet tax — every connection carries state that has to be tracked, and that state doesn't scale for free when a service is fanning out to thousands of peers.

## Why this matters more for AI infrastructure specifically

This is where the F5 ADC / S3/MinIO throughput work made the idea click rather than stay academic. AI systems are generating exactly the kind of heterogeneous traffic mix this design targets, and the mix is getting worse, not better, as systems get more distributed:

- large model weights and checkpoints
- embeddings
- metadata
- RPCs between services
- control-plane messages
- object storage traffic (S3/MinIO reads and writes)
- distributed inference requests
- intermediate results between pipeline stages
- small messages happening at very high frequency

None of that is "just data" anymore in any way that a single transport priority level can represent honestly. It's data with very different meanings and very different latency budgets, sharing the same wires. As we push toward 100/400/800G networks and more distributed inference and training, the question stops being purely "how fast can we move the data" and starts being **"which data should move first."**

## Where I'd push back, or at least stay cautious

I don't want to write this up as a solved problem, because it isn't one, and the source material doesn't pretend otherwise either.

Homa is not API-compatible with TCP. The paper's own abstract is explicit that adoption would have to happen through integration with RPC frameworks, not a drop-in socket replacement — that's a real deployment cost, not a footnote.

The receiver-driven model depends on switch priority support and receiver-side scheduling logic that existing infrastructure mostly doesn't have configured for this purpose. Buffering behavior, compatibility with existing middleboxes and load balancers (the exact layer I was already working in with F5 ADC), and the complexity of implementing this correctly in production are all real, unresolved-by-a-paper engineering problems.

And the headline latency numbers are Stanford's own benchmark environment. I'd want to see them reproduced against DCTCP and TCP in someone else's production topology, under someone else's traffic mix, before treating "an order of magnitude" as a number that travels.

None of that makes the direction wrong. It makes it early, and worth watching rather than worth assuming.

## The actual question

Homa doesn't solve networking. What it does is name a question that TCP's design never had to ask, because TCP was built for a world where that question mattered less: **not every packet carries the same stakes, so why does the transport layer treat them as if they do?**

Sometimes the highway is wide enough. The problem is putting every vehicle in the same queue and then being surprised the ambulance is stuck behind the truck.

**Sources:**

- J. Ousterhout, ["It's Time to Replace TCP in the Datacenter,"](https://arxiv.org/abs/2210.00714) arXiv:2210.00714, 2022.
- [Homa project wiki](https://homa-transport.atlassian.net/wiki/spaces/HOMA/overview#replaceTcp), homa-transport.atlassian.net.
