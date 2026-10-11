"""A small, dependency-free MDX → HTML converter for the Backend course chapters.

It covers what those chapters actually use: front matter, GitHub-flavoured Markdown (headings,
paragraphs, emphasis, links, lists, tables, blockquotes, fenced code with `title="…"`), and the
course's components — <Callout>, <Diagram> (inline SVG), <Steps>/<Step>, <StepBranch> with
<Fragment slot>. Consecutive code blocks introduced by a language line such as
"Go Python JavaScript" become one tabbed block. Code is highlighted with a light tokenizer.

    front, html, sections = render(path)   # sections: [(id, title)] for every ## heading
"""
import html
import re

LANGS = {"Go": "go", "Python": "python", "JavaScript": "js", "TypeScript": "ts", "Java": "java", "SQL": "sql"}
LANG_NAMES = {v: k for k, v in LANGS.items()}
LABEL_LINE = re.compile(r"^(?:(?:%s)\s*)+$" % "|".join(sorted(LANGS, key=len, reverse=True)))
INLINE_TAGS = {"kbd", "br", "sup", "sub", "em", "strong", "b", "i", "u", "mark", "small", "span", "abbr", "del", "s"}
CONTAINERS = {"Callout", "Diagram", "Steps", "Step", "StepBranch", "Fragment"}


def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", html.unescape(s).lower()).strip("-")
    return s or "section"


# ───────────────────────── front matter ─────────────────────────

def front_matter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    raw, body = text[3:end], text[end + 4:]
    meta, key = {}, None
    for line in raw.splitlines():
        if not line.strip():
            continue
        m = re.match(r"^([A-Za-z_]\w*):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            meta[key] = [] if val == "" else _scalar(val)
        elif key and line.strip().startswith("- "):
            if not isinstance(meta.get(key), list):
                meta[key] = []
            meta[key].append(_scalar(line.strip()[2:].strip()))
    return meta, body.lstrip("\n")


def _scalar(v):
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
        return v.replace('\\"', '"') if v else v
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    if v in ("true", "false"):
        return v == "true"
    return v


# ───────────────────────── inline ─────────────────────────

def inline(text):
    stash = []

    def keep(s):
        stash.append(s)
        return f"\x00{len(stash) - 1}\x00"

    # code spans first: their contents are literal
    text = re.sub(r"(`+)(.+?)\1", lambda m: keep("<code>" + html.escape(m.group(2).strip() if m.group(2).strip() else m.group(2)) + "</code>"), text)
    text = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|<>~])", lambda m: keep(html.escape(m.group(1))), text)
    # a small whitelist of inline HTML passes through; any other "<" is text
    text = re.sub(r"</?([a-z]+)(?:\s[^<>]*)?/?>", lambda m: keep(m.group(0)) if m.group(1) in INLINE_TAGS else m.group(0), text)
    text = re.sub(r"<(https?://[^>\s]+)>", lambda m: keep(f'<a href="{html.escape(m.group(1))}" target="_blank" rel="noopener">{html.escape(m.group(1))}</a>'), text)

    def link(m):
        img, label, url = m.group(1), m.group(2), m.group(3).strip().split(" ")[0].strip("<>")
        if not re.match(r"^(https?:|mailto:|#|/|\.)", url):
            return m.group(0)
        if img:
            return keep(f'<img src="{html.escape(url)}" alt="{html.escape(label)}" loading="lazy">')
        ext = ' target="_blank" rel="noopener"' if url.startswith("http") else ""
        return keep(f'<a href="{html.escape(url)}"{ext}>') + label + keep("</a>")
    text = re.sub(r"(!?)\[([^\]]*)\]\(([^)\s]+(?:\s+\"[^\"]*\")?)\)", link, text)
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*|__(.+?)__", lambda m: f"<strong>{m.group(1) or m.group(2)}</strong>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
    text = re.sub(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])", r"<em>\1</em>", text)
    text = re.sub(r"~~(.+?)~~", r"<del>\1</del>", text)
    for _ in range(3):  # nested stashes (a link label containing code)
        text = re.sub(r"\x00(\d+)\x00", lambda m: stash[int(m.group(1))], text)
    return text


# ───────────────────────── code highlighting ─────────────────────────

