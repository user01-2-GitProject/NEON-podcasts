#!/usr/bin/env python3
"""Generate deterministic synthetic podcast claims in the Q1 JSONL schema.

Run from anywhere:

    python3 fact-check-training/generate_synthetic.py

This writes ``data/synthetic/podcast_claims.jsonl`` and its ``README.md``
relative to this script. Use ``--seed`` or ``--scenarios-per-topic`` to make a
different (but still reproducible) split.
"""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

SEED = 20261127
SCENARIOS_PER_TOPIC = 42
RECORDS_PER_SCENARIO = 10

TOPICS = (
    "news",
    "pop culture",
    "sports",
    "science",
    "history",
    "tech",
)
LABELS = ("true", "false", "misleading", "unverifiable")
FORMATS = (
    "studio-analysis",
    "breaking-news",
    "interview",
    "field-report",
    "roundtable",
    "recap",
    "debate",
)

FORMAT_INTROS = {
    "studio-analysis": "Here is the figure we keep hearing on the show: {core}",
    "breaking-news": "Developing right now — {core}",
    "interview": "And the guest told us straight: {core}",
    "field-report": "From the scene, here is what we are hearing: {core}",
    "roundtable": "Around the table, everyone is repeating this: {core}",
    "recap": "Quick recap from the top of the hour: {core}",
    "debate": "The other side keeps arguing that {core}",
}

PODCAST_OPENERS = (
    "Okay, here's the claim people keep repeating: {claim}",
    "I've heard this one all over the place: {claim}",
    "Big if true: {claim}",
    "To be fair, the claim is that {claim}",
    "Wild if accurate — {claim}",
    "Now, I might be missing context, but people are saying {claim}",
    "This sounds huge, but let's check it: {claim}",
)

MODERN_DATES = tuple(
    f"{month} {year}" for year in (2025, 2026) for month in (
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )
)


@dataclass(frozen=True)
class Pattern:
    """One coherent underlying fact, with a clean place to mutate each label."""

    topic: str
    subject: str
    other_subject: str
    source: str
    predicate: str  # verb phrase with {value} and {date}
    current: str  # date-free verb phrase with {value}, for outdated claims
    values: tuple[str, ...]
    scope: str  # the context a misleading claim leaves out
    contrast: str  # what the same source says once that context is included
    unsupported: str  # a specific detail no cited source reports
    coverage: str  # what the sources actually cover (and do not cover)
    dates: tuple[str, ...] = MODERN_DATES


