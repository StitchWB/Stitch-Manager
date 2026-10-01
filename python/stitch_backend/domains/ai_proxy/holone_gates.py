from __future__ import annotations

import re
from typing import Final

try:
    from re import _parser as _re_parser  # type: ignore[attr-defined]
except ImportError:  # Python < 3.11
    import sre_parse as _re_parser


# Required-literal prefilter: gate = conjunction of literal-set parts; may over-approximate, never skips a rule.

_GATE_MAX_PART_ALTS: Final = 32
_GATE_MAX_BRANCH_ALTS: Final = 512
_GATE_MAX_LIT_LEN: Final = 24

# Every char matched by \s on str patterns (29 code points, verified vs re).
_UNICODE_SPACES: Final = (
    " \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_ASCII_SPACES: Final = " \t\n\r\x0b\x0c"
_ASCII_DIGITS: Final = "0123456789"

# ci haystack maps İ/ı to "i" (casefold loses the substring); unsafe literals are dropped, which only weakens a gate.
_CI_UNSAFE_CHARS: Final = ("İ", "ı", "\u0307")


def _ci_haystack(text: str) -> str:
    return text.casefold().replace("ı", "i").replace("i\u0307", "i")


def _category_chars(cat, ascii_only: bool) -> frozenset[str] | None:
    rp = _re_parser
    if cat is rp.CATEGORY_DIGIT:
        return frozenset(_ASCII_DIGITS) if ascii_only else None
    if cat is rp.CATEGORY_SPACE:
        return frozenset(_ASCII_SPACES if ascii_only else _UNICODE_SPACES)
    return None  # word classes and negated categories are too wide


def _in_node_chars(items, ascii_only: bool) -> frozenset[str] | None:
    chars: set[str] = set()
    for op, arg in items:
        if op is _re_parser.NEGATE:
            return None
        if op is _re_parser.LITERAL:
            chars.add(chr(arg))
        elif op is _re_parser.RANGE:
            lo, hi = arg
            if hi - lo > 64:
                return None
            chars.update(chr(c) for c in range(lo, hi + 1))
        elif op is _re_parser.CATEGORY:
            expansion = _category_chars(arg, ascii_only)
            if expansion is None:
                return None
            chars.update(expansion)
        else:
            return None
    if len(chars) > _GATE_MAX_PART_ALTS:
        return None
    return frozenset(chars)


def _truncate_part(strings) -> frozenset[str]:
    return frozenset(s[:_GATE_MAX_LIT_LEN] for s in strings)


def _token_max_span(tokens) -> int | None:
    """Longest possible match length in chars; None when unbounded."""
    rp = _re_parser
    total = 0
    for op, arg in tokens:
        if op in (rp.LITERAL, rp.IN, rp.CATEGORY, rp.ANY, rp.NOT_LITERAL):
            width: int | None = 1
        elif op is rp.AT or op is rp.ASSERT or op is rp.ASSERT_NOT:
            width = 0  # zero-width; asserted text is not part of the span
        elif op is rp.SUBPATTERN:
            width = _token_max_span(arg[3])
        elif op is rp.BRANCH:
            widths = [_token_max_span(b) for b in arg[1]]
            width = None if any(w is None for w in widths) else max(w for w in widths if w is not None)
        elif op in (rp.MAX_REPEAT, rp.MIN_REPEAT, rp.POSSESSIVE_REPEAT):
            lo, hi, sub = arg
            sub_max = _token_max_span(sub)
            if hi is rp.MAXREPEAT:
                width = 0 if sub_max == 0 else None
            else:
                width = None if sub_max is None else hi * sub_max
        else:
            width = None  # grouprefs and anything unknown: unbounded
        if width is None:
            return None
        total += width
    return total


_Part = tuple[frozenset[str], bool, int | None, int | None]
# (literals, positional, prefix, elem_span): prefix/span = max chars before/covered by the part; None = unbounded.


def _branch_zip_parts(branches, ascii_only: bool) -> list[_Part] | None:
    """Merge branch alternatives position-wise: part j of the result is the
    union of every branch's j-th part.

    A match via any branch hits every merged part, so the conjunction stays
    sound; unlike a flat union, conjunctions shared by all branches (e.g.
    (A..B)|(B..A)) survive. Prefixes/spans merge by max (a looser bound is
    always sound). None when some branch imposes no literal constraint.
    """
    per_branch = []
    for branch in branches:
        parts = _node_parts(branch, ascii_only, 0)
        if parts is None:
            return None
        if not parts:
            return None  # a branch that can match literal-free
        per_branch.append(parts)
    merged: list[_Part] = []
    for j in range(min(len(p) for p in per_branch)):
        lits: set[str] = set()
        positional = True
        prefix: int | None = 0
        span: int | None = 0
        for bp in per_branch:
            part, pos, pre, sp = bp[j]
            lits.update(part)
            positional = positional and pos
            prefix = None if prefix is None or pre is None else max(prefix, pre)
            span = None if span is None or sp is None else max(span, sp)
        if len(lits) > _GATE_MAX_BRANCH_ALTS:
            return None  # too many alternatives to be a useful part
        merged.append((_truncate_part(lits), positional, prefix, span))
    return merged


def _node_parts(tokens, ascii_only: bool, base: int | None) -> list[_Part] | None:
    """Conjunctive (literals, positional, prefix) triples for a token list.

    prefix = max chars before the part within a match (None = unbounded).
    positional=False marks literals from lookaheads: required somewhere in
    the text but not necessarily inside the match span.

    None means a scoped flag change was found (case semantics of extracted
    literals would be unreliable) - caller must treat the rule as
    unconditional. An empty list imposes no constraint.
    """
    rp = _re_parser
    parts: list[_Part] = []
    width = base  # max chars consumable before the current position
    run: set[str] | None = None
    run_prefix: int | None = None  # width value at run start
    run_span: int | None = 0  # max chars covered by the run's alternatives

    def flush() -> None:
        nonlocal run, run_span
        if run:
            parts.append((_truncate_part(run), True, run_prefix, run_span))
            run = None
            run_span = 0

    def extend(strings: set[str], elem_span: int | None) -> None:
        nonlocal run, run_prefix, run_span
        if len(strings) > 8 and all(len(s) == 1 for s in strings):
            # wide char classes make near-useless parts and explode adjacency runs into junk alternatives
            flush()
            return
        if len(strings) > _GATE_MAX_PART_ALTS:
            # too big to cross-multiply; it stands alone as its own part
            flush()
            parts.append((_truncate_part(strings), True, width, elem_span))
            return
        if run is None:
            run = set(strings)
            run_prefix = width
            run_span = elem_span
        elif len(run) * len(strings) > _GATE_MAX_PART_ALTS:
            flush()
            run = set(strings)
            run_prefix = width
            run_span = elem_span
        else:
            run = {a + b for a in run for b in strings}
            run_span = None if run_span is None or elem_span is None else run_span + elem_span

    def hoist(sub_parts: list[_Part]) -> None:
        nonlocal run
        if (
            len(sub_parts) == 1
            and len(sub_parts[0][0]) <= _GATE_MAX_PART_ALTS
            and sub_parts[0][1]
            and sub_parts[0][2] == 0
            and sub_parts[0][3] is not None
            and all(len(lit) == sub_parts[0][3] for lit in sub_parts[0][0])
        ):
            # merging a variable-width sub here would assert concatenations a real match never contains
            part, _pos, _pre, span = sub_parts[0]
            extend(set(part), span)
            return
        flush()
        for part, positional, prefix, span in sub_parts:
            parts.append(
                (
                    part,
                    positional,
                    None if prefix is None or width is None else width + prefix,
                    span,
                )
            )

    for op, arg in tokens:
        tok_w: int | None
        if op is rp.LITERAL:
            extend({chr(arg)}, 1)
            tok_w = 1
        elif op is rp.IN:
            chars = _in_node_chars(arg, ascii_only)
            if chars is None:
                flush()
            else:
                extend(set(chars), 1)
            tok_w = 1
        elif op is rp.CATEGORY:
            chars = _category_chars(arg, ascii_only)
            if chars is None:
                flush()
            else:
                extend(set(chars), 1)
            tok_w = 1
        elif op is rp.AT:
            tok_w = 0  # zero-width anchor: adjacency preserved
        elif op in (rp.ANY, rp.NOT_LITERAL):
            flush()
            tok_w = 1
        elif op is rp.BRANCH:
            _, branches = arg
            widths = [_token_max_span(b) for b in branches]
            tok_w = None if any(w is None for w in widths) else max(w for w in widths if w is not None)
            d = _branch_zip_parts(branches, ascii_only)
            if d is None:
                flush()
            else:
                hoist(d)
        elif op is rp.SUBPATTERN:
            _, add_flags, del_flags, sub = arg
            if add_flags or del_flags:
                return None
            d = _node_parts(sub, ascii_only, 0)
            if d is None:
                return None
            hoist(d)
            tok_w = _token_max_span(sub)
        elif op in (rp.MAX_REPEAT, rp.MIN_REPEAT, rp.POSSESSIVE_REPEAT):
            lo, hi, sub = arg
            sub_max = _token_max_span(sub)
            if hi is rp.MAXREPEAT:
                tok_w = 0 if sub_max == 0 else None
            else:
                tok_w = None if sub_max is None else hi * sub_max
            if lo == 0:
                flush()  # optional: no constraint, breaks adjacency
            else:
                d = _node_parts(sub, ascii_only, 0)
                if d is None:
                    return None
                if (
                    len(d) == 1 and len(d[0][0]) == 1 and d[0][1]
                    and sub_max is not None and sub_max == len(next(iter(d[0][0])))
                ):
                    # only a repeat of an exact single literal is a required substring of every match
                    only = next(iter(d[0][0]))
                    extend({only * min(lo, _GATE_MAX_LIT_LEN)}, sub_max)
                else:
                    hoist(d)
                if hi != lo:
                    # variable count breaks adjacency with the lo-variant the run absorbed
                    flush()
        elif op is rp.ASSERT:
            _, sub = arg
            d = _node_parts(sub, ascii_only, 0)
            if d is None:
                return None
            flush()
            parts.extend((part, False, None, None) for part, _, _, _ in d)
            tok_w = 0
        elif op is rp.ASSERT_NOT:
            tok_w = 0  # zero-width, content is forbidden rather than required
        else:
            flush()  # unknown node: no constraint, breaks adjacency
            tok_w = None
        if width is not None:
            width = None if tok_w is None else width + tok_w
    flush()
    return parts


def _ci_part_variants(part: frozenset[str]) -> frozenset[str] | None:
    out: set[str] = set()
    for lit in part:
        if any(c in lit for c in _CI_UNSAFE_CHARS):
            return None
        out.add(lit.casefold())
    return frozenset(out)


def _extract_gate(
    pattern: str, flags: int
) -> tuple[tuple[tuple[frozenset[str], bool, int | None, int | None], ...], tuple[int, ...]] | None:
    ci = bool(flags & re.IGNORECASE)
    parts = _node_parts(_re_parser.parse(pattern, flags), bool(flags & re.ASCII), 0)
    if parts is None:
        return None
    out = []
    for part, positional, prefix, span in parts:
        if ci:
            part_ci = _ci_part_variants(part)
            if part_ci is None:
                continue
            part = part_ci
        out.append((part, positional, prefix, span))
    if not out:
        return None
    # parts stay in pattern order (the narrowing chain needs it); evaluation probes the most selective part first
    eval_order = tuple(
        sorted(
            range(len(out)),
            key=lambda i: (len(out[i][0]), -min(len(lit) for lit in out[i][0])),
        )
    )
    return (tuple(out), eval_order)


def _gate_hits(
    gate: tuple[tuple[tuple[frozenset[str], bool, int | None, int | None], ...], tuple[int, ...]],
    present,
) -> bool:
    parts, eval_order = gate
    for idx in eval_order:
        part = parts[idx][0]
        hit = False
        for lit in part:
            if present(lit):
                hit = True
                break
        if not hit:
            return False
    return True


_HARVEST_MIN_LEN: Final = 512


def _make_presence(hay: str, cache: dict[str, bool]):
    """Literal-presence predicate over hay with a per-scan memo cache.

    For texts over 512 chars, first harvest the charset and the bigram and
    trigram sets (one O(n) pass each): a literal cannot be present unless all
    its trigrams are, eliminating ~95% of misses at set-lookup cost
    versus an O(n) str scan per literal.
    """
    if len(hay) <= _HARVEST_MIN_LEN:

        def present(lit: str) -> bool:
            result = cache.get(lit)
            if result is None:
                result = lit in hay
                cache[lit] = result
            return result

        return present

    charset = frozenset(hay)
    bigrams = frozenset(zip(hay, hay[1:], strict=False))
    trigrams = frozenset(zip(hay, hay[1:], hay[2:], strict=False))

    def present_harvested(lit: str) -> bool:
        result = cache.get(lit)
        if result is None:
            n = len(lit)
            if n == 1:
                result = lit in charset
            elif n == 2:
                result = (lit[0], lit[1]) in bigrams
            else:
                result = False
                for i in range(n - 2):
                    if (lit[i], lit[i + 1], lit[i + 2]) not in trigrams:
                        break
                else:
                    result = lit in hay
            cache[lit] = result
        return result

    return present_harvested
