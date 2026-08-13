"""Convert the synopsis from numbered (Vancouver) citations to APA 7th edition."""
import re, sys

# num: (authors, year, title, container, vol, issue, pages, doi, kind)
REFS = {
 1:(["Ccami-Bernal, F.","Soriano-Moreno, D. R.","Romero-Robles, M. A.","Barriga-Chambi, F.","Tuco, K. G.","Castro-Diaz, S. D.","Nuñez-Lupaca, J. N.","Pacheco-Mendoza, J.","Galvez-Olortegui, T.","Benites-Zapata, V. A."],2024,
    "Prevalence of computer vision syndrome: A systematic review and meta-analysis","Journal of Optometry","17","1","100482","10.1016/j.optom.2023.100482","art"),
 2:(["Kaur, K.","Gurnani, B.","Nayak, S.","Deori, N.","Kaur, S.","Jethani, J.","Singh, D.","Agarkar, S.","Hussaindeen, J. R.","Sukhija, J.","Mishra, D."],2022,
    "Digital eye strain: A comprehensive review","Ophthalmology and Therapy","11","5","1655–1680","10.1007/s40123-022-00540-9","art"),
 3:(["Sheppard, A. L.","Wolffsohn, J. S."],2018,
    "Digital eye strain: Prevalence, measurement and amelioration","BMJ Open Ophthalmology","3","1","e000146","10.1136/bmjophth-2018-000146","art"),
 4:(["Pucker, A. D.","Kerr, A. M.","Sanderson, J.","Lievens, C."],2024,
    "Digital eye strain: Updated perspectives","Clinical Optometry","16",None,"233–246","10.2147/OPTO.S412382","art"),
 5:(["Kamøy, B.","Magno, M.","Nøland, S. T.","Moe, M. C.","Petrovski, G.","Vehof, J.","Utheim, T. P."],2022,
    "Video display terminal use and dry eye: Preventive measures and future perspectives","Acta Ophthalmologica","100","7","723–739","10.1111/aos.15105","art"),
 6:(["Fjaervoll, K.","Fjaervoll, H.","Magno, M.","Nøland, S. T.","Dartt, D. A.","Vehof, J.","Utheim, T. P."],2022,
    "Review on the possible pathophysiological mechanisms underlying visual display terminal-associated dry eye disease","Acta Ophthalmologica","100","8","861–877","10.1111/aos.15150","art"),
 7:(["Jiménez, R.","Redondo, B.","Molina, R.","Martínez-Domingo, M. Á.","Hernández-Andrés, J.","Vera, J."],2020,
    "Short-term effects of text-background color combinations on the dynamics of the accommodative response","Vision Research","166",None,"33–42","10.1016/j.visres.2019.11.006","art"),
 8:(["Redondo, B.","Jiménez, R.","Vera, J.","Rosenfield, M."],2025,
    "The impact of break schedules on digital eye strain symptoms and ocular accommodation during prolonged near work","Experimental Eye Research","258",None,"110463","10.1016/j.exer.2025.110463","art"),
 9:(["Buchner, A.","Baumgartner, N."],2007,
    "Text–background polarity affects performance irrespective of ambient illumination and colour contrast","Ergonomics","50","7","1036–1063","10.1080/00140130701306413","art"),
 10:(["Piepenbrock, C.","Mayr, S.","Buchner, A."],2014,
    "Smaller pupil size and better proofreading performance with positive than with negative polarity displays","Ergonomics","57","11","1670–1677","10.1080/00140139.2014.948496","art"),
 11:(["Piepenbrock, C.","Mayr, S.","Buchner, A."],2014,
    "Positive display polarity is particularly advantageous for small character sizes: Implications for display design","Human Factors","56","5","942–951","10.1177/0018720813515509","art"),
 12:(["Fan, Q.","Xie, J.","Dong, Z.","Wang, Y."],2024,
    "The effect of ambient illumination and text color on visual fatigue under negative polarity","Sensors","24","11","3516","10.3390/s24113516","art"),
 13:(["Dobres, J.","Chahine, N.","Reimer, B."],2017,
    "Effects of ambient illumination, contrast polarity, and letter size on text legibility under glance-like reading","Applied Ergonomics","60",None,"68–73","10.1016/j.apergo.2016.11.001","art"),
 14:(["Lin, C.","Ji, Z.","Lin, Y."],2024,
    "Optimum display luminance and contrast polarity of desktop head-up display under office lighting level based on visual ergonomic study","Ergonomics","67","11","1491–1503","10.1080/00140139.2024.2339439","art"),
 15:(["Singh, S.","McGuinness, M. B.","Anderson, A. J.","Downie, L. E."],2022,
    "Interventions for the management of computer vision syndrome: A systematic review and meta-analysis","Ophthalmology","129","10","1192–1215","10.1016/j.ophtha.2022.05.009","art"),
 16:(["Mataftsi, A.","Seliniotaki, A. K.","Moutzouri, S.","Prousali, E.","Darusman, K. R.","Adio, A. O.","Haidich, A. B.","Nischal, K. K."],2023,
    "Digital eye strain in young screen users: A systematic review","Preventive Medicine","170",None,"107493","10.1016/j.ypmed.2023.107493","art"),
 17:(["Portello, J. K.","Rosenfield, M.","Chu, C. A."],2013,
    "Blink rate, incomplete blinks and computer vision syndrome","Optometry and Vision Science","90","5","482–487","10.1097/OPX.0b013e31828f09a7","art"),
 18:(["Argilés, M.","Cardona, G.","Pérez-Cabré, E.","Rodríguez, M."],2015,
    "Blink rate and incomplete blinks in six different controlled hard-copy and electronic reading conditions","Investigative Ophthalmology & Visual Science","56","11","6679–6685","10.1167/iovs.15-16967","art"),
 19:(["Hirota, M.","Uozato, H.","Kawamorita, T.","Shibata, Y.","Yamamoto, S."],2013,
    "Effect of incomplete blinking on tear film stability","Optometry and Vision Science","90","7","650–657","10.1097/OPX.0b013e31829962ec","art"),
 20:(["World Wide Web Consortium"],2023,
    "Web content accessibility guidelines (WCAG) 2.2",None,None,None,None,None,"web:https://www.w3.org/TR/WCAG22/"),
 21:(["Advanced Perceptual Contrast Algorithm"],None,
    "APCA: A candidate perceptual contrast method incorporating polarity and typographic parameters",None,None,None,None,None,"web:https://git.apcacontrast.com/"),
 22:(["Warm, J. S.","Parasuraman, R.","Matthews, G."],2008,
    "Vigilance requires hard mental work and is stressful","Human Factors","50","3","433–441","10.1518/001872008X312152","art"),
 23:(["Abe, T.","Mollicone, D.","Basner, M.","Dinges, D. F."],2014,
    "Sleepiness and safety: Where biology needs technology","Sleep and Biological Rhythms","12","2","74–84","10.1111/sbr.12067","art"),
 24:(["Dobres, J.","Chahine, N.","Reimer, B.","Gould, D.","Mehler, B.","Coughlin, J. F."],2016,
    "Utilising psychophysical techniques to investigate the effects of age, typeface design, size and display polarity on glance legibility","Ergonomics","59","10","1377–1391","10.1080/00140139.2015.1137637","art"),
 25:(["Sethi, T.","Ziat, M."],2023,
    "Dark mode vogue: Do light-on-dark displays have measurable benefits to users?","Ergonomics","66","12","1814–1828","10.1080/00140139.2022.2160879","art"),
 26:(["Cardona, G.","García, C.","Serés, C.","Vilaseca, M.","Gispets, J."],2011,
    "Blink rate, blink amplitude, and tear film integrity during dynamic visual display terminal tasks","Current Eye Research","36","3","190–197","10.3109/02713683.2010.544442","art"),
 27:(["Abe, T."],2023,
    "PERCLOS-based technologies for detecting drowsiness: Current evidence and future directions","SLEEP Advances","4","1","zpad006","10.1093/sleepadvances/zpad006","art"),
 28:(["Jackson, M. L.","Raj, S.","Croft, R. J.","Hayley, A. C.","Downey, L. A.","Kennedy, G. A.","Howard, M. E."],2016,
    "Slow eyelid closure as a measure of driver drowsiness and its relationship to performance","Traffic Injury Prevention","17","3","251–257","10.1080/15389588.2015.1055327","art"),
 29:(["Delgado, P.","Vargas, C.","Ackerman, R.","Salmerón, L."],2018,
    "Don't throw away your printed books: A meta-analysis on the effects of reading media on reading comprehension","Educational Research Review","25",None,"23–38","10.1016/j.edurev.2018.09.003","art"),
 30:(["Seguí, M. del M.","Cabrero-García, J.","Crespo, A.","Verdú, J.","Ronda, E."],2015,
    "A reliable and valid questionnaire was developed to measure computer vision syndrome at the workplace","Journal of Clinical Epidemiology","68","6","662–673","10.1016/j.jclinepi.2015.01.015","art"),
 31:(["Cantó-Sancho, N.","Linhares, J.","Ronda-Pérez, E.","Franco, S.","Perales, E.","Seguí-Crespo, M."],2024,
    "Cross-cultural validation into Portuguese of a questionnaire to assess computer vision syndrome in workers exposed to digital devices","Arquivos Brasileiros de Oftalmologia","87","6","e20220256","10.5935/0004-2749.2022-0256","art"),
 32:(["Hart, S. G.","Staveland, L. E."],1988,
    "Development of NASA-TLX (Task Load Index): Results of empirical and theoretical research",None,None,None,None,None,
    "chap:In P. A. Hancock & N. Meshkati (Eds.), |Human mental workload| (Advances in Psychology, Vol. 52, pp. 139–183). North-Holland."),
 33:(["Soukupová, T.","Čech, J."],2016,
    "Real-time eye blink detection using facial landmarks",None,None,None,None,None,
    "conf:In |Proceedings of the 21st Computer Vision Winter Workshop| (pp. 1–8). Rimske Toplice, Slovenia."),
 34:(["Klinke, T.","Hannak, W.","Böning, K.","Jakstat, H."],2024,
    "A comparative study of the sensitivity and specificity of the Ishihara test with various displays","International Dental Journal","74","4","892–896","10.1016/j.identj.2023.12.009","art"),
 35:(["Bureau of Indian Standards"],2009,
    "IS 3646: Code of practice for interior illumination",None,None,None,None,None,"rep:Bureau of Indian Standards."),
 36:(["Xie, X.","Song, F.","Liu, Y.","Wang, S.","Yu, D."],2021,
    "Study on the effects of display color mode and luminance contrast on visual fatigue","IEEE Access","9",None,"35915–35923","10.1109/ACCESS.2021.3061770","art"),
 37:(["Tian, P.","Xu, G.","Han, C.","Zheng, X.","Zhang, K.","Du, C.","Wei, F.","Zhang, S."],2022,
    "Effects of paradigm color and screen brightness on visual fatigue in light environment of night based on eye tracker and EEG acquisition equipment","Sensors","22","11","4082","10.3390/s22114082","art"),
 38:(["[Author list to be completed from the publisher record]"],2025,
    "Effects of ambient illuminance and mobile phone screen brightness on tear film stability, visual fatigue, and blink patterns during reading","Contact Lens and Anterior Eye",None,None,None,"10.1016/j.clae.2025.102515","art"),
}

