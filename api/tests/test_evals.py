from evals.run import compare, sign_test_p


def test_sign_test_is_one_sided_and_exact() -> None:
    assert sign_test_p(0, 0) == 1.0
    assert sign_test_p(5, 0) == 1 / 32
    assert round(sign_test_p(6, 2), 4) == 0.1445


def _report(errors: list[int], cost: float = 1.0) -> dict:
    return {
        "items": [{"id": f"g{i}", "absError": e} for i, e in enumerate(errors)],
        "summary": {"maeTotal": sum(errors) / len(errors), "costUsd": cost},
    }


def test_one_noisy_item_does_not_block_but_a_broad_regression_does() -> None:
    base = _report([1] * 18)
    assert compare(_report([1] * 17 + [4]), base)["regression"] is False
    broad = compare(_report([3] * 8 + [1] * 10), base)
    assert broad["regression"] is True and broad["worse"] == 8 and broad["better"] == 0


def test_cost_is_reported_as_a_ratio_against_the_baseline() -> None:
    assert compare(_report([1] * 18, cost=3.0), _report([1] * 18, cost=1.0))["costRatio"] == 3.0


def test_cost_model_is_coherent() -> None:
    from evals.cost_model import CACHE_MIN_TOKENS, budget_cap, call_cost, estimate, measure

    shapes = measure(count_tokens=False)
    for s in shapes.values():
        assert call_cost(s, 0, 0.8) <= call_cost(s, 1, 0.8) <= call_cost(s, 2, 0.8)
    # The grader's rubric prefix is long enough to cache; a warm cache is cheaper than a cold one.
    g = shapes["grader"]
    assert g.cached_prefix >= CACHE_MIN_TOKENS
    assert call_cost(g, 1, 1.0) < call_cost(g, 1, 0.0)
    rows = estimate(shapes)
    assert all(r["low"] <= r["likely"] <= r["high"] for r in rows)
    assert budget_cap()["allOutputUsd"] == 2.0
