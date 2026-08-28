/**
 * Reading passages, comprehension items, and visual-search targets.
 *
 * Passages are assigned to conditions via a rotating Latin square (counterbalance.ts),
 * NOT yoked to a fixed condition, so passage difficulty is orthogonal to display condition.
 *
 * LENGTH IS LOAD-BEARING. The reading task is the exposure window for the primary outcome, and
 * the incomplete-blink ratio is a binomial proportion whose precision is fixed by how many blinks
 * that window captures. The original corpus ran ~240 words, which the timing simulation measured
 * at a 73 s exposure: about 16 blinks, a standard error near 0.09, and only 27% power on the
 * polarity x colour interaction that is the design's binding contrast. Each passage is therefore
 * four pages and about 600 words, which buys roughly 180 s of reading, some 39 blinks, and
 * halves that error. Run `npm run verify:corpus` after any edit here.
 *
 * DERIVED COUNTS. Neither the word count nor the search-target count is declared. The original
 * bundle declared both and both were wrong: word counts overstated the real text by 11-32%,
 * silently inflating reading_speed_wpm, and target counts disagreed with the actual occurrences
 * (e.g. "forest" stored as 7 where the text contained 2), which miscalibrated the visual-search
 * accuracy denominator. Both are computed from the text below, so they cannot drift.
 *
 * TARGET DENSITY. The visual-search task runs to a fixed time limit, so accuracy is comparable
 * across passages only if every passage carries a similar number of targets. The set is held to
 * a narrow band; the tokenisation is exact-match after stripping non-letters, so "forests" and
 * "rainforest" are NOT occurrences of "forest".
 */
export type QuestionKind = 'gist' | 'inference' | 'detail';

export interface ComprehensionQuestion {
  /**
   * What the item is designed to probe. The synopsis specifies items assessing gist, inference
   * and detail; carrying the kind as data lets the analysis report accuracy by item type rather
   * than collapsing three quite different demands into one proportion.
   */
  kind: QuestionKind;
  text: string;
  options: string[];
  correctIndex: number;
}

