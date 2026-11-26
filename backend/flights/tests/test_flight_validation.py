from datetime import timedelta
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from django.utils.timezone import now
from rest_framework.test import APITestCase

from accounts.models import User
from flights.models import Airline, Airport, Flight
from traffic.calculation import recalculate_forecasts
from traffic.models import CrowdForecast

FLIGHTS_URL = "/api/flights/"


class FlightModelValidatorTests(SimpleTestCase):
    def test_model_validators_reject_bad_airport_airline_flight_codes_and_seats(self):
        invalid_values = (
            (Airport, "code", "CeB"),
            (Airline, "code", "!"),
            (Flight, "flight_number", "1"),
            (Flight, "total_seats", 0),
        )
        for model, field, value in invalid_values:
            with self.subTest(model=model, field=field), self.assertRaises(ValidationError):
                model._meta.get_field(field).run_validators(value)


class FlightValidationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create(username="staff", email="staff@example.com", role=User.Role.STAFF)
        cls.other_staff = User.objects.create(username="other", email="other@example.com", role=User.Role.STAFF)
        cls.head = User.objects.create(username="head", email="head@example.com", role=User.Role.HEAD)
        cls.traveler = User.objects.create(username="traveler", email="traveler@example.com", role=User.Role.TRAVELER)
        cls.origin = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
        cls.destination = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
        cls.airline = Airline.objects.create(code="5J", name="Cebu Pacific")

    def setUp(self):
        self.client.force_authenticate(self.staff)
        departure = now() + timedelta(days=14)
        self.payload = {
            "airline": self.airline.pk, "flight_number": "5J21", "origin": self.origin.pk,
            "destination": self.destination.pk, "departure_time": departure.isoformat(),
            "arrival_time": (departure + timedelta(hours=1)).isoformat(),
            "total_seats": 150, "available_seats": 60,
        }

    def create_flight(self):
        response = self.client.post(FLIGHTS_URL, self.payload)
        self.assertEqual(response.status_code, 201, response.data)
        return Flight.objects.get(pk=response.data["id"])

    def test_staff_can_create_flight_with_valid_input(self):
        flight = self.create_flight()
        self.assertEqual(flight.created_by, self.staff)
        self.assertEqual(flight.flight_number, "5J21")
        self.assertEqual(flight.available_seats, 60)

    def test_create_flight_rejects_same_origin_and_destination(self):
        response = self.client.post(FLIGHTS_URL, {**self.payload, "destination": self.origin.pk})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["destination"], ["Origin and destination must be different."])
        self.assertFalse(Flight.objects.exists())

    def test_create_flight_rejects_available_seats_above_total(self):
        response = self.client.post(FLIGHTS_URL, {**self.payload, "available_seats": 151})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["available_seats"], ["Available seats must be between 0 and total seats."])
        self.assertFalse(Flight.objects.exists())

    def test_duplicate_flight_is_rejected(self):
        flight = self.create_flight()
        response = self.client.post(FLIGHTS_URL, self.payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["flight_number"], ["This airline, flight number, and departure time already exist."])
        self.assertEqual(Flight.objects.get(), flight)

    def test_flight_list_requires_login(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(FLIGHTS_URL).status_code, 401)

    def test_traveler_cannot_create_update_or_delete_flight(self):
        flight = self.create_flight()
        self.client.force_authenticate(self.traveler)
        url = f"{FLIGHTS_URL}{flight.pk}/"
        self.assertEqual(self.client.post(FLIGHTS_URL, {**self.payload, "flight_number": "5J22"}).status_code, 403)
        self.assertEqual(self.client.patch(url, {"available_seats": 55}).status_code, 403)
        self.assertEqual(self.client.delete(url).status_code, 403)
        self.assertEqual(Flight.objects.count(), 1)
        flight.refresh_from_db()
        self.assertEqual(flight.available_seats, 60)

    def test_staff_cannot_edit_another_staffs_flight(self):
        flight = self.create_flight()
        self.client.force_authenticate(self.other_staff)
        self.assertEqual(self.client.patch(f"{FLIGHTS_URL}{flight.pk}/", {"available_seats": 55}).status_code, 403)
        flight.refresh_from_db()
        self.assertEqual(flight.available_seats, 60)

    def test_staff_cannot_delete_another_staffs_flight(self):
        flight = self.create_flight()
        self.client.force_authenticate(self.other_staff)
        self.assertEqual(self.client.delete(f"{FLIGHTS_URL}{flight.pk}/").status_code, 403)
        self.assertTrue(Flight.objects.filter(pk=flight.pk, created_by=self.staff).exists())

    def test_head_can_edit_and_delete_any_flight(self):
        flight = self.create_flight()
        self.client.force_authenticate(self.head)
        url = f"{FLIGHTS_URL}{flight.pk}/"
        self.assertEqual(self.client.patch(url, {"available_seats": 55}).status_code, 200)
        flight.refresh_from_db()
        self.assertEqual(flight.available_seats, 55)
        self.assertEqual(flight.created_by, self.staff)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(Flight.objects.filter(pk=flight.pk).exists())

    def test_client_cannot_set_created_by(self):
        response = self.client.post(FLIGHTS_URL, {**self.payload, "created_by": self.other_staff.pk})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["created_by"], ["This field is not allowed."])
        self.assertFalse(Flight.objects.exists())

    def test_get_request_never_changes_flight_data(self):
        flight = self.create_flight()
        url = f"{FLIGHTS_URL}{flight.pk}/"
        response = self.client.get(url, {"available_seats": 0, "delete": "true"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["available_seats"], 60)
        self.assertEqual(self.client.post(url, self.payload).status_code, 405)
        self.assertEqual(self.client.put(url, self.payload).status_code, 405)
        flight.refresh_from_db()
        self.assertEqual(flight.available_seats, 60)

    def test_flight_change_recalculates_forecasts_atomically(self):
        flight = self.create_flight()
        third_airport = Airport.objects.create(code="DVO", name="Davao", city="Davao", country="Philippines")
        original_forecasts = list(CrowdForecast.objects.order_by("pk").values())

        def fail_after_recalculation(actor, pairs):
            recalculate_forecasts(actor, pairs)
            self.assertTrue(CrowdForecast.objects.filter(airport=third_airport).exists())
            raise RuntimeError("Failed after recalculation")

        with (
            patch("flights.services.recalculate_forecasts", side_effect=fail_after_recalculation),
            self.assertLogs("config.errors", level="ERROR") as captured,
        ):
            response = self.client.patch(f"{FLIGHTS_URL}{flight.pk}/", {"destination": third_airport.pk})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Something went wrong."})
        self.assertIn("Failed after recalculation", "\n".join(captured.output))
        flight.refresh_from_db()
        self.assertEqual(flight.destination, self.destination)
        self.assertEqual(list(CrowdForecast.objects.order_by("pk").values()), original_forecasts)

    def test_create_flight_rejects_past_departure(self):
        past = (now() - timedelta(days=1)).isoformat()
        response = self.client.post("/api/flights/", {**self.payload, "departure_time": past})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["departure_time"], ["Departure cannot be in the past."])
        self.assertFalse(Flight.objects.exists())

    def test_update_cannot_move_departure_into_the_past(self):
        created = self.client.post("/api/flights/", self.payload)
        self.assertEqual(created.status_code, 201)
        past = (now() - timedelta(days=1)).isoformat()
        response = self.client.patch(f"/api/flights/{created.data['id']}/", {"departure_time": past})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["departure_time"], ["Departure cannot be in the past."])

    def test_create_flight_rejects_bad_flight_number_and_seat_range(self):
        for number, seats in (("a", 0), ("5J-101", 1001), ("5J100000000", "12.5")):
            with self.subTest(number=number, seats=seats):
                response = self.client.post("/api/flights/", {**self.payload, "flight_number": number, "total_seats": seats})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data["flight_number"], ["Use 2 to 10 letters or digits."])
                self.assertEqual(response.data["total_seats"], ["Enter a number from 1 to 1000."])

    def test_flight_number_is_trimmed_and_uppercased_before_uniqueness(self):
        response = self.client.post("/api/flights/", {**self.payload, "flight_number": "  5j21  "})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Flight.objects.get().flight_number, "5J21")
        response = self.client.post("/api/flights/", self.payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["flight_number"], ["This airline, flight number, and departure time already exist."])

    def test_unknown_flight_id_returns_json_404(self):
        for flight_id in (99999, 10**30):
            with self.subTest(flight_id=flight_id):
                response = self.client.get(f"/api/flights/{flight_id}/", HTTP_ACCEPT="text/html")
                self.assertEqual(response.status_code, 404)
                self.assertIn("detail", response.json())

    def test_calendar_date_boundaries_return_field_errors_instead_of_server_errors(self):
        for field in ("date", "departure_date", "arrival_date"):
            with self.subTest(field=field):
                response = self.client.get("/api/flights/", {field: "9999-12-31"})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
        response = self.client.get("/api/flights/route-dates/", {
            "month": "9999-12", "origin": self.origin.pk, "destination": self.destination.pk,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("month", response.data)
        response = self.client.post("/api/flights/", {**self.payload, "arrival_time": "9999-12-31T12:00:00Z"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("arrival_time", response.data)