def surname(a): return a.split(",")[0].strip()

def intext(num, narrative=False):
    au, yr = REFS[num][0], REFS[num][1]
    y = str(yr) if yr else "n.d."
    if len(au) == 1: nm = surname(au[0])
    elif len(au) == 2:
        nm = f"{surname(au[0])} and {surname(au[1])}" if narrative else f"{surname(au[0])} & {surname(au[1])}"
    else: nm = f"{surname(au[0])} et al."
    return f"{nm} ({y})" if narrative else f"{nm}, {y}"

def entry(num):
    au, yr, title, cont, vol, iss, pages, doi, kind = REFS[num]
    if len(au) == 1: astr = au[0]
    elif len(au) == 2: astr = f"{au[0]}, & {au[1]}"
    else: astr = ", ".join(au[:-1]) + f", & {au[-1]}"
    y = str(yr) if yr else "n.d."
    out = f"{astr} ({y}). {title}."
    if kind == "art":
        out += f" *{cont}*"
        if vol: out += f", *{vol}*"
        if iss: out += f"({iss})"
        if pages: out += f", {pages}"
        out += "."
        if doi: out += f" https://doi.org/{doi}"
    elif kind.startswith(("chap:", "conf:", "rep:")):
        out += " " + kind.split(":", 1)[1].replace("|", "*")
    elif kind.startswith("web:"):
        out += " " + kind.split(":", 1)[1]
    return out

