---
layout: post
title: "Performance HTTP Virtual Servers and the Fast HTTP Profile in BIG-IP"
date: 2024-06-09 10:30:00
description: The Fast HTTP profile trades away most of the BIG-IP feature set for lower CPU and latency. What you give up, what you get, and why F5 still recommends the standard HTTP profile for internet traffic.
tags: f5-bigip networking http
categories: networking
---

The Fast HTTP profile is one of those options that looks obviously good until you read the list of things it cannot do. It is faster. It uses less CPU. F5 still recommends you do not use it for normal internet traffic, and the reason is the list.

---

## What a Performance HTTP virtual server is

A Performance HTTP virtual server gets a Fast HTTP profile assigned by default. The Fast HTTP profile is a stripped-down version of the standard HTTP profile that folds in pieces of the TCP, HTTP, and OneConnect profiles.

The important architectural difference is that it does not use the full proxy architecture. A standard virtual server terminates the client connection and opens a separate server-side connection, giving BIG-IP full visibility and control over both sides independently. Fast HTTP works packet by packet instead.

That single decision is where both the speed and every limitation come from.

---

## Where it works

The profile assumes the traffic is well behaved. Specifically:

- Clients and servers are reliable and predictable
- Protocol headers fit in a single packet
- The network is clean, with few dropped or out-of-order packets
- Traffic often comes from load generators

That last one is a hint about the intended use. This profile is well suited to controlled environments and load testing, and less suited to the open internet, where none of the first three assumptions hold reliably.

---

## What you give up

This is the part that decides it.

It requires SNAT. That caps you at roughly 65,536 connections per source-destination pair, though unique socket pairs change the arithmetic.

It is incompatible with a long list of features:

- PVA acceleration
- Virtual server authentication
- State mirroring
- HTTP pipelining
- TCP optimizations
- IPv6
- SSL offloading
- Compression and caching

iRule support is minimal, restricted to L4 operations, HTTP headers, and pool selection. Header manipulation is limited to static text insertion.

And because headers have to be processed in order, it drops out-of-order TCP packets that contain HTTP headers.

Read that list against a normal internet-facing application. No SSL offload and no IPv6 alone rule it out for most deployments.

---

## OneConnect and HTTP 1.0

The one place the profile does something clearly clever is connection reuse with older clients.

HTTP 1.0 has no keep-alive, so a client closes the connection after each request. That means a new backend connection per request, which is expensive at volume.

The OneConnect behaviour in the Fast HTTP profile rewrites the `Connection` header to `Keep-Alive` and holds the server-side connection open, reusing it for subsequent requests. If no idle connection is available when one is needed, it opens a new one.

The client still behaves like an HTTP 1.0 client. The backend stops paying for it.

---

## Choosing

Use Fast HTTP when the environment is controlled, the traffic is predictable, latency and CPU matter more than features, and you have checked that nothing on the incompatibility list is something you need.

Use the standard HTTP profile everywhere else, which in practice means almost all internet-facing traffic.

The profile is not a general-purpose optimization. It is a narrow tool that buys speed by removing the machinery that makes BIG-IP useful, and it is worth exactly as much as that trade is worth in your specific case.
