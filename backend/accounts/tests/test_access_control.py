import os
import re
import runpy
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.test import Client, SimpleTestCase, override_settings
from django.urls import URLResolver, get_resolver
from django.utils.timezone import now
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.settings import api_settings
from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import AccessToken

from accounts.models import User
from config import settings as project_settings
from flights.models import Airline, Airport, Flight
from traffic.models import CrowdForecast

PUBLIC_API_ROUTES = {
    "/api/accounts/signup/",
    "/api/accounts/signin/",
    "/api/accounts/token/refresh/",
}


def iter_routes(patterns, prefix=""):
    for pattern in patterns:
        route = f"{prefix}{pattern.pattern}"
        if isinstance(pattern, URLResolver):
            yield from iter_routes(pattern.url_patterns, route)
        else:
            yield route, pattern


@override_settings(DEBUG=False)
class ApiAccessTests(SimpleTestCase):
    def test_every_api_route_requires_login_except_the_public_ones(self):
        client = APIClient()
        public_routes = set()
        self.assertEqual(tuple(api_settings.DEFAULT_PERMISSION_CLASSES), (IsAuthenticated,))
        api_prefixes = (pattern for pattern in get_resolver().url_patterns if str(pattern.pattern).startswith("api/"))
        for route, pattern in iter_routes(api_prefixes):
            url = "/" + re.sub(r"<int:\w+>", "1", route)
            with self.subTest(url=url):
                permissions = pattern.callback.cls.permission_classes
                if url in PUBLIC_API_ROUTES:
                    self.assertEqual(tuple(permissions), (AllowAny,))
                    public_routes.add(url)
                    self.assertEqual(client.post(url, {}, format="json").status_code, 400)
                else:
                    self.assertIn(IsAuthenticated, permissions)
                    self.assertNotIn(AllowAny, permissions)
                    for method in ("GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"):
                        response = client.generic(method, url)
                        self.assertEqual(response.status_code, 401, method)
        self.assertEqual(public_routes, PUBLIC_API_ROUTES)

    def test_session_authentication_is_not_enabled_and_csrf_middleware_is_active(self):
        self.assertEqual(tuple(api_settings.DEFAULT_AUTHENTICATION_CLASSES), (JWTAuthentication,))
        self.assertIn("django.middleware.csrf.CsrfViewMiddleware", settings.MIDDLEWARE)
        with self.assertLogs("django.security.csrf", level="WARNING"):
            response = Client(enforce_csrf_checks=True).post("/admin/login/", {})
        self.assertEqual(response.status_code, 403)

    def test_environment_settings_default_debug_off_and_require_secret_key(self):
        values = {
            "SECRET_KEY": "environment-test-placeholder", "DB_NAME": "database-placeholder",
            "DB_USER": "user-placeholder", "DB_PASSWORD": "password-placeholder",
            "ALLOWED_HOSTS": "localhost, example.test, ",
        }
        with patch.dict(os.environ, values, clear=True), patch("dotenv.load_dotenv"):
            loaded = runpy.run_path(project_settings.__file__)
            self.assertFalse(loaded["DEBUG"])
            self.assertEqual(loaded["SECRET_KEY"], values["SECRET_KEY"])
            self.assertEqual(loaded["ALLOWED_HOSTS"], ["localhost", "example.test"])
            os.environ["DEBUG"] = "True"
            self.assertTrue(runpy.run_path(project_settings.__file__)["DEBUG"])
            del os.environ["SECRET_KEY"]
            with self.assertRaisesRegex(KeyError, "SECRET_KEY"):
                runpy.run_path(project_settings.__file__)


class ApiSafeMethodsTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create(username="staff", email="staff@example.com", role=User.Role.STAFF)
        cls.head = User.objects.create(username="head", email="head@example.com", role=User.Role.HEAD)
        origin = Airport.objects.create(code="CEB", name="Cebu", city="Cebu", country="Philippines")
        destination = Airport.objects.create(code="MNL", name="Manila", city="Manila", country="Philippines")
        airline = Airline.objects.create(code="5J", name="Cebu Pacific")
        departure = now() + timedelta(days=10)
        cls.flight = Flight.objects.create(
            airline=airline, flight_number="5J21", origin=origin, destination=destination,
            departure_time=departure, arrival_time=departure + timedelta(hours=1),
            total_seats=100, available_seats=50, created_by=cls.staff,
        )
        cls.forecast = CrowdForecast.objects.create(
            airport=origin, date=departure.date(), crowd_level="medium", crowd_score=50,
            data_source="Staff entry", created_by=cls.staff, calculated_at=now(),
        )

    def test_read_methods_do_not_create_update_or_delete_flights_or_forecasts(self):
        self.client.force_authenticate(self.staff)
        urls = (
            "/api/flights/", f"/api/flights/{self.flight.pk}/",
            "/api/traffic/forecasts/", f"/api/traffic/forecasts/{self.forecast.pk}/",
        )
        for url in urls:
            for method in (self.client.get, self.client.head, self.client.options):
                with self.subTest(url=url, method=method.__name__):
                    self.assertEqual(method(url, {"available_seats": 0, "crowd_level": "high"}).status_code, 200)
        self.flight.refresh_from_db()
        self.forecast.refresh_from_db()
        self.assertEqual(Flight.objects.count(), 1)
        self.assertEqual(CrowdForecast.objects.count(), 1)
        self.assertEqual(self.flight.available_seats, 50)
        self.assertEqual(self.forecast.crowd_level, "medium")

    def test_head_mutations_allow_post_but_never_run_on_get_head_or_options(self):
        self.client.force_authenticate(self.head)
        routes = ("staff/assign/", "staff/revoke/", "heads/promote/", "heads/remove/")
        for route in routes:
            url = f"/api/accounts/{route}"
            with self.subTest(route=route):
                self.assertEqual(self.client.get(url, {"email": self.staff.email}).status_code, 405)
                self.assertEqual(self.client.head(url, {"email": self.staff.email}).status_code, 405)
                self.assertIn("POST", self.client.options(url)["Allow"])
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.role, User.Role.STAFF)

    def test_api_ignores_django_session_and_allows_jwt_write_without_csrf_token(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.staff)
        self.assertEqual(client.get("/api/accounts/profile/").status_code, 401)
        client.cookies.clear()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.staff)}")
        response = client.patch(f"/api/flights/{self.flight.pk}/", {"available_seats": 30}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)
        self.flight.refresh_from_db()
        self.assertEqual(self.flight.available_seats, 30)
