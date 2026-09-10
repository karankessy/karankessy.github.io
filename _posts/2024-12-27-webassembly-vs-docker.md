---
layout: post
title: "WebAssembly: Will this replace Docker?"
date: 2024-12-27 15:46:20
description: WebAssembly vs Docker. WASM, a technology that revamped the way we thought about containerization.
tags: containers systems
categories: systems
og_image: /assets/img/wasm2.png
thumbnail: assets/img/wasm2.png
---

Docker shipped a technical preview integrating WebAssembly, and the question that followed was whether WASM eventually replaces containers.

I think the question is framed wrong, and the reason is that the two technologies are solving different problems that happen to look similar from a distance. Worth working through what each one actually does before comparing them.

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/wasm-docker-hero.png" alt="WebAssembly and Docker side by side" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>

---

## WebAssembly

WASM is a binary instruction format. You compile C, C++, or Rust into it, and a runtime executes it.

{% include figure.liquid loading="eager" path="assets/img/wasm2.png" class="img-fluid rounded z-depth-1" zoomable=true %}

It started in the browser, alongside HTML, CSS, and JavaScript, so that heavy applications could run on a web page at close to native speed. Tools like Emscripten compile existing C codebases into it.

The part that made it interesting outside the browser is that the format does not assume a browser. Any system with a WASM runtime can execute the binary, in the way that the JVM runs bytecode or CPython runs its own. The binary is platform-neutral: same module, different operating systems and processor architectures, no recompilation.

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/wasm-runtime-diagram.png" alt="WASM runtime executing modules outside the browser" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>

On its own a WASM module can do nothing but compute. It has no file access, no network, no clock. WASI is the interface that grants those capabilities explicitly, and that is what makes server-side WASM possible at all.

That detail is also the security story. A container starts with broad access to a namespaced view of a system and you restrict from there. A WASM module starts with nothing and you grant from there. Deny-by-default is a meaningfully different starting position.

---

## Docker

Docker packages an application together with its dependencies into an image, and runs that image as a container.

The problem it solves is environment drift. Running a C program on someone else's machine means the right compiler, the right libraries, the right paths. The image carries all of it, so the program runs the same on a colleague's laptop as on a server.

Underneath, a container is not a virtual machine. It is a process on the host kernel, isolated with namespaces and cgroups. That is why containers are cheap compared to VMs, and it is also why an image built for Linux on x86 does not run on a different kernel or architecture.

---

## Comparing them

{% include figure.liquid loading="eager" path="assets/img/wasm3.png" class="img-fluid rounded z-depth-1" zoomable=true %}

**What gets packaged.** Docker ships a filesystem: your binary plus the libraries and userland it needs. WASM ships a compiled module and nothing else, with WASI supplying system access at runtime.

**Portability.** A Docker image is tied to an OS and architecture. A WASM module is not. This is the clearest advantage WASM has.

**Size and startup.** Container images run tens to hundreds of megabytes and start in seconds. WASM modules are typically a few megabytes and start in milliseconds. That startup difference is what makes WASM attractive for serverless and edge workloads, where cold start is the dominant cost.

**Isolation model.** Containers share the host kernel and are isolated by namespaces. WASM runs in a sandbox with no capabilities until granted. Different mechanisms, and the WASM model is the more restrictive by default.

---

## So, replacement?

No, and the size and startup numbers are a hint as to why.

A WASM module is small because it does not carry a userland. That is a benefit when your workload is a self-contained computation and a hard limitation when your workload is PostgreSQL, or anything that expects a filesystem, a process model, threads, and a full libc. Containers carry all of that because plenty of software genuinely needs it.

Docker's own integration reflects this. It runs WASM containers alongside Linux and Windows containers under the same tooling, rather than as a migration path off them. You get one workflow, one registry, one orchestrator, with the right runtime per workload.

The likely shape is boring and reasonable: WASM for short-lived, compute-shaped, cold-start-sensitive work at the edge and in plugin systems, containers for long-running services with real system dependencies, both under the same management layer.

The interesting thing about WASM is not that it might displace containers. It is that a portable, deny-by-default, millisecond-start execution format is a genuinely new primitive, and the useful question is what that enables rather than what it replaces.
