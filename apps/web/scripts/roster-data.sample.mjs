/**
 * GENERATED — do not edit by hand. Regenerate with:
 *   node scripts/anonymize-roster.mjs > scripts/roster-data.sample.mjs
 *
 * A synthetic stand-in for the real roster, used by CI, the e2e suite and local
 * development. Structure is identical to the real data — same clubs, same
 * seats, same codes, same vacancies — so tests exercise the real shape. Every
 * person is generated, and every address is @example.invalid (RFC 2606), which
 * cannot receive mail.
 *
 * The real roster is NOT in this repository. See docs/RUNBOOK.md.
 */

export const CURRENT_TERM = "2026-2027"
export const PRIOR_TERM = "2025-2026"
export const VACANT_LABEL = "Vacant Position"

export const ADVISORS = [
  {
    "name": "Avery Fairbank",
    "email": "avery.fairbank@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Gray Danforth",
    "email": "gray.danforth@example.invalid",
    "affiliation": "Benet Center"
  },
  {
    "name": "Vale Hollis",
    "email": "vale.hollis@example.invalid",
    "affiliation": "Benet Center"
  },
  {
    "name": "Rowan Ellery",
    "email": "rowan.ellery@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Tatum Sterling",
    "email": "tatum.sterling@example.invalid",
    "affiliation": "Benet CMC"
  },
  {
    "name": "Logan Yarrow 2",
    "email": "logan.yarrow@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Devon Underhill",
    "email": "devon.underhill@example.invalid",
    "affiliation": "Faculty"
  },
  {
    "name": "Umber Ellery",
    "email": "umber.ellery@example.invalid",
    "affiliation": null
  },
  {
    "name": "Parker Lonsdale",
    "email": "parker.lonsdale@example.invalid",
    "affiliation": "Faculty"
  },
  {
    "name": "Parker Jessup 2",
    "email": "parker.jessup@example.invalid",
    "affiliation": "OEI"
  },
  {
    "name": "Kai Thornbury",
    "email": "kai.thornbury@example.invalid",
    "affiliation": "Admissions"
  },
  {
    "name": "Logan Ravensworth",
    "email": "logan.ravensworth@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Harper Bellweather 2",
    "email": "harper.bellweather@example.invalid",
    "affiliation": "BIC"
  },
  {
    "name": "Kai Underhill 2",
    "email": "kai.underhill@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Finley Ingram",
    "email": "finley.ingram@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Xen Ashford",
    "email": "xen.ashford@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Harper Vance",
    "email": "harper.vance@example.invalid",
    "affiliation": "Ainslie OSE"
  },
  {
    "name": "Blake Kingsley",
    "email": "blake.kingsley@example.invalid",
    "affiliation": "MBA Faculty Director"
  },
  {
    "name": "Parker Whitlock",
    "email": "parker.whitlock@example.invalid",
    "affiliation": "Benet CMC"
  }
]