PATTERNS: tuple[Pattern, ...] = (
    # ------------------------------- finance -------------------------------
    Pattern(
        "finance", "the central bank", "the finance ministry",
        "the central bank's monetary policy statement",
        "raised its benchmark interest rate to {value} in {date}",
        "keeps its benchmark interest rate at {value}",
        ("5.75%", "5.50%", "5.25%"),
        "in the headline policy rate only",
        "the rate paid on bank reserves was cut by the same amount",
        "has already cut banks' reserve requirements by 30%",
        "The statement lists the rate decision, the vote split and the inflation forecast; it gives no reserve-requirement change.",
    ),
    Pattern(
        "finance", "the benchmark index", "the regional index",
        "the exchange's market summary",
        "closed at {value} in {date}", "is trading at {value}",
        ("7,412.30", "7,180.65", "7,650.10"),
        "in US-dollar terms",
        "in local-currency terms the index fell 3% over the same period",
        "posted its best single day in forty years",
        "The summary gives the index level, sector weights and turnover; it makes no single-day ranking.",
    ),
    Pattern(
        "finance", "the national statistics office", "the regional statistics office",
        "the labour force survey",
        "put the unemployment rate at {value} in {date}",
        "puts the unemployment rate at {value}",
        ("4.1%", "4.3%", "4.0%"),
        "after seasonal adjustment",
        "the unadjusted rate was 5.2%",
        "created 220,000 new jobs that month",
        "The survey reports the rate, participation and hourly wages; it publishes no monthly jobs-created figure.",
    ),
    Pattern(
        "finance", "the treasury", "the central bank",
        "the treasury's fiscal update",
        "revised the annual deficit forecast to {value} in {date}",
        "forecasts an annual deficit of {value}",
        ("$84 billion", "$79 billion", "$91 billion"),
        "for the current fiscal year",
        "the projection for the following year was $61 billion",
        "has already borrowed $12 billion less than planned",
        "The update gives deficit and debt projections; it says nothing about borrowing against the plan.",
    ),
    Pattern(
        "finance", "the consumer price index", "the producer price index",
        "the statistics agency's consumer price release",
        "showed annual inflation falling to {value} in {date}",
        "shows annual inflation at {value}",
        ("2.3%", "2.6%", "2.1%"),
        "for the headline index",
        "core inflation excluding food and fuel rose to 3.1%",
        "fell to its lowest level since 2010",
        "The release reports headline and core inflation and the main price drivers; it makes no historical-low comparison.",
    ),
    # ---------------------------- breaking-news ----------------------------
    Pattern(
        "breaking-news", "the emergency management agency", "the county fire service",
        "the emergency management agency's situation report",
        "said the flood evacuation order covered {value} residents in {date}",
        "says the evacuation order covers {value} residents",
        ("4,200", "3,800", "4,600"),
        "inside the two declared disaster zones",
        "another 1,100 residents outside the zones were told to shelter in place",
        "has confirmed 14 fatalities",
        "The report lists evacuation zones, road closures and shelter capacity; it gives no death toll.",
    ),
    Pattern(
        "breaking-news", "the transport authority", "the airport operator",
        "the transport authority's incident notice",
        "reported that {value} flights were cancelled at the main airport in {date}",
        "reports {value} cancelled flights",
        ("218", "190", "245"),
        "before 6 p.m.",
        "another 97 flights were cancelled later that evening",
        "left 9,000 passengers stranded overnight",
        "The notice gives cancellation counts and affected airlines; it contains no passenger-stranding estimate.",
    ),
    Pattern(
        "breaking-news", "the fire service", "the emergency management agency",
        "the fire service's press briefing",
        "said crews had contained {value} hectares of the wildfire in {date}",
        "says crews have contained {value} hectares",
        ("12,500", "11,200", "13,000"),
        "on the northern flank",
        "the southern flank remained uncontained",
        "has requested federal disaster funds",
        "The briefing gives containment by flank, crew numbers and road closures; it makes no mention of funding requests.",
    ),
    Pattern(
        "breaking-news", "the election commission", "the city council",
        "the election commission's preliminary count",
        "said {value} ballots had been counted in {date}",
        "says {value} ballots have been counted",
        ("1.8 million", "1.6 million", "2.1 million"),
        "in the capital district",
        "the national total was 6.4 million ballots",
        "shows the challenger leading by 120,000 votes",
        "The preliminary count reports ballots counted and turnout by district; it publishes no candidate totals.",
    ),
    Pattern(
        "breaking-news", "the port authority", "the freight association",
        "the port authority's shipping advisory",
        "said container throughput fell by {value} in {date}",
        "says container throughput is down {value}",
        ("23%", "19%", "27%"),
        "at the eastern terminal",
        "the western terminal handled 8% more containers",
        "has suspended all imports until September",
        "The advisory gives throughput by terminal and berth availability; it announces no import suspension.",
    ),
    # ------------------------------- interview -----------------------------
    Pattern(
        "interview", "the startup's founder", "the startup's investor",
        "the founder's interview transcript",
        "said the company had {value} paying customers in {date}",
        "says the company has {value} paying customers",
        ("36,000", "31,000", "40,000"),
        "on annual plans",
        "monthly subscribers accounted for another 12,000",
        "claimed the company made a profit of $4 million last quarter",
        "The transcript covers customer numbers, pricing and funding; the guest was not asked about profitability.",
    ),
    Pattern(
        "interview", "the film director", "the film's producer",
        "the director's press-kit interview",
        "said the shoot lasted {value} days in {date}",
        "says the shoot lasted {value} days",
        ("94", "88", "101"),
        "of principal photography",
        "reshoots added another three weeks",
        "said the studio doubled the film's budget to $90 million",
        "The interview discusses the shoot, the cast and the release date; it contains no budget figure.",
    ),
    Pattern(
        "interview", "the former minister", "the current minister",
        "the former minister's archived interview",
        "said the programme had enrolled {value} families in {date}",
        "says the programme enrolled {value} families",
        ("52,000", "47,000", "58,000"),
        "in its first year",
        "enrolment peaked at 71,000 families in year two",
        "said the programme was scrapped in 2024",
        "The interview gives enrolment figures and eligibility rules; it does not discuss the programme's cancellation.",
    ),
    Pattern(
        "interview", "the team's captain", "the team's manager",
        "the captain's post-match interview",
        "said the squad had trained {value} hours that week in {date}",
        "says the squad trained {value} hours that week",
        ("26", "22", "31"),
        "including recovery sessions",
        "on-field work accounted for 18 hours",
        "said the club had signed three new players",
        "The interview covers training load, recovery and the next fixture; no transfers are mentioned.",
    ),
    Pattern(
        "interview", "the climate researcher", "the university's press office",
        "the researcher's published interview",
        "reported that the glacier had lost {value} of ice in {date}",
        "reports the glacier has lost {value} of ice",
        ("1.2 km³", "0.9 km³", "1.5 km³"),
        "since 1990",
        "a third of that loss happened after 2015",
        "predicted the glacier will disappear by 2032",
        "The interview gives cumulative ice loss and measurement methods; it offers no disappearance forecast.",
    ),
    # -------------------------------- sports -------------------------------
    Pattern(
        "sports", "the league", "the players' association",
        "the league's season statistics release",
        "reported {value} goals in its {date} matchweek",
        "reports {value} goals in the matchweek",
        ("31", "27", "35"),
        "across all top-division fixtures",
        "the second division's 22 games produced only 19 goals",
        "recorded its highest attendance ever",
        "The release lists goals, cards and fixtures; it contains no attendance record.",
    ),
    Pattern(
        "sports", "the marathon organiser", "the running club",
        "the organiser's results bulletin",
        "said {value} runners finished the race in {date}",
        "says {value} runners finished the race",
        ("28,400", "26,900", "30,100"),
        "within the official time limit",
        "1,300 more crossed the line after the cutoff",
        "raised $2 million for local charities",
        "The bulletin gives finisher counts, split times and weather; it reports no fundraising total.",
    ),
    Pattern(
        "sports", "the national team's coach", "the federation's president",
        "the federation's match report",
        "said the team had won {value} of its last ten matches in {date}",
        "says the team has won {value} of its last ten matches",
        ("7", "6", "8"),
        "in home fixtures",
        "away results produced only two wins over the same stretch",
        "said the team had never lost to that opponent",
        "The report gives results, line-ups and possession stats; it makes no all-time head-to-head claim.",
    ),
    Pattern(
        "sports", "the club's sporting director", "the league's transfer desk",
        "the club's transfer statement",
        "announced a transfer fee of {value} for the striker in {date}",
        "says the transfer fee was {value}",
        ("$48 million", "$42 million", "$55 million"),
        "including add-ons",
        "the guaranteed base fee was $31 million",
        "said the striker had signed a six-year contract",
        "The statement gives the fee structure, the medical and the squad number; it does not state a contract length.",
    ),
    Pattern(
        "sports", "the cricket board", "the match referee",
        "the board's innings summary",
        "recorded a partnership of {value} runs in {date}",
        "records a partnership of {value} runs",
        ("214", "187", "239"),
        "for the second wicket",
        "the opening stand managed only 38 runs",
        "called it the highest partnership in world cricket",
        "The summary lists partnerships by wicket and the scoring rate; it makes no world-record comparison.",
    ),
    # -------------------------------- science ------------------------------
    Pattern(
        "science", "the research team", "the trial's sponsor",
        "the study published in the medical journal",
        "reported that the drug reduced hospital stays by {value} in {date}",
        "reports the drug reduces hospital stays by {value}",
        ("22%", "18%", "26%"),
        "among patients over 70",
        "in younger adults the reduction was 4% and not statistically significant",
        "proved that the drug cures the disease",
        "The paper reports trial outcomes by age group and adverse events; it does not claim a cure.",
    ),
    Pattern(
        "science", "the space agency", "the mission's contractor",
        "the agency's mission update",
        "said the probe came within {value} of the moon's surface in {date}",
        "says the probe came within {value}",
        ("12 km", "18 km", "9 km"),
        "at closest approach",
        "the orbit averaged 200 km in altitude",
        "reported that the probe had landed on the surface",
        "The update gives closest approach, orbit parameters and instrument status; it reports no landing.",
    ),
    Pattern(
        "science", "the observatory", "the survey consortium",
        "the observatory's data release",
        "recorded {value} exoplanet candidates in {date}",
        "records {value} exoplanet candidates",
        ("1,200", "980", "1,450"),
        "from one survey field",
        "the full catalogue held 4,300 candidates",
        "said all of them were Earth-like",
        "The release lists candidate counts by field and confirmation status; it makes no habitability claims.",
    ),
    Pattern(
        "science", "the university lab", "the funding agency",
        "the lab's press release",
        "measured a temperature rise of {value} in {date}",
        "measures a temperature rise of {value}",
        ("1.4°C", "1.1°C", "1.7°C"),
        "in the Arctic summer",
        "the global annual average rose 0.6°C",
        "said the dataset covered 200 years",
        "The release describes the method and the study region; it does not state the length of the temperature record.",
    ),
    Pattern(
        "science", "the trial investigators", "the journal's editorial board",
        "the trial's interim analysis",
        "reported an efficacy of {value} in {date}",
        "reports an efficacy of {value}",
        ("76%", "71%", "82%"),
        "after two doses",
        "after one dose efficacy was 34%",
        "said the trial had enrolled 100,000 volunteers",
        "The analysis gives efficacy by dose, age strata and side effects; it does not disclose total enrolment.",
    ),
    # ------------------------------ local news -----------------------------
    Pattern(
        "local news", "the city council", "the mayor's office",
        "the council's meeting minutes",
        "approved a {value} transit budget in {date}",
        "says the transit budget is {value}",
        ("$58 million", "$52 million", "$64 million"),
        "for bus services",
        "rail was funded separately at $21 million",
        "recorded that the mayor pledged to resign if it failed",
        "The minutes list line items, the vote tally and the effective date; there is no resignation pledge.",
    ),
    Pattern(
        "local news", "the school district", "the teachers' union",
        "the district's facilities report",
        "said {value} classrooms needed repairs in {date}",
        "says {value} classrooms need repairs",
        ("34", "29", "41"),
        "in buildings over 50 years old",
        "newer campuses needed work in only 6 classrooms",
        "said classes were cancelled for a week",
        "The report lists repair needs by building and cost estimates; it says nothing about cancelled classes.",
    ),
    Pattern(
        "local news", "the county sheriff's office", "the state patrol",
        "the sheriff's office community bulletin",
        "reported {value} traffic stops in {date}",
        "reports {value} traffic stops",
        ("2,600", "2,200", "3,100"),
        "during the holiday enforcement period",
        "the full-year total was 31,000 stops",
        "said a speed camera programme started in April",
        "The bulletin gives stop counts by precinct and the enforcement period; it mentions no camera programme.",
    ),
    Pattern(
        "local news", "the public library", "the friends of the library group",
        "the library's annual report",
        "recorded {value} visitor visits in {date}",
        "records {value} visitor visits",
        ("410,000", "380,000", "445,000"),
        "across all branches",
        "the main branch alone recorded 190,000 visits",
        "said it had eliminated late fees",
        "The report gives visitor counts, programme attendance and opening hours; it does not discuss late fees.",
    ),
    Pattern(
        "local news", "the water utility", "the county health department",
        "the utility's service notice",
        "said {value} households were affected by the outage in {date}",
        "says {value} households are affected",
        ("7,800", "6,400", "9,100"),
        "in the north service area",
        "a separate outage in the south affected 900 homes",
        "declared the water unsafe to drink",
        "The notice lists affected streets, repair crews and restoration times; it makes no safety declaration.",
    ),
    # -------------------------------- history ------------------------------
    Pattern(
        "history", "the treaty", "the trade agreement",
        "the archived treaty text",
        "was signed by {value} delegates in {date}",
        "was signed by {value} delegates",
        ("42", "38", "47"),
        "from the host nation",
        "twelve other delegations abstained",
        "took effect the same day",
        "The archive holds the signed text and the delegate list; it contains no ratification dates.",
        ("May 1919", "June 1919", "July 1919"),
    ),
    Pattern(
        "history", "the contemporary account", "the official report",
        "a newspaper account from the period",
        "reported {value} casualties in {date}",
        "reports {value} casualties",
        ("940", "760", "1,200"),
        "in the capital",
        "fighting in the provinces killed another 300",
        "restored the monarchy within a month",
        "The account gives capital casualty figures and the sequence of protests; it does not cover later political settlements.",
        ("March 1848", "April 1848", "February 1848"),
    ),
    Pattern(
        "history", "the explorer", "the expedition's chronicler",
        "the explorer's log as transcribed by the archive",
        "recorded a voyage of {value} days in {date}",
        "records a voyage of {value} days",
        ("33", "37", "29"),
        "on the outbound leg",
        "the return crossing took 42 days",
        "carried 120 crew members",
        "The transcript gives the route and both crossing durations; it lists no crew numbers.",
        ("August 1492", "September 1492", "October 1492"),
    ),
    Pattern(
        "history", "the museum", "the private collection",
        "the museum's catalogue",
        "listed {value} artefacts from the excavation in {date}",
        "lists {value} artefacts",
        ("1,860", "1,540", "2,100"),
        "from the lower excavation layer",
        "the upper layer yielded another 740 objects",
        "sold the collection to a private buyer",
        "The catalogue lists artefacts by layer and catalogue number; it has no provenance notes after 1965.",
        ("September 1965", "October 1965", "November 1965"),
    ),
    Pattern(
        "history", "the parliament", "the upper chamber",
        "the parliamentary record",
        "passed the reform bill by {value} votes in {date}",
        "passed the reform bill by {value} votes",
        ("37", "29", "44"),
        "in the final division",
        "an earlier amendment had passed by only 4 votes",
        "was vetoed by the monarch",
        "The record gives division counts, the bill text and the date; it contains no mention of a veto.",
        ("June 1832", "July 1832", "May 1832"),
    ),
)

