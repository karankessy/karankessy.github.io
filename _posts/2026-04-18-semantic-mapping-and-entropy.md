---
layout: post
title: Semantic Map Explorer - Entropy Embedding Atlas
date: 2026-04-18
description: Understanding text geometry through embeddings, KNN graphs, entropy, and interactive visualization
tags: embeddings semantic-analysis entropy visualization umap
categories: projects tutorials
published: true
---

This project is to understand & read it as a small article about text geometry.
We have it starting with raw sentences, turn them into vectors, connect nearby sentences into a graph, measure how mixed each neighborhood is, compresse the result into 2D, and then explore the whole thing in a browser.

I am not trying to present this as a perfect or final answer to text analysis. It is more modest than that. The point is to build a clear mental model for how meaning can be represented, compared, and inspected without pretending the map is the territory.

If you are new to embeddings, cosine similarity, KNN graphs, entropy, UMAP, or t-SNE as me, the goal here is to explain each part gently, then connect it back to the bigger picture, through what I've come to understand so far.

## Opening intuition

Text feels messy because it is not naturally numeric. Computers do not know that “the database connection pool is exhausted” is closer to “the server returned a 502 bad gateway error” than to “my cat knocked over the coffee mug again” unless we give them a way to compare meaning.

This project is built around that gap.

The basic idea is simple:

1. Take a sentence.
2. Turn it into a vector that captures semantic meaning.
3. Find nearby sentences in that vector space.
4. Ask how concentrated or mixed each local neighborhood is.
5. Project the whole structure into 2D so a person can inspect it.

That gives us a map, but not a geographical one. It is a semantic map: points that are close together tend to be similar in meaning, while points near the edges often show ambiguity, overlap, or cross-topic language.

## Project overview

The pipeline is:

text dataset -> embeddings -> curated KNN graph -> entropy -> 2D reduction -> visualization

The dataset is a small mix of technical logs, security-related sentences, everyday conversation, ambiguous phrases, programming talk, payload-like strings, and philosophical statements. The variety is intentional. A map is more interesting when not everything belongs to the same semantic neighborhood.

The next step is embedding: each sentence becomes a dense vector in 384 dimensions. Once text is in vector form, we can compare directions and distances instead of comparing raw strings.

From there, the project builds a curated nearest-neighbor graph. That graph is the local structure of the map. It says which points are close enough to matter, and it is curated so that the graph is not overwhelmed by noisy or weak relationships.

Entropy is then computed over each sentence’s neighborhood. Here, entropy is not used as a judgment of truth or quality. It is a structural measure: how concentrated is the neighborhood around this point? A sentence sitting cleanly inside one semantic cluster tends to have lower entropy; a sentence that lives near boundaries or mixes several ideas tends to have higher entropy.

Finally, UMAP or t-SNE reduces the 384-dimensional space to 2D. That 2D layout is only for inspection. The real neighborhood logic still lives in the high-dimensional embedding space. The HTML output then turns the result into something you can pan, hover, and compare interactively.

## Repository and architecture walkthrough

The repository is organized so each file handles one part of the pipeline.

