/**
 * The page specification the university sets, in one place.
 *
 *   AdtU Annexure AdtU/PhD/A(i)
 *   Left margin 3.0 cm | Right margin 2.0 cm | Top 2.54 cm | Bottom 2.54 cm
 *   Times New Roman, line spacing 1.5, printed single side.
 *
 * This existed only as a comment in build_synopsis.cjs, the builder that used to produce the
 * synopsis. When the document moved to build_docx.cjs the numbers were restated from scratch — one
 * inch on all four sides and 1.42 line spacing — and nothing compared the two. The document that
 * has been going out for review therefore has a binding margin 0.46 cm narrower than the Annexure
 * requires and leading below 1.5, which is the kind of thing a submission is returned for without
 * anyone reading a word of it.
 *
 * pagecount.py models the same geometry and must be kept in step; its header points here.
 *
 * PROVENANCE. These figures are recorded in this repository as the Annexure's requirement. The
 * Annexure itself is not in the repository and could not be read from this environment, so they are
 * reproduced on the authority of the project's own earlier record, not verified at source. If the
 * Annexure says something different, this file is the only place that has to change.
 */
const CM = 567;                       // twips per centimetre (1 cm = 567 twips)

const SPEC = {
  page: { width: 11906, height: 16838 },          // A4, portrait, twips
  margin: {
    left: Math.round(3.0 * CM),                   // 1701
    right: Math.round(2.0 * CM),                  // 1134
    top: 1440,                                    // 2.54 cm
    bottom: 1440,                                 // 2.54 cm
  },
  font: 'Times New Roman',
  size: 24,                                       // half-points => 12 pt
  line: 360,                                      // 1.5 line spacing (240 = single)
  lineSingle: 240,                                // reference list is set single, with a hanging indent
  refHanging: 720,                                // 0.5 inch, as APA 7 specifies
};

SPEC.contentWidth = SPEC.page.width - SPEC.margin.left - SPEC.margin.right;   // 9071

module.exports = SPEC;
