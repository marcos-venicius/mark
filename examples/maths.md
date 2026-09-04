# Maths

Back to the [examples](README.md).

Formulas are typeset by KaTeX, compiled into the binary the way the diagram
renderer is. Nothing is fetched, and a document with no maths in it never asks
for it.

There are four ways to write it, and they are the four GitHub understands.

## Inline

Written between single dollars: the mass–energy equivalence $E = mc^2$ sits on
the line it was written on, at the size of the text around it. Between backticks
and dollars it is the same thing: $`\sqrt{a^2 + b^2}`$.

The opening `$` cannot be followed by a space, and the closing one cannot be
preceded by one, which is why a paragraph that mentions costing $5 or $10 is
still a paragraph about money.

## Display

Double dollars put the formula on its own line, centred:

$$\int_{0}^{1} x^2 \, dx = \frac{1}{3}$$

A fence marked `math` does the same, and keeps the source readable in the file:

```math
\sum_{k=1}^{n} k = \frac{n(n + 1)}{2}
```

## Something to look at

```math
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
\begin{pmatrix}
x \\
y
\end{pmatrix}
=
\begin{pmatrix}
ax + by \\
cx + dy
\end{pmatrix}
```

A line holding nothing but `=` or `-` is a heading in Markdown before it is
anything else, so an equation with one in it belongs in a fence, where the
Markdown parser does not look. Between dollars it would end the formula and
underline the line above it.

$$
f(x) = \int_{-\infty}^{\infty} \hat{f}(\xi)\, e^{2 \pi i \xi x} \, d\xi
$$

$$
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^{n} = e
\qquad
\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^{s}}
$$

An equation wider than the column scrolls on its own rather than stretching it:

$$
e^{x} = 1 + \frac{x}{1!} + \frac{x^{2}}{2!} + \frac{x^{3}}{3!} + \frac{x^{4}}{4!} + \frac{x^{5}}{5!} + \frac{x^{6}}{6!} + \frac{x^{7}}{7!} + \cdots
$$

## In the rest of a document

A formula goes wherever text goes — in a table:

| Rule | Written |
| --- | --- |
| Product | $(fg)' = f'g + fg'$ |
| Quotient | $\left(\frac{f}{g}\right)' = \frac{f'g - fg'}{g^2}$ |
| Chain | $(f \circ g)'(x) = f'(g(x))\,g'(x)$ |

> [!NOTE]
> In a list, an alert or a footnote as well: the golden ratio is
> $\varphi = \frac{1 + \sqrt{5}}{2}$.

## When a formula will not parse

The source is written out in place, in the same colour a refused diagram's
reason is given in, and the rest of the document renders as usual:

$$\frac{1}{\notacommand{x}}$$

Press <kbd>d</kbd>: the formulas follow the palette without being drawn again,
and <kbd>Ctrl</kbd> <kbd>P</kbd> prints them as they stand.
