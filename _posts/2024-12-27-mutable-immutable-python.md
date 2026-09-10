---
layout: post
title: "Engineering behind Mutable and Immutable in Python"
date: 2024-12-27 15:46:13
description: Explore the core engineering concepts behind mutable and immutable data types in Python with simple explanations and practical examples.
tags: python systems
categories: systems
og_image: /assets/img/xandy.png
thumbnail: assets/img/xandy.png
---

If you've been programming in Python, you've probably come across the terms _mutable_ and _immutable_. These words might sound casual, but have you ever wondered how mutable is actually mutable? And immutable immutable? It's quite simple once you get the hang of it. Let's break it down and look at the "how" and "why" behind these concepts.

---

### What Do Mutable and Immutable Mean?

- **Mutable** means _changeable_. Data types like lists, sets, and dictionaries can be modified after they are created.
- **Immutable** means _unchangeable_. Data types like strings, integers, and tuples cannot be altered once they are created.

Now, here's where it gets interesting: even if a data type is immutable, it doesn't mean you can't assign new values to a variable. The variable and the object it points to are two different things, and that distinction is the whole idea. Let's go a bit further.

---

### Example 1: Strings Are Immutable

```python
>>> username = "karan"
>>> username
'karan'
>>> username = "notkaran"
>>> username
'notkaran'
```

Strings are immutable, so when you assign a new value to the variable `username`, Python doesn't overwrite the old value. Instead:

1. A new memory block is created for the new value `"notkaran"`.
2. The variable `username` is updated to reference this new block.
3. The old value `"karan"` is left behind and will be deleted later by Python's garbage collector, but only if no other variable is using it.

So the assignment did not change a string. It changed what `username` points at.

#### Memory Allocation Diagrams

{% include figure.liquid loading="eager" path="assets/img/userkaran.png" class="img-fluid rounded z-depth-1" zoomable=true %}
_when username = "karan"_

{% include figure.liquid loading="eager" path="assets/img/usernotkaran.png" class="img-fluid rounded z-depth-1" zoomable=true %}
_after re-assigning the value when username = "notkaran"_

Here, the value `"karan"` is stored at a different memory location, which will be removed by the garbage collector in Python since no variable is referencing it.

---

### Example 2: Integers and Memory Allocation

```python
>>> x = 10
>>> y = x
>>> x = 20
>>> x
20
>>> y
10
```

In this case:

- Initially, `x` and `y` both reference the same value `10` in memory.
- When you assign `20` to `x`, Python creates a new memory block for `20` and updates `x` to reference this new block.
- The value `10` is still in memory because `y` is referencing it.

This is the part worth holding on to. `y = x` never copied anything. It made a second reference to the same object, and rebinding `x` afterwards left `y` untouched.

#### Memory Allocation Diagram

{% include figure.liquid loading="eager" path="assets/img/xandy.png" class="img-fluid rounded z-depth-1" zoomable=true %}
_In this case, the value `10` won't be deleted as it is being referenced by `y`._

---

### Why Does This Matter?

Two reasons, mostly.

**Performance.** Immutable objects are often faster because they don't need mechanisms to handle changes, and because Python can safely share them between references instead of copying.

**Data safety.** Immutable types prevent accidental modification. That is why they work as dictionary keys and why they are a reasonable default for constants: nothing holding a reference can change the value underneath you.

The same reasoning explains the classic mutable surprise. Two variables pointing at one list are pointing at one list, and mutating through either is visible through both. With an immutable type that situation cannot arise, because there is no mutation to observe.

---

### The Core Engineering Behind Mutability

At the heart of Python's design lies its memory management system, and here is how it works:

- **Mutable types** like lists and dictionaries store data in a memory buffer that can be altered directly. The object stays at the same address and its contents change.
- **Immutable types** don't allow changes to the data in memory. Instead, new memory is allocated for any modification, and the reference is repointed.

I didn't explain much with examples and diagrams about mutability as it is quite easy and obvious after knowing immutability. This ability to allocate new memory or update existing memory is what makes mutability possible (or impossible) at its core.
