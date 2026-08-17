/**
 * Reading passages, comprehension questions, and visual-search targets.
 * Passage text + questions extracted verbatim from the original compiled bundle.
 *
 * Passages are assigned to conditions via a rotating Latin square (counterbalance.ts),
 * NOT yoked to a fixed condition, so passage difficulty is orthogonal to display condition.
 *
 * NOTE: the original bundle stored a `target_count` that did NOT match the actual number of
 * occurrences in the passage (e.g. "forest" stored 7 but occurs 2x; "carbon" stored 8 but
 * occurs 12x) — making accuracy_rate = found/target_count miscalibrated. We instead use the
 * ACTUAL occurrence count (computed with the task tokenisation rule: strip non-letters,
 * lowercase, exact match) as the authoritative `searchTargetCount`. (The discredited original
 * values are recorded here in source for provenance; they are not carried as data.)
 */
export interface ComprehensionQuestion {
  text: string;
  options: string[];
  correctIndex: number;
}

/** Passage as authored — counts are NOT declared here; they are derived from the text below. */
interface PassageDef {
  id: number;
  title: string;
  pages: string[];
  question: ComprehensionQuestion;
  searchTarget: string;
}

export interface Passage extends PassageDef {
  /** Words in the passage, derived from the text. Drives reading_speed_wpm and skim detection. */
  wordCount: number;
  /** Target occurrences, derived from the text with the search task's own tokenisation rule. */
  searchTargetCount: number;
}

