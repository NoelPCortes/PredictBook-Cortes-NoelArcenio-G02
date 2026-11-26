from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils.timezone import now

from accounts.models import User
from flights.models import Airport
from traffic.models import CrowdForecast, HistoricalRecord


class TrafficModelConstraintTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.airport = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
        cls.staff = User.objects.create(username="staff", email="staff@example.com", role=User.Role.STAFF)

    def test_database_rejects_invalid_crowd_scores_but_allows_null(self):
        forecast = CrowdForecast.objects.create(
            airport=self.airport, date=date(2030, 1, 1), crowd_level="low",
            crowd_score=None, calculated_at=now(), created_by=self.staff,
        )
        for invalid in (-1, 101, float("nan")):
            with self.subTest(score=invalid), self.assertRaises(IntegrityError), transaction.atomic():
                CrowdForecast.objects.filter(pk=forecast.pk).update(crowd_score=invalid)
        forecast.refresh_from_db()
        self.assertIsNone(forecast.crowd_score)

    def test_database_rejects_negative_historical_counts_and_excess_bookings(self):
        record = HistoricalRecord.objects.create(
            airport=self.airport, date=date(2025, 1, 1), total_flights=1, seats_total=100, seats_booked=10,
        )
        for field, invalid in (("total_flights", -1), ("seats_total", -1), ("seats_booked", -1), ("seats_booked", 101)):
            with self.subTest(field=field, value=invalid), self.assertRaises(IntegrityError), transaction.atomic():
                HistoricalRecord.objects.filter(pk=record.pk).update(**{field: invalid})
        record.refresh_from_db()
        self.assertEqual(record.seats_booked, 10)
