"""
Colour-set evaluation for the display-condition matrix (Table 3.3).

TEST 1  Contrast metrics for candidate colour sets (achromatic condition included).
TEST 2  Is the contrast "crossover" between polarities a design achievement or a
        mathematical necessity?
TEST 3  Confounding check: is luminance contrast confounded with polarity?
TEST 4  Identifiability: can the planned model comparison separate a residual
        HUE effect from a CONTRAST effect, and at what effect size / sample size?
"""
import math
import numpy as np
from scipy.stats import chi2

# ---------- colorimetry (WCAG 2.x / sRGB) ----------
def _lin(c):
    c /= 255.0
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4

def rel_lum(hx):
    h = hx.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126*_lin(r) + 0.7152*_lin(g) + 0.0722*_lin(b)

def wcag(bg, fg):
    a, b = rel_lum(bg), rel_lum(fg)
    hi, lo = max(a, b), min(a, b)
    return (hi+0.05)/(lo+0.05)

def michelson(bg, fg):
    a, b = rel_lum(bg), rel_lum(fg)
    hi, lo = max(a, b), min(a, b)
    return 0.0 if hi+lo == 0 else (hi-lo)/(hi+lo)

def level(r):
    return 'AAA' if r >= 7 else 'AA' if r >= 4.5 else 'AA Large' if r >= 3 else 'Fail'

WHITE, BLACK = '#FFFFFF', '#000000'

SETS = {
 'A. Current (4 chromatic + achromatic)': {'blue':'#1E4ED8','red':'#C81E1E','yellow':'#C9A400','green':'#00A651'},
 'B. Original 3 chromatic + achromatic' : {'blue':'#1E4ED8','red':'#C81E1E','yellow':'#C9A400'},
 'C. Luminance-matched chromatic'       : {'blue':'#5B7BE8','red':'#D96A6A','yellow':'#B9A24A','green':'#5FA96F'},
 'D. Web-default hues'                  : {'blue':'#0000FF','red':'#FF0000','yellow':'#FFFF00','green':'#008000'},
}

def cells(cols):
    """All conditions incl. achromatic. Returns list of (name, polarity, wcag, michelson, relLum)."""
    out = []
    for p, bg in enumerate([WHITE, BLACK]):
        ach = BLACK if bg == WHITE else WHITE
        out.append(('achromatic', p, wcag(bg, ach), michelson(bg, ach), rel_lum(ach)))
        for cn, hx in cols.items():
            out.append((cn, p, wcag(bg, hx), michelson(bg, hx), rel_lum(hx)))
    return out

print("="*100)
print("TEST 1 — CONTRAST METRICS PER CANDIDATE SET (achromatic condition included)")
print("="*100)
summary = {}
for name, cols in SETS.items():
    cs = cells(cols)
    pos = [c for c in cs if c[1] == 0]; neg = [c for c in cs if c[1] == 1]
    print(f"\n### {name}")
    print(f"{'colour':11s} | {'WCAG(white)':>12s} {'lvl':>9s} | {'WCAG(black)':>12s} {'lvl':>9s}")
    for (cn,_,wp,_,_), (_,_,wn,_,_) in zip(pos, neg):
        print(f"{cn:11s} | {wp:12.2f} {level(wp):>9s} | {wn:12.2f} {level(wn):>9s}")
    wp_ = [c[2] for c in pos]; wn_ = [c[2] for c in neg]
    lp = [math.log10(v) for v in wp_]; ln = [math.log10(v) for v in wn_]
    subp = sum(1 for v in wp_ if v < 4.5); subn = sum(1 for v in wn_ if v < 4.5)
    summary[name] = dict(wp=wp_, wn=wn_, lp=lp, ln=ln, subp=subp, subn=subn,
                         mlp=np.mean(lp), mln=np.mean(ln), minp=min(wp_), minn=min(wn_))
    print(f"  sub-AA: positive {subp}, negative {subn} | mean log10 WCAG: {np.mean(lp):.3f} / {np.mean(ln):.3f} "
          f"(diff {abs(np.mean(lp)-np.mean(ln)):.3f}) | worst condition: {min(min(wp_),min(wn_)):.2f}:1")