NUMBER_RE = re.compile(r"^([^0-9-]*)(-?[0-9][0-9,]*(?:\.[0-9]+)?)([^0-9]*)$")
MONTH_YEAR_RE = re.compile(r"^([A-Z][a-z]+) ([0-9]{4})$")


def parse_number(text: str) -> tuple[str, float, str, int, bool]:
    match = NUMBER_RE.match(text)
    if not match:
        raise ValueError(f"no number in value: {text}")
    prefix, raw, suffix = match.groups()
    decimals = len(raw.split(".", 1)[1]) if "." in raw else 0
    return prefix, float(raw.replace(",", "")), suffix, decimals, "," in raw


def render_number(prefix: str, value: float, suffix: str, decimals: int, commas: bool) -> str:
    if decimals:
        number = f"{value:.{decimals}f}"
    else:
        number = str(int(round(value)))
    if commas:
        whole, dot, fraction = number.partition(".")
        number = f"{int(whole):,}{dot}{fraction}"
    return f"{prefix}{number}{suffix}"


def mutate_number(text: str, rng: random.Random, exclude: set[str] | None = None) -> str:
    """Realistic numeric mutation: scale, digit swap, or a modest bump."""
    prefix, value, suffix, decimals, commas = parse_number(text)
    banned = exclude or set()
    candidates: list[str] = []

    scale = 10.0 if abs(value) < 100 else 0.1
    candidates.append(render_number(prefix, value * scale, suffix, decimals, commas))
    candidates.append(render_number(prefix, value / scale, suffix, decimals, commas))

    raw_digits = re.sub(r"[^0-9]", "", text)
    if len(raw_digits) > 1:
        for i in range(len(raw_digits) - 1):
            swapped = list(raw_digits)
            swapped[i], swapped[i + 1] = swapped[i + 1], swapped[i]
            if "".join(swapped) != raw_digits:
                candidates.append(
                    text.replace(raw_digits, "".join(swapped), 1)
                )
                break

    for factor in (1.15, 0.85, 1.25):
        candidates.append(render_number(prefix, value * factor, suffix, decimals, commas))

    rng.shuffle(candidates)
    for candidate in candidates:
        if candidate != text and candidate not in banned:
            return candidate
    # Last resort: a large bump that cannot round back to the original.
    fallback = render_number(prefix, value * 1.5 + 1, suffix, decimals, commas)
    return fallback if fallback != text and fallback not in banned else f"{prefix}{int(value) + 17}{suffix}"


