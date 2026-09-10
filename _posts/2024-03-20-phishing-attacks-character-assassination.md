---
layout: post
title: Recent Surge in Phishing Attacks Targeting Character Assassination
date: 2024-03-20 12:13:30
description: A Facebook phishing campaign that does not stop at stealing your password. It uses your account to damage your reputation, and it recruits every victim into spreading itself further.
tags: security privacy
categories: security
---

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="https://miro.medium.com/v2/resize:fit:828/format:webp/1*DtXqLJvAh5A2TXxhyjR8Aw.jpeg" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>

Most phishing you read about is after your money or your data. This one is after your reputation, which makes it worth writing about separately.

The shape of it is ordinary. A post appears in your feed from someone you actually know. You open it. There is a video playing in the background, and before you can watch the thing, a login form asks for your email and password. The page looks close enough to Facebook that a quick glance does not catch it.

What happens after you type your password is the part that is different.

---

## The payload is your reputation, not your wallet

The attacker does not quietly sell the credentials. They log in as you and post links to pornographic material from your account, then tag your friends and family in it.

Think about who sees that. Colleagues. Relatives. People who have no context and no reason to assume your account was compromised. By the time you notice and delete the post, the notifications have already gone out.

That is the actual damage. The stolen password is just the delivery mechanism.

---

## Why it keeps spreading

The tagging is not gratuitous. It is the propagation method.

Every person tagged sees a post from someone they trust, which is exactly the condition that made you click in the first place. Some of them click. Some of those enter a password. The campaign does not need to find new victims on its own, because each round of victims recruits the next one.

It is worth being clear about who this catches. The instinct is to assume the target is someone careless, or someone looking for the content being advertised. That framing is wrong and it makes people complacent. What the attack actually exploits is a post arriving from a trusted account, and everyone has trusted accounts in their feed. Curiosity is enough. So is misclicking on a phone.

---

## What actually helps

Four things, roughly in order of how much they buy you.

**Two-factor authentication.** This is the one that matters most, because it breaks the chain even when the password is already gone. If the attacker has your password and cannot get past the second factor, the attack stops at the theft and never reaches the reputational payload. Everything else on this list reduces the chance of losing the password. This one reduces the damage when you already have.

**A password manager.** Not primarily for password strength. For the fact that a manager will not autofill your Facebook credentials into a page that is not Facebook. It notices the domain mismatch that your eye does not.

**Checking the domain before typing a password.** Any page asking you to log in to see content is worth a second of suspicion. Look at the address bar, not the page. The page is the part the attacker controls.

**Telling people.** Specifically the people in your family who are not going to read a security blog. The attack propagates through trust networks, so the counter-propagates the same way.

---

If you want to keep up with this kind of thing locally, [Syecon](https://discord.gg/k7nHjEuTHq) and [Pentester Nepal](https://www.facebook.com/groups/pentesternepal) are both worth joining.

And if you have already been caught by this one: change the password, revoke active sessions, turn on 2FA, then post something telling your contacts what happened. The last step feels the worst and does the most good, because it is the thing that stops the people you tagged from clicking.