KEYWORDS = {
    "go": "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false err",
    "python": "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self",
    "js": "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
    "java": "abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while var record",
    "sql": "select from where insert into values update set delete create table index on join left right inner outer group by order having limit offset as and or not null primary key references begin commit rollback returning distinct count sum avg min max unique default constraint foreign varchar text integer bigint serial timestamp exists in is case when then else end with",
    "bash": "if then else fi for do done while case esac function in echo export local return sudo cd",
    "yaml": "true false null yes no",
}
KEYWORDS["cpp"] = ("auto bool break case catch char class const continue default delete do double else enum explicit false float for friend if inline int long "
                   "namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef "
                   "typename unsigned using virtual void while vector string map set unordered_map unordered_set pair queue stack priority_queue deque include define")
KEYWORDS["ts"] = KEYWORDS["js"] + " interface type enum implements private public readonly as keyof namespace declare number string boolean any unknown never"
KEYWORDS["typescript"] = KEYWORDS["ts"]
KEYWORDS["javascript"] = KEYWORDS["js"]
KEYWORDS["shell"] = KEYWORDS["sh"] = KEYWORDS["bash"]
KEYWORDS["dockerfile"] = "FROM RUN COPY ADD WORKDIR ENV EXPOSE CMD ENTRYPOINT ARG USER AS HEALTHCHECK LABEL VOLUME"
HASH_COMMENT = {"python", "bash", "sh", "shell", "yaml", "dockerfile", "nginx", "toml"}
DASH_COMMENT = {"sql"}
TOKEN = re.compile(r"""
    (?P<com>//[^\n]*|/\*.*?\*/|\#[^\n]*|--[^\n]*)
  | (?P<str>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)
  | (?P<num>\b\d[\d_]*(?:\.\d+)?\b)
  | (?P<word>[A-Za-z_][\w]*)(?P<call>\s*\()?
""", re.S | re.X)


def highlight(code, lang):
    lang = (lang or "").lower()
    kws = set(KEYWORDS.get(lang, "").split())
    ci = lang in ("sql", "dockerfile")
    if ci:
        kws = {k.lower() for k in kws}
    if lang in ("text", "", "http", "json", "html", "protobuf", "nginx") and lang != "json":
        return html.escape(code)
    out, pos = [], 0
    for m in TOKEN.finditer(code):
        kind, tok = m.lastgroup, m.group(0)
        if kind == "com":
            ok = (tok.startswith("#") and lang in HASH_COMMENT) or (tok.startswith("--") and lang in DASH_COMMENT) or \
                 (tok.startswith(("//", "/*")) and lang not in HASH_COMMENT | DASH_COMMENT)
            if not ok:
                continue
        out.append(html.escape(code[pos:m.start()]))
        if kind == "word" or m.group("word"):
            word = m.group("word")
            if (word.lower() if ci else word) in kws:
                out.append(f'<span class="kw">{html.escape(word)}</span>')
            elif m.group("call"):
                out.append(f'<span class="fn">{html.escape(word)}</span>')
            else:
                out.append(html.escape(word))
            if m.group("call"):
                out.append(html.escape(m.group("call")))
        else:
            out.append(f'<span class="{ {"com": "com", "str": "str", "num": "num"}[kind] }">{html.escape(tok)}</span>')
        pos = m.end()
    out.append(html.escape(code[pos:]))
    return "".join(out)


def code_block(lang, title, code):
    head = (f'<div class="cb-head"><span>{html.escape(title)}</span><em>{html.escape(lang)}</em></div>' if title
            else f'<div class="cb-head"><span></span><em>{html.escape(lang)}</em></div>' if lang and lang != "text" else "")
    return f'<div class="cb" data-lang="{html.escape(lang)}">{head}<pre><code>{highlight(code, lang)}</code></pre></div>'


# ───────────────────────── blocks ─────────────────────────

FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*(.*)$")
LIST_ITEM = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")


class Doc:
    def __init__(self):
        self.ids, self.sections = set(), []

    def anchor(self, text):
        base = slugify(text)
        sid, n = base, 2
        while sid in self.ids:
            sid, n = f"{base}-{n}", n + 1
        self.ids.add(sid)
        return sid


def is_close(line, fence):
    """A closing fence is only fence characters (at least as many as the opener) — CommonMark."""
    return bool(re.match(r"^\s*%s{%d,}\s*$" % (re.escape(fence[0]), len(fence)), line))


def dedent(lines):
    ind = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    return [l[ind:] for l in lines]


def find_close(lines, i, tag):
    """Index of the line holding the </tag> matching the <tag …> on line i (nesting-aware)."""
    depth = 0
    for j in range(i, len(lines)):
        opens = len(re.findall(rf"<{tag}(?=[\s>/])", lines[j])) - len(re.findall(rf"<{tag}[^>]*/>", lines[j]))
        closes = len(re.findall(rf"</{tag}>", lines[j]))
        depth += opens - closes
        if depth <= 0 and j >= i:
            return j
    return len(lines) - 1