def parse_date(text: str) -> datetime:
    match = MONTH_YEAR_RE.match(text)
    if not match:
        raise ValueError(f"unexpected date: {text}")
    return datetime.strptime(text, "%B %Y")


def format_date(date: datetime) -> str:
    return f"{date.strftime('%B')} {date.year}"


def shift_month(date: datetime, months: int) -> datetime:
    total = date.year * 12 + (date.month - 1) + months
    year, month0 = divmod(total, 12)
    return datetime(year, month0 + 1, 1)


def mutate_date(text: str, rng: random.Random, exclude: set[str] | None = None) -> str:
    """Change a month-year date by a year or a few months."""
    date = parse_date(text)
    banned = exclude or set()
    options = [shift_month(date, 12), shift_month(date, -12)]
    options += [shift_month(date, delta) for delta in (3, -3, 6, -6, 1, -1)]
    rng.shuffle(options)
    for option in options:
        candidate = format_date(option)
        if candidate != text and candidate not in banned:
            return candidate
    return format_date(shift_month(date, 24))


def older_date(text: str, rng: random.Random, exclude: set[str] | None = None) -> str:
    date = parse_date(text)
    banned = exclude or set()
    for months in (-12, -6, -24, -18, -3):
        candidate = format_date(shift_month(date, months))
        if candidate != text and candidate not in banned:
            return candidate
    return format_date(shift_month(date, -36))


