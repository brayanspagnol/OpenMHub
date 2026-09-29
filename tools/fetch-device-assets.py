#!/usr/bin/env python3
"""Build the device catalog from the product pictures used by MCHOSE's M HUB.

M HUB (the official app, also served at https://www.mchose.com.cn) decides which picture to show
for a device from its HID product name (and, for the magnetic keyboards, from its VID/PID). This
script reads that mapping from M HUB's own web bundle and from its remote config
(configCenter/custom/cardList.json) and writes:

  app/renderer/data/device-catalog.js       the mapping with the pictures' CDN URLs, read by device-images.js
  app/renderer/assets/devices/generic/*     generic mouse/keyboard/receiver icons (bundled fallback)

The product pictures themselves are not bundled: the app downloads them from cdn.mchose.com.cn
on first use and caches them (see the mhub-img protocol in app/main.js).

Run it with:  uv run --with pillow tools/fetch-device-assets.py
It only needs network access to mchose.com.cn. Downloads (used to check the pictures and pick
colour dots) are cached in ~/.cache/mhub-linux-assets;
delete that folder to fetch everything again.
"""
import base64
import hashlib
import io
import json
import re
import sys
import subprocess
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RENDERER = ROOT / 'app' / 'renderer'
OUT_IMG = RENDERER / 'assets' / 'devices'
OUT_JS = RENDERER / 'data' / 'device-catalog.js'
CACHE = Path.home() / '.cache' / 'mhub-linux-assets'
SITE = 'https://www.mchose.com.cn'
CDN = 'https://cdn.mchose.com.cn/configCenter'


def fetch(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / hashlib.sha1(url.encode()).hexdigest()
    if f.exists():
        return f.read_bytes()
    tmp = f.with_suffix('.part')
    # curl copes with this CDN's slow, stalling responses much better than urllib.
    r = subprocess.run(['curl', '-sfL', '--retry', '4', '--retry-all-errors', '-m', '120', '-A', 'Mozilla/5.0 mhub-linux',
                        '-o', str(tmp), urllib.parse.quote(url, safe=':/?=&%')])
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f'download failed ({r.returncode}): {url}')
    tmp.rename(f)
    return f.read_bytes()


def prefetch(urls):
    with ThreadPoolExecutor(12) as pool:
        for n, _ in enumerate(pool.map(fetch, sorted(set(urls))), 1):
            if n % 50 == 0:
                print(f'  {n} files downloaded', flush=True)


def text(url):
    return fetch(url).decode('utf-8', 'replace')


def remote_json(path):
    d = json.loads(text(f'{CDN}/{path}'))
    if '__compressBase64__' in d:
        z = zipfile.ZipFile(io.BytesIO(base64.b64decode(d.pop('__compressBase64__'))))
        d.update(json.loads(z.read('data.json')))
    return d


def xor_decode(s, key='mchose_secret_2024'):
    raw = base64.b64decode(s)
    return ''.join(chr(b ^ ord(key[i % len(key)])) for i, b in enumerate(raw))


# ---------------------------------------------------------------- M HUB web bundle

def load_bundle():
    html = text(SITE + '/')
    main = re.search(r'src="(/assets/main-[^"]+\.js)"', html).group(1)
    css = re.findall(r'href="(/assets/[^"]+\.css)"', html)
    js = text(SITE + main)
    chunks = set(re.findall(r'assets/[A-Za-z0-9_.-]+\.js', js)) | set(re.findall(r'/assets/[A-Za-z0-9_.-]+\.js', html))
    bundle = None
    for c in sorted(chunks):
        body = text(f'{SITE}/{c.lstrip("/")}')
        if 'deviceImage:' in body and '"color-white",pic:' in body:
            bundle = body
        for m in re.findall(r'assets/[A-Za-z0-9_.-]+\.css', body):
            css.append('/' + m)
    if not bundle:
        sys.exit('Could not find the chunk with the device colour lists in the M HUB bundle.')
    styles = '\n'.join(text(SITE + c) for c in dict.fromkeys(css))
    return bundle, styles


def image_vars(bundle):
    cdn_fn = re.search(r'function (\w+)\(\w\)\{return`https://cdn\.mchose\.com\.cn/configCenter/assets\$\{\w\}`\}', bundle).group(1)
    v = {}
    for name, url in re.findall(r'(?<![\w$])([\w$]+)="(https://cdn\.mchose\.com\.cn/configCenter/static/images/[^"]+)"', bundle):
        v[name] = url
    for name, path in re.findall(r'(?<![\w$])([\w$]+)=' + re.escape(cdn_fn) + r'\("([^"]+)"\)', bundle):
        v[name] = f'{CDN}/assets{path}'
    return v


