from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch

from rest_framework.test import APITestCase

from accounts.models import User
from flights.models import Airline, Airport, Flight
from traffic.models import CrowdForecast, HistoricalRecord

RECOMMENDATIONS = "/api/traffic/recommendations/"
EXPLANATION = "/api/traffic/explanation/"
NOW = datetime(2026, 12, 15, 4, tzinfo=UTC)


class DateRecommendationsTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.traveler = User.objects.create(username="traveler", email="traveler@example.com", role=User.Role.TRAVELER)
        cls.staff = User.objects.create(username="staff", email="staff@example.com", role=User.Role.STAFF)
        cls.origin = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
        cls.destination = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
        cls.other_destination = Airport.objects.create(code="DVO", name="Davao", city="Davao", country="Philippines")
        cls.airline = Airline.objects.create(code="5J", name="Cebu Pacific")

    def setUp(self):
        self.client.force_authenticate(self.traveler)
        clock = patch("traffic.insights.now", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.next_flight_number = 1

    def flight(self, departure, *, available=50, destination=None, origin=None):
        number = f"5J{self.next_flight_number}"
        self.next_flight_number += 1
        return Flight.objects.create(
            airline=self.airline, flight_number=number, origin=origin or self.origin,
            destination=destination or self.destination, departure_time=departure,
            arrival_time=departure + timedelta(hours=1), total_seats=100,
            available_seats=available, created_by=self.staff,
        )

    def forecast(self, day, *, level="low", score=35):
        return CrowdForecast.objects.create(
            airport=self.origin, date=day, crowd_level=level,
            crowd_score=score, data_source="Staff entry", created_by=self.staff,
            calculated_at=NOW,
        )

    def recommend(self, selected="2026-12-15", **params):
        response = self.client.get(RECOMMENDATIONS, {"airport": self.origin.pk, "date": selected, **params})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_excludes_past_dates_and_departed_or_exact_time_flights_today(self):
        self.forecast("2026-12-14")
        self.forecast("2026-12-15")
        self.flight(NOW - timedelta(days=1), available=90)
        self.flight(NOW - timedelta(minutes=10), available=90)
        self.flight(NOW, available=90)
        self.flight(NOW + timedelta(minutes=10), available=25)
        result = self.recommend("2026-12-16")
        self.assertEqual([row["date"] for row in result["recommendations"]], ["2026-12-15"])
        self.assertEqual(result["recommendations"][0]["open_seats"], 25)
        self.assertEqual(result["recommendations"][0]["flight_count"], 1)

    def test_matches_flights_on_their_manila_departure_date(self):
        self.forecast("2026-12-16")
        flight = self.flight(datetime(2026, 12, 15, 17, tzinfo=UTC))
        result = self.recommend()
        self.assertEqual(result["selected_status"]["state"], "no_flights")
        recommendation = result["recommendations"][0]
        self.assertEqual(recommendation["date"], "2026-12-16")
        self.assertEqual(recommendation["flights"][0]["flight_number"], flight.flight_number)

    def test_full_selected_date_has_status_and_can_still_show_alternatives(self):
        self.flight(NOW + timedelta(hours=2), available=0)
        self.forecast("2026-12-16")
        self.flight(NOW + timedelta(days=1))
        result = self.recommend()
        self.assertEqual(result["selected_status"], {"state": "full", "message": "All flights on this date are full."})
        self.assertEqual(result["recommendations"][0]["date"], "2026-12-16")
        explanation = self.client.get(EXPLANATION, {"airport": self.origin.pk, "date": "2026-12-15"})
        self.assertEqual(explanation.status_code, 200)
        self.assertEqual(explanation.data["open_seats"], 0)

    def test_late_selected_date_has_departed_status_and_keeps_explanation(self):
        self.flight(NOW - timedelta(hours=1))
        self.assertEqual(self.recommend()["selected_status"], {
            "state": "departed", "message": "All flights on this date have already departed.",
        })
        explanation = self.client.get(EXPLANATION, {"airport": self.origin.pk, "date": "2026-12-15"})
        self.assertEqual(explanation.status_code, 200)
        self.assertEqual(explanation.data["flights"]["count"], 1)

    def test_selected_date_status_uses_only_upcoming_flights_for_availability(self):
        self.flight(NOW - timedelta(hours=1), available=70)
        self.flight(NOW + timedelta(hours=1), available=0)
        self.assertEqual(self.recommend()["selected_status"]["state"], "full")
        self.flight(NOW + timedelta(hours=2), available=1)
        self.assertEqual(self.recommend()["selected_status"], {"state": "bookable", "message": ""})

    def test_recommends_low_before_medium_and_never_high_with_real_reasons(self):
        for offset, level, score, seats in [(1, "medium", 53, 80), (2, "low", 60, 20), (3, "high", 10, 90), (4, "medium", 52, 50)]:
            departure = NOW + timedelta(days=offset)
            self.forecast(departure.date(), level=level, score=score)
            self.flight(departure, available=seats)
        HistoricalRecord.objects.create(
            airport=self.origin, date=date(2026, 12, 19) - timedelta(days=364),
            total_flights=1, seats_total=100, seats_booked=40,
        )
        result = self.recommend()
        self.assertEqual([row["date"] for row in result["recommendations"]], ["2026-12-17", "2026-12-19", "2026-12-16"])
        self.assertEqual(result["recommendations"][0]["reasons"][0], "This day has a Low crowd level (score 60.0).")
        self.assertEqual(result["recommendations"][1]["reasons"], [
            "This day has a Medium crowd level, moderate congestion (score 52.0).",
            "1 flights depart from CEB on this date, with 50 open seats.",
            "In 2025, the same weekday around this date averaged 40.0% seats booked.",
        ])
        self.assertEqual(result["message"], "")

    def test_window_includes_both_seven_day_boundaries_and_excludes_selected_date(self):
        selected = NOW + timedelta(days=10)
        for offset in (-8, -7, 0, 7, 8):
            departure = selected + timedelta(days=offset)
            self.forecast(departure.date())
            self.flight(departure)
        result = self.recommend(selected.date().isoformat())
        self.assertEqual([row["date"] for row in result["recommendations"]], ["2026-12-18", "2027-01-01"])
        self.assertIn("Only 2 qualifying dates", result["message"])

    def test_booking_route_filters_selected_and_recommended_flights(self):
        self.flight(NOW + timedelta(hours=1), destination=self.other_destination)
        self.forecast("2026-12-16")
        self.forecast("2026-12-17")
        self.flight(NOW + timedelta(days=1), destination=self.other_destination, available=90)
        self.flight(NOW + timedelta(days=2), available=15)
        self.flight(NOW + timedelta(days=2), destination=self.other_destination, available=90)
        self.flight(NOW + timedelta(days=2), origin=self.other_destination, destination=self.origin, available=90)
        result = self.recommend(destination=self.destination.pk)
        self.assertEqual(result["selected_status"], {"state": "no_flights", "message": "No flights are scheduled for this date."})
        self.assertEqual([row["date"] for row in result["recommendations"]], ["2026-12-17"])
        self.assertEqual(result["recommendations"][0]["open_seats"], 15)
        self.assertIn("Only 1 qualifying date is available", result["message"])
        all_departures = self.recommend()
        self.assertEqual(all_departures["selected_status"]["state"], "bookable")
        self.assertEqual([row["open_seats"] for row in all_departures["recommendations"]], [105, 90])

    def test_no_qualifying_flights_returns_the_window_message(self):
        self.forecast("2026-12-16")
        self.flight(NOW + timedelta(days=1), available=0)
        result = self.recommend()
        self.assertEqual(result["recommendations"], [])
        self.assertEqual(result["message"], "No flights with open seats were found within 7 days of 2026-12-15.")

    def test_2027_date_after_schedule_reports_last_departure_for_the_route(self):
        self.flight(datetime(2026, 12, 31, 18, tzinfo=UTC), available=0)
        self.flight(datetime(2027, 1, 10, 18, tzinfo=UTC), destination=self.other_destination)
        result = self.recommend("2027-01-20", destination=self.destination.pk)
        self.assertEqual(result["selected_status"]["state"], "no_flights")
        self.assertEqual(result["recommendations"], [])
        self.assertEqual(result["message"], (
            "No flights with open seats were found within 7 days of 2027-01-20. "
            "Scheduled flights end on 2027-01-01."
        ))

    def test_recommendations_require_login_and_reject_invalid_parameters(self):
        for value in ("invalid", "0001-01-01", "9999-12-31"):
            with self.subTest(date=value):
                response = self.client.get(RECOMMENDATIONS, {"airport": self.origin.pk, "date": value})
                self.assertEqual(response.status_code, 400)
                self.assertIn("date", response.data)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(RECOMMENDATIONS).status_code, 401)

    def test_recommendation_and_explanation_endpoints_require_login_and_reject_bad_parameters(self):
        for url in (RECOMMENDATIONS, EXPLANATION):
            with self.subTest(url=url):
                self.client.force_authenticate(user=None)
                self.assertEqual(self.client.get(url).status_code, 401)
                self.client.force_authenticate(self.traveler)
                response = self.client.get(url, {"airport": "bad", "date": "2026-13-01"})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(set(response.data), {"airport", "date"})
