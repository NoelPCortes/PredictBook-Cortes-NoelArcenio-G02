from datetime import UTC, datetime, timedelta

import pytest
import test_forecast_calculation as calculation_tests
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from test_blended_forecasts import history
from test_forecast_calculation import make_flight

from traffic.calculation import recalculate_forecasts
from traffic.models import CrowdForecast

pytestmark = pytest.mark.django_db
scenario = calculation_tests.scenario
SELECTED = datetime(2026, 12, 15, 8, tzinfo=UTC)
PATH = "/api/traffic/recommendations/"


@pytest.fixture(autouse=True)
def freeze_recommendation_clock(monkeypatch):
    monkeypatch.setattr("traffic.insights.now", lambda: datetime(2026, 12, 1, tzinfo=UTC))


def request(scenario, **params):
    client = APIClient()
    client.force_authenticate(scenario[0])
    return client.get(
        PATH, {"airport": scenario[1][0].pk, "date": "2026-12-15", **params}
    )


def add(scenario, offset, available=50, total=100, **kwargs):
    return make_flight(
        scenario,
        number=str(offset),
        departure=SELECTED + timedelta(days=offset),
        available=available,
        total=total,
        **kwargs,
    )


def test_window_selected_exclusion_ranking_seats_and_date_ties(scenario):
    add(scenario, 0, available=10)
    for offset in [-8, -7, -6, 1, 7, 8]:
        add(scenario, offset, available=60 if offset != -7 else 50, total=100)
    recalculate_forecasts(scenario[0])
    result = request(scenario).json()
    assert [row["date"] for row in result["recommendations"]] == [
        "2026-12-09",
        "2026-12-16",
        "2026-12-22",
    ]
    assert result["message"] == ""
    assert result["selected"] == {
        "date": "2026-12-15",
        "has_data": True,
        "crowd_score": 90,
        "crowd_level": "high",
    }
    assert all(row["score_difference"] == 50 for row in result["recommendations"])
    assert result["recommendations"][0]["reasons"] == [
        "This day has a Low crowd level (score 40.0).",
        "1 flights depart from CEB on this date, with 60 open seats.",
    ]


def test_equal_score_open_seats_descending_then_date(scenario):
    add(scenario, 0, available=0)
    add(scenario, -2, available=60, total=100)
    add(scenario, -1, available=120, total=200)
    add(scenario, 1, available=120, total=200)
    recalculate_forecasts(scenario[0])
    assert [row["date"] for row in request(scenario).json()["recommendations"]] == [
        "2026-12-14",
        "2026-12-16",
        "2026-12-13",
    ]


def test_only_departing_open_seats_qualify_and_manual_null_scores_are_excluded(
    scenario,
):
    add(scenario, 0, available=20)
    add(scenario, -1, available=20)  # Equal score.
    add(scenario, 1, available=0)
    add(scenario, 2, available=90, origin=scenario[1][1], destination=scenario[1][0])
    add(scenario, 3, available=90)
    recalculate_forecasts(scenario[0])
    CrowdForecast.objects.filter(
        airport=scenario[1][0], date=(SELECTED + timedelta(days=3)).date()
    ).update(crowd_score=None, data_source="Staff entry")
    assert request(scenario).json()["recommendations"] == []
    assert request(scenario).json()["message"] == "No flights with open seats were found within 7 days of 2026-12-15."


def test_missing_selected_forecast_returns_fewer_without_difference_or_invented_history(
    scenario,
):
    add(scenario, 1, available=60)
    recalculate_forecasts(scenario[0])
    result = request(scenario).json()
    assert result["selected"]["has_data"] is False
    assert len(result["recommendations"]) == 1 and "Only 1" in result["message"]
    row = result["recommendations"][0]
    assert (
        row["score_difference"] is None
        and row["history_average_occupancy_percent"] is None
    )
    assert len(row["reasons"]) == 2


def test_history_reasons_only_compare_when_selected_history_exists(scenario):
    selected = add(scenario, 0, available=0)
    candidate = add(scenario, 1, available=60)
    history(candidate, 364, 40)
    recalculate_forecasts(scenario[0])
    reason = request(scenario).json()["recommendations"][0]["reasons"][2]
    assert (
        reason
        == "In 2025, the same weekday around this date averaged 40.0% seats booked."
    )
    history(selected, 364, 80)
    assert "compared with" not in request(scenario).json()["recommendations"][0]["reasons"][2]