def color_items(body, v):
    out = []
    for part in body.split('},{'):
        c = re.search(r'color:"([^"]+)"', part)
        p = re.search(r'pic:([\w$?:]+)', part)
        t = re.search(r'deviceImage:([\w$]+)', part)
        if not c or not p:
            continue
        pic = p.group(1)
        if '?' in pic:  # flag?a:b  -> keep the default (b) picture
            pic = pic.split(':')[-1]
        if pic not in v:
            continue
        out.append({'color': c.group(1), 'card': v[pic], 'top': v.get(t.group(1)) if t else None})
    return out


def parse_keyboards(bundle, v):
    """Sinowealth keyboards: T==="G98_V2"?M=[{color, pic, deviceImage}, ...]"""
    res = {}
    for key, body in re.findall(r'T==="([\w ]+)"(?:\?M=|&&\(M=)\[([^\]]*)\]', bundle):
        items = color_items(body, v)
        if items and key not in res:
            res[key] = items
    return res


def parse_mice(bundle, v):
    """Mice: flags like X=a.indexOf("A7 V2 Pro")!==-1, then X?je=[...]:Y?je=[...]"""
    start = bundle.index('deviceType:Va.MOUSE')
    seg = bundle[bundle.rfind('continue;', 0, start):start]
    flags = {}
    decl = re.search(r'const (\w+=a\.indexOf.*?);', seg).group(1)
    for name, expr in re.findall(r'(?:^|,)([\w$]+)=(.+?)(?=,[\w$]+=|$)', decl):
        names = []
        for plain, b64, xored in re.findall(r'indexOf\((?:"([^"]+)"|atob\("([^"]+)"\)|\w+\("([^"]+)"\))\)', expr):
            names.append(plain or (base64.b64decode(b64).decode() if b64 else xor_decode(xored)))
        flags[name] = [n for n in names if n]
    chain = seg[seg.index(decl) + len(decl):]
    res = []
    for m in re.finditer(r'je=\[([^\]]*)\]', chain):
        before = chain[max(0, m.start() - 80):m.start()]
        f = re.search(r'([\w$]+(?:\|\|[\w$]+)*)(?:\?|&&)\(?(?:[\w$]+=[^,?]*,)*$', before)
        items_raw = m.group(1)
        if not f:
            continue
        keys = f.group(1).split('||')
        if len(keys) > 1 and '?' in items_raw:
            # M7 / L7 / A7 share one list: pic:we?M7:Le?L7:A7
            for i, k in enumerate(keys):
                picked = re.sub(r'pic:((?:[\w$]+\?[\w$]+:)*[\w$]+)', lambda mm: 'pic:' + pick(mm.group(1), i), items_raw)
                res.append({'names': flags.get(k, []), 'colors': color_items(picked, v)})
            extra = re.findall(r'(\w+)&&je\.push\(\{color:"([^"]+)",pic:([\w$]+)\}\)', chain[m.end():m.end() + 200])
            for fl, color, pic in extra:
                for r in res[-len(keys):]:
                    if r['names'] == flags.get(fl):
                        r['colors'].append({'color': color, 'card': v[pic], 'top': None})
            continue
        res.append({'names': sum((flags.get(k, []) for k in keys), []), 'colors': color_items(items_raw, v)})
    return res


def pick(expr, i):
    parts = re.split(r'[?:]', expr)  # a?A:b?B:C -> [a, A, b, B, C]
    vals = parts[1::2] + [parts[-1]]
    return vals[min(i, len(vals) - 1)]


def pictures_named(model, v):
    """Pictures such as G3V3_black_xxxx.png, for models whose colour list M HUB fills in at run time."""
    compact = re.sub(r'[^A-Za-z0-9]', '', model)
    out, seen = [], set()
    for url in sorted(set(v.values())):
        m = re.match(re.escape(compact) + r'_([A-Za-z]+)_\w+\.png$', url.rsplit('/', 1)[-1], re.I)
        if m and m.group(1).lower() not in seen:
            seen.add(m.group(1).lower())
            out.append({'color': 'color-' + m.group(1).lower(), 'card': url, 'top': None})
    return out


def parse_headsets(bundle, v):
    start = bundle.index('T.includes("S9 PRO")')
    decl = bundle[bundle.rfind('const ', 0, start):bundle.index(';let Me=[]', start)]
    flags = {}
    for name, inc in re.findall(r'([\w$]+)=T\.includes\("([^"]+)"\)', decl):
        flags[name] = inc
    seg = bundle[bundle.index('if(M)Me=', start):bundle.index('const{productNameRender', start)]
    seg = re.sub(r'if\(ee\)\{.*?\}else ', '', seg)  # K20 GT picture comes from another config
    res = []
    for m in re.finditer(r'(?:if\(|\?|:|else )?\(?([\w$|]+)\)?(?:\?|&&\(|)Me=\[([^\]]*)\]', seg):
        keys = [k for k in m.group(1).split('||') if k in flags]
        if keys:
            res.append({'names': [flags[k] for k in keys], 'colors': color_items(m.group(2), v)})
    return res