/** Passage as authored — counts are NOT declared here; they are derived from the text below. */
interface PassageDef {
  id: number;
  title: string;
  pages: string[];
  questions: ComprehensionQuestion[];
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
      `A second exchange operates on a geological timescale, and it is the slower of the two that ultimately governs atmospheric composition over long intervals. Rainwater, made faintly acidic by the gas it has dissolved, chemically weathers silicate rock across the continents, and the products of that reaction are carried by rivers to the sea. There the dissolved material is precipitated as calcium carbonate, either inorganically or through the shell-building activity of marine organisms, and accumulates as sediment on the ocean floor.

Where that sediment eventually reaches a subduction zone it is drawn down into the mantle, and a portion of what it contains is returned to the atmosphere through volcanic outgassing. The complete circuit takes on the order of hundreds of millions of years. This is precisely why the geological pathway cannot buffer a disturbance that has been delivered over the course of a single century, and why the distinction between the rapid biological exchange and the slow mineral one is essential to interpreting the present imbalance correctly.`,
      `Quantifying that imbalance requires establishing where the additional material actually goes. Roughly half of what fossil-fuel combustion and land clearance release remains in the atmosphere, and the remainder is taken up in approximately equal measure by the oceans and by terrestrial vegetation and soils. Neither of those sinks is guaranteed to persist indefinitely. Oceanic uptake acidifies surface water, which reduces the capacity of the sea to absorb further quantities of the gas while simultaneously impairing the organisms that construct calcium carbonate structures.

Terrestrial uptake depends on the continued health of forests, which drought, fire and clearance can convert from a sink into a source within a few decades. Isotopic analysis allows the origin of the atmospheric increase to be identified, because material derived from ancient plant remains carries a distinctive signature that separates it from anything released by volcanic or oceanic processes. That evidence is what permits the recent rise to be attributed rather than merely inferred by association. The policy relevance of that attribution is direct. Were the increase natural in origin, mitigation would be pointless; because it is not, the quantity of fossil fuel burned translates into a predictable rise in atmospheric concentration, and the arithmetic of stabilisation follows from it. Estimates of how much may still be released before a given temperature threshold is crossed rest on exactly this accounting.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "Which statement best captures the passage as a whole?",
        options: [
          "Volcanic outgassing is the principal control on atmospheric composition, and biological exchange plays only a minor part in it",
          "Carbon moves through a fast biological exchange and a slow geological one, and human activity has disturbed the balance between them",
          "The oceans have absorbed all of the carbon released by human activity, which is why the atmospheric concentration has held steady",
          "Photosynthesis and decomposition cancel one another exactly, so an undisturbed system holds its atmospheric composition fixed",
        ],
        correctIndex: 1,
      },
      {
        kind: 'inference',
        text: "The passage implies that the geological pathway cannot correct the present imbalance because",
        options: [
          "subduction zones no longer operate, so the sediment that carries carbon is never drawn back down into the mantle",
          "the silicate rock available for weathering has been almost entirely consumed over the past few centuries",
          "marine organisms have stopped precipitating calcium carbonate, so the sediment that buries carbon no longer forms",
          "it operates over hundreds of millions of years while the disturbance was delivered within about a century",
        ],
        correctIndex: 3,
      },
      {
        kind: 'detail',
        text: "According to the passage, what happens to the carbon in land organisms when they die?",
        options: [
          "It is absorbed directly by the oceans",
          "It sinks and forms limestone deposits",
          "Decomposers release it back as CO₂",
          "It becomes fossil fuel within decades",
        ],
        correctIndex: 2,
      },
    ],
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
      `The rotation of the planet imposes a systematic deflection on any moving mass of water, turning it clockwise in the northern hemisphere and anticlockwise in the southern. Because that deflection acts on each successive layer of the ocean slightly later than on the one above it, the direction of flow rotates progressively with increasing depth, and the net transport of the wind-driven layer ends up running at a substantial angle to the wind that produced it. Where this net transport carries surface water away from a coastline, deeper water rises to replace it.

The most productive fisheries in the world sit above precisely such zones, along the western margins of continents, because the water arriving from below is rich in the nitrate and phosphate that surface waters have long since exhausted. Comparatively small shifts in the prevailing winds can weaken or displace that supply, and the biological consequences propagate rapidly through the entire local food web.`,
      `Measuring the deep circulation of the ocean is considerably harder than measuring its surface. Satellites can map surface height and temperature continuously across the globe, but they cannot see beneath the first few metres. Autonomous profiling floats now address that limitation by drifting at depth for several days, ascending while recording temperature and salinity, transmitting the profile by satellite, and then sinking again to repeat the cycle. Several thousand such instruments maintain a permanent census of the upper two kilometres of the world ocean.

That record has established how much of the additional heat retained by the atmosphere is ultimately stored in seawater, a quantity that governs both thermal expansion and the pace of sea-level rise. It has also shown that the overturning circulation varies considerably from year to year, which makes any claim about a long-term trend dependent on a record long enough to distinguish the two. Such a record is now being assembled, and the instruments have been extended to greater depths and into the polar seas that were formerly inaccessible for much of the year. What emerges is a system that stores the great majority of the extra heat the climate system retains, and whose slow adjustment to a warmer atmosphere will continue long after the atmosphere itself has stabilised.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "The passage is mainly concerned with",
        options: [
          "how ocean currents are driven, what they redistribute, and how they are measured",
          "the history of transatlantic navigation and the routes that early sailors preferred",
          "the chemical composition of seawater and the way salinity varies with depth and latitude",
          "the effect of tides on coastal erosion and on the shaping of shorelines over long periods",
        ],
        correctIndex: 0,
      },
      {
        kind: 'inference',
        text: "It can be inferred from the passage that a sustained weakening of coastal winds would",
        options: [
          "raise the salinity of the deep ocean and slow the sinking of cold polar water",
          "reverse the direction of the Gulf Stream and cool the coasts of north-western Europe",
          "reduce the nutrient supply reaching surface waters and depress local fisheries",
          "eliminate the deflection that the rotation of the planet imposes on any moving water",
        ],
        correctIndex: 2,
      },
      {
        kind: 'detail',
        text: "What is the term for the rising of deep, cold ocean water toward the surface?",
        options: ["Thermohaline flow", "Upwelling", "Convection", "Downwelling"],
        correctIndex: 1,
      },
    ],
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
      `Telling a real threat from the body's own tissue is the hardest task the immune system has to solve, and most of that work is done early. Lymphocytes are made with receptors of random shape, so some are bound to match the body's own molecules. Those cells are tested against self material while they are still young, and any that bind strongly are killed or switched off before they are ever released into the blood.

The screening is not perfect. When it fails, self-reactive cells reach the blood and may attack healthy tissue, which is what happens in type 1 diabetes and in rheumatoid arthritis. A second layer of control works all the time in the rest of the body, where regulatory cells hold back responses that would otherwise run against harmless material such as food or gut bacteria. Tolerance is therefore something the body keeps up, not something it settles once and then forgets.`,
      `Several features of this design have direct effects in the clinic. Because protection rests on memory rather than on any fixed barrier, immunity fades at a rate that differs a great deal between diseases, which is why some vaccines last a lifetime while others must be repeated. Because the response is aimed at particular molecular shapes, a virus that changes those shapes quickly can slip past recognition, and that is why influenza vaccines are rebuilt each year.

The same precision is put to work in cancer treatment. Some drugs release the brakes that normally hold lymphocytes back, so that tumour cells are attacked as though they were foreign. The cost is easy to predict: with those brakes off, the rate of autoimmune side effects rises. That is the price of pushing an immune system already tuned to a compromise between watchfulness and restraint.

No single setting of that system is best. Tuned for maximum vigilance it would destroy healthy tissue, and tuned for safety it would let infections run. Most immune disorders are departures from the middle position in one direction or the other.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "Which of the following best states the central idea of the passage?",
        options: [
          "Vaccination is the only reliable protection against infectious disease, since no other mechanism confers immunity that lasts for long",
          "Inflammation is the single most important immune process, and every other defence described is secondary to it",
          "The innate response is more effective than the adaptive one, because it acts at once and needs no prior exposure",
          "Immune defence depends on layered mechanisms and on a maintained balance between attacking pathogens and tolerating the body's own tissue",
        ],
        correctIndex: 3,
      },
      {
        kind: 'inference',
        text: "The passage suggests that autoimmune side effects of cancer immunotherapy are",
        options: [
          "evidence that the therapy has failed and that the tumour is no longer being attacked at all",
          "a predictable consequence of removing restraints that normally limit lymphocyte activity",
          "caused by the tumour itself rather than by anything the treatment does to the patient",
          "unrelated to the mechanism by which the therapy works, and therefore impossible to anticipate",
        ],
        correctIndex: 1,
      },
      {
        kind: 'detail',
        text: "What do B lymphocytes produce to defend against pathogens?",
        options: ["Antibodies", "Phagocytes", "Antigens", "Neutrophils"],
        correctIndex: 0,
      },
    ],
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
      `The dissolved gas held within magma governs the violence of what follows, and its behaviour is closely analogous to that of a sealed carbonated drink. At depth the confining pressure keeps water and carbon dioxide in solution. As magma ascends, that pressure falls, the dissolved gas comes out of solution as bubbles, and the bubbles expand. Fluid magma allows them to escape continuously and the ascent remains comparatively gentle.