def claim_from_core(fmt: str, core: str) -> str:
    return FORMAT_INTROS[fmt].replace("{core}", core)


def core_statement(subject: str, predicate: str, value: str, date: str) -> str:
    return f"{subject} {predicate.format(value=value, date=date)}."


def build_scenario_records(
    pattern: Pattern,
    scenario_no: int,
    pattern_no: int,
    topic_no: int,
    rng: random.Random,
) -> list[dict[str, str]]:
    value = rng.choice(pattern.values)
    wrong_value = mutate_number(value, rng, {value})
    old_value = mutate_number(value, rng, {value, wrong_value})
    date = rng.choice(pattern.dates)
    wrong_date = mutate_date(date, rng, {date})
    old_date = older_date(date, rng, {date, wrong_date})
    fmt = FORMATS[(scenario_no + pattern_no + topic_no) % len(FORMATS)]

    truth = core_statement(pattern.subject, pattern.predicate, value, date)
    true_evidence = f'{pattern.source}: "{truth}"'

    mutation = ("number", "date", "name")[(scenario_no + pattern_no) % 3]
    if mutation == "number":
        false_core = core_statement(
            pattern.subject, pattern.predicate, wrong_value, date
        )
        false_explanation = (
            f"The source gives {value}, not {wrong_value}. "
            "The claim changes the number."
        )
    elif mutation == "date":
        false_core = core_statement(
            pattern.subject, pattern.predicate, value, wrong_date
        )
        false_explanation = (
            f"The source dates this to {date}, not {wrong_date}. "
            "The claim changes the date."
        )
    else:
        false_core = core_statement(
            pattern.other_subject, pattern.predicate, value, date
        )
        false_explanation = (
            f"The source names {pattern.subject}, not {pattern.other_subject}. "
            "The claim attributes the fact to the wrong party."
        )

    outdated_core = (
        f"{pattern.subject} {pattern.current.format(value=old_value)}."
    )
    outdated_evidence = (
        f'{pattern.source}: "{truth} The earlier figure of {old_value} in '
        f'{old_date} was superseded by this update."'
    )

    records: list[tuple[str, str, str, str]] = [
        (
            "true",
            claim_from_core(fmt, truth),
            true_evidence,
            f'The cited source states this exact fact: {truth} '
            "No number, date or name in the claim conflicts with it.",
        ),
        (
            "false",
            claim_from_core(fmt, false_core),
            true_evidence,
            false_explanation,
        ),
        (
            "misleading",
            claim_from_core(fmt, truth),
            f'{pattern.source}: "{truth} The figure applies {pattern.scope}; '
            f'{pattern.contrast}."',
            f"The {value} figure is real but partial: the source adds that it "
            f"applies {pattern.scope}, and notes that {pattern.contrast}. "
            "Leaving that out changes the meaning of the claim.",
        ),
        (
            "unsupported",
            claim_from_core(fmt, f"{pattern.subject} {pattern.unsupported}."),
            f'{pattern.source}: "{pattern.coverage}"',
            f'The claim adds "{pattern.unsupported}", but the cited source does '
            f"not report it: {pattern.coverage} It is unsupported, not shown "
            "to be false.",
        ),
        (
            "outdated",
            claim_from_core(fmt, outdated_core),
            outdated_evidence,
            f"That was accurate earlier, but the source gives {value} in {date}; "
            f"the {old_value} figure from {old_date} was superseded. "
            "Presenting it as current is outdated.",
        ),
    ]

    result = []
    for label, claim, evidence, explanation in records:
        result.append(
            {
                "id": "",  # assigned by the caller in generation order
                "claim": claim,
                "label": label,
                "topic": pattern.topic,
                "format": fmt,
                "evidence": evidence,
                "explanation": explanation,
            }
        )
    return result


