from datetime import UTC, datetime, timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from flights.models import Airline, Airport, Flight
from traffic.calculation import CALCULATED_SOURCE, flight_totals, recalculate_forecasts
from traffic.models import CrowdForecast

pytestmark = pytest.mark.django_db


@pytest.fixture
def scenario():
    staff = User.objects.create(
        username="calculator", email="calc@example.com", role="staff"
    )
    airports = [
        Airport.objects.create(code=code, name=code, city=code, country="Philippines")
        for code in ("CEB", "MNL", "DVO")
    ]
    airline = Airline.objects.create(name="Test airline", code="TA")
    return staff, airports, airline


def make_flight(
    scenario, number="1", total=100, available=50, departure=None, **kwargs
):
    staff, airports, airline = scenario
    departure = departure or datetime(2026, 12, 1, 23, 30, tzinfo=UTC)
    return Flight.objects.create(
        created_by=staff,
        airline=airline,
        flight_number=number,
        origin=kwargs.pop("origin", airports[0]),
        destination=kwargs.pop("destination", airports[1]),
        departure_time=departure,
        arrival_time=kwargs.pop("arrival_time", departure + timedelta(hours=2)),
        total_seats=total,
        available_seats=available,
        **kwargs,
    )


@pytest.mark.parametrize(
    "booked,level", [(499, "low"), (500, "medium"), (749, "medium"), (750, "high")]
)
def test_threshold_boundaries_and_live_aggregates(scenario, booked, level):
    flight = make_flight(scenario, total=1000, available=1000 - booked)
    recalculate_forecasts(scenario[0])
    record = CrowdForecast.objects.get(airport=flight.origin)
    assert record.crowd_score == booked / 10
    assert record.crowd_level == level
    totals = flight_totals()
    assert totals[(flight.origin_id, flight.departure_time.date())] == {
        "flight_count": 1,
        "seats_total": 1000,
        "seats_booked": booked,
    }
    assert (
        totals[(flight.destination_id, flight.arrival_time.date())]["flight_count"] == 1
    )


def test_departures_and_arrivals_are_combined_once(scenario):
    first = make_flight(scenario)
    make_flight(
        scenario,
        number="2",
        origin=scenario[1][2],
        destination=first.origin,
        departure=first.departure_time - timedelta(hours=3),
        total=200,
        available=20,
    )
    recalculate_forecasts(scenario[0])
    record = CrowdForecast.objects.get(airport=first.origin)
    assert record.crowd_score == 76.7
    assert record.crowd_level == "high"
    assert flight_totals()[(first.origin_id, first.departure_time.date())] == {
        "flight_count": 2,
        "seats_total": 300,
        "seats_booked": 230,
    }


def test_project_timezone_controls_dates(scenario, settings):
    settings.TIME_ZONE = "Asia/Manila"
    flight = make_flight(scenario, departure=datetime(2026, 12, 1, 17, tzinfo=UTC))
    recalculate_forecasts(scenario[0])
    assert set(CrowdForecast.objects.values_list("date", flat=True)) == {
        datetime(2026, 12, 2).date()
    }
    assert (
        flight_totals()[(flight.origin_id, datetime(2026, 12, 2).date())][
            "flight_count"
        ]
        == 1
    )


def test_no_seats_or_no_flights_produces_no_calculated_forecast(scenario):
    make_flight(scenario, total=0, available=0)
    recalculate_forecasts(scenario[0])
    assert not CrowdForecast.objects.exists()


@pytest.mark.parametrize("source", ["Staff entry", "Other dataset", "", None])
def test_manual_forecasts_are_preserved(scenario, source):
    flight = make_flight(scenario)
    manual = CrowdForecast.objects.create(
        airport=flight.origin,
        date=flight.departure_time.date(),
        crowd_level="high",
        crowd_score=99,
        calculated_at=timezone.now(),
        created_by=scenario[0],
        data_source=source,
    )
    before = CrowdForecast.objects.filter(pk=manual.pk).values().get()
    recalculate_forecasts(scenario[0])
    assert CrowdForecast.objects.filter(pk=manual.pk).values().get() == before


def test_idempotence_preserves_original_calculator(scenario):
    make_flight(scenario)
    recalculate_forecasts(scenario[0])
    ids = set(CrowdForecast.objects.values_list("pk", flat=True))
    head = User.objects.create(username="head", email="head@example.com", role="head")
    recalculate_forecasts(head)
    assert set(CrowdForecast.objects.values_list("pk", flat=True)) == ids
    assert all(row.created_by == scenario[0] for row in CrowdForecast.objects.all())