def parse_swatches(styles, cards):
    sw = {}
    for cls, val in re.findall(r'\.((?:k7-)?color-[\w-]+)(?:\[data-v-\w+\])?\{background(?:-color|-image)?:([^};]+)', styles):
        sw.setdefault(cls, val.strip())
    for card in cards:
        for c in card.get('colorList', []):
            raw = c.get('styleRaw') or ''
            m = re.search(r"url\('?([^')]+)'?\)", raw)
            if m:
                sw[c['className']] = f'url({m.group(1)})'
    return sw


# ---------------------------------------------------------------- names shown to the user

WORDS = {
    'white': 'branco', 'black': 'preto', 'blue': 'azul', 'red': 'vermelho', 'pink': 'rosa', 'green': 'verde',
    'gray': 'cinza', 'grey': 'cinza', 'silver': 'prata', 'sliver': 'prata', 'golden': 'dourado', 'gold': 'dourado',
    'yellow': 'amarelo', 'orange': 'laranja', 'purple': 'roxo', 'cyan': 'ciano', 'brown': 'marrom',
    'side': 'lateral', 'line': 'linha', 'sky': 'céu', 'ice': 'gelo', 'sea': 'mar', 'star': 'estrela',
    'deep': 'profundo', 'light': 'claro', 'dark': 'escuro', 'mist': 'névoa', 'snow': 'neve', 'stone': 'pedra',
    'cloud': 'nuvem', 'smoke': 'fumê', 'forest': 'floresta', 'night': 'noite', 'navy': 'marinho', 'mecha': 'mecha',
    'moonrock': 'rocha lunar', 'peach': 'pêssego', 'cherry': 'cereja', 'champagne': 'champanhe', 'tea': 'chá',
    'sand': 'areia', 'wave': 'onda', 'feather': 'pena', 'air': 'air', 'shaded': 'degradê', 'shallow': 'suave',
    'north': 'norte', 'pure': 'puro', 'blueness': 'azulado', 'blackberry': 'amora', 'glaze': 'vitral',
    'loose': 'musgo', 'shuang': 'laranja', 'yunwu': 'névoa', 'apricot': 'damasco', 'barde': 'bordô',
    'frosted': 'fosco', 'turbo': 'turbo', 'copy': '', 'headset': '', 'v9t': '', 'mount': 'montanha',
}


def color_label(cls):
    words = [w for w in re.sub(r'^(k7-)?color-', '', cls).split('-')]
    words = [w for w in words if not re.fullmatch(r'(a\d|ax\d|v\d|z75s?|kx75|gx87(v2)?|ace\d+(air\d|-?v\d)?|god\d+|k87|pro|a7|a5|ultra|r7)', w.lower())]
    out = [WORDS.get(w.lower(), w) for w in words]
    s = ' '.join(w for w in out if w).strip() or re.sub(r'^color-', '', cls)
    return s[0].upper() + s[1:]


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


# ---------------------------------------------------------------- pictures

saved = {}


def save_picture(url, dest, box):
    if url in saved:
        return saved[url]
    rel = dest.relative_to(RENDERER).as_posix()
    if dest.exists():  # already converted by an earlier run (delete assets/devices/generic to redo them)
        saved[url] = rel
        return rel
    im = Image.open(io.BytesIO(fetch(url)))
    # Keep the original canvas: the mouse key map places its button labels relative to it.
    im = im.convert('RGBA')
    im.thumbnail(box, Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, 'WEBP', quality=88, method=4)
    saved[url] = rel
    return rel