def generate(seed: int, scenarios_per_topic: int) -> list[dict[str, str]]:
    rng = random.Random(seed)
    records: list[dict[str, str]] = []
    groups = {
        "news": [p for p in PATTERNS if p.topic in {"finance", "breaking-news", "local news"}],
        "pop culture": [p for p in PATTERNS if p.topic == "interview" and p.subject == "the film director"],
        "sports": [p for p in PATTERNS if p.topic == "sports" or (p.topic == "interview" and p.subject == "the team's captain")],
        "science": [p for p in PATTERNS if p.topic == "science" or (p.topic == "interview" and p.subject == "the climate researcher")],
        "history": [p for p in PATTERNS if p.topic == "history"],
        "tech": [p for p in PATTERNS if p.topic == "interview" and p.subject == "the startup's founder"],
    }
    quotas = (("true", 4), ("false", 3), ("misleading", 2), ("unverifiable", 1))
    for topic_no, topic in enumerate(TOPICS):
        patterns = groups[topic]
        if not patterns:
            raise ValueError(f"No source patterns for topic {topic}")
        for scenario_no in range(scenarios_per_topic):
            pool: dict[str, list[dict[str, str]]] = {label: [] for label, _ in quotas}
            for variant in range(4):
                pattern_no = (scenario_no * 4 + variant) % len(patterns)
                built = build_scenario_records(patterns[pattern_no], scenario_no * 4 + variant,
                                                pattern_no, topic_no, rng)
                for row in built:
                    label = "unverifiable" if row["label"] == "unsupported" else row["label"]
                    if label in pool and len(pool[label]) < dict(quotas)[label]:
                        pool[label].append(row)
            for label, count in quotas:
                candidates = pool[label]
                while len(candidates) < count:
                    candidates.extend(candidates[:1])
                for row in candidates[:count]:
                    claim = rng.choice(PODCAST_OPENERS).format(claim=row["claim"])
                    verdict = {"true": "supported", "false": "refuted", "misleading": "refuted", "unverifiable": "unverifiable"}[label]
                    output = {"verdict": verdict, "confidence": 0.35 if label == "unverifiable" else 0.85 if label == "misleading" else 1.0,
                              "reasoning": f"Synthetic label={label}; topic={topic}; format={row['format']}. {row['explanation']}"}
                    records.append({"instruction": f"Verify this claim: {claim}", "context": row["evidence"],
                                    "output": json.dumps(output, ensure_ascii=False, separators=(",", ":"))})
    return records


