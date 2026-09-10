---
layout: post
title: Threat Classification
date: 2024-09-26 15:41:15
description: Known-knowns, known-unknowns, unknown-knowns, unknown-unknowns. The four quadrants are a familiar framing, and the interesting one is the quadrant that is a choice rather than a gap in knowledge.
tags: security
categories: security
---

The four-quadrant framing of threats is borrowed from Rumsfeld, and it gets repeated often enough that it can feel like a formality. It is worth more than that, mostly because one of the four is not really about knowledge at all.

---

**Known-knowns** are threats you have documented and have controls for. Known vulnerability, known patch, known process. This quadrant is where most security programmes spend most of their effort, and it is the one that shows up well in reports because it is measurable.

**Known-unknowns** are threats you are aware of but do not fully understand. You know the category exists and cannot yet characterise the specific risk, its likelihood, or its blast radius. Research, threat intelligence, and testing move things from here into known-knowns.

**Unknown-unknowns** are the threats nobody has seen yet. Novel techniques, undiscovered vulnerabilities, attacks that do not resemble anything in your model. You cannot enumerate these by definition, which is the argument for defence in depth and for resilience over prediction: you are building for the case where the specific thing was never on the list.

**Unknown-knowns** are the interesting quadrant.

---

## The quadrant that is a decision

An unknown-known is a threat somebody in the organisation already knows about, and the organisation behaves as though it does not.

The knowledge exists. An engineer flagged it. It is in a report someone did not read, or in a risk register with a status that has not changed in two years, or it was raised and judged not worth the cost. Then it stops being discussed and it becomes, functionally, unknown.

This is different in kind from the other three. Known-unknowns and unknown-unknowns are limits on what can be known. Unknown-knowns are a failure to act on what is already known, which makes them an organisational problem rather than a technical one. No amount of tooling addresses it, because the tool would just produce another finding to be filed.

It is also the quadrant most likely to be the cause when an incident happens and the post-mortem finds that somebody had raised it.

Which is why the framing earns its place. Three of the quadrants tell you where to spend research effort. The fourth tells you to go back and look at what you have already been told and decided to live with, and check whether that decision was ever really made or whether it just quietly happened.
