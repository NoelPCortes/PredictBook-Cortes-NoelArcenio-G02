from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from flights.models import Airline, Airport, Flight
from traffic.calculation import (
    CALCULATED_SOURCE,
    project_timezone,
    recalculate_forecasts,
)
from traffic.models import CrowdForecast


class FlightForecastSyncTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create(username="staff", email="staff@example.com", role=User.Role.STAFF)
        cls.origin = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
        cls.destination = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
        cls.airline = Airline.objects.create(code="5J", name="Cebu Pacific")

    def setUp(self):
        self.client.force_authenticate(self.staff)
        departure = (timezone.now().astimezone(project_timezone()) + timedelta(days=30)).replace(
            hour=8, minute=0, second=0, microsecond=0
        )
        self.date = departure.date()
        self.payload = {
            "airline": self.airline.pk, "flight_number": "5J12", "origin": self.origin.pk,
            "destination": self.destination.pk, "departure_time": departure.isoformat(),
            "arrival_time": (departure + timedelta(hours=1)).isoformat(),
            "total_seats": 100, "available_seats": 70,
        }

    def create_flight(self):
        response = self.client.post("/api/flights/", self.payload)
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def assert_forecast_scores(self, level, score):
        recorded = CrowdForecast.objects.values_list("airport_id", "date", "data_source", "crowd_level", "crowd_score")
        self.assertCountEqual(recorded, [
            (self.origin.pk, self.date, CALCULATED_SOURCE, level, score),
            (self.destination.pk, self.date, CALCULATED_SOURCE, level, score),
        ])

    def test_create_seat_update_and_delete_recalculate_affected_forecasts(self):
        flight_id = self.create_flight()
        url = f"/api/flights/{flight_id}/"
        self.assert_forecast_scores("low", 30)

        self.assertEqual(self.client.patch(url, {"available_seats": 20}).status_code, 200)
        self.assert_forecast_scores("high", 80)

        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(Flight.objects.filter(pk=flight_id).exists())
        self.assertFalse(CrowdForecast.objects.exists())

    def test_recalculation_failure_rolls_back_flight_creation_seat_update_and_deletion(self):
        self.client.raise_request_exception = False

        def recalculate_then_fail(actor, pairs):
            recalculate_forecasts(actor, pairs)
            raise RuntimeError("Recalculation failed")

        with patch("flights.services.recalculate_forecasts", side_effect=recalculate_then_fail):
            self.assertEqual(self.client.post("/api/flights/", self.payload).status_code, 500)
        self.assertFalse(Flight.objects.exists())
        self.assertFalse(CrowdForecast.objects.exists())

        flight_id = self.create_flight()
        url = f"/api/flights/{flight_id}/"
        for method, payload in ((self.client.patch, {"available_seats": 20}), (self.client.delete, {})):
            with (
                self.subTest(method=method.__name__),
                patch("flights.services.recalculate_forecasts", side_effect=recalculate_then_fail),
            ):
                self.assertEqual(method(url, payload).status_code, 500)
            self.assertEqual(Flight.objects.get(pk=flight_id).available_seats, 70)
            self.assert_forecast_scores("low", 30)