def attrs(tag_line):
    return dict(re.findall(r'(\w+)="([^"]*)"', tag_line))


def blocks(lines, doc):
    """Parse lines into a list of nodes: (kind, payload)."""
    nodes, i = [], 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        m = FENCE.match(line)
        if m:
            ind, fence, lang, info = m.groups()
            title = (re.search(r'title="([^"]*)"', info) or [None, None])[1]
            j = i + 1
            while j < len(lines) and not is_close(lines[j], fence):
                j += 1
            body = [l[len(ind):] if l.startswith(ind) else l.lstrip() for l in lines[i + 1:j]]
            if body and body[0].strip() == line.strip():  # the source repeats its opener line in a few places
                body = body[1:]
            nodes.append(("code", (lang or "", title, "\n".join(body))))
            i = j + 1
            continue
        tm = re.match(r"^<([A-Za-z][\w]*)", s)
        if tm and tm.group(1) in CONTAINERS:
            tag = tm.group(1)
            j = find_close(lines, i, tag)
            open_line = lines[i]
            inner = lines[i + 1:j] if j > i else []
            if s.endswith("/>"):
                inner, j = [], i
            # content on the same line as the open/close tag
            after = open_line.split(">", 1)[1] if ">" in open_line else ""
            if after.strip() and j > i:
                inner = [after] + inner
            if j > i and "</" + tag in lines[j]:
                before = lines[j].split("</" + tag)[0]
                if before.strip():
                    inner = inner + [before]
            nodes.append(("comp", (tag, attrs(open_line), inner)))
            i = j + 1
            continue
        if tm and tm.group(1) == "svg":
            j = find_close(lines, i, "svg")
            nodes.append(("raw", "\n".join(lines[i:j + 1])))
            i = j + 1
            continue
        hm = re.match(r"^(#{1,6})\s+(.*?)\s*#*$", s)
        if hm:
            nodes.append(("h", (len(hm.group(1)), hm.group(2))))
            i += 1
            continue
        if re.match(r"^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$", s):
            nodes.append(("hr", None))
            i += 1
            continue
        if s.startswith(">"):
            j = i
            quote = []
            while j < len(lines) and lines[j].strip().startswith(">"):
                quote.append(re.sub(r"^\s*>\s?", "", lines[j]))
                j += 1
            nodes.append(("quote", blocks(quote, doc)))
            i = j
            continue
        if "|" in s and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$", lines[i + 1]):
            j = i + 2
            while j < len(lines) and lines[j].strip() and "|" in lines[j]:
                j += 1
            nodes.append(("table", (lines[i], lines[i + 1], lines[i + 2:j])))
            i = j
            continue
        lm = LIST_ITEM.match(line)
        if lm:
            i = parse_list(lines, i, nodes, doc)
            continue
        # paragraph
        j = i
        para = []
        while j < len(lines) and lines[j].strip() and not starts_block(lines[j]):
            para.append(lines[j].strip())
            j += 1
        if not para:  # a lone line that looks like a block we don't handle
            para, j = [s], i + 1
        nodes.append(("p", " ".join(para)))
        i = j
    return nodes


def starts_block(line):
    s = line.strip()
    return bool(FENCE.match(line) or re.match(r"^#{1,6}\s", s) or s.startswith(">") or LIST_ITEM.match(line)
                or re.match(r"^<(%s|svg)\b" % "|".join(CONTAINERS), s) or re.match(r"^</(%s)>" % "|".join(CONTAINERS), s))