md = open('SYNOPSIS_AdtU.md').read()

# ---- 1. in-text citations ----
def repl(m):
    nums = [int(x) for x in m.group(1).replace(" ", "").split(",")]
    parts = sorted((intext(n) for n in nums), key=lambda s: s.lower())
    return "(" + "; ".join(parts) + ")"
body, refsec = md.split("# REFERENCES", 1)
body = re.sub(r"\[(\d+(?:\s*,\s*\d+)*)\]", repl, body)

# ---- 2. narrative forms where the author is already named ----
NARR = [
 ("Buchner and Baumgartner demonstrated", 9), ("Buchner and Baumgartner found", 9),
 ("Portello and colleagues found", 17), ("Hirota and colleagues traced", 19),
 ("Jiménez and colleagues", 7), ("Fan and colleagues", 12),
 ("Xie and colleagues add", 36), ("Sethi and Ziat's finding", 25),
 ("Lin and colleagues", 14),
]
for phrase, num in NARR:
    # drop a parenthetical citation that immediately follows the named author in the same sentence
    body = re.sub(re.escape(phrase) + r"([^.]*?)\s*\(" + re.escape(intext(num)) + r"\)",
                  lambda m, p=phrase, n=num: f"{p.replace(' demonstrated','').replace(' found','').replace(chr(39)+'s finding','')} ({REFS[n][1]})"
                                              + (" demonstrated" if "demonstrated" in p else " found" if "found" in p else "'s finding" if "finding" in p else "")
                                              + m.group(1), body)

# ---- 3. alphabetical reference list ----
def sortkey(n):
    au = REFS[n][0]
    return (surname(au[0]).lower(), str(REFS[n][1] or "9999"))
lines = ["# REFERENCES", ""]
for n in sorted(REFS, key=sortkey):
    lines.append(entry(n))
    lines.append("")
tail = refsec.split("---", 1)
new_refs = "\n".join(lines).rstrip() + "\n\n---" + (tail[1] if len(tail) > 1 else "")
open('SYNOPSIS_AdtU.md','w').write(body + new_refs)

print(f"in-text citations converted; reference list rebuilt with {len(REFS)} APA entries (alphabetical)")
print("\nfirst three entries:")
for n in sorted(REFS, key=sortkey)[:3]: print("  " + entry(n)[:130] + "...")