Viscous magma does not. The bubbles cannot separate from it, so they expand in place until the surrounding material fails as a brittle solid rather than flowing as a liquid, and the magma is torn apart into fragments propelled by its own expanding gas. The distinction between a lava flow and an explosive column is therefore not a difference in the amount of energy available but a difference in how readily the gas can leave.`,
      `Forecasting rests on detecting the arrival of new magma beneath a volcano rather than on predicting an eruption date. Rising magma fractures the rock it displaces, generating characteristic swarms of small earthquakes that migrate upward over days or weeks. It also inflates the edifice measurably, and satellite radar can now resolve ground deformation of a few centimetres across an entire mountain. The composition of emitted gas shifts as well, with sulphur dioxide typically increasing as fresh magma approaches the surface.

None of these signals specifies timing reliably, and unrest frequently subsides without an eruption. Warnings are consequently issued as changing levels of alert rather than as predictions, a framing that has proved far more defensible in practice than any attempt to name a date. The value of that approach is visible in the record. Communities near several well-monitored volcanoes have been evacuated in time on the strength of such warnings, and the false alarms that inevitably accompany them are accepted as the price of the successes. Where monitoring is absent, the first indication of an eruption is commonly the eruption itself.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "The passage is primarily about",
        options: [
          "the economic value of geothermal electricity in countries that sit above active volcanoes",
          "the historical record of the Krakatoa eruption and the effect it had on global temperature",
          "what governs how violently a volcano erupts, and how such events are monitored",
          "the chemical composition of the early atmosphere and the origin of the first oceans",
        ],
        correctIndex: 2,
      },
      {
        kind: 'inference',
        text: "The comparison with a sealed carbonated drink is used to make the point that",
        options: [
          "eruption violence depends on how easily dissolved gas can escape as pressure falls",
          "magma and carbonated liquids share the same chemical composition and so behave in the same way",
          "volcanoes erupt only when they are physically shaken, as a sealed drink is shaken before opening",
          "carbon dioxide is the only gas held in solution in magma while it remains at depth",
        ],
        correctIndex: 0,
      },
      {
        kind: 'detail',
        text: "What property of magma primarily determines whether a volcanic eruption is explosive?",
        options: ["Temperature", "Volume", "Depth below surface", "Silica content"],
        correctIndex: 3,
      },
    ],
    searchTarget: "magma",
  },
  {
    id: 4,
    title: "The Science of Sleep",
    pages: [
      `Sleep is a fundamental biological process that is essential for physical health, cognitive function, and emotional regulation. During sleep, the brain and body perform critical maintenance tasks that cannot occur during waking hours. Despite spending approximately one third of our lives asleep, the precise functions of sleep are still being investigated by scientists.

Sleep is not a uniform state but consists of distinct cycles that repeat throughout the night. Each cycle lasts approximately ninety minutes and includes stages of non-rapid eye movement sleep and rapid eye movement sleep. During the deeper stages of non-rapid eye movement sleep, the body repairs tissues, synthesises proteins, and releases growth hormones.`,
      `Rapid eye movement sleep is associated with vivid dreaming and plays a central role in memory consolidation and emotional processing. During this stage, the brain replays and reorganises experiences from the preceding day, transferring information from short-term to long-term memory. Research has shown that people who sleep well after learning a new skill perform significantly better than those who are sleep deprived.

Chronic sleep deprivation has serious health consequences. It impairs concentration, reaction time, and decision-making, and has been linked to increased risk of cardiovascular disease, diabetes, and obesity. The brain's glymphatic system, which clears metabolic waste products, functions primarily during sleep. Disruption of this cleaning process has been associated with the accumulation of proteins linked to Alzheimer's disease. Public health authorities increasingly recognise adequate sleep as essential to overall wellbeing, alongside diet and physical activity.`,
      `Two largely independent regulators determine when a person becomes drowsy. The first is a homeostatic pressure that accumulates throughout waking and dissipates once unconsciousness begins, which explains why a longer period awake produces a deeper and more consolidated recovery. The second is a circadian rhythm generated by a small cluster of hypothalamic neurons that maintains a cycle of close to twenty-four hours even in the complete absence of external cues.

Because the internal period is not exactly twenty-four hours, it must be corrected daily, and light striking the retina is the dominant signal that performs the correction. Light in the early morning advances the rhythm while light in the late evening delays it. The two regulators normally reinforce one another, and the misery of shift work and long-distance travel follows directly from forcing them out of alignment.`,
      `The practical consequences of that architecture are considerable. Adolescents undergo a physiological delay in circadian timing, so early school start times require them to wake near the trough of their internal cycle, and trials of later starts have reported measurable gains in attendance and attainment. Evening exposure to illuminated screens delays the rhythm further, which is one reason display use before bed is associated with a later sleep onset.

Self-assessment is unreliable in this domain. People restricted to a curtailed schedule for several consecutive nights continue to accumulate objective performance deficits while reporting that they have adjusted, a dissociation that makes subjective judgement a poor guide to fitness for any safety-critical task and explains why regulatory limits on duty hours are set by schedule rather than by how alert an individual feels. The same logic governs medicine. Junior doctors working extended shifts make more errors than those on limited rosters, and the effect persists even among individuals who insist they are unaffected. Regulation in several countries has followed the objective evidence rather than the reported experience, on the reasoning that a person whose judgement is impaired is poorly placed to judge their own impairment.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "Which statement best summarises the passage?",
        options: [
          "Dreaming is the principal function of sleep, and the remaining stages exist only to make dreaming possible",
          "Sleep is regulated by two independent systems and serves restorative functions whose disruption carries measurable costs",
          "Sleep requirements are identical across the lifespan, so one schedule suits an adolescent and an adult alike",
          "The glymphatic system is the only reason sleep is necessary, and its other functions are incidental to that",
        ],
        correctIndex: 1,
      },
      {
        kind: 'inference',
        text: "The passage implies that asking a sleep-deprived person whether they are fit to perform a safety-critical task is unreliable because",
        options: [
          "they are likely to exaggerate their impairment in order to be excused the task",
          "homeostatic pressure disappears entirely after several consecutive nights of restriction",
          "circadian rhythms stop operating once sleep has been curtailed for several nights running",
          "objective performance continues to decline while subjective reports suggest adaptation",
        ],
        correctIndex: 3,
      },
      {
        kind: 'detail',
        text: "What system in the brain clears metabolic waste products, primarily during sleep?",
        options: [
          "The limbic system",
          "The glymphatic system",
          "The reticular system",
          "The prefrontal cortex",
        ],
        correctIndex: 1,
      },
    ],
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
      `A persistent misconception holds that such luxuriant vegetation must stand on exceptionally rich ground. The opposite is generally true. Heavy rainfall leaches soluble minerals downward beyond the reach of roots, and the soil of a mature forest retains comparatively little of the nutrient stock. Almost the entire reserve is held instead within the living vegetation itself, and it is recycled with remarkable efficiency: material falling to the ground is decomposed within weeks by an abundant community of fungi and invertebrates, and dense mats of shallow roots, assisted by fungal partners, intercept the released nutrients before rain can wash them away.

The vulnerability this creates is severe. Clearing and burning a stand of forest transfers its nutrient capital to the ash, where a few seasons of cultivation exhaust it, after which the land supports neither crops nor a straightforward return of the original forest.`,
      `Diversity on this scale demands an explanation, and no single mechanism accounts for it. Specialised natural enemies appear to suppress any seedling growing near an adult of its own species, which prevents any one tree from dominating and leaves openings for others. The vertical structure of the forest multiplies the number of distinct habitats available, and the absence of a severe season permits narrow specialisation that a variable climate would penalise.

Measuring the resulting biodiversity remains difficult, because much of it occupies the canopy and a substantial fraction of the invertebrate fauna is undescribed. What can be established is that the loss of forest is not simply a reduction in area but the removal of species that were never recorded, which is why estimates of extinction attributable to clearance carry wide margins of uncertainty. Conservation policy has moved accordingly. Protecting one fragment of forest in isolation preserves far less than its area suggests, because edge effects alter the microclimate well inside the boundary and because many large animals require a continuous range. Corridors linking one forest block to another now feature in most serious plans, and restoring degraded forest is treated as complementary to protecting what still stands.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "The passage as a whole argues that tropical rainforests are",
        options: [
          "structurally layered, nutritionally fragile, and diverse for reasons that are still only partly understood",
          "chiefly valuable as a source of timber and of land that can be cleared and then farmed indefinitely",
          "sustained by unusually fertile soils holding a large reserve of nutrients within reach of the roots",
          "identical in structure to temperate woodland once the difference in rainfall has been allowed for",
        ],
        correctIndex: 0,
      },
      {
        kind: 'inference',
        text: "It follows from the passage that agriculture on cleared rainforest land tends to fail after a few seasons because",
        options: [
          "rainfall declines immediately after clearance and the crops fail for want of water",
          "the nutrient capital held in the vegetation is transferred to ash and is quickly exhausted",
          "the underlying rock proves too hard to plough once the tree cover has been removed",
          "decomposers are absent from cleared ground, so fallen plant material no longer breaks down",
        ],
        correctIndex: 1,
      },
      {
        kind: 'detail',
        text: "Approximately what percentage of all known plant and animal species are found in tropical rainforests?",
        options: ["About six percent", "About twenty-five percent", "More than fifty percent", "About thirty percent"],
        correctIndex: 2,
      },
    ],
    searchTarget: "forest",
  },
  {
    id: 6,
    title: "Plate Tectonics",
    pages: [
      `Plate tectonics is the scientific theory that describes the movement of large sections of Earth's outer shell, called tectonic plates, and explains many geological features including mountains, earthquakes, and volcanoes. The theory revolutionised Earth science when it was established in the 1960s, providing a unifying framework that connected previously separate observations.

Earth's outermost layer, the lithosphere, is divided into approximately fifteen major plates and several smaller ones. These plates float on the partially molten rock of the asthenosphere and move at rates of a few centimetres per year, driven by forces that arise both within the mantle and at the plates' own margins.`,
      `Plates interact at their boundaries in three primary ways. At convergent boundaries, plates move toward each other. When an oceanic plate meets a continental plate, the denser oceanic plate is forced beneath the continental plate in a process called subduction, creating deep ocean trenches and volcanic mountain chains. When two continental plates collide, neither subducts, and the collision produces vast mountain ranges such as the Himalayas.

At divergent boundaries, plates move apart and new oceanic crust is created as magma rises from below to fill the gap. The Mid-Atlantic Ridge is a prominent example of this process, where the North American and Eurasian plates are separating at roughly two centimetres per year. At transform boundaries, plates slide horizontally past each other, generating earthquakes along major fault lines such as the San Andreas Fault in California. The slow but relentless movement of tectonic plates has shaped the continents and oceans over hundreds of millions of years.`,
      `The evidence that persuaded a sceptical discipline came largely from the sea floor. Surveying after the Second World War revealed a continuous volcanic ridge running through the major ocean basins, and rock recovered from either flank proved younger the closer it lay to the ridge crest. Iron-bearing minerals record the orientation of the magnetic field at the moment they cool, and because that field has reversed repeatedly, the sea floor carries a symmetrical pattern of magnetic stripes on both sides of the ridge.

That pattern is difficult to interpret in any way other than the continuous creation of new crust at the ridge and its outward transport in both directions. A related observation settled the mechanism: earthquakes near a trench are shallow at the trench itself and progressively deeper inland, tracing the descending slab of the subducting plate to several hundred kilometres.`,
      `The force that drives the system is now understood to lie mostly at the edges of each plate rather than beneath it. A slab descending at a subduction zone is colder and denser than the mantle surrounding it, and its weight pulls the trailing plate along behind it. This accounts for the observation that plates with long subducting margins move several times faster than those without any.

Because the motion is steady while the boundaries between plates are locked by friction, strain accumulates in the crust for decades or centuries and is released abruptly when the fault fails. That is the reason long-term seismic hazard can be estimated from the measured rate of plate motion and the time elapsed since the last rupture, even though the timing of an individual earthquake remains beyond reach. The framework also reorganised the history of life. Reconstructing where each plate stood at a given time explains why closely related fossils occur on continents now separated by an ocean, and why the assembly and breakup of supercontinents coincide with major turnovers in the fossil record. Biogeography and geology became one subject rather than two.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "Which best expresses the main point of the passage?",
        options: [
          "Earthquakes can now be predicted accurately from the measured rate of plate motion and the time since the last rupture",
          "Continental drift was accepted as soon as it was proposed, because the sea-floor evidence was already available",
          "The Himalayas are the largest mountain range produced by tectonic activity, and the theory was built to explain them",
          "Plate motion explains a wide range of geological features, and the evidence for it came chiefly from the ocean floor",
        ],
        correctIndex: 3,
      },
      {
        kind: 'inference',
        text: "The symmetrical magnetic striping either side of a mid-ocean ridge is presented as evidence that",
        options: [
          "the magnetic field has held its present orientation throughout the history of the ocean basins",
          "new crust forms at the ridge and moves outward in both directions",
          "the sea floor is everywhere the same age as the continent lying beside it",
          "subduction takes place at the ridge crest rather than at the deep ocean trenches",
        ],
        correctIndex: 1,
      },
      {
        kind: 'detail',
        text: "What occurs at a divergent plate boundary?",
        options: [
          "New oceanic crust is created as plates move apart",
          "The denser plate is forced beneath the other",
          "Plates slide horizontally past one another",
          "Two continental plates collide and buckle",
        ],
        correctIndex: 0,
      },
    ],
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
      `Treating radiation purely as a wave accounts for interference and diffraction but fails to explain how it exchanges energy with matter. Illuminating a metal surface releases electrons only when the frequency exceeds a threshold characteristic of that metal, and increasing the intensity below the threshold releases none at all, however long the exposure continues. The resolution is that energy arrives in discrete quanta whose size is set by frequency rather than by brightness.

Radiation therefore behaves as a wave in propagation and as a stream of particles in absorption and emission, and neither description alone is sufficient. This duality also explains why the biological hazard of the spectrum is governed by frequency: ultraviolet, X-ray and gamma quanta each carry enough energy to break chemical bonds, whereas the far more numerous quanta of visible or infrared radiation do not, no matter how intense the source.`,
      `Only a narrow set of wavelengths reaches the ground, and that constraint has shaped both biology and astronomy. The atmosphere is transparent across the visible band and across parts of the radio band, while ozone absorbs most of the ultraviolet and water vapour and carbon dioxide absorb strongly through the infrared. It is not a coincidence that eyes evolved sensitive to the band that penetrates most freely and that also happens to coincide with the peak emission of the Sun.

Astronomy remained confined to that same band until instruments could be flown above the atmosphere. Observations at other wavelengths have since revealed objects and processes wholly invisible from the ground, which is a useful reminder that the ordinary sense of what the sky contains reflects the transparency of the air as much as the contents of the universe. Instruments now span the range from radio to gamma, and combining them has become standard practice, since a single object frequently looks entirely different at each. The habit of treating the visible band as the default view of nature is a legacy of the atmosphere rather than a property of what is being observed.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "The passage is chiefly concerned with",
        options: [
          "the invention of the telescope and the effect it had on what astronomers could observe from the ground",
          "the properties of electromagnetic radiation and the consequences of the atmosphere transmitting only part of it",
          "the manufacture of optical lenses and the materials from which they are ground and then polished",
          "why the sky appears blue during the day and why it reddens near the horizon at sunset",
        ],
        correctIndex: 1,
      },
      {
        kind: 'inference',
        text: "The passage implies that a very bright red lamp will not damage DNA because",
        options: [
          "red light travels more slowly than ultraviolet and so deposits less energy in the tissue",
          "the eye blinks and the pupil constricts before any damage has time to occur",
          "each individual quantum of red light carries too little energy to break a chemical bond",
          "red light is absorbed by ozone in the atmosphere before it can reach the surface",
        ],
        correctIndex: 2,
      },
      {
        kind: 'detail',
        text: "Which type of light has the shortest wavelength within the visible spectrum?",
        options: ["Red", "Green", "Yellow", "Violet"],
        correctIndex: 3,
      },
    ],
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
      `Locating a source in space is a separate computation, and it depends on comparing the two ears. A sound arriving from one side reaches the nearer ear slightly earlier, and for low frequencies the auditory system resolves differences in arrival time of a few tens of microseconds. At high frequencies the head casts an acoustic shadow, so the far ear receives a quieter signal, and intensity rather than timing carries the information.

Neither cue distinguishes a source directly in front from one directly behind, since both give identical values at the two ears. That ambiguity is resolved by the external ear, whose folds filter arriving sound differently depending on elevation and on whether it originates in front or behind. The resulting spectral colouring is learned, which is why altering the shape of the outer ear disrupts vertical localisation until the listener adapts.

The middle ear performs a further essential function that is easy to overlook.`,
      `Because the inner ear is filled with fluid while the outer ear contains air, sound arriving at a fluid boundary would be almost entirely reflected without some means of matching the two. The three bones of the middle ear supply exactly that, concentrating force from the relatively large tympanic membrane onto the much smaller window of the cochlea and recovering most of the energy that would otherwise be lost.

The clinical consequence is that hearing loss separates into two categories with different implications. Damage to the conducting apparatus attenuates everything arriving at the cochlea and can often be bypassed or repaired. Damage to the hair cells distorts the frequency analysis itself, so amplification alone restores audibility without restoring clarity, which is why people with such loss commonly report that speech is loud enough yet remains difficult to follow in a noisy room. Prevention is accordingly more effective than treatment. Sustained exposure above roughly eighty-five decibels damages hair cells progressively, and that damage accumulates across a working life without any sound seeming painful at the time. Occupational limits are written in terms of both level and duration for precisely that reason.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "Which statement best captures the passage?",
        options: [
          "Sound is a pressure wave, and the ear analyses its frequency, locates its source, and matches air to fluid",
          "Hearing loss is always caused by exposure to loud noise, and can be reversed if the exposure stops in time",
          "The decibel scale is the most important concept in acoustics, because loudness determines everything else",
          "Sound and light behave in the same way in every respect except that sound cannot cross a vacuum",
        ],
        correctIndex: 0,
      },
      {
        kind: 'inference',
        text: "The passage implies that a hearing aid helps less with hair-cell damage than with damage to the middle ear because",
        options: [
          "hearing aids cannot produce enough volume to overcome damage of that severity",
          "damage to the middle ear does not affect hearing in any measurable way",
          "amplification restores audibility but cannot repair the distorted frequency analysis",
          "hair-cell damage also destroys the tympanic membrane and the bones behind it",
        ],
        correctIndex: 2,
      },
      {
        kind: 'detail',
        text: "According to the passage, why is noise-induced hearing loss irreversible?",
        options: [
          "The tympanic membrane cannot heal after damage",
          "Mammalian hair cells do not regenerate once destroyed",
          "The cochlea permanently loses its internal fluid",
          "The middle-ear bones fuse permanently together",
        ],
        correctIndex: 1,
      },
    ],
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
      `The physiological preparation for departure is as remarkable as the navigation. In the weeks beforehand birds feed intensively and deposit fat that may approach half of their total mass, and several species additionally enlarge the flight muscles while allowing the digestive organs to shrink, since tissue that will not be used in flight is dead weight. Long-distance migrants exploit predictable winds and adjust their altitude to find a favourable layer.

