from datetime import timedelta
from unittest.mock import patch

import pytest
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from flights.models import Airport
from traffic.models import CrowdForecast

pytestmark = pytest.mark.django_db
BASE = "/api/traffic/forecasts/"


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
    airport = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
    return {"airport": airport.pk, "date": "2026-12-01", "crowd_level": "low"}


@pytest.fixture
def forecast(users, payload):
    return CrowdForecast.objects.create(
        airport_id=payload["airport"], date=payload["date"], crowd_level="low",
        calculated_at=timezone.now() - timedelta(days=1), created_by=users["staff"],
    )


@pytest.mark.parametrize("path", ["", "{id}/"])
def test_signed_out_reads_are_401(path, forecast):
    assert client_for().get(BASE + path.format(id=forecast.pk)).status_code == 401


@pytest.mark.parametrize("method,path", [("post", ""), ("patch", "{id}/"), ("delete", "{id}/")])
@pytest.mark.parametrize("role,expected", [(None, 401), ("traveler", 403)])
def test_unauthorized_writes_are_denied(method, path, role, expected, users, forecast, payload):
    client = client_for(users[role] if role else None)
    response = getattr(client, method)(BASE + path.format(id=forecast.pk), payload, format="json")
    assert response.status_code == expected


@pytest.mark.parametrize("role", ["traveler", "staff", "head"])
def test_reads_preserve_creator_privacy(users, forecast, role):
    client = client_for(users[role])
    response = client.get(BASE)
    assert response.status_code == 200
    detail = client.get(f"{BASE}{forecast.pk}/")
    assert detail.status_code == 200
    record = detail.json()
    assert record == response.json()["results"][0]
    assert "created_by" not in record
    assert "email" not in str(record)
    if role == "traveler":
        assert "created_by_username" not in record
        assert "can_edit" not in record
    else:
        assert record["created_by_username"] == "staff"
        assert record["can_edit"] is True


@pytest.mark.parametrize("role", ["staff", "head"])
def test_staff_and_head_create_with_server_fields(users, payload, role):
    before = timezone.now()
    response = client_for(users[role]).post(BASE, payload, format="json")
    assert response.status_code == 201
    record = CrowdForecast.objects.get(pk=response.json()["id"])
    assert record.created_by == users[role]
    assert before <= record.calculated_at <= timezone.now()
    assert record.data_source == "Staff entry"


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_staff_can_change_another_staffs_manual_forecast(users, forecast, method):
    other = User.objects.create(username="other", email="other@example.com", role="staff")
    client = client_for(other)
    assert client.get(BASE).json()["results"][0]["can_edit"] is True
    response = getattr(client, method)(f"{BASE}{forecast.pk}/", {"crowd_level": "high"}, format="json")
    if method == "patch":
        assert response.status_code == 200
        forecast.refresh_from_db()
        assert forecast.crowd_level == "high"
    else:
        assert response.status_code == 204
        assert not CrowdForecast.objects.filter(pk=forecast.pk).exists()


@pytest.mark.parametrize("role", ["staff", "head"])
def test_owner_and_head_can_update_and_delete_with_new_calculation_time(users, forecast, role):
    client = client_for(users[role])
    before = timezone.now()
    response = client.patch(f"{BASE}{forecast.pk}/", {"crowd_level": "high"}, format="json")
    assert response.status_code == 200
    forecast.refresh_from_db()
    assert forecast.crowd_level == "high"
    assert forecast.created_by == users["staff"]
    assert before <= forecast.calculated_at <= timezone.now()
    assert client.delete(f"{BASE}{forecast.pk}/").status_code == 204
    assert not CrowdForecast.objects.exists()


@pytest.mark.parametrize("method", ["post", "patch"])
@pytest.mark.parametrize("field", ["created_by", "calculated_at"])
@pytest.mark.parametrize("value", [None, 1, "forbidden"])
def test_server_fields_are_rejected(users, forecast, payload, method, field, value):
    path = BASE if method == "post" else f"{BASE}{forecast.pk}/"
    response = getattr(client_for(users["staff"]), method)(path, {**payload, field: value}, format="json")
    assert response.status_code == 400
    assert field in response.json()


