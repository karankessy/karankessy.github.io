---
layout: post
title: "Reject Virtual Servers in BIG-IP LTM: Purpose and Practical Use Cases"
date: 2024-06-17 11:30:00
description: A Reject virtual server drops unwanted traffic without building a connection table entry. Why that matters at volume, and how it differs from blocking the same traffic elsewhere.
tags: f5-bigip networking security
categories: networking
---

There are several places you can block traffic on a BIG-IP. The Reject virtual server is the cheapest of them, and the reason is what it does not do rather than what it does.

---

## What it is

A Reject virtual server resets connections that match it. Traffic hits it, gets a reset, and never reaches a pool.

The interesting part is the cost. It behaves like a FastL4 profile, so the reset is handled without engaging the software stack, and it does not maintain a connection table entry for the traffic it rejects.

That second point is the one worth sitting with. A normal virtual server tracks every connection it handles. Under a flood of unwanted traffic, that table is itself the resource under pressure, and the memory is being spent on connections you have already decided to throw away.

A Reject virtual server does not spend it.

---

## Configuring one

Set the Source Address field to the network and mask you want to reject. For a known-bad network:

```
Source Address:      192.168.10.0/24
Destination:         <your VIP or network>
Type:                Reject
```

Anything arriving from `192.168.10.0/24` gets reset. Everything else continues to be matched against your other virtual servers normally.

Virtual server matching on BIG-IP is most-specific-wins, which is what makes this usable: a Reject VS with a specific source can sit alongside a general virtual server with a wildcard source, and the specific one takes precedence for the traffic it covers.

```
      192.168.10.0/24  ────────►  Reject VS  ────►  RST, no conn table entry
                                  (source match, most specific)

      all other traffic ────────►  Standard VS ────►  Pool ────►  Backend
```

---

## Where it fits

The value is proportional to volume. For a handful of blocked addresses, an AFM rule or an iRule does the job and gives you better logging and more expressive matching.

The Reject virtual server earns its place when the volume is high enough that connection tracking and software-stack processing are themselves the cost you are trying to avoid. Blocking a noisy scanning range, shedding traffic from a network you have no relationship with, keeping known-bad sources off the box entirely.

The tradeoff is expressiveness. Source address and mask is all you get. No inspection, no conditional logic, and the logging is thin compared to a firewall rule, which matters if you need to answer questions later about what you dropped and why.

So it is not a firewall replacement. It is the right tool when you already know what you want gone, you want it gone as early and cheaply as possible, and you do not need to reason about it afterwards.
