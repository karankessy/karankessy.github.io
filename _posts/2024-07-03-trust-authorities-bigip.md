---
layout: post
title: "Understanding Trust Authorities in BIG-IP Systems: A Beginner's Guide"
date: 2024-07-03 10:00:00
description: Device trust in BIG-IP decides which systems can vouch for new members of a trust domain. The three authority roles, what each can do, and the prerequisites that catch people out.
tags: f5-bigip security networking
categories: networking
---

Before two BIG-IP systems will sync configuration or fail over to each other, they have to trust each other. That trust is built on x509 certificates, and device trust is the machinery that decides which systems are allowed to sign those certificates for everyone else.

Getting the roles wrong is the kind of mistake you find out about later, at the point where you need to add a device and discover you are doing it from a system that cannot.

---

## The three roles

A device in a local trust domain holds one of three roles.

**Certificate Signing Authority (CSA).** A CSA can sign x509 certificates for other BIG-IP systems, which means it is the role that can admit new devices into the trust domain. When you build a trust domain, you are configuring it from a CSA.

**Peer authority.** When two CSAs establish mutual trust, they are peers. Both hold signing authority over the same domain, so if one becomes unavailable the other can still admit devices and the domain keeps functioning. This is the redundancy story, and it is the reason you generally want more than one authority.

**Subordinate non-authority (SNA).** An SNA is a member of the trust domain but cannot sign certificates and cannot admit new devices. It participates without carrying the authority.

The SNA role exists because signing authority is a privilege worth withholding. A device in a lower-trust network zone can still be part of the domain without being able to extend it, which limits what an attacker gains by compromising it.

---

## Prerequisites

Three things to have settled before you start.

**Version.** Only systems running 11.x or later can join a local trust domain. Check this first, because the failure is not obvious.

**Where you configure from.** Device trust cannot be managed from a subordinate non-authority. Configuration has to happen on a CSA. This is the one that catches people out, and it usually surfaces mid-task, when you are already on the wrong box.

**Addresses.** Config sync, failover, and mirroring addresses need to be set before you add a device to the domain. These are how trust domain members actually talk to each other, and adding a device before they are configured leaves you with a trust relationship that exists on paper and does not carry traffic.

---

The mental model that helps: device trust is a small internal PKI. A CSA is a CA, an SNA is a leaf that holds a certificate without the ability to issue any, and peer authorities are two CAs cross-signing so neither is a single point of failure.

Once you see it that way, the rules stop being arbitrary. They are the same rules any PKI has about who gets to issue certificates and what happens when that key is somewhere it should not be.