def parse_list(lines, i, nodes, doc):
    first = LIST_ITEM.match(lines[i])
    base = len(first.group(1))
    ordered = first.group(2)[0].isdigit()
    start = int(re.match(r"\d+", first.group(2)).group(0)) if ordered else 1
    items, loose = [], False
    while i < len(lines):
        m = LIST_ITEM.match(lines[i])
        if not m or len(m.group(1)) != base or m.group(2)[0].isdigit() != ordered:
            break
        content_ind = len(m.group(1)) + len(m.group(2)) + 1
        body = [" " * content_ind + m.group(3)]
        j = i + 1
        in_fence = False
        while j < len(lines):
            l = lines[j]
            if not in_fence and FENCE.match(l):
                in_fence = FENCE.match(l).group(2)
            elif in_fence and is_close(l, in_fence):
                in_fence = False
            if in_fence:
                body.append(l); j += 1; continue
            if not l.strip():
                nxt = next((k for k in range(j + 1, len(lines)) if lines[k].strip()), None)
                if nxt is not None and len(lines[nxt]) - len(lines[nxt].lstrip()) >= content_ind:
                    body.append(l); j += 1; loose = True; continue
                break
            ind = len(l) - len(l.lstrip())
            if ind >= content_ind or (ind > base and not LIST_ITEM.match(l)):
                body.append(l); j += 1; continue
            if LIST_ITEM.match(l) or starts_block(l):
                break
            body.append(" " * content_ind + l.strip()); j += 1  # lazy continuation
        items.append([l[content_ind:] if len(l) >= content_ind and not l[:content_ind].strip() else l.lstrip() for l in body])
        i = j
        while i < len(lines) and not lines[i].strip():
            nxt = next((k for k in range(i, len(lines)) if lines[k].strip()), None)
            if nxt is not None and LIST_ITEM.match(lines[nxt]) and len(LIST_ITEM.match(lines[nxt]).group(1)) == base:
                loose = True
            i += 1
            if nxt is None or not LIST_ITEM.match(lines[nxt]):
                break
    nodes.append(("list", (ordered, start, [blocks(it, doc) for it in items], loose)))
    return i


# ───────────────────────── rendering ─────────────────────────

def group_tabs(nodes):
    """A paragraph naming languages ("Go Python Java") followed by code blocks → one tabbed block."""
    out, i = [], 0
    while i < len(nodes):
        kind, val = nodes[i]
        if kind == "code" and val[1]:
            tm = re.search(r"((?:\s+(?:%s))+)$" % "|".join(LANGS), val[1])
            if tm and len(tm.group(1).split()) >= 2:
                labels, title = tm.group(1).split(), val[1][:tm.start()].strip()
                j, codes = i, []
                while j < len(nodes) and nodes[j][0] == "code" and len(codes) < len(labels):
                    lang, t, code = nodes[j][1]
                    codes.append((lang, title if j == i else (t or title), code)); j += 1
                out.append(("tabs", list(zip(labels, codes))))
                i = j
                continue
        if kind == "p" and LABEL_LINE.match(val.strip()):
            labels = val.split()
            j, codes, caption = i + 1, [], None
            if len(labels) > 1 and j + 1 < len(nodes) and nodes[j][0] == "p" and nodes[j + 1][0] == "code":
                caption = nodes[j][1]; j += 1   # "Go Python …" / a one-line caption / the code blocks
            while j < len(nodes) and nodes[j][0] == "code" and len(codes) < len(labels):
                codes.append(nodes[j][1]); j += 1
            if len(labels) == 1:  # "Go" code "Python" code … pairs
                while j + 1 < len(nodes) and nodes[j][0] == "p" and LABEL_LINE.match(nodes[j][1].strip()) \
                        and len(nodes[j][1].split()) == 1 and nodes[j + 1][0] == "code":
                    labels.append(nodes[j][1].strip()); codes.append(nodes[j + 1][1]); j += 2
            if codes:
                if caption:
                    out.append(("caption", caption))
                out.append(("tabs", list(zip(labels, codes))))
                i = j
                continue
        out.append(nodes[i])
        i += 1
    return out