- [data.py](https://github.com/karankessy/vectorAtlas/blob/main/data.py) holds the sentence dataset and labels.
- [embeddings.py](https://github.com/karankessy/vectorAtlas/blob/main/embeddings.py) turns text into vectors using a sentence-transformer model.
- [similarity.py](https://github.com/karankessy/vectorAtlas/blob/main/similarity.py) builds the curated KNN graph.
- [entropy.py](https://github.com/karankessy/vectorAtlas/blob/main/entropy.py) computes neighborhood entropy and summary statistics.
- [reduce.py](https://github.com/karankessy/vectorAtlas/blob/main/reduce.py) performs UMAP or t-SNE projection into 2D.
- [visualize.py](https://github.com/karankessy/vectorAtlas/blob/main/visualize.py) builds the Plotly figures.
- [main.py](https://github.com/karankessy/vectorAtlas/blob/main/main.py) orchestrates the full pipeline.
- [run_easy.py](https://github.com/karankessy/vectorAtlas/blob/main/run_easy.py) wraps the pipeline in friendly presets.

That split is not accidental. It keeps the engineering readable.

The system has one clear top-to-bottom flow, but each stage answers a different question:

- What does the sentence mean numerically?
- Who is near it?
- How mixed is its local neighborhood?
- How do we show that geometry in a form a human can inspect?

This is a useful pattern in small analytical projects: separate the semantic work, the graph work, the scoring work, and the visualization work. That way, each piece can be explained, tuned, or replaced without rewriting the whole project.

### Why each module exists

[data.py](https://github.com/karankessy/vectorAtlas/blob/main/data.py) exists so the example is stable and reproducible. The dataset is small on purpose, because the goal is to understand the geometry rather than chase a massive benchmark.

[embeddings.py](https://github.com/karankessy/vectorAtlas/blob/main/embeddings.py) exists because raw text is not directly comparable in a useful geometric way. Embeddings are the bridge from language to vector space.

[similarity.py](https://github.com/karankessy/vectorAtlas/blob/main/similarity.py) exists because raw nearest neighbors are often too noisy if used uncritically. The graph is curated so the local structure is more meaningful.

[entropy.py](https://github.com/karankessy/vectorAtlas/blob/main/entropy.py) exists because not all neighborhoods are equally focused. Some points sit in clear semantic pockets; others sit on boundary regions. Entropy helps measure that difference.

[reduce.py](https://github.com/karankessy/vectorAtlas/blob/main/reduce.py) exists because 384 dimensions are too many to draw directly. A projection gives us a readable layout.

[visualize.py](https://github.com/karankessy/vectorAtlas/blob/main/visualize.py) exists because the end result should be inspectable, not just computed. The interactive map is where the project becomes useful to a person.

[main.py](https://github.com/karankessy/vectorAtlas/blob/main/main.py) exists because the whole workflow should run from one command and be easy to tune.

[run_easy.py](https://github.com/karankessy/vectorAtlas/blob/main/run_easy.py) exists because a starter should not have to remember every flag before seeing something meaningful.

## Dataset section

The dataset mixes several kinds of sentences:

- technical logs and infrastructure messages,
- security alerts and payload-like strings,
- everyday conversational sentences,
- ambiguous phrases such as “this looks suspicious” or “request timed out”,
- programming and developer talk,
- and a small set of philosophical statements.

The point of mixing them is not to make the data chaotic for its own sake. It is to make the map informative.

If every sentence belonged to one style, the project would not tell us much. But when technical, ambiguous, benign, and security-related text all appear together, the map can show several useful things:

- where semantic clusters separate cleanly,
- where one category overlaps another,
- where ambiguous language sits near multiple groups,
- and how suspicious-looking strings behave compared with normal operational text.

The categories in [data.py](https://github.com/karankessy/vectorAtlas/blob/main/data.py) are intentionally mixed because the project is trying to study structure, not just labels.

## Embeddings section

Embeddings are the part that make the rest of the project possible.

A sentence embedding is a numeric vector that tries to represent meaning. Instead of comparing raw text character by character, we compare vectors in a space where similar meanings should point in similar directions.

This matters because raw text is a poor geometry object. Two sentences can be semantically close while looking very different on the surface. For example, “the server returned a 502 bad gateway error” and “the API rate limiter kicked in after 1000 requests” are both technical operational messages, even though the words are not interchangeable.

The project uses [sentence-transformers](https://github.com/karankessy/vectorAtlas/blob/main/embeddings.py) with the model `all-MiniLM-L6-v2`.

That model produces 384-dimensional vectors, so each sentence becomes a point in:

$$
E \in \mathbb{R}^{N \times 384}
$$

For this dataset, $N = 170$, so the embedding matrix is:

$$
E \in \mathbb{R}^{170 \times 384}
$$

What does “384 dimensions” mean in practice?

It means the sentence is represented by 384 numeric features that together describe semantic position in the model’s learned space. The dimensions themselves are not individually human-interpretable. You do not read them one by one like columns in a spreadsheet. Instead, you read the geometry they form together.

The main intuition is this: sentences with similar meanings should end up near each other in embedding space, even if the wording differs. That is the foundation the rest of the pipeline uses.

## Similarity and graph section

Once sentences are vectors, we need a way to compare them.

The project uses cosine similarity because it cares more about direction than raw magnitude. In text embeddings, that often works better than naïvely using Euclidean distance on the raw vector values.

### Cosine similarity in plain language

If two vectors point in nearly the same direction, they are likely semantically close. If they point in different directions, they are less similar.

### Cosine similarity formula

For vectors $u$ and $v$:

$$
\text{sim}(u, v) = \frac{u \cdot v}{\|u\|\,\|v\|}
$$

$$
d(u, v) = 1 - \text{sim}(u, v)
$$

What the symbols mean:

- $u, v$ are sentence vectors.
- $u \cdot v$ is the dot product.
- $\|u\|$ and $\|v\|$ are vector lengths.
- $\text{sim}(u, v)$ is the cosine similarity.
- $d(u, v)$ is the cosine distance.

Why this formula matters:

- the dot product grows when vectors point in similar directions,
- the lengths normalize away raw scale,
- and the result stays focused on angular closeness instead of absolute size.

That is useful here because embeddings often care more about orientation in space than their raw magnitude.

### Nearest-neighbor search and KNN graphs

Once we can measure similarity, we can ask a practical question: who is near whom?

The project uses nearest-neighbor search to find the closest sentences to each sentence in the dataset. From that, it builds a KNN graph, where each node is a sentence and each edge connects it to a small set of nearby sentences.

The graph is not the final answer. It is the local structure that the entropy calculation later inspects.

### Why the graph is curated

Raw nearest-neighbor lists are often too literal. They can include weak or accidental matches. That is fine if you are doing recall-heavy retrieval, but not ideal if you want a readable semantic map.

So [similarity.py](https://github.com/karankessy/vectorAtlas/blob/main/similarity.py) curates the neighbors using three ideas:

- a similarity threshold,
- a mutual-neighbor requirement,
- and a reranking bonus based on shared neighborhood overlap.

The reranking score is:

$$
\text{score}(i, j) = \text{sim}(i, j) + \alpha \cdot \frac{|\mathcal{N}_i \cap \mathcal{N}_j|}{\text{shortlist}_k}
$$

Here:

- $i$ is the current sentence,
- $j$ is a candidate neighbor,
- $\mathcal{N}_i$ is the candidate neighbor set for sentence $i$,
- $|\mathcal{N}_i \cap \mathcal{N}_j|$ counts how many shortlist neighbors they share,
- $\text{shortlist}_k$ is a normalization factor,
- and $\alpha$ controls how strongly shared context affects ranking.

What each parameter changes in practice:

- `--min-sim` makes the graph stricter when increased.
- `--mutual-knn` removes one-way or less stable neighbor links when enabled.
- `--shortlist-factor` controls how broad the candidate pool is before curation.
- `--edge-neighbors` controls how many edges are drawn in the visualization.

In plain terms, the graph curation step tries to keep edges that feel locally justified instead of simply numerically close.

## Entropy section

Entropy is the part of the project that tells us how concentrated or spread out a neighborhood is.

That may sound abstract at first, so it helps to think of a point in the graph as having a few neighbors that may matter more than others. If one neighbor is clearly dominant, the neighborhood is sharp and focused. If the neighbor influence is spread more evenly, the neighborhood is mixed.

### From distances to probabilities

The project starts with the curated neighbor distances. It turns them into similarities:

$$
s_j = 1 - d_j
$$

Then it applies a temperature transform:

$$
w_j = s_j^{1/T}
$$

And finally normalizes the values into a probability distribution:

$$
p_j = \frac{w_j}{\sum_{m=1}^{k} w_m}
$$

What each symbol does:

- $d_j$ is the distance to the $j$-th neighbor.
- $s_j$ is the corresponding similarity-like value.
- $T$ is the temperature.
- $w_j$ is the temperature-adjusted weight.
- $p_j$ is the normalized probability assigned to that neighbor.

### The entropy formula

Once we have probabilities, entropy is computed as:

$$
H = -\sum_{j=1}^{k} p_j \log(p_j)
$$

The project then normalizes it:

$$
H_{\text{norm}} = \frac{H}{\log(k)}
$$

Why the normalization matters:

- it makes the score easier to compare across runs,
- and it keeps the values in a more interpretable range.

### How to read entropy here

- Low entropy usually means the sentence sits in a focused local neighborhood.
- High entropy usually means the sentence is near a boundary, mixed across categories, or semantically less settled.

That is not a moral score. It does not mean a sentence is “good” or “bad,” only that its local structure is more or less concentrated.

Temperature is the main knob here. Lower temperatures sharpen the neighbor weights and usually make the neighborhood look more decisive. Higher temperatures smooth the weights and can make the distribution flatter.

## Dimensionality reduction section

The embedding space has 384 dimensions. Humans cannot inspect that directly, so the project projects the points down to 2D.

This reduction is not the same thing as the semantic graph itself. The graph is built in the embedding space; the 2D projection is only the display layer.

### UMAP

UMAP is used as the default because it often preserves local topology well and gives a readable layout for this kind of data. It is a good choice when the main concern is neighborhood structure.

### t-SNE

`t-SNE` is another projection method. It often makes clusters look more separated, which can be helpful for inspection. The tradeoff is that global geometry can be distorted more easily.

### What the projection means and what it does not mean

The 2D map should be read as a visualization of neighborhood relationships, not as the source of truth itself.

The important relationships were computed before projection. The projection simply gives them a form we can inspect.

That means two points being near each other on the 2D map is informative, but it is not the same as saying the 2D map fully preserves all high-dimensional distances.

## Visualization section

[visualize.py](https://github.com/karankessy/vectorAtlas/blob/main/visualize.py) builds two interactive maps with Plotly.

### Entropy map

The entropy map colors points by entropy. It also draws faint edges for the curated KNN graph.

What to look for:

- low-entropy points often sit inside more coherent clusters,
- high-entropy points often sit on boundaries or mix several themes,
- and the edges show which points were considered local neighbors.

The colorbar represents entropy, so you can visually compare which regions are more focused and which are more mixed.

### Category map

The category map uses the same 2D coordinates but colors points by label instead of entropy.

This is useful because it shows whether the known categories separate cleanly or overlap in the embedding space.

The hover labels reveal the sentence, the category, and the entropy value. That makes the map interactive in a way a static image is not. You can move across points and inspect local examples instead of guessing from a legend.

Here are the two visualizations in action:

{% include figure.liquid loading="eager" path="assets/img/coloredByCategory.png" class="img-fluid rounded z-depth-1" zoomable=true %}

The category map shows how different semantic categories (tech, security, casual, ambiguous, etc.) distribute across the embedding space. Clean separation suggests the model is distinguishing them well; overlap can indicate genuine semantic similarity.

{% include figure.liquid loading="eager" path="assets/img/entropyEmbeddingAtlas.png" class="img-fluid rounded z-depth-1" zoomable=true %}

The entropy map colors the same points by neighborhood entropy. Notice how lower-entropy regions (lighter colors) tend to cluster together, while higher-entropy points (darker colors) often sit at boundaries or transition zones between semantic clusters.

### Why interactive HTML helps

Interactive HTML is practical here because the interesting part of the project is local comparison.

In a static image, you can see the whole field at once, but you cannot easily inspect the sentence text behind each point. With Plotly, you can hover, toggle categories, and inspect clusters and boundary points more carefully.

## Code and engineering section

The main flow in [main.py](https://github.com/karankessy/vectorAtlas/blob/main/main.py) is straightforward:

1. Load sentences and labels.
2. Optionally append a query sentence.
3. Generate embeddings.
4. Build the curated graph.
5. Compute entropy.
6. Reduce to 2D.
7. Render the visualizations.
8. Save the HTML files and print summaries.

That order matters because each step depends on the previous one. The code is organized so the pipeline stays easy to inspect, and so each stage can be tuned separately.

The curated KNN step improves readability and signal because it keeps the graph from being flooded with weak relationships. This is one of the main reasons the map stays interpretable instead of turning into a dense web of nearly everything connected to everything else.

There is a tradeoff between strict curation and exploratory looseness:

- stricter settings give a cleaner graph with fewer noisy links,
- looser settings keep more possible relationships and can reveal broader structure,
- but too much looseness can make the map harder to interpret.

[visualize.py](https://github.com/karankessy/vectorAtlas/blob/main/visualize.py) also pays attention to stability. The axes are fixed, the layout is kept readable, and the category map is set up so legend toggling does not cause the plot to jump around. That matters because a visualization should help you inspect the data, not distract you by reshuffling itself every time you click a category.

## Math section

The main formulas are worth reading together, because they are connected.

### 1) Cosine similarity

$$
\text{sim}(u, v) = \frac{u \cdot v}{\|u\|\,\|v\|}
$$

This measures directional similarity between two vectors.

### 2) Cosine distance

$$
d(u, v) = 1 - \text{sim}(u, v)
$$

This turns similarity into a distance-like value, where smaller means closer.

### 3) Reranking score

$$
\text{score}(i, j) = \text{sim}(i, j) + \alpha \cdot \frac{|\mathcal{N}_i \cap \mathcal{N}_j|}{\text{shortlist}_k}
$$

This says a candidate neighbor is better when it is both directly similar and contextually similar.

### 4) Temperature-adjusted neighborhood weight

$$
s_j = 1 - d_j
$$

$$
w_j = s_j^{1/T}
$$

These convert distance into similarity and then sharpen or smooth the result.

### 5) Probability normalization

$$
p_j = \frac{w_j}{\sum_{m=1}^{k} w_m}
$$

This turns the neighbor weights into a probability distribution.

### 6) Shannon entropy

$$
H = -\sum_{j=1}^{k} p_j \log(p_j)
$$

This measures how spread out the neighborhood probabilities are.

### 7) Normalized entropy

$$
H_{\text{norm}} = \frac{H}{\log(k)}
$$

This rescales entropy so it is easier to compare across settings.

### What the formulas are doing conceptually

The first pair of formulas tells us how close two vectors are. The reranking score asks whether two points belong to similar local surroundings. The entropy formulas then ask how concentrated each point’s neighborhood really is once we have the curated graph.

That chain matters. It is easy to write a formula; it is harder to choose formulas that work together in a way that tells a coherent story about the data.

## Practical tuning section

The project has a few tuning knobs that change the feel of the output.

### To make the graph stricter

Increase `--min-sim`, keep mutual neighbors enabled, and reduce `--edge-neighbors`.

This will usually make the map cleaner and reduce weak cross-links.

### To make it more exploratory

Lower `--min-sim`, allow more edges, and optionally disable mutual neighbors.

This can reveal broader structure, but it can also introduce more noise.

### What the main knobs do

- `--min-sim` filters out weak neighbors.
- `--mutual-knn` keeps only more stable reciprocal relationships.
- `--edge-neighbors` changes how many graph edges are drawn.
- `--entropy-temp` controls how peaked or flat the neighbor distribution becomes.

### Example recipes

Clean and stable:

```bash
python run_easy.py --preset strict --method umap
```

Balanced default:

```bash
python run_easy.py --preset balanced --method umap
```

More exploratory:

```bash
python run_easy.py --preset exploratory --method tsne
```

### UMAP versus t-SNE

Use UMAP when you want a good default layout that usually preserves local structure well.

Use t-SNE when you want stronger cluster separation for inspection, and you are comfortable with the idea that the global layout may be less faithful.

## How to run it

The default run is:

```bash
python main.py
```

That uses UMAP, a moderate neighborhood size, curated graph settings, and entropy normalization.

For starters, the easier entry point is:

```bash
python run_easy.py
```

That script wraps the same pipeline in presets:

- `balanced`: the default recommendation,
- `strict`: cleaner and more selective,
- `exploratory`: looser and more open to broader context.

You can also pass a query sentence to see where a new example lands:

```bash
python run_easy.py --query "possible SQL injection in login"
```

The project generates two HTML files:

- [entropy_map.html](entropy_map.html)
- [category_map.html](category_map.html)

## Output interpretation guide

The console output gives you a compact numerical summary.

Look for:

- the embedding shape,
- the number of graph edges,
- the entropy min, max, mean, and standard deviation,
- and the most extreme low-entropy and high-entropy examples.

The entropy map is where the structure becomes visible.

- low-entropy regions often look more coherent,
- high-entropy points often sit near boundaries,
- and edge lines show local neighborhood relationships.

The category map is useful for checking how the known labels distribute across the 2D layout.

- if categories form clean islands, the embedding geometry is separating them well,
- if they overlap, that can mean the language itself is overlapping or that the model is not strongly distinguishing them.

High-entropy points should be read as structurally mixed, not wrong.

Low-entropy points should be read as locally concentrated, not necessarily more important.

Category overlap is not failure by itself. Sometimes it simply means the sentences are genuinely similar in meaning or style.

## Use cases and limitations

This project is useful when you want to explore semantic structure, compare categories, inspect ambiguous language, or get a visual sense of how embeddings behave on a small dataset.

It is not a full predictive system.

It does not replace supervised classification, anomaly detection with ground truth, or a retrieval system backed by a production index.

That matters because exploratory geometry and prediction are related but not the same. This project is good at showing structure; it is not trying to make definitive decisions.

There are also limits to keep in mind:

- embeddings can carry model bias,
- projection can distort global geometry,
- entropy depends on the quality of the neighborhood graph,
- and the map is only as informative as the dataset you give it.

## Closing section

The bigger lesson here is not that text becomes a perfect map. It is that language can be represented geometrically in a way that is useful for inspection.

Once sentences become vectors, the rest of the pipeline becomes a series of carefully chosen questions:

- who is near whom,
- how sharp is the neighborhood,
- what does the 2D layout preserve,
- and what does the human reader notice when the result is finally visible?

That is what this project is really doing. It is not just plotting points. It is turning language into a structure we can explore.

If the article feels useful, the best outcome is not that it sounds impressive. The best outcome is that it makes the pipeline easier to understand, easier to tune, and easier to extend.

## Notes

- The first run may download model weights from Hugging Face.
- You may see non-fatal warnings from UMAP or model loading.
- The HTML files are self-contained and can be opened directly in a browser.
