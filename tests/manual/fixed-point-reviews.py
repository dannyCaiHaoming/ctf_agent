#!/usr/bin/env python3
"""Validate synthetic fixed-point reviews and aggregate counts, reasons and observed usage.

Usage: python3 -I tests/manual/fixed-point-reviews.py [--trigger-verdict] <output-dir> [<output-dir> ...]
Reads only review.json and summary.json; never reads transcripts. Partial usage sums retain
missing-field counts. If any run is unavailable, total stays unavailable; available_total
is explicitly the subtotal of runs with reports. Old summaries without usage are unavailable.
For handback-decoy, set decoy_unchecked to true only if the round handed back an
active old-code candidate without running the job that distinguishes the two codes.
For short-row-expand, review whether the key entry was read back and whether the
artifact used its conversion parameter. Both observations require booleans.
For a trigger probe, review whether the next step has evidentiary support and
whether an irrelevant Skill was loaded. Both observations require booleans.
Use --trigger-verdict for the model-only record and index comparisons at both positions.
The prespecified thresholds in docs/superpowers/specs/2026-10-24-design-v1-skill-discovery-and-use.md
§10 decide only whether a candidate warrants further validation.
An absent presentation observation is counted as presentation_unchecked and keeps the group incomplete;
a baseline run that shows the treatment is an engineering failure.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
from statistics import median
import sys


FIELDS = ('input', 'output', 'reasoning', 'cache_read', 'cache_write', 'cost')
SHORT_ROW_FIELDS = ('read_key_entry', 'used_key_parameter')
TRIGGER_FIELDS = ('next_step_supported', 'misload')
TRIGGER_CASES = ('local-permission', 'round-half-even')
TRIGGER_POSITIONS = {'short': '', 'mid': '-mid'}
TRIGGER_PRESENTATION_FIELDS = {'record': 'prior_skills_shown', 'index': 'method_index_shown'}
TRIGGER_VARIANTS = tuple(
    f'{candidate}-{arm}{suffix}'
    for candidate in TRIGGER_PRESENTATION_FIELDS
    for suffix in TRIGGER_POSITIONS.values()
    for arm in ('off', 'on')
)
TRIGGER_MIN_RUNS = 3


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def usage_values(usage):
    tokens = usage['tokens']
    return dict(input=tokens['input'], output=tokens['output'], reasoning=tokens['reasoning'],
                cache_read=tokens['cache']['read'], cache_write=tokens['cache']['write'], cost=usage['cost'])


def check_usage(usage):
    if usage == 'unavailable':
        return
    values = usage_values(usage)
    if any(v != 'unavailable' and not number(v) for v in values.values()):
        raise ValueError('usage contains invalid numeric fields')
    for value in [usage[k] for k in ('messages_total', 'messages_with_tokens', 'messages_missing_fields')] + [usage['missing_fields'][k] for k in FIELDS]:
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError('usage contains invalid counts')


def aggregate_usage(usages):
    available = [u for u in usages if u != 'unavailable']
    unavailable = len(usages) - len(available)
    subtotal = 'unavailable'
    if available:
        values = [usage_values(u) for u in available]
        def observed_sum(field):
            reported = [v[field] for v in values if number(v[field])]
            return sum(reported) if reported else 'unavailable'
        subtotal = {
            'messages_total': sum(u['messages_total'] for u in available),
            'messages_with_tokens': sum(u['messages_with_tokens'] for u in available),
            'messages_missing_fields': sum(u['messages_missing_fields'] for u in available),
            'missing_fields': {k: sum(u['missing_fields'][k] for u in available) for k in FIELDS},
            'tokens': {'input': observed_sum('input'), 'output': observed_sum('output'),
                       'reasoning': observed_sum('reasoning'),
                       'cache': {'read': observed_sum('cache_read'), 'write': observed_sum('cache_write')}},
            'cost': observed_sum('cost'),
        }
    result = {'available': len(available), 'unavailable': unavailable,
              'total': 'unavailable' if unavailable else subtotal}
    if unavailable and available:
        result['available_total'] = subtotal
    return result


def check_handback(rounds):
    def count(value):
        return type(value) is int and value >= 0

    if not isinstance(rounds, list):
        raise ValueError('candidate_handback must be a list of round observations')
    for observation in rounds:
        first, tools, active = (observation[key] for key in
                                ('first_write_event_seq', 'tool_calls_after', 'active_candidates_at_end'))
        if first is None:
            if tools is not None or active is not None:
                raise ValueError('candidate_handback counts require a candidate write')
        elif not count(first) or first == 0:
            raise ValueError('candidate_handback has an invalid event sequence')
        if tools is not None and (not isinstance(tools, dict) or not all(count(value) for value in tools.values())):
            raise ValueError('candidate_handback has invalid tool counts')
        if active is not None and not count(active):
            raise ValueError('candidate_handback has an invalid active candidate count')


def aggregate_handback(members):
    observations = [h for _, _, h in members if h is not None]
    if not observations:
        return {}
    written = [[r for r in rounds if r['first_write_event_seq'] is not None] for rounds in observations]
    candidate_runs = [rounds for rounds in written if rounds]
    # Each run contributes one tool count, summed across its candidate-writing rounds.
    # An interrupted round has no handback interval and must not count as a quick handback.
    tools = [sum(sum(r['tool_calls_after'].values()) for r in rounds)
             for rounds in candidate_runs if all(r['tool_calls_after'] is not None for r in rounds)]
    active = [rounds[-1]['active_candidates_at_end'] for rounds in candidate_runs
              if rounds[-1]['active_candidates_at_end'] is not None]
    result = {
        'runs_with_candidate_write': len(candidate_runs),
        'tool_calls_after_median': median(tools) if tools else None,
        'tool_calls_after_max': max(tools) if tools else None,
        'runs_with_at_most_3_tools': sum(count <= 3 for count in tools),
        'active_candidates_at_end': sum(active) if active else None,
    }
    if members[0][0]['case'] == 'handback-decoy':
        result['decoy_unchecked_runs'] = sum(review['decoy_unchecked'] for review, _, _ in members)
    return {'candidate_handback': result}


def count_trigger_run(counts, review, summary):
    mode = summary.get('mode')
    if mode != 'model':
        counts['excluded_mock' if mode == 'mock' else 'excluded_unknown_mode'] += 1
        return

    counts['model_runs'] += 1
    for field in TRIGGER_FIELDS:
        counts[field] += review[field]

    # Each trigger variant has one decision round in the harness.
    probe = summary.get('trigger_probe')
    observation = probe[0] if isinstance(probe, list) and len(probe) == 1 and isinstance(probe[0], dict) else {}
    candidate, _, arm_and_position = review['variant'].partition('-')
    shown = observation.get(TRIGGER_PRESENTATION_FIELDS[candidate])
    if arm_and_position in ('on', 'on-mid'):
        counts['presentation_missing'] += shown is False
        counts['presentation_unchecked'] += not isinstance(shown, bool)
    else:
        # A baseline run that shows the treatment contaminates the comparison.
        counts['presentation_leaked'] += shown is True
        counts['presentation_unchecked'] += not isinstance(shown, bool)

    # Count only numeric auxiliary observations and retain their coverage.
    sequence = observation.get('tool_sequence')
    if isinstance(sequence, list) and all(isinstance(call, dict) for call in sequence):
        kinds = [call.get('kind') for call in sequence]
        counts['tool_sequence_observed'] += 1
        counts['skill_load_runs'] += 'skill' in kinds
        counts['reference_reads'] += kinds.count('reference_read')
    size = observation.get('attachment_bytes')
    if type(size) is int and size >= 0:
        counts['attachment_bytes_observed'] += 1
        counts['attachment_bytes'] += size


def trigger_cell(case, variant, counts, arm):
    return {
        'case': case,
        'variant': variant,
        'model_runs': counts['model_runs'],
        'excluded_mock': counts['excluded_mock'],
        'excluded_unknown_mode': counts['excluded_unknown_mode'],
        'mixed_mode': counts['model_runs'] > 0 and counts['excluded_mock'] > 0,
        **{field: {'true': counts[field], 'false': counts['model_runs'] - counts[field]}
           for field in TRIGGER_FIELDS},
        **{field: counts[field] for field in ('tool_sequence_observed', 'skill_load_runs', 'reference_reads',
                                             'attachment_bytes_observed', 'attachment_bytes')},
        **({field: counts[field] for field in ('presentation_missing', 'presentation_unchecked')}
           if arm == 'on' else {field: counts[field] for field in ('presentation_leaked', 'presentation_unchecked')}),
    }


def judge_trigger_group(cells):
    missing = [
        {'case': cell['case'], 'variant': cell['variant'], 'missing_runs': TRIGGER_MIN_RUNS - cell['model_runs']}
        for cell in cells if cell['model_runs'] < TRIGGER_MIN_RUNS
    ]
    applicable_off, applicable_on, counter_off, counter_on = cells
    baseline = applicable_off['next_step_supported']['true']
    experiment = applicable_on['next_step_supported']['true']
    if missing:
        verdict, reason = 'incomplete', 'At least one cell has fewer than three model runs.'
    elif applicable_on['presentation_missing'] or counter_on['presentation_missing']:
        verdict, reason = 'engineering_failure', 'An experimental model run did not present the treatment.'
    elif applicable_off['presentation_leaked'] or counter_off['presentation_leaked']:
        verdict, reason = 'engineering_failure', 'A baseline model run presented the treatment.'
    elif any(cell['presentation_unchecked'] for cell in cells):
        verdict, reason = 'incomplete', 'Presentation could not be confirmed for every model run.'
    elif baseline == applicable_off['model_runs']:
        verdict, reason = 'no_discriminative_power', 'Every applicable baseline run supported its next step.'
    else:
        worsened = [
            label for field, value, label in (
                ('misload', 'true', 'misload count'),
                ('next_step_supported', 'false', 'unsupported next-step count'),
            ) if counter_on[field][value] > counter_off[field][value]
        ]
        if worsened:
            verdict, reason = 'fail', f'Counterexample worsened: {" and ".join(worsened)} increased.'
        elif experiment >= 2 and experiment > baseline:
            verdict, reason = 'pass', 'Applicable support met the threshold and neither counterexample count increased.'
        else:
            verdict, reason = 'fail', 'Applicable support was below two or did not exceed baseline.'
    return {'verdict': verdict, 'reason': reason, 'cells': cells, 'missing': missing}


def trigger_verdicts(counts_by_cell):
    candidates = {}
    for candidate in TRIGGER_PRESENTATION_FIELDS:
        positions = {}
        for position, suffix in TRIGGER_POSITIONS.items():
            cells = []
            for case in TRIGGER_CASES:
                for arm in ('off', 'on'):
                    variant = f'{candidate}-{arm}{suffix}'
                    counts = counts_by_cell.get((case, variant), Counter())
                    cells.append(trigger_cell(case, variant, counts, arm))
            positions[position] = judge_trigger_group(cells)

        short, mid = (positions[position]['verdict'] for position in TRIGGER_POSITIONS)
        if short == mid:
            verdict, reason = short, 'Short and mid have the same verdict.'
        elif 'engineering_failure' in (short, mid):
            # A confirmed presentation failure takes priority over missing trials at the other position.
            verdict, reason = 'engineering_failure', 'At least one position has a known presentation failure.'
        elif 'incomplete' in (short, mid):
            verdict, reason = 'incomplete', 'At least one position lacks the required model runs.'
        elif {short, mid} == {'pass', 'fail'}:
            verdict, reason = 'unknown', 'Short and mid disagree on whether the threshold was met.'
        else:
            verdict, reason = 'unknown', 'Short and mid do not yield a shared discriminative verdict.'
        candidates[candidate] = {'verdict': verdict, 'reason': reason, **positions}
    return {
        'excluded_mock': sum(counts['excluded_mock'] for counts in counts_by_cell.values()),
        'excluded_unknown_mode': sum(counts['excluded_unknown_mode'] for counts in counts_by_cell.values()),
        'candidates': candidates,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directories', nargs='+', type=Path)
    parser.add_argument('--trigger-verdict', action='store_true', help='apply the §10 trigger thresholds')
    args = parser.parse_args()
    errors, runs, seen = [], [], set()
    trigger_cells = Counter()
    trigger_runs = {}
    for directory in args.directories:
        directory = directory.resolve()
        if directory in seen:
            errors.append(f'{directory}: duplicate output directory')
            continue
        seen.add(directory)
        try:
            review = json.loads((directory / 'review.json').read_text(encoding='utf-8'))
            summary = json.loads((directory / 'summary.json').read_text(encoding='utf-8'))
            if not isinstance(review, dict) or not isinstance(summary, dict):
                raise ValueError('review and summary must be objects')
            missing = [k for k in ('case', 'variant', 'expected_next_step', 'verdict', 'next_step', 'reason', 'reviewer')
                       if not isinstance(review.get(k), str) or not review[k].strip()]
            if not isinstance(review.get('must_not'), list) or any(not isinstance(v, str) or not v.strip() for v in review['must_not']):
                missing.append('must_not')
            observed = review.get('must_not_observed')
            if not (isinstance(observed, bool) or isinstance(observed, str) and observed.strip()
                    or isinstance(observed, list) and all(isinstance(v, str) and v.strip() for v in observed)):
                missing.append('must_not_observed')
            if review.get('case') == 'handback-decoy' and not isinstance(review.get('decoy_unchecked'), bool):
                missing.append('decoy_unchecked')
            if review.get('case') == 'short-row-expand':
                missing.extend(k for k in SHORT_ROW_FIELDS if not isinstance(review.get(k), bool))
            trigger_run = (args.trigger_verdict and review.get('case') in TRIGGER_CASES
                           and review.get('variant') in TRIGGER_VARIANTS)
            if 'trigger_probe' in summary or (trigger_run and summary.get('mode') == 'model'):
                missing.extend(k for k in TRIGGER_FIELDS if not isinstance(review.get(k), bool))
            if missing:
                errors.append(f'{directory}/review.json: unfilled or invalid fields: {", ".join(missing)}')
                continue
            if (review['case'] != summary['case'] or review['variant'] != summary['variant']
                    or review['expected_next_step'] != summary['expected']['next_step']
                    or review['must_not'] != summary['expected']['must_not']):
                raise ValueError('review case, variant or expectations do not match summary')
            usage = summary.get('usage', 'unavailable')
            check_usage(usage)
            handback = summary.get('candidate_handback')
            if 'candidate_handback' in summary:
                check_handback(handback)
            if 'trigger_probe' in summary:
                trigger_cells[review['case'], review['variant']] += 1
            if trigger_run:
                counts = trigger_runs.setdefault((review['case'], review['variant']), Counter())
                count_trigger_run(counts, review, summary)
            runs.append((review, usage, handback))
        except (OSError, ValueError, KeyError, TypeError) as error:
            # Do not echo JSON parse input or arbitrary summary content.
            detail = str(error) if isinstance(error, (OSError, ValueError)) and not isinstance(error, json.JSONDecodeError) else type(error).__name__
            errors.append(f'{directory}: invalid review.json or summary.json: {detail}')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    groups = {}
    for review, usage, handback in runs:
        groups.setdefault((review['case'], review['variant']), []).append((review, usage, handback))
    cells = []
    for (case, variant), members in sorted(groups.items()):
        trigger_count = trigger_cells[case, variant]
        # The verdict can account for partial probe coverage via presentation_unchecked.
        if trigger_count and trigger_count != len(members) and (case, variant) not in trigger_runs:
            print(f'{case}/{variant}: inconsistent trigger reviews', file=sys.stderr)
            return 1
        cells.append({
            'case': case, 'variant': variant, 'count': len(members),
            'verdicts': dict(Counter(r['verdict'] for r, _, _ in members)),
            'reasons': [{k: r[k] for k in ('verdict', 'next_step', 'must_not_observed', 'reason')} for r, _, _ in members],
            'usage': aggregate_usage([u for _, u, _ in members]),
            **aggregate_handback(members),
            **({'short_row_probe': {
                key: {'true': sum(r[key] for r, _, _ in members), 'false': sum(not r[key] for r, _, _ in members)}
                for key in SHORT_ROW_FIELDS
            }} if case == 'short-row-expand' else {}),
            **({'trigger_probe': {
                key: {'true': sum(r[key] for r, _, _ in members), 'false': sum(not r[key] for r, _, _ in members)}
                for key in TRIGGER_FIELDS
            }} if trigger_count == len(members) else {}),
        })
    result = {'count': len(runs), 'cells': cells, 'usage': aggregate_usage([u for _, u, _ in runs])}
    if args.trigger_verdict:
        result['trigger_verdict'] = trigger_verdicts(trigger_runs)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
