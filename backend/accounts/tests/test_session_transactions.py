from unittest.mock import patch

from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User

PASSWORD = "Session-Test-Password-72!"


class SessionTransactionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="traveler", email="traveler@example.com", password=PASSWORD)

    def test_signin_rolls_back_token_creation_when_last_login_update_fails(self):
        with (
            patch("accounts.services.update_last_login", side_effect=RuntimeError("Last login failed")),
            self.assertLogs("config.errors", level="ERROR"),
        ):
            response = self.client.post("/api/accounts/signin/", {"identifier": self.user.username, "password": PASSWORD})
        self.assertEqual(response.status_code, 500)
        self.assertFalse(OutstandingToken.objects.exists())

    def test_refresh_keeps_original_token_when_rotation_fails(self):
        refresh = str(RefreshToken.for_user(self.user))
        with (
            patch.object(RefreshToken, "outstand", side_effect=RuntimeError("Rotation failed")),
            self.assertLogs("config.errors", level="ERROR"),
        ):
            response = self.client.post("/api/accounts/token/refresh/", {"refresh": refresh})
        self.assertEqual(response.status_code, 500)
        self.assertFalse(BlacklistedToken.objects.exists())
        self.assertEqual(OutstandingToken.objects.count(), 1)
        self.assertEqual(self.client.post("/api/accounts/token/refresh/", {"refresh": refresh}).status_code, 200)

    def test_refresh_for_a_deleted_user_returns_401(self):
        refresh = str(RefreshToken.for_user(self.user))
        self.user.delete()
        response = self.client.post("/api/accounts/token/refresh/", {"refresh": refresh})
        self.assertEqual(response.status_code, 401)
