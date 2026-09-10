---
layout: post
title: Three Essential HTTP Routing Patterns
date: 2025-04-18 12:13:30
description: Host-based, path-based, and header-based routing. What each one reads from the request, what that costs you, and why the Host header sits in its own category.
tags: http networking
categories: networking
---

Every reverse proxy, ingress controller, and load balancer is answering the same question: given this request, which backend gets it. There are only really three places to look for the answer, and which one you pick has consequences beyond routing.

---

## 1. Host-based

Route on the `Host` header. Several domains resolve to the same address, and the proxy separates them by the name the client asked for.

```
Host: api.example.com      ──►  api service
Host: app.example.com      ──►  frontend
Host: admin.example.com    ──►  admin service
```

This is the oldest of the three, and it is what virtual hosting has meant since HTTP/1.1 made the `Host` header mandatory. Before that, a server could not tell which site a request was for and you needed an IP address per site.

The thing that matters in practice is TLS. Each hostname needs a certificate that covers it, so you are managing a SAN certificate, a wildcard, or per-host certificates. Host-based routing pushes work into certificate management that path-based routing does not.

What it buys you is clean separation. Different domains can have genuinely different security postures, different certificates, and can be moved to different infrastructure later without any client-visible URL change.

---

## 2. Path-based

Route on the URI path.

```
http://api.example.com/getprofile/v1/123456
                      └──────────────────┘
                              path
```

One hostname, one certificate, requests split by prefix. `/api` to one service, `/static` to another, `/v2` to a newer deployment.

This is the dominant pattern in container orchestration, and the reason is that it composes well with ingress controllers. Adding a service means adding a path rule, not provisioning a hostname and a certificate.

The catch is that the path is part of your public API. A service mounted at `/api/v1/users` has that prefix baked into every client, every bookmark, and every integration. Moving it later is a breaking change or a permanent redirect you maintain forever. Hostnames are comparatively easy to repoint via DNS; paths are not.

Path rewriting helps, and introduces its own confusion when the path the backend sees differs from the path the client sent. That mismatch shows up in logs, in generated URLs, and in redirects, and it is a recurring source of bugs.

---

## 3. Header-based

Route on any other header, or on a cookie.

This is the flexible one and the one to use most sparingly.

It covers cookie-based session persistence, sending a client back to the backend that holds its session. It covers A/B testing and canary releases, where a header or cookie decides whether a request reaches the new version. It covers feature flags and internal-only routing on a custom header.

The `Host` header is excluded from this category by convention, because host-based routing is its own well-understood thing with its own certificate implications.

Two cautions. Routing on a header that a client controls is a trust decision: if a custom header sends requests to an internal or preview backend, anyone can set that header. Strip or validate it at the edge. And header-based rules are invisible in the URL, which makes them the hardest of the three to debug, because the request that failed looks identical to the one that worked.

---

## Choosing

These are not alternatives so much as layers, and real deployments use all three at once: host to pick the environment, path to pick the service, header to pick the version.

The useful instinct is to route on the most stable attribute that distinguishes the traffic. Hostnames change rarely. Paths change more often and are harder to change. Headers change constantly and are invisible.

Push routing decisions toward the stable end where you can, and reserve header-based rules for the things that are genuinely dynamic, like rollouts and session affinity, rather than for structure that ought to be visible in the URL.
