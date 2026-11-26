from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from django.db import transaction
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from flights.models import Airline, Airport, Flight

pytestmark = pytest.mark.django_db
BASE = "/api/flights/"
NOW = datetime(2026, 11, 1, tzinfo=UTC)


@pytest.fixture(autouse=True)
def freeze_flight_validation_clock(monkeypatch):
    monkeypatch.setattr("flights.serializers.now", lambda: NOW)


@pytest.fixture
def users():
    return {
        role: User.objects.create(username=role, email=f"{role}@example.com", role=role)
        for role in ("traveler", "staff", "head")
    }


def client_for(user=None):
    client = APIClient()
    if user:
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def payload():
    origin = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
    destination = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
    airline = Airline.objects.create(name="Philippine Airlines", code="PR")
    return {
        "airline": airline.pk, "flight_number": "100", "origin": origin.pk,
        "destination": destination.pk, "departure_time": "2026-12-01T08:00:00+08:00",
        "arrival_time": "2026-12-01T09:30:00+08:00", "total_seats": 180, "available_seats": 50,
    }


@pytest.fixture
def flight(users, payload):
    return Flight.objects.create(
        airline_id=payload["airline"], flight_number=payload["flight_number"],
        origin_id=payload["origin"], destination_id=payload["destination"],
        departure_time=parse_datetime(payload["departure_time"]),
        arrival_time=parse_datetime(payload["arrival_time"]),
        total_seats=180, available_seats=50, created_by=users["staff"],
    )


@pytest.mark.parametrize("path", ["", "airports/", "airlines/", "{id}/"])
def test_signed_out_reads_are_401(path, flight):
    assert client_for().get(BASE + path.format(id=flight.pk)).status_code == 401


@pytest.mark.parametrize("method,path", [("post", ""), ("patch", "{id}/"), ("delete", "{id}/")])
@pytest.mark.parametrize("role,expected", [(None, 401), ("traveler", 403)])
def test_unauthorized_writes_are_denied(method, path, role, expected, users, flight, payload):
    client = client_for(users[role] if role else None)
    response = getattr(client, method)(BASE + path.format(id=flight.pk), payload, format="json")
    assert response.status_code == expected


@pytest.mark.parametrize("role", ["traveler", "staff", "head"])
def test_reads_include_lookups_and_privacy_by_role(users, flight, role):
    client = client_for(users[role])
    response = client.get(BASE)
    assert response.status_code == 200
    detail = client.get(f"{BASE}{flight.pk}/")
    assert detail.status_code == 200
    record = detail.json()
    assert record == response.json()["results"][0]
    assert record["airline_name"] == "Philippine Airlines"
    assert record["airline_code"] == "PR"
    assert record["origin_code"] == "CEB"
    assert record["origin_name"] == "Cebu"
    assert record["destination_code"] == "MNL"
    assert record["destination_name"] == "Manila"
    assert "created_by" not in record
    assert "email" not in str(record)
    if role == "traveler":
        assert "created_by_username" not in record
        assert "can_edit" not in record
    else:
        assert record["created_by_username"] == "staff"
        assert record["can_edit"] is True
    assert client.get(BASE + "airports/").status_code == 200
    assert client.get(BASE + "airlines/").status_code == 200


@pytest.mark.parametrize("role", ["staff", "head"])
def test_staff_and_head_create_owned_flights(users, payload, role):
    response = client_for(users[role]).post(BASE, payload, format="json")
    assert response.status_code == 201
    assert Flight.objects.get(pk=response.json()["id"]).created_by == users[role]


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_staff_cannot_modify_another_staff_record(users, flight, method):
    other = User.objects.create(username="other", email="other@example.com", role="staff")
    client = client_for(other)
    assert client.get(BASE).json()["results"][0]["can_edit"] is False
    response = getattr(client, method)(f"{BASE}{flight.pk}/", {"available_seats": 20}, format="json")
    assert response.status_code == 403
    flight.refresh_from_db()
    assert flight.available_seats == 50


@pytest.mark.parametrize("role", ["staff", "head"])
def test_owner_and_head_can_update_and_delete_without_reassigning_owner(users, flight, role):
    client = client_for(users[role])
    response = client.patch(f"{BASE}{flight.pk}/", {"available_seats": 0}, format="json")
    assert response.status_code == 200
    flight.refresh_from_db()
    assert flight.available_seats == 0
    assert flight.created_by == users["staff"]
    assert client.delete(f"{BASE}{flight.pk}/").status_code == 204
    assert not Flight.objects.exists()


