from django.test import Client, SimpleTestCase, override_settings
from django.urls import path
from rest_framework.test import APIClient
from rest_framework.views import APIView

from config.urls import handler404, handler500
from config.urls import urlpatterns as project_urls

PRIVATE_ERROR = "Private SQL and path /srv/views.py"


def fail_view(request):
    raise RuntimeError(PRIVATE_ERROR)


class FailingAPIView(APIView):
    authentication_classes = ()
    permission_classes = ()

    def get(self, request):
        return fail_view(request)


urlpatterns = [
    *project_urls,
    path("api/test-drf-error/", FailingAPIView.as_view()),
    path("api/test-django-error/", fail_view),
    path("test-django-error/", fail_view),
]

__all__ = ["handler404", "handler500", "urlpatterns"]


@override_settings(DEBUG=False)
class ErrorResponsesTests(SimpleTestCase):
    def assert_no_diagnostics(self, response):
        for marker in ("Traceback", "RuntimeError", "Django", PRIVATE_ERROR):
            self.assertNotContains(response, marker, status_code=response.status_code)

    def test_custom_404_has_no_traceback_when_debug_is_false(self):
        client = APIClient()
        response = client.get("/api/flights/not-a-number/", HTTP_ACCEPT="text/html")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Not found."})
        self.assert_no_diagnostics(response)
        response = client.get("/unknown-page/")
        self.assertContains(response, "<h1>Not found.</h1>", status_code=404)
        self.assertIn("text/html", response["Content-Type"])
        self.assert_no_diagnostics(response)

    @override_settings(ROOT_URLCONF=__name__)
    def test_server_error_returns_generic_json_without_traceback(self):
        with self.assertLogs("config.errors", level="ERROR") as captured:
            response = APIClient().get("/api/test-drf-error/", HTTP_ACCEPT="text/html")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Something went wrong."})
        self.assert_no_diagnostics(response)
        self.assertIn(PRIVATE_ERROR, "\n".join(captured.output))

    @override_settings(ROOT_URLCONF=__name__)
    def test_unhandled_django_error_returns_generic_api_json_or_plain_html(self):
        client = Client(raise_request_exception=False)
        with self.assertLogs("django.request", level="ERROR"):
            api_response = client.get("/api/test-django-error/")
            html_response = client.get("/test-django-error/")
        self.assertEqual(api_response.status_code, 500)
        self.assertEqual(api_response.json(), {"detail": "Something went wrong."})
        self.assertContains(html_response, "<h1>Something went wrong.</h1>", status_code=500)
        self.assertIn("text/html", html_response["Content-Type"])
        self.assert_no_diagnostics(api_response)
        self.assert_no_diagnostics(html_response)