Some crossings permit no interruption whatever. Birds that traverse an ocean or a desert must complete the passage on reserves carried from the last staging site, and the survival of those populations depends on a small number of such sites remaining intact. The loss of a single wetland can therefore affect birds breeding thousands of kilometres away, which is why protection organised country by country is generally insufficient.`,
      `Tracking technology has transformed what can be established about these journeys. Ringing recovers only the small fraction of birds found again, whereas miniature loggers and satellite tags now record complete routes, and the resulting data have overturned several confident assumptions about where particular populations spend the winter and which paths they follow.

Climate change introduces a difficulty that the internal calendar is poorly equipped to handle. Day length at the wintering ground is unaffected by warming, yet the insect peak at the breeding ground is arriving progressively earlier. Species that cannot advance their departure sufficiently arrive to find the food supply already past its maximum, and long-distance migrants that rely most heavily on a fixed internal schedule appear to be declining faster than short-distance migrants able to respond to local conditions. Conservation has begun to reflect this. International agreements now treat a migratory route as a single unit rather than as a series of national responsibilities, and monitoring at staging sites gives early warning of trouble for birds that breed thousands of kilometres away. Whether such coordination can keep pace with the shifting timing of the seasons is unresolved, and it is the question most current work on migratory birds is designed to answer.`,
    ],
    questions: [
      {
        kind: 'gist',
        text: "The passage is mainly about",
        options: [
          "the anatomy of the avian wing and the way it is adapted for sustained long-distance flight",
          "why ringing recovers more information about migratory routes than satellite tracking does",
          "why birds migrate, how they navigate and prepare, and why the behaviour is now under pressure",
          "the effect of predators on breeding success at the northern end of the migratory range",
        ],
        correctIndex: 2,
      },
      {
        kind: 'inference',
        text: "The passage suggests that long-distance migrants are declining faster than short-distance migrants because",
        options: [
          "they are hunted more heavily along a route that crosses many more national borders",
          "their timing is set by a day-length cue that carries no information about the breeding ground",
          "they are no longer able to deposit sufficient fat at the staging sites before departure",
          "they have lost the magnetic sense that short-distance migrants have managed to retain",
        ],
        correctIndex: 1,
      },
      {
        kind: 'detail',
        text: "According to the passage, how do displaced juvenile birds differ from adults?",
        options: [
          "They migrate at a lower altitude in weaker winds",
          "They orient by the magnetic sense alone",
          "They hold their original bearing rather than correcting",
          "They postpone departure until the weather improves",
        ],
        correctIndex: 2,
      },
    ],
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

/** Comprehension items per passage. Fixed across the set so every condition is equally weighted. */
export const QUESTIONS_PER_PASSAGE = 3;