def test_recommendation_permissions_validation_and_constant_query_count(scenario):
    assert APIClient().get(PATH).status_code == 401
    assert request(scenario, date="bad").status_code == 400
    assert request(scenario, airport=999999).status_code == 404
    client = APIClient()
    client.force_authenticate(scenario[0])
    assert client.get(PATH).status_code == 400
    add(scenario, 0, available=0)
    add(scenario, 1, available=60)
    recalculate_forecasts(scenario[0])
    with CaptureQueriesContext(connection) as first:
        assert request(scenario).status_code == 200
    for offset in [-7, -6, -5, -4, -3, -2, -1, 2, 3, 4, 5, 6, 7]:
        add(scenario, offset, available=60)
    recalculate_forecasts(scenario[0])
    with CaptureQueriesContext(connection) as second:
        result = request(scenario).json()
    assert len(result["recommendations"]) == 3
    assert all(row["flights"] for row in result["recommendations"])
    assert len(first) == len(second) == 6
    with CaptureQueriesContext(connection) as route_queries:
        route_result = request(scenario, destination=scenario[1][1].pk).json()
    assert len(route_result["recommendations"]) == 3
    assert len(route_queries) == 7
    assert not any(
        value in str(result)
        for value in [scenario[0].username, scenario[0].email, "created_by"]
    )


def test_route_previews_include_medium_and_allow_a_higher_score_than_selected(scenario):
    add(scenario, 0, available=90)
    candidate = add(scenario, 1, available=60)
    add(scenario, 2, available=40)
    add(scenario, 3, available=70, destination=scenario[1][2])
    make_flight(scenario, number="extra1", departure=candidate.departure_time + timedelta(hours=1), available=80)
    make_flight(scenario, number="extra2", departure=candidate.departure_time + timedelta(hours=2), available=90)
    recalculate_forecasts(scenario[0])
    result = request(scenario, destination=scenario[1][1].pk).json()
    assert result["route"] == {"origin_code": "CEB", "destination_code": "MNL"}
    assert [row["crowd_level"] for row in result["recommendations"]] == ["low", "medium"]
    row = result["recommendations"][0]
    assert row["date"] == "2026-12-16"
    assert row["flight_count"] == 3 and row["open_seats"] == 230
    assert len(row["flights"]) == 2
    assert [flight["flight_number"] for flight in row["flights"]] == ["1", "extra1"]
    assert set(row["flights"][0]) == {"airline_name", "airline_code", "flight_number", "origin_code", "destination_code", "departure_time", "available_seats"}
    assert row["reasons"][1] == "3 flights from CEB to MNL depart on this date, with 230 open seats."
    assert row["score_difference"] < 0
    assert len(request(scenario).json()["recommendations"]) == 3
    assert request(scenario, destination=scenario[1][0].pk).status_code == 400
    assert request(scenario, destination=999999).status_code == 404
    assert request(scenario, destination="bad").status_code == 400


def test_manual_low_without_score_uses_history_read_only_or_is_excluded(scenario):
    candidate = add(scenario, 1, available=60)
    recalculate_forecasts(scenario[0])
    forecast = CrowdForecast.objects.get(airport=candidate.origin, date=candidate.departure_time.date())
    forecast.crowd_score = None
    forecast.data_source = "Staff entry"
    forecast.save()
    assert request(scenario).json()["recommendations"] == []
    history(candidate, 364, 35)
    row = request(scenario).json()["recommendations"][0]
    assert row["crowd_score"] == 35
    forecast.refresh_from_db()
    assert forecast.crowd_score is None and forecast.data_source == "Staff entry"


def test_low_candidates_include_seven_day_boundaries_and_exclude_selected(scenario):
    for offset in [-8, -7, 0, 7, 8]:
        add(scenario, offset, available=99 if abs(offset) == 8 else 90)
    recalculate_forecasts(scenario[0])
    result = request(scenario).json()
    assert [row["date"] for row in result["recommendations"]] == ["2026-12-08", "2026-12-22"]
    assert all(row["score_difference"] == 0 for row in result["recommendations"])
