from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from django.utils.timezone import now
from rest_framework.test import APITestCase

from accounts.models import User
from flights.models import Airline, Airport, Flight


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
