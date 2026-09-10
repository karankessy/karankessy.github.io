---
layout: post
title: "How We Fixed Critical Connectivity Issues in Our vKYC Application: A Technical Deep Dive"
date: 2024-11-26 10:00:00
description: Users stuck buffering in a video KYC application. The packets never reached the load balancer, and the fix ended up being a firewall policy and a protocol setting we expected to need.
tags: troubleshooting networking security f5-bigip
categories: networking
---

Our video KYC application had a problem that kept coming back. Users would connect and then sit buffering, repeatedly, with no clean failure to point at. Nothing in the application logs suggested the application was at fault.

This is the writeup of how we found it, including the part where the eventual fix was the opposite of what we first configured.

---

## Narrowing it down

The useful move early was packet capture under different network paths, because it splits the problem before you start theorising.

Bypassing the normal network path, everything worked. UDP and STUN packets flowed and calls established. Routing the same traffic through the F5 load balancer, nothing. No UDP, no STUN.

That is a clean result, and it pointed at the load balancer. It also turned out to be misleading, which is worth flagging: the comparison told us the problem was somewhere on that path, not that it was in the device at the end of it.

---

## Where the packets actually stopped

The F5 was the obvious suspect, so we checked whether the traffic was arriving at all.

It was not. Working back through the path to the Palo Alto firewall and reading its logs, we found the packets were being dropped there. They never reached the load balancer, which meant every hour we might have spent on virtual server and profile configuration would have been spent in the wrong place.

The bypass path worked because it did not traverse the same firewall policy. The failing path did.

---

## The fix

Two parts.

First, the firewall policy. We cloned the existing bypass policy, which we already knew passed this traffic correctly, and adapted it for the real path rather than writing a new one from scratch. Then we brought the F5 WAF security zone into the policy so the traffic was permitted across the zones it actually crossed.

Second, SIP. Video KYC signalling runs over SIP, and the Palo Alto SIP Application Layer Gateway rewrites SIP payloads to try to help NAT traversal along. That help is frequently the problem, because the ALG rewrites addresses in ways that conflict with what the application and STUN are already negotiating.

We first enabled SIP with the ALG disabled, and traffic started passing. Then we tried disabling the SIP protocol handling entirely, expecting it to be worse.

It was better. With SIP handling off completely, the firewall stopped interpreting the signalling at all and simply forwarded it, and the application handled its own NAT traversal through STUN, which is what it was designed to do.

---

## What I took from it

The first measurement gave us a true fact and a false conclusion. Traffic failed through the load balancer path, so the load balancer looked responsible. The actual failure was upstream, and the only reason we did not spend a long time in the wrong device is that we checked whether the packets were arriving before we started changing configuration.

The other lesson is about protocol-aware middleboxes. SIP ALG, and the general class of firewall features that inspect and rewrite application protocols, exist to solve NAT problems from an era when endpoints could not solve them themselves. Modern WebRTC-style stacks negotiate their own paths. A middlebox helpfully rewriting that negotiation is not neutral, and turning the helpfulness off is a legitimate fix rather than a workaround.

Check where the packet stops before deciding what is broken. The device you suspect is often just the first one you can see.