export const ROSTER = [
  {
    "name": "Simon Consulting Club (SCC)",
    "shortName": "Simon Consulting Club",
    "acronym": "SCC",
    "code": "SCC",
    "slug": "simon-consulting-club",
    "legacySlug": "consulting-club",
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Avery Fairbank",
        "email": "avery.fairbank@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Gray Danforth",
        "email": "gray.danforth@example.invalid",
        "affiliation": "Benet Center"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": "Interim oversee marketing and Comms",
        "positionCode": "SCC-PRES",
        "holder": {
          "name": "Logan Ellery",
          "email": "logan.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Jessup",
          "email": "harper.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SCC-VP-EVEN-PART",
        "holder": {
          "name": "Marlow Whitlock",
          "email": "marlow.whitlock@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Underhill",
          "email": "harper.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SCC-VP-FINA-OPER",
        "holder": {
          "name": "Zephyr Ingram",
          "email": "zephyr.ingram@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Kingsley",
          "email": "kai.kingsley@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SCC-VP-MARK-COMM",
        "holder": null,
        "vacancyNote": "Opening in the fall",
        "predecessor": {
          "name": "Oakley Ravensworth",
          "email": "oakley.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Casing",
        "basePosition": "VP of Casing",
        "positionNote": null,
        "positionCode": "SCC-VP-CASI",
        "holder": {
          "name": "Logan Carrow",
          "email": "logan.carrow@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Noor Lonsdale",
          "email": "noor.lonsdale@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 1",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SCC-1Y-MBA-REP-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Oakley Bellweather",
          "email": "oakley.bellweather@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 2",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SCC-1Y-MBA-REP-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Wren Danforth",
          "email": "wren.danforth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SCC-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SCC-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Jordan Danforth",
          "email": "jordan.danforth@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon Finance & Investment Club (SFIC)",
    "shortName": "Simon Finance & Investment Club",
    "acronym": "SFIC",
    "code": "SFIC",
    "slug": "simon-finance-and-investment-club",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Avery Fairbank",
        "email": "avery.fairbank@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Vale Hollis",
        "email": "vale.hollis@example.invalid",
        "affiliation": "Benet Center"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SFIC-PRES",
        "holder": {
          "name": "Quinn Ravensworth",
          "email": "quinn.ravensworth@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Zephyr Oleander",
          "email": "zephyr.oleander@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SFIC-VP-FINA-OPER",
        "holder": {
          "name": "Indigo Kingsley",
          "email": "indigo.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Yuki Quill",
          "email": "yuki.quill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SFIC-VP-MARK-COMM",
        "holder": {
          "name": "Umber Merritt",
          "email": "umber.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP of Event and Partnership",
        "basePosition": "VP of Event and Partnership",
        "positionNote": null,
        "positionCode": "SFIC-VP-EVEN-PART",
        "holder": {
          "name": "Gray Merritt",
          "email": "gray.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Investment Banking",
        "basePosition": "VP Investment Banking",
        "positionNote": null,
        "positionCode": "SFIC-VP-INVE-BANK",
        "holder": null,
        "vacancyNote": "Postion will remain unfilled this cycle",
        "predecessor": {
          "name": "Emery Merritt",
          "email": "emery.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Meliora Fund CIO",
        "basePosition": "Meliora Fund CIO",
        "positionNote": null,
        "positionCode": "SFIC-MELI-FUND-CIO",
        "holder": {
          "name": "Umber Whitlock",
          "email": "umber.whitlock@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "Meliora Fund COO",
        "basePosition": "Meliora Fund COO",
        "positionNote": null,
        "positionCode": "SFIC-MELI-FUND-COO",
        "holder": {
          "name": "Tatum Norwood",
          "email": "tatum.norwood@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SFIC-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Quinn Ravensworth",
          "email": "quinn.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SFIC-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Gray Kingsley",
          "email": "gray.kingsley@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SFIC-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Underhill",
          "email": "kai.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Meliora Fund Rep",
        "basePosition": "Meliora Fund Rep",
        "positionNote": null,
        "positionCode": "SFIC-MELI-FUND-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Bellweather",
          "email": "harper.bellweather@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon Marketing Association (SMA) & Simon Data Analytics Club (SDAC)",
    "shortName": "Simon Marketing Association & Simon Data Analytics Club",
    "acronym": null,
    "code": "SMASD",
    "slug": "simon-marketing-and-data-analytics",
    "legacySlug": "simon-marketing-and-analytics-association",
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Rowan Ellery",
        "email": "rowan.ellery@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Tatum Sterling",
        "email": "tatum.sterling@example.invalid",
        "affiliation": "Benet CMC"
      },
      {
        "name": "Gray Danforth",
        "email": "gray.danforth@example.invalid",
        "affiliation": "Benet Center"
      }
    ],
    "seats": [
      {
        "name": "President (SMA)",
        "basePosition": "President (SMA)",
        "positionNote": null,
        "positionCode": "SMASD-PRES-SMA",
        "holder": {
          "name": "Oakley Bellweather",
          "email": "oakley.bellweather@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "President (SDAC)",
        "basePosition": "President (SDAC)",
        "positionNote": null,
        "positionCode": "SMASD-PRES-SDAC",
        "holder": {
          "name": "Blake Hollis",
          "email": "blake.hollis@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Events & Partnerships (SMA)",
        "basePosition": "VP Events & Partnerships (SMA)",
        "positionNote": null,
        "positionCode": "SMASD-VP-EVEN-PART-SMA",
        "holder": {
          "name": "Gray Underhill",
          "email": "gray.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Events & Partnerships (SDAC)",
        "basePosition": "VP Events & Partnerships (SDAC)",
        "positionNote": null,
        "positionCode": "SMASD-VP-EVEN-PART-SDAC",
        "holder": {
          "name": "Parker Carrow",
          "email": "parker.carrow@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SMASD-VP-FINA-OPER",
        "holder": {
          "name": "Wren Kingsley",
          "email": "wren.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SMASD-VP-MARK-COMM",
        "holder": {
          "name": "Oakley Ashford",
          "email": "oakley.ashford@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Club Strategy (SMA)",
        "basePosition": "VP Club Strategy (SMA)",
        "positionNote": null,
        "positionCode": "SMASD-VP-CLUB-STRA-SMA",
        "holder": {
          "name": "Emery Lonsdale",
          "email": "emery.lonsdale@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Club Strategy (SDAC)",
        "basePosition": "VP Club Strategy (SDAC)",
        "positionNote": null,
        "positionCode": "SMASD-VP-CLUB-STRA-SDAC",
        "holder": {
          "name": "Logan Ellery 2",
          "email": "logan.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SMASD-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SMASD-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SMASD-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Pricing Club",
    "shortName": "Simon Pricing Club",
    "acronym": null,
    "code": "SPC",
    "slug": "simon-pricing-club",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Vale Hollis",
        "email": "vale.hollis@example.invalid",
        "affiliation": "Benet Center"
      },
      {
        "name": "Rowan Ellery",
        "email": "rowan.ellery@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SPC-PRES",
        "holder": {
          "name": "Rowan Underhill",
          "email": "rowan.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Bellweather",
          "email": "vale.bellweather@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SPC-VP-EVEN-PART",
        "holder": {
          "name": "Harper Norwood",
          "email": "harper.norwood@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Umber Thornbury",
          "email": "umber.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SPC-VP-FINA-OPER",
        "holder": {
          "name": "Quinn Underhill",
          "email": "quinn.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Indigo Ingram",
          "email": "indigo.ingram@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SPC-VP-MARK-COMM",
        "holder": {
          "name": "Wren Kingsley 2",
          "email": "wren.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Indigo Sterling",
          "email": "indigo.sterling@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SPC-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Rowan Underhill",
          "email": "rowan.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "PMBA Rep",
        "basePosition": "PMBA Rep",
        "positionNote": null,
        "positionCode": "SPC-PMBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Norwood",
          "email": "harper.norwood@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SPC-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Ellery",
          "email": "harper.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SPC-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Life Sciences",
    "shortName": "Simon Life Sciences",
    "acronym": null,
    "code": "SLS",
    "slug": "simon-life-sciences",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Rowan Ellery",
        "email": "rowan.ellery@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SLS-PRES",
        "holder": {
          "name": "Parker Jessup",
          "email": "parker.jessup@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Oakley Ravensworth",
          "email": "oakley.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SLS-VP-EVEN-PART",
        "holder": {
          "name": "Sage Fairbank",
          "email": "sage.fairbank@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Logan Yarrow",
          "email": "logan.yarrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SLS-VP-FINA-OPER",
        "holder": {
          "name": "Gray Vance",
          "email": "gray.vance@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Umber Oleander",
          "email": "umber.oleander@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SLS-VP-MARK-COMM",
        "holder": {
          "name": "Marlow Hollis",
          "email": "marlow.hollis@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Carrow",
          "email": "harper.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MD/MBA Liaison",
        "basePosition": "MD/MBA Liaison",
        "positionNote": null,
        "positionCode": "SLS-MD-MBA-LIAI",
        "holder": {
          "name": "Kai Merritt",
          "email": "kai.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Merritt",
          "email": "kai.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 1",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SLS-1Y-MBA-REP-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Jessup",
          "email": "parker.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 2",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SLS-1Y-MBA-REP-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Thornbury",
          "email": "vale.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SLS-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SLS-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Noor Bellweather",
          "email": "noor.bellweather@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon Product Management Club (SPMC)",
    "shortName": "Simon Product Management Club",
    "acronym": "SPMC",
    "code": "SPMC",
    "slug": "simon-product-management-club",
    "legacySlug": "product-management-club",
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Logan Yarrow 2",
        "email": "logan.yarrow@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Gray Danforth",
        "email": "gray.danforth@example.invalid",
        "affiliation": "Benet Center"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SPMC-PRES",
        "holder": {
          "name": "Finley Lonsdale",
          "email": "finley.lonsdale@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Ellery",
          "email": "parker.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SPMC-VP-EVEN-PART",
        "holder": {
          "name": "Rowan Ashford",
          "email": "rowan.ashford@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Jordan Ingram",
          "email": "jordan.ingram@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SPMC-VP-FINA-OPER",
        "holder": {
          "name": "Marlow Whitlock",
          "email": "marlow.whitlock@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Indigo Ingram",
          "email": "indigo.ingram@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SPMC-VP-MARK-COMM",
        "holder": {
          "name": "Umber Ingram",
          "email": "umber.ingram@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Carrow 2",
          "email": "parker.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP PM Labs",
        "basePosition": "VP PM Labs",
        "positionNote": null,
        "positionCode": "SPMC-VP-PM-LABS",
        "holder": null,
        "vacancyNote": "Not Filling this cycle",
        "predecessor": {
          "name": "Casey Jessup",
          "email": "casey.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 1",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SPMC-1Y-MBA-REP-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Sage Ellery",
          "email": "sage.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 2",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SPMC-1Y-MBA-REP-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Wren Hollis",
          "email": "wren.hollis@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SPMC-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Quinn Quill",
          "email": "quinn.quill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SPMC-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Marlow Hollis 2",
          "email": "marlow.hollis@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Associate PM 1",
        "basePosition": "Associate PM",
        "positionNote": null,
        "positionCode": "SPMC-ASSO-PM-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Tatum Underhill",
          "email": "tatum.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Associate PM 2",
        "basePosition": "Associate PM",
        "positionNote": null,
        "positionCode": "SPMC-ASSO-PM-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Umber Quill",
          "email": "umber.quill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Associate PM 3",
        "basePosition": "Associate PM",
        "positionNote": null,
        "positionCode": "SPMC-ASSO-PM-3",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Logan Ellery 2",
          "email": "logan.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Associate PM 4",
        "basePosition": "Associate PM",
        "positionNote": null,
        "positionCode": "SPMC-ASSO-PM-4",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Tatum Merritt",
          "email": "tatum.merritt@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon Entrepreneurship Association",
    "shortName": "Simon Entrepreneurship Association",
    "acronym": null,
    "code": "SEA",
    "slug": "simon-entrepreneurship-association",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Devon Underhill",
        "email": "devon.underhill@example.invalid",
        "affiliation": "Faculty"
      },
      {
        "name": "Rowan Ellery",
        "email": "rowan.ellery@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Umber Ellery",
        "email": "umber.ellery@example.invalid",
        "affiliation": null
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": "Oversees Finances & Operations",
        "positionCode": "SEA-PRES",
        "holder": {
          "name": "Oakley Pemberton",
          "email": "oakley.pemberton@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Events & Communications",
        "basePosition": "VP Events & Communications",
        "positionNote": null,
        "positionCode": "SEA-VP-EVEN-COMM",
        "holder": {
          "name": "Tatum Underhill",
          "email": "tatum.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP of Partnerships and Engagement",
        "basePosition": "VP of Partnerships and Engagement",
        "positionNote": "Functional Role",
        "positionCode": "SEA-VP-PART-ENGA",
        "holder": {
          "name": "Oakley Ashford",
          "email": "oakley.ashford@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SEA-VP-FINA-OPER",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SEA-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SEA-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SEA-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Net Impact",
    "shortName": "Net Impact",
    "acronym": null,
    "code": "NI",
    "slug": "net-impact",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Logan Yarrow 2",
        "email": "logan.yarrow@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "NI-PRES",
        "holder": {
          "name": "Kai Jessup",
          "email": "kai.jessup@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Finley Carrow",
          "email": "finley.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": "Overseeing Social Impact",
        "positionCode": "NI-VP-EVEN-PART",
        "holder": {
          "name": "Tatum Underhill",
          "email": "tatum.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Rowan Merritt",
          "email": "rowan.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "NI-VP-FINA-OPER",
        "holder": {
          "name": "Harper Jessup 2",
          "email": "harper.jessup@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Yuki Jessup",
          "email": "yuki.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Marketing & Communication",
        "basePosition": "VP of Marketing & Communication",
        "positionNote": null,
        "positionCode": "NI-VP-MARK-COMM",
        "holder": {
          "name": "Casey Lonsdale",
          "email": "casey.lonsdale@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Social Impact",
        "basePosition": "VP Social Impact",
        "positionNote": null,
        "positionCode": "NI-VP-SOCI-IMPA",
        "holder": null,
        "vacancyNote": "Not Filling this cycle",
        "predecessor": {
          "name": "Kai Kingsley",
          "email": "kai.kingsley@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "NI-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Jessup",
          "email": "kai.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "NI-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "NI-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Merritt",
          "email": "harper.merritt@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon School Venture Fund (SSVF)",
    "shortName": "Simon School Venture Fund",
    "acronym": "SSVF",
    "code": "SSVF",
    "slug": "simon-school-venture-fund",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Parker Lonsdale",
        "email": "parker.lonsdale@example.invalid",
        "affiliation": "Faculty"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SSVF-PRES",
        "holder": {
          "name": "Rowan Lonsdale",
          "email": "rowan.lonsdale@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Vance",
          "email": "vale.vance@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Portfolio Management",
        "basePosition": "VP of Portfolio Management",
        "positionNote": null,
        "positionCode": "SSVF-VP-PORT-MANA",
        "holder": {
          "name": "Tatum Norwood",
          "email": "tatum.norwood@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Fairbank",
          "email": "parker.fairbank@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Strategic Partnerships",
        "basePosition": "VP of Strategic Partnerships",
        "positionNote": null,
        "positionCode": "SSVF-VP-STRA-PART",
        "holder": {
          "name": "Harper Bellweather",
          "email": "harper.bellweather@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Quinn Fairbank",
          "email": "quinn.fairbank@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Deal Sourcing",
        "basePosition": "VP of Deal Sourcing",
        "positionNote": null,
        "positionCode": "SSVF-VP-DEAL-SOUR",
        "holder": {
          "name": "Sage Ravensworth",
          "email": "sage.ravensworth@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Jordan Pemberton",
          "email": "jordan.pemberton@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Learning & Development",
        "basePosition": "VP of Learning & Development",
        "positionNote": "Events and Communications",
        "positionCode": "SSVF-VP-LEAR-DEVE",
        "holder": {
          "name": "Blake Ellery",
          "email": "blake.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Rowan Merritt",
          "email": "rowan.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Chief Operating Officer (COO)",
        "basePosition": "Chief Operating Officer (COO)",
        "positionNote": "Oversees Finances",
        "positionCode": "SSVF-CHIE-OPER-OFFI-COO",
        "holder": {
          "name": "Sage Gallant",
          "email": "sage.gallant@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP of Deal Execution 1",
        "basePosition": "VP of Deal Execution",
        "positionNote": null,
        "positionCode": "SSVF-VP-DEAL-EXEC-1",
        "holder": {
          "name": "Rowan Underhill",
          "email": "rowan.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Emery Merritt",
          "email": "emery.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Deal Execution 2",
        "basePosition": "VP of Deal Execution",
        "positionNote": null,
        "positionCode": "SSVF-VP-DEAL-EXEC-2",
        "holder": {
          "name": "Blake Ellery 2",
          "email": "blake.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Emery Merritt",
          "email": "emery.merritt@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon VISION Consulting",
    "shortName": "Simon VISION Consulting",
    "acronym": null,
    "code": "SVC",
    "slug": "simon-vision-consulting",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": null,
    "advisors": [
      {
        "name": "Avery Fairbank",
        "email": "avery.fairbank@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": "Oversees Finances & Event Requests",
        "positionCode": "SVC-PRES",
        "holder": {
          "name": "Xen Sterling",
          "email": "xen.sterling@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Indigo Fairbank",
          "email": "indigo.fairbank@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Managing Director 1",
        "basePosition": "Managing Director",
        "positionNote": null,
        "positionCode": "SVC-MANA-DIRE-1",
        "holder": {
          "name": "Wren Kingsley",
          "email": "wren.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Indigo Lonsdale",
          "email": "indigo.lonsdale@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Managing Director 2",
        "basePosition": "Managing Director",
        "positionNote": null,
        "positionCode": "SVC-MANA-DIRE-2",
        "holder": {
          "name": "Xen Pemberton",
          "email": "xen.pemberton@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Noor Lonsdale",
          "email": "noor.lonsdale@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Managing Director 3",
        "basePosition": "Managing Director",
        "positionNote": null,
        "positionCode": "SVC-MANA-DIRE-3",
        "holder": {
          "name": "Tatum Merritt",
          "email": "tatum.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Ravensworth",
          "email": "devon.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Managing Director 4",
        "basePosition": "Managing Director",
        "positionNote": null,
        "positionCode": "SVC-MANA-DIRE-4",
        "holder": {
          "name": "Oakley Quill",
          "email": "oakley.quill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Finley Bellweather",
          "email": "finley.bellweather@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Marketing Director",
        "basePosition": "Marketing Director",
        "positionNote": null,
        "positionCode": "SVC-MARK-DIRE",
        "holder": {
          "name": "Umber Gallant",
          "email": "umber.gallant@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Marlow Ravensworth",
          "email": "marlow.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Engagement Director",
        "basePosition": "Engagement Director",
        "positionNote": null,
        "positionCode": "SVC-ENGA-DIRE",
        "holder": {
          "name": "Logan Ashford",
          "email": "logan.ashford@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Xen Yarrow",
          "email": "xen.yarrow@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon Accounting Association",
    "shortName": "Simon Accounting Association",
    "acronym": null,
    "code": "SAA",
    "slug": "simon-accounting-association",
    "legacySlug": null,
    "category": "PROFESSIONAL",
    "note": "Board formed Fall 2026",
    "advisors": [],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SAA-PRES",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SAA-VP-EVEN-PART",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SAA-VP-FINA-OPER",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SAA-VP-MARK-COMM",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Women in Business (SWiB)",
    "shortName": "Simon Women in Business",
    "acronym": "SWIB",
    "code": "SWIB",
    "slug": "simon-women-in-business",
    "legacySlug": null,
    "category": "COMMUNITY",
    "note": null,
    "advisors": [
      {
        "name": "Logan Yarrow 2",
        "email": "logan.yarrow@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Parker Jessup 2",
        "email": "parker.jessup@example.invalid",
        "affiliation": "OEI"
      },
      {
        "name": "Kai Thornbury",
        "email": "kai.thornbury@example.invalid",
        "affiliation": "Admissions"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SWIB-PRES",
        "holder": {
          "name": "Quinn Oleander",
          "email": "quinn.oleander@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Umber Thornbury",
          "email": "umber.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SWIB-VP-EVEN-PART",
        "holder": {
          "name": "Avery Hollis",
          "email": "avery.hollis@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Thornbury 2",
          "email": "vale.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SWIB-VP-FINA-OPER",
        "holder": {
          "name": "Finley Yarrow",
          "email": "finley.yarrow@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Xen Yarrow",
          "email": "xen.yarrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SWIB-VP-MARK-COMM",
        "holder": {
          "name": "Harper Underhill 2",
          "email": "harper.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Carrow 2",
          "email": "parker.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Men as Allies",
        "basePosition": "VP Men as Allies",
        "positionNote": null,
        "positionCode": "SWIB-VP-MEN-ALLI",
        "holder": {
          "name": "Kai Jessup 2",
          "email": "kai.jessup@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Gray Hollis",
          "email": "gray.hollis@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 1",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SWIB-1Y-MBA-REP-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Quinn Oleander",
          "email": "quinn.oleander@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 2",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SWIB-1Y-MBA-REP-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Jessup",
          "email": "kai.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SWIB-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Merritt",
          "email": "harper.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SWIB-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Blake Yarrow",
          "email": "blake.yarrow@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Latin American Students of Simon (LASOS)",
    "shortName": "Latin American Students of Simon",
    "acronym": "LASOS",
    "code": "LASOS",
    "slug": "latin-american-students-of-simon",
    "legacySlug": null,
    "category": "COMMUNITY",
    "note": null,
    "advisors": [
      {
        "name": "Logan Ravensworth",
        "email": "logan.ravensworth@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Parker Jessup 2",
        "email": "parker.jessup@example.invalid",
        "affiliation": "OEI"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "LASOS-PRES",
        "holder": {
          "name": "Harper Jessup 2",
          "email": "harper.jessup@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Xen Quill",
          "email": "xen.quill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "LASOS-VP-EVEN-PART",
        "holder": {
          "name": "Umber Ingram",
          "email": "umber.ingram@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Logan Ashford 2",
          "email": "logan.ashford@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "LASOS-VP-FINA-OPER",
        "holder": {
          "name": "Yuki Norwood",
          "email": "yuki.norwood@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Bellweather",
          "email": "parker.bellweather@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "LASOS-VP-MARK-COMM",
        "holder": {
          "name": "Sage Ellery",
          "email": "sage.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Yuki Merritt",
          "email": "yuki.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 1",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "LASOS-1Y-MBA-REP-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Jessup 2",
          "email": "harper.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep 2",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "LASOS-1Y-MBA-REP-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Marlow Kingsley",
          "email": "marlow.kingsley@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "LASOS-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Sterling",
          "email": "devon.sterling@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "LASOS-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Norwood",
          "email": "vale.norwood@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon Pride Alliance",
    "shortName": "Simon Pride Alliance",
    "acronym": null,
    "code": "SPA",
    "slug": "simon-pride-alliance",
    "legacySlug": null,
    "category": "COMMUNITY",
    "note": null,
    "advisors": [
      {
        "name": "Rowan Ellery",
        "email": "rowan.ellery@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Parker Jessup 2",
        "email": "parker.jessup@example.invalid",
        "affiliation": "OEI"
      },
      {
        "name": "Harper Bellweather 2",
        "email": "harper.bellweather@example.invalid",
        "affiliation": "BIC"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SPA-PRES",
        "holder": {
          "name": "Logan Carrow",
          "email": "logan.carrow@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Gallant",
          "email": "kai.gallant@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SPA-VP-EVEN-PART",
        "holder": {
          "name": "Indigo Kingsley 2",
          "email": "indigo.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Blake Thornbury",
          "email": "blake.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SPA-VP-FINA-OPER",
        "holder": {
          "name": "Harper Underhill 3",
          "email": "harper.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Wren Kingsley 3",
          "email": "wren.kingsley@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SPA-VP-MARK-COMM",
        "holder": {
          "name": "Oakley Quill",
          "email": "oakley.quill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Gray Underhill 2",
          "email": "gray.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SPA-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Logan Carrow",
          "email": "logan.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SPA-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SPA-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Africa Business Club (SABC)",
    "shortName": "Simon Africa Business Club",
    "acronym": "SABC",
    "code": "SABC",
    "slug": "simon-africa-business-club",
    "legacySlug": null,
    "category": "COMMUNITY",
    "note": null,
    "advisors": [
      {
        "name": "Logan Ravensworth",
        "email": "logan.ravensworth@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Parker Jessup 2",
        "email": "parker.jessup@example.invalid",
        "affiliation": "OEI"
      },
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SABC-PRES",
        "holder": {
          "name": "Harper Quill",
          "email": "harper.quill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Underhill 3",
          "email": "kai.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SABC-VP-MARK-COMM",
        "holder": {
          "name": "Parker Carrow",
          "email": "parker.carrow@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Wren Jessup",
          "email": "wren.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SABC-VP-EVEN-PART",
        "holder": {
          "name": "Quinn Lonsdale",
          "email": "quinn.lonsdale@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Casey Underhill",
          "email": "casey.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SABC-VP-FINA-OPER",
        "holder": {
          "name": "Harper Fairbank",
          "email": "harper.fairbank@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Wren Oleander",
          "email": "wren.oleander@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SABC-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Jessup 3",
          "email": "kai.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SABC-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SABC-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Norwood",
          "email": "devon.norwood@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Asians in America (ASIAM)",
    "shortName": "Asians in America",
    "acronym": "ASIAM",
    "code": "ASIAM",
    "slug": "asians-in-america",
    "legacySlug": null,
    "category": "COMMUNITY",
    "note": null,
    "advisors": [
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Parker Jessup 2",
        "email": "parker.jessup@example.invalid",
        "affiliation": "OEI"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "ASIAM-PRES",
        "holder": {
          "name": "Zephyr Merritt",
          "email": "zephyr.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Ravensworth",
          "email": "devon.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "ASIAM-VP-MARK-COMM",
        "holder": {
          "name": "Umber Gallant",
          "email": "umber.gallant@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Avery Danforth",
          "email": "avery.danforth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "ASIAM-VP-EVEN-PART",
        "holder": {
          "name": "Rowan Thornbury",
          "email": "rowan.thornbury@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Ellery 2",
          "email": "parker.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "ASIAM-VP-FINA-OPER",
        "holder": {
          "name": "Logan Ashford",
          "email": "logan.ashford@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Yuki Lonsdale",
          "email": "yuki.lonsdale@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "ASIAM-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Rowan Thornbury",
          "email": "rowan.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "ASIAM-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Thornbury",
          "email": "harper.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "ASIAM-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Black Student Alliance (SBSA)",
    "shortName": "Simon Black Student Alliance",
    "acronym": "SBSA",
    "code": "SBSA",
    "slug": "simon-black-student-alliance",
    "legacySlug": null,
    "category": "COMMUNITY",
    "note": null,
    "advisors": [
      {
        "name": "Finley Ingram",
        "email": "finley.ingram@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Parker Jessup 2",
        "email": "parker.jessup@example.invalid",
        "affiliation": "OEI"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SBSA-PRES",
        "holder": {
          "name": "Kai Ravensworth",
          "email": "kai.ravensworth@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Thornbury 2",
          "email": "vale.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SBSA-VP-EVEN-PART",
        "holder": {
          "name": "Yuki Kingsley",
          "email": "yuki.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Indigo Ashford",
          "email": "indigo.ashford@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SBSA-VP-MARK-COMM",
        "holder": {
          "name": "Sage Fairbank",
          "email": "sage.fairbank@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP of Finance and Operations",
        "basePosition": "VP of Finance and Operations",
        "positionNote": null,
        "positionCode": "SBSA-VP-FINA-OPER",
        "holder": {
          "name": "Oakley Pemberton",
          "email": "oakley.pemberton@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Oakley Pemberton",
          "email": "oakley.pemberton@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SBSA-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Kingsley",
          "email": "devon.kingsley@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SBSA-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Xen Yarrow 2",
          "email": "xen.yarrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SBSA-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon UNCorked",
    "shortName": "Simon UNCorked",
    "acronym": null,
    "code": "SU",
    "slug": "simon-uncorked",
    "legacySlug": "uncorked",
    "category": "SOCIAL",
    "note": null,
    "advisors": [
      {
        "name": "Avery Fairbank",
        "email": "avery.fairbank@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Rowan Ellery",
        "email": "rowan.ellery@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SU-PRES",
        "holder": {
          "name": "Wren Kingsley 2",
          "email": "wren.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Rowan Underhill 2",
          "email": "rowan.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SU-VP-FINA-OPER",
        "holder": {
          "name": "Logan Ellery",
          "email": "logan.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Fairbank",
          "email": "parker.fairbank@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SU-VP-MARK-COMM",
        "holder": {
          "name": "Oakley Bellweather",
          "email": "oakley.bellweather@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Noor Carrow",
          "email": "noor.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SU-VP-EVEN-PART",
        "holder": {
          "name": "Indigo Kingsley 2",
          "email": "indigo.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Yuki Merritt",
          "email": "yuki.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SU-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Wren Kingsley 2",
          "email": "wren.kingsley@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SU-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Blake Oleander",
          "email": "blake.oleander@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SU-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Sports",
    "shortName": "Simon Sports",
    "acronym": null,
    "code": "SIMSPO",
    "slug": "simon-sports",
    "legacySlug": "simon-sports-club",
    "category": "SOCIAL",
    "note": null,
    "advisors": [
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SIMSPO-PRES",
        "holder": {
          "name": "Quinn Lonsdale",
          "email": "quinn.lonsdale@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Finley Bellweather",
          "email": "finley.bellweather@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SIMSPO-VP-EVEN-PART",
        "holder": {
          "name": "Marlow Ellery",
          "email": "marlow.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Gray Hollis",
          "email": "gray.hollis@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "SIMSPO-VP-FINA-OPER",
        "holder": {
          "name": "Tatum Merritt",
          "email": "tatum.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Underhill 4",
          "email": "kai.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SIMSPO-VP-MARK-COMM",
        "holder": {
          "name": "Noor Sterling",
          "email": "noor.sterling@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Bellweather",
          "email": "parker.bellweather@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SIMSPO-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Jessup",
          "email": "vale.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SIMSPO-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Umber Ingram 2",
          "email": "umber.ingram@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SIMSPO-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Marlow Fairbank",
          "email": "marlow.fairbank@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Simon Gaming Club",
    "shortName": "Simon Gaming Club",
    "acronym": null,
    "code": "SGC",
    "slug": "simon-gaming-club",
    "legacySlug": "gaming-club",
    "category": "SOCIAL",
    "note": null,
    "advisors": [
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": "Oversees Finances",
        "positionCode": "SGC-PRES",
        "holder": {
          "name": "Devon Hollis",
          "email": "devon.hollis@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Marlow Ravensworth",
          "email": "marlow.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "SGC-VP-EVEN-PART",
        "holder": {
          "name": "Zephyr Merritt",
          "email": "zephyr.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Jessup",
          "email": "harper.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "SGC-VP-MARK-COMM",
        "holder": {
          "name": "Parker Jessup",
          "email": "parker.jessup@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Jordan Ingram",
          "email": "jordan.ingram@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Finance and Operations",
        "basePosition": "VP of Finance and Operations",
        "positionNote": null,
        "positionCode": "SGC-VP-FINA-OPER",
        "holder": null,
        "vacancyNote": "Reopen in the fall",
        "predecessor": null
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SGC-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Hollis",
          "email": "devon.hollis@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SGC-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Tatum Ellery",
          "email": "tatum.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SGC-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Says",
    "shortName": "Simon Says",
    "acronym": null,
    "code": "SIMSAY",
    "slug": "simon-says",
    "legacySlug": null,
    "category": "SOCIAL",
    "note": null,
    "advisors": [
      {
        "name": "Logan Yarrow 2",
        "email": "logan.yarrow@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "SIMSAY-PRES",
        "holder": {
          "name": "Finley Yarrow",
          "email": "finley.yarrow@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Ellery 2",
          "email": "parker.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": "Oversees Event Requests",
        "positionCode": "SIMSAY-VP-MARK-COMM",
        "holder": {
          "name": "Quinn Underhill",
          "email": "quinn.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Oakley Sterling",
          "email": "oakley.sterling@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Finance and Operations",
        "basePosition": "VP of Finance and Operations",
        "positionNote": null,
        "positionCode": "SIMSAY-VP-FINA-OPER",
        "holder": {
          "name": "Devon Hollis",
          "email": "devon.hollis@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Hollis 2",
          "email": "devon.hollis@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Events and Partnership",
        "basePosition": "VP of Events and Partnership",
        "positionNote": null,
        "positionCode": "SIMSAY-VP-EVEN-PART",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "SIMSAY-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Marlow Whitlock",
          "email": "marlow.whitlock@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "SIMSAY-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "SIMSAY-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Outdoor Adventure Club",
    "shortName": "Outdoor Adventure Club",
    "acronym": null,
    "code": "OAC",
    "slug": "outdoor-adventure-club",
    "legacySlug": null,
    "category": "SOCIAL",
    "note": null,
    "advisors": [
      {
        "name": "Logan Yarrow 2",
        "email": "logan.yarrow@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": "Oversees Event Requests",
        "positionCode": "OAC-PRES",
        "holder": {
          "name": "Zephyr Ingram",
          "email": "zephyr.ingram@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Underhill 4",
          "email": "kai.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Partnerships",
        "basePosition": "VP Events & Partnerships",
        "positionNote": null,
        "positionCode": "OAC-VP-EVEN-PART",
        "holder": null,
        "vacancyNote": "Will reopen in the fall",
        "predecessor": null
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "OAC-VP-FINA-OPER",
        "holder": {
          "name": "Harper Merritt 2",
          "email": "harper.merritt@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Jordan Thornbury",
          "email": "jordan.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP of Marketing & Communincations",
        "basePosition": "VP of Marketing & Communincations",
        "positionNote": null,
        "positionCode": "OAC-VP-MARK-COMM",
        "holder": {
          "name": "Sage Norwood",
          "email": "sage.norwood@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "1Y MBA Rep",
        "basePosition": "1Y MBA Rep",
        "positionNote": null,
        "positionCode": "OAC-1Y-MBA-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Zephyr Ingram",
          "email": "zephyr.ingram@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MS VP of Events",
        "basePosition": "MS VP of Events",
        "positionNote": null,
        "positionCode": "OAC-MS-VP-EVEN",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MS VP of Relatations and Outreach",
        "basePosition": "MS VP of Relatations and Outreach",
        "positionNote": null,
        "positionCode": "OAC-MS-VP-RELA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Simon Partners & Families",
    "shortName": "Simon Partners & Families",
    "acronym": null,
    "code": "SPF",
    "slug": "simon-partners-and-families",
    "legacySlug": null,
    "category": "SOCIAL",
    "note": "Board formed Fall 2025",
    "advisors": [
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "Liaision 1",
        "basePosition": "Liaision",
        "positionNote": null,
        "positionCode": "SPF-LIAI-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "Liaision 2",
        "basePosition": "Liaision",
        "positionNote": null,
        "positionCode": "SPF-LIAI-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "Liaision 3",
        "basePosition": "Liaision",
        "positionNote": null,
        "positionCode": "SPF-LIAI-3",
        "holder": null,
        "vacancyNote": "",
        "predecessor": null
      }
    ]
  },
  {
    "name": "Graduate Business Council (GBC)",
    "shortName": "Graduate Business Council",
    "acronym": "GBC",
    "code": "GBC",
    "slug": "graduate-business-council",
    "legacySlug": null,
    "category": "ORGANIZATION",
    "note": null,
    "advisors": [
      {
        "name": "Rowan Ellery",
        "email": "rowan.ellery@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Xen Ashford",
        "email": "xen.ashford@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Harper Vance",
        "email": "harper.vance@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Blake Kingsley",
        "email": "blake.kingsley@example.invalid",
        "affiliation": "MBA Faculty Director"
      },
      {
        "name": "Parker Whitlock",
        "email": "parker.whitlock@example.invalid",
        "affiliation": "Benet CMC"
      },
      {
        "name": "Logan Yarrow 2",
        "email": "logan.yarrow@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "GBC-PRES",
        "holder": {
          "name": "Oakley Ashford 2",
          "email": "oakley.ashford@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Ravensworth",
          "email": "parker.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Academic Affairs & Operations",
        "basePosition": "VP Academic Affairs & Operations",
        "positionNote": null,
        "positionCode": "GBC-VP-ACAD-AFFA",
        "holder": {
          "name": "Yuki Kingsley",
          "email": "yuki.kingsley@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Events & Communications 1",
        "basePosition": "VP Events & Communications",
        "positionNote": null,
        "positionCode": "GBC-VP-EVEN-COMM-1",
        "holder": {
          "name": "Quinn Ellery",
          "email": "quinn.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Umber Oleander",
          "email": "umber.oleander@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events & Communications 2",
        "basePosition": "VP Events & Communications",
        "positionNote": null,
        "positionCode": "GBC-VP-EVEN-COMM-2",
        "holder": {
          "name": "Vale Gallant",
          "email": "vale.gallant@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Marlow Whitlock 2",
          "email": "marlow.whitlock@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Benet Center",
        "basePosition": "VP Benet Center",
        "positionNote": null,
        "positionCode": "GBC-VP-BENE-CENT",
        "holder": {
          "name": "Harper Vance 2",
          "email": "harper.vance@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Student Wellbeing & Leadership",
        "basePosition": "VP Student Wellbeing & Leadership",
        "positionNote": null,
        "positionCode": "GBC-VP-STUD-WELL",
        "holder": {
          "name": "Marlow Hollis",
          "email": "marlow.hollis@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "VP Community Enrichment",
        "basePosition": "VP Community Enrichment",
        "positionNote": null,
        "positionCode": "GBC-VP-COMM-ENRI",
        "holder": {
          "name": "Xen Danforth",
          "email": "xen.danforth@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "Liaision for International Students",
        "basePosition": "Liaision for International Students",
        "positionNote": null,
        "positionCode": "GBC-LIAI-INTE-STUD",
        "holder": {
          "name": "Logan Ellery 2",
          "email": "logan.ellery@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": null
      },
      {
        "name": "MBA 1Y Rep - Gold",
        "basePosition": "MBA 1Y Rep - Gold",
        "positionNote": null,
        "positionCode": "GBC-MBA-1Y-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Oakley Ashford 2",
          "email": "oakley.ashford@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "MBA 2Y Rep - Blue",
        "basePosition": "MBA 2Y Rep - Blue",
        "positionNote": null,
        "positionCode": "GBC-MBA-2Y-REP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Yuki Kingsley",
          "email": "yuki.kingsley@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Masters Advisory Council (MAC)",
    "shortName": "Masters Advisory Council",
    "acronym": "MAC",
    "code": "MAC",
    "slug": "masters-advisory-council",
    "legacySlug": null,
    "category": "ORGANIZATION",
    "note": null,
    "advisors": [
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      }
    ],
    "seats": [
      {
        "name": "President",
        "basePosition": "President",
        "positionNote": null,
        "positionCode": "MAC-PRES",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Vale Thornbury 3",
          "email": "vale.thornbury@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Finance & Operations",
        "basePosition": "VP Finance & Operations",
        "positionNote": null,
        "positionCode": "MAC-VP-FINA-OPER",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Ellery",
          "email": "kai.ellery@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Academic Affairs (MSAIB)",
        "basePosition": "VP Academic Affairs (MSAIB)",
        "positionNote": null,
        "positionCode": "MAC-VP-ACAD-AFFA-MSAIB",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Umber Lonsdale",
          "email": "umber.lonsdale@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Academic Affairs (MSBA)",
        "basePosition": "VP Academic Affairs (MSBA)",
        "positionNote": null,
        "positionCode": "MAC-VP-ACAD-AFFA-MSBA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Yuki Hollis",
          "email": "yuki.hollis@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Academic Affairs (MSMA)",
        "basePosition": "VP Academic Affairs (MSMA)",
        "positionNote": null,
        "positionCode": "MAC-VP-ACAD-AFFA-MSMA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Xen Ingram",
          "email": "xen.ingram@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Academic Affairs (MSF)",
        "basePosition": "VP Academic Affairs (MSF)",
        "positionNote": null,
        "positionCode": "MAC-VP-ACAD-AFFA-MSF",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Avery Ravensworth",
          "email": "avery.ravensworth@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Marketing & Communications",
        "basePosition": "VP Marketing & Communications",
        "positionNote": null,
        "positionCode": "MAC-VP-MARK-COMM",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Logan Jessup",
          "email": "logan.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Benet Center & Alumni Relations 1",
        "basePosition": "VP Benet Center & Alumni Relations",
        "positionNote": null,
        "positionCode": "MAC-VP-BENE-CENT-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Emery Yarrow",
          "email": "emery.yarrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Benet Center & Alumni Relations 2",
        "basePosition": "VP Benet Center & Alumni Relations",
        "positionNote": null,
        "positionCode": "MAC-VP-BENE-CENT-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Casey Carrow",
          "email": "casey.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events (MSF)",
        "basePosition": "VP Events (MSF)",
        "positionNote": null,
        "positionCode": "MAC-VP-EVEN-MSF",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Sage Jessup",
          "email": "sage.jessup@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Events (MSBA)",
        "basePosition": "VP Events (MSBA)",
        "positionNote": null,
        "positionCode": "MAC-VP-EVEN-MSBA",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Rowan Quill",
          "email": "rowan.quill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "VP Community Enrichment",
        "basePosition": "VP Community Enrichment",
        "positionNote": null,
        "positionCode": "MAC-VP-COMM-ENRI",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Devon Norwood",
          "email": "devon.norwood@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  },
  {
    "name": "Consortium for Graduate Study in Management (CGSM)",
    "shortName": "Consortium for Graduate Study in Management",
    "acronym": "CGSM",
    "code": "CGSM",
    "slug": "cgsm",
    "legacySlug": null,
    "category": "ORGANIZATION",
    "note": null,
    "advisors": [
      {
        "name": "Kai Underhill 2",
        "email": "kai.underhill@example.invalid",
        "affiliation": "Ainslie OSE"
      },
      {
        "name": "Parker Jessup 2",
        "email": "parker.jessup@example.invalid",
        "affiliation": "OEI"
      }
    ],
    "seats": [
      {
        "name": "1st Year Liaison 1",
        "basePosition": "1st Year Liaison",
        "positionNote": null,
        "positionCode": "CGSM-1ST-YEAR-LIAI-1",
        "holder": {
          "name": "Tatum Underhill 2",
          "email": "tatum.underhill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Indigo Fairbank",
          "email": "indigo.fairbank@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1st Year Liaison 2",
        "basePosition": "1st Year Liaison",
        "positionNote": null,
        "positionCode": "CGSM-1ST-YEAR-LIAI-2",
        "holder": {
          "name": "Harper Vance 2",
          "email": "harper.vance@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Underhill",
          "email": "harper.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "1st Year Liaison 3",
        "basePosition": "1st Year Liaison",
        "positionNote": null,
        "positionCode": "CGSM-1ST-YEAR-LIAI-3",
        "holder": {
          "name": "Oakley Quill",
          "email": "oakley.quill@example.invalid"
        },
        "vacancyNote": "",
        "predecessor": {
          "name": "Finley Merritt",
          "email": "finley.merritt@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "OP Prep",
        "basePosition": "OP Prep",
        "positionNote": null,
        "positionCode": "CGSM-OP-PREP",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Underhill 3",
          "email": "kai.underhill@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Social Media & Events Marketing 1",
        "basePosition": "Social Media & Events Marketing",
        "positionNote": null,
        "positionCode": "CGSM-SOCI-MEDI-EVEN-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Rowan Bellweather",
          "email": "rowan.bellweather@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Social Media & Events Marketing 2",
        "basePosition": "Social Media & Events Marketing",
        "positionNote": null,
        "positionCode": "CGSM-SOCI-MEDI-EVEN-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Parker Vance",
          "email": "parker.vance@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Events 1",
        "basePosition": "Events",
        "positionNote": null,
        "positionCode": "CGSM-EVEN-1",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Wren Fairbank",
          "email": "wren.fairbank@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Events 2",
        "basePosition": "Events",
        "positionNote": null,
        "positionCode": "CGSM-EVEN-2",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Harper Carrow",
          "email": "harper.carrow@example.invalid",
          "term": "2025-2026"
        }
      },
      {
        "name": "Community Service Outreach",
        "basePosition": "Community Service Outreach",
        "positionNote": null,
        "positionCode": "CGSM-COMM-SERV-OUTR",
        "holder": null,
        "vacancyNote": "",
        "predecessor": {
          "name": "Kai Gallant",
          "email": "kai.gallant@example.invalid",
          "term": "2025-2026"
        }
      }
    ]
  }
]
