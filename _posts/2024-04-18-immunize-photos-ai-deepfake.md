---
layout: post
title: "Immunize Your Photos: Protecting Yourself from AI Deepfake Manipulation"
date: 2024-04-18 12:13:30
description: PhotoGuard, from MIT, adds adversarial perturbation to a photo so that generative models editing it produce warped output. A look at what it does, and where the approach runs out.
tags: ai privacy security
categories: security
---

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/photoguard-hero.png" alt="PhotoGuard immunization applied to a photo before sharing" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>

Almost everything written about deepfakes is about detection. Find the fake after it exists, label it, take it down. That is reactive by construction, and by the time detection works the image has already been seen.

PhotoGuard, out of MIT, tries the other direction. Instead of detecting the edit afterwards, it makes the source photo hostile to being edited in the first place.

---

## What it actually does

A generative model like Stable Diffusion does not work on pixels directly. It maps the image into a latent representation, manipulates that, and decodes back out. The whole edit depends on the model reading the image the way a human does.

PhotoGuard adds a perturbation to the image that is small enough for a person not to notice and large enough to push the model's internal representation somewhere wrong. Feed the protected photo to an editing model and the output comes back warped and obviously broken instead of convincing.

The technique is adversarial perturbation, which is not new. What is interesting is the application: normally adversarial examples are the attack. Here they are the defence.

The [research paper](https://arxiv.org/pdf/2302.06588.pdf) has the actual method.

---

## Using it

The workflow is proactive, which is the whole point. It has to happen before the photo is public.

Run the image through PhotoGuard, turn on the immunization, and upload the immunized version rather than the original.

<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
  <iframe src="https://www.youtube.com/embed/aTC59Q6ZDNM" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" frameborder="0" allowfullscreen></iframe>
</div>

---

## Where this runs out

Worth being honest about the limits, because the framing around tools like this tends to oversell them.

**It only protects photos you have not posted yet.** Anything already on the internet is already scrapeable in its original form. For most people that is the large majority of their photos.

**Perturbations do not survive everything.** Re-encoding, heavy compression, cropping, screenshotting, resizing. Platforms do several of these to every image you upload. How much protection survives that pipeline is a real question and depends on the platform.

**It is tied to the models it was tuned against.** An adversarial perturbation is computed with respect to particular models. New architectures, retrained models, or a determined attacker working to strip the perturbation are all outside what it guarantees.

**It requires everyone to do it.** Your face appears in other people's photos, uploaded by them, unprotected. Individual action does not cover the collective surface.

So this is not a fix. It is a real technique that raises the cost of one specific attack on images you control from here on. That is genuinely useful and it is much narrower than "protect your photos from AI."

The deeper problem is that the ability to generate convincing fake images of anyone is already distributed and is not going back in the box. Perturbation defences buy time at the margin. They do not resolve it.

---

## Tools and References

- **PhotoGuard Tool:** [Try it on Hugging Face](https://huggingface.co/spaces/hadisalman/photoguard)
- **Tutorial Video:** [Watch on YouTube](https://www.youtube.com/watch?v=qhoK3q2fknk&t=229s)
- **Research Paper on Immunization:** [View PDF](https://arxiv.org/pdf/2302.06588.pdf)
- **MIT Technology Review:** [Read More](https://www.technologyreview.com/2023/07/26/1076764/this-new-tool-could-protect-your-pictures-from-ai-manipulation/)