const PASSAGE_DEFS: PassageDef[] = [
  {
    id: 0,
    title: "The Carbon Cycle",
    pages: [
      `Carbon is one of the most fundamental elements in nature, cycling continuously between living organisms, the atmosphere, oceans, and rocks. This process, known as the carbon cycle, regulates Earth's climate and supports all life on the planet.

In the atmosphere, carbon exists primarily as carbon dioxide. Plants absorb this gas during photosynthesis, converting it into organic compounds that form their leaves, stems, and roots. Animals then consume plants, incorporating that carbon into their own tissues. When organisms die, decomposers break down organic matter and release carbon dioxide back into the atmosphere.`,
      `Oceans play a critical role in the carbon cycle. Seawater absorbs large quantities of atmospheric carbon dioxide, where it dissolves and reacts with water to form carbonic acid. Marine organisms use dissolved carbon to build shells and skeletons. When these creatures die, their remains sink to the ocean floor, gradually forming limestone and chalk deposits over millions of years.

Human activities have significantly altered the carbon cycle. Burning fossil fuels releases carbon that was stored underground for millions of years, adding it to the atmosphere far faster than natural processes can absorb it. Deforestation reduces the number of trees available to absorb carbon dioxide, compounding the imbalance. Scientists continue to study these disruptions to develop strategies for restoring equilibrium.`,
    ],
    question: {
      text: "According to the passage, what happens to carbon when organisms die?",
      options: ["It is absorbed by oceans", "It sinks to the ocean floor", "Decomposers release it back as CO\u2082", "It forms fossil fuels immediately"],
      correctIndex: 2,
    },
    searchTarget: "carbon",
  },
  {
    id: 1,
    title: "Ocean Currents",
    pages: [
      `Ocean currents are continuous, directed movements of water flowing through the world's seas. These currents are driven by a combination of wind, differences in water density, Earth's rotation, and the shape of ocean basins. Together they form a global circulation system that distributes heat, nutrients, and dissolved gases around the planet.

Surface currents are primarily driven by wind patterns. The trade winds near the equator push warm tropical water westward, while westerly winds at higher latitudes drive water in the opposite direction. These movements create large rotating systems called gyres, which dominate the major ocean basins.`,
      `Deep ocean currents operate through a different mechanism known as thermohaline circulation. When surface water in polar regions becomes cold and dense, it sinks and spreads slowly along the ocean floor. This cold, deep water gradually warms as it travels toward the equator, eventually rising back to the surface in a process called upwelling. This vertical movement brings nutrients from the deep ocean to the surface, supporting productive marine ecosystems.

Ocean currents have a profound influence on climate. The Gulf Stream carries warm water from the Gulf of Mexico northward along the eastern coast of North America and across to western Europe, moderating temperatures significantly. Without this current, northwestern Europe would experience far colder winters. Disruption of these circulation patterns due to climate change could have serious consequences for regional climates worldwide.`,
    ],
    question: {
      text: "What is the term for the rising of deep, cold ocean water toward the surface?",
      options: ["Thermohaline circulation", "Upwelling", "Convection", "Gyration"],
      correctIndex: 1,
    },
    searchTarget: "ocean",
  },
  {
    id: 2,
    title: "The Human Immune System",
    pages: [
      `The immune system is the body's defence network, protecting against bacteria, viruses, fungi, and other harmful substances. It operates through a complex series of biological processes involving specialised cells, tissues, and organs working in coordination to identify and eliminate threats.

The first line of defence consists of physical and chemical barriers. Skin forms a protective outer layer that prevents most pathogens from entering the body. Mucous membranes lining the respiratory and digestive tracts trap particles and contain antimicrobial substances. Stomach acid destroys many bacteria that enter through food or drink.`,
      `When pathogens breach these initial barriers, the innate immune system responds rapidly. White blood cells called neutrophils and macrophages engulf and destroy foreign invaders through a process called phagocytosis. Inflammation is triggered at the site of infection, increasing blood flow and attracting more immune cells to the area.

The adaptive immune system provides a more precise and targeted defence. Specialised cells called lymphocytes recognise specific molecules on the surface of pathogens, known as antigens. B lymphocytes produce proteins called antibodies that bind to these antigens, neutralising the pathogen or marking it for destruction. T lymphocytes coordinate the immune response and directly kill infected cells. Crucially, the adaptive immune system retains a memory of previous infections, allowing faster and more effective responses upon re-exposure. This principle underlies vaccination, where a harmless form of a pathogen is introduced to generate protective immunity without causing disease.`,
    ],
    question: {
      text: "What do B lymphocytes produce to defend against pathogens?",
      options: ["Antibodies", "Phagocytes", "Antigens", "Neutrophils"],
      correctIndex: 0,
    },
    searchTarget: "immune",
  },
  {
    id: 3,
    title: "Volcanic Eruptions",
    pages: [
      `Volcanoes are openings in Earth's crust through which molten rock, gases, and ash can escape from the interior of the planet. They occur along tectonic plate boundaries and above areas known as hotspots, where plumes of hot mantle material rise toward the surface. Volcanic eruptions range from gentle lava flows to catastrophic explosions with global consequences.

The behaviour of a volcano depends largely on the composition of its magma. Magma with low silica content is relatively fluid and allows gases to escape easily, resulting in effusive eruptions where lava flows steadily across the landscape. Hawaiian volcanoes typically behave this way, producing rivers of lava that cool slowly as they spread.`,
      `High-silica magma is far more viscous, trapping gases under pressure. When this pressure becomes sufficient, the result is an explosive eruption that can launch ash and rock fragments high into the atmosphere. The 1980 eruption of Mount St Helens in the United States and the 1883 eruption of Krakatoa in Indonesia are examples of such violent events. Large explosive eruptions can inject enough material into the upper atmosphere to temporarily lower global temperatures.

Despite their destructive power, volcanoes have played a vital role in shaping Earth. They release gases that contributed to the formation of the early atmosphere and oceans. Volcanic soils are exceptionally fertile, supporting productive agriculture. Geothermal energy from volcanic regions provides renewable electricity in countries such as Iceland and New Zealand. Scientists monitor active volcanoes continuously to improve understanding and provide advance warning of eruptions.`,
    ],
    question: {
      text: "What property of magma primarily determines whether a volcanic eruption is explosive?",
      options: ["Temperature", "Volume", "Depth below surface", "Silica content"],
      correctIndex: 3,
    },
    searchTarget: "eruption",
  },
  {
    id: 4,
    title: "The Science of Sleep",
    pages: [
      `Sleep is a fundamental biological process that is essential for physical health, cognitive function, and emotional regulation. During sleep, the brain and body perform critical maintenance tasks that cannot occur during waking hours. Despite spending approximately one third of our lives asleep, the precise functions of sleep are still being investigated by scientists.

Sleep is not a uniform state but consists of distinct cycles that repeat throughout the night. Each cycle lasts approximately ninety minutes and includes stages of non-rapid eye movement sleep and rapid eye movement sleep. During the deeper stages of non-rapid eye movement sleep, the body repairs tissues, synthesises proteins, and releases growth hormones.`,
      `Rapid eye movement sleep is associated with vivid dreaming and plays a central role in memory consolidation and emotional processing. During this stage, the brain replays and reorganises experiences from the preceding day, transferring information from short-term to long-term memory. Research has shown that people who sleep well after learning a new skill perform significantly better than those who are sleep deprived.

Chronic sleep deprivation has serious health consequences. It impairs concentration, reaction time, and decision-making, and has been linked to increased risk of cardiovascular disease, diabetes, and obesity. The brain's glymphatic system, which clears metabolic waste products, functions primarily during sleep. Disruption of this cleaning process has been associated with the accumulation of proteins linked to Alzheimer's disease. Public health authorities increasingly recognise adequate sleep as essential to overall wellbeing, alongside diet and physical activity.`,
    ],
    question: {
      text: "What system in the brain clears metabolic waste products, primarily during sleep?",
      options: ["The limbic system", "The glymphatic system", "The reticular system", "The prefrontal cortex"],
      correctIndex: 1,
    },
    searchTarget: "sleep",
  },
  {
    id: 5,
    title: "Rainforest Ecosystems",
    pages: [
      `Tropical rainforests are among the most biologically diverse ecosystems on Earth, covering approximately six percent of the planet's land surface yet harbouring more than half of all known plant and animal species. These dense forests are found near the equator, where warm temperatures and high rainfall create ideal conditions for extraordinary biodiversity.

The structure of a rainforest is organised into distinct vertical layers. The emergent layer consists of the tallest trees, reaching heights of fifty metres or more, their canopies exposed to full sunlight and wind. Below lies the main canopy, a dense continuous layer of treetops where most photosynthesis occurs and where the majority of animal species live.`,
      `The understorey is a shaded zone beneath the canopy where smaller trees and shrubs are adapted to low light conditions. At ground level, the forest floor receives very little sunlight and is dominated by fungi, insects, and decomposers that rapidly break down fallen leaves and dead organisms. This decomposition releases nutrients that are quickly absorbed by the shallow root systems of rainforest trees.

Rainforests play an indispensable role in regulating Earth's climate. They absorb vast quantities of carbon dioxide and release oxygen, acting as critical carbon sinks. The transpiration of water vapour from tree leaves contributes to regional rainfall patterns, sustaining agriculture across wide areas. Despite their importance, tropical rainforests are being lost at an alarming rate due to deforestation for agriculture, logging, and infrastructure. Conservation efforts focus on protecting remaining forest and restoring degraded land.`,
    ],
    question: {
      text: "Approximately what percentage of all known plant and animal species are found in tropical rainforests?",
      options: ["Six percent", "Twenty-five percent", "More than fifty percent", "Thirty percent"],
      correctIndex: 2,
    },
    searchTarget: "forest",
  },
  {
    id: 6,
    title: "Plate Tectonics",
    pages: [
      `Plate tectonics is the scientific theory that describes the movement of large sections of Earth's outer shell, called tectonic plates, and explains many geological features including mountains, earthquakes, and volcanoes. The theory revolutionised Earth science when it was established in the 1960s, providing a unifying framework that connected previously separate observations.

Earth's outermost layer, the lithosphere, is divided into approximately fifteen major plates and several smaller ones. These plates float on the partially molten rock of the asthenosphere and move at rates of a few centimetres per year, driven by convection currents in the mantle below.`,
      `Plates interact at their boundaries in three primary ways. At convergent boundaries, plates move toward each other. When an oceanic plate meets a continental plate, the denser oceanic plate is forced beneath the continental plate in a process called subduction, creating deep ocean trenches and volcanic mountain chains. When two continental plates collide, neither subducts, and the collision produces vast mountain ranges such as the Himalayas.

At divergent boundaries, plates move apart and new oceanic crust is created as magma rises from below to fill the gap. The Mid-Atlantic Ridge is a prominent example of this process, where the North American and Eurasian plates are separating at roughly two centimetres per year. At transform boundaries, plates slide horizontally past each other, generating earthquakes along major fault lines such as the San Andreas Fault in California. The slow but relentless movement of tectonic plates has shaped the continents and oceans over hundreds of millions of years.`,
    ],
    question: {
      text: "What occurs at a divergent plate boundary?",
      options: ["New oceanic crust is created as plates move apart", "One plate subducts beneath another", "Plates slide horizontally past each other", "Mountain ranges are formed"],
      correctIndex: 0,
    },
    searchTarget: "plate",
  },
  {
    id: 7,
    title: "Light and the Electromagnetic Spectrum",
    pages: [
      `Light is a form of electromagnetic radiation, a type of energy that travels as waves through space. What we perceive as visible light is only a small portion of a much broader electromagnetic spectrum that includes radio waves, microwaves, infrared radiation, ultraviolet light, X-rays, and gamma rays. These different forms of radiation share the same fundamental nature but differ in wavelength and frequency.

The electromagnetic spectrum is arranged by wavelength, which is the distance between successive wave peaks. Radio waves have the longest wavelengths, stretching from millimetres to hundreds of kilometres. Gamma rays have the shortest wavelengths, smaller than the diameter of an atomic nucleus.`,
      `Visible light occupies a narrow band of wavelengths between approximately 380 and 700 nanometres. Within this range, different wavelengths correspond to different colours. Violet light has the shortest wavelength and highest frequency, while red light has the longest wavelength and lowest frequency. White light contains all visible wavelengths, which is why passing it through a prism produces a rainbow of colours.

The speed of light in a vacuum is approximately 300,000 kilometres per second, one of the most important constants in physics. When light passes through different materials, it slows down and can bend, a phenomenon called refraction. This bending of light by the atmosphere causes mirages in hot conditions and makes stars appear to twinkle near the horizon. The study of light and optics has led to transformative technologies including photography, fibre optic communications, lasers, and medical imaging devices.`,
    ],
    question: {
      text: "Which type of light has the shortest wavelength within the visible spectrum?",
      options: ["Red", "Green", "Yellow", "Violet"],
      correctIndex: 3,
    },
    searchTarget: "light",
  },
  {
    id: 8,
    title: "Sound and Hearing",
    pages: [
      `Sound is a mechanical wave, a travelling disturbance in the pressure of a material medium. Unlike light, sound cannot cross a vacuum, because it depends on particles displacing one another. When an object vibrates, it compresses and then rarefies the adjacent air. That alternation passes outward as a chain of pressure fluctuations that eventually reaches the ear.

Two independent properties characterise any sound. Frequency, measured in hertz, is the number of pressure cycles arriving each second, and the auditory system interprets it as pitch. Amplitude is the magnitude of the fluctuation, which the auditory system interprets as loudness. Because the range of audible amplitudes is enormous, loudness is expressed on the logarithmic decibel scale rather than in absolute units.`,
      `The external ear collects sound and channels it along the canal to the tympanic membrane. That membrane vibrates in synchrony with the arriving pressure fluctuations. Three articulated bones in the middle ear amplify the motion and transmit it to the cochlea, a fluid-filled spiral within the inner ear. A membrane runs the length of the cochlea, and its stiffness varies from one end to the other, so different regions resonate at different frequencies.

Specialised hair cells positioned on that membrane convert mechanical displacement into neural impulses. Higher frequencies excite cells near the entrance of the spiral, whereas lower frequencies excite cells situated deeper within it. The cochlea therefore accomplishes a frequency analysis before the signal reaches the brain. Because mammalian hair cells do not regenerate once destroyed, hearing loss caused by noise exposure is irreversible.`,
    ],
    question: {
      text: "According to the passage, why is noise-induced hearing loss irreversible?",
      options: ["The tympanic membrane cannot heal", "Mammalian hair cells do not regenerate once destroyed", "The cochlea permanently loses its fluid", "The middle-ear bones fuse together"],
      correctIndex: 1,
    },
    searchTarget: "sound",
  },
  {
    id: 9,
    title: "Bird Migration",
    pages: [
      `Each year billions of birds undertake migration, a regular seasonal movement between a breeding range and a wintering range. The pattern is driven less by temperature than by the seasonal supply of food. Insect-eating birds cannot survive a northern winter, yet the northern summer offers long daylight and abundant prey. The breeding advantage of the round trip therefore outweighs its considerable energetic cost.

Departure is timed internally rather than by immediate weather. Birds kept under constant laboratory lighting still become restless in the period when they would normally leave, which shows that an internal annual rhythm sets the schedule. Changing day length is the environmental cue that keeps that rhythm aligned with the calendar.`,
      `Navigation depends on several partly independent mechanisms working together. Many species orient by the position of the sun, correcting for its apparent movement across the sky by reference to an internal clock. Night migrants instead orient by the pattern of stars around the celestial pole, which they appear to learn during their first summer. A magnetic sense supplies a further reference that remains available beneath complete cloud cover.

Experienced birds do considerably more than hold a constant compass heading. Adults displaced to unfamiliar territory can compute a corrected course and still reach the intended destination. Juveniles on a first migration typically continue along their original bearing and arrive somewhere entirely different. This difference suggests that determining position, as distinct from holding direction, is learned through experience rather than inherited.`,
    ],
    question: {
      text: "According to the passage, how do displaced juvenile birds differ from adults?",
      options: ["They migrate at lower altitudes", "They rely only on the magnetic sense", "They continue along their original bearing instead of computing a corrected course", "They postpone departure until conditions improve"],
      correctIndex: 2,
    },
    searchTarget: "birds",
  },
];

/** Words in a passage: whitespace-delimited tokens containing at least one letter. */
export function countWords(pages: string[]): number {
  return pages.join('\n\n').split(/\s+/).filter((t) => /[a-zA-Z]/.test(t)).length;
}

/**
 * Occurrences of the search target, using the EXACT tokenisation VisualSearchTask applies when it
 * decides whether a tapped word is a hit: strip non-letters, lowercase, compare for equality.
 * Deriving it here means accuracy_rate = found / searchTargetCount can never be miscalibrated by
 * a stale hand-written number, which is precisely how the original bundle got it wrong.
 */
export function countTargetOccurrences(pages: string[], target: string): number {
  const t = target.toLowerCase();
  return pages
    .join('\n\n')
    .split(/\s+/)
    .filter((w) => w.replace(/[^a-zA-Z]/g, '').toLowerCase() === t).length;
}

export const PASSAGES: Passage[] = PASSAGE_DEFS.map((p) => ({
  ...p,
  wordCount: countWords(p.pages),
  searchTargetCount: countTargetOccurrences(p.pages, p.searchTarget),
}));

export const N_PASSAGES = PASSAGES.length;