def test_sample_cleanup_deletes_only_exact_source(scenario):
    staff, airports, _ = scenario
    for index, source in enumerate(
        ("Sample data", "Sample data ", "Manual", CALCULATED_SOURCE)
    ):
        CrowdForecast.objects.create(
            airport=airports[0],
            date=datetime(2026, 12, 10 + index).date(),
            crowd_level="low",
            calculated_at=timezone.now(),
            created_by=staff,
            data_source=source,
        )
    # The calculated row still has a flight; it must survive the approved cleanup.
    make_flight(scenario, departure=datetime(2026, 12, 13, 8, tzinfo=UTC))
    counts = recalculate_forecasts(staff, remove_sample_data=True)
    assert counts["sample_deleted"] == 1
    assert CrowdForecast.objects.filter(data_source="Sample data ").exists()
    assert CrowdForecast.objects.filter(data_source="Manual").exists()
    assert CrowdForecast.objects.filter(data_source=CALCULATED_SOURCE).exists()
    assert Flight.objects.count() == 1
    assert Airport.objects.count() == 3
    assert User.objects.count() == 1


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_api_flight_create_update_and_delete_recalculates_old_and_new_pairs(scenario):
    staff, airports, airline = scenario
    client = client_for(staff)
    response = client.post(
        "/api/flights/",
        {
            "airline": airline.pk,
            "flight_number": "100",
            "origin": airports[0].pk,
            "destination": airports[1].pk,
            "departure_time": "2026-12-01T23:30:00Z",
            "arrival_time": "2026-12-02T01:30:00Z",
            "total_seats": 100,
            "available_seats": 60,
        },
        format="json",
    )
    assert response.status_code == 201
    assert CrowdForecast.objects.count() == 2
    path = f"/api/flights/{response.json()['id']}/"
    update = client.patch(
        path,
        {
            "origin": airports[2].pk,
            "destination": airports[0].pk,
            "departure_time": "2026-12-03T10:00:00Z",
            "arrival_time": "2026-12-03T12:00:00Z",
            "available_seats": 10,
        },
        format="json",
    )
    assert update.status_code == 200
    rows = list(CrowdForecast.objects.all())
    assert len(rows) == 2
    assert {row.airport_id for row in rows} == {airports[0].pk, airports[2].pk}
    assert all(
        row.date.isoformat() == "2026-12-03" and row.crowd_level == "high"
        for row in rows
    )
    assert client.delete(path).status_code == 204
    assert not CrowdForecast.objects.exists()


def test_deleting_a_flight_preserves_manual_forecast(scenario):
    flight = make_flight(scenario)
    manual = CrowdForecast.objects.create(
        airport=flight.origin,
        date=flight.departure_time.date(),
        crowd_level="high",
        calculated_at=timezone.now(),
        created_by=scenario[0],
        data_source="Staff entry",
    )
    recalculate_forecasts(scenario[0])
    assert (
        client_for(scenario[0]).delete(f"/api/flights/{flight.pk}/").status_code == 204
    )
    assert list(CrowdForecast.objects.values_list("pk", flat=True)) == [manual.pk]


def test_recalculation_failure_rolls_back_flight_change(scenario):
    flight = make_flight(scenario)
    with (
        patch(
            "flights.services.recalculate_forecasts", side_effect=RuntimeError("Failed")
        ),
        pytest.raises(RuntimeError),
    ):
        client_for(scenario[0]).patch(
            f"/api/flights/{flight.pk}/", {"available_seats": 0}, format="json"
        )
    flight.refresh_from_db()
    assert flight.available_seats == 50


@pytest.mark.parametrize("role", ["staff", "head"])
def test_calculated_rows_are_editable_but_not_deletable(scenario, role):
    make_flight(scenario)
    recalculate_forecasts(scenario[0])
    actor = (
        scenario[0]
        if role == "staff"
        else User.objects.create(username="head", email="head@example.com", role="head")
    )
    client = client_for(actor)
    rows = client.get("/api/traffic/forecasts/").json()["results"]
    assert all(
        row["is_calculated"]
        and row["created_by_username"] is None
        and row["can_edit"] is True
        and row["can_delete"] is False
        for row in rows
    )
    assert all(
        row["flight_count"] == 1
        and row["seats_total"] == 100
        and row["seats_booked"] == 50
        for row in rows
    )
    path = f"/api/traffic/forecasts/{rows[0]['id']}/"
    assert client.delete(path).status_code == 403
    assert client.patch(path, {"crowd_level": "high"}, format="json").status_code == 200
    assert (
        client.post(
            "/api/traffic/forecasts/",
            {
                "airport": scenario[1][2].pk,
                "date": "2026-12-10",
                "crowd_level": "low",
                "data_source": CALCULATED_SOURCE,
            },
            format="json",
        ).status_code
        == 400
    )


def test_query_count_does_not_grow_per_forecast(scenario):
    client = client_for(scenario[0])
    make_flight(scenario)
    recalculate_forecasts(scenario[0])
    with CaptureQueriesContext(connection) as first:
        response = client.get("/api/traffic/forecasts/")
        assert response.status_code == 200
    for index in range(2, 12):
        make_flight(
            scenario,
            number=str(index),
            departure=datetime(2026, 12, index, 8, tzinfo=UTC),
        )
    recalculate_forecasts(scenario[0])
    with CaptureQueriesContext(connection) as second:
        response = client.get("/api/traffic/forecasts/")
        assert len(response.json()["results"]) > 10
    assert len(second) == len(first) == 4


def test_command_requires_seed_staff_and_prints_only_counts(scenario, monkeypatch):
    monkeypatch.setenv("SEED_STAFF_USERNAME", "missing")
    with pytest.raises(CommandError, match="seed_staff first"):
        call_command("recalculate_forecasts")
    monkeypatch.setenv("SEED_STAFF_USERNAME", scenario[0].username)
    make_flight(scenario)
    output = StringIO()
    call_command("recalculate_forecasts", stdout=output)
    assert (
        output.getvalue()
        == "Created: 2, updated: 0, deleted: 0, manual skipped: 0, sample deleted: 0\n"
    )