def render_nodes(nodes, doc, tight=False):
    parts = []
    for kind, val in group_tabs(nodes):
        if kind == "p":
            parts.append(inline(val) if tight else f"<p>{inline(val)}</p>")
        elif kind == "h":
            level, text = val
            sid = doc.anchor(text)
            if level == 2:
                doc.sections.append((sid, html.unescape(re.sub(r"<[^>]+>", "", inline(text)))))
            parts.append(f'<h{level} id="{sid}">{inline(text)}</h{level}>')
        elif kind == "code":
            parts.append(code_block(*val))
        elif kind == "tabs":
            bar = "".join(f'<button type="button" data-tab-lang="{LANGS.get(lbl, lbl.lower())}"{" class=is-active" if k == 0 else ""}>{lbl}</button>'
                          for k, (lbl, _) in enumerate(val))
            panes = "".join(f'<div class="ct-pane" data-pane-lang="{LANGS.get(lbl, lbl.lower())}"{"" if k == 0 else " hidden"}>{code_block(*c)}</div>'
                            for k, (lbl, c) in enumerate(val))
            parts.append(f'<div class="code-tabs"><div class="ct-bar" role="tablist">{bar}</div>{panes}</div>')
        elif kind == "caption":
            parts.append(f'<p class="ct-caption">{inline(val)}</p>')
        elif kind == "hr":
            parts.append("<hr>")
        elif kind == "quote":
            parts.append(f"<blockquote>{render_nodes(val, doc)}</blockquote>")
        elif kind == "raw":
            parts.append(val)
        elif kind == "table":
            head, sep, rows = val
            cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
            aligns = ["center" if c.startswith(":") and c.endswith(":") else "right" if c.endswith(":") else "" for c in cells(sep)]
            th = "".join(f'<th{f" style=text-align:{aligns[k]}" if k < len(aligns) and aligns[k] else ""}>{inline(c)}</th>' for k, c in enumerate(cells(head)))
            body = "".join("<tr>" + "".join(f'<td{f" style=text-align:{aligns[k]}" if k < len(aligns) and aligns[k] else ""}>{inline(c)}</td>'
                                            for k, c in enumerate(cells(r))) + "</tr>" for r in rows)
            parts.append(f'<div class="table-scroll"><table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>')
        elif kind == "list":
            ordered, start, items, loose = val
            tag = "ol" if ordered else "ul"
            lis = "".join("<li>" + (inline(it[0][1]) + render_nodes(it[1:], doc) if not loose and it and it[0][0] == "p"
                                    else render_nodes(it, doc)) + "</li>" for it in items)
            parts.append(f'<{tag}{f" start={start}" if ordered and start != 1 else ""}>{lis}</{tag}>')
        elif kind == "comp":
            parts.append(component(*val, doc=doc))
    return "".join(parts)


CALLOUT_ICON = {
    "info": '<circle cx="10" cy="10" r="7.5"/><line x1="10" y1="9" x2="10" y2="14"/><circle cx="10" cy="6.2" r=".6" fill="currentColor"/>',
    "ok": '<polyline points="4 10.5 8 14.5 16 5.5"/>',
    "warn": '<path d="M10 3.2 18 17H2Z"/><line x1="10" y1="8" x2="10" y2="11.5"/><circle cx="10" cy="14.2" r=".6" fill="currentColor"/>',
}
CALLOUT_LABEL = {"info": "Note", "ok": "Good practice", "warn": "Watch out"}


def component(tag, a, inner, doc):
    inner = dedent(inner)
    if tag == "Callout":
        t = a.get("type", "info") if a.get("type") in CALLOUT_ICON else "info"
        return (f'<aside class="callout is-{t}"><p class="callout-title"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" '
                f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{CALLOUT_ICON[t]}</svg><span>{html.escape(a.get("title", CALLOUT_LABEL[t]))}</span></p>'
                f'<div class="callout-body">{render_nodes(blocks(inner, doc), doc)}</div></aside>')
    if tag == "Diagram":
        svg = "\n".join(inner)
        svg = re.sub(r"<script\b.*?</script>", "", svg, flags=re.S | re.I)
        svg = re.sub(r"\son\w+=\"[^\"]*\"", "", svg)
        cap = f'<figcaption>{html.escape(a["caption"])}</figcaption>' if a.get("caption") else ""
        return f'<figure class="diagram"><div class="diagram-frame">{svg}</div>{cap}</figure>'
    if tag == "Steps":
        return f'<ol class="steps">{render_nodes(blocks(inner, doc), doc)}</ol>'
    if tag == "Step":
        return f'<li class="step">{render_nodes(blocks(inner, doc), doc)}</li>'
    if tag == "StepBranch":
        body = render_nodes(blocks(inner, doc), doc)
        frags = re.findall(r'<div class="branch-body" data-slot="(\w+)">(.*?)</div><!--/frag-->', body, re.S)
        slots = dict(frags)
        return ('<div class="step-branch">' + "".join(
            f'<div class="branch-box"><p class="branch-label">{html.escape(a.get("label" + k.upper(), k.upper()))}</p><div class="branch-body">{slots.get(k, "")}</div></div>'
            for k in ("a", "b")) + "</div>")
    if tag == "Fragment":
        return f'<div class="branch-body" data-slot="{html.escape(a.get("slot", "a"))}">{render_nodes(blocks(inner, doc), doc)}</div><!--/frag-->'
    return ""


def render(path):
    text = open(path, encoding="utf-8").read().replace("\r\n", "\n")
    meta, body = front_matter(text)
    doc = Doc()
    out = render_nodes(blocks(body.split("\n"), doc), doc)
    return meta, out, doc.sections