@pytest.mark.parametrize("source", [None, "", "   "])
@pytest.mark.parametrize("method", ["post", "patch"])
def test_blank_sources_become_staff_entry(users, forecast, payload, source, method):
    path = BASE if method == "post" else f"{BASE}{forecast.pk}/"
    response = getattr(client_for(users["staff"]), method)(path, {**payload, "date": "2026-12-02", "data_source": source}, format="json")
    assert response.status_code in (200, 201)
    assert response.json()["data_source"] == "Staff entry"


@pytest.mark.parametrize("level", ["low", "medium", "high"])
def test_valid_levels_and_optional_score_have_no_extra_thresholds(users, payload, level):
    response = client_for(users["staff"]).post(BASE, {**payload, "crowd_level": level, "crowd_score": -1.5}, format="json")
    assert response.status_code == 201
    assert response.json()["crowd_score"] == -1.5


@pytest.mark.parametrize("method", ["post", "patch"])
def test_invalid_crowd_level_is_field_400(users, forecast, payload, method):
    path = BASE if method == "post" else f"{BASE}{forecast.pk}/"
    response = getattr(client_for(users["staff"]), method)(path, {**payload, "crowd_level": "busy"}, format="json")
    assert response.status_code == 400
    assert "crowd_level" in response.json()


def test_duplicate_airport_date_is_400_on_create_and_partial_update(users, forecast, payload):
    client = client_for(users["staff"])
    response = client.post(BASE, payload, format="json")
    assert response.status_code == 400
    assert "date" in response.json()
    second = client.post(BASE, {**payload, "date": "2026-12-02"}, format="json").json()
    response = client.patch(f"{BASE}{second['id']}/", {"date": "2026-12-01"}, format="json")
    assert response.status_code == 400
    assert "date" in response.json()
    assert client.patch(f"{BASE}{forecast.pk}/", {"crowd_score": None}, format="json").status_code == 200


def test_unique_constraint_race_returns_field_400(users, forecast, payload):
    with patch("traffic.serializers.CrowdForecast.objects.filter") as duplicates:
        duplicates.return_value.exists.return_value = False
        with transaction.atomic():
            response = client_for(users["staff"]).post(BASE, payload, format="json")
    assert response.status_code == 400
    assert "date" in response.json()


def test_filters_combine_airport_month_and_owner(users, forecast, payload):
    client = client_for(users["staff"])
    airport = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
    client.post(BASE, {**payload, "airport": airport.pk}, format="json")
    client.post(BASE, {**payload, "date": "2027-01-01"}, format="json")
    response = client.get(BASE, {"airport": payload["airport"], "month": "2026-12", "mine": "true"})
    assert [record["id"] for record in response.json()["results"]] == [forecast.pk]
    assert client.get(BASE, {"month": "2026-11"}).json()["results"] == []
    assert client_for(users["head"]).get(BASE, {"mine": "true"}).json()["results"] == []
    assert len(client_for(users["head"]).get(BASE, {"mine": "false"}).json()["results"]) == 3


@pytest.mark.parametrize("filters,field", [
    ({"month": "bad"}, "month"), ({"month": "2026-13"}, "month"),
    ({"month": "2026-1"}, "month"), ({"airport": "bad"}, "airport"), ({"mine": "bad"}, "mine"),
])
def test_invalid_filters_are_field_400(users, filters, field):
    response = client_for(users["staff"]).get(BASE, filters)
    assert response.status_code == 400
    assert field in response.json()


def test_role_changes_take_effect_with_existing_token(users, forecast):
    client = client_for(users["staff"])
    users["staff"].role = "traveler"
    users["staff"].save()
    assert client.patch(f"{BASE}{forecast.pk}/", {"crowd_level": "high"}, format="json").status_code == 403
    assert "created_by_username" not in client.get(BASE).json()["results"][0]