def average_color(url):
    im = Image.open(io.BytesIO(fetch(url))).convert('RGBA')
    im.thumbnail((64, 64))
    px = [p for p in im.get_flattened_data() if p[3] > 200] if hasattr(im, 'get_flattened_data') else [p for p in im.getdata() if p[3] > 200]
    if not px:
        return '#888888'
    r, g, b = (sum(p[i] for p in px) // len(px) for i in range(3))
    return f'#{r:02x}{g:02x}{b:02x}'


def build():
    bundle, styles = load_bundle()
    v = image_vars(bundle)
    cards = remote_json('custom/cardList.json').get('data', [])
    swatches = parse_swatches(styles, cards)

    models = []
    # Order matters: the first entry whose name matches wins, the same way M HUB checks them.
    for group in parse_mice(bundle, v):
        if not group['colors'] and group['names']:
            group['colors'] = pictures_named(group['names'][0], v)
        if group['colors'] and group['names']:
            models.append({'kind': 'mouse', 'names': group['names'], 'colors': group['colors']})
    kb_names = {
        'G87': ['G87'], 'K99': ['K99'], 'K99_V2': ['K99 V2'], 'G98': ['G98'], 'G87_V2': ['G87 V2'],
        'G98_Pro': ['G98 Pro', 'G98_Pro'], 'G98_V2': ['G98 V2'], 'UT98': ['UT98'], 'Z75': ['Z75'],
        'Z75S': ['Z75 S', 'Z75S'], 'KX75': ['KX75'], 'X75_V2': ['X75 V2', 'X75_V2'], 'X75': ['X75'],
        'GX87_V2': ['GX87 V2'], 'GX87': ['GX87'], 'K87': ['K87'], 'G75_Pro': ['G75 Pro', 'G75_Pro'],
        'G75_V2': ['G75 V2'],
    }
    kbs = parse_keyboards(bundle, v)
    # Magnetic keyboards (listed by VID/PID in cardList.json) come first: their names overlap
    # with the older boards (G98 V3 vs G98, K99 V3 vs K99, G87 V2 HE vs G87 V2).
    for card in cards:
        desc = card.get('desc', '')
        name = re.split(r'\s*(磁轴|配置|（)', desc)[0].strip()
        ids = [[int(i['vendorId'], 16), int(i['productId'], 16)] for i in card.get('identities', [])]
        colors = [{'color': c['className'], 'card': c.get('image'), 'top': c.get('deviceImage')}
                  for c in card.get('colorList', []) if c.get('image') or c.get('deviceImage')]
        if colors:
            models.append({'kind': 'keyboard', 'names': [name], 'ids': ids, 'colors': colors})
    # Specific names before generic ones (K99 V2 before K99, X75 V2 before X75 ...).
    for key in sorted(kbs, key=lambda k: -max(len(n) for n in kb_names.get(k, [k]))):
        models.append({'kind': 'keyboard', 'names': kb_names.get(key, [key.replace('_', ' ')]), 'colors': kbs[key]})
    # M HUB tells "V9 PRO 2" from "V9 PRO" with exclusions; here the longer name simply goes first.
    for group in sorted(parse_headsets(bundle, v), key=lambda g: -max(len(n) for n in g['names'])):
        if group['colors']:
            models.append({'kind': 'headset', 'names': group['names'], 'colors': group['colors']})

    urls = [u for m in models for c in m['colors'] for u in (c['card'], c.get('top')) if u]
    print(f'{len(models)} models, downloading {len(set(urls))} pictures...', flush=True)
    prefetch(urls)

    catalog = []
    for m in models:
        model_slug = slug(m['names'][0])
        colors = []
        for c in m['colors']:
            cs = slug(re.sub(r'^(k7-)?color-', '', c['color']))
            card = c['card'] or c['top']
            top = c.get('top')
            sw = swatches.get(c['color'])
            if sw and 'url(' in sw:
                u = re.search(r'url\(([^)]+)\)', sw).group(1).strip('\'"')
                sw = average_color(card) if u.endswith('.svg') else f'url({u})'
            colors.append({'id': cs, 'label': color_label(c['color']), 'dot': sw or average_color(c['card'] or c['top']),
                           'card': card, **({'top': top} if top else {})})
        entry = {'kind': m['kind'], 'names': m['names']}
        if m.get('ids'):
            entry['ids'] = m['ids']
        entry['colors'] = colors
        catalog.append(entry)

    generic = {}
    # Line icons M HUB uses for device types, and its photo of the 8K receiver.
    for kind, path in {'mouse': '/img/global/mouse_icon.png', 'keyboard': '/img/global/keyboard_icon.png',
                       'receiver': '/img/global/mouse_base_8k.png'}.items():
        generic[kind] = save_picture(f'{CDN}/assets{path}', OUT_IMG / 'generic' / f'{kind}.webp', (620, 620))

    header = ('// Generated by tools/fetch-device-assets.py from M HUB\'s own colour lists and pictures\n'
              '// (www.mchose.com.cn bundle + configCenter/custom/cardList.json). Do not edit by hand:\n'
              '// run `uv run --with pillow tools/fetch-device-assets.py` again instead.\n'
              '//\n'
              '// Each entry: names matched against the HID product name (first match wins, like M HUB),\n'
              '// optional [vendorId, productId] pairs, and the colours with their card and top-view pictures.\n')
    body = 'export const GENERIC = ' + json.dumps(generic, ensure_ascii=False) + ';\n\n'
    body += 'export default [\n' + ',\n'.join('  ' + json.dumps(e, ensure_ascii=False) for e in catalog) + ',\n];\n'
    OUT_JS.write_text(header + '\n' + body)
    print(f'{len(catalog)} models, generic icons -> {OUT_IMG.relative_to(ROOT)}, catalog -> {OUT_JS.relative_to(ROOT)}')


if __name__ == '__main__':
    build()
