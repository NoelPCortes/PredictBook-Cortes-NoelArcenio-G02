from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from flights.models import Airline, Airport, Flight
from traffic.calculation import CALCULATED_SOURCE, recalculate_forecasts
from traffic.models import CrowdForecast


class ForecastPermissionsTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create(username="owner", email="owner@example.com", role=User.Role.STAFF)
        cls.staff = User.objects.create(username="staff", email="staff@example.com", role=User.Role.STAFF)
        cls.head = User.objects.create(username="head", email="head@example.com", role=User.Role.HEAD)
        cls.traveler = User.objects.create(username="traveler", email="traveler@example.com", role=User.Role.TRAVELER)
        cls.airport = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
        cls.destination = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
        cls.airline = Airline.objects.create(code="5J", name="Cebu Pacific")
        cls.forecast = CrowdForecast.objects.create(
            airport=cls.airport, date=date(2030, 1, 1), crowd_level="low",
            crowd_score=20, data_source="Staff entry", created_by=cls.owner,
            calculated_at=timezone.now() - timedelta(days=1),
        )

    def setUp(self):
        self.url = f"/api/traffic/forecasts/{self.forecast.pk}/"

    def mark_calculated(self):
        CrowdForecast.objects.filter(pk=self.forecast.pk).update(data_source=CALCULATED_SOURCE)

    def add_flight(self):
        departure = datetime(2030, 1, 1, 8, tzinfo=UTC)
        Flight.objects.create(
            airline=self.airline, flight_number="5J12", origin=self.airport,
            destination=self.destination, departure_time=departure,
            arrival_time=departure + timedelta(hours=1), total_seats=100,
            available_seats=25, created_by=self.owner,
        )

    def test_staff_can_edit_another_staffs_manual_forecast(self):
        self.client.force_authenticate(self.staff)
        response = self.client.patch(self.url, {"crowd_level": "medium", "data_source": "Airport count"})
        self.assertEqual(response.status_code, 200)
        self.forecast.refresh_from_db()
        self.assertEqual(self.forecast.crowd_level, "medium")
        self.assertEqual(self.forecast.data_source, "Airport count")
        self.assertEqual(self.forecast.created_by, self.owner)

    def test_head_can_edit_another_users_forecast(self):
        self.client.force_authenticate(self.head)
        response = self.client.patch(self.url, {"crowd_score": 88})
        self.assertEqual(response.status_code, 200)
        self.forecast.refresh_from_db()
        self.assertEqual(self.forecast.crowd_score, 88)

    def test_traveler_cannot_edit_or_delete_forecast(self):
        self.client.force_authenticate(self.traveler)
        self.assertEqual(self.client.patch(self.url, {"crowd_level": "high"}).status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.forecast.refresh_from_db()
        self.assertEqual(self.forecast.crowd_level, "low")

    def test_signed_out_forecast_requests_are_rejected(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.assertEqual(self.client.patch(self.url, {"crowd_level": "high"}).status_code, 401)
        self.assertEqual(self.client.delete(self.url).status_code, 401)

    def test_editing_calculated_forecast_converts_it_and_preserves_it_on_recalculation(self):
        self.mark_calculated()
        self.add_flight()
        self.client.force_authenticate(self.staff)
        before = timezone.now()
        response = self.client.patch(self.url, {"crowd_score": 38, "data_source": "Ignored"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_calculated"])
        self.assertTrue(response.data["can_delete"])
        recalculate_forecasts(self.staff, {(self.airport.pk, self.forecast.date)})
        self.forecast.refresh_from_db()
        self.assertEqual(self.forecast.data_source, "Staff entry")
        self.assertEqual(self.forecast.created_by, self.owner)
        self.assertEqual(self.forecast.crowd_score, 38)
        self.assertGreaterEqual(self.forecast.calculated_at, before)

    def test_calculated_forecast_airport_and_date_cannot_change(self):
        self.mark_calculated()
        self.client.force_authenticate(self.staff)
        response = self.client.patch(self.url, {"airport": self.destination.pk, "date": "2030-01-02"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data), {"airport", "date"})
        self.forecast.refresh_from_db()
        self.assertEqual(self.forecast.airport, self.airport)
        self.assertEqual(self.forecast.date, date(2030, 1, 1))
        self.assertEqual(self.forecast.data_source, CALCULATED_SOURCE)

    def test_client_cannot_set_calculated_forecast_source(self):
        self.client.force_authenticate(self.staff)
        response = self.client.patch(self.url, {"data_source": CALCULATED_SOURCE})
        self.assertEqual(response.status_code, 400)
        self.assertIn("data_source", response.data)

    def test_calculated_forecast_cannot_be_deleted_by_head(self):
        self.mark_calculated()
        self.client.force_authenticate(self.head)
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "Calculated forecasts cannot be deleted.")
        self.assertTrue(CrowdForecast.objects.filter(pk=self.forecast.pk).exists())

    def test_deleting_another_staffs_manual_forecast_restores_calculated_forecast(self):
        self.add_flight()
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        restored = CrowdForecast.objects.get(airport=self.airport, date=self.forecast.date)
        self.assertNotEqual(restored.pk, self.forecast.pk)
        self.assertEqual(restored.data_source, CALCULATED_SOURCE)
        self.assertEqual(restored.crowd_score, 75)

    def test_manual_forecast_deletion_rolls_back_when_recalculation_fails(self):
        self.add_flight()
        self.client.force_authenticate(self.staff)

        def recalculate_then_fail(actor, pairs):
            recalculate_forecasts(actor, pairs)
            raise RuntimeError("Recalculation failed")

        with (
            patch("traffic.services.recalculate_forecasts", side_effect=recalculate_then_fail),
            self.assertRaisesRegex(RuntimeError, "Recalculation failed"),
        ):
            self.client.delete(self.url)
        self.assertEqual(list(CrowdForecast.objects.values_list("pk", flat=True)), [self.forecast.pk])

    def test_forecast_permissions_flags_follow_role_and_source(self):
        for actor in (self.staff, self.head):
            self.client.force_authenticate(actor)
            record = self.client.get(self.url).data
            self.assertTrue(record["can_edit"])
            self.assertTrue(record["can_delete"])
        self.mark_calculated()
        for actor in (self.staff, self.head):
            self.client.force_authenticate(actor)
            record = self.client.get(self.url).data
            self.assertTrue(record["can_edit"])
            self.assertFalse(record["can_delete"])
        self.client.force_authenticate(self.traveler)
        record = self.client.get(self.url).data
        self.assertNotIn("can_edit", record)
        self.assertNotIn("can_delete", record)