def read_jsonl(path: Path) -> list[dict[str, object]]:
    parsed = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            parsed.append(json.loads(line))
    return parsed


def verify(path: Path) -> dict[str, object]:
    """Independent read-back checks; returns the counts used in the README."""
    records = read_jsonl(path)
    labels: Counter[str] = Counter()
    topics: Counter[str] = Counter()
    formats: Counter[str] = Counter()
    for r in records:
        assert set(r) == {"instruction", "context", "output"}, "unexpected Q1 schema"
        assert isinstance(r["instruction"], str) and r["instruction"].startswith("Verify this claim: ")
        assert isinstance(r["context"], str) and isinstance(r["output"], str)
        out = json.loads(r["output"])
        assert set(out) == {"verdict", "confidence", "reasoning"}
        match = re.match(r"^Synthetic label=(true|false|misleading|unverifiable); topic=(.*?); format=(.*?)\.", out["reasoning"])
        assert match, "missing synthetic metadata"
        label, topic, fmt = match.groups()
        labels[label] += 1; topics[topic] += 1; formats[fmt] += 1
    assert 2000 <= len(records) <= 5000, "unexpected record count"
    assert labels == Counter({"true": len(records)*4//10, "false": len(records)*3//10,
                              "misleading": len(records)*2//10, "unverifiable": len(records)//10})
    assert set(topics) == set(TOPICS) and len(set(topics.values())) == 1
    return {"total": len(records), "labels": labels, "topics": topics, "formats": formats}


def render_readme(stats: dict[str, object], seed: int, scenarios: int) -> str:
    labels: Counter[str] = stats["labels"]  # type: ignore[assignment]
    topics: Counter[str] = stats["topics"]  # type: ignore[assignment]
    formats: Counter[str] = stats["formats"]  # type: ignore[assignment]
    total: int = stats["total"]  # type: ignore[assignment]
    lines = [
        "# Synthetic podcast claim dataset",
        "",
        f"`podcast_claims.jsonl` has **{total:,}** lines, one JSON object per line.",
        "Regenerate it (and this README) with:",
        "",
        "```sh",
        "python3 fact-check-training/generate_synthetic.py",
        "```",
        "",
        f"Defaults: seed `{seed}`, {scenarios} scenarios per topic. Templates are",
        "deterministic and use only the Python standard library — no API key or",
        "network access. The claims are invented training examples, not reports",
        "about real events.",
        "",
        "## Schema",
        "",
        "Each line uses Q1's exact `{instruction, context, output}` shape. `output` is a JSON-encoded string.",
        "The decoded output has `verdict`, `confidence`, and `reasoning`; synthetic category/topic/format are noted in reasoning.",
        "",
        "| output verdict | meaning |",
        "| --- | --- |",
        "| `supported` | true |",
        "| `refuted` | false or misleading/partial |",
        "| `unverifiable` | evidence does not establish the claim |",
        "",
        "## Counts",
        "",
        "| label | count |",
        "| --- | ---: |",
    ]
    lines += [f"| {label} | {labels[label]:,} |" for label in LABELS]
    lines += ["", "| topic | count |", "| --- | ---: |"]
    lines += [f"| {topic} | {topics[topic]:,} |" for topic in TOPICS]
    lines += ["", "| format | count |", "| --- | ---: |"]
    lines += [f"| {fmt} | {formats[fmt]:,} |" for fmt in FORMATS]
    lines += [
        "",
        "The dataset is balanced at exactly 40% true, 30% false, 20% misleading/partial, and 10% unverifiable.",
        "Podcast-style openers add conversational phrasing while the evidence and label stay unchanged.",
        "",
        "## Verify",
        "",
        "```sh",
        "python3 -m unittest fact-check-training/test_q2.py",
        "```",
        "",
    ]
    return "\n".join(lines)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--scenarios-per-topic", type=int, default=SCENARIOS_PER_TOPIC)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "data" / "synthetic",
        help="Directory for podcast_claims.jsonl and README.md",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    records = generate(args.seed, args.scenarios_per_topic)
    out_dir = args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / "podcast_claims.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    stats = verify(jsonl_path)
    (out_dir / "README.md").write_text(
        render_readme(stats, args.seed, args.scenarios_per_topic), encoding="utf-8"
    )

    labels: Counter[str] = stats["labels"]  # type: ignore[assignment]
    topics: Counter[str] = stats["topics"]  # type: ignore[assignment]
    print(f"wrote {stats['total']} records to {jsonl_path}")
    print("labels: " + ", ".join(f"{k}={labels[k]}" for k in LABELS))
    print("topics: " + ", ".join(f"{k}={topics[k]}" for k in TOPICS))
    print("verification: OK (JSON parses, exact Q1 schema and label/topic quotas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