@pytest.mark.parametrize("method", ["post", "patch"])
@pytest.mark.parametrize("value", [None, 1, "staff"])
def test_created_by_is_rejected_even_null(users, flight, payload, method, value):
    path = BASE if method == "post" else f"{BASE}{flight.pk}/"
    response = getattr(client_for(users["staff"]), method)(path, {**payload, "created_by": value}, format="json")
    assert response.status_code == 400
    assert "created_by" in response.json()


@pytest.mark.parametrize("violation,field", [
    ("route", "destination"), ("arrival", "arrival_time"),
    ("negative", "available_seats"), ("excess", "available_seats"),
    ("total", "total_seats"), ("duplicate", "flight_number"),
])
@pytest.mark.parametrize("method", ["post", "patch"])
def test_rules_return_field_errors_on_create_and_partial_update(users, flight, payload, violation, field, method):
    invalid = {**payload, "flight_number": "101"}
    if violation == "route":
        invalid["destination"] = invalid["origin"]
    elif violation == "arrival":
        invalid["arrival_time"] = invalid["departure_time"]
    elif violation == "negative":
        invalid["available_seats"] = -1
    elif violation == "excess":
        invalid["available_seats"] = 181
    elif violation == "total":
        invalid["total_seats"] = -1
    else:
        invalid = payload
    path = BASE
    if method == "patch":
        second = Flight.objects.get(pk=flight.pk)
        second.pk = None
        second.flight_number = "102"
        second.save()
        path = f"{BASE}{second.pk}/"
        invalid = {field: invalid[field]}
        if violation == "duplicate":
            invalid = {"flight_number": "100"}
    response = getattr(client_for(users["staff"]), method)(path, invalid, format="json")
    assert response.status_code == 400
    assert response.json()[field]


def test_patch_checks_existing_seats_when_total_changes(users, flight):
    response = client_for(users["staff"]).patch(f"{BASE}{flight.pk}/", {"total_seats": 10}, format="json")
    assert response.status_code == 400
    assert "available_seats" in response.json()


def test_zero_available_seats_on_an_existing_past_flight_are_allowed(users, flight, payload):
    flight.departure_time = NOW - timedelta(days=1)
    flight.arrival_time = flight.departure_time + timedelta(hours=1)
    flight.save()
    client = client_for(users["staff"])
    response = client.patch(f"{BASE}{flight.pk}/", {
        **payload, "departure_time": flight.departure_time.isoformat(),
        "arrival_time": flight.arrival_time.isoformat(), "available_seats": 0,
    }, format="json")
    assert response.status_code == 200


def test_filters_combine_and_use_philippine_departure_day(users, flight):
    client = client_for(users["staff"])
    flight.departure_time = parse_datetime("2026-11-30T16:30:00Z")
    flight.arrival_time = flight.departure_time + timedelta(hours=1)
    flight.save()
    assert len(client.get(BASE, {"origin": flight.origin_id, "date": "2026-12-01", "mine": "true"}).json()["results"]) == 1
    assert client.get(BASE, {"date": "2026-11-30"}).json()["results"] == []
    assert client.get(BASE, {"origin": flight.destination_id}).json()["results"] == []
    assert client_for(users["head"]).get(BASE, {"mine": "true"}).json()["results"] == []
    assert len(client_for(users["head"]).get(BASE, {"mine": "false"}).json()["results"]) == 1


@pytest.mark.parametrize("filters,field", [({"date": "bad"}, "date"), ({"origin": "bad"}, "origin"), ({"mine": "bad"}, "mine")])
def test_bad_filters_return_400(users, filters, field):
    response = client_for(users["staff"]).get(BASE, filters)
    assert response.status_code == 400
    assert field in response.json()


def test_unique_constraint_race_returns_field_error(users, payload):
    client = client_for(users["staff"])
    assert client.post(BASE, payload, format="json").status_code == 201
    # Bypass the preflight check to exercise PostgreSQL's unique constraint.
    with patch("flights.serializers.Flight.objects.filter") as duplicates:
        duplicates.return_value.exists.return_value = False
        with transaction.atomic():
            response = client.post(BASE, payload, format="json")
    assert response.status_code == 400
    assert "flight_number" in response.json()


def test_role_changes_take_effect_for_existing_token(users, flight):
    client = client_for(users["staff"])
    users["staff"].role = "traveler"
    users["staff"].save()
    assert client.patch(f"{BASE}{flight.pk}/", {"available_seats": 1}, format="json").status_code == 403
    assert "created_by_username" not in client.get(BASE).json()["results"][0]


@pytest.mark.parametrize("path", ["airports/", "airlines/"])
def test_lookups_are_read_only(users, path):
    assert client_for(users["head"]).post(BASE + path, {}, format="json").status_code == 405
