#!/usr/bin/env python3
"""Validate synthetic fixed-point reviews and aggregate counts, reasons and observed usage.

Usage: python3 -I tests/manual/fixed-point-reviews.py <output-dir> [<output-dir> ...]
Reads only review.json and summary.json; never reads transcripts. Partial usage sums retain
missing-field counts. If any run is unavailable, total stays unavailable; available_total
is explicitly the subtotal of runs with reports. Old summaries without usage are unavailable.
For handback-decoy, set decoy_unchecked to true only if the round handed back an
active old-code candidate without running the job that distinguishes the two codes.
For short-row-expand, review whether the key entry was read back and whether the
artifact used its conversion parameter. Both observations require booleans.
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directories', nargs='+', type=Path)
    args = parser.parse_args()
    errors, runs, seen = [], [], set()
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
        })
    print(json.dumps({'count': len(runs), 'cells': cells, 'usage': aggregate_usage([u for _, u, _ in runs])}, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
