from datetime import timedelta

from django.utils.timezone import now
from rest_framework.test import APITestCase

from accounts.models import User
from flights.models import Airline, Airport, Flight
from traffic.models import CrowdForecast


class CoreListQueriesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create(username="staff", email="staff@example.com", role=User.Role.STAFF)
        cls.origin = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
        cls.destination = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
        cls.airline = Airline.objects.create(code="5J", name="Cebu Pacific")

    def add_records(self, offsets):
        departure = (now() + timedelta(days=30)).replace(hour=8, minute=0, second=0, microsecond=0)
        Flight.objects.bulk_create([
            Flight(
                airline=self.airline, flight_number=f"5J{offset}", origin=self.origin, destination=self.destination,
                departure_time=departure + timedelta(days=offset), arrival_time=departure + timedelta(days=offset, hours=1),
                total_seats=100, available_seats=40, created_by=self.staff,
            )
            for offset in offsets
        ])
        CrowdForecast.objects.bulk_create([
            CrowdForecast(
                airport=self.origin, date=departure.date() + timedelta(days=offset), crowd_level="medium",
                crowd_score=60, calculated_at=now(), data_source="Staff entry", created_by=self.staff,
            )
            for offset in offsets
        ])

    def test_paginated_flight_and_forecast_list_queries_stay_constant(self):
        self.client.force_authenticate(self.staff)
        self.add_records(range(1))
        for count in (1, 50):
            for route, queries in (("/api/flights/", 2), ("/api/traffic/forecasts/", 4)):
                with self.subTest(route=route, count=count), self.assertNumQueries(queries):
                    response = self.client.get(route)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(len(response.data["results"]), count)
            if count == 1:
                self.add_records(range(1, 50))
