---
layout: post
title: "F5 TMOS Administration Essentials: Critical Concepts to be Remembered"
date: 2024-07-18 10:30:00
description: The order TMOS evaluates an incoming packet, what to check when traffic does not arrive, and a handful of behaviours that are not obvious from the configuration screens.
tags: f5-bigip networking
categories: networking
---

Most BIG-IP troubleshooting comes down to one question: where did the packet stop. Answering it requires knowing the order TMOS evaluates things, because the order is what tells you which checks are already ruled out by the time traffic reaches the place you were looking.

---

## Packet processing order

An incoming packet is evaluated in this sequence:

1. **Connection table.** Existing connections match here first and skip the rest of the path. This is why a change to a virtual server often has no effect on traffic already flowing, and why deleting the connection is sometimes the actual fix.
2. **Packet filter rules.** Allow or deny based on configured criteria.
3. **Virtual server match.** Which virtual server, if any, handles this connection. Most specific match wins.
4. **SNAT.** Does the traffic match a SNAT configuration.
5. **NAT.** Does it need translation between VLANs.
6. **Self-IP.** Does the destination match a self-IP on the box.
7. **Drop.** Nothing matched, packet discarded.

The practical value is elimination. Traffic not reaching a pool member and not appearing in virtual server stats means it did not survive to step 3, so the pool is not where to look. Existing connections behaving differently from new ones points at step 1.

---

## What to check, in order

- **Virtual server stats.** Is traffic arriving at all. This splits the problem in half immediately.
- **Pool and pool member stats.** Traffic arriving but not distributing.
- **Connection table.** What is actually established right now.
- **Logs.** `/var/log/ltm` first.
- **Routing table.** Especially on multi-VLAN configurations.
- **Ping, telnet, curl from the box.** Verifies pool member reachability from BIG-IP itself rather than from your workstation, which is a different path.
- **Packet capture.** `tcpdump` when the stats disagree with what you believe is happening. It settles arguments.

---

## Behaviours that are not obvious

**Fallback persistence runs concurrently, not as a backup.** This is the one that surprises people. The name suggests it engages when primary persistence fails. It does not. Both records are maintained at the same time, as a key-value pair, for example cookie mapped to source IP. If you configured it expecting a failover behaviour, it is not doing what you think.

**Priority group activation.** With six servers running two applications, three primarily each, PGA lets you express that preference so traffic goes to the intended group while the others stay available underneath.

**Connection mirroring.** Mirrors connection state to the peer so that a failover does not drop established connections. Worth knowing it costs resources, so it is applied selectively rather than everywhere.

**Persistence netmask.** A netmask of `255.255.255.255` gives each unique source IP its own persistence record. Anything broader groups clients together, which is occasionally what you want and more often the cause of a persistence bug.

---

## Two administrative notes

Restoring an archive can cause downtime. Plan it as a maintenance activity rather than a quick fix.

Archives contain private keys. Treat them with the same care as the keys themselves, which means being deliberate about where they are stored and who can read them.

Restoring a UCS from the command line:

```bash
load/sys ucs <filepath> passphrase <password>
```

---

None of this is difficult individually. What makes TMOS troubleshooting hard is that the components interact, and the processing order is the thing that tells you which interactions are even possible. Knowing that a packet is evaluated against the connection table before anything else eliminates entire categories of wrong theory before you start.