print("\n" + "="*100)
print("TEST 2 — IS THE CROSSOVER A DESIGN ACHIEVEMENT OR A MATHEMATICAL NECESSITY?")
print("="*100)
print("""On white, WCAG contrast = 1.05/(L+0.05): strictly DECREASING in the text's relative
luminance L.  On black, WCAG = (L+0.05)/0.05: strictly INCREASING in L.  Both depend on
the same single quantity L, so the rank order of any colour set must reverse exactly.""")
for name, cols in SETS.items():
    s = summary[name]
    # chromatic-only ranks (exclude the achromatic anchor)
    wp_c, wn_c = s['wp'][1:], s['wn'][1:]
    rp = np.argsort(np.argsort(wp_c)); rn = np.argsort(np.argsort(wn_c))
    n = len(rp); d2 = float(np.sum((rp-rn)**2))
    rho_c = 1 - 6*d2/(n*(n*n-1))
    # all conditions incl. achromatic
    rp2 = np.argsort(np.argsort(s['wp'])); rn2 = np.argsort(np.argsort(s['wn']))
    n2 = len(rp2); d22 = float(np.sum((rp2-rn2)**2))
    rho_a = 1 - 6*d22/(n2*(n2*n2-1))
    print(f"  {name:40s} chromatic-only rho = {rho_c:+.2f} | incl. achromatic rho = {rho_a:+.2f}")

print("""
=> For the CHROMATIC colours the reversal is exactly rho = -1.00 in every candidate set.
   It is a mathematical property of contrast-on-white versus contrast-on-black, not
   something a particular colour choice creates.  The synopsis must not claim otherwise.

=> The ACHROMATIC pair behaves differently and is the more valuable feature: black-on-white
   and white-on-black both give 21.00:1, so that pair varies POLARITY WITH LUMINANCE
   CONTRAST HELD CONSTANT.  It is a contrast-matched, experimentally clean test of polarity,
   which is exactly what the reviewer noted the chromatic conditions cannot provide.""")

print("\n" + "="*100)
print("TEST 3 — IS CONTRAST CONFOUNDED WITH POLARITY?  (correlation across the condition set)")
print("="*100)
print(f"{'set':40s} {'r(polarity, log10 contrast)':>28s} {'|mean diff|':>12s} {'worst cond':>11s}")
for name, s in summary.items():
    pol = np.array([0]*len(s['lp']) + [1]*len(s['ln']))
    lc  = np.array(s['lp'] + s['ln'])
    r = float(np.corrcoef(pol, lc)[0, 1])
    print(f"{name:40s} {r:+28.3f} {abs(s['mlp']-s['mln']):12.3f} {min(s['minp'],s['minn']):10.2f}:1")
print("""
   r near 0 = polarity and contrast are close to orthogonal across the condition set,
   which is what allows both to enter the model without collinearity.""")

print("\n" + "="*100)
print("TEST 4 — CAN THE MODEL COMPARISON SEPARATE RESIDUAL HUE FROM CONTRAST?")
print("="*100)
print("""Condition means are simulated with standard error sigma_w/sqrt(n).
Model C (parsimonious): mean ~ polarity + log10(contrast)          [3 parameters]
Model F (saturated)   : mean ~ polarity x colour                   [all cells free]
Model F is saturated, so the extra-sum-of-squares test of C-vs-F is
   X2 = RSS_C / SE^2  ~  chi-square(df = ncells - 3)   under 'contrast is sufficient'.
Residual hue effect is expressed in within-participant SD units (Cohen's d).""")

rng = np.random.default_rng(20260813)

def power_residual_hue(cols, d_hue, n_part, sigma_w=1.0, reps=4000):
    cs = cells(cols)
    pol = np.array([c[1] for c in cs], float)
    names = [c[0] for c in cs]
    lc = np.array([math.log10(c[2]) for c in cs]); lcz = (lc-lc.mean())/lc.std()
    k = len(cs)
    X = np.column_stack([np.ones(k), pol, lcz])
    # true means: contrast effect + polarity effect + (optional) red-specific hue effect
    mu = -0.6*lcz + 0.25*pol + d_hue*np.array([1.0 if n == 'red' else 0.0 for n in names])
    se = sigma_w/math.sqrt(n_part)
    df = k - X.shape[1]
    crit = chi2.ppf(0.95, df)
    hits = 0
    for _ in range(reps):
        y = mu + rng.normal(0, se, k)
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        rss = float(np.sum((y - X@beta)**2))
        if rss/se**2 > crit: hits += 1
    return hits/reps

cur = SETS['A. Current (4 chromatic + achromatic)']
print(f"\nSet A (current), residual hue effect on RED only:")
print(f"{'d (SD units)':>13s} " + "".join(f"{'n='+str(n):>9s}" for n in (60,100,150,200)))
for d in (0.0, 0.10, 0.15, 0.20, 0.30):
    row = "".join(f"{power_residual_hue(cur, d, n)*100:8.1f}%" for n in (60,100,150,200))
    lbl = f"{d:.2f}" + (" (null)" if d == 0 else "")
    print(f"{lbl:>13s} {row}")
print("""
   Row d = 0.00 is the false-positive rate and should sit near 5%.
   Rows below give power to detect a hue effect of that size beyond contrast.""")
