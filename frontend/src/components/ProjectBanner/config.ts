/**
 * The project-information config the Overview banner renders.
 *
 * The *shape* is the contract; `MDPP_PROJECT` below is the shared content, kept
 * here so the three apps cannot drift. An app passes the config (normally the
 * default) and adds at most one app-specific line of its own — see
 * `ProjectBannerProps.appNote`.
 */

export interface ProjectService {
  /** Stable key, also used to mark which service the reader is looking at. */
  key: string;
  name: string;
  role: string;
  description: string;
}

export interface ProjectPartner {
  name: string;
  role: string;
}

export interface ProjectPerson {
  name: string;
  role: string;
  email?: string;
}

export interface ProjectLink {
  label: string;
  href: string;
  description?: string;
}

export interface ProjectStandard {
  name: string;
  detail: string;
  url: string;
}

export interface ProjectConfig {
  name: string;
  fullName: string;
  tagline: string;
  description: string;
  services: ProjectService[];
  partners: ProjectPartner[];
  funding: { text: string; note?: string };
  contact: { text: string; people: { name: string; email: string }[]; note?: string };
  contributors: ProjectPerson[];
  standards: ProjectStandard[];
  links: ProjectLink[];
}

/** The mDPP project as every app describes it. Edit here, not per app. */
export const MDPP_PROJECT: ProjectConfig = {
  name: "mDPP",
  fullName: "Molecular Digital Product Passport",
  tagline: "A verifiable textile DPP: what a manufacturer declares, checked against what a laboratory measures.",
  description:
    "The mDPP project builds a Digital Product Passport for textiles in which the fibre composition an economic operator declares is compared with what a laboratory molecularly analyses. The gap between the declared and the evidenced composition is the contribution.",
  services: [
    {
      key: "dpp-app",
      name: "dpp-app",
      role: "Reference DPP",
      description:
        "Product identity, the model → variant → batch → item hierarchy, and free-form attributes with inheritance. Agnostic of composition. One Product entity; the level is derived from the GS1 path.",
    },
    {
      key: "mdpp-app",
      name: "mdpp-app",
      role: "Molecular extension",
      description:
        "Declarations and laboratory tests/results, flat and hierarchy-agnostic, keyed by GS1 path so it attaches to any DPP. Comparisons between declared and tested composition are computed here.",
    },
    {
      key: "passport-app",
      name: "passport-app",
      role: "Concentrator / viewer",
      description: "Merges DPP and mDPP data, applies the hierarchy when one exists, and presents declared versus tested composition across levels.",
    },
  ],
  partners: [
    { name: "Amsterdam University of Applied Sciences (HvA)", role: "Responsible AI Lab and Fashion Technology" },
    { name: "HAN University of Applied Sciences", role: "Laboratory (BioCentre)" },
  ],
  funding: {
    text: "Funded by Regieorgaan SIA (part of NWO, the Dutch Research Council) under the call \"Digitale productpaspoorten: toepassing in de praktijk\" (Digital product passports: application in practice), co-financed by Topsector ICT. The programme supports practice-oriented research by universities of applied sciences into the adoption of digital product passports across supply chains, in the run-up to the EU Ecodesign for Sustainable Products Regulation (ESPR).",
    note: "keywords: SIA, NWO, Topsector ICT, Regieorgaan SIA, Digitale productpaspoorten, Digital product passports, Ecodesign for Sustainable Products Regulation, ESPR",
  },
  contact: {
    text: "HvA Responsible AI Lab — project mDPP",
    people: [
      { name: "Marcio Fückner", email: "marcio.fuckner@hva.nl" },
      { name: "Martijn de Bruin", email: "m.j.de.bruin@hva.nl" },
    ],
    note: "",
  },
  contributors: [
    // Hogeschool van Amsterdam
    { name: "Marcio Fückner", role: "Senior Researcher Responsible IT HvA", email: "marcio.fuckner@hva.nl" },
    { name: "Martijn de Bruin", role: "Researcher Responsible IT & HvA", email: "m.j.de.bruin@hva.nl" },
    { name: "Troy Nachtigall", role: "Lector Fashion Technology HvA, CoE Creative Innovation" },
    { name: "Pascal Wiggers", role: "Lector Responsible IT HvA" },
    { name: "Francesco Sollitto", role: "Research Analyst, Data and Sustainability HvA" },
    { name: "Marco Mossinkoff", role: "Senior Researcher, Textile Value Chain HvA" },
    { name: "Lyske Gais de Bildt", role: "Researcher HvA" },
    { name: "Gwen Parry", role: "Project Manager", email: "g.b.parry@hva.nl" },

    // HAN University of Applied Sciences
    { name: "Christof Francke", role: "Lector Biobased Innovations · HAN, CoE HAN BioCentre" },
    { name: "Douwe van der Leest", role: "Lector Bioinformatics · HAN" },
    { name: "Tilman Todt", role: "Project Leader Applied Data Science · HAN" },

    // Industry partners
    { name: "Mijke van Ballegooijen", role: "CEO · BYBORRE" },
    { name: "Robert Pans", role: "Finance Controller · BYBORRE" },
    { name: "Ellen Albers", role: "Initiator and Chairwoman · New Order of Fashion" },
    { name: "Dina Beganovic", role: "Marketing & Events · New Order of Fashion" },
    { name: "Mila Svechtarova", role: "Marketing & Events · New Order of Fashion" },
    { name: "Lex Raijmakers", role: "Co-Founder · Candour.Digital" },
    { name: "Thijs Verhaar", role: "CEO · KNITWEAR LAB" },
    { name: "Tonka Oštrić", role: "Microfactory Production Technician · KNITWEAR LAB" },
    { name: "Claire Teurlings", role: "Ketenregisseur Circulair Textiel · Textielregie" },
  ],
  standards: [
    { name: "GS1 Digital Link & identifiers", detail: "GTIN (AI 01), lot (AI 10), serial (AI 21), GMN (AI 8013), GLN", url: "https://ref.gs1.org/standards/digital-link/" },
    { name: "GS1 Web Vocabulary", detail: "Product and organisation terms", url: "https://ref.gs1.org/voc/" },
    { name: "CIRPASS-2 DPP vocabulary", detail: "Core DPP terms (dpp:)", url: "https://cirpass2.eu/" },
    { name: "schema.org", detail: "Organization, Product", url: "https://schema.org/" },
    { name: "JSON-LD 1.1", detail: "Serialisation at the API boundary", url: "https://www.w3.org/TR/json-ld11/" },
    { name: "EU 1007/2011 textile fibre names", detail: "The legal fibre names a declaration is checked against", url: "https://eur-lex.europa.eu/eli/reg/2011/1007/oj" },
    { name: "OpenID Connect", detail: "Identity (planned; a development identity source is used today)", url: "https://openid.net/connect/" },
  ],
  links: [
    { label: "OpenAPI (interactive)", href: "/docs", description: "Try the API in the browser" },
    { label: "OpenAPI (JSON)", href: "/openapi.json" },
    { label: "Shared library", href: "https://github.com/m-dpp/m-dpp-common", description: "m-dpp-common: organisation, RBAC, auth seam, admin UI" },
  ],
};
